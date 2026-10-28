import type { ProjectSettings } from '../../types'
import { completo } from './completo'
import { rapido } from './rapido'

/** Where an added step's forward outcome leads before it is placed: the step that came after its anchor. */
export const NEXT_STEP = '$seguinte'

type RawStep = Record<string, unknown>
type Build = (changes: RawStep, project?: ProjectSettings) => RawStep

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** One text per language, as a flow file writes it. */
const both = (pt: string, en: string) => ({ 'pt-BR': pt, en })

const revisaoPr: Build = () => ({
  id: 'revisao-pr',
  title: both('Revisão do PR', 'PR review'),
  description: both('O dono revisa e aprova o PR no GitHub.', 'The owner reviews and approves the PR on GitHub.'),
  kind: 'owner',
  details: {
    inputs: both('O PR aberto da change, com o CI rodando.', "The change's open PR, with the CI running."),
    produces: both('O PR aprovado no GitHub.', 'The PR approved on GitHub.'),
    blocks: both('Sem a aprovação, nada é mergeado.', 'Without the approval, nothing is merged.'),
  },
  outcomes: { aprovado: { label: both('PR aprovado', 'PR approved'), next: NEXT_STEP } },
})

/** The owner merges (and the mod sees `gh pr merge`), or with `auto` the coordinator runs it. */
const settled = (
  written: unknown,
  defaults: Record<string, unknown>,
  project: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> => {
  const own = isRecord(written) ? written : {}
  const baked = Array.isArray(own.fromProject) ? (own.fromProject as unknown[]) : []
  const { fromProject: _marker, ...fields } = own
  const config: Record<string, unknown> = { ...defaults }
  const fromProject: string[] = []
  for (const key of keys) {
    const stillProject = baked.includes(key) && JSON.stringify(fields[key]) === JSON.stringify(project?.[key])
    if (fields[key] !== undefined && !stillProject) config[key] = fields[key]
    else if (project?.[key] !== undefined) {
      config[key] = project[key]
      fromProject.push(key)
    }
  }
  for (const [key, value] of Object.entries(fields)) if (!keys.includes(key)) config[key] = value
  return fromProject.length === 0 ? config : { ...config, fromProject }
}

const merge: Build = (changes, project) => {
  const config = settled(changes.merge, { branch: 'main', method: 'squash', auto: false }, project?.merge, ['branch', 'method', 'auto'])
  const id = typeof changes.id === 'string' ? changes.id : 'merge'
  const shared = {
    id,
    title: both(`Merge em ${String(config.branch)}`, `Merge into ${String(config.branch)}`),
    description: both(
      `O PR da change entra em ${String(config.branch)} por ${String(config.method)}.`,
      `The change's PR goes into ${String(config.branch)} by ${String(config.method)}.`,
    ),
    agent: 'merge',
    merge: config,
    details: {
      inputs: both(
        'O PR aprovado no GitHub, o CI verde e os portões finais passados.',
        'The PR approved on GitHub, the CI green and the final gates passed.',
      ),
      produces: both(`O PR mergeado em ${String(config.branch)}.`, `The PR merged into ${String(config.branch)}.`),
      blocks: both(
        'Sem aprovação ou com o CI vermelho, não há merge; nunca com --admin.',
        'Without approval or with the CI red, there is no merge; never with --admin.',
      ),
    },
  }
  return config.auto === true
    ? {
        ...shared,
        kind: 'automatic',
        command: 'gh pr merge',
        outcomes: { passou: { label: both('Mergeado', 'Merged'), next: NEXT_STEP }, falhou: { label: both('Falhou', 'Failed'), next: id } },
      }
    : {
        ...shared,
        kind: 'owner',
        detect: { commands: ['gh pr merge'], outcome: 'feito' },
        outcomes: { feito: { label: both('Merge feito', 'Merge done'), next: NEXT_STEP } },
      }
}

/**
 * The deploy after the merge, by the CI and/or routines. The mod ticks each part it sees done and
 * moves the step on with all of them; `command` only names where an automatic one starts.
 */
const deploy: Build = (changes, project) => {
  const config = settled(changes.deploy, { ci: true, commands: [] as unknown[], auto: false }, project?.deploy, ['ci', 'commands', 'auto'])
  const commands = Array.isArray(config.commands) ? config.commands : [config.commands]
  const id = typeof changes.id === 'string' ? changes.id : 'deploy'
  const shared = {
    id,
    title: both('Deploy', 'Deploy'),
    description: both(
      'A change é publicada depois do merge: pelo CI, por rotinas, ou pelos dois.',
      'The change is published after the merge: by the CI, by routines, or both.',
    ),
    agent: 'deploy',
    deploy: config,
    details: {
      inputs: both('O merge feito.', 'The merge done.'),
      produces: both(
        'O deploy confirmado: o do CI concluído e cada rotina com saída 0, na ordem.',
        "The deploy confirmed: the CI's finished and each routine exiting 0, in order.",
      ),
      blocks: both('Uma rotina que falha segura o passo; o dono decide.', 'A failing routine holds the step; the owner decides.'),
    },
  }
  return config.auto === true
    ? {
        ...shared,
        kind: 'automatic',
        command: config.ci === false && typeof commands[0] === 'string' ? commands[0] : 'gh run watch',
        outcomes: { passou: { label: both('Publicado', 'Published'), next: NEXT_STEP }, falhou: { label: both('Falhou', 'Failed'), next: id } },
      }
    : { ...shared, kind: 'owner', outcomes: { publicado: { label: both('Deploy concluído', 'Deploy finished'), next: NEXT_STEP } } }
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
export const libraryStep = (spec: unknown, project?: ProjectSettings): RawStep | string => {
  const ids = Object.keys(LIBRARY).join(', ')
  if (typeof spec === 'string') {
    const build = LIBRARY[spec]
    return build === undefined ? `"${spec}" is no step of the library (${ids}).` : build({}, project)
  }
  if (!isRecord(spec)) return '`step` is a library id, { use, ... } or a whole step.'
  const { use, ...changes } = spec
  if (use !== undefined) {
    const build = typeof use === 'string' ? LIBRARY[use] : undefined
    if (build === undefined) return `"${String(use)}" is no step of the library (${ids}).`
    const built = build(changes, project)
    // the baked-in fields stay as the library settled them; the rest of `changes` lies over the step
    const { merge: _m, deploy: _d, ...rest } = changes
    return overlay(built, rest) as RawStep
  }
  if (changes.outcomes !== undefined) return changes
  const first = typeof changes.kind === 'string' ? FIRST_OUTCOMES[changes.kind] : undefined
  return first === undefined ? changes : { ...changes, outcomes: first(String(changes.id)) }
}
