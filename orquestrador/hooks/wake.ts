import type { OrchestrationRun, SessionRow } from '../types'
import { inPlan } from './model'

/** What the mod last saw of a child: running or not, its last activity, and the stop already told. */
export type Seen = { running: boolean; activity?: string; told?: string }

/**
 * The children whose end of turn wakes the coordination: not archived, not the coordination itself, and
 * opened by it (`startedBy`) or tied to a phase of its published plan. The rest of the group stays out.
 */
export const eligibleChildren = <R extends SessionRow>(run: OrchestrationRun | undefined, self: string, children: readonly R[]): R[] =>
  children.filter(row => !row.isArchived && row.sessionId !== self && (row.startedBy === self || inPlan(run, row)))

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

/** The title the panel shows for a session. */
export const sessionTitle = (row: SessionRow): string => row.name ?? row.title

/**
 * Whether the stop goes as the owner's own words. Off: the mod tells a fact, like the click's prompt. The
 * plan B of `design.md`, should the app refuse `user_asked` after it: turn this on, and the text says it is
 * the panel speaking for the owner's option.
 */
export const STOP_AS_USER = false

/** What the coordination reads when children ended their turn: in pt-BR, like the click's `wakePrompt`. */
export const stopPrompt = (titles: readonly string[], asUser = STOP_AS_USER): string => {
  const head = asUser ? 'Painel (opção "Seguir o flow sem clique" ligada por mim):' : 'Painel:'
  return titles.length === 1
    ? `${head} a sessão "${titles[0]}" terminou o turno. Siga o flow.`
    : `${head} as sessões ${titles.map(t => `"${t}"`).join(', ')} terminaram o turno. Siga o flow.`
}
