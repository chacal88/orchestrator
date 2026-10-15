import { update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type {
  ActivityRecord,
  Attention,
  GateCheck,
  GateRecord,
  GateSkip,
  GateView,
  JiraIssue,
  OpenSpecView,
  OrchestrationRun,
  PanelView,
  PlanItem,
  SessionCard,
  SessionRow,
  Waiting,
} from '../types'
import {
  FINAL_SCOPE,
  GATE_IDS,
  GH_MERGE,
  MAX_LIVE_SESSIONS,
  PROTECTED_DIR,
  familyCheck,
  gateViews,
  isOpenGate,
  liveSessions,
  mergeRecords,
  observeBash,
  observeTool,
  phaseRefusal,
} from './gates'
import { renderPane } from './pane'
import { firstSite, issueUrl, jiraKeys, parseIssue } from './jira'
import { changeDir, openSpecView } from './openspec'
import {
  activityKey,
  applyPlanUpdate,
  completePlan,
  parseRun,
  parseSessionRows,
  findGroupId,
  groupName,
  latestActivity,
  phaseCounts,
  phaseViews,
  repoWebUrl,
  runKey,
  toCard,
} from './model'

const PANE = 'orquestrador'
/** Typed as string: the laid MCP types predate this mod's own tool. */
const PLAN_TOOL: string = 'mcp__orquestrador__plano'
const LIST_SESSIONS = 'mcp__ccd_session_mgmt__list_sessions'
const GET_SESSION = 'mcp__ccd_session_mgmt__get_session'
const OPEN_SESSION = 'mcp__ccd_window__open_session_in'
const LIST_GROUPS = 'mcp__ccd_sidebar__list_groups'
const CREATE_GROUP = 'mcp__ccd_sidebar__create_group'
const MOVE_SESSIONS = 'mcp__ccd_sidebar__move_sessions'
const REFRESH_MS = 15_000
/** Jira is asked again at most this often; the panel refreshes every 15 s. */
const JIRA_TTL_MS = 120_000

const VIEW = { plugin: 'orquestrador', key: 'view' } as const
const PLAN = { plugin: 'orquestrador', key: 'plan' } as const
const COLLAPSED = { plugin: 'orquestrador', key: 'collapsed' } as const
const WAITING = { plugin: 'orquestrador', key: 'waiting' } as const
const ANSWERED = { plugin: 'orquestrador', key: 'answered' } as const
const GATES_SEEN = { plugin: 'orquestrador', key: 'gates' } as const
const EDITED_AT = { plugin: 'orquestrador', key: 'editedAt' } as const
const START_SESSION = 'mcp__ccd_session__start_session'
const ARCHIVE_SESSION = 'mcp__ccd_session_mgmt__archive_session'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const GATES_DESCRIPTION =
  `Gate ids this phase must pass before it may be marked done or its session archived: ${GATE_IDS.join(', ')}. ` +
  'The mod watches the phase session run them (it never re-runs them); only the owner can skip one, from the panel.'

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    change: { type: 'string', description: 'Change id (e.g. the OpenSpec change folder name).' },
    changePath: {
      type: 'string',
      description:
        'Path to the change folder (absolute, or relative to this checkout); the panel reads its ' +
        'tasks.md, proposal.md and evidence.md from there.',
    },
    jira: { type: 'string', description: 'Jira issue key of the whole change (e.g. the epic), "PROJ-123".' },
    jiraSite: {
      type: 'string',
      description: 'Jira site host, e.g. "acme.atlassian.net"; omit to use the Atlassian connector\'s first site.',
    },
    waves: {
      type: 'array',
      description: 'Waves in order; a wave holds phases that may run in parallel.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          jira: { type: 'string', description: 'Jira issue key this wave maps to, if any.' },
          summary: {
            type: 'string',
            description: 'What this wave delivers and why it comes at this point, in 1-2 plain sentences (pt-BR).',
          },
          phases: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Short phase id, e.g. "4.x".' },
                title: { type: 'string' },
                icon: { type: 'string', description: 'The phase icon from the orchestrator table.' },
                tasks: { type: 'string', description: 'Task numbers, e.g. "4.1–4.3".' },
                status: { type: 'string', enum: ['pending', 'running', 'blocked', 'done'] },
                session: {
                  type: 'string',
                  description: 'The session doing it: its name, id or a unique part of its title.',
                },
                dependsOn: { type: 'array', items: { type: 'string' }, description: 'Phase ids it waits on.' },
                note: { type: 'string', description: 'One line: result, blocker or next step.' },
                jira: { type: 'string', description: 'Jira issue key this phase maps to, e.g. "PROJ-45".' },
                gates: { type: 'array', items: { type: 'string', enum: GATE_IDS }, description: GATES_DESCRIPTION },
                summary: {
                  type: 'string',
                  description:
                    'What this phase is about, in 1-3 plain sentences (pt-BR): what it changes and why. ' +
                    'Shown when the owner hovers the phase, so they recall it long after planning.',
                },
              },
              required: ['id', 'title', 'status'],
            },
          },
        },
        required: ['phases'],
      },
    },
    finalGates: {
      type: 'array',
      items: { type: 'string', enum: GATE_IDS },
      description:
        'Gates the whole change passes once, at the end (e.g. "check"): until they pass, `gh pr merge` is refused ' +
        'in this session. Prefer heavy gates here over repeating them in every phase.',
    },
    ownerQuestions: {
      type: 'array',
      description: 'Decisions pending on the owner, each with a recommendation and where it lives.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The decision, as a question (pt-BR).' },
          recommendation: {
            type: 'string',
            description: 'What you recommend; "Aceitar" sends it back to you as the owner\'s answer.',
          },
          session: { type: 'string', description: 'The session it concerns, when not this one.' },
          pr: { type: 'number', description: 'The PR number it concerns, if any.' },
        },
        required: ['question'],
      },
    },
  },
  required: ['change', 'waves'],
}

