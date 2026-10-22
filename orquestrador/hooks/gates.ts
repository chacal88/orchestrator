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

/**
 * A command that may merge a PR through `gh`, in any form: the cheap test that sends it to the
 * merge guard, which reads it word by word (`mergeCalls`). Raw text on purpose: a quoted, wrapped
 * or continued merge still goes to the guard, and the guard holds when the mod fails.
 */
export const GH_MERGE = /\bgh\b[\s\S]*merge/i
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

/** `gh` flags before the command that take a value. */
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname'])

/** One word as the shell hands it to the program, and whether a `$` or `` ` `` makes it unknowable here. */
type Word = { text: string; dynamic: boolean }

/** The commands a command line runs, each as its words, and the scripts of its `$(…)` and `` `…` ``. */
const splitWords = (code: string): { commands: Word[][]; nested: string[] } => {
  const commands: Word[][] = []
  const nested: string[] = []
  let words: Word[] = []
  let word: Word | undefined
  const add = (text: string, dynamic = false): void => {
    word ??= { text: '', dynamic: false }
    word.text += text
    word.dynamic ||= dynamic
  }
  const endWord = (): void => {
    if (word !== undefined) words.push(word)
    word = undefined
  }
  const endCommand = (): void => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  /** The text up to the `)` that closes the `$(` before `from`, and where it ends. */
  const substitution = (from: number): [string, number] => {
    let depth = 1
    let i = from
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === '(') depth += 1
      else if (code[i] === ')') depth -= 1
    }
    return [code.slice(from, i - 1), i]
  }
  let i = 0
  while (i < code.length) {
    const c = code[i]!
    if (c === '\\') {
      if (code[i + 1] !== '\n') add(code[i + 1] ?? '')
      i += 2
    } else if (c === "'") {
      const end = code.indexOf("'", i + 1)
      add(code.slice(i + 1, end === -1 ? code.length : end))
      i = end === -1 ? code.length : end + 1
    } else if (c === '"') {
      add('')
      i += 1
      while (i < code.length && code[i] !== '"') {
        const d = code[i]!
        if (d === '\\' && i + 1 < code.length) {
          if (code[i + 1] !== '\n') add('"\\$`'.includes(code[i + 1]!) ? code[i + 1]! : `\\${code[i + 1]}`)
          i += 2
        } else if (d === '$' && code[i + 1] === '(') {
          const [inner, end] = substitution(i + 2)
          nested.push(inner)
          add(code.slice(i, end), true)
          i = end
        } else if (d === '`') {
          const end = code.indexOf('`', i + 1)
          nested.push(code.slice(i + 1, end === -1 ? code.length : end))
          add(code.slice(i, end === -1 ? code.length : end + 1), true)
          i = end === -1 ? code.length : end + 1
        } else {
          add(d, d === '$')
          i += 1
        }
      }
      i += 1
    } else if (c === '$' && code[i + 1] === '(') {
      const [inner, end] = substitution(i + 2)
      nested.push(inner)
      add(code.slice(i, end), true)
      i = end
    } else if (c === '`') {
      const end = code.indexOf('`', i + 1)
      nested.push(code.slice(i + 1, end === -1 ? code.length : end))
      add(code.slice(i, end === -1 ? code.length : end + 1), true)
      i = end === -1 ? code.length : end + 1
    } else if (c === '#' && word === undefined) {
      const end = code.indexOf('\n', i)
      i = end === -1 ? code.length : end
    } else if (c === ' ' || c === '\t') {
      endWord()
      i += 1
    } else if (c === '&' && (/[<>]$/.test(word?.text ?? '') || code[i + 1] === '>')) {
      add(c) // `2>&1`, `&>`: a redirection, not a separator
      i += 1
    } else if (';&|\n()'.includes(c)) {
      endCommand()
      i += 1
    } else {
      add(c, c === '$')
      i += 1
    }
  }
  endCommand()
  return { commands, nested }
}

