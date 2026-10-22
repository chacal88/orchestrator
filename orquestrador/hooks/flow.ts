import type {
  FlowActor,
  FlowChoice,
  FlowDef,
  FlowDeploy,
  FlowDeployProgress,
  FlowDetect,
  FlowEffort,
  FlowEvent,
  FlowMerge,
  FlowOutcome,
  FlowState,
  FlowStep,
  FlowStepDetails,
  FlowStepKind,
  FlowStepView,
  FlowView,
  Lang,
  Languages,
  Localized,
  ProjectSettings,
  Translations,
} from '../types'
import { libraryStep, NEXT_STEP, overlay } from './flows/library'
import { executedText, isAgentName, masksExitCode } from './gates'
import { DEFAULT_LANGUAGES, baseText, localize, parseLocalized, uiText } from './i18n'
import type { UiText } from './i18n'
import { MOCKUP_STEP } from './grill'
import { parseJiraTarget } from './jira'
import { DEPLOY_KEYS, MERGE_KEYS } from './project-config'

/** The pseudo-step every flow ends on. */
export const FLOW_END = 'fim'
export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_FLOW_IDS = ['completo', 'rapido'] as const

/** An escalation's two answers, pressed only by the owner. */
export const escalationChoices = (t: UiText = uiText(undefined)): FlowChoice[] => [
  { outcome: 'tentar-de-novo', label: t.escalation.retry },
  { outcome: 'encerrar', label: t.escalation.end },
]

/** The outcome a loop step ends on, given by the mod once every phase closed. */
export const LOOP_DONE = 'concluidas'

/** Which actor may answer a step of each kind: a session never answers for the owner, a command or the loop. */
const ANSWERED_BY: Record<FlowStepKind, FlowActor> = {
  session: 'session',
  loop: 'mod',
  automatic: 'automatic',
  owner: 'owner',
}

const KINDS = new Set<FlowStepKind>(['session', 'automatic', 'owner', 'loop'])
const AUTOMATIC_OUTCOMES = ['passou', 'falhou']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

/** A field's per-language texts, kept only when the file gave them by language. */
const byLang = (v: Localized | undefined): Translations | undefined => (v === undefined || typeof v === 'string' ? undefined : v)
const perLang = (v: Localized): Translations => byLang(v) ?? {}

/** A flow file, checked whole: every next step exists, every kind is known, every automatic step names its command. */
export const parseFlow = (raw: unknown, source: string, project: ProjectSettings = {}): FlowDef | { error: string } => {
  const fail = (why: string) => ({ error: `${source}: ${why}` })
  if (!isRecord(raw)) return fail('a flow is a JSON object.')
  const id = text(raw.id)
  const flowTitle = parseLocalized(raw.title)
  const flowDescription = parseLocalized(raw.description)
  const title = baseText(flowTitle)
  if (id === undefined || title === undefined) return fail('`id` and `title` are required.')
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return fail('`steps` must be a non-empty list.')
  const steps: FlowStep[] = []
  for (const [i, s] of raw.steps.entries()) {
    const where = `step ${i + 1}`
    if (!isRecord(s)) return fail(`${where} is not an object.`)
    const stepId = text(s.id)
    const titles = parseLocalized(s.title)
    const descriptions = parseLocalized(s.description)
    const stepTitle = baseText(titles)
    if (stepId === undefined || stepTitle === undefined) return fail(`${where}: \`id\` and \`title\` are required.`)
    if (stepId === FLOW_END) return fail(`${where}: "${FLOW_END}" is reserved for the end of the flow.`)
    if (steps.some(p => p.id === stepId)) return fail(`step id "${stepId}" appears twice.`)
    const kind = s.kind as FlowStepKind
    if (!KINDS.has(kind)) return fail(`step "${stepId}": kind must be session, automatic, owner or loop.`)
    if (!isRecord(s.outcomes) || Object.keys(s.outcomes).length === 0) return fail(`step "${stepId}": \`outcomes\` is required.`)
    const outcomes: Record<string, FlowOutcome> = {}
    for (const [name, o] of Object.entries(s.outcomes)) {
      const next = isRecord(o) ? text(o.next) : text(o)
      if (next === undefined) return fail(`step "${stepId}", outcome "${name}": \`next\` is required.`)
      const label = isRecord(o) ? parseLocalized(o.label) : undefined
      const labels = byLang(label)
      outcomes[name] = { label: baseText(label) ?? name, next, ...(labels === undefined ? {} : { labels }) }
    }
    const maxAttempts = s.maxAttempts === undefined ? DEFAULT_MAX_ATTEMPTS : s.maxAttempts
    if (typeof maxAttempts !== 'number' || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
      return fail(`step "${stepId}": \`maxAttempts\` must be a whole number of at least 1.`)
    }
    const command = text(s.command)
    if (kind === 'automatic') {
      if (command === undefined) return fail(`step "${stepId}": an automatic step needs the \`command\` whose exit code decides.`)
      const missing = AUTOMATIC_OUTCOMES.filter(o => outcomes[o] === undefined)
      const extra = Object.keys(outcomes).filter(o => !AUTOMATIC_OUTCOMES.includes(o))
      if (missing.length > 0 || extra.length > 0) {
        return fail(`step "${stepId}": an automatic step has exactly the outcomes passou and falhou.`)
      }
    }
    if (s.when !== undefined && s.when !== 'visual') return fail(`step "${stepId}": \`when\` may only be "visual".`)
    if (s.over !== undefined && s.over !== 'tasks') return fail(`step "${stepId}": \`over\` may only be "tasks".`)
    if (kind === 'loop' && outcomes[LOOP_DONE] === undefined) {
      return fail(`step "${stepId}": a loop step declares the outcome ${LOOP_DONE}, given when every phase closed.`)
    }
    const detect = parseDetect(s.detect, outcomes)
    if (typeof detect === 'string') return fail(`step "${stepId}": ${detect}`)
    const jira = parseJiraTarget(s.jira)
    if (typeof jira === 'string') return fail(`step "${stepId}": ${jira}`)
    const extras = parseExtras(s, kind, project)
    if (typeof extras === 'string') return fail(`step "${stepId}": ${extras}`)
    steps.push({
      id: stepId,
      title: stepTitle,
      description: baseText(descriptions),
      ...(byLang(titles) === undefined ? {} : { titles: byLang(titles) }),
      ...(byLang(descriptions) === undefined ? {} : { descriptions: byLang(descriptions) }),
      kind,
      outcomes,
      maxAttempts,
      command,
      requiresEvidence: s.requiresEvidence === true,
      when: s.when === 'visual' ? 'visual' : undefined,
      over: kind === 'loop' ? 'tasks' : undefined,
      detect,
      cleanup: s.cleanup === true,
      ...(jira === undefined ? {} : { jira }),
      ...extras,
    })
  }
  watchRoutines(steps)
  const ids = new Set(steps.map(s => s.id))
  for (const step of steps) {
    for (const [name, o] of Object.entries(step.outcomes)) {
      if (o.next !== FLOW_END && !ids.has(o.next)) {
        return fail(`step "${step.id}", outcome "${name}" goes to "${o.next}", which is no step of this flow.`)
      }
    }
  }
  return {
    id,
    title,
    description: baseText(flowDescription) ?? '',
    ...(byLang(flowTitle) === undefined ? {} : { titles: byLang(flowTitle) }),
    ...(byLang(flowDescription) === undefined ? {} : { descriptions: byLang(flowDescription) }),
    steps,
  }
}

