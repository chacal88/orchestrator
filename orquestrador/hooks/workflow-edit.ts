import type { FlowDef, FlowDeploy, FlowDetect, FlowMerge, WorkflowDraft, WorkflowDraftStep, WorkflowForms } from '../types'
import { FLOW_END, PRODUCTION_STEP, ownDetect, resolveProjectFlows } from './flow'
import type { FlowSource } from './flow'
import { LIBRARY, NEXT_STEP, libraryStep } from './flows/library'

type RawStep = Record<string, unknown>
type Outcomes = Record<string, { label?: string; next: string }>

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
/** JSON with every object's keys in order, so two shapes of the same value compare equal. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    typeof x === 'object' && x !== null && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  ) ?? 'undefined'
const outcomesOf = (step: RawStep): Outcomes => (step.outcomes ?? {}) as Outcomes

export const EMPTY_FORMS: WorkflowForms = { newId: '', newBase: '', stepTitle: '', stepKind: 'session', stepAgent: '', stepCommand: '' }

/** A workflow id the owner types: lowercase words joined by hyphens. */
export const WORKFLOW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A flow's steps as the editor holds them: each step's forward outcomes (those that lead to the
 * step after it, or to the end after the last) lead to "$seguinte", so moving a step moves the path.
 */
const asDraftSteps = (flow: FlowDef): RawStep[] =>
  flow.steps.map((s, i) => {
    const step = clone(s) as unknown as RawStep
    const after = flow.steps[i + 1]?.id ?? FLOW_END
    const outcomes = outcomesOf(step)
    const forward = Object.values(outcomes).filter(o => o.next === after)
    const later = forward.length > 0 ? forward : Object.values(outcomes).filter(o => o.next === FLOW_END || flow.steps.findIndex(x => x.id === o.next) > i).slice(0, 1)
    for (const o of later) o.next = NEXT_STEP
    return step
  })

/** The library step an added step came from, when it reads as one. */
const libraryUse = (step: RawStep): string | undefined =>
  step.merge !== undefined ? 'merge' : step.deploy !== undefined ? 'deploy' : LIBRARY[String(step.id)] !== undefined ? String(step.id) : undefined

/** A draft to edit `flow`. `base` is the flow it derives from (resolved), absent for a whole one. */
export const draftOf = (flow: FlowDef, base: FlowDef | undefined, replacesDefault: boolean): WorkflowDraft => {
  const current = asDraftSteps(flow)
  if (base === undefined) {
    return {
      id: flow.id, title: flow.title, description: flow.description, baseIds: [], replacesDefault,
      steps: current.map(step => ({ step, from: 'added', on: true, ...withUse(libraryUse(step)) })),
    }
  }
  const baseSteps = asDraftSteps(base)
  const byId = new Map(baseSteps.map(s => [String(s.id), s]))
  const steps: WorkflowDraftStep[] = current.map(step => {
    const orig = byId.get(String(step.id))
    return orig !== undefined && orig.kind === step.kind
      ? { step, from: 'base', orig, on: true }
      : { step, from: 'added', on: true, ...withUse(libraryUse(step)) }
  })
  // a base step the workflow removed comes back switched off, after the base step before it
  baseSteps.forEach((orig, i) => {
    if (steps.some(s => s.from === 'base' && s.step.id === orig.id)) return
    const before = i === 0 ? -1 : steps.findIndex(s => s.step.id === baseSteps[i - 1]!.id)
    steps.splice(before + 1, 0, { step: clone(orig), from: 'base', orig, on: false })
  })
  return {
    id: flow.id, title: flow.title, description: flow.description, base: base.id,
    baseIds: base.steps.map(s => s.id), replacesDefault, steps,
  }
}

const withUse = (use: string | undefined): { use?: string } => (use === undefined ? {} : { use })

/** "Novo workflow": from scratch (no base), or deriving from `base` with its steps as they are. */
export const newDraft = (id: string, base: FlowDef | undefined): WorkflowDraft =>
  base === undefined
    ? { id, title: id, description: '', baseIds: [], replacesDefault: false, steps: [] }
    : { ...draftOf(base, base, false), id, title: `${base.title} (${id})` }

const uniqueId = (draft: WorkflowDraft, wanted: string): string => {
  const taken = new Set([...draft.steps.map(s => String(s.step.id)), ...draft.baseIds])
  if (!taken.has(wanted)) return wanted
  let n = 2
  while (taken.has(`${wanted}-${n}`)) n++
  return `${wanted}-${n}`
}

