import type { ConfigDraft, FlowDef, FlowStep, Lang, Languages, ProjectDeploy, ProjectMerge, ProjectSettings } from '../types'
import { parseConfig } from './i18n'
import type { WorkflowsText } from './i18n-workflows'
import { DEPLOY_KEYS, MERGE_KEYS } from './project-config'

/** What a merge or deploy step is built with where neither the workflow nor the project says. */
export const MERGE_DEFAULTS: Required<ProjectMerge> = { branch: 'main', method: 'squash', auto: false }
export const DEPLOY_DEFAULTS: Required<ProjectDeploy> = { ci: true, commands: [], auto: false }

export const effectiveMerge = (m: ProjectMerge): Required<ProjectMerge> => ({ ...MERGE_DEFAULTS, ...m })
export const effectiveDeploy = (d: ProjectDeploy): Required<ProjectDeploy> => ({ ...DEPLOY_DEFAULTS, ...d })

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A draft to edit the settings as the files hold them now. */
export const draftOfConfig = (languages: Languages, project: ProjectSettings): ConfigDraft => {
  const merge = clone(project.merge ?? {})
  const deploy = clone(project.deploy ?? {})
  return { languages: { ...languages }, merge, deploy, initial: { languages: { ...languages }, merge: clone(merge), deploy: clone(deploy) } }
}

export type ConfigChange =
  | { kind: 'ui' | 'content'; value: Lang }
  | { kind: 'merge'; value: ProjectMerge }
  | { kind: 'deploy'; value: ProjectDeploy }

export const applyConfigChange = (draft: ConfigDraft, change: ConfigChange): ConfigDraft => {
  const { error: _gone, ...rest } = draft
  switch (change.kind) {
    case 'ui':
      return { ...rest, languages: { ...draft.languages, ui: change.value } }
    case 'content':
      return { ...rest, languages: { ...draft.languages, content: change.value } }
    case 'merge':
      return { ...rest, merge: { ...draft.merge, ...change.value } }
    case 'deploy':
      return { ...rest, deploy: { ...draft.deploy, ...change.value } }
  }
}

/** What the draft changes against the file, one value each, in the order of the screen. */
const differences = (draft: ConfigDraft) => {
  const was = draft.initial
  const mergeNow = effectiveMerge(draft.merge)
  const mergeWas = effectiveMerge(was.merge)
  const deployNow = effectiveDeploy(draft.deploy)
  const deployWas = effectiveDeploy(was.deploy)
  return {
    ui: draft.languages.ui !== was.languages.ui,
    content: draft.languages.content !== was.languages.content,
    merge: MERGE_KEYS.filter(k => !same(mergeNow[k], mergeWas[k])),
    deploy: DEPLOY_KEYS.filter(k => !same(deployNow[k], deployWas[k])),
  }
}

/** The changes, one short phrase each, for the bar at the top. */
export const configChanges = (draft: ConfigDraft, t: WorkflowsText): string[] => {
  const d = differences(draft)
  const c = t.project.edit.change
  const merge = effectiveMerge(draft.merge)
  const deploy = effectiveDeploy(draft.deploy)
  const name = (l: Lang) => t.project.edit.langOption[l] ?? l
  return [
    ...(d.ui ? [c.ui(name(draft.languages.ui))] : []),
    ...(d.content ? [c.content(name(draft.languages.content))] : []),
    ...d.merge.map(k => (k === 'auto' ? c.mergeAuto(merge.auto) : k === 'branch' ? c.branch(merge.branch) : c.method(merge.method))),
    ...d.deploy.map(k => (k === 'auto' ? c.deployAuto(deploy.auto) : k === 'ci' ? c.ci(deploy.ci) : c.routines)),
  ]
}

/**
 * The file's new text: the one on disk with only the keys the draft changed set, every other key kept.
 * A file that is not a JSON object, or a result `parseConfig` would name a new problem in, is refused.
 */
export const configText = (prior: string | undefined, draft: ConfigDraft, t: WorkflowsText): { text: string } | { error: string } => {
  let raw: Record<string, unknown> = {}
  if (prior !== undefined && prior.trim() !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(prior)
    } catch {
      return { error: t.project.edit.notJson }
    }
    if (!isRecord(parsed)) return { error: t.project.edit.notObject }
    raw = parsed
  }
  const d = differences(draft)
  const out: Record<string, unknown> = { ...raw }
  if (d.ui || d.content) {
    const was = raw.language
    const language: Record<string, unknown> =
      typeof was === 'string' ? { ui: was, content: was } : isRecord(was) ? { ...was } : {}
    if (d.ui) language.ui = draft.languages.ui
    if (d.content) language.content = draft.languages.content
    out.language = language
  }
  const block = (key: 'merge' | 'deploy', keys: readonly string[], values: Record<string, unknown>) => {
    if (keys.length === 0) return
    const block: Record<string, unknown> = isRecord(raw[key]) ? { ...(raw[key] as Record<string, unknown>) } : {}
    for (const k of keys) block[k] = values[k]
    out[key] = block
  }
  block('merge', d.merge, effectiveMerge(draft.merge))
  block('deploy', d.deploy, effectiveDeploy(draft.deploy))
  const text = `${JSON.stringify(out, null, 2)}\n`
  const before = parseConfig(prior).problems
  const fresh = parseConfig(text).problems.filter(p => !before.includes(p))
  if (fresh.length > 0) return { error: fresh.join(' ') }
  return { text }
}

/** True when the draft differs from what the file held. */
export const configChanged = (draft: ConfigDraft): boolean => {
  const d = differences(draft)
  return d.ui || d.content || d.merge.length > 0 || d.deploy.length > 0
}

/** A merge or deploy step's values the workflow keeps for itself against what the project sets. */
export type OwnValues = { step: FlowStep; what: 'merge' | 'deploy'; fields: string[] }

export type WorkflowState = {
  id: string
  /** The steps the workflow lacks: where the project's options do not apply. */
  missing: ('merge' | 'deploy')[]
  /** Steps with a value of their own where the project sets one. */
  own: OwnValues[]
}

/** How each workflow stands against the project's merge and deploy settings. */
export const workflowState = (flow: FlowDef, project: ProjectSettings): WorkflowState => {
  const missing: ('merge' | 'deploy')[] = []
  const own: OwnValues[] = []
  for (const what of ['merge', 'deploy'] as const) {
    const steps = flow.steps.filter(s => s[what] !== undefined)
    if (steps.length === 0) missing.push(what)
    const set = Object.keys(project[what] ?? {}).filter(k => (project[what] as Record<string, unknown>)[k] !== undefined)
    for (const step of steps) {
      const from = step[what]?.fromProject ?? []
      const fields = set.filter(k => !from.includes(k))
      if (fields.length > 0) own.push({ step, what, fields })
    }
  }
  return { id: flow.id, missing, own }
}