/** The step that says the change reached production; it also sees the deploy's routines. */
export const PRODUCTION_STEP = 'producao'

/**
 * A flow with a deploy and the production step: the deploy's routines also answer production. The
 * ones joined are kept apart in `routines`, so a derived flow starts again from production's own.
 */
const watchRoutines = (steps: FlowStep[]): void => {
  const production = steps.find(s => s.id === PRODUCTION_STEP)
  const own = production?.detect?.commands ?? []
  const routines = [...new Set(steps.flatMap(s => s.deploy?.commands ?? []))].filter(c => !own.includes(c))
  if (production === undefined || routines.length === 0) return
  production.detect = { commands: [...own, ...routines], outcome: production.detect?.outcome ?? Object.keys(production.outcomes)[0]!, routines }
}

/** A detect without the deploy's routines the mod joined in: the step's own, or nothing when it had none. */
export const ownDetect = (detect: FlowDetect | undefined): FlowDetect | undefined => {
  if (detect === undefined) return undefined
  const joined = detect.routines ?? []
  const commands = detect.commands.filter(c => !joined.includes(c))
  return commands.length === 0 ? undefined : { commands, outcome: detect.outcome }
}

/**
 * A step's `detect`: one command or a list (`"vercel --prod"`), or `{ commands, outcome }`; the
 * outcome may be left out when the step declares only one.
 */
const parseDetect = (raw: unknown, outcomes: Record<string, FlowOutcome>): FlowDetect | undefined | string => {
  if (raw === undefined) return undefined
  const spec = isRecord(raw) ? raw : { commands: raw }
  const list = typeof spec.commands === 'string' ? [spec.commands] : spec.commands
  const commands = Array.isArray(list) ? list.map(text).filter((c): c is string => c !== undefined) : []
  if (commands.length === 0) return '`detect` needs at least one command.'
  const names = Object.keys(outcomes)
  const outcome = text(spec.outcome) ?? (names.length === 1 ? names[0] : undefined)
  if (outcome === undefined || outcomes[outcome] === undefined) {
    return `\`detect.outcome\` must name one of the step's outcomes (${names.join(', ')}).`
  }
  return { commands, outcome }
}

const DETAIL_KEYS = ['inputs', 'produces', 'blocks'] as const
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
const MERGE_METHODS: readonly string[] = ['squash', 'merge', 'rebase']

type StepExtras = Pick<FlowStep, 'details' | 'detailsByLang' | 'agent' | 'model' | 'effort' | 'merge' | 'deploy'>

/**
 * The fields that describe a step and who runs it: `details`, `agent`, `model`, `effort`, and the
 * `merge` or `deploy` it carries out. An agent runs a session, a loop's phases, or a merge or deploy
 * the coordinator carries out; a merge or deploy is the owner's, or automatic with `auto`.
 */
const parseExtras = (s: Record<string, unknown>, kind: FlowStepKind, project: ProjectSettings): StepExtras | string => {
  const out: StepExtras = {}
  if (s.details !== undefined) {
    if (!isRecord(s.details)) return '`details` is an object with inputs, produces and blocks.'
    const unknown = Object.keys(s.details).filter(k => !(DETAIL_KEYS as readonly string[]).includes(k))
    if (unknown.length > 0) return `\`details\` takes only inputs, produces and blocks, not ${unknown.join(', ')}.`
    const details: FlowStepDetails = {}
    const byLang: Partial<Record<Lang, FlowStepDetails>> = {}
    for (const key of DETAIL_KEYS) {
      if (s.details[key] === undefined) continue
      const value = parseLocalized(s.details[key])
      if (value === undefined) return `\`details.${key}\` must be text, or one text per language.`
      details[key] = baseText(value)
      for (const [lang, t] of Object.entries(perLang(value))) (byLang[lang as Lang] ??= {})[key] = t
    }
    out.details = details
    if (Object.keys(byLang).length > 0) out.detailsByLang = byLang
  }
  for (const key of ['agent', 'model'] as const) {
    if (s[key] === undefined) continue
    const value = text(s[key])
    if (value === undefined) return `\`${key}\` must be a name.`
    out[key] = value
  }
  if (out.agent !== undefined && !isAgentName(out.agent)) return `\`agent\` "${out.agent}" must be lowercase words joined by hyphens (a-z, 0-9, -), the name of a file in agents/.`
  if (s.effort !== undefined) {
    if (typeof s.effort !== 'string' || !EFFORTS.includes(s.effort)) return `\`effort\` must be one of ${EFFORTS.join(', ')}.`
    out.effort = s.effort as FlowEffort
  }
  if (s.merge !== undefined) {
    const merge = parseMerge(s.merge, project.merge, kind)
    if (typeof merge === 'string') return merge
    out.merge = merge
  }
  if (s.deploy !== undefined) {
    const deploy = parseDeploy(s.deploy, project.deploy, kind)
    if (typeof deploy === 'string') return deploy
    out.deploy = deploy
  }
  if (out.merge !== undefined && out.deploy !== undefined) return 'a step merges or deploys, not both.'
  const runs = out.merge !== undefined ? 'merge' : out.deploy !== undefined ? 'deploy' : undefined
  const auto = (out.merge ?? out.deploy)?.auto
  if (runs !== undefined && kind !== (auto ? 'automatic' : 'owner')) {
    return `a ${runs} step with \`auto: ${auto}\` is ${auto ? 'automatic' : 'an owner step'}, not ${kind}.`
  }
  if (out.agent !== undefined && kind !== 'session' && kind !== 'loop' && runs === undefined) {
    return '`agent` goes only on a session or loop step, or on a merge or deploy step.'
  }
  return out
}

const flag = (v: unknown, name: string, fallback: boolean): boolean | string =>
  v === undefined ? fallback : typeof v === 'boolean' ? v : `\`${name}\` must be true or false.`

/** The fields a raw block lists as not written by the step (the project's value baked in), kept while they still match. */
const bakedKeys = (raw: Record<string, unknown>, keys: readonly string[], project: Record<string, unknown> | undefined): string[] =>
  Array.isArray(raw.fromProject)
    ? keys.filter(k => (raw.fromProject as unknown[]).includes(k) && raw[k] !== undefined && JSON.stringify(raw[k]) === JSON.stringify(project?.[k]))
    : []

/** `merge`: the target branch, the method (squash unless said) and whether the coordinator merges by itself; what the step leaves out comes from the project. */
const parseMerge = (raw: unknown, project: ProjectSettings['merge'], kind: FlowStepKind): FlowMerge | string => {
  if (!isRecord(raw)) return '`merge` is an object with branch, method and auto.'
  const baked = bakedKeys(raw, MERGE_KEYS, project as Record<string, unknown> | undefined)
  const fromProject: string[] = []
  let branch = text(raw.branch)
  if (raw.branch === undefined && project?.branch !== undefined) {
    branch = project.branch
    fromProject.push('branch')
  } else if (baked.includes('branch')) fromProject.push('branch')
  if (branch === undefined) return '`merge.branch` names the branch the PR merges into.'
  let method: unknown = raw.method
  if (method === undefined) {
    method = project?.method ?? 'squash'
    if (project?.method !== undefined) fromProject.push('method')
  } else if (baked.includes('method')) fromProject.push('method')
  if (typeof method !== 'string' || !MERGE_METHODS.includes(method)) return `\`merge.method\` must be one of ${MERGE_METHODS.join(', ')}.`
  let auto = flag(raw.auto, 'merge.auto', false)
  if (typeof auto === 'string') return auto
  if (raw.auto === undefined && project?.auto !== undefined && project.auto === (kind === 'automatic')) {
    auto = project.auto
    fromProject.push('auto')
  } else if (baked.includes('auto')) fromProject.push('auto')
  return { branch, method: method as FlowMerge['method'], auto, ...(fromProject.length === 0 ? {} : { fromProject }) }
}

