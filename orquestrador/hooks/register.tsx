import { update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type {
  ActivityRecord,
  Attention,
  FlowDef,
  FlowEvent,
  FlowState,
  FlowView,
  GateAttempt,
  GateCheck,
  GrillAnswer,
  PrepState,
  PrepView,
  GateRecord,
  GateSkip,
  GateView,
  JiraIssue,
  JiraMove,
  JiraTransition,
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
  ARCHIVE_COMMAND,
  GH_MERGE,
  MERGE_ADMIN,
  MAX_LIVE_SESSIONS,
  PROTECTED_DIR,
  familyCheck,
  gateViews,
  isOpenGate,
  liveSessions,
  isChangeBranch,
  mergeSelector,
  mergeTarget,
  mergeWindow,
  classifyBash,
  executedText,
  keepAttempt,
  mergeRecords,
  observeTool,
  phaseRefusal,
} from './gates'
import type { MergeTarget } from './gates'
import {
  DEFAULT_FLOW_IDS,
  applyOutcome,
  automaticOutcome,
  currentStep,
  describeFlow,
  describeStepAgent,
  describeWorkflow,
  detectedOutcome,
  executedTextShort,
  noteOwnerStep,
  observeDeploy,
  pendingReview,
  flowView,
  mergeFlows,
  ownerPress,
  pressedToast,
  resolveProjectFlows,
  wakePrompt,
  startFlow,
} from './flow'
import type { AgentFound, FlowSource, Moved } from './flow'
import { closePhase, finishLoop, isClosed, loopRefusal, loopUnits, phaseSessions, uncommitted, unitRefusal, withEvents } from './lifecycle'
import { DEFAULT_FLOWS, defaultFlows } from './flows/index'
import {
  MOCKUP_STEP,
  RELEASE_OUTCOME,
  RELEASE_STEP,
  answersPrompt,
  approvePlan,
  attachMockup,
  describePrep,
  emptyPrep,
  grillMarkdown,
  parseRoundItems,
  planVerdict,
  pressMockup,
  ownerAnswers,
  prepView,
  recordRound,
  rejectPlan,
} from './grill'
import { bandSummary, parseEvents, stepTimes } from './glance'
import { renderBand, renderPane } from './pane'
import { firstSite, issueUrl, jiraKeys, moveFor, parseIssue, parseTransitions, wishes } from './jira'
import { changeDir, openSpecView } from './openspec'
import {
  activityFor,
  activityKey,
  applyPlanUpdate,
  changePrs,
  finishedSessionIds,
  completePlan,
  parseRun,
  parseSessionRows,
  findGroupId,
  groupName,
  phaseCounts,
  phaseViews,
  repoWebUrl,
  runKey,
  sessionActivityKey,
  toCard,
} from './model'

const PANE = 'orquestrador'
/** Typed as string: the laid MCP types predate this mod's own tool. */
const PLAN_TOOL: string = 'mcp__orquestrador__plano'
const FLOW_TOOL: string = 'mcp__orquestrador__flow'
const LIST_SESSIONS = 'mcp__ccd_session_mgmt__list_sessions'
const GET_SESSION = 'mcp__ccd_session_mgmt__get_session'
const OPEN_SESSION = 'mcp__ccd_window__open_session_in'
const LIST_GROUPS = 'mcp__ccd_sidebar__list_groups'
const CREATE_GROUP = 'mcp__ccd_sidebar__create_group'
const MOVE_SESSIONS = 'mcp__ccd_sidebar__move_sessions'
const DELETE_GROUP = 'mcp__ccd_sidebar__delete_group'
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
const TRIED = { plugin: 'orquestrador', key: 'tried' } as const
const SELF_ID = { plugin: 'orquestrador', key: 'selfId' } as const
const ACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PANE_OPEN = { plugin: 'orquestrador', key: 'paneOpen' } as const
const GRILL_DRAFTS = { plugin: 'orquestrador', key: 'grillDrafts' } as const
const START_SESSION = 'mcp__ccd_session__start_session'
const TRANSITION_SUFFIX = '__transitionJiraIssue'
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
          gate: {
            type: 'object',
            description:
              'When the question is whether to skip a gate: the phase id (or "final" for finalGates) and the gate. ' +
              'The panel then offers that skip on the question itself; "Aceitar" never skips a gate.',
            properties: {
              phase: { type: 'string' },
              gate: { type: 'string', enum: GATE_IDS },
            },
            required: ['phase', 'gate'],
          },
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

/**
 * This session's id in the app's list, asked once and kept: `$.session.id()` names the
 * transcript, which is not the id the family's rows carry. Undefined outside the app.
 */
const selfId = async ($: EngineInterface): Promise<string | undefined> => {
  const { value: known } = await $.state.get(SELF_ID)
  if (known !== undefined) return known
  if (!(await canCall($, GET_SESSION))) return undefined
  const [row] = parseSessionRows((await callTool($, { tool: GET_SESSION, session_id: 'self' })).text)
  if (row !== undefined) await $.state.set(SELF_ID, row.sessionId)
  return row?.sessionId
}

/** Keyed by the session's id when known, so a phase in the coordinator's folder has a file of its own. */
const activityPath = async ($: EngineInterface, sessionId: string | undefined, cwd: string): Promise<string> =>
  `${await baseDir($)}/sessions/${sessionId === undefined ? activityKey(cwd) : sessionActivityKey(sessionId)}.json`

const publishActivity = async ($: EngineInterface, lastTool: string | undefined): Promise<void> => {
  // root, not cwd: a shell `cd` inside the session must not move where it publishes
  const cwd = await $.session.root()
  const sessionId = await selfId($).catch(() => undefined)
  const { value: plan = [] } = await $.state.get(PLAN)
  const { value: waiting } = await $.state.get(WAITING)
  const { records, editedAt, tried } = await ownCheck($)
  const record: ActivityRecord = {
    sessionId, cwd, plan, lastTool, waiting: waiting ?? undefined, updatedAt: await $.clock.now(), gates: records, editedAt, tried,
  }
  await $.fs.write(await activityPath($, sessionId, cwd), JSON.stringify(record))
}

const ownCheck = async ($: EngineInterface): Promise<GateCheck> => {
  const { value: records = {} } = await $.state.get(GATES_SEEN)
  const { value: editedAt } = await $.state.get(EDITED_AT)
  const { value: tried = [] } = await $.state.get(TRIED)
  return { records, editedAt: editedAt ?? undefined, tried }
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
  // a file per session id is never removed (the mod cannot delete), so a refresh skips the
  // ones untouched for a week instead of opening every session this machine ever ran
  const cutoff = (await $.clock.now()) - ACTIVITY_TTL_MS
  const fresh = files.filter(f => f.name.endsWith('.json') && f.mtimeMs >= cutoff)
  const records = (await Promise.all(fresh.map(f => readJson<ActivityRecord>($, `${dir}/${f.name}`)))).filter(
    (r): r is ActivityRecord => r !== undefined,
  )
  const children = [...others.values()].map(row => toCard(row, activityFor(records, row, selfRow?.cwd)))
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

/** The connector's cloud id for the plan's site, or why there is none (said to the owner as is). */
const jiraConnection = async (
  $: EngineInterface,
  run: OrchestrationRun,
): Promise<{ cloudId: string; getTransitions: string; transition: string | undefined } | { note: string }> => {
  const getTransitions = await findTool($, '__getTransitionsForJiraIssue')
  const getSites = await findTool($, '__getAccessibleAtlassianResources')
  if (getTransitions === undefined || getSites === undefined) {
    return { note: 'o conector Atlassian não está autenticado nesta sessão (claude.ai › Configurações › Conectores).' }
  }
  const site = firstSite((await callTool($, { tool: getSites })).text)
  const cloudId = run.jiraSite ?? site?.cloudId
  if (cloudId === undefined) return { note: 'a autorização do conector Atlassian não inclui nenhum site do Jira.' }
  return { cloudId, getTransitions, transition: await findTool($, TRANSITION_SUFFIX) }
}

const transitionCache = new Map<string, { list: JiraTransition[]; at: number }>()

const issueTransitions = async (
  $: EngineInterface,
  conn: { cloudId: string; getTransitions: string },
  issue: JiraIssue,
  fresh: boolean,
): Promise<JiraTransition[] | undefined> => {
  const id = `${issue.key}|${issue.status}`
  const now = await $.clock.now()
  const cached = transitionCache.get(id)
  if (!fresh && cached !== undefined && now - cached.at < JIRA_TTL_MS) return cached.list
  const ran = await callTool($, { tool: conn.getTransitions, cloudId: conn.cloudId, issueIdOrKey: issue.key }).catch(
    () => ({ isError: true }) as CallResult,
  )
  if (ran.isError === true) return undefined
  const list = parseTransitions(ran.text)
  transitionCache.set(id, { list, at: now })
  return list
}

/** The issues the flow's current step says should change state; the panel offers each move, nothing moves here. */
const loadJiraMoves = async (
  $: EngineInterface,
  run: OrchestrationRun | undefined,
  state: FlowState | undefined,
  issues: Record<string, JiraIssue>,
): Promise<JiraMove[]> => {
  if (run === undefined || state === undefined || (state.status !== 'running' && state.status !== 'done')) return []
  const stepId = state.status === 'done' ? state.flow.steps.at(-1)?.id : state.current
  if (stepId === undefined) return []
  const wanted = wishes(run, state.flow.steps, stepId)
  if (wanted.length === 0) return []
  const conn = await jiraConnection($, run)
  const moves: JiraMove[] = []
  for (const wish of wanted) {
    const issue = issues[wish.key]
    const note = 'note' in conn ? conn.note : undefined
    const transitions =
      'note' in conn || issue === undefined || issue.status === undefined ? undefined : await issueTransitions($, conn, issue, false)
    const move = moveFor(wish, issue, transitions, stepId, note)
    if (move !== undefined) moves.push(move)
  }
  return moves
}

/**
 * The owner's "Mover no Jira" press, the only road to transitionJiraIssue: the transition is looked up again,
 * then approved for that one call, which the tool.call hook refuses otherwise.
 */
const pressJiraMove = async ($: EngineInterface, change: string, key: string, transitionId: string): Promise<void> => {
  const run = await loadRun($, await $.session.root())
  if (run === undefined) return
  const conn = await jiraConnection($, run)
  if ('note' in conn || conn.transition === undefined) {
    $.ui.toast(`Não movi ${key}: ${'note' in conn ? conn.note : 'o conector não oferece transitionJiraIssue.'}`)
    return
  }
  const issue = (await loadJira($, run)).issues[key]
  const transitions = issue === undefined ? undefined : await issueTransitions($, conn, issue, true)
  const hit = transitions?.find(t => t.id === transitionId)
  if (issue === undefined || hit === undefined) {
    $.ui.toast(`Não movi ${key}: essa transição não está mais disponível. O painel vai se atualizar.`)
    await refreshQuietly($)
    return
  }
  approvedMove = `${key}|${transitionId}`
  const ran = await callTool($, {
    tool: conn.transition,
    cloudId: conn.cloudId,
    issueIdOrKey: key,
    transition: { id: transitionId },
  })
    .catch(() => ({ isError: true }) as CallResult)
    .finally(() => {
      approvedMove = undefined
    })
  if (ran.isError === true || ran.deny !== undefined) {
    $.ui.toast(`O Jira recusou mover ${key}${ran.text === undefined ? '.' : `: ${ran.text.slice(0, 120)}`}`)
    return
  }
  jiraCache.delete(key)
  transitionCache.clear()
  const state = await loadFlowState($, change)
  if (state !== undefined) {
    const log = await flowFile($, change, 'ndjson')
    const prior = (await readText($, log)) ?? ''
    const note = `${key}: "${issue.status ?? '?'}" → "${hit.to ?? hit.name}" (transição "${hit.name}"), pelo clique do dono`
    const event: FlowEvent = { seq: state.seq, at: await $.clock.now(), kind: 'jira-moved', step: state.current, by: 'owner', note }
    await $.fs.write(log, `${prior}${JSON.stringify(event)}\n`)
  }
  $.ui.toast(`${key} movida para ${hit.to ?? hit.name}.`)
  await refreshQuietly($)
}

/** The one move the owner approved, while its call runs. */
let approvedMove: string | undefined

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
  const flow = await loadFlowView($, run, cwd).catch(error => {
    problems.push(describeError('flow', error))
    return undefined
  })
  const flowState = flow === undefined ? undefined : await loadFlowState($, flow.change).catch(() => undefined)
  const jiraMoves = await loadJiraMoves($, run, flowState, jira.issues).catch(error => {
    problems.push(describeError('jira', error))
    return []
  })
  const prep = flow === undefined ? undefined : await loadPrepView($, flow.change).catch(() => undefined)
  const flowTimes = flow === undefined ? undefined : await loadFlowTimes($, flow.change).catch(() => undefined)

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
    jiraMoves,
    skips,
    flow,
    prep,
    ...(flowTimes === undefined ? {} : { flowTimes }),
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
      const refusal = phaseRefusal(phase, gateViews(phase.gates, phase.id, check, skips).filter(isOpenGate), where, check.tried)
      return refusal === undefined ? [] : [refusal]
    })

