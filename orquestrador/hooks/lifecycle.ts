import type { FlowEvent, FlowState, GateView, OrchestrationRun, PhaseClosure, SessionRow, TaskItem } from '../types'
import { LOOP_DONE, applyOutcome, currentStep } from './flow'
import type { Moved } from './flow'
import { phaseRefusal } from './gates'
import { parseTaskItems, tasksForPhase } from './openspec'

/**
 * One phase the executar loop runs: a phase of the published plan (its tasks, gates and session),
 * or, with no plan, a numbered section of tasks.md ("## 4. …" holds 4.1, 4.2…).
 */
export type LoopUnit = {
  id: string
  title: string
  tasks: TaskItem[]
  gates: string[] | undefined
  session: string | undefined
}

/** The `## N. Title` headings of tasks.md, by section number. */
const sectionTitles = (tasks: string): Map<string, string> =>
  new Map(
    tasks.split('\n').flatMap(line => {
      const m = line.match(/^##\s+(\d+)\.?\s+(.+?)\s*$/)
      return m === null ? [] : [[m[1] ?? '', (m[2] ?? '').trim()] as [string, string]]
    }),
  )

/** The phases of the loop: the plan's when it names any, else the numbered sections of tasks.md. */
export const loopUnits = (run: OrchestrationRun | undefined, tasks: string | undefined): LoopUnit[] => {
  const items = tasks === undefined ? [] : parseTaskItems(tasks)
  const phases = run?.waves.flatMap(w => w.phases) ?? []
  if (phases.length > 0) {
    return phases.map(p => ({ id: p.id, title: p.title, tasks: tasksForPhase(p.tasks, items), gates: p.gates, session: p.session }))
  }
  const titles = tasks === undefined ? new Map<string, string>() : sectionTitles(tasks)
  const sections = [...new Set(items.map(i => i.id.split('.')[0] ?? ''))]
  return sections.map(n => ({
    id: n,
    title: titles.get(n) ?? `Seção ${n}`,
    tasks: items.filter(i => i.id.startsWith(`${n}.`)),
    gates: undefined,
    session: undefined,
  }))
}

/** Why a phase cannot close yet: tasks left unticked in tasks.md, then its open gates. */
export const unitRefusal = (unit: LoopUnit, openGates: readonly GateView[], where: string): string | undefined => {
  const open = unit.tasks.filter(t => !t.done).map(t => t.id)
  const tasks =
    open.length === 0
      ? undefined
      : `phase ${unit.id} (${unit.title}) cannot close: tasks ${open.join(', ')} are not ticked in tasks.md.`
  const gates = phaseRefusal(unit, openGates, where)
  return tasks === undefined && gates === undefined ? undefined : [tasks, gates].filter(Boolean).join(' ')
}

/** A closed phase stays closed while every one of its tasks is ticked; a new unticked task reopens it. */
export const isClosed = (state: FlowState, unit: LoopUnit): boolean =>
  state.closed?.[unit.id] !== undefined && unit.tasks.every(t => t.done)

/** Whether the flow sits on a running loop step, the only time a phase may close. */
export const loopRefusal = (state: FlowState): string | undefined => {
  const step = currentStep(state)
  if (state.status !== 'running' || step === undefined) return `the flow of ${state.change} is ${state.status}; no phase closes now.`
  if (step.kind !== 'loop') return `the flow of ${state.change} is on "${step.id}" (${step.title}), not on the phase loop.`
  return undefined
}

/** Records one closed phase and, when the mod archived it, its session; both go to the flow log. */
export const closePhase = (
  state: FlowState,
  unit: LoopUnit,
  done: { session: string | undefined; archived: boolean; note?: string },
  at: number,
): Moved => {
  const step = state.current
  const closure: PhaseClosure = {
    at,
    tasks: unit.tasks.map(t => t.id),
    ...(done.session === undefined ? {} : { session: done.session }),
    archived: done.archived,
  }
  const events: FlowEvent[] = [
    { seq: state.seq + 1, at, kind: 'phase-closed', step, by: 'mod', note: `${unit.id} ${unit.title}`.trim() },
  ]
  if (done.session !== undefined) {
    events.push({
      seq: state.seq + 2,
      at,
      kind: 'session-archived',
      step,
      by: 'mod',
      note: done.archived ? `${unit.id}: ${done.session}` : `${unit.id}: ${done.session} not archived — ${done.note ?? 'unknown'}`,
    })
  }
  return {
    state: { ...state, closed: { ...state.closed, [unit.id]: closure }, seq: state.seq + events.length, updatedAt: at },
    events,
  }
}

/** The loop ends, by the mod, once every phase is closed; until then the phases still open. */
export const finishLoop = (state: FlowState, units: readonly LoopUnit[], at: number): Moved | { open: LoopUnit[] } | { error: string } => {
  const refusal = loopRefusal(state)
  if (refusal !== undefined) return { error: refusal }
  if (units.length === 0) return { error: 'the change has no plan phases and no numbered tasks in tasks.md, so no phase can close.' }
  const open = units.filter(u => !isClosed(state, u))
  if (open.length > 0) return { open }
  return applyOutcome(state, { step: state.current, outcome: LOOP_DONE, by: 'mod', note: `${units.length} phase(s) closed` }, at)
}

/** `git status --porcelain` output: the paths with uncommitted changes, none when clean. */
export const uncommitted = (porcelain: string): string[] =>
  porcelain
    .split('\n')
    .map(line => line.slice(3).trim())
    .filter(path => path !== '')

/**
 * The change's phase sessions still alive in its sidebar group: those started by another member
 * of the group (the coordinator), never this session itself. A session in the coordinator's own
 * folder is a side chat the owner opened, not a phase: phases run in worktrees of their own.
 */
export const phaseSessions = (rows: readonly SessionRow[], selfId: string | undefined, coordinatorCwd: string): SessionRow[] => {
  const members = new Set(rows.map(r => r.sessionId))
  return rows.filter(
    r =>
      !r.isArchived &&
      r.sessionId !== selfId &&
      r.cwd !== coordinatorCwd &&
      r.startedBy !== undefined &&
      members.has(r.startedBy),
  )
}

/** Puts `extra` events before the flow's closing `done` event, renumbered in order. */
export const withEvents = (moved: Moved, extra: readonly Omit<FlowEvent, 'seq'>[]): Moved => {
  if (extra.length === 0) return moved
  const done = moved.events.findIndex(e => e.kind === 'done')
  const at = done < 0 ? moved.events.length : done
  const first = moved.events[0]?.seq ?? moved.state.seq + 1
  const events = [...moved.events.slice(0, at), ...extra, ...moved.events.slice(at)].map((e, i) => ({ ...e, seq: first + i }))
  return { state: { ...moved.state, seq: first + events.length - 1 }, events }
}
