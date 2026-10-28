import { update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type {
  ActivationLevel,
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
  Languages,
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
  MAX_LIVE_SESSIONS,
  PROTECTED_DIR,
  familyCheck,
  gateViews,
  isOpenGate,
  liveSessions,
  isChangeBranch,
  mergeCalls,
  opaqueMerge,
  mergeTarget,
  mergeWindow,
  classifyBash,
  executedText,
  keepAttempt,
  mergeRecords,
  observeTool,
  phaseRefusal,
} from './gates'
import type { MergeCall, MergeTarget } from './gates'
import {
  DEFAULT_FLOW_IDS,
  applyOutcome,
  automaticOutcome,
  currentStep,
  describeFlow,
  describeStepAgent,
  describeWorkflow,
  detectedOutcome,
  dropPending,
  endFlow,
  executedTextShort,
  noteOwnerStep,
  observeDeploy,
  pendingReview,
  pendingCodeReview,
  flowView,
  outcomeLabel,
  stepTitle,
  ownerPress,
  pressedToast,
  registerPending,
  wakePrompt,
  startFlow,
  normalizeAgents,
} from './flow'
import type { Moved } from './flow'
import { closePhase, finishLoop, isClosed, loopRefusal, loopUnits, phaseSessions, uncommitted, unitRefusal, withEvents } from './lifecycle'
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
import { fromOwner, parseCommand, statusText } from './command'
import { DEFAULT_LANGUAGES, contentRule, uiText } from './i18n'
import type { UiText } from './i18n'
import { renderBand, renderPane } from './pane'
import { PLUGIN_NAME, readActivation, readAutowake, registryDir } from './activation'
import { STOP_AS_USER, childStops, eligibleChildren, flowProgress, sessionRef, stopPrompt, untracked } from './wake'
import { WORKFLOWS_PANE, drawWorkflows, startWorkflowsLoad, toggleWorkflowsPane } from './workflows-pane'
import { findAgent, loadConfig as loadProjectConfig, loadFlows } from './flow-files'
import { projectDir } from './project-config'
import { firstSite, issueUrl, jiraKeys, moveFor, parseIssue, parseTransitions, wishes } from './jira'
import { changeDir, openSpecView } from './openspec'
import {
  activityFor,
  activityKey,
  applyPlanUpdate,
  changePrs,
  closedByFlow,
  finishedSessionIds,
  completePlan,
  parseRun,
  parseSessionRows,
  findGroupId,
  groupIds,
  groupsLegible,
  inPlan,
  startedSessionId,
  groupName,
  phaseCounts,
  phaseViews,
  repoWebUrl,
  runKey,
  sessionActivityKey,
  toCard,
  withFlowStatus,
} from './model'

const PANE = PLUGIN_NAME
/** Typed as string: the laid MCP types predate this mod's own tool. */
const PLAN_TOOL: string = 'mcp__orchestrator__plan'
const FLOW_TOOL: string = 'mcp__orchestrator__flow'
const LIST_SESSIONS = 'mcp__ccd_session_mgmt__list_sessions'
const GET_SESSION = 'mcp__ccd_session_mgmt__get_session'
const OPEN_SESSION = 'mcp__ccd_window__open_session_in'
const LIST_GROUPS = 'mcp__ccd_sidebar__list_groups'
const CREATE_GROUP = 'mcp__ccd_sidebar__create_group'
const MOVE_SESSIONS = 'mcp__ccd_sidebar__move_sessions'
const DELETE_GROUP = 'mcp__ccd_sidebar__delete_group'
const REFRESH_MS = 15_000
/** How long the wake of a typed `aprovar` waits: past the end of the command's hook, which cannot submit a prompt. */
const WAKE_AFTER_COMMAND_MS = 50
/** Jira is asked again at most this often; the panel refreshes every 15 s. */
const JIRA_TTL_MS = 120_000

const VIEW = { plugin: 'orchestrator', key: 'view' } as const
const PLAN = { plugin: 'orchestrator', key: 'plan' } as const
const COLLAPSED = { plugin: 'orchestrator', key: 'collapsed' } as const
const WAITING = { plugin: 'orchestrator', key: 'waiting' } as const
const ANSWERED = { plugin: 'orchestrator', key: 'answered' } as const
const GATES_SEEN = { plugin: 'orchestrator', key: 'gates' } as const
const EDITED_AT = { plugin: 'orchestrator', key: 'editedAt' } as const
const TRIED = { plugin: 'orchestrator', key: 'tried' } as const
const SELF_ID = { plugin: 'orchestrator', key: 'selfId' } as const
const PERMISSION_NEEDED = { plugin: 'orchestrator', key: 'permission-needed' } as const
const ACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PANE_OPEN = { plugin: 'orchestrator', key: 'paneOpen' } as const
const REMINDED = { plugin: 'orchestrator', key: 'reminded' } as const
const RUNNING = { plugin: 'orchestrator', key: 'running' } as const
const AUTOWAKE_SEEN = { plugin: 'orchestrator', key: 'autowake-seen' } as const
const AUTOWAKE_PENDING = { plugin: 'orchestrator', key: 'autowake-pending' } as const
const AUTOWAKE_BRAKE = { plugin: 'orchestrator', key: 'autowake-brake' } as const
/** Stops of one child told while the flow does not move (`flowProgress`), before the mod stops telling that child. */
const AUTOWAKE_MAX_SAME_CHILD = 3
/** Stops told to the coordination while the flow does not move, any child, before the mod stops telling at all. */
const AUTOWAKE_MAX_SAME_PROGRESS = 10
const GRILL_DRAFTS = { plugin: 'orchestrator', key: 'grillDrafts' } as const
const START_SESSION = 'mcp__ccd_session__start_session'
const SET_SESSION_MODEL = 'mcp__ccd_session_mgmt__set_session_model'
const SET_SESSION_EFFORT = 'mcp__ccd_session_mgmt__set_session_effort'
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

const baseDir = async ($: EngineInterface): Promise<string> => registryDir($)

const readJson = async <T,>($: EngineInterface, path: string): Promise<T | undefined> => {
  try {
    if (!(await $.fs.exists(path))) return undefined
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return undefined
  }
}

/**
 * Whether a background read of the app's session list may go out now. `$.tool.check` is a query: it opens
 * no dialog. Only `allow` calls; `ask` and `deny` record in `permission-needed` which tools wait on the
 * owner (the panel and the band say so) and answer "do not know". The mod never writes a permission rule.
 *
 * It guards the calls nobody pressed a button for: the clock's refresh, `publishActivity`, `restoreActivity`,
 * the grouping, the wake, `refuseStart`, `folderIsOwn`, `loadFamily`, `openChildren`, `cleanupChange` (an
 * automatic step; archiving with no `self` to spare could archive the coordination) and `selfId`/`selfRowNow`
 * themselves (the loop's first link). An owner's action (a click) may call directly: phase 2 decides that path.
 */
const mayList = async ($: EngineInterface, tool: string, input: Record<string, unknown>): Promise<boolean> => {
  const verdict = await $.tool.check({ tool, input } as never).catch(() => undefined)
  const allowed = verdict?.decision === 'allow'
  const { value: needed } = await $.state.get(PERMISSION_NEEDED)
  const tools = (needed?.tools ?? []).filter(t => t !== tool)
  if (!allowed) tools.push(tool)
  const same = tools.length === (needed?.tools ?? []).length && tools.every(t => needed?.tools.includes(t))
  if (!same) await $.state.set(PERMISSION_NEEDED, tools.length === 0 ? null : { tools, since: needed?.since ?? (await $.clock.now()) })
  return allowed
}

/** The permission notice when the session tools wait on the owner (`permission-needed`), else undefined. */
const permissionWarning = async ($: EngineInterface): Promise<string | undefined> => {
  const { value: needed } = await $.state.get(PERMISSION_NEEDED)
  return needed === null || needed === undefined ? undefined : (await textNow($)).warning.permission
}

/** A background read of the session list: "do not know" (an error result) when the owner has not allowed it. */
const listCall = async ($: EngineInterface, tool: string, fields: Record<string, unknown>): Promise<CallResult> =>
  (await mayList($, tool, fields)) ? callTool($, { tool, ...fields }) : { isError: true }

let rowAsk: Promise<SessionRow | undefined> | undefined
let selfAsk: Promise<string | undefined> | undefined

/**
 * This session's row now. Simultaneous calls share one `get_session self`, and the row is not kept between
 * turns: `isRunning` and `groupId` change, and the wake needs them fresh.
 */
const selfRowNow = ($: EngineInterface): Promise<SessionRow | undefined> => {
  if (rowAsk !== undefined) return rowAsk
  const ask = (async () => {
    if (!(await canCall($, GET_SESSION))) return undefined
    return parseSessionRows((await listCall($, GET_SESSION, { session_id: 'self' })).text)[0]
  })()
  rowAsk = ask
  const free = (): void => {
    if (rowAsk === ask) rowAsk = undefined
  }
  ask.then(free, free)
  return ask
}

/**
 * This session's id in the app's list, asked once and kept: `$.session.id()` names the
 * transcript, which is not the id the family's rows carry. Undefined outside the app.
 * One ask at a time (`selfAsk`): a pending ask is never followed by a second one. A failure, or an
 * answer with no row, keeps nothing, and the next call may ask again.
 */
const selfId = async ($: EngineInterface): Promise<string | undefined> => {
  const { value: known } = await $.state.get(SELF_ID)
  if (known !== undefined) return known
  if (selfAsk !== undefined) return selfAsk
  const ask = (async () => {
    const row = await selfRowNow($)
    if (row !== undefined) await $.state.set(SELF_ID, row.sessionId)
    return row?.sessionId
  })()
  selfAsk = ask
  try {
    return await ask
  } finally {
    if (selfAsk === ask) selfAsk = undefined
  }
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
  const selfRow = await selfRowNow($)
  const family = parseSessionRows((await listCall($, LIST_SESSIONS, { linked: true, limit: 50 })).text)
  const grouped =
    selfRow?.groupId === undefined
      ? []
      : parseSessionRows((await listCall($, LIST_SESSIONS, { group: selfRow.groupId, limit: 50 })).text)

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

/** The project's languages from `<repo>/.orchestrator/config.json` (or the old folder's), read fresh: an edit shows on the next refresh. */
const loadConfig = async ($: EngineInterface): Promise<{ languages: Languages; problems: string[] }> => loadProjectConfig($)

/** The owner's words now, for a toast raised outside the pane. */
const textNow = async ($: EngineInterface): Promise<UiText> =>
  uiText((await loadConfig($).catch(() => ({ languages: DEFAULT_LANGUAGES }))).languages.ui)

const loadOpenSpec = async ($: EngineInterface, run: OrchestrationRun, t: UiText): Promise<OpenSpecView | undefined> => {
  if (run.changePath === undefined) return undefined
  const home = (await $.env.get('HOME')) ?? ''
  const dir = changeDir(run.changePath.replace(/^~(?=\/)/, home), run.coordinatorCwd)
  const [tasks, proposal, evidence] = await Promise.all(
    ['tasks.md', 'proposal.md', 'evidence.md'].map(name => readText($, `${dir}/${name}`)),
  )
  if (tasks === undefined && proposal === undefined) return undefined
  return openSpecView({ tasks, proposal, evidence }, t)
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
  t: UiText,
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
    return linkOnly(run.jiraSite, t.jira.unavailable)
  }
  const site = firstSite((await callTool($, { tool: getSites })).text)
  const host = run.jiraSite ?? site?.url
  if (host === undefined) {
    return linkOnly(run.jiraSite, t.jira.noSite)
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
    note: failed.length === 0 ? undefined : t.jira.couldNotRead(failed.join(', ')),
  }
}

/** The connector's cloud id for the plan's site, or why there is none (said to the owner as is). */
const jiraConnection = async (
  $: EngineInterface,
  run: OrchestrationRun,
  t: UiText,
): Promise<{ cloudId: string; getTransitions: string; transition: string | undefined } | { note: string }> => {
  const getTransitions = await findTool($, '__getTransitionsForJiraIssue')
  const getSites = await findTool($, '__getAccessibleAtlassianResources')
  if (getTransitions === undefined || getSites === undefined) {
    return { note: t.jira.notAuthenticated }
  }
  const site = firstSite((await callTool($, { tool: getSites })).text)
  const cloudId = run.jiraSite ?? site?.cloudId
  if (cloudId === undefined) return { note: t.jira.noSiteShort }
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
  t: UiText,
): Promise<JiraMove[]> => {
  if (run === undefined || state === undefined || (state.status !== 'running' && state.status !== 'done')) return []
  const stepId = state.status === 'done' ? state.flow.steps.at(-1)?.id : state.current
  if (stepId === undefined) return []
  const wanted = wishes(run, state.flow.steps, stepId)
  if (wanted.length === 0) return []
  const conn = await jiraConnection($, run, t)
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
  const t = await textNow($)
  const conn = await jiraConnection($, run, t)
  if ('note' in conn || conn.transition === undefined) {
    $.ui.toast(t.jira.notMoved(key, 'note' in conn ? conn.note : t.jira.noTransitionTool))
    return
  }
  const issue = (await loadJira($, run, t)).issues[key]
  const transitions = issue === undefined ? undefined : await issueTransitions($, conn, issue, true)
  const hit = transitions?.find(tr => tr.id === transitionId)
  if (issue === undefined || hit === undefined) {
    $.ui.toast(t.jira.notMoved(key, t.jira.goneTransition))
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
    $.ui.toast(t.jira.refused(key, ran.text?.slice(0, 120)))
    return
  }
  jiraCache.delete(key)
  transitionCache.clear()
  const state = await loadFlowState($, change)
  if (state !== undefined) {
    const log = await flowFile($, change, 'ndjson')
    const note = `${key}: "${issue.status ?? '?'}" → "${hit.to ?? hit.name}" (transição "${hit.name}"), pelo clique do dono`
    const event: FlowEvent = { seq: state.seq, at: await $.clock.now(), kind: 'jira-moved', step: state.current, by: 'owner', note }
    await inFlowQueue(async () => {
      const prior = (await readText($, log)) ?? ''
      await $.fs.write(log, `${prior}${JSON.stringify(event)}\n`)
    })
  }
  $.ui.toast(t.jira.moved(key, hit.to ?? hit.name))
  await refreshQuietly($)
}

/** The one move the owner approved, while its call runs. */
let approvedMove: string | undefined

/**
 * Each source fails on its own: a broken session list never hides the plan, and the panel names what failed.
 * `wake` only for the clock's tick: a refresh run inside a tool call (a flow report) cannot submit a prompt,
 * which would wait on the turn the call holds, and the stop it took would be lost.
 */
const refresh = async ($: EngineInterface, wake = false): Promise<void> => {
  await restoreActivity($).catch(() => undefined)
  const problems: string[] = []
  const cwd = await $.session.root()
  const base = await baseDir($)
  const { value: ownPlan = [] } = await $.state.get(PLAN)
  const config = await loadConfig($).catch(error => {
    problems.push(describeError('config', error))
    return { languages: DEFAULT_LANGUAGES, problems: [] }
  })
  problems.push(...config.problems)
  const { languages } = config
  const t = uiText(languages.ui)

  const run = await loadRun($, cwd).catch(error => {
    problems.push(describeError('plano', error))
    return undefined
  })

  let sessions: { self: SessionCard | undefined; children: SessionCard[] } = { self: undefined, children: [] }
  try {
    if (await canCall($, LIST_SESSIONS)) sessions = await loadSessions($, base, ownPlan)
    else problems.push(t.warning.noSessions)
  } catch (error) {
    problems.push(describeError('sessões', error))
  }
  if (wake) await wakeCoordination($, cwd, run, sessions).catch(error => $.ui.log(`orchestrator: ${describeError('aviso', error)}`))

  const openspec =
    run === undefined
      ? undefined
      : await loadOpenSpec($, run, t).catch(error => {
          problems.push(describeError('openspec', error))
          return undefined
        })
  const jira =
    run === undefined
      ? { issues: {}, note: undefined }
      : await loadJira($, run, t).catch(error => ({ issues: {}, note: describeError('jira', error) }))

  const skips = run === undefined ? {} : await loadSkips($, run.change).catch(() => ({}))
  const flow = await loadFlowView($, run, cwd, languages).catch(error => {
    problems.push(describeError('flow', error))
    return undefined
  })
  const flowState = flow === undefined ? undefined : await loadFlowState($, flow.change).catch(() => undefined)
  const jiraMoves = await loadJiraMoves($, run, flowState, jira.issues, t).catch(error => {
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
    run: run === undefined ? undefined : withFlowStatus(run, flowState),
    repoUrl,
    openspec,
    jira: jira.issues,
    jiraNote: jira.note,
    jiraMoves,
    skips,
    flow,
    prep,
    ...(flowTimes === undefined ? {} : { flowTimes }),
    languages,
    updatedAt: await $.clock.now(),
    warning: problems.length === 0 ? undefined : problems.join(' · '),
  }
  await $.state.set(VIEW, asJson(view))
}

const refreshQuietly = async ($: EngineInterface, wake = false): Promise<void> => {
  try {
    await activeMode($) // keeps "is a flow running here" warm for the renders, which cannot write it
    await refresh($, wake)
  } catch (error) {
    $.ui.log(`orchestrator: ${describeError('refresh', error)}`)
  }
}

/**
 * "Seguir o flow sem clique": when a child of the flow this session coordinates ends its turn, tells the
 * coordination with a prompt of its own, which the app takes as the owner's turn. Only with the clone active,
 * the owner's option on, a flow `running` and this session its `coordinatorSession` (the mod of a child in the
 * same folder stays quiet). While the coordination works, the stops wait and go in one prompt once it stops.
 * With the clone inactive or the option off nothing is watched, and what was kept goes, so turning it on later
 * tells no old stop. One look at a time (`waking`): two refreshes that overlap tell a stop once.
 */
let waking = false

const wakeCoordination = async (
  $: EngineInterface,
  root: string,
  run: OrchestrationRun | undefined,
  family: { self: SessionCard | undefined; children: SessionCard[] },
): Promise<void> => {
  if (waking) return
  waking = true
  try {
    await wakeOnce($, root, run, family)
  } finally {
    waking = false
  }
}

const forgetWatch = async ($: EngineInterface): Promise<void> => {
  const [seen, pending, brake] = await Promise.all([$.state.get(AUTOWAKE_SEEN), $.state.get(AUTOWAKE_PENDING), $.state.get(AUTOWAKE_BRAKE)])
  if (seen.value != null) await $.state.set(AUTOWAKE_SEEN, null)
  if (pending.value != null) await $.state.set(AUTOWAKE_PENDING, null)
  if (brake.value != null) await $.state.set(AUTOWAKE_BRAKE, null)
}

const wakeOnce = async (
  $: EngineInterface,
  root: string,
  run: OrchestrationRun | undefined,
  { self, children }: { self: SessionCard | undefined; children: SessionCard[] },
): Promise<void> => {
  if ((await readActivation($).catch(() => undefined))?.level === undefined || !(await readAutowake($))) {
    await forgetWatch($)
    return
  }
  if (self === undefined) return
  const flow = await currentFlow($, root)
  if (flow === undefined || flow.coordinatorSession !== self.sessionId) return
  const plan = run?.change === flow.change ? run : undefined
  // the children of earlier changes never count: the flow's own `earlier`, and the other flows' sessions
  const excluded = [...(flow.earlier ?? []), ...(await siblingFlows($, flow.change, root)).flatMap(s => s.sessions ?? [])]
  const { value: seen } = await $.state.get(AUTOWAKE_SEEN)
  const eligible = eligibleChildren(plan, { sessions: flow.sessions ?? [], excluded }, self.sessionId, children)
  const looked = childStops(seen ?? {}, eligible, await $.clock.now())
  const { value: before } = await $.state.get(AUTOWAKE_PENDING)
  // a child opened with wake_when_done is woken for by the app: it stays in `seen`, but the mod tells nothing of it
  const pending = untracked([...new Set([...(before ?? []), ...looked.stopped.map(sessionRef)])], flow.tracked)
  await $.state.set(AUTOWAKE_SEEN, asJson(looked.seen))
  if (self.isRunning || pending.length === 0) {
    if (pending.length !== (before ?? []).length) await $.state.set(AUTOWAKE_PENDING, pending)
    return
  }
  await $.state.set(AUTOWAKE_PENDING, null)
  // a brake against a loop: the same child told a few times while the flow does not move stops being told,
  // and so does any child once the coordination was told too many times (a new child on each stop is a loop too)
  const { value: brake } = await $.state.get(AUTOWAKE_BRAKE)
  const key = flowProgress(flow, plan)
  const same = brake?.key === key ? brake : undefined
  const told = same?.told ?? {}
  const sent = same?.sent ?? 0
  const capped = sent >= AUTOWAKE_MAX_SAME_PROGRESS
  const fresh = capped ? [] : pending.filter(id => (told[id] ?? 0) < AUTOWAKE_MAX_SAME_CHILD)
  const braked = pending.filter(id => !fresh.includes(id))
  const warned = same?.warned === true || braked.length > 0
  await $.state.set(AUTOWAKE_BRAKE, {
    key,
    told: { ...told, ...Object.fromEntries(fresh.map(id => [id, (told[id] ?? 0) + 1])) },
    // one stop told is one, however many children it names
    sent: sent + (fresh.length > 0 ? 1 : 0),
    warned,
  })
  if (braked.length > 0 && same?.warned !== true) {
    $.ui.toast(
      capped
        ? `Orchestrator: o flow de ${flow.change} parece parado: ${AUTOWAKE_MAX_SAME_PROGRESS} avisos à coordenação sem o flow andar. ` +
            'Parei de avisar até o flow andar.'
        : `Orchestrator: o flow de ${flow.change} parece parado: ${braked.join(', ')} terminou o turno mais de ${AUTOWAKE_MAX_SAME_CHILD} ` +
            'vezes sem o flow andar. Parei de avisar a coordenação sobre essa sessão até o flow andar.',
    )
  }
  if (fresh.length === 0) return
  void $.prompt.submit({ text: stopPrompt(fresh), ...(STOP_AS_USER ? { asUser: true as const } : {}) }).catch(error => $.ui.log(`orchestrator: ${describeError('aviso', error)}`))
}

/**
 * The change this coordination works on: the flow `running` it started (the mod of a child in the same
 * folder is not its coordinator), else the plan published last. The flow wins: a new change has no plan yet.
 */
const currentFlow = async ($: EngineInterface, root: string): Promise<FlowState | undefined> => {
  const self = await selfId($).catch(() => undefined)
  return (await allFlowStates($))
    .filter(s => s.status === 'running' && ownsFlow(s, root) && (s.coordinatorSession === undefined || s.coordinatorSession === self))
    .sort((a, b) => b.startedAt - a.startedAt)[0]
}

const currentChange = async ($: EngineInterface, root: string): Promise<string | undefined> =>
  (await currentFlow($, root))?.change ?? (await loadRun($, root).catch(() => undefined))?.change

/** The coordination's other changes' flows, which keep their own children and group. */
const siblingFlows = async ($: EngineInterface, change: string, root: string): Promise<FlowState[]> =>
  (await allFlowStates($)).filter(s => s.change !== change && ownsFlow(s, root))

/**
 * Files the coordinator and the children of this change under the change's sidebar group, creating
 * the group once. Runs on each plan publish and after each start_session, so a new phase session
 * never lands ungrouped. Children of other changes stay out, and the ones the app dragged along with
 * the coordinator go back to their own group.
 */
const groupFamily = async ($: EngineInterface, change: string, started?: string, start: StartSeen = {}): Promise<string | undefined> => {
  if (!(await canCall($, MOVE_SESSIONS))) {
    // with no sidebar the flow still learns what the start means for the wake and the pending list
    if (start.track !== undefined || start.title !== undefined) {
      const flow = await loadFlowState($, change)
      if (flow !== undefined && ownsFlow(flow, await $.session.root())) await keepGrouping($, change, [], undefined, start)
    }
    return 'sidebar indisponível para agrupar'
  }
  const root = await $.session.root()
  const self = await selfRowNow($)
  const listedFamily = await listCall($, LIST_SESSIONS, { linked: true, limit: 50 }).catch(() => ({ isError: true }) as CallResult)
  const family = listedFamily.isError === true ? [] : parseSessionRows(listedFamily.text)
  const children = family.filter(row => self !== undefined && !row.isArchived && row.startedBy === self.sessionId)

  const flow = await loadFlowState($, change)
  const others = await siblingFlows($, change, root)
  const state = flow !== undefined && ownsFlow(flow, root) ? flow : undefined
  let fresh: string[] = []
  if (state?.status === 'running') {
    // the rows carry no creation date, so the flow keeps the children it opened: the ones no flow has claimed.
    // A flow that could not list the children at its start (no `earlier`) adopts only the one just started.
    const claimed = new Set([...others, state].flatMap(s => [...(s.sessions ?? []), ...(s.earlier ?? [])]))
    const listedNow = listedFamily.isError === true || state.earlier === undefined ? [] : children.map(c => c.sessionId)
    fresh = [...new Set([...(started === undefined ? [] : [started]), ...listedNow])].filter(id => !claimed.has(id))
  }

  const listed = await callTool($, { tool: LIST_GROUPS }).catch(() => ({ isError: true }) as CallResult)
  // an error text is "do not know", never "no such group": creating one now would duplicate it
  if (listed.isError === true || listed.deny !== undefined || !groupsLegible(listed.text)) {
    $.ui.log(`orchestrator: list_groups não respondeu; o grupo de ${change} fica para o próximo gancho`)
    if (state !== undefined) await keepGrouping($, change, fresh, undefined, start)
    return undefined
  }
  const name = groupName(change)
  const known = groupIds(listed.text)
  let groupId = state?.groupId !== undefined && known.includes(state.groupId) ? state.groupId : findGroupId(listed.text, name)
  if (groupId === undefined) groupId = findGroupId((await callTool($, { tool: CREATE_GROUP, name })).text)
  if (groupId === undefined) return `não consegui criar o grupo ${name}`
  const kept = state === undefined ? undefined : await keepGrouping($, change, fresh, groupId, start)

  const run = await loadRun($, root).catch(() => undefined)
  const plan = run?.change === change ? run : undefined
  const mine = new Set(kept?.sessions ?? [])
  const loose = children.filter(row => (mine.has(row.sessionId) || inPlan(plan, row)) && row.groupId !== groupId)
  const moveSelf = self?.groupId !== groupId
  const ids = [...(moveSelf ? ['self'] : []), ...loose.map(row => row.sessionId)]
  if (ids.length > 0) await callTool($, { tool: MOVE_SESSIONS, session_ids: ids, group_id: groupId })

  if (moveSelf) {
    // the app moves the nested children with their mother: send the ones of other changes back
    const after = parseSessionRows((await listCall($, LIST_SESSIONS, { linked: true, limit: 50 })).text)
    for (const other of others) {
      if (other.groupId === undefined || !known.includes(other.groupId)) continue
      const own = new Set(other.sessions ?? [])
      const strays = after.filter(row => !row.isArchived && own.has(row.sessionId) && row.groupId !== other.groupId)
      if (strays.length > 0) {
        await callTool($, { tool: MOVE_SESSIONS, session_ids: strays.map(row => row.sessionId), group_id: other.groupId })
      }
    }
  }
  return undefined
}

/**
 * What a start that went through says beyond the grouping: the child to keep in `tracked` (it was opened
 * with `wake_when_done`, so the app wakes the coordination) and the title, which takes a pending session of
 * the same title out of the list (the model opened it itself).
 */
type StartSeen = { track?: string; title?: string }

/**
 * What the grouping adds to the flow, merged into the flow as it is on disk now: the sidebar calls in
 * between may let a `flow report` write it, and the grouping only owns `sessions`, `groupId` and `tracked`
 * (and drops the pending session a start opened). One write, in the queue, with the grouping's own.
 */
const keepGrouping = (
  $: EngineInterface,
  change: string,
  fresh: readonly string[],
  groupId: string | undefined,
  start: StartSeen = {},
): Promise<FlowState | undefined> =>
  inFlowQueue(async () => {
    const disk = await loadFlowState($, change)
    if (disk === undefined) return undefined
    const title = start.title?.trim()
    const now = title === undefined || title === '' ? disk : dropPending(disk, p => p.title === title)
    const sessions = [...new Set([...(now.sessions ?? []), ...fresh])]
    const added = sessions.length !== (now.sessions ?? []).length
    const regrouped = groupId !== undefined && now.groupId !== groupId
    const track = start.track !== undefined && !(now.tracked ?? []).includes(start.track) ? start.track : undefined
    if (!added && !regrouped && track === undefined && now === disk) return now
    const merged: FlowState = {
      ...now,
      ...(added ? { sessions } : {}),
      ...(regrouped ? { groupId } : {}),
      ...(track === undefined ? {} : { tracked: [...(now.tracked ?? []), track] }),
    }
    // already merged with the disk, and its groupId is the new one: written as it is
    await writeFlowNow($, merged, [])
    return merged
  })

/** One grouping at a time: two start_session at once would both miss the group and create it twice. */
let grouping: Promise<void> = Promise.resolve()

const groupQuietly = ($: EngineInterface, change: string | undefined, started?: string, start: StartSeen = {}): Promise<void> => {
  if (change === undefined) return Promise.resolve()
  const turn = grouping.then(async () => {
    try {
      const problem = await groupFamily($, change, started, start)
      if (problem !== undefined) $.ui.toast(`Orchestrator: ${problem}`)
    } catch (error) {
      $.ui.log(`orchestrator: ${describeError('agrupar', error)}`)
    }
  })
  grouping = turn
  return turn
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
  // a phase the loop already closed, or any phase once the flow is over, passed its gates there
  const flowState = await loadFlowState($, parsed.change).catch(() => undefined)
  const refusals = phaseRefusals(
    parsed,
    await loadFamily($),
    await ownCheck($),
    await loadSkips($, parsed.change),
    phase => phase.status === 'done' && !wasDone.has(phase.id) && !closedByFlow(flowState, phase.id),
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
      `${counts.blocked} blocked, ${counts.pending} pending. ${contentRule((await loadConfig($)).languages)}`,
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
  $.ui.toast((await textNow($)).toast.cannotOpen(card.title))
}

const PLAN_FAILED = { result: 'Plan not published: the orchestrator panel failed to store it.', isError: true } as const
const FLOW_FAILED = { result: 'Flow: the orchestrator failed to read or store the flow; nothing changed. Try again.', isError: true } as const

/** The gates' files are the mod's alone: a record or a skip written by the model would forge a pass. */
/** Commands that only read: the gate files may be looked at, never written from a shell. */
const READ_ONLY_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'stat', 'jq', 'diff', 'file', 'du'])

/** The folder named with or without its trailing slash: `rm -rf ~/.claude/orquestrador` must not slip through. */
const MENTIONS_PROTECTED_DIR = /\.claude\/orquestrador(?=$|[\/\s"'])/i

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

/**
 * The activation file is the owner's, written by the panel alone: a mark or a hook the model planted there
 * (Edit, Write or a shell) would switch the guards off or run its own command. A first line of defense by the text
 * of the call, easy to get around; what actually holds is that the level counts only as the panel recorded it
 * (`readActivation`). It applies only where the mod is active: an inactive clone's file is free, as before.
 */
const SETTINGS_FILE = /(^|\/)\.claude\/settings\.local\.json$/i // APFS ignores case
const MENTIONS_SETTINGS = /settings\.local\.json/i
const touchesSettings = (tool: string, input: Record<string, unknown>): boolean => {
  if (EDIT_TOOLS.has(tool)) {
    const path = input.file_path ?? input.notebook_path
    return typeof path === 'string' && SETTINGS_FILE.test(path)
  }
  return tool === 'Bash' && typeof input.command === 'string' && MENTIONS_SETTINGS.test(input.command) && !isReadOnlyCommand(input.command)
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
const refuseStartWhy = async ($: EngineInterface): Promise<{ text: string; blind: boolean } | undefined> => {
  const { value: ownPlan = [] } = await $.state.get(PLAN)
  const { self, children } = await loadSessions($, await baseDir($), ownPlan)
  if (self === undefined) {
    const { value: needed } = await $.state.get(PERMISSION_NEEDED)
    return {
      blind: true,
      text:
        needed === null || needed === undefined
          ? 'the orchestrator could not read this session, so it cannot count the live phase sessions.'
          : 'the orchestrator may not read the session list yet, so it cannot count the live phase sessions: allow get_session and list_sessions.',
    }
  }
  const finished = finishedSessionIds(await ownChanges($, await $.session.root()), children)
  const live = liveSessions(children, self.sessionId, self.cwd, finished)
  if (live.length < MAX_LIVE_SESSIONS) return undefined
  return {
    blind: false,
    text:
      `${live.length} phase sessions are alive: ${live.map(l => `${l.session.name ?? l.session.title} (${l.why})`).join(', ')}; ` +
      `the ceiling is ${MAX_LIVE_SESSIONS}. A session counts only while it runs, waits on the owner or has open tasks; ` +
      'one whose phase or flow finished or whose PR merged or closed does not. Wait for one to finish, or archive one ' +
      '(its gates must have passed), before starting another.',
  }
}

const refuseStart = async ($: EngineInterface): Promise<string | undefined> => (await refuseStartWhy($))?.text

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
 * the change id. A PR whose head branch cannot be read is taken as the change's, and so is a
 * GraphQL merge, which names its PR by a node id: the gate fails closed.
 */
const mergesChangePr = async (
  $: EngineInterface,
  call: MergeCall,
  run: OrchestrationRun,
  flow: FlowState | undefined,
  family: Family | undefined,
  root: string,
): Promise<boolean> => {
  if (call.via === 'graphql') return true
  const selector = call.selector
  const target = mergeTarget(selector)
  const { numbers, branches } = changePrs(run, flow, family?.children ?? [])
  if (target.number !== undefined && numbers.has(target.number)) return true
  const head = await mergeHead($, selector, target, root)
  return head === undefined || isChangeBranch(head, run.change, branches)
}

/**
 * From an orchestrated checkout no merge goes with `--admin`, nor with an argument the mod cannot
 * read (`$VAR`, `$(…)`). The change's own PR, while its flow runs up to the step before the
 * archive, also waits for the flow's PR review before that merge and for the final gates; a
 * finished or aborted flow holds back nothing but those two. Every form `mergeCalls` reads counts:
 * `gh pr merge` with or without flags before `pr`, `gh api …/pulls/<n>/merge`, GraphQL's
 * `mergePullRequest`, quoted, continued, or inside `bash -c`/`sh -c`/`eval`. A line that names `gh`
 * and a merge the mod cannot read as one (`opaqueMerge`) is refused: the guard fails closed.
 */
const refuseMerge = async ($: EngineInterface, command: string): Promise<string | undefined> => {
  const calls = mergeCalls(command)
  const opaque = opaqueMerge(command)
  if (calls.length === 0 && opaque === undefined) return undefined
  const root = await $.session.root()
  const run = await loadRun($, root)
  if (run === undefined) return undefined
  const held: string[] = []
  const reasons: string[] = []
  if (opaque !== undefined) {
    held.push('opaque')
    reasons.push(
      `\`${opaque}\` runs a \`gh\` merge the mod cannot read (behind another program, from a script on stdin, or ` +
        'under a name a variable holds), so it cannot check the review, the gates or `--admin`. Run `gh pr merge` ' +
        'itself, with the PR and the flags written out.',
    )
  }
  if (calls.some(c => c.admin)) {
    held.push('--admin')
    reasons.push('`--admin` skips the branch protection (GitHub approval and green CI); merge without it, never around them.')
  }
  const blind = calls.find(c => c.dynamic)
  if (blind !== undefined) {
    held.push('$')
    reasons.push(
      `\`${blind.text}\` takes an argument from a variable or \`$(…)\`: the mod cannot see what it carries ` +
        '(an `--admin`, another PR). Write the PR and the flags out in the command.',
    )
  }
  const flow = await loadFlowState($, run.change)
  const family = await loadFamily($)
  let change = false
  if (flow === undefined || mergeWindow(flow)) {
    for (const call of calls) change ||= await mergesChangePr($, call, run, flow, family, root)
  }
  if (change) {
    const review = flow === undefined ? undefined : pendingReview(flow)
    if (review !== undefined) {
      held.push(review.id)
      const press = Object.values(review.outcomes)[0]?.label ?? review.id
      reasons.push(
        `the PR review "${review.id}" (${review.title}) of ${run.change} is not answered yet: the owner approves the PR ` +
          `on GitHub and presses "${press}" in the panel before it merges.`,
      )
    }
    const code = flow === undefined ? undefined : pendingCodeReview(flow)
    if (code !== undefined) {
      held.push(code.id)
      reasons.push(
        `the code review "${code.id}" (${code.title}) of ${run.change} has no "aprovado" since the flow last entered it: ` +
          "the flow's reviewer approves before the PR merges (a turn back to run again clears it).",
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
      enum: ['list', 'start', 'status', 'report', 'round', 'mockup', 'close', 'note', 'pending'],
      description:
        'list: the flows on offer. start: begin a flow for a change. status: where the change stands and who ' +
        'answers the current step. report: the outcome of the current session step. round: record one ' +
        'grill round (questions and the owner\'s answers) while the flow is on the grill. mockup: attach the ' +
        'mockup the owner reviews while the flow is on the mockup. close: during the phase loop, ' +
        'close `phase` once its gates passed, its tasks are ticked in tasks.md and its work is committed; the mod ' +
        'archives its session and ends the loop when every phase is closed (without `phase`, it only checks that). ' +
        'note: leave `note` for the owner step that waits (e.g. what QA asked); it joins the owner\'s answer. ' +
        'pending: on a session step or the phase loop, keep the `sessions` the app refused to start in this turn; the owner ' +
        'opens them all with one press on "Abrir as N sessões pendentes" in the panel (a repeated `key` replaces the one before).',
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
    sessions: {
      type: 'array',
      maxItems: 6,
      description:
        'pending: the sessions to keep, each as start_session would take it. `key` is the phase id ("2", "4.6") or the step id ' +
        '("planejar"). At most 6, a title of at most 120 and a prompt of at most 20000 characters.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          title: { type: 'string', maxLength: 120 },
          prompt: { type: 'string', maxLength: 20000 },
          model: { type: 'string' },
          effort: { type: 'string' },
          use_worktree: { type: 'boolean' },
        },
        required: ['key', 'title', 'prompt'],
      },
    },
  },
  required: ['action'],
}

const flowsDir = async ($: EngineInterface): Promise<string> => `${await baseDir($)}/flows`

/** What the current step's agent, model, effort and details say, for the status of a running flow. */
const describeAgent = async ($: EngineInterface, state: FlowState): Promise<string | undefined> => {
  if (state.status !== 'running') return undefined
  const step = state.flow.steps.find(s => s.id === state.current)
  if (step === undefined) return undefined
  const folder = await projectDir($, await $.session.root())
  return describeStepAgent(step, step.agent === undefined ? undefined : await findAgent($, step.agent), folder.name)
}

const flowFile = async ($: EngineInterface, change: string, ext: 'json' | 'ndjson'): Promise<string> =>
  `${await flowsDir($)}/${runKey(change)}.${ext}`

/** A flow going since before 0.15.0 keeps the definition it started with: its old agent names are read as the new. */
const readFlowState = async ($: EngineInterface, path: string): Promise<FlowState | undefined> => {
  const state = await readJson<FlowState>($, path)
  return state === undefined || !Array.isArray(state.flow?.steps) ? state : { ...state, flow: normalizeAgents(state.flow) }
}

const loadFlowState = async ($: EngineInterface, change: string): Promise<FlowState | undefined> =>
  readFlowState($, await flowFile($, change, 'json'))

const allFlowStates = async ($: EngineInterface): Promise<FlowState[]> => {
  const dir = await flowsDir($)
  if (!(await $.fs.exists(dir))) return []
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const states = await Promise.all(files.map(f => readFlowState($, `${dir}/${f.name}`)))
  return states.filter((s): s is FlowState => s !== undefined && typeof s.change === 'string')
}

/**
 * One write of a flow's state or log at a time, the read before it included: a read and its write never
 * let another write fall in between and be lost. What runs here never calls the queue again (it would wait
 * on itself), so it writes with `writeFlowNow`. An error goes back to the caller and the next turn still runs.
 */
let flowWrites: Promise<unknown> = Promise.resolve()

const inFlowQueue = <T,>(fn: () => Promise<T>): Promise<T> => {
  const turn = flowWrites.then(fn)
  flowWrites = turn.catch(() => undefined)
  return turn
}

/**
 * Writes a flow read earlier, keeping what the grouping added to it on disk since (`sessions`, `groupId`, `tracked`):
 * a session adopted while a `flow report` or `close` worked is not lost. Only the grouping owns those two
 * fields, so the disk wins for `groupId`. A flow started anew (another `startedAt`) takes nothing from the old one.
 */
const saveFlow = ($: EngineInterface, state: FlowState, events: readonly FlowEvent[]): Promise<void> =>
  inFlowQueue(async () => {
    const disk = await loadFlowState($, state.change)
    if (disk === undefined || disk.startedAt !== state.startedAt) return writeFlowNow($, state, events)
    const sessions = [...new Set([...(state.sessions ?? []), ...(disk.sessions ?? [])])]
    const groupId = disk.groupId ?? state.groupId
    const tracked = [...new Set([...(state.tracked ?? []), ...(disk.tracked ?? [])])]
    // a pending session stays only where both kept it: the write dropped it (a phase closed, the step left),
    // or a start took it out on disk since the read; `flow pending` adds through its own turn of the queue
    const onDisk = disk.pendingStarts ?? []
    const pendingStarts = (state.pendingStarts ?? []).filter(p => onDisk.some(d => d.key === p.key && d.title === p.title))
    const { pendingStarts: _pending, ...rest } = state
    await writeFlowNow(
      $,
      {
        ...rest,
        ...(state.sessions === undefined && disk.sessions === undefined ? {} : { sessions }),
        ...(groupId === undefined ? {} : { groupId }),
        ...(tracked.length === 0 ? {} : { tracked }),
        ...(pendingStarts.length === 0 ? {} : { pendingStarts }),
      },
      events,
    )
  })

/** The state file and its append-only log, both written by the mod alone. Only from inside `inFlowQueue`. */
const writeFlowNow = async ($: EngineInterface, state: FlowState, events: readonly FlowEvent[]): Promise<void> => {
  await $.fs.write(await flowFile($, state.change, 'json'), JSON.stringify(state))
  await $.state.set(RUNNING, { root: '', at: 0, running: false }).catch(() => undefined)
  const log = await flowFile($, state.change, 'ndjson')
  const prior = (await readText($, log)) ?? ''
  await $.fs.write(log, prior + events.map(e => `${JSON.stringify(e)}\n`).join(''))
}

const logFlowRefusal = async ($: EngineInterface, state: FlowState, step: string, by: FlowEvent['by'], note: string): Promise<void> => {
  const log = await flowFile($, state.change, 'ndjson')
  const event: FlowEvent = { seq: state.seq, at: await $.clock.now(), kind: 'refused', step, by, note }
  await inFlowQueue(async () => {
    const prior = (await readText($, log)) ?? ''
    await $.fs.write(log, `${prior}${JSON.stringify(event)}\n`)
  })
}

/** In "lembrar" a refusal only warns: it still leaves a line in the flow's log and one the panel shows. */
const noteReminded = async ($: EngineInterface, note: string): Promise<void> => {
  const { value: prior } = await $.state.get(REMINDED)
  const count = (prior?.count ?? 0) + 1
  await $.state.set(REMINDED, { count, last: note.slice(0, 240) })
  const root = await $.session.root()
  const mine = (await allFlowStates($)).filter(s => ownsFlow(s, root) && s.status !== 'done' && s.status !== 'aborted')
  for (const state of mine) await logFlowRefusal($, state, state.current, 'session', `lembrar: ${note}`)
}

/** A flow belongs to the coordinator's checkout and to every worktree under it. */
const ownsFlow = (state: FlowState, root: string): boolean =>
  root === state.coordinatorCwd || root.startsWith(`${state.coordinatorCwd}/`)

/** Longer than the refresh tick (`REFRESH_MS`), which keeps the answer warm; a flow started or moved here drops it at once. */
const RUNNING_TTL_MS = 20_000

/**
 * What the mod does in this checkout. The owner's mark in the clone's `.claude/settings.local.json` says
 * "barrar" or "lembrar", and counts as far as the panel's own record backs it (see `readActivation`); with no
 * mark, a flow still running here keeps everything working (as "barrar") so nothing stops halfway; only a
 * confirmed absence of both leaves the mod quiet. It fails closed: a mark or flow that cannot be read, or a flow
 * already known to run, is "barrar". The flow answer is kept a few seconds (`RUNNING_TTL_MS`; saveFlow drops it)
 * so a render or a tool call does not scan every flow on disk. `remember: false` for a render, which may read
 * state but never write it: it uses the answer kept, or scans without keeping.
 */
const activeMode = async ($: EngineInterface, remember = true): Promise<ActivationLevel | undefined> => {
  let marked: Awaited<ReturnType<typeof readActivation>>
  try {
    marked = await readActivation($)
  } catch {
    return 'barrar'
  }
  if (marked.level !== undefined) return marked.level
  let root: string | undefined
  try {
    const here = await $.session.root()
    root = here
    const now = await $.clock.now()
    const { value: known } = await $.state.get(RUNNING)
    if (known !== undefined && known !== null && known.root === here && now >= known.at && now - known.at < RUNNING_TTL_MS) {
      return known.running ? 'barrar' : undefined
    }
    const running = (await allFlowStates($)).some(s => s.status !== 'done' && s.status !== 'aborted' && ownsFlow(s, here))
    if (remember) await $.state.set(RUNNING, { root: here, at: now, running })
    return running ? 'barrar' : undefined
  } catch {
    // the scan failed: a flow already known to run here (even past the short memory) keeps "barrar"; otherwise nothing is known
    const { value: known } = await $.state.get(RUNNING).catch(() => ({ value: undefined }))
    return known !== undefined && known !== null && known.running && (root === undefined || known.root === root) ? 'barrar' : undefined
  }
}

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

/**
 * The unarchived children the coordination has now, by id. A list that fails is "do not know" (undefined),
 * not "none": the flow then adopts only the sessions its start_session calls return.
 */
const openChildren = async ($: EngineInterface, coordinator: string | undefined): Promise<string[] | undefined> => {
  if (coordinator === undefined || !(await canCall($, LIST_SESSIONS))) return undefined
  const listed = await listCall($, LIST_SESSIONS, { linked: true, limit: 50 }).catch(() => ({ isError: true }) as CallResult)
  if (listed.isError === true || listed.deny !== undefined) return undefined
  return parseSessionRows(listed.text).filter(row => !row.isArchived && row.startedBy === coordinator).map(row => row.sessionId)
}

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
    const coordinator = await selfId($).catch(() => undefined)
    const earlier = await openChildren($, coordinator)
    const state: FlowState = {
      ...started.state,
      ...(coordinator === undefined ? {} : { coordinatorSession: coordinator }),
      sessions: [],
      ...(earlier === undefined ? {} : { earlier }),
    }
    await saveFlow($, state, started.events)
    await refreshQuietly($)
    const left = earlier === undefined || earlier.length === 0 ? '' : ` ${earlier.length} unarchived child session(s) of earlier changes remain on this coordination: archive them first, once their gates passed.`
    return { result: `Started. ${await describeWithPrep($, state)} ${contentRule((await loadConfig($)).languages)}${left}` }
  }
  const picked = await pickFlow($, input.change)
  if ('error' in picked) return flowError(picked.error)
  if (action === 'status') return { result: `${await describeWithPrep($, picked)} ${contentRule((await loadConfig($)).languages)}` }
  if (action === 'round' || action === 'mockup') return handlePrepAction($, picked, input)
  if (action === 'close') return closeLoopPhase($, picked, input.phase)
  if (action === 'note') {
    if (typeof input.note !== 'string' || input.note.trim() === '') return flowError('`note` is required.')
    const noted = noteOwnerStep(picked, input.note.trim(), await $.clock.now())
    if ('error' in noted) return flowError(`refused: ${noted.error}`)
    await saveFlow($, noted.state, noted.events)
    return { result: `Note kept for the owner's answer. ${describeFlow(noted.state)}` }
  }
  if (action === 'pending') return keepPending($, picked, input.sessions)
  if (action !== 'report') return flowError('action must be list, start, status, report, round, mockup, close, note or pending.')
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
  // flows from before the field: the coordinator is whoever reports
  const coordinator = picked.coordinatorSession === undefined ? await selfId($).catch(() => undefined) : undefined
  await saveFlow($, coordinator === undefined ? moved.state : { ...moved.state, coordinatorSession: coordinator }, moved.events)
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
/**
 * `flow pending`: only the coordination of a running flow keeps sessions for the owner's press. Read and
 * written in one turn of the queue, from the disk: a start's grouping may have dropped an entry since.
 */
const keepPending = async ($: EngineInterface, picked: FlowState, sessions: unknown): Promise<FlowReply> => {
  const self = await selfId($).catch(() => undefined)
  if (picked.coordinatorSession !== undefined && self === undefined) {
    // this session's id is unknown: with the session tools on "ask" that is the permission, not "another session"
    const waiting = await permissionWarning($)
    if (waiting !== undefined) return flowError(`refused: ${waiting}`)
  }
  if (picked.coordinatorSession !== undefined && picked.coordinatorSession !== self) {
    return flowError('refused: only the session that coordinates this flow keeps its pending sessions.')
  }
  const at = await $.clock.now()
  const kept = await inFlowQueue(async () => {
    const disk = (await loadFlowState($, picked.change)) ?? picked
    const moved = registerPending(disk, sessions, at)
    if (!('error' in moved)) await writeFlowNow($, moved.state, moved.events)
    return moved
  })
  if ('error' in kept) {
    await logFlowRefusal($, picked, picked.current, 'session', kept.error)
    return flowError(`refused: ${kept.error}`)
  }
  await refreshQuietly($)
  const n = kept.state.pendingStarts?.length ?? 0
  return {
    result:
      `Kept ${n} pending session(s): ${(kept.state.pendingStarts ?? []).map(p => p.key).join(', ')}. Tell the owner it is one press on ` +
      `"Abrir as ${n} sessões pendentes" in the orchestrator panel; the mod opens them with wake_when_done, so wait for them to report. ` +
      describeFlow(kept.state),
  }
}

/** What the owner's press on "Abrir as N sessões pendentes" did: the keys opened, how many stayed and why. */
type PendingOpened = { opened: string[]; left: number; why?: string; byApp: boolean }

/**
 * Opens the sessions the coordination kept with `flow pending`, on the owner's press. `words` are the owner's
 * gesture as it happened (the press, or the typed command): the only place the mod hands a start the
 * owner's words, which the app reads as the owner asking. The flow is read in the queue and the queue let
 * go before the starts: the grouping of each start writes the flow through the same queue (it would wait
 * on itself). A start the mod makes from a press does not pass its own `tool.call` hook, so the same gate
 * and the same grouping run here: `refuseStart` (the ceiling, the session tools on "ask") as the hook holds
 * it in this mode, then `groupQuietly` with the child to keep in `tracked`. The first refusal stops the loop
 * and the rest stays. The opened ones leave the list in a turn of their own, with the disk read again.
 */
const openPending = async ($: EngineInterface, change: string, words: string): Promise<PendingOpened> => {
  const read = await inFlowQueue(() => loadFlowState($, change))
  const entries = read?.status === 'running' ? (read.pendingStarts ?? []) : []
  if (read === undefined || entries.length === 0) return { opened: [], left: 0, byApp: false }
  const self = await selfId($).catch(() => undefined)
  const mode = await activeMode($)
  const opened: string[] = []
  let why: string | undefined
  let byApp = false
  for (const entry of entries) {
    // the same gate the hook holds on a start: rigid in "barrar", a warning in "lembrar", nothing when inactive
    const found = mode === undefined ? undefined : await refuseStartWhy($)
    const refusal = found?.text
    // "lembrar" only warns about the ceiling, but blind (no session list) the mod cannot tell whether it is passed: it opens none
    if (refusal !== undefined && (mode === 'barrar' || found?.blind === true)) {
      why = refusal
      break
    }
    if (refusal !== undefined) {
      $.ui.toast(`Orchestrator gate: ${refusal}`)
      await noteReminded($, `Orchestrator gate: ${refusal}`).catch(() => undefined)
    }
    const ran = (await callTool($, {
      tool: START_SESSION,
      title: entry.title,
      prompt: entry.prompt,
      initiation: 'user_asked',
      wake_when_done: true,
      ...(entry.use_worktree === undefined ? {} : { use_worktree: entry.use_worktree }),
      consent: words,
    }).catch(error => ({ isError: true, text: describeError('start_session', error) }) as CallResult)) as CallResult & { result?: unknown }
    if (ran.deny !== undefined || ran.isError === true) {
      why = (ran.deny ?? ran.text ?? '').replace(/^Orchestrator gate: /, '').slice(0, 240)
      // the mod's own refusal (the ceiling, the permission) is not the app refusing a start from the panel
      byApp = ran.deny === undefined || !ran.deny.startsWith('Orchestrator')
      break
    }
    opened.push(entry.key)
    const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? ''))
    const id = startedSessionId(text, self)
    if (id === undefined) continue
    await groupQuietly($, change, id, { track: id, title: entry.title })
    if (entry.model !== undefined) await callTool($, { tool: SET_SESSION_MODEL, session_id: id, model: entry.model }).catch(() => undefined)
    if (entry.effort !== undefined) await callTool($, { tool: SET_SESSION_EFFORT, session_id: id, effort: entry.effort }).catch(() => undefined)
  }
  if (opened.length > 0) {
    await inFlowQueue(async () => {
      const now = await loadFlowState($, change)
      if (now === undefined || now.startedAt !== read.startedAt) return
      const event: FlowEvent = { seq: now.seq, at: await $.clock.now(), kind: 'pending-opened', step: now.current, by: 'owner', note: opened.join(', ') }
      await writeFlowNow($, dropPending(now, p => opened.includes(p.key)), [event])
    })
  }
  return { opened, left: entries.length - opened.length, ...(why === undefined ? {} : { why }), byApp }
}

/** The panel's press: opens the pending sessions and says how many opened, how many stayed and why. */
const pressPending = async ($: EngineInterface, change: string, label: string, mobile: boolean): Promise<void> => {
  const t = (await textNow($)).pending
  const done = await openPending($, change, `The user pressed "${label}" in the orchestrator panel.`)
  await refreshQuietly($)
  $.ui.toast(t.result(done.opened.length, done.left, done.why) + (done.byApp ? ` ${mobile ? t.appRefusedMobile : t.appRefused}` : ''))
}

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
    const self = await selfRowNow($)
    const listed = await listCall($, LIST_SESSIONS, { group: groupId, limit: 50 })
    // without `self` the coordination itself could pass for a phase session: leave everything as it is
    if (self === undefined || listed.isError === true) return [ev('cleanup', 'sessions not read (permission or app): sessions and group left as they are')]
    const rows = parseSessionRows(listed.text)
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
      const { languages } = await loadConfig($)
      const t = uiText(languages.ui).toast
      if ('error' in seen) {
        await logFlowRefusal($, state, step.id, 'detect', seen.error)
        $.ui.toast(t.deployRefused(state.change, stepTitle(step, languages.ui), seen.error))
        continue
      }
      await saveFlow($, seen.state, seen.events)
      const word = seen.events.some(e => e.outcome === 'falhou') ? 'failed' : seen.state.current === step.id ? 'part' : 'done'
      $.ui.toast(t.deployProgress(state.change, stepTitle(step, languages.ui), word))
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
      const { languages } = await loadConfig($)
      const declared = step.outcomes[detected]
      $.ui.toast(uiText(languages.ui).toast.deploySeen(state.change, declared === undefined ? detected : outcomeLabel(declared, languages.ui)))
      continue
    }
    const outcome = automaticOutcome(step, command, failed)
    if (outcome === undefined) continue
    if (outcome === 'passou' && step.requiresEvidence && !(await hasEvidence($, state))) {
      await logFlowRefusal($, state, step.id, 'automatic', 'passed, but evidence.md is not recorded')
      const { languages } = await loadConfig($)
      $.ui.toast(uiText(languages.ui).toast.evidenceMissing(state.change, stepTitle(step, languages.ui)))
      continue
    }
    const moved = applyOutcome(state, { step: step.id, outcome, by: 'automatic' }, await $.clock.now())
    if ('error' in moved) continue
    const final = step.cleanup && outcome === 'passou' ? withEvents(moved, await cleanupChange($, state)) : moved
    await saveFlow($, final.state, final.events)
  }
}

