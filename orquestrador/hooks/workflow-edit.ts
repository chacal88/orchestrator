import type { FlowDef, FlowDeploy, FlowDetect, FlowMerge, ProjectSettings, WorkflowDraft, WorkflowDraftStep, WorkflowForms } from '../types'
import { FLOW_END, PRODUCTION_STEP, asWritten, ownDetect, resolveProjectFlows } from './flow'
import type { FlowSource } from './flow'
import { LIBRARY, NEXT_STEP, libraryStep } from './flows/library'
import { localize, parseLocalized } from './i18n'
import { workflowsText } from './i18n-workflows'
import type { WorkflowsText } from './i18n-workflows'

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

/** A merge or deploy block's values, without the note of which came from the project. */
const valuesOf = (block: unknown): Record<string, unknown> | undefined => {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return undefined
  const { fromProject: _note, ...values } = block as Record<string, unknown>
  return values
}
/** The block as a file writes it: without the values that came from the project, and the note. `keep` stays. */
const fileBlock = (block: unknown, keep: readonly string[] = []): Record<string, unknown> | undefined => {
  const values = valuesOf(block)
  if (values === undefined) return undefined
  const from = ((block as Record<string, unknown>).fromProject ?? []) as string[]
  return Object.fromEntries(Object.entries(values).filter(([k]) => !from.includes(k) || keep.includes(k)))
}
/** A step as a whole file writes it: its merge or deploy without what the project supplies (`auto` stays, it decides the kind). */
const fileStep = (step: RawStep): RawStep => {
  const out = { ...step }
  for (const key of ['merge', 'deploy'] as const) if (out[key] !== undefined) out[key] = fileBlock(out[key], ['auto'])
  return out
}
const outcomesOf = (step: RawStep): Outcomes => (step.outcomes ?? {}) as Outcomes

export const EMPTY_FORMS: WorkflowForms = { newId: '', newBase: '', stepTitle: '', stepKind: 'session', stepAgent: '', stepCommand: '', libraryUse: '', routineFor: '' }

/** A workflow id the owner types: lowercase words joined by hyphens. */
export const WORKFLOW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A flow's steps as the editor holds them, as a file writes them (every language kept): each step's forward outcomes (those that lead to the
 * step after it, or to the end after the last) lead to "$seguinte", so moving a step moves the path.
 */
