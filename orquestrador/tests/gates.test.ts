import { describe, expect, test } from 'claude-code/testing'

import {
  aliveReason,
  citedPrs,
  classifyBash,
  isChangeBranch,
  mergeSelector,
  mergeTarget,
  mergeWindow,
  familyCheck,
  gateState,
  gateViews,
  keepAttempt,
  liveSessions,
  masksExitCode,
  mergeRecords,
  observeBash,
  observeTool,
  parseGates,
  phaseRefusal,
} from '../hooks/gates'
import { parseRun } from '../hooks/model'
import type { GateAttempt } from '../types'

describe('observeBash', () => {
  test('a test command exiting 0 passes testes; exiting non-zero fails it', () => {
    expect(observeBash('cd projects/api && npx vitest run', false, 5)).toEqual([
      { gate: 'testes', result: 'passed', evidence: 'npx vitest run', at: 5 },
    ])
    expect(observeBash('npm run test:unit', true, 5)[0]?.result).toBe('failed')
  })

  test('check.sh, openspec validate and lint are told apart', () => {
    expect(observeBash('sh scripts/check.sh', false, 1).map(r => r.gate)).toEqual(['check'])
    expect(observeBash('node_modules/.bin/openspec validate demo --strict', false, 1).map(r => r.gate)).toEqual(['openspec'])
    expect(observeBash('npx prettier --check src && npx eslint .', false, 1).map(r => r.gate)).toEqual(['lint'])
    expect(observeBash('git status', false, 1)).toEqual([])
  })

  test('a pipe hides the exit code: it proves a failure, never a pass', () => {
    expect(observeBash('npm test | tail -5', false, 1)).toEqual([])
    expect(observeBash('npm test | tail -5', true, 1)[0]?.result).toBe('failed')
    expect(observeBash('set -o pipefail; npm test | tail -5', false, 1)[0]?.result).toBe('passed')
    expect(observeBash('npm test || true', false, 1)).toEqual([])
  })

  test('text a command only carries proves nothing: a heredoc or a quoted string is not run', () => {
    const heredoc = "cat > notes.md <<'EOF'\nRode `claude plugin test` e `npm test`.\nEOF"
    expect(observeBash(heredoc, false, 1)).toEqual([])
    expect(observeBash('echo "npm test passou" > log.txt', false, 1)).toEqual([])
    expect(observeBash("git commit -m 'run vitest'", false, 1)).toEqual([])
    expect(observeBash('$S/bin/claude plugin test ~/mods/orquestrador', false, 1)[0]?.evidence).toBe(
      '$S/bin/claude plugin test ~/mods/orquestrador',
    )
  })
})

describe('monorepo forms and the exit code the shell hands back', () => {
  const gates = (command: string) => observeBash(command, false, 1).map(r => `${r.gate}:${r.result}`)

  test('flags between the package manager and the script, and turbo tasks, count', () => {
    for (const command of [
      'pnpm --filter @psim-kernel/device-bench test',
      'pnpm -F api test',
      'pnpm -r test',
      'pnpm --filter a --filter b run test:unit',
      'yarn workspace api test',
      'pnpm turbo test --filter=@psim-kernel/device-ui',
      'npx turbo run build test',
    ]) {
      expect(gates(command)).toEqual(['testes:passed'])
    }
    for (const command of [
      'pnpm turbo lint --filter=@psim-kernel/device-bench --filter=@psim-kernel/device-ui',
      'pnpm --filter api lint',
      'pnpm -F api format:check',
      'turbo run lint',
    ]) {
      expect(gates(command)).toEqual(['lint:passed'])
    }
  })

  test('a script that is no gate stays none, flags or not', () => {
    expect(gates('pnpm --filter api build')).toEqual([])
    expect(gates('pnpm turbo build --filter=api')).toEqual([])
    expect(gates('pnpm -r --silent run dev')).toEqual([])
    expect(gates('echo "pnpm -r test" > notes.txt')).toEqual([])
  })

  test('a later `; cmd` decides the exit code, so `npm test; echo $?` proves nothing', () => {
    const command = 'pnpm --filter ui exec vitest run >/tmp/h1.log 2>&1; echo ui=$?'
    expect(gates(command)).toEqual([])
    expect(classifyBash(command, false, 1).attempt?.why).toMatch(/testes not counted: it is followed by `; echo ui=\$\?`/)
    // the gate run last, or joined by && to what follows, still proves it
    expect(gates('source ~/.nvm/nvm.sh && nvm use 22 >/dev/null; pnpm -r test')).toEqual(['testes:passed'])
    expect(gates('npm test && echo ok')).toEqual(['testes:passed'])
    expect(gates('npm test >log 2>&1 && tail -3 log')).toEqual(['testes:passed'])
    expect(gates('set -e; npm test; echo done')).toEqual(['testes:passed'])
    expect(gates('npm test &')).toEqual([])
    // a failure is still a failure, whatever follows it
    expect(observeBash('npm test; echo done', true, 1)[0]?.result).toBe('failed')
  })

  test('the round that went unseen: each reason is kept for the refusal', () => {
    const round =
      'pnpm --filter @psim-kernel/device-ui exec vitest run >/s/h1.log 2>&1; echo ui=$?; ' +
      'pnpm exec prettier --check packages/device-ui/src >/s/h3.log 2>&1; echo prettier=$?; grep -h Tests /s/h1.log | head'
    const seen = classifyBash(round, false, 7)
    expect(seen.records).toEqual([])
    expect(seen.attempt?.why).toMatch(/testes not counted: .*; lint not counted: /)
    expect(classifyBash('pnpm turbo build', false, 1).attempt).toBeUndefined()
    expect(classifyBash('pnpm check:types', false, 1).attempt?.why).toBe('matches no gate command')
    expect(classifyBash('git status', false, 1).attempt).toBeUndefined()
    const many = [1, 2, 3, 4, 5, 6].reduce((list, at) => keepAttempt(list, { command: `c${at}`, why: 'w', at }), [] as GateAttempt[])
    expect(many.map(a => a.at)).toEqual([2, 3, 4, 5, 6])
  })

  test('the flow steps read the same rule', () => {
    const pattern = /openspec\s+validate/
    expect(masksExitCode('openspec validate x; echo $?', pattern)).toBe(true)
    expect(masksExitCode('cd a; openspec validate x', pattern)).toBe(false)
    expect(masksExitCode('openspec validate x | tail', pattern)).toBe(true)
  })
})