const finalOpenGates = async ($: EngineInterface, run: OrchestrationRun, family: Family | undefined): Promise<GateView[]> => {
  if (run.finalGates === undefined) return []
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
  await showPane($)
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
const openSession = async ($: EngineInterface, card: SessionCard, ownId: string | undefined): Promise<void> => {
  if (ownId !== undefined && card.startedBy === ownId) {
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
const FLOW_FAILED = { result: 'Flow: the orchestrator failed to read or store the flow; nothing changed. Try again.', isError: true } as const

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

/** Every change this checkout coordinates: its published plan and its flow, either may be missing. */
const ownChanges = async (
  $: EngineInterface,
  root: string,
): Promise<{ run: OrchestrationRun | undefined; flow: FlowState | undefined }[]> => {
  const flows = (await allFlowStates($)).filter(s => ownsFlow(s, root))
  const runs = await Promise.all(flows.map(async s => readJson<OrchestrationRun>($, `${await baseDir($)}/runs/${runKey(s.change)}.json`)))
  const changes = flows.map((flow, i) => ({ run: runs[i], flow }))
  const run = await loadRun($, root)
  return run === undefined || flows.some(f => f.change === run.change) ? changes : [...changes, { run, flow: undefined }]
}

/**
 * Rigid: a fourth live phase session slows the owner's machine, so there is no way around it. Only
 * sessions with live work count; the refusal says why each one does.
 */
const refuseStart = async ($: EngineInterface): Promise<string | undefined> => {
  const { value: ownPlan = [] } = await $.state.get(PLAN)
  const { self, children } = await loadSessions($, await baseDir($), ownPlan)
  if (self === undefined) return 'the orchestrator could not read this session, so it cannot count the live phase sessions.'
  const finished = finishedSessionIds(await ownChanges($, await $.session.root()), children)
  const live = liveSessions(children, self.sessionId, self.cwd, finished)
  if (live.length < MAX_LIVE_SESSIONS) return undefined
  return (
    `${live.length} phase sessions are alive: ${live.map(l => `${l.session.name ?? l.session.title} (${l.why})`).join(', ')}; ` +
    `the ceiling is ${MAX_LIVE_SESSIONS}. A session counts only while it runs, waits on the owner or has open tasks; ` +
    'one whose phase or flow finished or whose PR merged or closed does not. Wait for one to finish, or archive one ' +
    '(its gates must have passed), before starting another.'
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

/** The head branch of the PR a merge names: the checkout's own branch when it names none. */
const mergeHead = async ($: EngineInterface, selector: string | undefined, target: MergeTarget, root: string): Promise<string | undefined> => {
  if (target.branch !== undefined) return target.branch
  const argv =
    selector === undefined
      ? ['git', '-C', root, 'branch', '--show-current']
      : ['gh', 'pr', 'view', selector, '--json', 'headRefName', '--jq', '.headRefName']
  const ran = await $.process.run(argv, { cwd: root, timeoutMs: 15_000 }).catch(() => undefined)
  const branch = ran?.exitCode === 0 ? ran.stdout.trim() : ''
  return branch === '' ? undefined : branch
}

/**
 * Whether a merge is of the change's own PR: its number is bound to a phase session, named by
 * the plan or cited by the flow's PR step, or its head branch is a phase session's or carries
 * the change id. A PR whose head branch cannot be read is taken as the change's: the gate fails
 * closed.
 */
const mergesChangePr = async (
  $: EngineInterface,
  command: string,
  run: OrchestrationRun,
  flow: FlowState | undefined,
  family: Family | undefined,
  root: string,
): Promise<boolean> => {
  const selector = mergeSelector(command)
  const target = mergeTarget(selector)
  const { numbers, branches } = changePrs(run, flow, family?.children ?? [])
  if (target.number !== undefined && numbers.has(target.number)) return true
  const head = await mergeHead($, selector, target, root)
  return head === undefined || isChangeBranch(head, run.change, branches)
}

/**
 * From an orchestrated checkout no merge goes with `--admin`. The change's own PR, while its flow
 * runs up to the step before the archive, also waits for the flow's PR review before that merge
 * and for the final gates; a finished or aborted flow holds back nothing but `--admin`.
 */
const refuseMerge = async ($: EngineInterface, command: string): Promise<string | undefined> => {
  const root = await $.session.root()
  const run = await loadRun($, root)
  if (run === undefined) return undefined
  const held: string[] = []
  const reasons: string[] = []
  if (MERGE_ADMIN.test(executedText(command))) {
    held.push('--admin')
    reasons.push('`--admin` skips the branch protection (GitHub approval and green CI); merge without it, never around them.')
  }
  const flow = await loadFlowState($, run.change)
  const family = await loadFamily($)
  if ((flow === undefined || mergeWindow(flow)) && (await mergesChangePr($, command, run, flow, family, root))) {
    const review = flow === undefined ? undefined : pendingReview(flow)
    if (review !== undefined) {
      held.push(review.id)
      const press = Object.values(review.outcomes)[0]?.label ?? review.id
      reasons.push(
        `the PR review "${review.id}" (${review.title}) of ${run.change} is not answered yet: the owner approves the PR ` +
          `on GitHub and presses "${press}" in the panel before it merges.`,
      )
    }
    const open = run.finalGates === undefined ? [] : await finalOpenGates($, run, family)
    if (open.length > 0) {
      held.push(...open.map(v => v.gate))
      reasons.push(
        `final gates of ${run.change} not passed: ${open.map(v => `${v.gate} (${v.state})`).join(', ')}. ` +
          'Run them once on the integrated code; only the owner can skip one, from the panel.',
      )
    }
  }
  if (reasons.length === 0) return undefined
  await logGateEvent($, run.change, { kind: 'refused', action: 'merge', gates: held })
  return `${reasons.join(' ')} (Only a merge of ${run.change}'s own PR waits for the review and the gates, until its flow reaches the archive.)`
}

/**
 * Edits to prose or outside the checkout (evidence.md, notes, scratch files) do not unprove a gate,
 * nor do the change folders' own files (`.openspec.yaml` beside the proposal).
 */
const editsCode = (path: unknown, root: string): boolean =>
  typeof path === 'string' && path.startsWith(`${root}/`) && !path.endsWith('.md') && !path.includes('/openspec/changes/')

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
  let attempt: GateAttempt | undefined
  if (tool === 'Bash') {
    const out = (failed ? undefined : ran.result) as BashOutput | undefined
    if (out?.backgroundTaskId !== undefined || out?.interrupted === true || input.run_in_background === true) return
    // `openspec archive` only moves the change folder and merges its spec deltas: no code changed
    const archive = ARCHIVE_COMMAND.test(executedText(String(input.command ?? '')))
    edited = !archive && (out?.bashEditDiff?.files ?? []).some(f => editsCode(f.filePath, root))
    ;({ records: observed, attempt } = classifyBash(String(input.command ?? ''), failed, now))
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
  if (attempt !== undefined) {
    const { value: tried = [] } = await $.state.get(TRIED)
    await $.state.set(TRIED, keepAttempt(tried, attempt))
  }
}

/** Calls whose guard must hold even when the mod itself fails: refused, never let through. */
const isGuarded = (tool: string, input: Record<string, unknown>): boolean =>
  tool === PLAN_TOOL ||
  tool === FLOW_TOOL ||
  tool === START_SESSION ||
  tool === ARCHIVE_SESSION ||
  tool.endsWith(TRANSITION_SUFFIX) ||
  (tool === 'Bash' && typeof input.command === 'string' && GH_MERGE.test(input.command))

const FLOW_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'start', 'status', 'report', 'round', 'mockup', 'close', 'note'],
      description:
        'list: the flows on offer. start: begin a flow for a change. status: where the change stands and who ' +
        'answers the current step. report: the outcome of the current session step. round: record one ' +
        'grill round (questions and the owner\'s answers) while the flow is on the grill. mockup: attach the ' +
        'mockup the owner reviews while the flow is on the mockup. close: during the phase loop, ' +
        'close `phase` once its gates passed, its tasks are ticked in tasks.md and its work is committed; the mod ' +
        'archives its session and ends the loop when every phase is closed (without `phase`, it only checks that). ' +
        'note: leave `note` for the owner step that waits (e.g. what QA asked); it joins the owner\'s answer.',
    },
    phase: { type: 'string', description: 'close: the phase id, as in the published plan (e.g. "4.6") or a tasks.md section number.' },
    change: {
      type: 'string',
      description: 'Change id. Optional for status/report when this coordinator runs a single flow.',
    },
    flow: { type: 'string', description: 'start: the flow id, e.g. "completo" or "rapido".' },
    visual: { type: 'boolean', description: 'start: the change alters what the user sees (enables the mockup step).' },
    changePath: { type: 'string', description: 'start: path to the change folder (holds evidence.md).' },
    step: { type: 'string', description: 'report: the id of the step being reported; must be the current step.' },
    outcome: { type: 'string', description: 'report: one of the outcomes the step declares.' },
    note: { type: 'string', description: 'report/note: one line on what was done, or the note for the owner step (pt-BR).' },
    questions: {
      type: 'array',
      description:
        'round: the round\'s questions (pt-BR), each with the owner\'s answer once given and, optionally, the ' +
        'acceptance criterion the answer becomes.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          criterion: { type: 'string' },
        },
        required: ['question'],
      },
    },
    amend: { type: 'boolean', description: 'round: merge into the latest round (fill answers) instead of adding one.' },
    artifact: { type: 'string', description: 'mockup: the mockup\'s Artifact URL or file path.' },
  },
  required: ['action'],
}

