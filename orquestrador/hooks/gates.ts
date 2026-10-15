import type { GateCheck, GateRecord, GateSkip, GateState, GateView, Phase } from '../types'

/** The most phase sessions alive at once: more of them slows the owner's machine down. */
export const MAX_LIVE_SESSIONS = 3

type BashMatcher = { kind: 'bash'; pattern: RegExp }
type ToolMatcher = { kind: 'tool'; matches: (tool: string, input: Record<string, unknown>) => boolean; passes: (text: string) => boolean }

type GateDef = { label: string; how: string; matcher: BashMatcher | ToolMatcher }

const isScreenshot = (tool: string, input: Record<string, unknown>): boolean => {
  if (/(Claude_Browser|claude-in-chrome)__computer$/.test(tool)) return input.action === 'screenshot' || input.action === 'zoom'
  if (/Claude_Code_iOS_Simulator__control$/.test(tool)) return input.action === 'screenshot'
  if (/(Claude_Browser|claude-in-chrome)__browser_batch$/.test(tool) && Array.isArray(input.actions)) {
    return input.actions.some(
      (a: unknown) => (a as { input?: { action?: unknown } } | null)?.input?.action === 'screenshot',
    )
  }
  return false
}

const REVIEWER = /adr-reviewer|spec-reviewer|reviewer-architecture|reviewer-quality/

export const GATES: Readonly<Record<string, GateDef>> = {
  testes: {
    label: 'testes',
    how: 'a test command (vitest, jest, pytest, npm test, claude plugin test…) exiting 0',
    matcher: {
      kind: 'bash',
      pattern:
        /\b(vitest|jest|pytest|mocha|go test|cargo test|playwright test|claude plugin test)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test(:\S+)?\b/,
    },
  },
  lint: {
    label: 'lint',
    how: 'a lint/format check (eslint, prettier --check, ruff, biome, npm run lint…) exiting 0',
    matcher: {
      kind: 'bash',
      pattern:
        /\b(eslint|prettier\s+(--check|-c)|ruff|biome\s+(check|lint|ci)|stylelint|black\s+--check|flake8)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(lint|format:check)\b/,
    },
  },
  check: {
    label: 'check.sh',
    how: '`sh scripts/check.sh` exiting 0',
    matcher: { kind: 'bash', pattern: /\bscripts\/check\.sh\b/ },
  },
  openspec: {
    label: 'openspec',
    how: '`openspec validate` exiting 0',
    matcher: { kind: 'bash', pattern: /\bopenspec(\.js)?\s+validate\b/ },
  },
  visual: {
    label: 'visual',
    how: 'a screenshot taken in the browser pane, Chrome or the iOS simulator',
    matcher: { kind: 'tool', matches: isScreenshot, passes: () => true },
  },
  regras: {
    label: 'regras',
    how: 'a rules review (adr-reviewer, spec-reviewer, reviewer-architecture or reviewer-quality agent) approving',
    matcher: {
      kind: 'tool',
      matches: (tool, input) => tool === 'Agent' && typeof input.subagent_type === 'string' && REVIEWER.test(input.subagent_type),
      passes: text => /\b(approved|aprovad[oa]|no violations?|nenhuma viola)/i.test(text) && !/\b(rejected|reprovad[oa])\b/i.test(text),
    },
  },
}

export const GATE_IDS = Object.keys(GATES)

/** Gate ids a plan names, checked against the catalogue. */
export const parseGates = (raw: unknown, where: string): string[] | { error: string } | undefined => {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return { error: `${where}: \`gates\` must be a list of gate ids.` }
  const ids = [...new Set(raw.filter((g): g is string => typeof g === 'string').map(g => g.trim()))]
  const unknown = ids.filter(id => GATES[id] === undefined)
  if (unknown.length > 0) {
    return { error: `${where}: unknown gate ${unknown.join(', ')}; known gates are ${GATE_IDS.join(', ')}.` }
  }
  return ids.length === 0 ? undefined : ids
}

/**
 * A pipe hands the shell the exit code of its last command, so `npm test | tail`
 * "passes" whatever the tests did, and `npm test || true` always exits 0: such a run
 * proves a failure, never a pass.
 */
const masksExitCode = (command: string): boolean =>
  (/(^|[^|])\|(?!\|)/.test(command) && !/pipefail/.test(command)) || /\|\|/.test(command)

/**
 * The words the shell runs, without the text it only carries: a heredoc body or a quoted
 * string that mentions `npm test` writes a file, it does not run the tests.
 */
export const executedText = (command: string): string =>
  command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, '<<heredoc')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')

/** The one shell step that ran the gate, short enough to read in the panel. */
const evidenceOf = (code: string, pattern: RegExp): string => {
  const step = code.split(/&&|\|\||[;|\n]/).find(part => pattern.test(part)) ?? code
  return step.replace(/\s+/g, ' ').trim().slice(0, 60)
}

