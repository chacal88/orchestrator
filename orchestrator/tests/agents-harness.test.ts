import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState, OrchestrationRun } from '../types'

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }

const BASE = '/h/.claude/orquestrador'
const STATE = `${BASE}/flows/demo.json`
const TASKS = '/w/openspec/changes/demo/tasks.md'
const ME = { sessionId: 'me', cwd: '/w', title: 'Coordenação' }

type Spawned = { name?: string; subagentType: string; background: boolean }
type World = {
  disk: Map<string, string>
  calls: Record<string, unknown>[]
  /** What reached the engine's own spawn, after the mod's hook. */
  spawns: Spawned[]
  /** What `$.agent.list()` answers: each subagent and its status. */
  agents: { id: string; description: string; type: string; status: string; name?: string }[]
  /** What a reviewer Agent call answers. */
  verdict: string
}

/** A coordinator at /w whose clone is on "barrar", with an engine that starts subagents `ag-1`, `ag-2`… */
const world = (on: On): World => {
  mock.store(on)
  const w: World = {
    disk: new Map([['/w/.claude/settings.local.json', JSON.stringify({ env: { ORQUESTRADOR: 'barrar' } })]]),
    calls: [],
    spawns: [],
    agents: [],
    verdict: 'Veredito: aprovado, nenhuma violação.',
  }
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 10) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('fs.exists', ($, e) => ({ value: w.disk.has(e.path) || [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.read', ($, e) => ({ value: w.disk.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    w.disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: [...w.disk.keys()]
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
  }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } as never }))
  on('tool.check', () => ({ decision: 'allow' }) as never)
  on('tool.list', () => ({
    value: [{ name: 'mcp__ccd_session_mgmt__list_sessions' }, { name: 'mcp__ccd_session_mgmt__get_session' }] as never,
  }))
  on('agent.list', () => ({ value: w.agents as never }))
  on('agent.spawn', ($, e) => {
    w.spawns.push({ ...(e.name === undefined ? {} : { name: e.name }), subagentType: e.subagentType, background: e.background })
    const id = `ag-${w.spawns.length}`
    w.agents.push({ id, description: e.description, type: e.subagentType, status: 'running', ...(e.name === undefined ? {} : { name: e.name }) })
    return { model: 'sonnet', agentId: id } as never
  })
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    w.calls.push(input)
    if (input.tool === 'mcp__ccd_session_mgmt__get_session') return answer(JSON.stringify(ME))
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return answer(JSON.stringify([ME]))
    if (input.tool === 'Agent') return answer(w.verdict)
    if (input.tool === 'Bash') return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
    return answer('ok')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orchestrator__flow', ...input } as never) as Promise<Reply>
const bash = ($: Engine, command: string, agentId?: string) =>
  $.tool.call({ tool: 'Bash', command, ...(agentId === undefined ? {} : { agentId }) } as never) as Promise<Reply>
const saved = (w: World) => JSON.parse(w.disk.get(STATE) ?? '{}') as FlowState
const spawn = ($: Engine, name: string, subagentType = 'orchestrator:executor') =>
  // a plugin's own spawn, as the Agent tool's call reaches the mod's hook: the engine fills the rest
  $.agent.spawn({ prompt: `faça ${name}`, name, description: name, subagentType } as never) as Promise<{ agentId?: string; deny?: string }>

/** The plan: phase 1 (testes and regras) and phase B, neither naming a session, as a coordination that runs subagents writes it. */
const plan = (w: World) => {
  const phase = (id: string, gates: string[] | undefined) => ({
    id, title: `Fase ${id}`, status: 'running' as const, icon: undefined, tasks: `${id}.x`, session: undefined,
    dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates,
  })
  const run: OrchestrationRun = {
    change: 'demo', changePath: 'openspec/changes/demo', coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
    waves: [{ title: undefined, summary: undefined, jira: undefined, phases: [phase('1', ['testes', 'regras']), phase('2', undefined)] }],
    ownerQuestions: [], finalGates: undefined, updatedAt: 1,
  }
  w.disk.set(`${BASE}/runs/demo.json`, JSON.stringify(run))
  w.disk.set(TASKS, '## 1. Base\n- [ ] 1.1 Modelo\n\n## 2. Tela\n- [x] 2.1 Lista\n')
}