const slug = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'passo'

const insertAfter = (draft: WorkflowDraft, after: string | null, step: WorkflowDraftStep): WorkflowDraft => {
  const at = after === null ? -1 : draft.steps.findIndex(s => s.step.id === after)
  const steps = [...draft.steps]
  steps.splice(at === -1 ? steps.length : at + 1, 0, step)
  return { ...draft, steps, error: undefined }
}

/** A library step added after `after` (the end when none), under an id of its own. */
export const addLibraryStep = (draft: WorkflowDraft, use: string, after: string | null): WorkflowDraft | { error: string } => {
  const probe = libraryStep(use)
  if (typeof probe === 'string') return { error: probe }
  const id = uniqueId(draft, String(probe.id))
  const step = libraryStep({ use, id })
  if (typeof step === 'string') return { error: step }
  return insertAfter(draft, after, { step: { ...step, id }, from: 'added', use, on: true })
}

/** A new step with its title, who answers it and its agent; an automatic one needs its command. */
export const addNewStep = (draft: WorkflowDraft, form: WorkflowForms, after: string | null): WorkflowDraft | { error: string } => {
  const title = form.stepTitle.trim()
  if (title === '') return { error: 'Dê um título ao passo novo.' }
  const command = form.stepCommand.trim()
  if (form.stepKind === 'automatic' && command === '') return { error: 'Um passo automático precisa do comando cujo código de saída decide.' }
  const agent = form.stepAgent.trim()
  if (agent !== '' && form.stepKind !== 'session') return { error: 'Só um passo de sessão leva agente.' }
  const id = uniqueId(draft, slug(title))
  const spec: RawStep = {
    id, title, kind: form.stepKind,
    ...(agent === '' ? {} : { agent }),
    ...(form.stepKind === 'automatic' ? { command } : {}),
  }
  const step = libraryStep(spec)
  if (typeof step === 'string') return { error: step }
  return insertAfter(draft, after, { step, from: 'added', on: true })
}

export const toggleStep = (draft: WorkflowDraft, id: string): WorkflowDraft => ({
  ...draft,
  error: undefined,
  steps: draft.steps.map(s => (s.step.id === id ? { ...s, on: !s.on } : s)),
})

export const moveStep = (draft: WorkflowDraft, id: string, by: -1 | 1): WorkflowDraft => {
  const i = draft.steps.findIndex(s => s.step.id === id)
  const j = i + by
  if (i === -1 || j < 0 || j >= draft.steps.length) return draft
  const steps = [...draft.steps]
  ;[steps[i], steps[j]] = [steps[j]!, steps[i]!]
  return { ...draft, steps, error: undefined }
}

export type StepField =
  | { field: 'agent' | 'model' | 'effort'; value: string }
  | { field: 'merge'; value: Partial<FlowMerge> }
  | { field: 'deploy'; value: Partial<FlowDeploy> }

/**
 * One field of a step changed. An empty agent, model or effort clears it. A merge or deploy that
 * turns automatic (or back) is the library's step built again, which changes who answers it.
 */
export const setStepField = (draft: WorkflowDraft, id: string, change: StepField): WorkflowDraft => ({
  ...draft,
  error: undefined,
  steps: draft.steps.map(s => {
    if (s.step.id !== id) return s
    const step = { ...s.step }
    if (change.field === 'merge' || change.field === 'deploy') {
      const prior = (step[change.field] ?? {}) as Record<string, unknown>
      const next = { ...prior, ...change.value }
      if (next.auto === prior.auto) return { ...s, step: { ...step, [change.field]: next } }
      const rebuilt = libraryStep({ use: change.field, id, [change.field]: next })
      if (typeof rebuilt === 'string') return s
      for (const key of ['title', 'agent', 'model', 'effort', 'details'] as const) {
        if (step[key] !== undefined) rebuilt[key] = step[key]
      }
      return { step: rebuilt, from: 'added', use: change.field, on: s.on }
    }
    const value = change.value.trim()
    if (value === '') delete step[change.field]
    else step[change.field] = value
    return { ...s, step }
  }),
})

