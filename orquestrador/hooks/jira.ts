import type { JiraCategory, JiraIssue, OrchestrationRun, PhaseStatus } from '../types'

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