/** What an owner press says back: the text for the toast or the command's answer, or why nothing changed. */
type Pressed = { ok: true; text: string } | { error: string }

/**
 * Only the owner reaches this (the panel's press, or `/orquestrador aprovar` typed by them): no tool call
 * answers an owner step. When the flow lands on a step the coordinator drives, the press also wakes it with
 * a message in the mod's name. The click waits for that message; the command does not (it would hold its answer).
 */
const pressFlow = async (
  $: EngineInterface,
  change: string,
  step: string,
  outcome: string,
  note?: string,
  wait = true,
): Promise<Pressed> => {
  const { languages } = await loadConfig($)
  const t = uiText(languages.ui)
  const state = await loadFlowState($, change)
  if (state === undefined) return { error: t.command.noFlow }
  const running = state.status === 'running' && state.current === step
  if (running && step === RELEASE_STEP && outcome === RELEASE_OUTCOME) return { error: t.toast.releaseFromPlanMode }
  const at = await $.clock.now()
  const prep = running && step === MOCKUP_STEP ? pressMockup(await loadPrep($, change), outcome, note, at) : undefined
  if (prep !== undefined && 'error' in prep) return { error: t.toast.notRecorded(prep.error) }
  const noted = note === undefined || note.trim() === '' ? undefined : note.trim()
  const moved = ownerPress(state, step, outcome, at, noted)
  if ('error' in moved) return { error: t.toast.notRecorded(moved.error) }
  if (prep !== undefined) await savePrep($, state, prep, undefined)
  await saveFlow($, moved.state, moved.events)
  await refreshQuietly($)
  const wake = wakePrompt(state, moved.state, step, outcome, noted)
  if (wake !== undefined) {
    // a command's hook holds the turn the prompt would wait on: the engine refuses it there, so it goes after
    if (wait) await $.prompt.submit({ text: wake })
    else $.clock.after(WAKE_AFTER_COMMAND_MS, () => void $.prompt.submit({ text: wake }).catch(error => $.ui.log(`orchestrator: ${describeError('aviso', error)}`)))
  }
  return { ok: true, text: pressedToast(state, moved.state, step, outcome, languages.ui) }
}

