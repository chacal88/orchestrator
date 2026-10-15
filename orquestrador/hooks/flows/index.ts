import type { FlowDef } from '../../types'
import { parseFlow } from '../flow'
import { completo } from './completo'
import { rapido } from './rapido'

/** The flows the mod ships, as raw JSON: each goes through parseFlow like a project's file. */
export const DEFAULT_FLOWS: readonly { source: string; raw: unknown }[] = [
  { source: 'default flow completo', raw: completo },
  { source: 'default flow rapido', raw: rapido },
]

/** The default flows parsed; one that does not parse is a bug of the mod, caught by its tests. */
export const defaultFlows = (): FlowDef[] =>
  DEFAULT_FLOWS.map(({ source, raw }) => parseFlow(raw, source)).filter((f): f is FlowDef => !('error' in f))