/** `deploy`: the CI's deploy waited on, routines run after the merge, or both; and whether it runs by itself. What the step leaves out comes from the project. */
const parseDeploy = (raw: unknown, project: ProjectSettings['deploy'], kind: FlowStepKind): FlowDeploy | string => {
  if (!isRecord(raw)) return '`deploy` is an object with ci, commands and auto.'
  const baked = bakedKeys(raw, DEPLOY_KEYS, project as Record<string, unknown> | undefined)
  const fromProject: string[] = []
  let ci = flag(raw.ci, 'deploy.ci', false)
  if (typeof ci === 'string') return ci
  if (raw.ci === undefined && project?.ci !== undefined) {
    ci = project.ci
    fromProject.push('ci')
  } else if (baked.includes('ci')) fromProject.push('ci')
  let auto = flag(raw.auto, 'deploy.auto', false)
  if (typeof auto === 'string') return auto
  if (raw.auto === undefined && project?.auto !== undefined && project.auto === (kind === 'automatic')) {
    auto = project.auto
    fromProject.push('auto')
  } else if (baked.includes('auto')) fromProject.push('auto')
  let list: unknown = raw.commands === undefined ? [] : typeof raw.commands === 'string' ? [raw.commands] : raw.commands
  if (raw.commands === undefined && project?.commands !== undefined) {
    list = project.commands
    fromProject.push('commands')
  } else if (baked.includes('commands')) fromProject.push('commands')
  if (!Array.isArray(list) || list.some(c => text(c) === undefined)) return '`deploy.commands` is a list of commands.'
  const commands = list.map(c => text(c) as string)
  if (!ci && commands.length === 0) return '`deploy` needs `ci: true`, `commands`, or both.'
  const order = DEPLOY_KEYS.filter(k => fromProject.includes(k))
  return { ci, commands, auto, ...(order.length === 0 ? {} : { fromProject: order }) }
}

/** The flows on offer: the mod's defaults, each replaced by a project's flow of the same id. */
export const mergeFlows = (defaults: readonly FlowDef[], project: readonly FlowDef[]): Record<string, FlowDef> => {
  const all: Record<string, FlowDef> = {}
  for (const flow of [...defaults, ...project]) all[flow.id] = flow
  return all
}

/** A flow file as read: its raw JSON and where it came from. */
export type FlowSource = { source: string; raw: unknown }

type RawStep = Record<string, unknown> & { id: string; outcomes: Record<string, { next: string }> }

/** A value's own text list: undefined is empty, anything but a list of names is refused. */
const names = (v: unknown): string[] | undefined =>
  v === undefined ? [] : Array.isArray(v) && v.every(x => text(x) !== undefined) ? v.map(x => text(x) as string) : undefined

/** A parsed step as a file writes it: its title, description and labels by language where it has them. */
export const asWritten = ({ titles, descriptions, detailsByLang, ...step }: FlowStep): Record<string, unknown> => ({
  ...step,
  ...(step.details === undefined || detailsByLang === undefined
    ? {}
    : {
        details: Object.fromEntries(
          DETAIL_KEYS.flatMap((key): [string, Localized][] => {
            const texts: Translations = {}
            for (const lang of Object.keys(detailsByLang) as Lang[]) {
              const t = detailsByLang[lang]?.[key]
              if (t !== undefined) texts[lang] = t
            }
            const base = step.details?.[key]
            return Object.keys(texts).length > 0 ? [[key, texts]] : base === undefined ? [] : [[key, base]]
          }),
        ),
      }),
  title: titles ?? step.title,
  ...((descriptions ?? step.description) === undefined ? {} : { description: descriptions ?? step.description }),
  outcomes: Object.fromEntries(
    Object.entries(step.outcomes).map(([name, { labels, ...o }]) => [name, { ...o, label: labels ?? o.label }]),
  ),
})

/**
 * A flow file whole: one with `steps` goes straight to parseFlow; one with `base` is resolved from
 * its base (found by `find`, which may itself be derived), then `remove` (each outcome that led to a
 * removed step leads where that step's first outcome led, through every removed one), `add` (the
 * step enters after `after`, whose forward outcome now leads to it, and it leads where that one
 * led), `override` (fields laid over a step, never its id or kind) and `order`, and the result goes
 * through parseFlow like any other.
 */