const asDraftSteps = (flow: FlowDef): RawStep[] =>
  flow.steps.map((s, i) => {
    const step = clone(asWritten(s))
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
  const draft = draftFrom(flow, base, replacesDefault)
  return { ...draft, initial: snapshot(draft) }
}

const snapshot = (draft: WorkflowDraft): NonNullable<WorkflowDraft['initial']> => ({
  title: draft.title,
  description: draft.description,
  steps: clone(draft.steps.map(s => ({ id: String(s.step.id), step: s.step, on: s.on }))),
})

const draftFrom = (flow: FlowDef, base: FlowDef | undefined, replacesDefault: boolean): WorkflowDraft => {
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
export const newDraft = (id: string, base: FlowDef | undefined, title?: string): WorkflowDraft => {
  const made: WorkflowDraft =
    base === undefined
      ? { id, title: title ?? id, description: '', baseIds: [], replacesDefault: false, steps: [] }
      : { ...draftOf(base, base, false), id, title: title ?? `${base.title} (${id})` }
  return { ...made, initial: { ...(made.initial ?? snapshot(made)), title: made.title } }
}

const uniqueId = (draft: WorkflowDraft, wanted: string): string => {
  const taken = new Set([...draft.steps.map(s => String(s.step.id)), ...draft.baseIds])
  if (!taken.has(wanted)) return wanted
  let n = 2
  while (taken.has(`${wanted}-${n}`)) n++
  return `${wanted}-${n}`
}

export const slug = (text: string): string =>
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
export const addLibraryStep = (
  draft: WorkflowDraft,
  use: string,
  after: string | null,
  project: ProjectSettings = {},
): WorkflowDraft | { error: string } => {
  const probe = libraryStep(use, project)
  if (typeof probe === 'string') return { error: probe }
  const id = uniqueId(draft, String(probe.id))
  const step = libraryStep({ use, id }, project)
  if (typeof step === 'string') return { error: step }
  return insertAfter(draft, after, { step: { ...step, id }, from: 'added', use, on: true })
}

/** A new step with its title, who answers it and its agent; an automatic one needs its command. */
export const addNewStep = (
  draft: WorkflowDraft,
  form: WorkflowForms,
  after: string | null,
  t: WorkflowsText = workflowsText(undefined),
): WorkflowDraft | { error: string } => {
  const title = form.stepTitle.trim()
  if (title === '') return { error: t.editor.stepTitleRequired }
  const command = form.stepCommand.trim()
  if (form.stepKind === 'automatic' && command === '') return { error: t.editor.automaticNeedsCommand }
  const agent = form.stepAgent.trim()
  if (agent !== '' && form.stepKind !== 'session') return { error: t.editor.onlySessionAgent }
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
  if (i === -1 || !draft.steps[i]!.on) return draft
  // the step swaps with the nearest switched-on one; switched-off steps stay where they are
  let j = i + by
  while (j >= 0 && j < draft.steps.length && !draft.steps[j]!.on) j += by
  if (j < 0 || j >= draft.steps.length) return draft
  const steps = [...draft.steps]
  ;[steps[i], steps[j]] = [steps[j]!, steps[i]!]
  return { ...draft, steps, error: undefined }
}

/** What the owner changed since the draft was opened, one short phrase each, for the bar at the top. */
export const changesOf = (draft: WorkflowDraft, t: WorkflowsText = workflowsText(undefined)): string[] => {
  const init = draft.initial
  if (init === undefined) return []
  const out: string[] = []
  if (draft.title !== init.title) out.push(t.editor.title)
  if (draft.description !== init.description) out.push(t.editor.description)
  const before = new Map(init.steps.map(s => [s.id, s]))
  const label = (s: WorkflowDraftStep) => localize(parseLocalized(s.step.title), t.lang) ?? String(s.step.id)
  for (const s of draft.steps) {
    const was = before.get(String(s.step.id))
    if (was === undefined) {
      if (s.on) out.push(t.editor.stepAdded(label(s)))
    } else if (was.on !== s.on) {
      out.push(s.on ? t.editor.stepOn(label(s)) : t.editor.stepOff(label(s)))
    } else {
      const off = (['agent', 'model', 'effort', 'merge', 'deploy'] as const).filter(k => stable(s.step[k]) !== stable(was.step[k]))
      if (off.length > 0) out.push(t.editor.stepFields(label(s), off.map(k => t.editor.fields[k]).join(', ')))
    }
  }
  const common = (ids: string[]) => ids.filter(id => before.has(id) && draft.steps.some(s => s.step.id === id))
  const now = common(draft.steps.map(s => String(s.step.id)))
  if (common(init.steps.map(s => s.id)).join() !== now.join()) out.push(t.editor.order)
  return out
}

export type StepField =
  | { field: 'agent' | 'model' | 'effort'; value: string }
  | { field: 'merge'; value: Partial<FlowMerge> }
  | { field: 'deploy'; value: Partial<FlowDeploy> }

/** The merge or deploy step built again from `next` (its explicit fields); who answers it follows its `auto`. */
const rebuildStep = (s: WorkflowDraftStep, field: 'merge' | 'deploy', next: Record<string, unknown>, id: string, project: ProjectSettings): WorkflowDraftStep => {
  const rebuilt = libraryStep({ use: field, id, [field]: next }, project)
  if (typeof rebuilt === 'string') return s
  for (const key of ['title', 'agent', 'model', 'effort', 'details'] as const) {
    if (s.step[key] !== undefined) rebuilt[key] = s.step[key]
  }
  return { step: rebuilt, from: 'added', use: field, on: s.on }
}

/**
 * One field of a step changed. An empty agent, model or effort clears it. A merge or deploy that
 * turns automatic (or back) is the library's step built again, which changes who answers it. A merge
 * or deploy field the owner sets is the step's own from then on, no longer the project's.
 */
export const setStepField = (draft: WorkflowDraft, id: string, change: StepField, project: ProjectSettings = {}): WorkflowDraft => ({
  ...draft,
  error: undefined,
  steps: draft.steps.map(s => {
    if (s.step.id !== id) return s
    const step = { ...s.step }
    if (change.field === 'merge' || change.field === 'deploy') {
      const prior = (step[change.field] ?? {}) as Record<string, unknown>
      const next: Record<string, unknown> = { ...prior, ...change.value }
      const inherited = ((prior.fromProject ?? []) as string[]).filter(k => !(k in change.value))
      if (inherited.length > 0) next.fromProject = inherited
      else delete next.fromProject
      if (next.auto === prior.auto) return { ...s, step: { ...step, [change.field]: next } }
      return rebuildStep(s, change.field, next, id, project)
    }
    const value = change.value.trim()
    if (value === '') delete step[change.field]
    else step[change.field] = value
    return { ...s, step }
  }),
})

/** The step goes back to the project's merge or deploy: none of its own fields are kept. */
export const useProjectValues = (draft: WorkflowDraft, id: string, project: ProjectSettings): WorkflowDraft => ({
  ...draft,
  error: undefined,
  steps: draft.steps.map(s => {
    if (s.step.id !== id) return s
    const field = s.step.merge !== undefined ? 'merge' : s.step.deploy !== undefined ? 'deploy' : undefined
    return field === undefined ? s : rebuildStep(s, field, {}, id, project)
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
const addSpec = (s: WorkflowDraftStep, project: ProjectSettings): RawStep | string => {
  if (s.use === undefined) return fileStep(s.step)
  const spec: RawStep = { use: s.use }
  const plain = libraryStep(s.use, project)
  if (typeof plain !== 'string' && plain.id !== s.step.id) spec.id = s.step.id
  // what the step writes (as before), less the values the project supplies: those are not the workflow's
  for (const key of ['merge', 'deploy'] as const) {
    const own = fileBlock(s.step[key])
    if (own !== undefined && Object.keys(own).length > 0) spec[key] = own
  }
  const lib = libraryStep(spec, project)
  if (typeof lib === 'string') return fileStep(s.step)
  for (const [key, value] of Object.entries(s.step)) {
    if (key !== 'id' && key !== 'merge' && key !== 'deploy' && !same(value, lib[key])) spec[key] = value
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
  t: WorkflowsText = workflowsText(undefined),
  project: ProjectSettings = {},
): { raw: Record<string, unknown>; flow: FlowDef; notice?: string } | { error: string } => {
  const head = { id: draft.id, title: draft.title.trim() || draft.id, description: draft.description }
  const desired = desiredSteps(draft)
  if (draft.base === undefined) {
    const raw = { ...head, steps: desired.map(fileStep) }
    const flow = resolve(raw)
    if ('error' in flow) return flow
    const drift = driftOf(desired, flow, t)
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
        if (key === 'merge' || key === 'deploy') {
          // the project's values are not the workflow's: only what the step writes goes in the override
          if (!same(fileBlock(value), fileBlock(orig[key]))) changed[key] = fileBlock(value)
        } else if (key !== 'id' && key !== 'kind' && key !== 'outcomes' && !same(value, orig[key])) changed[key] = value
      }
      const dropped = Object.keys(orig).filter(k => k !== 'outcomes' && s.step[k] === undefined)
      if (id === PRODUCTION_STEP) {
        const own = ownDetect(s.step.detect as FlowDetect | undefined)
        const was = ownDetect(orig.detect as FlowDetect | undefined)
        if (!same(own, was)) {
          if (own === undefined) dropped.push('detect')
          else {
            changed.detect = own
            notice = t.editor.ownDetect(id, own.commands.join(', '))
          }
        }
      }
      if (dropped.length > 0) {
        return { error: t.editor.cannotDrop(id, draft.base, dropped.join(', ')) }
      }
      if (Object.keys(changed).length > 0) override[id] = changed
    } else {
      const after = previous ?? [...kept][0]
      if (after === undefined) return { error: t.editor.keepOne(draft.base) }
      add.push({ after, step: addSpec(s, project) })
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
    return { error: t.editor.notSame }
  }
  const drift = driftOf(desired, flow, t)
  if (drift !== undefined) return { error: drift }
  return { raw: finalRaw, flow, ...(notice === undefined ? {} : { notice }) }
}

/** Where the loaded flow would differ from the draft in a field the editor changes; undefined when nowhere. */
const driftOf = (desired: readonly RawStep[], flow: FlowDef, t: WorkflowsText): string | undefined => {
  for (const want of desired) {
    // compared as a file writes the step, so a field given per language reads the same on both sides
    const parsed = flow.steps.find(s => s.id === want.id)
    const got = parsed === undefined ? undefined : asWritten(parsed)
    const off = EDITABLE.filter(key =>
      key === 'merge' || key === 'deploy' ? stable(valuesOf(want[key])) !== stable(valuesOf(got?.[key])) : stable(want[key]) !== stable(got?.[key]),
    )
    if (off.length > 0) {
      return t.editor.drift(String(want.id), off.join(', '))
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
  settings: ProjectSettings = {},
): string[] => {
  const before = resolveProjectFlows(defaults, project, settings).problems
  const others = project.filter(f => f.source !== source)
  const after = resolveProjectFlows(defaults, [...others, { source, raw }], settings).problems
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
  t: WorkflowsText = workflowsText(undefined),
  settings: ProjectSettings = {},
): FlowDef | { error: string } => {
  const others = project.filter(f => f.source !== source && (f.raw as { id?: unknown } | null)?.id !== raw.id)
  const { flows, problems } = resolveProjectFlows(defaults, [...others, { source, raw }], settings)
  const problem = problems.find(p => p.startsWith(`${source}:`))
  if (problem !== undefined) return { error: problem }
  return flows.find(f => f.id === raw.id) ?? { error: t.editor.unresolved(source) }
}