/** The click's side of a press: the toast is the text, or the reason it was not recorded. */
const clickFlow = async ($: EngineInterface, change: string, step: string, outcome: string, note?: string): Promise<void> => {
  const done = await pressFlow($, change, step, outcome, note)
  $.ui.toast('error' in done ? done.error : done.text)
}

/**
 * The owner ends the flow (the second press of "Encerrar o flow", or `/orquestrador encerrar ... confirmar`).
 * Nothing is archived, the group stays, and no message goes to the coordination: the `aborted` flow stops the
 * warnings by itself. The only caller of `endFlow` besides the escalation's answer.
 */
const endByOwner = async ($: EngineInterface, change: string, note?: string): Promise<Pressed> => {
  const t = uiText((await loadConfig($)).languages.ui)
  const state = await loadFlowState($, change)
  if (state === undefined) return { error: t.command.noFlow }
  const ended = endFlow(state, await $.clock.now(), note)
  if ('error' in ended) return { error: ended.error }
  await saveFlow($, ended.state, ended.events)
  await refreshQuietly($)
  return { ok: true, text: t.command.endDone(change) }
}

/**
 * The flow this session coordinates, for the owner's subcommands: `running` or `escalated` (an escalated flow
 * is still the owner's to answer or to end), the latest started. A child of the same folder is not its coordinator.
 */