export const resolveFlow = (
  raw: unknown,
  source: string,
  find: (id: string, from: string) => FlowSource | undefined,
  chain: readonly { id: string; source: string }[] = [],
  project: ProjectSettings = {},
): FlowDef | { error: string } => {
  if (!isRecord(raw) || raw.base === undefined) return parseFlow(raw, source, project)
  const fail = (why: string) => ({ error: `${source}: ${why}` })
  const id = text(raw.id)
  if (id === undefined) return fail('`id` is required.')
  if (raw.steps !== undefined) return fail('a flow has `base` or `steps`, not both.')
  const baseId = text(raw.base)
  if (baseId === undefined) return fail('`base` names the flow this one derives from.')
  const path = [...chain, { id, source }]
  const found = find(baseId, id)
  if (found === undefined) return fail(`base "${baseId}" is no flow of the mod or of the project.`)
  if (path.some(p => p.source === found.source)) {
    return fail(`\`base\` goes round in a circle: ${[...path.map(p => p.id), baseId].join(' → ')}.`)
  }
  const base = resolveFlow(found.raw, found.source, find, path, project)
  if ('error' in base) return fail(`base "${baseId}" does not resolve: ${base.error}`)
  // each text goes back to how a file writes it, one per language, so a derived flow keeps the translations
  let steps = (JSON.parse(JSON.stringify(base.steps)) as FlowStep[]).map(asWritten) as unknown as RawStep[]
  // production's detect goes back to its own commands; parseFlow joins the routines of the deploy that stays
  for (const step of steps) {
    const own = ownDetect(step.detect as FlowDetect | undefined)
    if (own === undefined) delete step.detect
    else step.detect = own
  }
  const at = (sid: string) => steps.findIndex(s => s.id === sid)

  const remove = names(raw.remove)
  if (remove === undefined) return fail('`remove` is a list of step ids.')
  for (const sid of remove) {
    const step = steps[at(sid)]
    if (step === undefined) return fail(`\`remove\`: "${sid}" is no step of ${baseId}.`)
    if (step.kind === 'loop') return fail(`\`remove\`: "${sid}" runs the change's phases; it cannot be removed.`)
  }
  const gone = new Set(remove)
  const through = (target: string, seen: readonly string[]): string | undefined => {
    if (!gone.has(target)) return target
    if (seen.includes(target)) return undefined
    const first = Object.values(steps[at(target)]!.outcomes)[0]!.next
    return through(first, [...seen, target])
  }
  const kept = steps.filter(s => !gone.has(s.id))
  for (const step of kept) {
    for (const [name, o] of Object.entries(step.outcomes)) {
      const next = through(o.next, [])
      if (next === undefined) return fail(`\`remove\`: step "${step.id}", outcome "${name}" leads only through removed steps.`)
      o.next = next
    }
  }
  steps = kept

  if (raw.add !== undefined && !Array.isArray(raw.add)) return fail('`add` is a list of { after, step }.')
  for (const [i, a] of ((raw.add ?? []) as unknown[]).entries()) {
    const where = `add ${i + 1}`
    if (!isRecord(a)) return fail(`${where} is not an object.`)
    const after = text(a.after)
    const anchor = after === undefined ? undefined : steps[at(after)]
    if (anchor === undefined) return fail(`${where}: \`after\` "${after ?? ''}" is no step of the flow.`)
    const step = libraryStep(a.step, project)
    if (typeof step === 'string') return fail(`${where}: ${step}`)
    const sid = text(step.id)
    if (sid === undefined) return fail(`${where}: the step needs an \`id\`.`)
    if (at(sid) !== -1) return fail(`${where}: step id "${sid}" is already in the flow.`)
    const from = at(anchor.id)
    const forward = Object.values(anchor.outcomes).find(o => o.next === FLOW_END || at(o.next) > from)
    if (forward === undefined) return fail(`${where}: step "${anchor.id}" has no outcome that goes forward.`)
    const outcomes = isRecord(step.outcomes) ? step.outcomes : {}
    for (const o of Object.values(outcomes)) {
      if (isRecord(o) && o.next === NEXT_STEP) o.next = forward.next
    }
    for (const [name, o] of Object.entries(outcomes)) if (o === NEXT_STEP) outcomes[name] = forward.next
    forward.next = sid
    steps.splice(from + 1, 0, { ...step, id: sid } as RawStep)
  }

  if (raw.override !== undefined && !isRecord(raw.override)) return fail('`override` maps step ids to the fields that change.')
  for (const [sid, changes] of Object.entries(raw.override ?? {})) {
    const i = at(sid)
    if (i === -1) return fail(`\`override\`: "${sid}" is no step of the flow.`)
    if (!isRecord(changes)) return fail(`\`override\` of "${sid}" is an object of fields.`)
    for (const key of ['id', 'kind'] as const) {
      if (changes[key] !== undefined && changes[key] !== steps[i]![key]) return fail(`\`override\` of "${sid}" cannot change its \`${key}\`.`)
    }
    steps[i] = overlay(steps[i], changes) as RawStep
  }

  const order = raw.order === undefined ? undefined : names(raw.order)
  if (raw.order !== undefined) {
    const ids = steps.map(s => s.id)
    if (order === undefined || order.length !== ids.length || new Set(order).size !== ids.length || order.some(o => !ids.includes(o))) {
      return fail(`\`order\` names every step of the flow once: ${ids.join(', ')}.`)
    }
    steps = order.map(o => steps[at(o)]!)
  }

  const parsed = parseFlow(
    {
      id,
      title: parseLocalized(raw.title) ?? base.titles ?? base.title,
      description: parseLocalized(raw.description) ?? base.descriptions ?? base.description,
      steps,
    },
    source,
    project,
  )
  return 'error' in parsed ? parsed : { ...parsed, base: baseId }
}

/**
 * A project's flow files resolved: a derived one finds its base among the project's other flows
 * first, then the mod's defaults; a project flow deriving from its own id derives from the default.
 */
export const resolveProjectFlows = (
  defaults: readonly FlowSource[],
  project: readonly FlowSource[],
  settings: ProjectSettings = {},
): { flows: FlowDef[]; problems: string[] } => {
  const byId = (files: readonly FlowSource[]) =>
    Object.fromEntries(files.flatMap(f => (isRecord(f.raw) && text(f.raw.id) !== undefined ? [[text(f.raw.id) as string, f]] : [])))
  const mine = byId(project)
  const theirs = byId(defaults)
  const find = (id: string, from: string) => (id === from ? undefined : mine[id]) ?? theirs[id]
  const flows: FlowDef[] = []
  const problems: string[] = []
  for (const file of project) {
    const resolved = resolveFlow(file.raw, file.source, find, [], settings)
    if ('error' in resolved) problems.push(resolved.error)
    else flows.push(resolved)
  }
  return { flows, problems }
}

export type Moved = { state: FlowState; events: FlowEvent[] }

export const stepOf = (flow: FlowDef, id: string): FlowStep | undefined => flow.steps.find(s => s.id === id)
const indexOf = (flow: FlowDef, id: string): number => flow.steps.findIndex(s => s.id === id)

const applies = (step: FlowStep, state: FlowState): boolean => step.when !== 'visual' || state.traits.visual

/**
 * Enters `target`: skips steps whose trait the change lacks, forgets the outcomes of the target and
 * every step after it (they must be done again), and counts the attempt. A session's or a command's
 * outcome that would enter a step past its ceiling escalates to the owner instead; the owner's own
 * press never does, since the owner already chose.
 */
const enter = (state: FlowState, target: string, by: FlowActor, cause: { from: string; outcome: string }, at: number): Moved => {
  const events: FlowEvent[] = []
  let seq = state.seq
  const push = (e: Omit<FlowEvent, 'seq' | 'at'>) => events.push({ seq: ++seq, at, ...e })
  let id = target
  while (id !== FLOW_END) {
    const step = stepOf(state.flow, id)
    if (step === undefined || applies(step, state)) break
    push({ kind: 'skipped', step: id, by: 'mod', note: `only when the change is ${step.when}` })
    id = state.flow.steps[indexOf(state.flow, id) + 1]?.id ?? FLOW_END
  }
  if (id === FLOW_END) {
    push({ kind: 'done', step: FLOW_END, by: 'mod' })
    return { state: { ...state, current: FLOW_END, status: 'done', escalation: undefined, seq, updatedAt: at }, events }
  }
  const step = stepOf(state.flow, id) as FlowStep
  const from = indexOf(state.flow, id)
  const records = Object.fromEntries(
    Object.entries(state.records).filter(([sid]) => indexOf(state.flow, sid) < from),
  )
  // a deploy that retries itself keeps what it saw done; coming back from a later step starts it over
  const progress = Object.fromEntries(
    Object.entries(state.progress ?? {}).filter(([sid]) => indexOf(state.flow, sid) < from || (sid === id && cause.from === id)),
  )
  // going back keeps why (e.g. QA's request), until the flow reaches that step again
  const cause_ = state.records[cause.from]
  const source = stepOf(state.flow, cause.from)
  const reopened =
    cause_ !== undefined && source !== undefined && from <= indexOf(state.flow, cause.from)
      ? {
          step: cause.from,
          outcome: cause.outcome,
          label: source.outcomes[cause.outcome]?.label ?? cause.outcome,
          by: cause_.by,
          at,
          ...(cause_.note === undefined ? {} : { note: cause_.note }),
        }
      : state.reopened !== undefined && id !== state.reopened.step
        ? state.reopened
        : undefined
  const { reopened: _drop, progress: _progress, ...rest } = state
  state = {
    ...rest,
    ...(reopened === undefined ? {} : { reopened }),
    ...(Object.keys(progress).length === 0 ? {} : { progress }),
  }
  const attempts = state.attempts[id] ?? 0
  if (by !== 'owner' && attempts >= step.maxAttempts) {
    const escalation = { step: id, from: cause.from, outcome: cause.outcome, attempts }
    push({ kind: 'escalated', step: id, by: 'mod', note: `${attempts} attempts, the ceiling is ${step.maxAttempts}` })
    return { state: { ...state, current: id, status: 'escalated', escalation, records, seq, updatedAt: at }, events }
  }
  push({ kind: 'entered', step: id, by: 'mod' })
  return {
    state: {
      ...state,
      current: id,
      status: 'running',
      escalation: undefined,
      attempts: { ...state.attempts, [id]: attempts + 1 },
      records,
      seq,
      updatedAt: at,
    },
    events,
  }
}

