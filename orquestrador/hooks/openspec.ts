import type { EvidenceState, OpenSpecView, TaskItem, TaskSection } from '../types'

const SUMMARY_MAX = 420

/** Markdown down to plain prose: the panel draws text, not markdown. */
const plain = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const clip = (text: string): string =>
  text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1).trimEnd()}…`

/** tasks.md checkboxes counted per `## ` section; boxes above the first section count under "Geral". */
export const parseTasks = (text: string): { sections: TaskSection[]; done: number; total: number } => {
  const sections: TaskSection[] = []
  let current: TaskSection | undefined
  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      current = { title: plain(heading[1] ?? ''), done: 0, total: 0 }
      sections.push(current)
      continue
    }
    const box = line.match(/^\s*[-*]\s+\[([ xX])\]/)
    if (!box) continue
    if (current === undefined) {
      current = { title: 'Geral', done: 0, total: 0 }
      sections.push(current)
    }
    current.total += 1
    if (box[1] !== ' ') current.done += 1
  }
  const withBoxes = sections.filter(s => s.total > 0)
  return {
    sections: withBoxes,
    done: withBoxes.reduce((sum, s) => sum + s.done, 0),
    total: withBoxes.reduce((sum, s) => sum + s.total, 0),
  }
}

/** The numbered checkboxes of tasks.md; a box without a number belongs to no phase and is left out. */
export const parseTaskItems = (text: string): TaskItem[] =>
  text.split('\n').flatMap((line): TaskItem[] => {
    const item = line.match(/^\s*[-*]\s+\[([ xX])\]\s+\**(\d+(?:\.\d+)+)\**\.?\s+(.*)$/)
    if (!item) return []
    return [{ id: item[2] ?? '', text: plain(item[3] ?? ''), done: item[1] !== ' ' }]
  })

const versionParts = (id: string): number[] => id.split('.').map(Number)

const inRange = (id: string, from: string, to: string): boolean => {
  const [a, b, c] = [versionParts(id), versionParts(from), versionParts(to)]
  const cmp = (x: number[], y: number[]) => {
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }
  return cmp(a, b) >= 0 && cmp(a, c) <= 0
}

/**
 * The tasks a phase delivers, from the plan's `tasks` field: "4.1–4.4" (a range), "4.x" (a
 * whole section), "3.1" or a list of those separated by commas.
 */
export const tasksForPhase = (spec: string | undefined, items: readonly TaskItem[]): TaskItem[] => {
  if (spec === undefined || spec.trim() === '') return []
  const parts = spec.split(',').map(part => part.trim()).filter(part => part !== '')
  return items.filter(item =>
    parts.some(part => {
      const section = part.match(/^(\d+(?:\.\d+)*)\.[xX*]$/)
      if (section) return item.id.startsWith(`${section[1]}.`)
      const range = part.match(/^(\d+(?:\.\d+)+)\s*[–—-]\s*(\d+(?:\.\d+)+)$/)
      if (range) return inRange(item.id, range[1] ?? '', range[2] ?? '')
      return item.id === part
    }),
  )
}

const isProse = (paragraph: string): boolean =>
  paragraph !== '' &&
  !/^(#|\||```|>|---|\*\*[^*]+:\*\*)/.test(paragraph) &&
  !/^[-*]\s+\*\*[^*]+:\*\*/.test(paragraph)

const paragraphs = (lines: readonly string[]): string[] =>
  lines
    .join('\n')
    .split(/\n\s*\n/)
    .map(p => p.trim())

/**
 * The proposal's title and the first prose paragraph of its "Why" section; without
 * one, the first prose paragraph under the title, past the metadata block.
 */
export const parseProposal = (text: string): { title: string | undefined; summary: string | undefined } => {
  const lines = text.split('\n')
  const titleLine = lines.find(line => /^#\s+/.test(line))
  const title = titleLine === undefined ? undefined : plain(titleLine.replace(/^#\s+(Proposal:\s*)?/i, ''))
  const why = lines.findIndex(line => /^##\s+(Why|Por qu[eê]|Motiva|Summary|Resumo)/i.test(line))
  if (why >= 0) {
    const end = lines.findIndex((line, i) => i > why && /^##\s/.test(line))
    const found = paragraphs(lines.slice(why + 1, end < 0 ? undefined : end)).find(isProse)
    if (found !== undefined) return { title, summary: clip(plain(found)) }
  }
  const found = paragraphs(lines).find(isProse)
  return { title: title === '' ? undefined : title, summary: found === undefined ? undefined : clip(plain(found)) }
}

/** The last `== check summary ==` block's PASS/FAIL rows, as check.sh prints them. */
const lastCheckSummary = (text: string): { pass: string[]; fail: string[] } | undefined => {
  const at = text.lastIndexOf('== check summary ==')
  if (at < 0) return undefined
  const pass: string[] = []
  const fail: string[] = []
  for (const line of text.slice(at).split('\n').slice(1)) {
    const row = line.match(/^(PASS|FAIL)\s+(\S+)/)
    if (row) (row[1] === 'PASS' ? pass : fail).push(row[2] ?? '')
    else if (pass.length + fail.length > 0) break
  }
  return pass.length + fail.length === 0 ? undefined : { pass, fail }
}

/** Where evidence.md stands: a stub, a check.sh run (green or failing) or other recorded proof. */
export const parseEvidence = (text: string | undefined): { state: EvidenceState; summary: string | undefined } => {
  if (text === undefined) return { state: 'missing', summary: 'evidence.md ainda não existe.' }
  const check = lastCheckSummary(text)
  if (check !== undefined) {
    if (check.fail.length > 0) {
      return {
        state: 'failing',
        summary: `Último check.sh: ${check.fail.length} falha(s) — ${check.fail.slice(0, 4).join(', ')}; ${check.pass.length} ok.`,
      }
    }
    return { state: 'green', summary: `Último check.sh verde: ${check.pass.length} verificações passaram.` }
  }
  if (/pre-execution stub|status:\s*stub|not run yet/i.test(text)) {
    return { state: 'stub', summary: 'Esqueleto: nada verificado ainda, sem resultado do check.sh.' }
  }
  const sections = text.split('\n').filter(line => /^##\s/.test(line)).length
  return { state: 'recorded', summary: `${sections} seção(ões) registradas, sem resumo do check.sh.` }
}

export const openSpecView = (
  files: { tasks: string | undefined; proposal: string | undefined; evidence: string | undefined },
): OpenSpecView => {
  const tasks = files.tasks === undefined ? { sections: [], done: 0, total: 0 } : parseTasks(files.tasks)
  const proposal = files.proposal === undefined ? { title: undefined, summary: undefined } : parseProposal(files.proposal)
  const evidence = parseEvidence(files.evidence)
  return {
    ...tasks,
    proposalTitle: proposal.title,
    proposalSummary: proposal.summary,
    evidence: evidence.state,
    evidenceSummary: evidence.summary,
    items: files.tasks === undefined ? [] : parseTaskItems(files.tasks),
  }
}

/** The change folder: as given when absolute, else under the coordinator's checkout. */
export const changeDir = (changePath: string, coordinatorCwd: string): string =>
  (changePath.startsWith('/') ? changePath : `${coordinatorCwd}/${changePath.replace(/^\.\//, '')}`).replace(/\/+$/, '')
