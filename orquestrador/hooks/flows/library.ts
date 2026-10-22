import { completo } from './completo'
import { rapido } from './rapido'

/** Where an added step's forward outcome leads before it is placed: the step that came after its anchor. */
export const NEXT_STEP = '$seguinte'

type RawStep = Record<string, unknown>
type Build = (changes: RawStep) => RawStep

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const revisaoPr: Build = () => ({
  id: 'revisao-pr',
  title: 'Revisão do PR',
  description: 'O dono revisa e aprova o PR no GitHub.',
  kind: 'owner',
  details: {
    inputs: 'O PR aberto da change, com o CI rodando.',
    produces: 'O PR aprovado no GitHub.',
    blocks: 'Sem a aprovação, nada é mergeado.',
  },
  outcomes: { aprovado: { label: 'PR aprovado', next: NEXT_STEP } },
})

/** The owner merges (and the mod sees `gh pr merge`), or with `auto` the coordinator runs it. */
const merge: Build = changes => {
  const config = { branch: 'main', method: 'squash', auto: false, ...(isRecord(changes.merge) ? changes.merge : {}) }
  const id = typeof changes.id === 'string' ? changes.id : 'merge'
  const shared = {
    id,
    title: `Merge em ${String(config.branch)}`,
    description: `O PR da change entra em ${String(config.branch)} por ${String(config.method)}.`,
    agent: 'merge',
    merge: config,
    details: {
      inputs: 'O PR aprovado no GitHub, o CI verde e os portões finais passados.',
      produces: `O PR mergeado em ${String(config.branch)}.`,
      blocks: 'Sem aprovação ou com o CI vermelho, não há merge; nunca com --admin.',
    },
  }
  return config.auto === true
    ? {
        ...shared,
        kind: 'automatic',
        command: 'gh pr merge',
        outcomes: { passou: { label: 'Mergeado', next: NEXT_STEP }, falhou: { label: 'Falhou', next: id } },
      }
    : {
        ...shared,
        kind: 'owner',
        detect: { commands: ['gh pr merge'], outcome: 'feito' },
        outcomes: { feito: { label: 'Merge feito', next: NEXT_STEP } },
      }
}

/**
 * The deploy after the merge, by the CI and/or routines. The mod ticks each part it sees done and
 * moves the step on with all of them; `command` only names where an automatic one starts.
 */
const deploy: Build = changes => {
  const config = { ci: true, commands: [] as unknown[], auto: false, ...(isRecord(changes.deploy) ? changes.deploy : {}) }
  const commands = Array.isArray(config.commands) ? config.commands : [config.commands]
  const id = typeof changes.id === 'string' ? changes.id : 'deploy'
  const shared = {
    id,
    title: 'Deploy',
    description: 'A change é publicada depois do merge: pelo CI, por rotinas, ou pelos dois.',
    agent: 'deploy',
    deploy: config,
    details: {
      inputs: 'O merge feito.',
      produces: 'O deploy confirmado: o do CI concluído e cada rotina com saída 0, na ordem.',
      blocks: 'Uma rotina que falha segura o passo; o dono decide.',
    },
  }
  return config.auto === true
    ? {
        ...shared,
        kind: 'automatic',
        command: config.ci === false && typeof commands[0] === 'string' ? commands[0] : 'gh run watch',
        outcomes: { passou: { label: 'Publicado', next: NEXT_STEP }, falhou: { label: 'Falhou', next: id } },
      }
    : { ...shared, kind: 'owner', outcomes: { publicado: { label: 'Deploy concluído', next: NEXT_STEP } } }
}

/** A default flow's step, reusable: its first outcome (the forward one) leads to whatever follows it. */
const fromDefault =
  (step: RawStep): Build =>
  () => {
    const copy = JSON.parse(JSON.stringify(step)) as RawStep
    const outcomes = copy.outcomes as Record<string, { next: string }>
    const first = Object.values(outcomes)[0]
    if (first !== undefined) first.next = NEXT_STEP
    return copy
  }

const defaultSteps = [completo, rapido].flatMap(f => (f as { steps: RawStep[] }).steps)

/** The steps a project flow may add by id, or use as the start of its own. */
export const LIBRARY: Readonly<Record<string, Build>> = {
  ...Object.fromEntries(defaultSteps.reverse().map(s => [s.id as string, fromDefault(s)])),
  'revisao-pr': revisaoPr,
  merge,
  deploy,
}

/** Outcomes of a new step that declares none, by kind. */
const FIRST_OUTCOMES: Record<string, (id: string) => RawStep> = {
  session: () => ({ pronto: { label: 'Pronto', next: NEXT_STEP } }),
  owner: () => ({ feito: { label: 'Feito', next: NEXT_STEP } }),
  automatic: id => ({ passou: { label: 'Passou', next: NEXT_STEP }, falhou: { label: 'Falhou', next: id } }),
  loop: () => ({ concluidas: { label: 'Fases concluídas', next: NEXT_STEP } }),
}

/** `b` laid over `a`: objects merge key by key, at every depth; anything else replaces. */
export const overlay = (a: unknown, b: unknown): unknown =>
  isRecord(a) && isRecord(b) ? { ...a, ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, overlay(a[k], v)])) } : b

/**
 * An `add`'s step: a library id, `{ use: <library id>, ...changes }` (the changes laid over the
 * library's step, which reads its `id`, `merge` or `deploy` from them), or a whole step of its own.
 */
export const libraryStep = (spec: unknown): RawStep | string => {
  const ids = Object.keys(LIBRARY).join(', ')
  if (typeof spec === 'string') {
    const build = LIBRARY[spec]
    return build === undefined ? `"${spec}" is no step of the library (${ids}).` : build({})
  }
  if (!isRecord(spec)) return '`step` is a library id, { use, ... } or a whole step.'
  const { use, ...changes } = spec
  if (use !== undefined) {
    const build = typeof use === 'string' ? LIBRARY[use] : undefined
    if (build === undefined) return `"${String(use)}" is no step of the library (${ids}).`
    return overlay(build(changes), changes) as RawStep
  }
  if (changes.outcomes !== undefined) return changes
  const first = typeof changes.kind === 'string' ? FIRST_OUTCOMES[changes.kind] : undefined
  return first === undefined ? changes : { ...changes, outcomes: first(String(changes.id)) }
}
