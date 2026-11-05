import { describe, expect, test } from 'claude-code/testing'

import type { AgentRun } from '../types'
import { agentCard, agentRole, isLive, keepRuns, latestFor, livePhaseAgents, MAX_AGENT_RUNS, recordAgentCall, reviewedPhase } from '../hooks/agents'
import { observeBash, observeTool } from '../hooks/gates'

const run = (key: string, at: number, extra: Partial<AgentRun> = {}): AgentRun => ({
  kind: 'phase', key, name: `fase-${key}`, description: '', type: 'orchestrator:executor', at, gates: {}, ...extra,
})

describe('which phase or step a subagent runs', () => {
  test('fase-<id> is a phase, passo-<step> a step; any other name is neither', () => {
    expect(agentRole('fase-4.6')).toEqual({ kind: 'phase', key: '4.6' })
    expect(agentRole('phase-2')).toEqual({ kind: 'phase', key: '2' })
    expect(agentRole('passo-revisao-codigo')).toEqual({ kind: 'step', key: 'revisao-codigo' })
    expect(agentRole('revisao-fase-3')).toBeUndefined()
    expect(agentRole('explorer')).toBeUndefined()
    expect(agentRole(undefined)).toBeUndefined()
  })

  test('a reviewer names its phase by its name, else by "fase N" in its description', () => {
    expect(reviewedPhase('revisao-fase-3', undefined)).toBe('3')
    expect(reviewedPhase('review-phase-1.2', undefined)).toBe('1.2')
    expect(reviewedPhase(undefined, 'regras da fase 5')).toBe('5')
    expect(reviewedPhase('adr', 'revisão geral')).toBeUndefined()
  })

  test('the newest run of a phase is the one that counts', () => {
    const agents = { a: run('1', 10, { change: 'demo' }), b: run('1', 30, { change: 'demo' }), c: run('2', 40), d: run('1', 20, { change: 'outra' }) }
    expect(latestFor(agents, 'demo', '1')).toBe('b')
    expect(latestFor(agents, 'outra', '1')).toBe('d')
    expect(latestFor(agents, undefined, '3')).toBeUndefined()
  })
})

describe("a subagent's record", () => {
  test('a pass is kept, a later edit unproves it, and an attempt that did not count is quoted', () => {
    const passed = recordAgentCall(run('1', 1), observeBash('node --test', false, 5), undefined, undefined)
    expect(passed.gates.testes?.result).toBe('passed')
    const edited = recordAgentCall(passed, [], { command: 'npm test | tail', why: 'piped', at: 7 }, 9)
    expect(edited.editedAt).toBe(9)
    expect(edited.tried).toEqual([{ command: 'npm test | tail', why: 'piped', at: 7 }])
    const card = agentCard('ag-1', edited, 'running', '/w')
    expect(card).toMatchObject({ sessionId: 'ag-1', name: 'fase-1', agent: true, isRunning: true, isArchived: false })
    expect(card.gates.editedAt).toBe(9)
  })

  test('live is pending, running or waiting; the ceiling counts phase runs only', () => {
    expect(['pending', 'running', 'waiting'].every(isLive)).toBe(true)
    expect(['completed', 'failed', 'killed', 'idle', undefined].some(isLive)).toBe(false)
    const agents = { a: run('1', 1), b: run('2', 2), c: { ...run('x', 3), kind: 'step' as const, name: 'passo-pr' } }
    const statuses = new Map([['a', 'running'], ['b', 'completed'], ['c', 'running']])
    expect(livePhaseAgents(agents, statuses)).toEqual(['fase-1'])
  })

  test('only the newest runs are kept', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_AGENT_RUNS + 5 }, (_, i) => [`ag-${i}`, run(String(i), i)]))
    const kept = keepRuns(many)
    expect(Object.keys(kept)).toHaveLength(MAX_AGENT_RUNS)
    expect(kept['ag-0']).toBeUndefined()
    expect(kept[`ag-${MAX_AGENT_RUNS + 4}`]).toBeDefined()
  })
})

describe('the testes gate knows the test runners projects use', () => {
  const testes = (command: string) => observeBash(command, false, 1).find(r => r.gate === 'testes')?.result
  test('Node, Bun, Deno, package scripts and build tools count', () => {
    const counted = [
      'node --test',
      'node --test tests/probe.test.mjs',
      'node --experimental-strip-types --test src',
      'tsx --test',
      'bun test',
      'deno test -A',
      'pnpm test',
      'pnpm --filter device-driver test',
      'make test',
      './gradlew test',
      'mvn -q test',
      'dotnet test',
      'go test ./...',
      'rspec',
    ]
    expect(counted.filter(command => testes(command) !== 'passed')).toEqual([])
  })

  test('a command that only mentions a test does not count', () => {
    const ignored = ['node scripts/build.js', 'git commit -m "node --test"', 'echo test', 'brew tap foo', 'mvn -DskipTests package']
    expect(ignored.filter(command => testes(command) !== undefined)).toEqual([])
  })
})

describe('the regras gate', () => {
  test("the plugin's own reviewers count too, and a rejection fails it", () => {
    const verdict = (type: string, text: string) => observeTool('Agent', { subagent_type: type }, false, text, 1)[0]?.result
    expect(verdict('orchestrator:code-reviewer', 'Veredito: aprovado')).toBe('passed')
    expect(verdict('orchestrator:plan-reviewer', 'approved')).toBe('passed')
    expect(verdict('aidakit:reviewer-security', 'Veredito: rejeitado... rejected')).toBe('failed')
    expect(verdict('general-purpose', 'approved')).toBeUndefined()
  })
})