const flowsDir = async ($: EngineInterface): Promise<string> => `${await baseDir($)}/flows`

/** Every flow file of one folder as read, the ones that are not JSON named in `problems`. */
const readFlowDir = async ($: EngineInterface, dir: string): Promise<{ files: FlowSource[]; problems: string[] }> => {
  if (!(await $.fs.exists(dir))) return { files: [], problems: [] }
  const entries = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const files: FlowSource[] = []
  const problems: string[] = []
  for (const file of entries) {
    try {
      files.push({ source: `${dir}/${file.name}`, raw: JSON.parse(await $.fs.read(`${dir}/${file.name}`)) })
    } catch {
      problems.push(`${dir}/${file.name}: not valid JSON.`)
    }
  }
  return { files, problems }
}

/**
 * The mod's default flows, then the project's own in `<repo>/.orquestrador/flows`, which win by id;
 * a project flow derived from another is resolved, and one that does not resolve is named in `problems`.
 */
const loadFlows = async (
  $: EngineInterface,
): Promise<{ flows: Record<string, FlowDef>; problems: string[]; projectIds: Set<string> }> => {
  const read = await readFlowDir($, `${await $.session.root()}/.orquestrador/flows`)
  const project = resolveProjectFlows(DEFAULT_FLOWS, read.files)
  return {
    flows: mergeFlows(defaultFlows(), project.flows),
    problems: [...read.problems, ...project.problems],
    projectIds: new Set(project.flows.map(f => f.id)),
  }
}