/** Every switched-on step with its "$seguinte" made the step after it; a path into a switched-off one goes on past it. */
const desiredSteps = (draft: WorkflowDraft): RawStep[] => {
  const on = draft.steps.filter(s => s.on)
  const nextOn = (from: number): string => {
    const later = draft.steps.slice(from + 1).find(s => s.on)
    return later === undefined ? FLOW_END : String(later.step.id)
  }
  const through = (target: string, seen: readonly string[]): string => {
    const i = draft.steps.findIndex(s => s.step.id === target)
    const s = draft.steps[i]
    if (s === undefined || s.on || seen.includes(target)) return target
    const forward = Object.values(outcomesOf(s.step)).find(o => o.next === NEXT_STEP)
    return forward === undefined ? nextOn(i) : through(nextOn(i), [...seen, target])
  }
  return on.map(s => {
    const i = draft.steps.indexOf(s)
    const step = clone(s.step)
    for (const o of Object.values(outcomesOf(step))) o.next = o.next === NEXT_STEP ? nextOn(i) : through(o.next, [])
    // the deploy's routines in production's detect are the mod's to join, never written as its own
    if (step.detect !== undefined) {
      const own = ownDetect(step.detect as FlowDetect)
      if (own === undefined) delete step.detect
      else step.detect = own
    }
    return step
  })
}

/** An added step as `add` writes it: `{ use, …what differs from the library's }`, or the whole step. */
const addSpec = (s: WorkflowDraftStep): RawStep | string => {
  if (s.use === undefined) return s.step
  const spec: RawStep = { use: s.use }
  const plain = libraryStep(s.use)
  if (typeof plain !== 'string' && plain.id !== s.step.id) spec.id = s.step.id
  for (const key of ['merge', 'deploy'] as const) if (s.step[key] !== undefined) spec[key] = s.step[key]
  const lib = libraryStep(spec)
  if (typeof lib === 'string') return s.step
  for (const [key, value] of Object.entries(s.step)) {
    if (key !== 'id' && !same(value, lib[key])) spec[key] = value
  }
  return spec
}

const sequenceOf = (flow: FlowDef): string => flow.steps.map(s => s.id).join(' → ')

/** The fields the editor changes on a step, compared between the draft and what the mod would load. */
const EDITABLE = ['agent', 'model', 'effort', 'merge', 'deploy', 'details'] as const

/**
 * The file "Salvar" writes for a draft: with a base, the derived form (`remove`, `add`, `override`,
 * and `order` only when the steps moved); without one, the whole `steps`. `resolve` resolves a
 * candidate as the mod would load it; the file is returned only when it resolves to the draft.
 */