const commandFlow = async ($: EngineInterface, root: string): Promise<FlowState | undefined> => {
  const self = await selfId($).catch(() => undefined)
  return (await allFlowStates($))
    .filter(
      s =>
        (s.status === 'running' || s.status === 'escalated') &&
        ownsFlow(s, root) &&
        (s.coordinatorSession === undefined || s.coordinatorSession === self),
    )
    .sort((a, b) => b.startedAt - a.startedAt)[0]
}

/** The gates still open in the last panel view, by phase: what `status` lists and `pular-portão` can reach. */
const openGatesNow = async ($: EngineInterface): Promise<{ phase: string; gate: GateView }[]> => {
  const { value: view } = await $.state.get(VIEW)
  if (view?.run === undefined) return []
  const own = await ownCheck($)
  const skips = view.skips ?? {}
  const phases = phaseViews(view.run, view.children).flat()
  const phaseGates = phases.flatMap(phase =>
    phase.gates === undefined
      ? []
      : gateViews(phase.gates, phase.id, phase.session === undefined ? own : (phase.card?.gates ?? { records: {}, editedAt: undefined }), skips)
          .filter(isOpenGate)
          .map(gate => ({ phase: phase.id, gate })),
  )
  const check = familyCheck([own, ...view.children.map(c => c.gates ?? { records: {}, editedAt: undefined })])
  const final = gateViews(view.run.finalGates, FINAL_SCOPE, check, skips)
    .filter(isOpenGate)
    .map(gate => ({ phase: 'final', gate }))
  return [...phaseGates, ...final]
}

