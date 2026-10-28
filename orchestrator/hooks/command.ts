import type { FlowView } from '../types'
import type { UiText } from './i18n'

/** The plugin's chat commands, each `/orchestrator:<action>` (a `commands/<action>.md` the mod answers). */
export const ACTIONS = ['status', 'approve', 'reject', 'open', 'skip-gate', 'end', 'panel', 'workflows', 'help'] as const

export type Action = (typeof ACTIONS)[number]

/** What the owner asked for with `/orchestrator:<action> <args>`. */
export type Command =
  | { kind: 'toggle' }
  | { kind: 'workflows' }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'open' }
  | { kind: 'approve'; outcome: string; note?: string }
  | { kind: 'reject'; note?: string }
  | { kind: 'skip'; phase: string; gate: string; confirmed: boolean }
  | { kind: 'end'; reason?: string; confirmed: boolean }
  | { kind: 'usage'; action: Action }

const CONFIRM = 'confirmar'

/** The words of a line, the first one lowercased. */
const split = (args: string): { word: string; rest: string } => {
  const text = args.trim()
  const space = text.search(/\s/)
  return space === -1 ? { word: text.toLowerCase(), rest: '' } : { word: text.slice(0, space).toLowerCase(), rest: text.slice(space).trim() }
}

/** The line without its closing `confirmar`, and whether it had one. */
const confirmation = (rest: string): { text: string; confirmed: boolean } => {
  const words = rest.split(/\s+/).filter(w => w !== '')
  const confirmed = words.at(-1)?.toLowerCase() === CONFIRM
  return { text: (confirmed ? words.slice(0, -1) : words).join(' '), confirmed }
}

/** The line after the command, read for its action; a line the action cannot take is `usage` (the help). */
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
    case 'approve': {
      const { word, rest } = split(text)
      if (word === '') return { kind: 'usage', action }
      return { kind: 'approve', outcome: word, ...(rest === '' ? {} : { note: rest }) }
    }
    case 'reject':
      return { kind: 'reject', ...(text === '' ? {} : { note: text }) }
    case 'skip-gate': {
      const { text: words, confirmed } = confirmation(text)
      const [phase, gate, ...extra] = words.split(/\s+/)
      if (phase === undefined || phase === '' || gate === undefined || extra.length > 0) return { kind: 'usage', action }
      return { kind: 'skip', phase, gate, confirmed }
    }
    case 'end': {
      const { text: reason, confirmed } = confirmation(text)
      return { kind: 'end', ...(reason === '' ? {} : { reason }), confirmed }
    }
  }
}

/**
 * The person's own typing: Enter at the prompt or the Remote Control bridge. A list, not "anything but a
 * plugin": a peer, a trigger or a notification is not the owner typing.
 */
export const fromOwner = (origin: { readonly kind: string } | undefined): boolean => origin?.kind === 'composer' || origin?.kind === 'bridge'

export type StatusInput = {
  flow: FlowView | undefined
  /** Labels of the gates still open ("fase 2: testes"). */
  gates: readonly string[]
  pending: readonly string[]
  /** The notice that the session tools wait on the owner, when they do. */
  permission: string | undefined
}

/** The answer to `status`: short lines, no table and no markdown beyond the words (the phone is narrow). */
export const statusText = ({ flow, gates, pending, permission }: StatusInput, t: UiText['command']): string => {
  if (flow === undefined) return t.noFlow
  const lines = [
    t.statusFlow(flow.change, flow.flowTitle, flow.status),
    flow.current === undefined ? undefined : t.statusStep(flow.current.title),
    flow.ownerChoices.length === 0 ? undefined : t.statusChoices(flow.ownerChoices.map(c => c.outcome).join(', ')),
    gates.length === 0 ? undefined : t.statusGates(gates.join(', ')),
    pending.length === 0 ? undefined : t.statusPending(pending.join(', ')),
    permission,
  ]
  return lines.filter((line): line is string => line !== undefined).join('\n')
}
