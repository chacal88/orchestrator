import type { AgentRun, GateAttempt, GateCheck, GateRecord, SessionCard } from '../types'
import { keepAttempt, mergeRecords } from './gates'

/**
 * Phases and session steps run as subagents of the coordination (the Agent tool), not as sessions of the app.
 * The app opens a session only in a turn the owner typed, so a session per phase made the owner type or press
 * for every phase; a subagent starts in any turn, and the engine wakes the coordination when it ends.
 *
 * The coordination names each one: `fase-<id>` for a phase of the loop (`fase-4.6`), `passo-<step>` for a
 * session step (`passo-planejar`). The mod keeps the name by the agent's id, so each tool call the subagent
 * makes (its `agentId`) counts for that phase's gates and not for the coordination's own.
 */
const PHASE_NAME = /^(?:fase|phase)[-_ ]+([\w.]+)$/i
const STEP_NAME = /^(?:passo|step)[-_ ]+([\w.-]+)$/i
/** A reviewer the coordination runs for a phase: `revisao-fase-4`, `review-phase-4`, or "fase 4" in its description. */
const REVIEW_NAME = /^(?:revis[aã]o|review)[-_ ]+(?:fase|phase)[-_ ]+([\w.]+)$/i
const REVIEW_DESCRIPTION = /\b(?:fase|phase)\s+([\d]+(?:\.[\d]+)*)\b/i

/** The phase or step a subagent's name says it runs, or undefined for any other subagent. */
export const agentRole = (name: string | undefined): { kind: 'phase' | 'step'; key: string } | undefined => {
  const text = (name ?? '').trim()
  const phase = text.match(PHASE_NAME)?.[1]
  if (phase !== undefined) return { kind: 'phase', key: phase }
  const step = text.match(STEP_NAME)?.[1]
  return step === undefined ? undefined : { kind: 'step', key: step }
}

/** The phase a reviewer reviews, by its name first and then its description; undefined when it names none. */
export const reviewedPhase = (name: string | undefined, description: string | undefined): string | undefined =>
  (name ?? '').trim().match(REVIEW_NAME)?.[1] ?? (description ?? '').match(REVIEW_DESCRIPTION)?.[1]

/** The subagent of the latest run for a phase (a phase run again keeps only the newest). */
export const latestFor = (agents: Readonly<Record<string, AgentRun>>, change: string | undefined, phase: string): string | undefined =>
  Object.entries(agents)
    .filter(([, run]) => run.kind === 'phase' && run.key === phase && (change === undefined || run.change === undefined || run.change === change))
    .sort((a, b) => b[1].at - a[1].at)[0]?.[0]

/** What a finished call of the subagent proves, folded into its own record. */
export const recordAgentCall = (
  run: AgentRun,
  observed: readonly GateRecord[],
  attempt: GateAttempt | undefined,
  editedAt: number | undefined,
): AgentRun => ({
  ...run,
  gates: observed.length === 0 ? run.gates : mergeRecords(run.gates, observed),
  ...(editedAt === undefined ? {} : { editedAt }),
  ...(attempt === undefined ? {} : { tried: keepAttempt(run.tried ?? [], attempt) }),
})

export const agentCheck = (run: AgentRun): GateCheck => ({ records: run.gates, editedAt: run.editedAt, tried: run.tried ?? [] })

/** Whether the engine still runs the subagent: started, running or holding on its own background work. */
export const isLive = (status: string | undefined): boolean => status === 'pending' || status === 'running' || status === 'waiting'

/**
 * A phase subagent as the panel and the phase's close read it: a card named like the subagent, so the phase
 * whose `session` is `fase-<id>` (or none at all) finds it, with the subagent's own gates. It is no session of
 * the app: nothing archives it, and it opens nothing beside the coordination.
 */
export const agentCard = (id: string, run: AgentRun, status: string | undefined, cwd: string): SessionCard => ({
  sessionId: id,
  title: run.description === '' ? run.name : `${run.name}: ${run.description}`,
  cwd,
  branch: undefined,
  isRunning: isLive(status),
  isArchived: false,
  prNumber: undefined,
  prState: undefined,
  lastActivityAt: undefined,
  name: run.name,
  startedBy: undefined,
  link: undefined,
  groupId: undefined,
  groupName: undefined,
  agent: true,
  plan: [],
  lastTool: undefined,
  waiting: undefined,
  hasActivity: true,
  gates: agentCheck(run),
})

/** The subagents of phases still running, for the ceiling: at most this many at once. */
export const livePhaseAgents = (
  agents: Readonly<Record<string, AgentRun>>,
  statuses: ReadonlyMap<string, string>,
): string[] =>
  Object.entries(agents)
    .filter(([id, run]) => run.kind === 'phase' && isLive(statuses.get(id)))
    .sort((a, b) => a[1].at - b[1].at)
    .map(([, run]) => run.name)

/** How many subagent runs the session keeps: the oldest go first. */
export const MAX_AGENT_RUNS = 40

export const keepRuns = (agents: Readonly<Record<string, AgentRun>>): Record<string, AgentRun> =>
  Object.fromEntries(
    Object.entries(agents)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_AGENT_RUNS),
  )
