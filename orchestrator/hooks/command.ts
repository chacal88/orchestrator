import type { FlowActor, FlowState, FlowView } from '../types'
import { FLOW_END, escalationChoices } from './flow'
import { NEXT_STEP } from './flows/library'
import type { UiText } from './i18n'

/** The plugin's chat commands, each `/orchestrator:<action>` (a `commands/<action>.md` the mod answers). */
export const ACTIONS = ['status', 'approve', 'reject', 'open', 'skip-gate', 'end', 'panel', 'workflows', 'help'] as const

export type Action = (typeof ACTIONS)[number]

/**
 * What the owner asked for with `/orchestrator:<action> <args>`. No word is ever required: the text after
 * approve, reject and end is a free note, and skip-gate takes only the number of a listed gate.
 */
export type Command =
  | { kind: 'toggle' }
  | { kind: 'workflows' }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'open' }
  | { kind: 'approve'; note?: string }
  | { kind: 'reject'; note?: string }
  /** Without `n` (nothing typed, or not a number) the answer is the numbered list. */
  | { kind: 'skip'; n?: number }
  | { kind: 'end'; reason?: string }

/** How long a `skip-gate N` waits for its repetition. */
export const SKIP_CONFIRM_MS = 120_000

const noted = <K extends string>(key: K, text: string): Partial<Record<K, string>> =>
  (text === '' ? {} : { [key]: text }) as Partial<Record<K, string>>

/** The line after the command, read for its action. */
export const parseAction = (action: Action, args: string): Command => {
  const text = args.trim()
  switch (action) {
    case 'panel':
      return { kind: 'toggle' }
    case 'workflows':
      return { kind: 'workflows' }
    case 'status':
      return { kind: 'status' }
    case 'help':
      return { kind: 'help' }
    case 'open':
      return { kind: 'open' }
    case 'approve':
      return { kind: 'approve', ...noted('note', text) }
    case 'reject':
      return { kind: 'reject', ...noted('note', text) }
    case 'skip-gate':
      return /^\d+$/.test(text) && Number(text) > 0 ? { kind: 'skip', n: Number(text) } : { kind: 'skip' }
    case 'end':
      return { kind: 'end', ...noted('reason', text) }
  }
}

/**
 * The outcome `approve` (forward) or `reject` (adjust) presses at the current step, by where each outcome
 * leads in the flow's own step list: forward is a later step, the end or `$seguinte`; adjust is this step or
 * an earlier one. The first declared wins, the order of the panel's buttons. An escalation goes forward by
 * trying again, and has no adjustments.
 */
export const pickOutcome = (state: FlowState, direction: 'forward' | 'adjust'): { outcome: string } | { none: true } => {
  if (state.status === 'escalated') return direction === 'forward' ? { outcome: escalationChoices()[0]!.outcome } : { none: true }
  const steps = state.flow.steps
  const at = steps.findIndex(s => s.id === state.current)
  const step = steps[at]
  if (step === undefined) return { none: true }
  const where = (next: string): 'forward' | 'adjust' | undefined => {
    if (next === FLOW_END || next === NEXT_STEP) return 'forward'
    const index = steps.findIndex(s => s.id === next)
    return index === -1 ? undefined : index > at ? 'forward' : 'adjust'
  }
  const hit = Object.entries(step.outcomes).find(([, o]) => where(o.next) === direction)
  return hit === undefined ? { none: true } : { outcome: hit[0] }
}

/**
 * The person's own typing: Enter at the prompt or the Remote Control bridge. A list, not "anything but a
 * plugin": a peer, a trigger or a notification is not the owner typing.
 */
export const fromOwner = (origin: { readonly kind: string } | undefined): boolean => origin?.kind === 'composer' || origin?.kind === 'bridge'

/** One open gate as the owner reads it: where it is and its id. */
export type OpenGate = { phase: string; gate: string }

/** "fase 2: testes" or "final: check". */
export const gateLabel = ({ phase, gate }: OpenGate, t: UiText['command']): string => `${phase === 'final' ? t.finalScope : t.phase(phase)}: ${gate}`

/** The answer to `skip-gate` with no number, or one the list does not have: the gates numbered, and how to skip one. */
export const gateList = (gates: readonly OpenGate[], t: UiText['command']): string =>
  gates.length === 0 ? t.noGates : [t.gatesHead, ...gates.map((g, i) => `${i + 1}. ${gateLabel(g, t)}`), t.skipHow(gates.length)].join('\n')

export type StatusInput = {
  flow: FlowView | undefined
  /** Whether the current step has an outcome `reject` presses. */
  canAdjust: boolean
  gates: readonly OpenGate[]
  pending: readonly string[]
  /** The notice that the session tools wait on the owner, when they do. */
  permission: string | undefined
}

/** Who answers a step that is not the owner's, in the owner's words. */
export const answerer = (actor: FlowActor | undefined, t: UiText['command']): string => t.who[actor ?? 'session']

/**
 * The answer to `status`: short lines, no table and no markdown beyond the words (the phone is narrow). The
 * commands that move the flow are spelled out whole, so the owner never has to guess a word to type.
 */
export const statusText = ({ flow, canAdjust, gates, pending, permission }: StatusInput, t: UiText['command']): string => {
  if (flow === undefined) return t.noFlow
  const mine = flow.ownerChoices.length > 0
  const escalated = flow.status === 'escalated'
  const lines = [
    t.statusFlow(flow.change, flow.flowTitle, t.statusWord[flow.status]),
    flow.current === undefined ? undefined : t.statusStep(flow.current.title, mine ? t.who.owner : answerer(flow.waitingOn, t)),
    mine ? (escalated ? t.toRetry : t.toApprove) : undefined,
    mine && canAdjust && !escalated ? t.toReject : undefined,
    escalated ? t.toEnd : undefined,
    gates.length === 0 ? undefined : t.statusGates(gates.map(g => gateLabel(g, t)).join(', ')),
    pending.length === 0 ? undefined : t.statusPending(pending.join(', ')),
    permission,
  ]
  return lines.filter((line): line is string => line !== undefined).join('\n')
}