/** A step's agent: the project's `.orquestrador/agents/<name>.md` wins over the plugin's `agents/<name>.md`. */
const findAgent = async ($: EngineInterface, name: string): Promise<AgentFound> => {
  const project = `${await $.session.root()}/.orquestrador/agents/${name}.md`
  if (await $.fs.exists(project)) return { source: 'project', path: project }
  const plugin = `${$.plugin.root}/agents/${name}.md`
  return (await $.fs.exists(plugin)) ? { source: 'plugin', path: plugin } : undefined
}

/** What the current step's agent, model, effort and details say, for the status of a running flow. */
const describeAgent = async ($: EngineInterface, state: FlowState): Promise<string | undefined> => {
  if (state.status !== 'running') return undefined
  const step = state.flow.steps.find(s => s.id === state.current)
  if (step === undefined) return undefined
  return describeStepAgent(step, step.agent === undefined ? undefined : await findAgent($, step.agent))
}

const flowFile = async ($: EngineInterface, change: string, ext: 'json' | 'ndjson'): Promise<string> =>
  `${await flowsDir($)}/${runKey(change)}.${ext}`

const loadFlowState = async ($: EngineInterface, change: string): Promise<FlowState | undefined> =>
  readJson<FlowState>($, await flowFile($, change, 'json'))

const allFlowStates = async ($: EngineInterface): Promise<FlowState[]> => {
  const dir = await flowsDir($)
  if (!(await $.fs.exists(dir))) return []
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const states = await Promise.all(files.map(f => readJson<FlowState>($, `${dir}/${f.name}`)))
  return states.filter((s): s is FlowState => s !== undefined && typeof s.change === 'string')
}

/** The state file and its append-only log, both written by the mod alone. */
const saveFlow = async ($: EngineInterface, state: FlowState, events: readonly FlowEvent[]): Promise<void> => {
  await $.fs.write(await flowFile($, state.change, 'json'), JSON.stringify(state))
  const log = await flowFile($, state.change, 'ndjson')
  const prior = (await readText($, log)) ?? ''
  await $.fs.write(log, prior + events.map(e => `${JSON.stringify(e)}\n`).join(''))
}

const logFlowRefusal = async ($: EngineInterface, state: FlowState, step: string, by: FlowEvent['by'], note: string): Promise<void> => {
  const log = await flowFile($, state.change, 'ndjson')
  const prior = (await readText($, log)) ?? ''
  const event: FlowEvent = { seq: state.seq, at: await $.clock.now(), kind: 'refused', step, by, note }
  await $.fs.write(log, `${prior}${JSON.stringify(event)}\n`)
}

/** A flow belongs to the coordinator's checkout and to every worktree under it. */
const ownsFlow = (state: FlowState, root: string): boolean =>
  root === state.coordinatorCwd || root.startsWith(`${state.coordinatorCwd}/`)

/** The flow this session works on: the named change, else the one flow its checkout runs. */
const pickFlow = async ($: EngineInterface, change: unknown): Promise<FlowState | { error: string }> => {
  if (typeof change === 'string' && change.trim() !== '') {
    return (await loadFlowState($, change.trim())) ?? { error: `no flow was started for ${change}; start one with action "start".` }
  }
  const root = await $.session.root()
  const mine = (await allFlowStates($)).filter(s => ownsFlow(s, root) && s.status !== 'done' && s.status !== 'aborted')
  if (mine.length === 1) return mine[0]!
  return mine.length === 0
    ? { error: 'no flow is running for this checkout; start one with action "start".' }
    : { error: `several flows run here (${mine.map(s => s.change).join(', ')}); name the change.` }
}

type FlowReply = ToolCallResult<string>
const flowError = (why: string): FlowReply => ({ result: `Flow: ${why}`, isError: true as const })

