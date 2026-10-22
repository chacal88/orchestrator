import type { FlowState, GateAttempt, GateCheck, GateRecord, GateSkip, GateState, GateView, Phase, PlanItem, Waiting } from '../types'

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

/**
 * A package manager running a script, with the flags a monorepo puts before it:
 * `pnpm --filter api test`, `pnpm -F api lint`, `pnpm -r test`, `yarn workspace api test`.
 * A flag's value is any word but the script verbs, so `pnpm -r test` reads `-r` alone.
 */
const PACKAGE_SCRIPT =
  String.raw`\b(npm|pnpm|yarn|bun)\b(\s+workspace\s+\S+)?` +
  String.raw`(\s+-{1,2}[\w-]+(=\S+|\s+(?!-|run\b|exec\b|test\b|lint\b)[^\s;&|]+)?)*\s+(run\s+)?`

/** A turbo task, alone or among others: `pnpm turbo lint --filter=api`, `npx turbo run build test`. */
const TURBO_TASK = String.raw`\bturbo\s+(run\s+)?([\w@][\w:#@/.-]*\s+)*?`

const REVIEWER = /adr-reviewer|spec-reviewer|reviewer-architecture|reviewer-quality/

export const GATES: Readonly<Record<string, GateDef>> = {
  testes: {
    label: 'testes',
    how: 'a test command (vitest, jest, pytest, npm test, claude plugin test…) exiting 0',
    matcher: {
      kind: 'bash',
      pattern: new RegExp(
        String.raw`\b(vitest|jest|pytest|mocha|go test|cargo test|playwright test|claude plugin test)\b|` +
          String.raw`${PACKAGE_SCRIPT}test(:\S+)?\b|${TURBO_TASK}test(:\S+)?\b`,
      ),
    },
  },
  lint: {
    label: 'lint',
    how: 'a lint/format check (eslint, prettier --check, ruff, biome, npm run lint…) exiting 0',
    matcher: {
      kind: 'bash',
      pattern: new RegExp(
        String.raw`\b(eslint|prettier\s+(--check|-c)|ruff|biome\s+(check|lint|ci)|stylelint|black\s+--check|flake8)\b|` +
          String.raw`${PACKAGE_SCRIPT}(lint|format:check)\b|${TURBO_TASK}(lint|format:check)\b`,
      ),
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

/** One step of a command line and the operator that ends it ('' for the last). */
type Step = { text: string; then: string }

/** `&&`, `||`, `;`, a newline, a pipe or a lone `&` (not the one in `2>&1` or `&>`). */
const SEPARATOR = /&&|\|\||\|&?|;|\n|(?<![<>&])&(?![&>])/g

const stepsOf = (code: string): Step[] => {
  const steps: Step[] = []
  let from = 0
  for (const match of code.matchAll(SEPARATOR)) {
    steps.push({ text: code.slice(from, match.index), then: match[0] })
    from = (match.index ?? 0) + match[0].length
  }
  steps.push({ text: code.slice(from), then: '' })
  return steps.filter((step, i) => step.text.trim() !== '' || i === steps.length - 1)
}

const short = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 40)

/**
 * Why an exit 0 of `code` does not prove the gate its step `index` ran, or undefined when it
 * does. The shell hands back the exit code of the last thing it ran: `npm test | tail` and
 * `npm test; echo done` "pass" whatever the tests did, and `npm test || true` always exits 0.
 * Steps joined by `&&` after the gate run only when it passed; `set -e` and `pipefail` make a
 * failure end the command.
 */
export const exitMask = (code: string, index: number, steps: readonly Step[] = stepsOf(code)): string | undefined => {
  const before = steps.slice(0, index).map(s => s.text).join(' ')
  const errexit = /\bset\s+-\w*e/.test(before) || /\bset\s+-o\s+errexit\b/.test(before)
  const pipefail = /pipefail/.test(code)
  let start = index
  while (start > 0 && !/^(;|\n|&)$/.test(steps[start - 1]!.then)) start -= 1
  const list = steps.slice(start)
  const or = list.slice(0, list.findIndex(s => /^(;|\n|&)$/.test(s.then)) + 1 || list.length).find(s => s.then === '||')
  if (or !== undefined) return `\`||\` after "${short(or.text)}" makes the command exit 0 whatever the gate did`
  const own = steps[index]!
  if (own.then === '&') return 'it ran in the background (`&`), so its exit code was never seen'
  if (own.then.startsWith('|') && !pipefail) return `its output is piped (\`| ${short(steps[index + 1]?.text ?? '')}\`), so the exit code is the pipe's last command's, not the gate's`
  if (errexit) return undefined
  for (const [i, step] of steps.slice(index).entries()) {
    if (step.then === ';' || step.then === '\n' || step.then === '&') {
      const next = steps[index + i + 1]?.text ?? ''
      return `it is followed by \`${step.then === '\n' ? '⏎' : step.then} ${short(next)}\`, so the exit code is that later command's; run the gate alone or join with \`&&\``
    }
  }
  return undefined
}

/** Whether an exit 0 of `command` proves nothing about every step `pattern` finds in it. */
export const masksExitCode = (command: string, pattern: RegExp): boolean => {
  const steps = stepsOf(command)
  return steps.every((step, i) => !pattern.test(step.text) || exitMask(command, i, steps) !== undefined)
}

/**
 * The words the shell runs, without the text it only carries: a heredoc body or a quoted
 * string that mentions `npm test` writes a file, it does not run the tests.
 */
export const executedText = (command: string): string =>
  command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, '<<heredoc')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')

/** A command that looks like a gate attempt even when no gate counted it, for the refusal to quote. */
const LOOKS_LIKE_GATE = /\b(test|tests|lint|vitest|jest|pytest|prettier|eslint|check|validate|format)\b/

/** What one finished Bash command proves, gate by gate, and why any gate it ran did not count. */
export const classifyBash = (
  command: string,
  failed: boolean,
  at: number,
): { records: GateRecord[]; attempt: GateAttempt | undefined } => {
  const code = executedText(command)
  const steps = stepsOf(code)
  const records: GateRecord[] = []
  const why: string[] = []
  for (const [gate, def] of Object.entries(GATES)) {
    if (def.matcher.kind !== 'bash') continue
    const pattern = def.matcher.pattern
    const indices = steps.flatMap((step, i) => (pattern.test(step.text) ? [i] : []))
    if (indices.length === 0) continue
    const evidence = (i: number): string => steps[i]!.text.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (failed) {
      records.push({ gate, result: 'failed', evidence: evidence(indices[0]!), at })
      continue
    }
    const proven = indices.find(i => exitMask(code, i, steps) === undefined)
    if (proven !== undefined) records.push({ gate, result: 'passed', evidence: evidence(proven), at })
    else why.push(`${gate} not counted: ${exitMask(code, indices.at(-1)!, steps)}`)
  }
  const looksLike = records.length === 0 && why.length === 0 && LOOKS_LIKE_GATE.test(code)
  const reason = why.length > 0 ? why.join('; ') : looksLike ? 'matches no gate command' : undefined
  return {
    records,
    attempt: reason === undefined ? undefined : { command: command.replace(/\s+/g, ' ').trim().slice(0, 160), why: reason, at },
  }
}

/** What one finished Bash command proves, gate by gate. */
export const observeBash = (command: string, failed: boolean, at: number): GateRecord[] =>
  classifyBash(command, failed, at).records

/** The attempts a refusal quotes: the newest last, at most this many. */
export const MAX_ATTEMPTS = 5

export const keepAttempt = (attempts: readonly GateAttempt[], attempt: GateAttempt): GateAttempt[] =>
  [...attempts, attempt].slice(-MAX_ATTEMPTS)

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

/** The session's latest commands that looked like a gate run and why none counted, newest last. */
const attemptsLine = (tried: readonly GateAttempt[] | undefined): string =>
  tried === undefined || tried.length === 0
    ? ' No command there looked like a gate run.'
    : ` Last commands seen there that did not count: ${tried.map(t => `\`${t.command}\` → ${t.why}`).join('; ')}.`

/** Why a phase cannot close yet, in the words the model reads; undefined when it can. */
export const phaseRefusal = (
  phase: Pick<Phase, 'id' | 'title'>,
  open: readonly GateView[],
  where: string,
  tried?: readonly GateAttempt[],
): string | undefined =>
  open.length === 0
    ? undefined
    : `phase ${phase.id} (${phase.title}) cannot close: ` +
      open.map(v => `${v.gate} ${STATE_WORD[v.state]} — needs ${GATES[v.gate]?.how ?? v.gate}`).join('; ') +
      ` (checked in ${where}).` +
      (open.some(v => v.state === 'pending') ? attemptsLine(tried) : '') +
      ` Run the gate in that session as a command of its own (no \`| tail\`, no \`; echo $?\` after it), or ask the owner: ` +
      `only they can skip a gate, from the panel — publish an ownerQuestion with \`gate: {phase: "${phase.id}", gate}\` ` +
      'so the panel offers the skip itself.'

/** What the ceiling reads of a session: the app's row, plus its activity file when there is one. */
type CeilingRow = {
  sessionId: string
  startedBy: string | undefined
  isArchived: boolean
  cwd?: string
  isRunning?: boolean
  prState?: string | undefined
  waiting?: Waiting | undefined
  plan?: readonly PlanItem[]
}

/**
 * Why a phase session still weighs on the owner's machine, or undefined when it does not. It
 * counts only with live work: running now, waiting on the owner, or with open tasks in its list.
 * With its phase or flow finished, or its PR merged or closed, it is done whatever it shows.
 */
export const aliveReason = (row: CeilingRow, finished: ReadonlySet<string> = new Set()): string | undefined => {
  if (finished.has(row.sessionId)) return undefined
  const pr = row.prState?.toUpperCase()
  if (pr === 'MERGED' || pr === 'CLOSED') return undefined
  if (row.isRunning === true) return 'running now'
  if (row.waiting !== undefined) return `waiting on the owner (${row.waiting.kind})`
  const open = (row.plan ?? []).filter(item => item.status !== 'completed').length
  return open > 0 ? `${open} open task${open === 1 ? '' : 's'} in its list` : undefined
}

/**
 * Phase sessions still alive, each with why it counts: started by this session, not archived,
 * and with live work (see `aliveReason`). A session in the coordinator's own folder is a side
 * chat or fork the owner opened, not a phase: phases always run in a worktree of their own.
 */
export const liveSessions = <T extends CeilingRow>(
  rows: readonly T[],
  selfId: string | undefined,
  selfCwd?: string,
  finished?: ReadonlySet<string>,
): { session: T; why: string }[] =>
  selfId === undefined
    ? []
    : rows.flatMap(row => {
        if (row.startedBy !== selfId || row.isArchived || (selfCwd !== undefined && row.cwd === selfCwd)) return []
        const why = aliveReason(row, finished)
        return why === undefined ? [] : [{ session: row, why }]
      })

export const GH_MERGE = /\bgh\s+pr\s+merge\b/
/** A merge that skips the branch protection (approval and CI): never the change's way in. */
export const MERGE_ADMIN = /\bgh\s+pr\s+merge\b[^;&|\n]*\s--admin\b/
export const ARCHIVE_COMMAND = /\bopenspec(\.js)?\s+archive\b/
export const PROTECTED_DIR = '/.claude/orquestrador/'

/**
 * Whether a change's final gates still hold back a merge: while its flow runs, up to the step
 * before the archive. The change's PR merges between `pr` and `producao` (QA tests the PR, the
 * deploy ships the merge); from the archive on, the only PR left moves the change folder. A
 * finished or aborted flow gates nothing.
 */
export const mergeWindow = (state: Pick<FlowState, 'status' | 'current' | 'flow'>): boolean => {
  if (state.status === 'done' || state.status === 'aborted') return false
  const steps = state.flow.steps
  const archive = steps.findIndex(s => s.cleanup || (s.command !== undefined && ARCHIVE_COMMAND.test(s.command)))
  const at = steps.findIndex(s => s.id === state.current)
  return archive === -1 || at === -1 || at < archive
}

/** `gh pr merge` flags that take a value, so the value is not read as the PR. */
const MERGE_VALUE_FLAGS = new Set(['-b', '--body', '-F', '--body-file', '-t', '--subject', '-A', '--author-email', '--match-head-commit', '-R', '--repo'])

/** The PR a `gh pr merge` names (a number, URL or branch); undefined for the current branch's. */
export const mergeSelector = (command: string): string | undefined => {
  const args = executedText(command).match(/\bgh\s+pr\s+merge\b([^;&|\n]*)/)?.[1] ?? ''
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (!word.startsWith('-')) return word
    if (MERGE_VALUE_FLAGS.has(word)) i += 1
  }
  return undefined
}

export type MergeTarget = { number: number | undefined; branch: string | undefined }

export const mergeTarget = (selector: string | undefined): MergeTarget => {
  const number = selector?.match(/^#?(\d+)$/)?.[1] ?? selector?.match(/\/pull\/(\d+)/)?.[1]
  return number === undefined ? { number: undefined, branch: selector } : { number: Number(number), branch: undefined }
}

/** PR numbers a note cites: `#801` or `…/pull/801`. */
export const citedPrs = (text: string | undefined): number[] =>
  [...(text ?? '').matchAll(/(?:#|\/pull\/)(\d+)\b/g)].map(m => Number(m[1]))

/** A head branch is the change's when a phase session works on it or its name carries the change id. */
export const isChangeBranch = (branch: string, change: string, branches: ReadonlySet<string>): boolean =>
  branches.has(branch) || branch.toLowerCase().includes(change.toLowerCase())