const toExecutar = async ($: Engine, w: World) => {
  await flow($, { action: 'start', change: 'demo', flow: 'rapido', changePath: 'openspec/changes/demo' })
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await bash($, 'openspec validate demo')
  expect(saved(w).current).toBe('executar')
}

test('a phase run by a subagent proves its own gates: node --test in it and a reviewer named for it; it closes without any session', async ($, on) => {
  const w = world(on)
  plan(w)
  await toExecutar($, w)

  const started = await spawn($, 'fase-1')
  expect(started.agentId).toBe('ag-1')

  // the subagent runs Node's own test runner: it counts for phase 1, not for the coordination
  await bash($, 'node --test tests/', 'ag-1')
  const early = await flow($, { action: 'close', phase: '1' })
  expect(String(early.result)).toMatch(/tasks 1\.1 are not ticked/)
  expect(String(early.result)).toMatch(/regras not run/)
  expect(String(early.result)).not.toMatch(/testes/)
  expect(String(early.result)).toMatch(/subagent "fase-1" \(merge its worktree branch/)

  // the coordination runs the reviewer for phase 1 in the foreground; its verdict proves regras for that phase
  await $.tool.call({ tool: 'Agent', subagent_type: 'aidakit:adr-reviewer', name: 'revisao-fase-1', description: 'regras da fase 1', prompt: 'revise' } as never)
  // the branch merged here: tasks.md shows the tick
  w.disk.set(TASKS, '## 1. Base\n- [x] 1.1 Modelo\n\n## 2. Tela\n- [x] 2.1 Lista\n')
  const closed = await flow($, { action: 'close', phase: '1' })
  expect(String(closed.result)).toBe('Phase 1 closed. Still open: 2 (Fase 2).')
  // no session was opened, none archived, and the owner was never asked for anything
  expect(w.calls.filter(c => String(c.tool).startsWith('mcp__ccd_session__') || c.tool === 'mcp__ccd_session_mgmt__archive_session')).toEqual([])
  expect(saved(w).pendingStarts).toBeUndefined()
})

test("a subagent's test run never proves the coordination's own phase, nor another phase", async ($, on) => {
  const w = world(on)
  plan(w)
  await toExecutar($, w)
  await spawn($, 'fase-1')
  await spawn($, 'fase-2')
  await bash($, 'pnpm test', 'ag-2')
  w.disk.set(TASKS, '## 1. Base\n- [x] 1.1 Modelo\n\n## 2. Tela\n- [x] 2.1 Lista\n')
  const a = await flow($, { action: 'close', phase: '1' })
  expect(String(a.result)).toMatch(/testes not run/)
})

test('a reviewer started in the background runs in the foreground, so its verdict is what the Agent call answers', async ($, on) => {
  const w = world(on)
  plan(w)
  await toExecutar($, w)
  await spawn($, 'revisao-fase-1', 'aidakit:adr-reviewer')
  await spawn($, 'fase-1')
  expect(w.spawns).toEqual([
    { name: 'revisao-fase-1', subagentType: 'aidakit:adr-reviewer', background: false },
    // a phase keeps what the call asked (a plugin's own spawn names none)
    { name: 'fase-1', subagentType: 'orchestrator:executor', background: undefined },
  ])
})

test('at most three phase subagents run at once in "barrar"; one that ended frees its place', async ($, on) => {
  const w = world(on)
  plan(w)
  await toExecutar($, w)
  for (const name of ['fase-1', 'fase-2', 'fase-3']) expect((await spawn($, name)).agentId).toBeDefined()
  const fourth = await spawn($, 'fase-4')
  expect(fourth.deny).toMatch(/at most 3 phases run at once and fase-1, fase-2, fase-3 still run/)
  // a step's subagent and any other subagent are not phases: the ceiling does not hold them
  expect((await spawn($, 'passo-planejar', 'orchestrator:planner')).agentId).toBeDefined()
  w.agents[0]!.status = 'completed'
  expect((await spawn($, 'fase-4')).agentId).toBeDefined()
})
