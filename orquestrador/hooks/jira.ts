import type { FlowStep, JiraCategory, JiraIssue, JiraMove, JiraTarget, JiraTransition, OrchestrationRun, PhaseStatus } from '../types'

/** A Jira key as Jira spells it: project letters, a dash, a number. */
export const normalizeKey = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const key = value.trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]+-\d+$/.test(key) ? key : undefined
}

/** Every issue the plan names, the change's first, without repeats. */
export const jiraKeys = (run: OrchestrationRun): string[] => {
  const keys = [run.jira, ...run.waves.flatMap(w => [w.jira, ...w.phases.map(p => p.jira)])]
  return [...new Set(keys.filter((k): k is string => k !== undefined))]
}

/** A bare host from either `acme.atlassian.net` or `https://acme.atlassian.net/...`. */
export const siteHost = (site: string | undefined): string | undefined => {
  const host = site?.trim().replace(/^https?:\/\//, '').split('/')[0]
  return host === undefined || host === '' ? undefined : host
}

export const issueUrl = (site: string | undefined, key: string): string | undefined => {
  const host = siteHost(site)
  return host === undefined ? undefined : `https://${host}/browse/${key}`
}

const parse = (text: string | undefined): unknown => {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The connector's first site, from getAccessibleAtlassianResources: its URL and its cloud id. */
export const firstSite = (text: string | undefined): { url: string; cloudId: string } | undefined => {
  const parsed = parse(text)
  const rows = Array.isArray(parsed) ? parsed : []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    if (typeof r.url === 'string' && typeof r.id === 'string') return { url: r.url, cloudId: r.id }
  }
  return undefined
}

const findFields = (value: unknown, depth = 0): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || depth > 4) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.fields === 'object' && v.fields !== null) return v.fields as Record<string, unknown>
  for (const child of Object.values(v)) {
    const found = findFields(child, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

const asCategory = (value: unknown): JiraCategory =>
  value === 'new' || value === 'indeterminate' || value === 'done' ? value : 'unknown'

/** getJiraIssue's answer, read defensively: the shape is the connector's, not ours. */
export const parseIssue = (text: string | undefined, key: string, site: string | undefined): JiraIssue => {
  const fields = findFields(parse(text))
  const status = fields?.status as { name?: unknown; statusCategory?: { key?: unknown } } | undefined
  return {
    key,
    title: typeof fields?.summary === 'string' ? fields.summary : undefined,
    status: typeof status?.name === 'string' ? status.name : undefined,
    category: asCategory(status?.statusCategory?.key),
    url: issueUrl(site, key),
  }
}

/** Says when the panel and Jira disagree about whether the work is finished. */
export const divergence = (phase: PhaseStatus, issue: JiraIssue | undefined): string | undefined => {
  if (issue === undefined || issue.category === 'unknown') return undefined
  if (phase === 'done' && issue.category !== 'done') return `Fase fechada, mas ${issue.key} segue "${issue.status ?? 'aberta'}" no Jira`
  if (phase !== 'done' && issue.category === 'done') return `${issue.key} já está "${issue.status ?? 'concluída'}" no Jira, mas a fase não fechou`
  return undefined
}

const IN_PROGRESS: JiraTarget = { status: ['Em andamento', 'In Progress'], category: 'indeterminate' }
const DONE: JiraTarget = { status: ['Concluído', 'Concluída', 'Done'], category: 'done' }

/** The state each flow step implies, by step id; a flow file overrides it with the step's `jira`. */
export const DEFAULT_JIRA_TARGETS: Readonly<Record<string, JiraTarget>> = {
  executar: IN_PROGRESS,
  qa: { status: ['Em QA', 'QA', 'In QA', 'Em teste', 'Em validação'] },
  producao: DONE,
  arquivar: DONE,
}

const CATEGORIES = ['new', 'indeterminate', 'done']
const names = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter((n): n is string => typeof n === 'string' && n.trim() !== '').map(n => n.trim())

/** A step's `jira` in a flow file: a status name, a list of names, `{ status, category }`, or false for none. */
export const parseJiraTarget = (raw: unknown): JiraTarget | false | undefined | string => {
  if (raw === undefined) return undefined
  if (raw === false) return false
  const spec = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : { status: raw }
  const status = names(spec.status)
  const category = spec.category
  if (category !== undefined && !(typeof category === 'string' && CATEGORIES.includes(category))) {
    return '`jira.category` must be new, indeterminate or done.'
  }
  if (status.length === 0 && category === undefined) return '`jira` needs a status name, a `category`, or false.'
  return category === undefined ? { status } : { status, category: category as JiraTarget['category'] }
}

/** What the owner reads for a target: its first name, else its category. */
export const targetLabel = (t: JiraTarget): string =>
  t.status[0] ?? (t.category === 'done' ? 'Concluído' : t.category === 'new' ? 'A fazer' : 'Em andamento')

export const targetOf = (steps: readonly FlowStep[], stepId: string): JiraTarget | undefined => {
  const own = steps.find(s => s.id === stepId)?.jira
  return own === false ? undefined : (own ?? DEFAULT_JIRA_TARGETS[stepId])
}

const same = (a: string | undefined, b: string): boolean => a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase()

/** Already there: its status is one of the names, or, with no names, its category is the target's. */
export const reached = (issue: JiraIssue, t: JiraTarget): boolean =>
  t.status.length > 0 ? t.status.some(n => same(issue.status, n)) : t.category !== undefined && issue.category === t.category

/** The issues a step wants moved: the change's own, and during the loop each phase's (running work, closed work). */
export const wishes = (
  run: OrchestrationRun,
  steps: readonly FlowStep[],
  stepId: string,
): { key: string; target: JiraTarget }[] => {
  const target = targetOf(steps, stepId)
  const out: { key: string; target: JiraTarget }[] = []
  const add = (key: string | undefined, t: JiraTarget | undefined) => {
    if (key !== undefined && t !== undefined && !out.some(w => w.key === key)) out.push({ key, target: t })
  }
  add(run.jira, target)
  if (steps.find(s => s.id === stepId)?.kind === 'loop') {
    for (const phase of run.waves.flatMap(w => w.phases)) {
      if (phase.status === 'running') add(phase.jira, target)
      else if (phase.status === 'done') add(phase.jira, DONE)
    }
  }
  return out
}

const asTransition = (value: unknown): JiraTransition | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const t = value as { id?: unknown; name?: unknown; to?: { name?: unknown; statusCategory?: { key?: unknown } } }
  const id = typeof t.id === 'number' ? String(t.id) : t.id
  if (typeof id !== 'string' || typeof t.name !== 'string') return undefined
  return { id, name: t.name, to: typeof t.to?.name === 'string' ? t.to.name : undefined, category: asCategory(t.to?.statusCategory?.key) }
}

const findTransitions = (value: unknown, depth = 0): unknown[] | undefined => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'object' || value === null || depth > 3) return undefined
  const v = value as Record<string, unknown>
  if (Array.isArray(v.transitions)) return v.transitions
  for (const child of Object.values(v)) {
    const found = findTransitions(child, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** getTransitionsForJiraIssue's answer, read defensively. */
export const parseTransitions = (text: string | undefined): JiraTransition[] =>
  (findTransitions(parse(text)) ?? []).map(asTransition).filter((t): t is JiraTransition => t !== undefined)

/** The transition that reaches the target: by destination or transition name, else by destination category. */
export const pickTransition = (transitions: readonly JiraTransition[], t: JiraTarget): JiraTransition | undefined => {
  for (const n of t.status) {
    const hit = transitions.find(tr => same(tr.to, n) || same(tr.name, n))
    if (hit !== undefined) return hit
  }
  return t.category === undefined ? undefined : transitions.find(tr => tr.category === t.category)
}

/** The panel's item for one wished move; undefined when the issue is already there or could not be read. */
export const moveFor = (
  wish: { key: string; target: JiraTarget },
  issue: JiraIssue | undefined,
  transitions: readonly JiraTransition[] | undefined,
  step: string,
  connectorNote: string | undefined,
): JiraMove | undefined => {
  const base = { key: wish.key, title: issue?.title, from: issue?.status, toLabel: targetLabel(wish.target), step }
  if (connectorNote !== undefined) return { ...base, state: 'no-connector', available: [], note: connectorNote }
  if (issue === undefined || issue.status === undefined || reached(issue, wish.target)) return undefined
  const available = (transitions ?? []).map(tr => tr.to ?? tr.name)
  const hit = transitions === undefined ? undefined : pickTransition(transitions, wish.target)
  return hit === undefined
    ? { ...base, state: 'no-transition', available }
    : { ...base, state: 'ready', transitionId: hit.id, transitionName: hit.name, available }
}
