import type { OrchestrationRun, SessionRow } from '../types'
import { inPlan } from './model'

/** What the mod last saw of a child: running or not, its last activity, and the stop already told. */
export type Seen = { running: boolean; activity?: string; told?: string }

/**
 * The children whose end of turn wakes the coordination: not archived, not the coordination itself, and
 * kept in the current flow's `sessions` or tied to a phase of its plan. The children of an earlier change
 * (`earlier`, or another flow's `sessions`) never count, even when the plan names them.
 */
export const eligibleChildren = <R extends SessionRow>(
  run: OrchestrationRun | undefined,
  flow: { sessions?: readonly string[]; excluded?: readonly string[] },
  self: string,
  children: readonly R[],
): R[] => {
  const own = new Set(flow.sessions ?? [])
  const excluded = new Set(flow.excluded ?? [])
  return children.filter(
    row => !row.isArchived && row.sessionId !== self && !excluded.has(row.sessionId) && (own.has(row.sessionId) || inPlan(run, row)),
  )
}

/**
 * How far the flow went, for the brake against a loop: its `seq` moves only on a report, but inside the
 * `executar` loop it stands still from phase to phase, so the phases closed in the flow and the phases done
 * in its plan count too. The sessions it adopted do not: a coordination that opens a new child on each stop
 * would move the key forever without the flow going anywhere. Nor does the plan's `updatedAt`: republishing
 * the same plan is not progress.
 */
export const flowProgress = (
  flow: { seq: number; closed?: Record<string, unknown> },
  run: OrchestrationRun | undefined,
): string => {
  const done = (run?.waves ?? []).flatMap(wave => wave.phases).filter(phase => phase.status === 'done').length
  return [flow.seq, Object.keys(flow.closed ?? {}).length, done].join('|')
}

/**
 * The children that ended a turn since the last look. A child seen for the first time is only recorded, so
 * turning the option on (or an app restart) never tells old stops. A stop is a child not running now that
 * was running before, or whose last activity moved (a short turn between two looks); `told` keeps the stop
 * already told, so the same stop seen twice is told once. Only the rows given are kept.
 */
export const childStops = <R extends SessionRow>(
  seen: Readonly<Record<string, Seen>>,
  rows: readonly R[],
  now: number,
): { seen: Record<string, Seen>; stopped: R[] } => {
  const next: Record<string, Seen> = {}
  const stopped: R[] = []
  for (const row of rows) {
    const before = seen[row.sessionId]
    const base: Seen = { running: row.isRunning, ...(row.lastActivityAt === undefined ? {} : { activity: row.lastActivityAt }) }
    if (before === undefined) {
      next[row.sessionId] = base
      continue
    }
    const moved = row.lastActivityAt !== undefined && row.lastActivityAt !== before.activity
    const mark = row.lastActivityAt ?? String(now)
    if (!row.isRunning && (before.running || moved) && before.told !== mark) {
      stopped.push(row)
      next[row.sessionId] = { ...base, told: mark }
    } else {
      next[row.sessionId] = { ...base, ...(before.told === undefined ? {} : { told: before.told }) }
    }
  }
  return { seen: next, stopped }
}

/**
 * How the stop names a child: its id only, kept to the characters of an id. The prompt is taken as the
 * owner's turn, so nothing a session can write (its title) goes in it; the coordination reads the rest in
 * `flow status`.
 */
export const cleanRef = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)

export const sessionRef = (row: SessionRow): string => cleanRef(row.sessionId)

/**
 * The children the mod still tells about: the ones the app does not follow. A child opened with
 * `wake_when_done` (kept in the flow's `tracked`) wakes the coordination by the app itself, so the mod's
 * stop would tell it twice.
 */
export const untracked = (ids: readonly string[], tracked: readonly string[] | undefined): string[] => {
  // `tracked` keeps the raw ids and `ids` the cleaned ones (`sessionRef`): both sides are compared cleaned
  const followed = new Set((tracked ?? []).map(cleanRef))
  return ids.filter(id => !followed.has(cleanRef(id)))
}

/**
 * Whether the stop goes as the owner's own words. Off: the mod tells a fact, like the click's prompt. The
 * plan B of `design.md`, should the app refuse `user_asked` after it: turn this on, and the text says it is
 * the panel speaking for the owner's option.
 */
export const STOP_AS_USER = false

/** What the coordination reads when children ended their turn, by id: in pt-BR, like the click's `wakePrompt`. */
export const stopPrompt = (ids: readonly string[], asUser = STOP_AS_USER): string => {
  const head = asUser ? 'Painel (opção "Seguir o flow sem clique" ligada por mim):' : 'Painel:'
  return ids.length === 1
    ? `${head} a sessão ${ids[0]} terminou o turno. Confira no flow status e siga o flow.`
    : `${head} as sessões ${ids.join(', ')} terminaram o turno. Confira no flow status e siga o flow.`
}