/** A change starts on the flow's first step that applies to it. */
export const startFlow = (
  flow: FlowDef,
  init: { change: string; coordinatorCwd: string; changePath?: string; visual: boolean },
  at: number,
): Moved => {
  const blank: FlowState = {
    change: init.change,
    coordinatorCwd: init.coordinatorCwd,
    ...(init.changePath === undefined ? {} : { changePath: init.changePath }),
    flow,
    traits: { visual: init.visual },
    current: flow.steps[0]!.id,
    status: 'running',
    attempts: {},
    records: {},
    seq: 1,
    startedAt: at,
    updatedAt: at,
  }
  const started: FlowEvent = { seq: 1, at, kind: 'started', step: flow.id, by: 'mod', note: init.visual ? 'visual' : undefined }
  const moved = enter(blank, flow.steps[0]!.id, 'owner', { from: '', outcome: '' }, at)
  return { state: moved.state, events: [JSON.parse(JSON.stringify(started)) as FlowEvent, ...moved.events] }
}

const WHO: Record<FlowActor, string> = {
  session: 'a session (through the flow tool)',
  automatic: 'the mod, watching its command run',
  owner: 'the owner, pressing a button in the panel',
  mod: 'the mod, once every phase is closed (close each with action "close")',
  detect: "the mod, seeing the step's detect command succeed",
}

/**
 * One outcome reported for one step. Refused, with the reason in the model's words, when the flow
 * is not on that step (no skipping ahead or back), when the step's kind is not answered by this
 * actor, or when the step does not declare the outcome.
 */
export const applyOutcome = (
  state: FlowState,
  report: { step: string; outcome: string; by: FlowActor; note?: string },
  at: number,
): Moved | { error: string } => {
  const asked = stepOf(state.flow, report.step)
  if (asked === undefined) {
    return { error: `flow ${state.flow.id} has no step "${report.step}"; its steps are ${state.flow.steps.map(s => s.id).join(', ')}.` }
  }
  if (state.status === 'done') return { error: `the flow of ${state.change} is finished; nothing is left to report.` }
  if (state.status === 'aborted') return { error: `the owner ended the flow of ${state.change}.` }
  const current = stepOf(state.flow, state.current) as FlowStep
  if (state.status === 'escalated') {
    return {
      error:
        `step "${current.id}" (${current.title}) hit its ceiling of ${current.maxAttempts} attempts; ` +
        'the owner decides in the panel whether it goes again.',
    }
  }
  if (report.step !== state.current) {
    const ahead = indexOf(state.flow, report.step) > indexOf(state.flow, state.current)
    return {
      error:
        `the flow of ${state.change} is on "${current.id}" (${current.title}), not on "${report.step}"` +
        (ahead ? ': steps cannot be skipped' : '') +
        `. "${current.id}" is answered by ${WHO[ANSWERED_BY[current.kind]]}.`,
    }
  }
  const detected = report.by === 'detect' && asked.detect !== undefined
  if (ANSWERED_BY[asked.kind] !== report.by && !detected) {
    return { error: `step "${asked.id}" (${asked.title}) is a ${asked.kind} step: only ${WHO[ANSWERED_BY[asked.kind]]} answers it.` }
  }
  if (detected && report.outcome !== asked.detect?.outcome) {
    return { error: `step "${asked.id}": a detected command gives only ${asked.detect?.outcome}.` }
  }
  if (asked.outcomes[report.outcome] === undefined) {
    return { error: `step "${asked.id}" has no outcome "${report.outcome}"; it declares ${Object.keys(asked.outcomes).join(', ')}.` }
  }
  if (asked.deploy !== undefined && report.outcome !== 'falhou' && !ownerConfirms(state, asked, report.by, report.outcome)) {
    return {
      error:
        `step "${asked.id}" (${asked.title}) moves on by itself once the mod saw the whole deploy: ` +
        `${deployWaits(state, asked)}.`,
    }
  }
  return settle(state, asked, report.outcome, report.by, report.note, at)
}

/** Records a step's outcome and enters where it leads. */
const settle = (state: FlowState, step: FlowStep, name: string, by: FlowActor, given: string | undefined, at: number): Moved => {
  const outcome = step.outcomes[name] as FlowOutcome
  const note = given ?? state.pendingNote
  const record = { outcome: name, by, at, ...(note === undefined ? {} : { note }) }
  const reported: FlowEvent = {
    seq: state.seq + 1,
    at,
    kind: 'outcome',
    step: step.id,
    by,
    outcome: name,
    ...(note === undefined ? {} : { note }),
  }
  const { pendingNote: _used, ...unnoted } = state
  const moved = enter(
    { ...unnoted, records: { ...state.records, [step.id]: record }, seq: state.seq + 1 },
    outcome.next,
    by,
    { from: step.id, outcome: name },
    at,
  )
  return { state: moved.state, events: [reported, ...moved.events] }
}

/** The owner's button on a deploy step that waits on the CI. */
export const DEPLOY_CI_OUTCOME = 'ci-concluido'
export const DEPLOY_CI_LABEL = 'Deploy do CI concluído'

/** `gh run watch` / `gh run view` that fail with the run: only `--exit-status` makes their exit code the run's. */
const CI_WATCH = /\bgh\s+run\s+(?:watch|view)\b(?=[^;&|\n]*\s--exit-status\b)/

const progressOf = (state: FlowState, step: FlowStep): FlowDeployProgress =>
  state.progress?.[step.id] ?? { ci: false, commands: [] }

/** What a deploy step still waits on: the CI's deploy, then its routines in order. */
export const deployPending = (state: FlowState, step: FlowStep): FlowDeployProgress => {
  const done = progressOf(state, step)
  return { ci: step.deploy?.ci === true && !done.ci, commands: (step.deploy?.commands ?? []).slice(done.commands.length) }
}