/** What one finished Bash command proves, gate by gate. */
export const observeBash = (command: string, failed: boolean, at: number): GateRecord[] => {
  const code = executedText(command)
  return Object.entries(GATES).flatMap(([gate, def]): GateRecord[] => {
    if (def.matcher.kind !== 'bash' || !def.matcher.pattern.test(code)) return []
    if (!failed && masksExitCode(code)) return []
    return [{ gate, result: failed ? 'failed' : 'passed', evidence: evidenceOf(code, def.matcher.pattern), at }]
  })
}

/** What one finished non-Bash tool call proves: a screenshot, a reviewer's verdict. */
export const observeTool = (
  tool: string,
  input: Record<string, unknown>,
  failed: boolean,
  text: string,
  at: number,
): GateRecord[] =>
  Object.entries(GATES).flatMap(([gate, def]): GateRecord[] => {
    if (def.matcher.kind !== 'tool' || !def.matcher.matches(tool, input)) return []
    const passed = !failed && def.matcher.passes(text)
    const what = tool === 'Agent' ? `agente ${String(input.subagent_type)}` : 'screenshot'
    return [{ gate, result: passed ? 'passed' : 'failed', evidence: what, at }]
  })

/** The latest record per gate wins: a fresh pass clears an old failure and the reverse. */
export const mergeRecords = (
  records: Readonly<Record<string, GateRecord>>,
  observed: readonly GateRecord[],
): Record<string, GateRecord> => {
  const next = { ...records }
  for (const record of observed) {
    const prior = next[record.gate]
    if (prior === undefined || prior.at <= record.at) next[record.gate] = record
  }
  return next
}

/** Edits made after a pass leave it unproven for the code as it now stands. */
export const gateState = (
  record: GateRecord | undefined,
  editedAt: number | undefined,
  skip: GateSkip | undefined,
): GateState => {
  if (record?.result === 'passed' && (editedAt === undefined || editedAt <= record.at)) return 'passed'
  if (skip !== undefined) return 'skipped'
  if (record === undefined) return 'pending'
  return record.result === 'failed' ? 'failed' : 'stale'
}

export const skipKey = (scope: string, gate: string): string => `${scope}:${gate}`
export const FINAL_SCOPE = '*final'

export const gateViews = (
  gates: readonly string[] | undefined,
  scope: string,
  check: GateCheck,
  skips: Readonly<Record<string, GateSkip>>,
): GateView[] =>
  (gates ?? []).map(gate => {
    const record = check.records[gate]
    const skip = skips[skipKey(scope, gate)]
    return {
      gate,
      label: GATES[gate]?.label ?? gate,
      state: gateState(record, check.editedAt, skip),
      evidence: record?.evidence,
      at: record?.at,
      skipKey: skipKey(scope, gate),
    }
  })

export const isOpenGate = (view: GateView): boolean => view.state !== 'passed' && view.state !== 'skipped'

/** Final gates are proven by whichever session of the family ran them last. */
export const familyCheck = (checks: readonly GateCheck[]): GateCheck => {
  const records: Record<string, GateRecord> = {}
  let editedAt: number | undefined
  for (const check of checks) {
    for (const record of Object.values(check.records)) {
      const prior = records[record.gate]
      if (prior === undefined || prior.at < record.at) records[record.gate] = record
    }
    if (check.editedAt !== undefined && (editedAt === undefined || check.editedAt > editedAt)) editedAt = check.editedAt
  }
  return { records, editedAt }
}

const STATE_WORD: Record<GateState, string> = {
  passed: 'passed',
  failed: 'failed',
  pending: 'not run',
  stale: 'stale (files edited after it passed)',
  skipped: 'skipped by the owner',
}

/** Why a phase cannot close yet, in the words the model reads; undefined when it can. */
export const phaseRefusal = (phase: Pick<Phase, 'id' | 'title'>, open: readonly GateView[], where: string): string | undefined =>
  open.length === 0
    ? undefined
    : `phase ${phase.id} (${phase.title}) cannot close: ` +
      open.map(v => `${v.gate} ${STATE_WORD[v.state]} — needs ${GATES[v.gate]?.how ?? v.gate}`).join('; ') +
      ` (checked in ${where}). Run the gate in that session, or ask the owner: only they can skip a gate, from the panel.`

/** Phase sessions still alive: started by this session and not archived. */
export const liveSessions = <T extends { startedBy: string | undefined; isArchived: boolean }>(
  rows: readonly T[],
  selfId: string | undefined,
): T[] => (selfId === undefined ? [] : rows.filter(row => row.startedBy === selfId && !row.isArchived))

export const GH_MERGE = /\bgh\s+pr\s+merge\b/
export const PROTECTED_DIR = '/.claude/orquestrador/'
