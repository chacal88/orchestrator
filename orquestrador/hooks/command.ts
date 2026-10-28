import type { FlowView } from '../types'
import type { UiText } from './i18n'

/** What the owner typed after `/orquestrador`. */
export type Command =
  | { kind: 'toggle' }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'open' }
  | { kind: 'approve'; outcome: string; note?: string }
  | { kind: 'skip'; phase: string; gate: string; confirmed: boolean }
  | { kind: 'end'; reason?: string; confirmed: boolean }
  | { kind: 'unknown'; word: string }

const CONFIRM = 'confirmar'

/** The words of a line, the first one lowercased: the subcommand. */
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

/** No argument toggles the panel; each subcommand has one form, and anything else is `unknown` (the help). */
export const parseCommand = (args: string): Command => {
  const { word, rest } = split(args)
  switch (word) {
    case '':
      return { kind: 'toggle' }
    case 'status':
      return { kind: 'status' }
    case 'ajuda':
    case 'help':
      return { kind: 'help' }
    case 'abrir':
      return { kind: 'open' }
    case 'aprovar': {
      const outcome = split(rest)
      if (outcome.word === '') return { kind: 'unknown', word }
      return { kind: 'approve', outcome: outcome.word, ...(outcome.rest === '' ? {} : { note: outcome.rest }) }
    }
    case 'pular-portão':
    case 'pular-portao': {
      const { text, confirmed } = confirmation(rest)
      const [phase, gate, ...extra] = text.split(/\s+/)
      if (phase === undefined || phase === '' || gate === undefined || extra.length > 0) return { kind: 'unknown', word }
      return { kind: 'skip', phase, gate, confirmed }
    }
    case 'encerrar': {
      const { text, confirmed } = confirmation(rest)
      return { kind: 'end', ...(text === '' ? {} : { reason: text }), confirmed }
    }
    default:
      return { kind: 'unknown', word }
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