type CallResult = { text?: string; deny?: string; isError?: boolean }

/** The app's own tools are not in this mod's typed tool list until it loads beside them. */
const callTool = ($: EngineInterface, input: Record<string, unknown>): Promise<CallResult> =>
  $.tool.call(input as never) as Promise<CallResult>

const baseDir = async ($: EngineInterface): Promise<string> =>
  `${(await $.env.get('HOME')) ?? '~'}/.claude/orquestrador`

const readJson = async <T,>($: EngineInterface, path: string): Promise<T | undefined> => {
  try {
    if (!(await $.fs.exists(path))) return undefined
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return undefined
  }
}

const publishActivity = async ($: EngineInterface, lastTool: string | undefined): Promise<void> => {
  // root, not cwd: a shell `cd` inside the session must not move where it publishes
  const cwd = await $.session.root()
  const { value: plan = [] } = await $.state.get(PLAN)
  const { value: waiting } = await $.state.get(WAITING)
  const { records, editedAt } = await ownCheck($)
  const record: ActivityRecord = {
    cwd, plan, lastTool, waiting: waiting ?? undefined, updatedAt: await $.clock.now(), gates: records, editedAt,
  }
  await $.fs.write(`${await baseDir($)}/sessions/${activityKey(cwd)}.json`, JSON.stringify(record))
}

const ownCheck = async ($: EngineInterface): Promise<GateCheck> => {
  const { value: records = {} } = await $.state.get(GATES_SEEN)
  const { value: editedAt } = await $.state.get(EDITED_AT)
  return { records, editedAt: editedAt ?? undefined }
}

/** Sets or clears why this session stands still; other sessions' panels read it from the activity file. */
const setWaiting = async ($: EngineInterface, waiting: Omit<Waiting, 'since'> | null): Promise<void> => {
  const value = waiting === null ? null : { ...waiting, since: await $.clock.now() }
  await $.state.set(WAITING, value)
  await publishActivity($, undefined).catch(() => undefined)
}

const toolLabel = (tool: string): string => tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '').replace(/_/g, ' ')

const canCall = async ($: EngineInterface, tool: string): Promise<boolean> => {
  const tools = await $.tool.list()
  return tools.some(t => t.name === tool)
}