describe('observeTool', () => {
  test('a screenshot in the browser pane passes visual; a click does not', () => {
    expect(observeTool('mcp__Claude_Browser__computer', { action: 'screenshot' }, false, '', 1)[0]?.result).toBe('passed')
    expect(observeTool('mcp__Claude_Browser__computer', { action: 'left_click' }, false, '', 1)).toEqual([])
    expect(
      observeTool('mcp__Claude_Browser__browser_batch', { actions: [{ name: 'computer', input: { action: 'screenshot' } }] }, false, '', 1)[0]
        ?.gate,
    ).toBe('visual')
  })

  test('a rules reviewer passes regras only when it approves', () => {
    const agent = { subagent_type: 'aidakit:adr-reviewer' }
    expect(observeTool('Agent', agent, false, 'verdict: approved, no violations', 1)[0]?.result).toBe('passed')
    expect(observeTool('Agent', agent, false, 'verdict: rejected — ADR-019 violated', 1)[0]?.result).toBe('failed')
    expect(observeTool('Agent', { subagent_type: 'Explore' }, false, 'approved', 1)).toEqual([])
  })
})

describe('gateState', () => {
  const passed = { gate: 'testes', result: 'passed' as const, evidence: 'npm test', at: 10 }

  test('a pass holds until code is edited after it', () => {
    expect(gateState(passed, undefined, undefined)).toBe('passed')
    expect(gateState(passed, 10, undefined)).toBe('passed')
    expect(gateState(passed, 11, undefined)).toBe('stale')
  })

  test('only a fresh pass outranks the owner skip; nothing run is pending', () => {
    expect(gateState(undefined, undefined, undefined)).toBe('pending')
    expect(gateState(undefined, undefined, { at: 1 })).toBe('skipped')
    expect(gateState({ ...passed, result: 'failed' }, undefined, { at: 1 })).toBe('skipped')
    expect(gateState({ ...passed, result: 'failed' }, undefined, undefined)).toBe('failed')
  })

  test('the latest run wins, across a session and across the family', () => {
    const failed = { ...passed, result: 'failed' as const, at: 20 }
    expect(mergeRecords({ testes: passed }, [failed]).testes?.result).toBe('failed')
    expect(mergeRecords({ testes: failed }, [passed]).testes?.result).toBe('failed')
    const family = familyCheck([
      { records: { testes: passed }, editedAt: 5 },
      { records: { testes: failed }, editedAt: 30 },
    ])
    expect(family).toEqual({ records: { testes: failed }, editedAt: 30 })
  })
})

