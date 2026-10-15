import { describe, expect, test } from 'claude-code/testing'

import {
  familyCheck,
  gateState,
  gateViews,
  liveSessions,
  mergeRecords,
  observeBash,
  observeTool,
  parseGates,
  phaseRefusal,
} from '../hooks/gates'
import { parseRun } from '../hooks/model'

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
  })
})

test('live phase sessions are the ones this session started and did not archive', () => {
  const rows = [
    { startedBy: 'me', isArchived: false },
    { startedBy: 'me', isArchived: true },
    { startedBy: 'other', isArchived: false },
  ]
  expect(liveSessions(rows, 'me')).toHaveLength(1)
  expect(liveSessions(rows, undefined)).toHaveLength(0)
})