const loadRun = async ($: EngineInterface, cwd: string): Promise<OrchestrationRun | undefined> => {
  const dir = `${await baseDir($)}/runs`
  if (!(await $.fs.exists(dir))) return undefined
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const runs = await Promise.all(files.map(f => readJson<OrchestrationRun>($, `${dir}/${f.name}`)))
  return runs
    .filter((run): run is OrchestrationRun => run?.coordinatorCwd === cwd)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

const describeError = (step: string, error: unknown): string =>
  `${step}: ${error instanceof Error ? error.message.slice(0, 160) : 'falhou'}`

/** $.state takes JSON data only: an `undefined` field anywhere refuses the whole write. */
const asJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const loadSessions = async (
  $: EngineInterface,
  base: string,
  ownPlan: PlanItem[],
): Promise<{ self: SessionCard | undefined; children: SessionCard[] }> => {
  const [selfRow] = parseSessionRows((await callTool($, { tool: GET_SESSION, session_id: 'self' })).text)
  const family = parseSessionRows((await callTool($, { tool: LIST_SESSIONS, linked: true, limit: 50 })).text)
  const grouped =
    selfRow?.groupId === undefined
      ? []
      : parseSessionRows((await callTool($, { tool: LIST_SESSIONS, group: selfRow.groupId, limit: 50 })).text)

  const others = new Map<string, SessionRow>()
  for (const row of [...family, ...grouped]) {
    if (!row.isArchived && row.sessionId !== selfRow?.sessionId) others.set(row.sessionId, row)
  }
  const dir = `${base}/sessions`
  const files = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
  const records = (
    await Promise.all(files.filter(f => f.name.endsWith('.json')).map(f => readJson<ActivityRecord>($, `${dir}/${f.name}`)))
  ).filter((r): r is ActivityRecord => r !== undefined)
  // a child sharing this session's folder would read this session's own activity as its own
  const children = [...others.values()].map(row =>
    toCard(row, row.cwd === selfRow?.cwd ? undefined : latestActivity(records, row.cwd)),
  )
  const self =
    selfRow === undefined
      ? undefined
      : { ...toCard(selfRow, undefined), plan: ownPlan, hasActivity: true, gates: await ownCheck($) }
  return { self, children }
}

const readText = async ($: EngineInterface, path: string): Promise<string | undefined> =>
  (await $.fs.exists(path)) ? $.fs.read(path) : undefined

const loadOpenSpec = async ($: EngineInterface, run: OrchestrationRun): Promise<OpenSpecView | undefined> => {
  if (run.changePath === undefined) return undefined
  const home = (await $.env.get('HOME')) ?? ''
  const dir = changeDir(run.changePath.replace(/^~(?=\/)/, home), run.coordinatorCwd)
  const [tasks, proposal, evidence] = await Promise.all(
    ['tasks.md', 'proposal.md', 'evidence.md'].map(name => readText($, `${dir}/${name}`)),
  )
  if (tasks === undefined && proposal === undefined) return undefined
  return openSpecView({ tasks, proposal, evidence })
}

/** The module's own memory: it starts over on a reload, which only costs one fresh fetch. */
const jiraCache = new Map<string, { issue: JiraIssue; at: number }>()

const findTool = async ($: EngineInterface, suffix: string): Promise<string | undefined> =>
  (await $.tool.list()).find(t => t.name.endsWith(suffix))?.name

/**
 * Status and title of every issue the plan names, through whichever Atlassian connector
 * this session has. Without one, or with no site it can reach, each key keeps its link only.
 */
const loadJira = async (
  $: EngineInterface,
  run: OrchestrationRun,
): Promise<{ issues: Record<string, JiraIssue>; note: string | undefined }> => {
  const keys = jiraKeys(run)
  if (keys.length === 0) return { issues: {}, note: undefined }
  const linkOnly = (site: string | undefined, note: string) => ({
    issues: Object.fromEntries(
      keys.map(key => [key, { key, title: undefined, status: undefined, category: 'unknown' as const, url: issueUrl(site, key) }]),
    ),
    note,
  })
  const getIssue = await findTool($, '__getJiraIssue')
  const getSites = await findTool($, '__getAccessibleAtlassianResources')
  if (getIssue === undefined || getSites === undefined) {
    return linkOnly(run.jiraSite, 'Jira: conector Atlassian indisponível nesta sessão; mostrando só as chaves.')
  }
  const site = firstSite((await callTool($, { tool: getSites })).text)
  const host = run.jiraSite ?? site?.url
  if (host === undefined) {
    return linkOnly(run.jiraSite, 'Jira: o conector Atlassian está logado, mas a autorização não inclui nenhum site do Jira. Reconecte-o em claude.ai › Configurações › Conectores e marque o site na tela da Atlassian.')
  }
  const cloudId = run.jiraSite ?? site?.cloudId ?? host
  const now = await $.clock.now()
  const failed: string[] = []
  const issues = await Promise.all(
    keys.map(async (key): Promise<JiraIssue> => {
      const cached = jiraCache.get(key)
      if (cached !== undefined && now - cached.at < JIRA_TTL_MS) return cached.issue
      const ran = await callTool($, {
        tool: getIssue,
        cloudId,
        issueIdOrKey: key,
        fields: ['summary', 'status'],
      }).catch(() => ({ isError: true }) as CallResult)
      const issue = parseIssue(ran.isError === true ? undefined : ran.text, key, host)
      if (issue.status === undefined) failed.push(key)
      else jiraCache.set(key, { issue, at: now })
      return issue
    }),
  )
  return {
    issues: Object.fromEntries(issues.map(issue => [issue.key, issue])),
    note: failed.length === 0 ? undefined : `Jira: não consegui ler ${failed.join(', ')}.`,
  }
}

/** Each source fails on its own: a broken session list never hides the plan, and the panel names what failed. */
const refresh = async ($: EngineInterface): Promise<void> => {
  await restoreActivity($).catch(() => undefined)
  const problems: string[] = []
  const cwd = await $.session.root()
  const base = await baseDir($)
  const { value: ownPlan = [] } = await $.state.get(PLAN)

  const run = await loadRun($, cwd).catch(error => {
    problems.push(describeError('plano', error))
    return undefined
  })

  let sessions: { self: SessionCard | undefined; children: SessionCard[] } = { self: undefined, children: [] }
  try {
    if (await canCall($, LIST_SESSIONS)) sessions = await loadSessions($, base, ownPlan)
    else problems.push('Sessões filhas indisponíveis: o app não expõe a lista de sessões aqui.')
  } catch (error) {
    problems.push(describeError('sessões', error))
  }

  const openspec =
    run === undefined
      ? undefined
      : await loadOpenSpec($, run).catch(error => {
          problems.push(describeError('openspec', error))
          return undefined
        })
  const jira =
    run === undefined
      ? { issues: {}, note: undefined }
      : await loadJira($, run).catch(error => ({ issues: {}, note: describeError('jira', error) }))

  const skips = run === undefined ? {} : await loadSkips($, run.change).catch(() => ({}))

  const repoUrl = await $.session
    .repo()
    .then(repo => repoWebUrl(repo?.remote))
    .catch(() => undefined)

  const view: PanelView = {
    ...sessions,
    run,
    repoUrl,
    openspec,
    jira: jira.issues,
    jiraNote: jira.note,
    skips,
    updatedAt: await $.clock.now(),
    warning: problems.length === 0 ? undefined : problems.join(' · '),
  }
  await $.state.set(VIEW, asJson(view))
}

const refreshQuietly = async ($: EngineInterface): Promise<void> => {
  try {
    await refresh($)
  } catch (error) {
    $.ui.log(`orquestrador: ${describeError('refresh', error)}`)
  }
}

/**
 * Files the coordinator and every session it started under the change's sidebar group,
 * creating the group once. Runs on each plan publish and after each start_session, so a
 * new phase session never lands ungrouped.
 */
const groupFamily = async ($: EngineInterface, change: string): Promise<string | undefined> => {
  if (!(await canCall($, MOVE_SESSIONS))) return 'sidebar indisponível para agrupar'
  const name = groupName(change)
  let groupId = findGroupId((await callTool($, { tool: LIST_GROUPS })).text, name)
  if (groupId === undefined) groupId = findGroupId((await callTool($, { tool: CREATE_GROUP, name })).text)
  if (groupId === undefined) return `não consegui criar o grupo ${name}`

  const [self] = parseSessionRows((await callTool($, { tool: GET_SESSION, session_id: 'self' })).text)
  const family = parseSessionRows((await callTool($, { tool: LIST_SESSIONS, linked: true, limit: 50 })).text)
  const loose = family.filter(row => !row.isArchived && row.startedBy === self?.sessionId && row.groupId !== groupId)
  const ids = [...(self?.groupId === groupId ? [] : ['self']), ...loose.map(row => row.sessionId)]
  if (ids.length > 0) await callTool($, { tool: MOVE_SESSIONS, session_ids: ids, group_id: groupId })
  return undefined
}

const groupQuietly = async ($: EngineInterface, change: string | undefined): Promise<void> => {
  if (change === undefined) return
  try {
    const problem = await groupFamily($, change)
    if (problem !== undefined) $.ui.toast(`Orquestrador: ${problem}`)
  } catch (error) {
    $.ui.log(`orquestrador: ${describeError('agrupar', error)}`)
  }
}

const gatesFile = async ($: EngineInterface, change: string, ext: 'json' | 'ndjson'): Promise<string> =>
  `${await baseDir($)}/gates/${runKey(change)}.${ext}`

const loadSkips = async ($: EngineInterface, change: string): Promise<Record<string, GateSkip>> =>
  (await readJson<{ skips?: Record<string, GateSkip> }>($, await gatesFile($, change, 'json')))?.skips ?? {}

/** Append-only trail of skips and refusals, one JSON line each, for the owner to audit later. */
const logGateEvent = async ($: EngineInterface, change: string, event: Record<string, unknown>): Promise<void> => {
  const path = await gatesFile($, change, 'ndjson')
  const prior = (await readText($, path)) ?? ''
  await $.fs.write(path, `${prior}${JSON.stringify({ at: await $.clock.now(), ...event })}\n`)
}

/** Only the panel calls this, on the owner's press: the model has no path to a skip. */
const skipGate = async ($: EngineInterface, change: string, view: GateView): Promise<void> => {
  const skips = await loadSkips($, change)
  await $.fs.write(
    await gatesFile($, change, 'json'),
    JSON.stringify({ skips: { ...skips, [view.skipKey]: { at: await $.clock.now() } } }),
  )
  await logGateEvent($, change, { kind: 'skipped', key: view.skipKey, state: view.state, by: 'owner' })
}

type Family = { self: SessionCard | undefined; children: SessionCard[] }

const loadFamily = async ($: EngineInterface): Promise<Family | undefined> => {
  if (!(await canCall($, LIST_SESSIONS))) return undefined
  const { value: ownPlan = [] } = await $.state.get(PLAN)
  return loadSessions($, await baseDir($), ownPlan)
}

/**
 * Every phase that may not close or archive yet, with the reason. A phase with no session is the
 * coordinator's own; a session the app cannot list proves nothing, so its gates stay open.
 */
const phaseRefusals = (
  run: OrchestrationRun,
  family: Family | undefined,
  self: GateCheck,
  skips: Readonly<Record<string, GateSkip>>,
  include: (phase: OrchestrationRun['waves'][number]['phases'][number], card: SessionCard | undefined) => boolean,
): string[] =>
  phaseViews(run, family?.children ?? [])
    .flat()
    .flatMap(phase => {
      if (phase.gates === undefined || !include(phase, phase.card)) return []
      const own = phase.session === undefined
      const check = own ? self : (phase.card?.gates ?? { records: {}, editedAt: undefined })
      const where = own ? 'this session' : phase.card === undefined ? `session "${phase.session}" (not found)` : `session "${phase.card.title}"`
      const refusal = phaseRefusal(phase, gateViews(phase.gates, phase.id, check, skips).filter(isOpenGate), where)
      return refusal === undefined ? [] : [refusal]
    })

const finalOpenGates = async ($: EngineInterface, run: OrchestrationRun): Promise<GateView[]> => {
  if (run.finalGates === undefined) return []
  const family = await loadFamily($)
  const check = familyCheck([await ownCheck($), ...(family?.children ?? []).map(c => c.gates)])
  return gateViews(run.finalGates, FINAL_SCOPE, check, await loadSkips($, run.change)).filter(isOpenGate)
}

const publishPlan = async ($: EngineInterface, input: Record<string, unknown>): Promise<ToolCallResult<string>> => {
  const cwd = await $.session.root()
  const parsed = parseRun(input, cwd, await $.clock.now())
  if ('error' in parsed) return { result: `Plan not published: ${parsed.error}`, isError: true as const }
  const before = await readJson<OrchestrationRun>($, `${await baseDir($)}/runs/${runKey(parsed.change)}.json`)
  const wasDone = new Set(before?.waves.flatMap(w => w.phases.filter(p => p.status === 'done').map(p => p.id)) ?? [])
  const refusals = phaseRefusals(
    parsed,
    await loadFamily($),
    await ownCheck($),
    await loadSkips($, parsed.change),
    phase => phase.status === 'done' && !wasDone.has(phase.id),
  )
  if (refusals.length > 0) {
    await logGateEvent($, parsed.change, { kind: 'refused', action: 'done', reasons: refusals })
    return {
      result: `Plan not published: ${refusals.join(' | ')} Publish it again with that phase still running.`,
      isError: true as const,
    }
  }
  await $.fs.write(`${await baseDir($)}/runs/${runKey(parsed.change)}.json`, JSON.stringify(parsed))
  await groupQuietly($, parsed.change)
  await refreshQuietly($)
  await $.ui.open({ id: PANE, title: '🧭 Orquestrador' })
  const counts = phaseCounts(parsed)
  return {
    result:
      `Plan published for ${parsed.change}: ${counts.done} done, ${counts.running} running, ` +
      `${counts.blocked} blocked, ${counts.pending} pending.`,
  }
}

/**
 * Opens a session from the panel: beside this one when it is this session's own child (the
 * only kind the app lets a session place), else through the app's `claude://` link, which the
 * pane cannot follow itself. Says where to look when neither works.
 */
const openSession = async ($: EngineInterface, card: SessionCard, selfId: string | undefined): Promise<void> => {
  if (selfId !== undefined && card.startedBy === selfId) {
    const ran = await callTool($, { tool: OPEN_SESSION, session_id: card.sessionId, target: 'split' }).catch(
      () => ({ isError: true }) as CallResult,
    )
    if (ran.isError !== true && ran.deny === undefined) return
  }
  if (card.link !== undefined && card.link.startsWith('claude://')) {
    const opened = await $.process.run(['open', card.link], { timeoutMs: 5_000 }).catch(() => undefined)
    if (opened?.exitCode === 0) return
  }
  $.ui.toast(`Não consegui abrir; procure "${card.title}" na barra lateral.`)
}

const PLAN_FAILED = { result: 'Plan not published: the orchestrator panel failed to store it.', isError: true } as const

/** The gates' files are the mod's alone: a record or a skip written by the model would forge a pass. */
/** Commands that only read: the gate files may be looked at, never written from a shell. */
const READ_ONLY_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'stat', 'jq', 'diff', 'file', 'du'])

