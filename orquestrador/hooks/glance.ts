import type { FlowEvent, PanelView, StepTime } from '../types'
import { uiText } from './i18n'
import { attentionItems } from './model'

/**
 * When each step was last entered and, once it has an outcome, when it finished: from the flow's
 * append-only log. Entering a step again starts its clock over.
 */
export const stepTimes = (events: readonly FlowEvent[]): Record<string, StepTime> => {
  const times: Record<string, StepTime> = {}
  for (const event of events) {
    if (event.kind === 'entered') times[event.step] = { from: event.at }
    else if (event.kind === 'outcome' && times[event.step] !== undefined) {
      times[event.step] = { from: times[event.step]!.from, to: event.at }
    }
  }
  return times
}

/** The flow's log, one JSON event per line; a torn or foreign line is skipped. */
export const parseEvents = (text: string | undefined): FlowEvent[] =>
  (text ?? '').split('\n').flatMap((line): FlowEvent[] => {
    if (line.trim() === '') return []
    try {
      const event = JSON.parse(line) as FlowEvent
      return typeof event.step === 'string' && typeof event.at === 'number' ? [event] : []
    } catch {
      return []
    }
  })

/** How long, the way the app's background-tasks list says it: "40 s", "12 min", "2 h 5 min". */
export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
}

export type BandSummary = {
  /** The flow's current step in the owner's words, or where it ended. */
  step: string | undefined
  inFlight: number
  waiting: number
}

/** What the thin band above the prompt says; undefined when this session orchestrates nothing. */
export const bandSummary = (view: PanelView, answered: readonly string[]): BandSummary | undefined => {
  if (view.flow === undefined && view.run === undefined) return undefined
  const flow = view.flow
  const step =
    flow === undefined
      ? undefined
      : flow.status === 'done'
        ? uiText(view.languages?.ui).band.flowDone
        : flow.status === 'aborted'
          ? uiText(view.languages?.ui).band.flowAborted
          : flow.current?.title
  const inFlight = (view.run?.waves ?? []).flatMap(w => w.phases).filter(p => p.status === 'running' || p.status === 'blocked').length
  const waiting = attentionItems(view).filter(a => a.kind === 'flow' || !answered.includes(a.title)).length
  return { step, inFlight, waiting }
}