/** Words that run the command after them: `env`, `time`, `command`, a `VAR=value` before it… */
const PREFIX_WORDS = new Set(['{', '!', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', 'time', 'command', 'exec', 'nohup', 'env', 'sudo'])
const SHELLS = /(^|\/)(ba|z|da|k)?sh$/
/** Interpreters that run a script they are handed: like a shell, the mod cannot read what it does. */
const INTERPRETERS = /^(python[0-9.]*|node|deno|bun|ruby|perl|php|osascript)$/

/**
 * Every command a command line runs, as its words: across line continuations and quotes, and
 * into the scripts `bash -c`/`sh -c`/`eval` run and the `$(…)` it substitutes. A heredoc body is
 * text, not commands.
 */
export const commandsRun = (command: string, depth = 0): Word[][] => {
  if (depth > 4) return []
  // the body goes, the rest of the opening line stays: `cat <<'EOF' | bash` still pipes into a shell
  const code = command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\b/g, '<<heredoc$3')
  const { commands, nested } = splitWords(code)
  const out: Word[][] = []
  for (const words of commands) {
    let at = 0
    while (at < words.length && (PREFIX_WORDS.has(words[at]!.text) || /^[A-Za-z_]\w*=/.test(words[at]!.text))) at += 1
    const run = words.slice(at)
    const head = run[0]?.text ?? ''
    if (head === 'eval') {
      out.push(...commandsRun(run.slice(1).map(w => w.text).join(' '), depth + 1))
      continue
    }
    if (SHELLS.test(head)) {
      const flag = run.findIndex((w, i) => i > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w.text))
      const script = flag === -1 ? undefined : run[flag + 1]
      if (script !== undefined) {
        out.push(...commandsRun(script.text, depth + 1))
        continue
      }
    }
    if (run.length > 0) out.push(run)
  }
  for (const inner of nested) out.push(...commandsRun(inner, depth + 1))
  return out
}

/**
 * A PR merge one command runs: `gh pr merge`, `gh api …/pulls/<n>/merge` or `gh api graphql` with
 * `mergePullRequest`. `selector` is the PR it names (number, URL or branch; for the API, `<n>`);
 * a GraphQL merge names its PR by node id, which the mod cannot read. `dynamic` is set when an
 * argument carries a `$` the mod cannot see through.
 */
export type MergeCall = {
  via: 'pr' | 'api' | 'graphql'
  selector: string | undefined
  admin: boolean
  dynamic: boolean
  text: string
}

const mergeCall = (words: readonly Word[]): MergeCall | undefined => {
  if (!/(^|\/)gh$/.test(words[0]?.text ?? '')) return undefined
  let at = 1
  while (at < words.length && words[at]!.text.startsWith('-')) at += GH_VALUE_FLAGS.has(words[at]!.text) ? 2 : 1
  const sub = words[at]?.text
  const args = words.slice(at + 1)
  const text = words.map(w => w.text).join(' ').replace(/\s+/g, ' ').slice(0, 80)
  const dynamic = args.some(w => w.dynamic)
  if (sub === 'pr') {
    let verb = 0
    while (verb < args.length && args[verb]!.text.startsWith('-')) verb += GH_VALUE_FLAGS.has(args[verb]!.text) ? 2 : 1
    if (args[verb]?.text !== 'merge') return undefined
    const rest = args.slice(verb + 1)
    let selector: string | undefined
    for (let i = 0; i < rest.length && selector === undefined; i++) {
      const word = rest[i]!.text
      if (!word.startsWith('-')) selector = word
      else if (MERGE_VALUE_FLAGS.has(word)) i += 1
    }
    const admin = rest.some(w => w.text === '--admin' || w.text.startsWith('--admin='))
    return { via: 'pr', selector, admin, dynamic, text }
  }
  if (sub !== 'api') return undefined
  const pull = args.map(w => w.text.match(/(?:^|\/)pulls\/([^/\s]+)\/merge\b/)?.[1]).find(n => n !== undefined)
  if (pull !== undefined) return { via: 'api', selector: pull, admin: false, dynamic, text }
  if (args.some(w => w.text === 'graphql') && args.some(w => /mergePullRequest/.test(w.text))) {
    return { via: 'graphql', selector: undefined, admin: false, dynamic, text }
  }
  return undefined
}