const deployWaits = (state: FlowState, step: FlowStep): string => {
  const pending = deployPending(state, step)
  const parts = [
    ...(pending.ci ? ["the CI's deploy"] : []),
    ...(pending.commands.length > 0 ? [`the routines ${pending.commands.map(c => `\`${c}\``).join(', ')}`] : []),
  ]
  return parts.length === 0 ? 'nothing is left' : `it still waits on ${parts.join(', then ')}`
}

/**
 * An owner's deploy with only routines left (none from the start, or the CI's already confirmed):
 * the owner may confirm it whole with the step's forward outcome ("Deploy concluído"), having run
 * the routines where the mod did not see them.
 */
const ownerConfirms = (state: FlowState, step: FlowStep, by: FlowActor, outcome: string): boolean =>
  step.kind === 'owner' &&
  step.deploy !== undefined &&
  !deployPending(state, step).ci &&
  by === 'owner' &&
  outcome === Object.keys(step.outcomes)[0]

/** One more thing the deploy saw done; with nothing left, the step moves on. */
const tick = (state: FlowState, step: FlowStep, done: FlowDeployProgress, by: FlowActor, note: string, at: number): Moved => {
  const progressed: FlowState = { ...state, progress: { ...state.progress, [step.id]: done }, seq: state.seq + 1, updatedAt: at }
  const event: FlowEvent = { seq: state.seq + 1, at, kind: 'progress', step: step.id, by, note }
  const pending = deployPending(progressed, step)
  if (pending.ci || pending.commands.length > 0) return { state: progressed, events: [event] }
  const forward = step.kind === 'automatic' ? 'passou' : Object.keys(step.outcomes)[0]!
  const moved = settle(progressed, step, forward, step.kind === 'automatic' ? 'automatic' : 'mod', undefined, at)
  return { state: moved.state, events: [event, ...moved.events] }
}

/** The owner confirms the CI's deploy from the panel. */
export const confirmDeployCi = (state: FlowState, stepId: string, at: number): Moved | { error: string } => {
  const step = currentStep(state)
  if (state.status !== 'running' || step === undefined || step.id !== stepId) return { error: `the flow of ${state.change} is not on "${stepId}".` }
  if (step.deploy?.ci !== true) return { error: `step "${step.id}" does not wait on the CI.` }
  const done = progressOf(state, step)
  if (done.ci) return { error: `the CI's deploy of "${step.id}" is already confirmed.` }
  return tick(state, step, { ...done, ci: true }, 'owner', DEPLOY_CI_LABEL, at)
}

/**
 * One finished Bash command, read by the deploy step the flow is on: `gh run watch|view
 * --exit-status` passing confirms the CI's deploy; a routine passing counts only after the CI
 * (when the step waits on it) and only as the next one in order. A CI watch is read only while
 * the step waits on the CI it has not seen yet. A masked exit code proves nothing. A failure fails an automatic deploy; an owner's deploy holds. Undefined when the
 * command is none of the deploy's; an error when it is one but does not count.
 */
export const observeDeploy = (state: FlowState, command: string, failed: boolean, at: number): Moved | { error: string } | undefined => {
  const step = currentStep(state)
  if (state.status !== 'running' || step?.deploy === undefined) return undefined
  const code = executedText(command)
  const routines = step.deploy.commands.map(commandPattern)
  const routine = routines.findIndex(p => p.test(code))
  const pattern = routine === -1 ? (CI_WATCH.test(code) ? CI_WATCH : undefined) : routines[routine]!
  if (pattern === undefined) return undefined
  const what = routine === -1 ? "the CI's deploy" : `the routine \`${step.deploy.commands[routine]}\``
  const done = progressOf(state, step)
  // a CI watch counts, either way, only while the step still waits on the CI
  if (routine === -1 && (!step.deploy.ci || done.ci)) return undefined
  if (failed) {
    return step.kind === 'automatic'
      ? settle(state, step, 'falhou', 'automatic', `${what} failed`, at)
      : { error: `${what} failed; the deploy holds until it passes.` }
  }
  if (masksExitCode(code, pattern)) return { error: `${what} ran with its exit code hidden; run it alone for it to count.` }
  if (routine === -1) {
    return tick(state, step, { ...done, ci: true }, 'detect', executedTextShort(command), at)
  }
  if (step.deploy.ci && !done.ci) return { error: `${what} ran before the CI's deploy was confirmed; it does not count.` }
  const expected = done.commands.length
  if (routine < expected) return { error: `${what} already passed.` }
  if (routine > expected) {
    return { error: `${what} ran out of order; \`${step.deploy.commands[expected]}\` comes first, so it does not count.` }
  }
  return tick(state, step, { ...done, commands: [...done.commands, step.deploy.commands[routine]!] }, 'detect', executedTextShort(command), at)
}

export const executedTextShort = (command: string): string => `comando: ${command.replace(/\s+/g, ' ').trim().slice(0, 80)}`

/** The PR review step: no merge of the change's PR before the owner approved it. */
export const REVIEW_STEP = 'revisao-pr'

/**
 * The PR review the flow has not answered yet and comes before its next merge (the merge step it
 * is on, or the first one after); with no merge step ahead, any unanswered review. A finished or
 * aborted flow waits on none.
 */
export const pendingReview = (state: FlowState): FlowStep | undefined => {
  if (state.status === 'done' || state.status === 'aborted') return undefined
  const steps = state.flow.steps
  const at = Math.max(0, indexOf(state.flow, state.current))
  const merge = steps.findIndex((s, i) => i >= at && s.merge !== undefined)
  return steps
    .slice(0, merge === -1 ? steps.length : merge)
    .find(s => (s.id === REVIEW_STEP || s.id.startsWith(`${REVIEW_STEP}-`)) && state.records[s.id] === undefined)
}

/** The owner's answer to an escalation: go again with a fresh count, or end the flow. */
export const resolveEscalation = (state: FlowState, choice: string, at: number): Moved | { error: string } => {
  if (state.status !== 'escalated' || state.escalation === undefined) return { error: 'nothing is escalated.' }
  const step = state.escalation.step
  if (choice === 'encerrar') {
    const event: FlowEvent = { seq: state.seq + 1, at, kind: 'aborted', step, by: 'owner' }
    return { state: { ...state, status: 'aborted', seq: state.seq + 1, updatedAt: at }, events: [event] }
  }
  if (choice !== 'tentar-de-novo') return { error: `an escalation is answered with tentar-de-novo or encerrar, not "${choice}".` }
  const retried: FlowEvent = { seq: state.seq + 1, at, kind: 'retried', step, by: 'owner' }
  const moved = enter(
    { ...state, attempts: { ...state.attempts, [step]: 0 }, seq: state.seq + 1 },
    step,
    'owner',
    { from: state.escalation.from, outcome: state.escalation.outcome },
    at,
  )
  return { state: moved.state, events: [retried, ...moved.events] }
}

/** The owner's press: an escalation's choice while one is open, else the owner step's outcome. */
export const ownerPress = (state: FlowState, step: string, outcome: string, at: number, note?: string): Moved | { error: string } =>
  state.status === 'escalated' && state.escalation?.step === step
    ? resolveEscalation(state, outcome, at)
    : outcome === DEPLOY_CI_OUTCOME
      ? confirmDeployCi(state, step, at)
      : applyOutcome(state, { step, outcome, by: 'owner', ...(note === undefined ? {} : { note }) }, at)

/** What the owner sees after a press: the answer recorded, in their words, and where the flow went. */
export const pressedToast = (
  before: FlowState,
  after: FlowState,
  step: string,
  outcome: string,
  lang: Lang = DEFAULT_LANGUAGES.ui,
): string => {
  const t = uiText(lang)
  const label = pressedLabel(before, step, outcome, lang)
  const nextStep = stepOf(after.flow, after.current)
  const next =
    after.status === 'done'
      ? t.toast.flowDone
      : after.status === 'aborted'
        ? t.toast.flowEnded
        : t.toast.nextStep(nextStep === undefined ? after.current : stepTitle(nextStep, lang))
  return t.toast.registered(label, next)
}

/** A step's title, description and outcome labels in a language; a flow without them keeps its plain text. */
export const stepTitle = (step: FlowStep, lang: Lang): string => localize(step.titles, lang) ?? step.title
const stepDescription = (step: FlowStep, lang: Lang): string | undefined =>
  localize(step.descriptions, lang) ?? step.description
export const outcomeLabel = (o: FlowOutcome, lang: Lang): string => localize(o.labels, lang) ?? o.label

/** The button's own words, in the owner's language: the owner step's outcome label, or the escalation choice's. */
const pressedLabel = (before: FlowState, step: string, outcome: string, lang: Lang = DEFAULT_LANGUAGES.ui): string => {
  const declared = stepOf(before.flow, step)?.outcomes[outcome]
  return (
    (declared === undefined ? undefined : outcomeLabel(declared, lang)) ??
    escalationChoices(uiText(lang)).find(c => c.outcome === outcome)?.label ??
    (outcome === DEPLOY_CI_OUTCOME ? uiText(lang).deployCi : outcome)
  )
}

/**
 * What the coordinator reads after an owner press, or nothing when it has nothing to do: the flow
 * ended, waits on the owner again, or escalated. A session, automatic or loop step is the
 * coordinator's to drive; of the owner steps only the mockup is, since it attaches a new one.
 */
export const wakePrompt = (before: FlowState, after: FlowState, step: string, outcome: string, note?: string): string | undefined => {
  if (after.status !== 'running') return undefined
  const next = currentStep(after)
  if (next === undefined || (next.kind === 'owner' && next.id !== MOCKUP_STEP)) return undefined
  const noted = note === undefined ? '' : ` com a nota "${note}"`
  return `Painel: o dono apertou "${pressedLabel(before, step, outcome)}"${noted}. Próximo passo: ${next.id} (${next.title}). Siga o flow.`
}

/** Words of a declared command, matched in what the shell ran: `openspec validate` in `npx openspec validate x --strict`. */
const commandPattern = (command: string): RegExp =>
  new RegExp(
    `(^|[\\s/;&|(])${command
      .trim()
      .split(/\s+/)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+')}(?=$|[\\s;&|)])`,
  )

/**
 * What one finished Bash command proves for an automatic step: passou on exit 0, falhou otherwise.
 * A run whose exit code a pipe, `|| true` or a later `; cmd` hides proves a failure, never a pass.
 */
export const automaticOutcome = (step: FlowStep, command: string, failed: boolean): 'passou' | 'falhou' | undefined => {
  if (step.kind !== 'automatic' || step.command === undefined || step.deploy !== undefined) return undefined
  const code = executedText(command)
  const pattern = commandPattern(step.command)
  if (!pattern.test(code)) return undefined
  if (!failed && masksExitCode(code, pattern)) return undefined
  return failed ? 'falhou' : 'passou'
}

/** A step's detect command seen succeeding: its outcome. A masked exit code or a failure proves nothing. */
export const detectedOutcome = (step: FlowStep, command: string, failed: boolean): string | undefined => {
  if (step.detect === undefined || failed) return undefined
  const code = executedText(command)
  const seen = step.detect.commands.some(c => {
    const pattern = commandPattern(c)
    return pattern.test(code) && !masksExitCode(code, pattern)
  })
  return seen ? step.detect.outcome : undefined
}

/** A session's note for the owner step that waits now; it joins the owner's answer. */
export const noteOwnerStep = (state: FlowState, note: string, at: number): Moved | { error: string } => {
  const step = currentStep(state)
  if (step === undefined || state.status !== 'running') return { error: 'no step is waiting.' }
  if (step.kind !== 'owner') return { error: `step "${step.id}" is not the owner's; report its outcome instead.` }
  const event: FlowEvent = { seq: state.seq + 1, at, kind: 'noted', step: step.id, by: 'session', note }
  return { state: { ...state, pendingNote: note, seq: state.seq + 1, updatedAt: at }, events: [event] }
}

export const currentStep = (state: FlowState): FlowStep | undefined =>
  state.status === 'done' || state.status === 'aborted' ? undefined : stepOf(state.flow, state.current)

const stepView = (state: FlowState, step: FlowStep, index: number, currentIndex: number, languages: Languages): FlowStepView => {
  const record = state.records[step.id]
  const isCurrent = step.id === state.current && (state.status === 'running' || state.status === 'escalated')
  const finished = state.status === 'done'
  const state_: FlowStepView['state'] = isCurrent
    ? 'current'
    : record !== undefined
      ? 'done'
      : !applies(step, state) && (finished || index < currentIndex)
        ? 'skipped'
        : 'pending'
  return {
    id: step.id,
    title: stepTitle(step, languages.ui),
    description: stepDescription(step, languages.content),
    kind: step.kind,
    state: state_,
    attempts: state.attempts[step.id] ?? 0,
    maxAttempts: step.maxAttempts,
    outcome: record?.outcome,
    outcomeLabel: record === undefined || step.outcomes[record.outcome] === undefined
      ? undefined
      : outcomeLabel(step.outcomes[record.outcome]!, languages.ui),
  }
}

/** Everything the panel draws of a flow, from the saved state alone. */
export const flowView = (state: FlowState, languages: Languages = DEFAULT_LANGUAGES): FlowView => {
  const currentIndex = state.status === 'done' ? state.flow.steps.length : indexOf(state.flow, state.current)
  const steps = state.flow.steps.map((s, i) => stepView(state, s, i, currentIndex, languages))
  const step = currentStep(state)
  const ownerChoices: FlowChoice[] =
    state.status === 'escalated'
      ? escalationChoices(uiText(languages.ui))
      : step?.deploy !== undefined
        ? deployPending(state, step).ci
          ? [{ outcome: DEPLOY_CI_OUTCOME, label: uiText(languages.ui).deployCi }]
          : ownerConfirms(state, step, 'owner', Object.keys(step.outcomes)[0]!)
            ? Object.entries(step.outcomes).slice(0, 1).map(([outcome, o]) => ({ outcome, label: outcomeLabel(o, languages.ui) }))
            : []
        : step?.kind === 'owner'
          ? Object.entries(step.outcomes).map(([outcome, o]) => ({ outcome, label: outcomeLabel(o, languages.ui) }))
          : []
  return {
    change: state.change,
    flowId: state.flow.id,
    flowTitle: localize(state.flow.titles, languages.ui) ?? state.flow.title,
    status: state.status,
    current: steps.find(s => s.state === 'current'),
    waitingOn: step === undefined ? undefined : state.status === 'escalated' ? 'owner' : ANSWERED_BY[step.kind],
    ownerChoices,
    escalation: state.escalation,
    steps,
  }
}

/** Where the flow stands, in the model's words: the step, who answers it and how. */
export const describeFlow = (state: FlowState): string => {
  const head = `Flow ${state.flow.id} for ${state.change}`
  if (state.status === 'done') return `${head}: finished.`
  if (state.status === 'aborted') return `${head}: ended by the owner.`
  const step = stepOf(state.flow, state.current) as FlowStep
  const where = `${head}: step "${step.id}" (${step.title}), attempt ${state.attempts[step.id] ?? 0} of ${step.maxAttempts}`
  if (state.status === 'escalated') {
    return `${where}; it hit its attempt ceiling and waits on the owner in the panel (retry or end the flow).`
  }
  const outcomes = Object.entries(step.outcomes).map(([o, d]) => `${o} → ${d.next}`).join(', ')
  const back = state.reopened
  const reopened =
    back === undefined ? '' : ` Came back from "${back.step}" (${back.label})${back.note === undefined ? '' : `: ${back.note}`}.`
  return describeStep(state, step, where, outcomes) + reopened
}

/** Which of a merge or deploy step's values come from the project's settings rather than the workflow. */
const projectNote = (step: FlowStep): string => {
  const fields = (step.merge ?? step.deploy)?.fromProject ?? []
  return fields.length === 0 ? '' : ` From the project's settings (not the workflow): ${fields.join(', ')}.`
}

const describeStep = (state: FlowState, step: FlowStep, where: string, outcomes: string): string =>
  describeStepBody(state, step, where, outcomes) + projectNote(step)

const describeStepBody = (state: FlowState, step: FlowStep, where: string, outcomes: string): string => {
  if (step.deploy !== undefined) return describeDeploy(state, step, where)
  if (step.merge?.auto === true) {
    return (
      `${where}. Merge the change's PR into ${step.merge.branch} yourself, by ${step.merge.method}: first check with ` +
      '`gh pr view <pr> --json reviewDecision,statusCheckRollup` that it is approved on GitHub and its CI is green; ' +
      'if anything is missing, do not merge — tell the owner. Then run ' +
      `\`gh pr merge <pr> --${step.merge.method}\` alone, never with --admin; the mod reads its exit code ` +
      `(exit 0 → ${step.outcomes.passou?.next}, otherwise → ${step.outcomes.falhou?.next}). It cannot be reported.`
    )
  }
  switch (step.kind) {
    case 'session':
      return `${where}. Do the step, then report one of its outcomes with action "report": ${outcomes}.`
    case 'loop': {
      const closed = Object.keys(state.closed ?? {})
      return (
        `${where}. Run the phases of tasks.md; close each with action "close" and its \`phase\` id once its gates ` +
        'passed, its tasks are ticked and its work is committed (the mod then archives its session). The step ends ' +
        `on its own when every phase is closed (→ ${step.outcomes[LOOP_DONE]?.next}).` +
        (closed.length > 0 ? ` Closed: ${closed.join(', ')}.` : '')
      )
    }
    case 'automatic':
      return (
        `${where}. Run \`${step.command}\` in this session; the mod reads its exit code ` +
        `(exit 0 → ${step.outcomes.passou?.next}, otherwise → ${step.outcomes.falhou?.next})` +
        (step.requiresEvidence ? ', and a pass also needs evidence.md recorded in the change folder' : '') +
        '. It cannot be reported.'
      )
    case 'owner':
      return (
        `${where}. Waits on the owner's press in the panel (${Object.values(step.outcomes).map(o => o.label).join(' / ')}); ` +
        'no session can answer it, but action "note" leaves a note that joins the answer' +
        (step.detect === undefined
          ? '.'
          : `. The mod also answers ${step.detect.outcome} when it sees ${step.detect.commands.map(c => `\`${c}\``).join(' or ')} succeed.`) +
        (step.merge === undefined ? '' : ` The owner merges into ${step.merge.branch} by ${step.merge.method}; never with --admin.`)
      )
  }
}

/** A deploy step: who starts it, what it still waits on, and how the mod sees each part done. */
const describeDeploy = (state: FlowState, step: FlowStep, where: string): string => {
  const deploy = step.deploy as FlowDeploy
  const pending = deployPending(state, step)
  const who = deploy.auto
    ? `${where}. Deploy by yourself right after the merge, without waiting on the owner.`
    : `${where}. Waits on the owner: do not start the deploy unless they ask; they confirm and run it.`
  const ci = pending.ci
    ? ` The CI's deploy: wait for it with \`gh run watch <run> --exit-status\` (or \`gh run view <run> --exit-status\`) run alone, or the owner presses "${DEPLOY_CI_LABEL}".`
    : deploy.ci
      ? " The CI's deploy is confirmed."
      : ''
  const routines =
    pending.commands.length > 0
      ? ` Routines left, each as its own command and in this order${pending.ci ? ', after the CI' : ''}: ${pending.commands.map(c => `\`${c}\``).join(', ')}.`
      : ''
  const fails = step.kind === 'automatic' ? `a failure → ${step.outcomes.falhou?.next}` : 'a failure holds the step'
  const [forward, first] = Object.entries(step.outcomes)[0]!
  const confirm = ownerConfirms(state, step, 'owner', forward) ? ` The owner may also press "${first.label}" once they ran the routines.` : ''
  return (
    `${who}${ci}${routines} The mod ticks each part it sees pass (a hidden exit code does not count) and moves on ` +
    `(→ ${first.next}) once all are done; ${fails}.${confirm} It cannot be reported.`
  )
}

/** Where a step's agent file was found: the project's own, the mod's plugin, or nowhere. */
export type AgentFound = { source: 'project' | 'plugin'; path: string } | undefined

const AGENT_SOURCE = { project: 'do projeto', plugin: 'do plugin' } as const

/** The step as the model must run it: agent (and where it came from), model, effort and details. */
export const describeStepAgent = (step: FlowStep, found: AgentFound): string | undefined => {
  const lines: string[] = []
  if (step.agent !== undefined) {
    lines.push(
      found === undefined
        ? `Agente: "${step.agent}" — nenhum arquivo encontrado (nem .orquestrador/agents/${step.agent}.md no projeto nem agents/${step.agent}.md no plugin); siga a descrição do passo sem agente.`
        : `Agente: "${step.agent}" (${AGENT_SOURCE[found.source]}). Instruções do agente: ${found.path}`,
    )
  }
  if (step.model !== undefined) lines.push(`Modelo: ${step.model}`)
  if (step.effort !== undefined) lines.push(`Esforço: ${step.effort}`)
  const d = step.details
  if (d?.inputs !== undefined) lines.push(`Entrada: ${d.inputs}`)
  if (d?.produces !== undefined) lines.push(`Saída: ${d.produces}`)
  if (d?.blocks !== undefined) lines.push(`Bloqueia: ${d.blocks}`)
  if (lines.length === 0) return undefined
  const head = step.kind === 'loop' ? 'Cada fase deste passo usa:' : 'Neste passo:'
  return `${head}\n${lines.map(l => `  ${l}`).join('\n')}`
}

const ANSWERER_LABEL: Record<FlowStepKind, string> = {
  session: 'sessão',
  loop: 'mod',
  automatic: 'mod',
  owner: 'dono',
}

const fromProjectText = (fields: string[] | undefined): string =>
  fields === undefined || fields.length === 0 ? '' : ` — do projeto: ${fields.join(', ')}`

/** One step of the sequence with who answers it and whether merge/deploy run on their own. */
const stepSummary = (s: FlowStep): string => {
  const mode = (auto: boolean) => (auto ? 'automático' : 'manual')
  const extra = [
    s.merge === undefined ? undefined : `merge ${mode(s.merge.auto)}${fromProjectText(s.merge.fromProject)}`,
    s.deploy === undefined ? undefined : `deploy ${mode(s.deploy.auto)}${fromProjectText(s.deploy.fromProject)}`,
    s.agent === undefined ? undefined : `agente ${s.agent}`,
  ].filter((x): x is string => x !== undefined)
  return `${s.id} (${[ANSWERER_LABEL[s.kind], ...extra].join(', ')})`
}

/** A workflow whole for the owner's choice: title, description, origin and every step with its answerer. */
export const describeWorkflow = (flow: FlowDef, origin: 'default' | 'project'): string => {
  const from =
    flow.base !== undefined ? `derivado de ${flow.base}` : origin === 'project' ? 'do projeto' : 'padrão'
  return [
    `${flow.id} — ${flow.title}: ${flow.steps.map(s => s.id).join(' → ')} → fim`,
    `  Descrição: ${flow.description === '' ? '(sem descrição)' : flow.description}`,
    `  Origem: ${from}`,
    `  Passos: ${flow.steps.map(stepSummary).join(' → ')}`,
  ].join('\n')
}