/** The folder named with or without its trailing slash: `rm -rf ~/.claude/orquestrador` must not slip through. */
const MENTIONS_PROTECTED_DIR = /\.claude\/orquestrador(?=$|[\/\s"'])/

const isReadOnlyCommand = (command: string): boolean => {
  const quiet = command.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, '')
  if (quiet.includes('>')) return false
  return quiet
    .split(/&&|\|\||[|;]/)
    .map(part => part.trim())
    .filter(part => part !== '')
    .every(part => {
      const words = part.split(/\s+/).filter(w => !/^\w+=/.test(w))
      const head = words[0]?.split('/').pop() ?? ''
      return READ_ONLY_COMMANDS.has(head) && !(head === 'find' && /-delete|-exec|-ok\b|-fprint/.test(part))
    })
}

const touchesGateFiles = (tool: string, input: Record<string, unknown>): boolean => {
  if (EDIT_TOOLS.has(tool)) {
    const path = input.file_path ?? input.notebook_path
    return typeof path === 'string' && path.includes(PROTECTED_DIR)
  }
  return (
    tool === 'Bash' &&
    typeof input.command === 'string' &&
    MENTIONS_PROTECTED_DIR.test(input.command) &&
    !isReadOnlyCommand(input.command)
  )
}

/** Rigid: a fourth live phase session slows the owner's machine, so there is no way around it. */
const refuseStart = async ($: EngineInterface): Promise<string | undefined> => {
  const [self] = parseSessionRows((await callTool($, { tool: GET_SESSION, session_id: 'self' })).text)
  const family = parseSessionRows((await callTool($, { tool: LIST_SESSIONS, linked: true, limit: 50 })).text)
  if (self === undefined) return 'the orchestrator could not read this session, so it cannot count the live phase sessions.'
  const live = liveSessions(family, self.sessionId)
  if (live.length < MAX_LIVE_SESSIONS) return undefined
  return (
    `${live.length} phase sessions are alive (${live.map(r => r.name ?? r.title).join(', ')}); the ceiling is ` +
    `${MAX_LIVE_SESSIONS}. Archive a finished one (its gates must have passed) before starting another.`
  )
}

const refuseArchive = async ($: EngineInterface, sessionId: unknown): Promise<string | undefined> => {
  if (typeof sessionId !== 'string' || sessionId === 'self') return undefined
  const run = await loadRun($, await $.session.root())
  if (run === undefined) return undefined
  const refusals = phaseRefusals(
    run,
    await loadFamily($),
    await ownCheck($),
    await loadSkips($, run.change),
    (phase, card) => phase.status !== 'done' && card?.sessionId === sessionId,
  )
  if (refusals.length === 0) return undefined
  await logGateEvent($, run.change, { kind: 'refused', action: 'archive', reasons: refusals })
  return refusals.join(' | ')
}

const refuseMerge = async ($: EngineInterface): Promise<string | undefined> => {
  const run = await loadRun($, await $.session.root())
  if (run === undefined) return undefined
  const open = await finalOpenGates($, run)
  if (open.length === 0) return undefined
  await logGateEvent($, run.change, { kind: 'refused', action: 'merge', gates: open.map(v => v.gate) })
  return (
    `final gates of ${run.change} not passed: ${open.map(v => `${v.gate} (${v.state})`).join(', ')}. ` +
    'Run them once on the integrated code; only the owner can skip one, from the panel.'
  )
}

/** Edits to prose or outside the checkout (evidence.md, notes, scratch files) do not unprove a gate. */
const editsCode = (path: unknown, root: string): boolean =>
  typeof path === 'string' && path.startsWith(`${root}/`) && !path.endsWith('.md')

type BashOutput = { backgroundTaskId?: string; interrupted?: boolean; bashEditDiff?: { files?: { filePath?: string }[] } }

/** Records what a finished call proves for the gates, and when this session last edited code. */
const observeGates = async (
  $: EngineInterface,
  tool: string,
  input: Record<string, unknown>,
  ran: CallResult & { result?: unknown },
): Promise<void> => {
  if (ran.deny !== undefined) return
  const now = await $.clock.now()
  const root = await $.session.root()
  const failed = ran.isError === true
  let edited = false
  let observed: GateRecord[] = []
  if (tool === 'Bash') {
    const out = (failed ? undefined : ran.result) as BashOutput | undefined
    if (out?.backgroundTaskId !== undefined || out?.interrupted === true || input.run_in_background === true) return
    edited = (out?.bashEditDiff?.files ?? []).some(f => editsCode(f.filePath, root))
    observed = observeBash(String(input.command ?? ''), failed, now)
  } else if (EDIT_TOOLS.has(tool)) {
    edited = !failed && editsCode(input.file_path ?? input.notebook_path, root)
  } else {
    observed = observeTool(tool, input, failed, ran.text ?? '', now)
  }
  if (edited) await $.state.set(EDITED_AT, now)
  if (observed.length > 0) {
    const { value: records = {} } = await $.state.get(GATES_SEEN)
    await $.state.set(GATES_SEEN, mergeRecords(records, observed))
  }
}

/** Calls whose guard must hold even when the mod itself fails: refused, never let through. */
const isGuarded = (tool: string, input: Record<string, unknown>): boolean =>
  tool === PLAN_TOOL ||
  tool === START_SESSION ||
  tool === ARCHIVE_SESSION ||
  (tool === 'Bash' && typeof input.command === 'string' && GH_MERGE.test(input.command))

/**
 * An app restart empties the session's state; what the session already proved lives on in
 * its activity file. Put back the task list, the gate passes and the last edit before
 * anything publishes over that file, so a restart never undoes a passed gate.
 */
const restoreActivity = async ($: EngineInterface): Promise<void> => {
  const cwd = await $.session.root()
  const record = await readJson<ActivityRecord>($, `${await baseDir($)}/sessions/${activityKey(cwd)}.json`)
  if (record === undefined || record.cwd !== cwd) return
  const [plan, gates, edited] = await Promise.all([$.state.get(PLAN), $.state.get(GATES_SEEN), $.state.get(EDITED_AT)])
  if (plan.value === undefined && record.plan.length > 0) await $.state.set(PLAN, asJson(record.plan))
  if (gates.value === undefined && record.gates !== undefined) await $.state.set(GATES_SEEN, asJson(record.gates))
  if (edited.value === undefined && record.editedAt !== undefined) await $.state.set(EDITED_AT, record.editedAt)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await restoreActivity($).catch(() => undefined)
    await $.command.register({
      name: 'orquestrador',
      description: 'Abre o painel da orquestração: ondas, fases e sessões filhas',
    })
    await $.tool.register({
      name: 'plano',
      description:
        'Publishes the orchestration plan of a change to the orchestrator side panel: waves, phases ' +
        '(icon, tasks, status, session doing it, dependencies, one-line note) and the decisions pending ' +
        'on the owner. Send the whole plan each time a phase changes state; it replaces the previous one.',
      inputSchema: PLAN_SCHEMA,
    })
    $.clock.every(REFRESH_MS, () => void refreshQuietly($))
    void refreshQuietly($).then(async () => {
      const { value } = await $.state.get(VIEW)
      if (value?.run !== undefined) await $.ui.open({ id: PANE, title: '🧭 Orquestrador' })
    })
    return next(e)
  })

  on('command.run', { command: 'orquestrador' }, async $ => {
    await refreshQuietly($)
    const opened = await $.ui.open({ id: PANE, title: '🧭 Orquestrador' })
    return { text: opened.isPlaced ? 'Painel do orquestrador aberto.' : 'Painel pronto; amplie a janela para vê-lo.' }
  })

  on('tool.call', async ($, e, next) => {
    const tool = e.tool as string
    if (tool === PLAN_TOOL) return publishPlan($, e as unknown as Record<string, unknown>)
    const input = e as unknown as Record<string, unknown>
    if (touchesGateFiles(tool, input)) {
      return { deny: 'Orchestrator: ~/.claude/orquestrador is written by the mod only (gate records and owner skips).' }
    }
    const refusal =
      tool === START_SESSION
        ? await refuseStart($)
        : tool === ARCHIVE_SESSION
          ? await refuseArchive($, input.session_id)
          : tool === 'Bash' && typeof input.command === 'string' && GH_MERGE.test(input.command)
            ? await refuseMerge($)
            : undefined
    if (refusal !== undefined) return { deny: `Orchestrator gate: ${refusal}` }
    if (tool === 'AskUserQuestion') {
      const first = (input.questions as { question?: unknown }[] | undefined)?.[0]?.question
      await setWaiting($, { kind: 'question', text: typeof first === 'string' ? first : 'Pergunta para você' })
    }
    const ran = await next(e)
    await observeGates($, tool, input, ran as CallResult & { result?: unknown }).catch(error =>
      $.ui.log(`orquestrador: ${describeError('portões', error)}`),
    )
    if (tool.startsWith('mcp__ccd_session_mgmt__') || tool.startsWith('mcp__ccd_sidebar__') || tool === OPEN_SESSION) {
      return ran
    }
    if (tool.endsWith('ccd_session__start_session') && ran.deny === undefined && ran.isError !== true) {
      const run = await loadRun($, await $.session.root()).catch(() => undefined)
      await groupQuietly($, run?.change)
    }

    const { value: waiting } = await $.state.get(WAITING)
    if (waiting?.kind === 'permission' || tool === 'AskUserQuestion') await $.state.set(WAITING, null)
    if (ran.deny === undefined && tool.endsWith('ccd_turn__update_plan')) {
      const { value: plan = [] } = await $.state.get(PLAN)
      await $.state.set(PLAN, asJson(applyPlanUpdate(plan, input as Parameters<typeof applyPlanUpdate>[1])))
    } else if (ran.deny === undefined && tool.endsWith('ccd_turn__wrap_up')) {
      const { value: plan = [] } = await $.state.get(PLAN)
      await $.state.set(PLAN, completePlan(plan))
      if (typeof input.ask === 'string' && input.ask !== '') {
        await $.state.set(WAITING, { kind: 'question', text: input.ask, since: await $.clock.now() })
      }
    }
    await publishActivity($, tool).catch(() => undefined)
    return ran
  }).catch(($, e, next) => {
    const tool = e.tool as string
    if (next.called || !isGuarded(tool, e as unknown as Record<string, unknown>)) return next(e)
    return tool === PLAN_TOOL ? PLAN_FAILED : { deny: 'Orchestrator gate: the check itself failed, so the call is refused; try again.' }
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask') await setWaiting($, { kind: 'permission', text: toolLabel(e.tool) })
    return verdict
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const { value: waiting } = await $.state.get(WAITING)
    if (waiting !== null && waiting !== undefined) await setWaiting($, null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { value: loaded } = await $.state.get(VIEW)
    const { value: ownPlan = [] } = await $.state.get(PLAN)
    const view: PanelView = loaded ?? {
      self: undefined, children: [], run: undefined, updatedAt: 0, warning: undefined, repoUrl: undefined,
      openspec: undefined, jira: {}, jiraNote: undefined, skips: {},
    }
    const { value: collapsed = {} } = await $.state.get(COLLAPSED)
    const { value: answered = [] } = await $.state.get(ANSWERED)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const selfId = view.self?.sessionId
    return renderPane({ Box, Text, Button, Link, Svg }, view, ownPlan, {
      collapsed,
      answered,
      canOpenBeside: card => selfId !== undefined && card.startedBy === selfId,
      toggle: (id, byDefault) => () => {
        void update($, COLLAPSED, map => ({ ...map, [id]: !(map?.[id] ?? !byDefault) }))
      },
      openBeside: card => () => {
        void openSession($, card, selfId)
      },
      skip: (gate: GateView) => () => {
        const change = view.run?.change
        if (change === undefined) return
        void skipGate($, change, gate)
          .then(() => refreshQuietly($))
          .then(() => $.ui.toast(`Portão ${gate.label} pulado por decisão sua.`))
          .catch(() => $.ui.toast('Não consegui registrar o pulo do portão.'))
      },
      accept: (item: Attention) => () => {
        void update($, ANSWERED, list => [...(list ?? []), item.title].slice(-50))
        void $.prompt.submit({
          text: `Decisão do dono — "${item.title}": aceito a recomendação (${item.recommendation ?? 'a sua'}). Pode seguir.`,
          asUser: true,
        })
      },
    })
  })
}