const handleFlowTool = async ($: EngineInterface, input: Record<string, unknown>): Promise<FlowReply> => {
  const action = input.action
  if (action === 'list') {
    const { flows, problems, projectIds } = await loadFlows($)
    const blocks = Object.values(flows).map(f => describeWorkflow(f, projectIds.has(f.id) ? 'project' : 'default'))
    return { result: [...blocks, ...problems.map(p => `ignored: ${p}`)].join('\n') }
  }
  if (action === 'start') {
    const change = typeof input.change === 'string' ? input.change.trim() : ''
    if (change === '') return flowError('`change` is required to start a flow.')
    const { flows, problems } = await loadFlows($)
    const flow = typeof input.flow === 'string' ? flows[input.flow] : undefined
    if (flow === undefined) {
      return flowError(
        `unknown flow "${String(input.flow)}"; choose one of ${Object.keys(flows).join(', ') || DEFAULT_FLOW_IDS.join(', ')}.` +
          (problems.length > 0 ? ` Ignored files: ${problems.join(' ')}` : ''),
      )
    }
    const existing = await loadFlowState($, change)
    if (existing !== undefined && existing.status !== 'done' && existing.status !== 'aborted') {
      return flowError(`${change} already runs flow ${existing.flow.id}. ${describeFlow(existing)}`)
    }
    const started = startFlow(
      flow,
      {
        change,
        coordinatorCwd: await $.session.root(),
        ...(typeof input.changePath === 'string' ? { changePath: input.changePath } : {}),
        visual: input.visual === true,
      },
      await $.clock.now(),
    )
    await saveFlow($, started.state, started.events)
    await refreshQuietly($)
    return { result: `Started. ${await describeWithPrep($, started.state)}` }
  }
  const picked = await pickFlow($, input.change)
  if ('error' in picked) return flowError(picked.error)
  if (action === 'status') return { result: await describeWithPrep($, picked) }
  if (action === 'round' || action === 'mockup') return handlePrepAction($, picked, input)
  if (action === 'close') return closeLoopPhase($, picked, input.phase)
  if (action === 'note') {
    if (typeof input.note !== 'string' || input.note.trim() === '') return flowError('`note` is required.')
    const noted = noteOwnerStep(picked, input.note.trim(), await $.clock.now())
    if ('error' in noted) return flowError(`refused: ${noted.error}`)
    await saveFlow($, noted.state, noted.events)
    return { result: `Note kept for the owner's answer. ${describeFlow(noted.state)}` }
  }
  if (action !== 'report') return flowError('action must be list, start, status, report, round, mockup, close or note.')
  if (typeof input.step !== 'string' || typeof input.outcome !== 'string') {
    return flowError('`step` and `outcome` are required to report.')
  }
  const moved = applyOutcome(
    picked,
    { step: input.step, outcome: input.outcome, by: 'session', ...(typeof input.note === 'string' ? { note: input.note } : {}) },
    await $.clock.now(),
  )
  if ('error' in moved) {
    await logFlowRefusal($, picked, input.step, 'session', moved.error)
    return flowError(`refused: ${moved.error}`)
  }
  await saveFlow($, moved.state, moved.events)
  await refreshQuietly($)
  return { result: `Recorded ${input.step} → ${input.outcome}. ${await describeWithPrep($, moved.state)}` }
}

/** The change's tasks.md, read from the coordinator's checkout. */
const changeTasks = async ($: EngineInterface, state: FlowState): Promise<string | undefined> => {
  if (state.changePath === undefined) return undefined
  const home = (await $.env.get('HOME')) ?? ''
  return readText($, `${changeDir(state.changePath.replace(/^~(?=\/)/, home), state.coordinatorCwd)}/tasks.md`)
}

/** The uncommitted paths of a checkout; undefined when git cannot tell (no repo, no folder). */
const dirtyPaths = async ($: EngineInterface, cwd: string): Promise<string[] | undefined> => {
  const ran = await $.process.run(['git', '-C', cwd, 'status', '--porcelain'], { timeoutMs: 10_000 }).catch(() => undefined)
  return ran?.exitCode === 0 ? uncommitted(ran.stdout) : undefined
}

const dirtyReason = (label: string, cwd: string, dirty: string[] | undefined): string | undefined =>
  dirty === undefined
    ? `git could not read the checkout of session "${label}" (${cwd}), so the mod cannot tell its work is committed.`
    : dirty.length === 0
      ? undefined
      : `session "${label}" has uncommitted changes in ${cwd} (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? '…' : ''}); ` +
        'commit them in that session first.'

const archiveSession = async ($: EngineInterface, sessionId: string, reason: string): Promise<string | undefined> => {
  const ran = await callTool($, { tool: ARCHIVE_SESSION, session_id: sessionId, reason }).catch(
    error => ({ isError: true, text: describeError('archive', error) }) as CallResult,
  )
  return ran.deny ?? (ran.isError === true ? (ran.text ?? 'archive failed').slice(0, 160) : undefined)
}

/**
 * The executar loop: a phase closes only when its gates passed, its tasks are ticked and its
 * session's work is committed; the mod then archives that session. Once every phase is closed the
 * mod ends the loop itself: no session reports it.
 */
const closeLoopPhase = async ($: EngineInterface, state: FlowState, phase: unknown): Promise<FlowReply> => {
  const refusal = loopRefusal(state)
  if (refusal !== undefined) {
    await logFlowRefusal($, state, state.current, 'session', refusal)
    return flowError(`refused: ${refusal}`)
  }
  const run = await readJson<OrchestrationRun>($, `${await baseDir($)}/runs/${runKey(state.change)}.json`)
  const units = loopUnits(run, await changeTasks($, state))
  let moved: Moved = { state, events: [] }
  let closedNow = ''
  if (typeof phase === 'string' && phase.trim() !== '') {
    const unit = units.find(u => u.id === phase.trim())
    if (unit === undefined) {
      return flowError(`no phase "${phase.trim()}"; the phases are ${units.map(u => u.id).join(', ') || 'none'}.`)
    }
    if (!isClosed(state, unit)) {
      const family = await loadFamily($)
      const card = run === undefined ? undefined : phaseViews(run, family?.children ?? []).flat().find(p => p.id === unit.id)?.card
      const own = unit.session === undefined
      const check = own ? await ownCheck($) : (card?.gates ?? { records: {}, editedAt: undefined })
      const where = own ? 'this session' : card === undefined ? `session "${unit.session}" (not found)` : `session "${card.title}"`
      const skips = await loadSkips($, state.change)
      const label = card?.name ?? card?.title
      const why =
        unitRefusal(unit, gateViews(unit.gates, unit.id, check, skips).filter(isOpenGate), where, check.tried) ??
        (card === undefined || card.isArchived ? undefined : dirtyReason(label ?? card.sessionId, card.cwd, await dirtyPaths($, card.cwd)))
      if (why !== undefined) {
        await logFlowRefusal($, state, state.current, 'session', why)
        return flowError(`refused: ${why}`)
      }
      const failure =
        card === undefined || card.isArchived ? undefined : await archiveSession($, card.sessionId, `Fase ${unit.id} fechada`)
      moved = closePhase(
        state,
        unit,
        { session: label, archived: card !== undefined && failure === undefined, ...(failure === undefined ? {} : { note: failure }) },
        await $.clock.now(),
      )
      closedNow =
        `Phase ${unit.id} closed` +
        (card === undefined ? '' : failure === undefined ? `, session "${label}" archived` : `; its session was not archived: ${failure}`) +
        '. '
    }
  }
  const finished = finishLoop(moved.state, units, await $.clock.now())
  if ('error' in finished) {
    await saveFlow($, moved.state, moved.events)
    return flowError(`${closedNow}${finished.error}`)
  }
  if ('open' in finished) {
    await saveFlow($, moved.state, moved.events)
    await refreshQuietly($)
    return { result: `${closedNow}Still open: ${finished.open.map(u => `${u.id} (${u.title})`).join(', ')}.` }
  }
  await saveFlow($, finished.state, [...moved.events, ...finished.events])
  await refreshQuietly($)
  return { result: `${closedNow}Every phase is closed. ${describeFlow(finished.state)}` }
}