/** The PR merges a command runs, in any of the forms `commandsRun` reaches. */
export const mergeCalls = (command: string): MergeCall[] =>
  commandsRun(command).flatMap(words => mergeCall(words) ?? [])

/** Programs that only print, read or move around what they are given: a merge in their arguments does not run. */
const INERT = new Set([
  'echo', 'printf', 'cat', 'grep', 'egrep', 'rg', 'head', 'tail', 'less', 'jq', 'wc', 'sort', 'uniq', 'diff',
  'cd', 'ls', 'pwd', 'true', 'false', 'test', '[', 'mkdir', 'touch', 'cp', 'mv', 'tee',
])

/** A `git` that runs a command of its own: an alias with `!`, `rebase --exec`/`-x`, `filter-branch`, `bisect run`. */
const gitRuns = (words: readonly Word[]): boolean => {
  const texts = words.map(w => w.text)
  return (
    texts.some(t => /^alias\.[^=]*=\s*!/.test(t)) ||
    texts.includes('filter-branch') ||
    (texts.includes('rebase') && texts.some(t => t === '-x' || t === '--exec' || t.startsWith('--exec='))) ||
    (texts.includes('bisect') && texts.includes('run'))
  )
}

const namesMerge = (text: string): boolean => /\bgh\b/.test(text) && /merge/i.test(text)

/**
 * A command line that names `gh` and a merge the mod cannot read as one: the `gh` runs behind
 * another program (`xargs`, `find -exec`, `timeout`, `nice`, `sudo -u`, `env -u`…), from a script
 * a shell reads on stdin (a heredoc or a pipe into `bash`), through a `git` that runs commands, or
 * under a name a variable holds (`$G pr merge`). Its text when it is that, so the guard fails
 * closed; undefined when every command is a `gh` the mod reads or a program that only prints.
 *
 * Each command is judged on what it does itself: a program counts when it names the merge itself,
 * a shell or interpreter when it reads its script from stdin (or from a file, with no readable merge
 * on the line). So a readable merge cannot cover a hidden one beside it
 * (`gh pr merge 6 --squash && xargs gh pr merge --admin`), while `gh pr merge 6 && npm test` and a
 * loop that only reads PRs (`for n in …; do gh pr view $n --json mergeable; done`) pass.
 */
export const opaqueMerge = (command: string): string | undefined => {
  if (!namesMerge(command)) return undefined
  const read = mergeCalls(command).length > 0
  const hidden = commandsRun(command).find(words => {
    const head = words[0]
    if (head === undefined || mergeCall(words) !== undefined) return false
    const name = head.text.split('/').pop() ?? ''
    if (name === 'gh' && !head.dynamic) return false
    if (head.dynamic) return true
    if (name === 'git') return gitRuns(words)
    if (INERT.has(name)) return false
    // a shell or an interpreter runs a script the mod does not read: from stdin always, from a file when the
    // line holds no readable merge (a readable one beside `bash check.sh` is not covering anything)
    if (SHELLS.test(name) || INTERPRETERS.test(name)) {
      const fromStdin = words.slice(1).every(w => w.text.startsWith('-') || w.text.startsWith('<'))
      if (fromStdin || !read) return true
    }
    // any other program counts only when it names the merge itself (`xargs gh pr merge`, `timeout 5 gh pr merge`)
    return namesMerge(words.map(w => w.text).join(' '))
  })
  return hidden?.map(w => w.text).join(' ').replace(/\s+/g, ' ').slice(0, 80)
}

/** The PR a `gh pr merge` names (a number, URL or branch); undefined for the current branch's. */
export const mergeSelector = (command: string): string | undefined => mergeCalls(command)[0]?.selector

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

/** A step's agent names a file: lowercase words joined by hyphens, never a path. */
export const AGENT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const isAgentName = (name: string): boolean => AGENT_NAME.test(name)