describe('plan gates', () => {
  test('a plan naming an unknown gate is refused, listing the known ones', () => {
    const run = parseRun({ change: 'c', waves: [{ phases: [{ id: '1', title: 'A', status: 'running', gates: ['testes', 'deploy'] }] }] }, '/w', 1)
    expect('error' in run && run.error).toMatch(/unknown gate deploy; known gates are testes, lint/)
    expect(parseGates(['testes', 'testes', ' lint '], 'p')).toEqual(['testes', 'lint'])
    expect(parseGates([], 'p')).toBeUndefined()
  })

  test('a refusal names each open gate, what proves it, and that only the owner skips', () => {
    const views = gateViews(['testes', 'check'], '1', { records: {}, editedAt: undefined }, { '1:check': { at: 1 } })
    expect(views.map(v => v.state)).toEqual(['pending', 'skipped'])
    const text = phaseRefusal({ id: '1', title: 'API' }, views.filter(v => v.state !== 'skipped'), 'session "api"')
    expect(text).toMatch(/phase 1 \(API\) cannot close: testes not run — needs a test command/)
    expect(text).toMatch(/only they can skip a gate/)
    expect(text).toMatch(/No command there looked like a gate run/)
    const tried = [{ command: 'pnpm turbo test; echo $?', why: 'testes not counted: it is followed by `; echo $?`', at: 3 }]
    expect(phaseRefusal({ id: '1', title: 'API' }, views.filter(v => v.state !== 'skipped'), 'session "api"', tried)).toMatch(
      /Last commands seen there that did not count: `pnpm turbo test; echo \$\?` → testes not counted/,
    )
    expect(text).toMatch(/ownerQuestion with `gate: \{phase: "1", gate\}`/)
  })
})

test('live phase sessions are the ones this session started and did not archive', () => {
  const rows = [
    { sessionId: 'a', startedBy: 'me', isArchived: false, isRunning: true },
    { sessionId: 'b', startedBy: 'me', isArchived: true, isRunning: true },
    { sessionId: 'c', startedBy: 'other', isArchived: false, isRunning: true },
  ]
  expect(liveSessions(rows, 'me')).toHaveLength(1)
  expect(liveSessions(rows, undefined)).toHaveLength(0)
  const withChat = [
    { sessionId: 'a', startedBy: 'me', isArchived: false, isRunning: true, cwd: '/w/.claude/worktrees/api' },
    { sessionId: 'b', startedBy: 'me', isArchived: false, isRunning: true, cwd: '/w' },
  ]
  // a side chat in the coordinator's own folder is not a phase session
  expect(liveSessions(withChat, 'me', '/w')).toHaveLength(1)
})

test('a session counts against the ceiling only with live work, and says why', () => {
  const base = { sessionId: 's', startedBy: 'me', isArchived: false }
  expect(aliveReason({ ...base, isRunning: true })).toBe('running now')
  expect(aliveReason({ ...base, waiting: { kind: 'question', text: 'x', since: 1 } })).toBe('waiting on the owner (question)')
  expect(aliveReason({ ...base, plan: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] })).toBe(
    '1 open task in its list',
  )
  expect(aliveReason({ ...base, plan: [{ content: 'a', status: 'completed' }] })).toBeUndefined()
  expect(aliveReason({ ...base, isRunning: true, prState: 'MERGED' })).toBeUndefined()
  expect(aliveReason({ ...base, isRunning: true, prState: 'closed' })).toBeUndefined()
  expect(aliveReason({ ...base, isRunning: true }, new Set(['s']))).toBeUndefined()
})

test('the merge window closes at the archive step and when the flow ends', () => {
  const flow = { steps: [{ id: 'pr' }, { id: 'qa' }, { id: 'arquivar', command: 'openspec archive', cleanup: true }] } as never
  expect(mergeWindow({ status: 'running', current: 'pr', flow })).toBe(true)
  expect(mergeWindow({ status: 'escalated', current: 'qa', flow })).toBe(true)
  expect(mergeWindow({ status: 'running', current: 'arquivar', flow })).toBe(false)
  expect(mergeWindow({ status: 'done', current: 'pr', flow })).toBe(false)
  expect(mergeWindow({ status: 'aborted', current: 'pr', flow })).toBe(false)
})

test('the PR a gh pr merge names: number, URL, branch or the current branch', () => {
  expect(mergeTarget(mergeSelector('gh pr merge 805 --squash'))).toEqual({ number: 805, branch: undefined })
  expect(mergeTarget(mergeSelector('gh pr merge --squash --subject "fix: x" https://github.com/o/r/pull/12'))).toEqual({
    number: 12,
    branch: undefined,
  })
  expect(mergeTarget(mergeSelector('gh pr merge -R o/r feat/demo -d'))).toEqual({ number: undefined, branch: 'feat/demo' })
  expect(mergeSelector('gh pr merge --squash --delete-branch && git pull')).toBeUndefined()
  expect(citedPrs('PR aberto: #801 (https://github.com/o/r/pull/802)')).toEqual([801, 802])
  expect(isChangeBranch('claude/Demo-x1', 'demo', new Set())).toBe(true)
  expect(isChangeBranch('docs/feed', 'demo', new Set(['docs/feed']))).toBe(true)
  expect(isChangeBranch('docs/feed', 'demo', new Set())).toBe(false)
})