/**
 * The end of a change: archive the phase sessions left in its sidebar group (only those whose
 * work is committed) and remove the group. Each step is logged; a failure never blocks the flow.
 */
const cleanupChange = async ($: EngineInterface, state: FlowState): Promise<Omit<FlowEvent, 'seq'>[]> => {
  const at = await $.clock.now()
  const ev = (kind: FlowEvent['kind'], note: string): Omit<FlowEvent, 'seq'> => ({ at, kind, step: state.current, by: 'mod', note })
  const name = groupName(state.change)
  try {
    if (!(await canCall($, LIST_GROUPS))) return [ev('cleanup', 'sidebar unavailable: sessions and group left as they are')]
    const groupId = findGroupId((await callTool($, { tool: LIST_GROUPS })).text, name)
    if (groupId === undefined) return [ev('cleanup', `no sidebar group ${name}`)]
    const [self] = parseSessionRows((await callTool($, { tool: GET_SESSION, session_id: 'self' })).text)
    const rows = parseSessionRows((await callTool($, { tool: LIST_SESSIONS, group: groupId, limit: 50 })).text)
    const events: Omit<FlowEvent, 'seq'>[] = []
    for (const row of phaseSessions(rows, self?.sessionId, state.coordinatorCwd)) {
      const label = row.name ?? row.title
      const dirty = dirtyReason(label, row.cwd, await dirtyPaths($, row.cwd))
      const failure = dirty ?? (await archiveSession($, row.sessionId, `Change ${state.change} arquivada`))
      events.push(ev('session-archived', failure === undefined ? label : `${label} not archived — ${failure}`))
    }
    const removed = await callTool($, { tool: DELETE_GROUP, group_id: groupId }).catch(() => ({ isError: true }) as CallResult)
    const ok = removed.isError !== true && removed.deny === undefined
    events.push(ev('cleanup', ok ? `sidebar group ${name} removed` : `sidebar group ${name} not removed: ${removed.deny ?? removed.text ?? 'failed'}`))
    return events
  } catch (error) {
    return [ev('cleanup', describeError('cleanup', error))]
  }
}

const EVIDENCE_OK = new Set(['recorded', 'green'])

/** Whether evidence.md of the flow's change is filled in; a flow with no change folder has none. */
const hasEvidence = async ($: EngineInterface, state: FlowState): Promise<boolean> => {
  if (state.changePath === undefined) return false
  const home = (await $.env.get('HOME')) ?? ''
  const dir = changeDir(state.changePath.replace(/^~(?=\/)/, home), state.coordinatorCwd)
  const evidence = await readText($, `${dir}/evidence.md`)
  return EVIDENCE_OK.has(openSpecView({ tasks: undefined, proposal: undefined, evidence }).evidence)
}


/** An automatic step moves only when the mod itself sees its command finish, never on a session's word. */
const observeFlows = async ($: EngineInterface, command: string, failed: boolean): Promise<void> => {
  const root = await $.session.root()
  for (const state of await allFlowStates($)) {
    if (state.status !== 'running' || !ownsFlow(state, root)) continue
    const step = currentStep(state)
    if (step === undefined) continue
    if (step.deploy !== undefined) {
      const seen = observeDeploy(state, command, failed, await $.clock.now())
      if (seen === undefined) continue
      if ('error' in seen) {
        await logFlowRefusal($, state, step.id, 'detect', seen.error)
        $.ui.toast(`Flow ${state.change}: ${step.title} não contou o comando — ${seen.error}`)
        continue
      }
      await saveFlow($, seen.state, seen.events)
      const word = seen.events.some(e => e.outcome === 'falhou')
        ? 'falhou'
        : seen.state.current === step.id
          ? 'parte do deploy vista'
          : 'deploy concluído'
      $.ui.toast(`Flow ${state.change}: ${step.title} — ${word}.`)
      continue
    }
    const detected = detectedOutcome(step, command, failed)
    if (detected !== undefined) {
      const seen = applyOutcome(
        state,
        { step: step.id, outcome: detected, by: 'detect', note: executedTextShort(command) },
        await $.clock.now(),
      )
      if ('error' in seen) continue
      await saveFlow($, seen.state, seen.events)
      $.ui.toast(`Flow ${state.change}: vi o deploy — ${step.outcomes[detected]?.label ?? detected}.`)
      continue
    }
    const outcome = automaticOutcome(step, command, failed)
    if (outcome === undefined) continue
    if (outcome === 'passou' && step.requiresEvidence && !(await hasEvidence($, state))) {
      await logFlowRefusal($, state, step.id, 'automatic', 'passed, but evidence.md is not recorded')
      $.ui.toast(`Flow ${state.change}: ${step.title} passou, mas o evidence.md ainda não foi preenchido.`)
      continue
    }
    const moved = applyOutcome(state, { step: step.id, outcome, by: 'automatic' }, await $.clock.now())
    if ('error' in moved) continue
    const final = step.cleanup && outcome === 'passou' ? withEvents(moved, await cleanupChange($, state)) : moved
    await saveFlow($, final.state, final.events)
  }
}

/**
 * Only the panel's press reaches this: no tool call answers an owner step. When the flow lands on a
 * step the coordinator drives, the press also wakes it with a message in the mod's name.
 */
const pressFlow = async ($: EngineInterface, change: string, step: string, outcome: string, note?: string): Promise<void> => {
  const state = await loadFlowState($, change)
  if (state === undefined) return
  const running = state.status === 'running' && state.current === step
  if (running && step === RELEASE_STEP && outcome === RELEASE_OUTCOME) {
    $.ui.toast('A liberação vem do plan mode: aprove o plano de execução no diálogo do app.')
    return
  }
  const at = await $.clock.now()
  const prep = running && step === MOCKUP_STEP ? pressMockup(await loadPrep($, change), outcome, note, at) : undefined
  if (prep !== undefined && 'error' in prep) {
    $.ui.toast(`Não consegui registrar: ${prep.error}`)
    return
  }
  const noted = note === undefined || note.trim() === '' ? undefined : note.trim()
  const moved = ownerPress(state, step, outcome, at, noted)
  if ('error' in moved) {
    $.ui.toast(`Não consegui registrar: ${moved.error}`)
    return
  }
  if (prep !== undefined) await savePrep($, state, prep, undefined)
  await saveFlow($, moved.state, moved.events)
  await refreshQuietly($)
  $.ui.toast(pressedToast(state, moved.state, step, outcome))
  const wake = wakePrompt(state, moved.state, step, outcome, noted)
  if (wake !== undefined) await $.prompt.submit({ text: wake })
}