export const draftFile = (
  draft: WorkflowDraft,
  resolve: (raw: Record<string, unknown>) => FlowDef | { error: string },
): { raw: Record<string, unknown>; flow: FlowDef; notice?: string } | { error: string } => {
  const head = { id: draft.id, title: draft.title.trim() || draft.id, description: draft.description }
  const desired = desiredSteps(draft)
  if (draft.base === undefined) {
    const raw = { ...head, steps: desired }
    const flow = resolve(raw)
    if ('error' in flow) return flow
    const drift = driftOf(desired, flow)
    return drift === undefined ? { raw, flow } : { error: drift }
  }
  const kept = new Set(draft.steps.filter(s => s.from === 'base' && s.on).map(s => String(s.step.id)))
  const remove = draft.baseIds.filter(id => !kept.has(id))
  const add: { after: string; step: RawStep | string }[] = []
  const override: Record<string, RawStep> = {}
  let previous: string | undefined
  let notice: string | undefined
  for (const s of draft.steps.filter(x => x.on)) {
    const id = String(s.step.id)
    if (s.from === 'base') {
      const orig = s.orig ?? {}
      const changed: RawStep = {}
      for (const [key, value] of Object.entries(s.step)) {
        // production's detect also holds the deploy's routines, which parseFlow puts back by itself
        if (key === 'detect' && id === PRODUCTION_STEP) continue
        if (key !== 'id' && key !== 'kind' && key !== 'outcomes' && !same(value, orig[key])) changed[key] = value
      }
      const dropped = Object.keys(orig).filter(k => k !== 'outcomes' && s.step[k] === undefined)
      if (id === PRODUCTION_STEP) {
        const own = ownDetect(s.step.detect as FlowDetect | undefined)
        const was = ownDetect(orig.detect as FlowDetect | undefined)
        if (!same(own, was)) {
          if (own === undefined) dropped.push('detect')
          else {
            changed.detect = own
            notice = `O passo ${id} tem detect próprio (${own.commands.join(', ')}), gravado no override; as rotinas do deploy entram nele sozinhas.`
          }
        }
      }
      if (dropped.length > 0) {
        return { error: `O passo "${id}" vem do workflow ${draft.base}: dá para trocar ${dropped.join(', ')}, não tirar.` }
      }
      if (Object.keys(changed).length > 0) override[id] = changed
    } else {
      const after = previous ?? [...kept][0]
      if (after === undefined) return { error: `Mantenha ligado ao menos um passo de ${draft.base} para acrescentar passos a ele.` }
      add.push({ after, step: addSpec(s) })
    }
    previous = id
  }
  const raw: Record<string, unknown> = {
    ...head,
    base: draft.base,
    ...(remove.length > 0 ? { remove } : {}),
    ...(add.length > 0 ? { add } : {}),
  }
  const withOverride = () => (Object.keys(override).length > 0 ? { ...raw, override } : raw)
  const first = resolve(withOverride())
  if ('error' in first) return first
  if (sequenceOf(first) !== desired.map(s => s.id).join(' → ')) raw.order = desired.map(s => String(s.id))
  for (const want of desired) {
    const got = first.steps.find(s => s.id === want.id)
    for (const [name, o] of Object.entries(outcomesOf(want))) {
      if (got?.outcomes[name]?.next === o.next) continue
      const entry = (override[String(want.id)] ??= {})
      entry.outcomes = { ...((entry.outcomes ?? {}) as Outcomes), [name]: { next: o.next } }
    }
  }
  const finalRaw = withOverride()
  const flow = resolve(finalRaw)
  if ('error' in flow) return flow
  const routes = (steps: readonly { id: unknown; outcomes: unknown }[]) =>
    JSON.stringify(steps.map(s => [s.id, Object.entries(s.outcomes as Outcomes).map(([n, o]) => [n, o.next])]))
  if (routes(flow.steps) !== routes(desired as { id: unknown; outcomes: unknown }[])) {
    return { error: 'O workflow salvo não sairia igual ao rascunho; nada foi gravado.' }
  }
  const drift = driftOf(desired, flow)
  if (drift !== undefined) return { error: drift }
  return { raw: finalRaw, flow, ...(notice === undefined ? {} : { notice }) }
}

/** Where the loaded flow would differ from the draft in a field the editor changes; undefined when nowhere. */
const driftOf = (desired: readonly RawStep[], flow: FlowDef): string | undefined => {
  for (const want of desired) {
    const got = flow.steps.find(s => s.id === want.id) as unknown as RawStep | undefined
    const off = EDITABLE.filter(key => stable(want[key]) !== stable(got?.[key]))
    if (off.length > 0) {
      return `O workflow salvo não sairia igual ao rascunho (passo "${String(want.id)}": ${off.join(', ')}); nada foi gravado.`
    }
  }
  return undefined
}

/**
 * The project's workflows that resolve now and would stop resolving with `raw` written at `source`
 * (those that derive from it, directly or through others), by their file's error.
 */
export const brokenDependents = (
  defaults: readonly FlowSource[],
  project: readonly FlowSource[],
  source: string,
  raw: Record<string, unknown>,
): string[] => {
  const before = resolveProjectFlows(defaults, project).problems
  const others = project.filter(f => f.source !== source)
  const after = resolveProjectFlows(defaults, [...others, { source, raw }]).problems
  const failed = (problems: string[], file: string) => problems.some(p => p.startsWith(`${file}:`))
  return others.filter(f => !failed(before, f.source) && failed(after, f.source)).map(f => after.find(p => p.startsWith(`${f.source}:`))!)
}

/**
 * A candidate file resolved the way the mod loads the project's flows: the project's other files
 * beside it, the one it replaces left out; its own error, if any, is the answer.
 */
export const resolveCandidate = (
  defaults: readonly FlowSource[],
  project: readonly FlowSource[],
  source: string,
  raw: Record<string, unknown>,
): FlowDef | { error: string } => {
  const others = project.filter(f => f.source !== source && (f.raw as { id?: unknown } | null)?.id !== raw.id)
  const { flows, problems } = resolveProjectFlows(defaults, [...others, { source, raw }])
  const problem = problems.find(p => p.startsWith(`${source}:`))
  if (problem !== undefined) return { error: problem }
  return flows.find(f => f.id === raw.id) ?? { error: `${source}: não resolveu.` }
}