/** `/orquestrador <subcommand>`: the owner's chat, which the Remote Control reaches too. Plain text answers. */
const runSubcommand = async ($: EngineInterface, args: string, origin: { readonly kind: string }): Promise<string> => {
  const config = await loadConfig($)
  const t = uiText(config.languages.ui)
  const parsed = parseCommand(args)
  if (parsed.kind === 'toggle') {
    const done = await togglePane($)
    return done === 'closed' ? t.command.closed : done === 'opened' ? t.command.opened : t.command.waiting
  }
  if (!fromOwner(origin)) return t.command.notFromOwner
  if (parsed.kind === 'help') return t.command.help
  if (parsed.kind === 'unknown') return `${t.command.unknown(parsed.word)}\n${t.command.help}`
  const flow = await commandFlow($, await $.session.root())
  if (flow === undefined) {
    // no flow of this session may be a flow of a session whose id is not read yet: say the permission, not "no flow"
    const waiting = (await selfId($).catch(() => undefined)) === undefined ? await permissionWarning($) : undefined
    return waiting ?? t.command.noFlow
  }
  const change = flow.change
  switch (parsed.kind) {
    case 'status': {
      await refreshQuietly($)
      const { value: needed } = await $.state.get(PERMISSION_NEEDED)
      return statusText(
        {
          flow: flowView(flow, config.languages),
          gates: (await openGatesNow($)).map(g => `${g.phase}: ${g.gate.gate}`),
          pending: (flow.pendingStarts ?? []).map(p => p.title),
          permission: needed === null || needed === undefined ? undefined : t.warning.permission,
        },
        t.command,
      )
    }
    case 'approve': {
      // ending always asks for confirmation (C11): `aprovar encerrar` on an escalation points to the command that does
      if (flow.status === 'escalated' && parsed.outcome === 'encerrar') return t.command.approveEnd
      const done = await pressFlow($, change, flow.escalation?.step ?? flow.current, parsed.outcome, parsed.note, false)
      return 'error' in done ? done.error : done.text
    }
    case 'open': {
      if ((flow.pendingStarts ?? []).length === 0) return t.command.noPending
      const done = await openPending($, change, 'The user typed "/orquestrador abrir".')
      await refreshQuietly($)
      return t.pending.result(done.opened.length, done.left, done.why) + (done.byApp ? ` ${origin.kind === 'bridge' ? t.pending.appRefusedMobile : t.pending.appRefused}` : '')
    }
    case 'skip': {
      await refreshQuietly($)
      const hit = (await openGatesNow($)).find(g => g.phase === parsed.phase && (g.gate.gate === parsed.gate || g.gate.label === parsed.gate))
      if (hit === undefined) return t.command.skipUnknown(parsed.phase, parsed.gate)
      if (!parsed.confirmed) return t.command.skipAsk(parsed.phase, hit.gate.gate)
      await skipGate($, change, hit.gate)
      await refreshQuietly($)
      return t.command.skipDone(hit.gate.gate)
    }
    case 'end': {
      if (!parsed.confirmed) return t.command.endAsk(change, flow.escalation?.step ?? flow.current)
      const done = await endByOwner($, change, parsed.reason)
      return 'error' in done ? done.error : done.text
    }
  }
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
    $.ui.toast((await textNow($)).toast.notRecorded(done.error))
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
  const opened = await $.ui.open({ id: PANE, title: '🧭 Orchestrator' })
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
const loadFlowView = async (
  $: EngineInterface,
  run: OrchestrationRun | undefined,
  cwd: string,
  languages: Languages,
): Promise<FlowView | undefined> => {
  const state =
    run === undefined
      ? (await allFlowStates($)).filter(s => s.coordinatorCwd === cwd).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      : await loadFlowState($, run.change)
  return state === undefined ? undefined : flowView(state, languages)
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
    const line = `${JSON.stringify({ seq: state.seq, at: await $.clock.now(), ...event })}\n`
    await inFlowQueue(async () => {
      const prior = (await readText($, log)) ?? ''
      await $.fs.write(log, prior + line)
    })
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
    if (waiting.length > 1) $.ui.toast((await textNow($)).toast.severalReleases)
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
  const listed = await listCall($, LIST_SESSIONS, { linked: true, limit: 50 })
  if (listed.isError === true) return false
  const family = parseSessionRows(listed.text)
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
    await startWorkflowsLoad($)
    await $.command.register({
      name: 'orquestrador',
      description: (await textNow($)).command.description,
    })
    await $.command.register({
      name: 'orquestrador-workflows',
      description: (await textNow($)).command.workflowsDescription,
    })
    await $.tool.register({
      name: 'plan',
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
    $.clock.every(REFRESH_MS, () => void refreshQuietly($, true))
    void refreshQuietly($).then(async () => {
      const { value } = await $.state.get(VIEW)
      if (value?.run !== undefined && (await activeMode($)) !== undefined) await showPane($)
    })
    return next(e)
  })

  on('command.run', { command: 'orquestrador' }, async ($, e) => ({
    text: await runSubcommand($, e.args ?? '', e.origin).catch(error => describeError('orquestrador', error)),
  }))

  on('command.run', { command: 'orquestrador-workflows' }, async $ => {
    const done = await toggleWorkflowsPane($)
    const t = (await textNow($)).command
    return { text: done === 'closed' ? t.workflowsClosed : done === 'opened' ? t.workflowsOpened : t.workflowsWaiting }
  })

  on('ui.render', { component: 'Pane', requestId: WORKFLOWS_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const fields = e.surface === 'mobile' ? undefined : $.ui.resolve(e)
    return drawWorkflows(
      $,
      { Box, Text, Button, Input: fields?.Input, Select: fields?.Select },
      e.props.bodyColumns,
    )
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await $.state.set(PANE_OPEN, false)
    return closed
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await activeMode($, false)) === undefined) return next(e)
    const { value: view } = await $.state.get(VIEW)
    const { value: answered = [] } = await $.state.get(ANSWERED)
    const summary = view === undefined ? undefined : bandSummary(view, answered)
    const { value: needed } = await $.state.get(PERMISSION_NEEDED)
    const lang = view?.languages?.ui
    const notice = needed === null || needed === undefined ? undefined : uiText(lang).warning.permission
    if (summary === undefined && notice === undefined) return next(e)
    const { value: paneOpen = false } = await $.state.get(PANE_OPEN)
    const { Box, Text, Button } = $.ui.resolve(e)
    return renderBand({ Box, Text, Button }, summary, paneOpen, () => {
      void togglePane($).catch(() => $.ui.toast(uiText(lang).toast.paneFailed))
    }, lang, notice)
  })

  on('tool.call', async ($, e, next) => {
    const tool = e.tool as string
    if (tool === PLAN_TOOL) return publishPlan($, e as unknown as Record<string, unknown>)
    if (tool === FLOW_TOOL) return handleFlowTool($, e as unknown as Record<string, unknown>)
    const input = e as unknown as Record<string, unknown>
    const mode = await activeMode($)
    // an inactive clone is left alone; "lembrar" says what "barrar" would have refused, leaves a trace, and lets the call go
    if (mode === undefined) return next(e)
    if (touchesSettings(tool, input)) {
      return { deny: 'Orchestrator: .claude/settings.local.json is the owner\'s; only the panel (Workflows, "Este projeto") activates, switches or deactivates the orchestrator.' }
    }
    const stop = async (deny: string): Promise<{ deny: string } | undefined> => {
      if (mode === 'barrar') return { deny }
      $.ui.log(`orchestrator (lembrar): ${deny}`)
      $.ui.toast(deny)
      await noteReminded($, deny).catch(() => undefined)
      return undefined
    }
    // the gates' records are the mod's alone in every mode: a forged pass is no warning to let through
    if (touchesGateFiles(tool, input)) {
      return { deny: 'Orchestrator: the mod\'s gate records folder is written by the mod only (gate records and owner skips).' }
    }
    if (tool.endsWith(TRANSITION_SUFFIX) && approvedMove !== `${String(input.issueIdOrKey)}|${String((input.transition as { id?: unknown } | undefined)?.id)}`) {
      const held = await stop('Orchestrator: a Jira issue moves only when the owner presses "Mover no Jira" in the panel.')
      if (held !== undefined) return held
    }
    const refusal =
      tool === START_SESSION
        ? await refuseStart($)
        : tool === ARCHIVE_SESSION
          ? await refuseArchive($, input.session_id)
          : tool === 'Bash' && typeof input.command === 'string' && GH_MERGE.test(input.command)
            ? await refuseMerge($, input.command)
            : undefined
    if (refusal !== undefined) {
      const held = await stop(`Orchestrator gate: ${refusal}`)
      if (held !== undefined) return held
    }
    if (tool === 'AskUserQuestion') {
      const first = (input.questions as { question?: unknown }[] | undefined)?.[0]?.question
      await setWaiting($, { kind: 'question', text: typeof first === 'string' ? first : (await textNow($)).question })
    }
    const ran = await next(e)
    await observeGates($, tool, input, ran as CallResult & { result?: unknown }).catch(error =>
      $.ui.log(`orchestrator: ${describeError('portões', error)}`),
    )
    if (tool === 'Bash' && ran.deny === undefined && typeof input.command === 'string' && input.run_in_background !== true) {
      await observeFlows($, input.command, ran.isError === true).catch(error =>
        $.ui.log(`orchestrator: ${describeError('flow', error)}`),
      )
    }
    if (tool === 'ExitPlanMode') {
      await observeRelease($, input, ran).catch(error => $.ui.log(`orchestrator: ${describeError('liberação', error)}`))
    }
    if (tool.startsWith('mcp__ccd_session_mgmt__') || tool.startsWith('mcp__ccd_sidebar__') || tool === OPEN_SESSION) {
      return ran
    }
    if (tool.endsWith('ccd_session__start_session') && ran.deny === undefined && ran.isError !== true) {
      const change = await currentChange($, await $.session.root()).catch(() => undefined)
      const result = ran as CallResult & { result?: unknown }
      const text = result.text ?? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result ?? ''))
      const started = startedSessionId(text, await selfId($).catch(() => undefined))
      await groupQuietly($, change, started, {
        ...(input.wake_when_done === true && started !== undefined ? { track: started } : {}),
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
      })
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
    // a check the mod raised itself (mayList, or its own $.tool.call) is not the model asking: it marks no wait
    if (next.origin.plugin === PLUGIN_NAME) return next(e)
    const verdict = await next(e)
    if (verdict.decision === 'ask' && (await activeMode($)) !== undefined) await setWaiting($, { kind: 'permission', text: toolLabel(e.tool) })
    return verdict
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const { value: waiting } = await $.state.get(WAITING)
    if (waiting !== null && waiting !== undefined && (await activeMode($)) !== undefined) await setWaiting($, null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { value: loaded } = await $.state.get(VIEW)
    const { value: ownPlan = [] } = await $.state.get(PLAN)
    const base: PanelView = loaded ?? {
      self: undefined, children: [], run: undefined, updatedAt: 0, warning: undefined, repoUrl: undefined,
      openspec: undefined, jira: {}, jiraNote: undefined, skips: {},
    }
    const { value: reminded } = await $.state.get(REMINDED)
    const { value: needed } = await $.state.get(PERMISSION_NEEDED)
    const tampered = (await readActivation($).catch(() => undefined))?.tampered === true
    const warnings = [
      base.warning,
      reminded === undefined || reminded === null ? undefined : uiText(base.languages?.ui).warning.reminded(reminded.count, reminded.last),
      tampered ? uiText(base.languages?.ui).warning.tampered : undefined,
      needed === null || needed === undefined ? undefined : uiText(base.languages?.ui).warning.permission,
    ].filter(x => x !== undefined)
    const view: PanelView = warnings.length === 0 || (warnings.length === 1 && warnings[0] === base.warning) ? base : { ...base, warning: warnings.join(' · ') }
    const { value: collapsed = {} } = await $.state.get(COLLAPSED)
    const { value: answered = [] } = await $.state.get(ANSWERED)
    const { value: drafts = {} } = await $.state.get(GRILL_DRAFTS)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const ownId = view.self?.sessionId
    const t = uiText(view.languages?.ui).toast
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
          $.ui.toast(t.skipNotLoaded)
          return
        }
        void skipGate($, change, gate)
          .then(() => refreshQuietly($))
          .then(() => $.ui.toast(t.skipped(gate.label)))
          .catch(() => $.ui.toast(t.skipFailed))
      },
      answerFlow: (change, step, outcome) => () => {
        void clickFlow($, change, step, outcome).catch(() => $.ui.toast(t.flowFailed))
      },
      endFlow: change => () => {
        void endByOwner($, change)
          .then(done => $.ui.toast('error' in done ? done.error : done.text))
          .catch(() => $.ui.toast(t.flowFailed))
      },
      openPending: (change, label) => () => {
        void pressPending($, change, label, e.surface === 'mobile').catch(() => $.ui.toast(uiText(view.languages?.ui).pending.failed))
      },
      noteFlow: (change, step, outcome) => (value: string) => {
        if (value.trim() === '') {
          $.ui.toast(t.adjustEmpty)
          return
        }
        void clickFlow($, change, step, outcome, value).catch(() => $.ui.toast(t.flowFailed))
      },
      drafts,
      draftAnswer: question => (value: string) => {
        void update($, GRILL_DRAFTS, map => ({ ...(map ?? {}), [question]: value }))
      },
      answerGrill: (change, answers) => () => {
        if (answers.every(a => a.answer.trim() === '')) {
          $.ui.toast(t.answerEmpty)
          return
        }
        void answerGrill($, change, answers).catch(() => $.ui.toast(t.grillFailed))
      },
      moveJira: (change, key, transitionId) => () => {
        void pressJiraMove($, change, key, transitionId).catch(() => $.ui.toast(uiText(view.languages?.ui).jira.moveFailed(key)))
      },
      accept: (item: Attention) => () => {
        void update($, ANSWERED, list => [...(list ?? []), item.title].slice(-50))
        void $.prompt.submit({
          text: uiText(view.languages?.ui).attention.accepted(item.title, item.recommendation),
          asUser: true,
        })
      },
    })
  })
}