/**
 * The owner's answers typed in the panel: recorded in the latest grill round (grill.md and the
 * acceptance criteria follow), then sent to this session as the owner's own message.
 */
const answerGrill = async ($: EngineInterface, change: string, answers: readonly GrillAnswer[]): Promise<void> => {
  const state = await loadFlowState($, change)
  if (state === undefined) return
  const done = ownerAnswers(await loadPrep($, change), state, answers, await $.clock.now())
  if ('error' in done) {
    $.ui.toast(`Não consegui registrar: ${done.error}`)
    return
  }
  const sent = answers.filter(a => a.answer.trim() !== '')
  await savePrep($, state, done.prep, done.event)
  await update($, GRILL_DRAFTS, drafts => {
    const left = { ...(drafts ?? {}) }
    for (const a of sent) delete left[a.question]
    return left
  })
  await refreshQuietly($)
  await $.prompt.submit({ text: answersPrompt(sent), asUser: true })
}

/** When each step of a change's flow was entered and answered, from its log. */
const loadFlowTimes = async ($: EngineInterface, change: string) =>
  stepTimes(parseEvents(await readText($, await flowFile($, change, 'ndjson'))))

/** Opens the pane and remembers it is up, so the band's button offers to close it. */
const showPane = async ($: EngineInterface): Promise<boolean> => {
  const opened = await $.ui.open({ id: PANE, title: '🧭 Orquestrador' })
  await $.state.set(PANE_OPEN, true)
  return opened.isPlaced
}

/** `/orquestrador` and the band's button: close the pane when it is up, else open it. */
const togglePane = async ($: EngineInterface): Promise<'opened' | 'waiting' | 'closed'> => {
  const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (isUp) {
    await $.ui.close({ id: PANE })
    await $.state.set(PANE_OPEN, false)
    return 'closed'
  }
  await refreshQuietly($)
  return (await showPane($)) ? 'opened' : 'waiting'
}

/** The flow the panel shows: the published plan's change, else the latest flow of this checkout. */
const loadFlowView = async ($: EngineInterface, run: OrchestrationRun | undefined, cwd: string): Promise<FlowView | undefined> => {
  const state =
    run === undefined
      ? (await allFlowStates($)).filter(s => s.coordinatorCwd === cwd).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      : await loadFlowState($, run.change)
  return state === undefined ? undefined : flowView(state)
}

const prepFile = async ($: EngineInterface, change: string): Promise<string> =>
  `${await baseDir($)}/prep/${runKey(change)}.json`

const loadPrep = async ($: EngineInterface, change: string): Promise<PrepState> =>
  (await readJson<PrepState>($, await prepFile($, change))) ?? emptyPrep(change)

const loadPrepView = async ($: EngineInterface, change: string): Promise<PrepView> => prepView(await loadPrep($, change))

/** The prep file, one event in the flow's log, and grill.md in the change folder when the flow has one. */
const savePrep = async (
  $: EngineInterface,
  state: FlowState,
  prep: PrepState,
  event: Pick<FlowEvent, 'kind' | 'step' | 'by' | 'note'> | undefined,
): Promise<void> => {
  await $.fs.write(await prepFile($, state.change), JSON.stringify(prep))
  if (event !== undefined) {
    const log = await flowFile($, state.change, 'ndjson')
    const prior = (await readText($, log)) ?? ''
    await $.fs.write(log, `${prior}${JSON.stringify({ seq: state.seq, at: await $.clock.now(), ...event })}\n`)
  }
  if (event?.kind === 'round' && state.changePath !== undefined) {
    const home = (await $.env.get('HOME')) ?? ''
    const dir = changeDir(state.changePath.replace(/^~(?=\/)/, home), state.coordinatorCwd)
    await $.fs.write(`${dir}/grill.md`, grillMarkdown(prep))
  }
}

/** A grill round or a mockup, sent by the coordinator; neither answers an owner step. */
const handlePrepAction = async ($: EngineInterface, state: FlowState, input: Record<string, unknown>): Promise<FlowReply> => {
  const prep = await loadPrep($, state.change)
  const at = await $.clock.now()
  let done: ReturnType<typeof attachMockup>
  if (input.action === 'round') {
    const items = parseRoundItems(input.questions)
    if ('error' in items) return flowError(items.error)
    done = recordRound(prep, state, items, input.amend === true, at)
  } else {
    done = attachMockup(prep, state, input.artifact, at)
  }
  if ('error' in done) {
    await logFlowRefusal($, state, String(input.action), 'session', done.error)
    return flowError(`refused: ${done.error}`)
  }
  await savePrep($, state, done.prep, done.event)
  await refreshQuietly($)
  return { result: `Recorded. ${describePrep(state, done.prep) ?? describeFlow(state)}` }
}

/** Where the flow stands, with what the pre-execution step gathered so far. */
const describeWithPrep = async ($: EngineInterface, state: FlowState): Promise<string> => {
  const prep = describePrep(state, await loadPrep($, state.change))
  const base = prep === undefined ? describeFlow(state) : `${describeFlow(state)} ${prep}`
  const agent = await describeAgent($, state)
  return agent === undefined ? base : `${base}\n${agent}`
}

/**
 * The owner's release: the coordinator's ExitPlanMode, answered by the owner in the app's own plan
 * dialog. Approved, the release step takes its outcome in the owner's name; refused, the flow stays
 * and the owner's words are kept for the next plan.
 */
const observeRelease = async ($: EngineInterface, input: Record<string, unknown>, ran: CallResult): Promise<void> => {
  const verdict = planVerdict(input, ran as unknown as Parameters<typeof planVerdict>[1])
  if (verdict === undefined) return
  const root = await $.session.root()
  const waiting = (await allFlowStates($)).filter(
    s => s.status === 'running' && s.current === RELEASE_STEP && ownsFlow(s, root),
  )
  if (waiting.length !== 1) {
    if (waiting.length > 1) $.ui.toast('Vários flows esperam a liberação; aprovação do plano não registrada.')
    return
  }
  const state = waiting[0]!
  const prep = await loadPrep($, state.change)
  const at = await $.clock.now()
  if (!verdict.approved) {
    const rejected = rejectPlan(prep, verdict.feedback, at)
    await savePrep($, state, rejected.prep, rejected.event)
    await refreshQuietly($)
    return
  }
  const moved = applyOutcome(state, { step: RELEASE_STEP, outcome: RELEASE_OUTCOME, by: 'owner', note: 'aprovado no plan mode' }, at)
  if ('error' in moved) {
    await logFlowRefusal($, state, RELEASE_STEP, 'owner', moved.error)
    return
  }
  await savePrep($, state, approvePlan(prep, verdict, at), undefined)
  await saveFlow($, moved.state, moved.events)
  await refreshQuietly($)
}

/**
 * Whether the file a copy from before 0.7.1 keyed by this folder can only be this session's:
 * no other live session of the family works in the same folder.
 */
const folderIsOwn = async ($: EngineInterface, sessionId: string | undefined, cwd: string): Promise<boolean> => {
  if (sessionId === undefined) return true
  if (!(await canCall($, LIST_SESSIONS))) return false
  // a family past 50 live sessions is far above the ceiling of 3 phases; the panel reads the same page
  const family = parseSessionRows((await callTool($, { tool: LIST_SESSIONS, linked: true, limit: 50 })).text)
  return !family.some(row => !row.isArchived && row.sessionId !== sessionId && row.cwd === cwd)
}

/**
 * An app restart empties the session's state; what the session already proved lives on in
 * its activity file. Put back the task list, the gate passes and the last edit before
 * anything publishes over that file, so a restart never undoes a passed gate.
 */
const restoreActivity = async ($: EngineInterface): Promise<void> => {
  const cwd = await $.session.root()
  const sessionId = await selfId($).catch(() => undefined)
  const own = sessionId === undefined ? undefined : await readJson<ActivityRecord>($, await activityPath($, sessionId, cwd))
  const record = own ?? ((await folderIsOwn($, sessionId, cwd)) ? await readJson<ActivityRecord>($, await activityPath($, undefined, cwd)) : undefined)
  if (record === undefined || record.cwd !== cwd || (record.sessionId ?? sessionId) !== sessionId) return
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
      description: 'Abre ou fecha o painel da orquestração: OpenSpec, gates, pendências e tarefas',
    })
    await $.tool.register({
      name: 'plano',
      description:
        'Publishes the orchestration plan of a change to the orchestrator side panel: waves, phases ' +
        '(icon, tasks, status, session doing it, dependencies, one-line note) and the decisions pending ' +
        'on the owner. Send the whole plan each time a phase changes state; it replaces the previous one.',
      inputSchema: PLAN_SCHEMA,
    })
    await $.tool.register({
      name: 'flow',
      description:
        'The declared flow a change follows (e.g. completo, rapido). Start a flow for a change, read the current ' +
        'step and who answers it, and report the outcome of a session or loop step. Steps cannot be skipped: ' +
        'owner steps are answered only by the owner in the panel, automatic steps only by the mod watching their ' +
        'command run, and only outcomes the step declares are accepted.',
      inputSchema: FLOW_SCHEMA,
    })
    $.clock.every(REFRESH_MS, () => void refreshQuietly($))
    void refreshQuietly($).then(async () => {
      const { value } = await $.state.get(VIEW)
      if (value?.run !== undefined) await showPane($)
    })
    return next(e)
  })

  on('command.run', { command: 'orquestrador' }, async $ => {
    const done = await togglePane($)
    return {
      text:
        done === 'closed'
          ? 'Painel do orquestrador fechado.'
          : done === 'opened'
            ? 'Painel do orquestrador aberto.'
            : 'Painel pronto; amplie a janela para vê-lo.',
    }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await $.state.set(PANE_OPEN, false)
    return closed
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: view } = await $.state.get(VIEW)
    const { value: answered = [] } = await $.state.get(ANSWERED)
    const summary = view === undefined ? undefined : bandSummary(view, answered)
    if (summary === undefined) return next(e)
    const { value: paneOpen = false } = await $.state.get(PANE_OPEN)
    const { Box, Text, Button } = $.ui.resolve(e)
    return renderBand({ Box, Text, Button }, summary, paneOpen, () => {
      void togglePane($).catch(() => $.ui.toast('Não consegui abrir ou fechar o painel.'))
    })
  })

  on('tool.call', async ($, e, next) => {
    const tool = e.tool as string
    if (tool === PLAN_TOOL) return publishPlan($, e as unknown as Record<string, unknown>)
    if (tool === FLOW_TOOL) return handleFlowTool($, e as unknown as Record<string, unknown>)
    const input = e as unknown as Record<string, unknown>
    if (touchesGateFiles(tool, input)) {
      return { deny: 'Orchestrator: ~/.claude/orquestrador is written by the mod only (gate records and owner skips).' }
    }
    if (tool.endsWith(TRANSITION_SUFFIX) && approvedMove !== `${String(input.issueIdOrKey)}|${String((input.transition as { id?: unknown } | undefined)?.id)}`) {
      return { deny: 'Orchestrator: a Jira issue moves only when the owner presses "Mover no Jira" in the panel.' }
    }
    const refusal =
      tool === START_SESSION
        ? await refuseStart($)
        : tool === ARCHIVE_SESSION
          ? await refuseArchive($, input.session_id)
          : tool === 'Bash' && typeof input.command === 'string' && GH_MERGE.test(input.command)
            ? await refuseMerge($, input.command)
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
    if (tool === 'Bash' && ran.deny === undefined && typeof input.command === 'string' && input.run_in_background !== true) {
      await observeFlows($, input.command, ran.isError === true).catch(error =>
        $.ui.log(`orquestrador: ${describeError('flow', error)}`),
      )
    }
    if (tool === 'ExitPlanMode') {
      await observeRelease($, input, ran).catch(error => $.ui.log(`orquestrador: ${describeError('liberação', error)}`))
    }
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
    if (tool === FLOW_TOOL) return FLOW_FAILED
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
    const { value: drafts = {} } = await $.state.get(GRILL_DRAFTS)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const ownId = view.self?.sessionId
    return renderPane({ Box, Text, Button, Link, Svg, Input }, view, ownPlan, {
      collapsed,
      answered,
      canOpenBeside: card => ownId !== undefined && card.startedBy === ownId,
      toggle: (id, byDefault) => () => {
        void update($, COLLAPSED, map => ({ ...map, [id]: !(map?.[id] ?? !byDefault) }))
      },
      openBeside: card => () => {
        void openSession($, card, ownId)
      },
      skip: (gate: GateView) => () => {
        const change = view.run?.change ?? view.flow?.change
        if (change === undefined) {
          $.ui.toast('Não consegui registrar o pulo: o painel ainda não carregou a change. Tente de novo em alguns segundos.')
          return
        }
        void skipGate($, change, gate)
          .then(() => refreshQuietly($))
          .then(() => $.ui.toast(`Portão ${gate.label} pulado por decisão sua.`))
          .catch(() => $.ui.toast('Não consegui registrar o pulo do portão.'))
      },
      answerFlow: (change, step, outcome) => () => {
        void pressFlow($, change, step, outcome).catch(() => $.ui.toast('Não consegui registrar sua resposta ao flow.'))
      },
      noteFlow: (change, step, outcome) => (value: string) => {
        if (value.trim() === '') {
          $.ui.toast('Escreva o que ajustar antes de enviar.')
          return
        }
        void pressFlow($, change, step, outcome, value).catch(() => $.ui.toast('Não consegui registrar sua resposta ao flow.'))
      },
      drafts,
      draftAnswer: question => (value: string) => {
        void update($, GRILL_DRAFTS, map => ({ ...(map ?? {}), [question]: value }))
      },
      answerGrill: (change, answers) => () => {
        if (answers.every(a => a.answer.trim() === '')) {
          $.ui.toast('Escreva a resposta antes de enviar.')
          return
        }
        void answerGrill($, change, answers).catch(() => $.ui.toast('Não consegui registrar sua resposta ao grill.'))
      },
      moveJira: (change, key, transitionId) => () => {
        void pressJiraMove($, change, key, transitionId).catch(() => $.ui.toast(`Não consegui mover ${key} no Jira.`))
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
