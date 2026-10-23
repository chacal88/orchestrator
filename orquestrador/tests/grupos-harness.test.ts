import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState, OrchestrationRun } from '../types'

/** The clone is activated, as the owner does from the panel: the mod works only where it is. */
const ACTIVE: [string, string] = [`/w/.claude/${'settings'}.local.json`, JSON.stringify({ env: { ORQUESTRADOR: 'barrar' } })]

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }
type Row = { sessionId: string; cwd: string; title: string; startedBy?: string; groupId?: string; isArchived?: boolean; isRunning?: boolean }

const BASE = '/h/.claude/orquestrador'
const T = {
  list: 'mcp__ccd_session_mgmt__list_sessions',
  get: 'mcp__ccd_session_mgmt__get_session',
  groups: 'mcp__ccd_sidebar__list_groups',
  create: 'mcp__ccd_sidebar__create_group',
  move: 'mcp__ccd_sidebar__move_sessions',
  start: 'mcp__ccd_session__start_session',
}

type World = {
  disk: Map<string, string>
  rows: Row[]
  groups: { id: string; name: string }[]
  groupsFail: boolean
  calls: Record<string, unknown>[]
}

const row = (sessionId: string, groupId: string | undefined, extra: Partial<Row> = {}): Row => ({
  sessionId, cwd: `/w/wt/${sessionId}`, title: `Fase ${sessionId}`, startedBy: 'local_ee', groupId, ...extra,
})

/**
 * A coordinator (local_ee, at /w) with an in-memory disk and a sidebar that moves the nested
 * children along with their mother, as the app does.
 */
const world = (on: On, rows: Row[], groups: World['groups']): World => {
  mock.store(on)
  const w: World = { disk: new Map([ACTIVE]), rows: [{ sessionId: 'local_ee', cwd: '/w', title: 'Coordenação', groupId: 'cg-A' }, ...rows], groups, groupsFail: false, calls: [] }
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
  on('tool.list', () => ({ value: Object.values(T).map(name => ({ name })) as never }))
  const answer = (text: string, isError?: true) => ({ result: text, text, ...(isError === undefined ? {} : { isError }) }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    w.calls.push(input)
    if (input.tool === T.get) return answer(JSON.stringify(w.rows[0]))
    if (input.tool === T.list) return answer(JSON.stringify(w.rows))
    if (input.tool === T.groups) {
      return w.groupsFail ? answer('nenhuma janela reportou os grupos', true) : answer(JSON.stringify(w.groups))
    }
    if (input.tool === T.create) {
      const group = { id: `cg-${String(input.name).slice(-1).toUpperCase()}`, name: String(input.name) }
      w.groups.push(group)
      return answer(JSON.stringify(group))
    }
    if (input.tool === T.move) {
      for (const id of input.session_ids as string[]) {
        const target = id === 'self' ? w.rows[0]! : w.rows.find(r => r.sessionId === id)
        if (target === undefined) continue
        target.groupId = String(input.group_id)
        // the app drags the nested children with their mother
        if (target === w.rows[0]) for (const r of w.rows) if (r.startedBy === 'local_ee' && !r.isArchived) r.groupId = String(input.group_id)
      }
      return answer('ok')
    }
    if (input.tool === T.start) return answer('Started session local_b1')
    return answer('ok')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orquestrador__flow', ...input } as never) as Promise<Reply>
const startSession = ($: Engine) =>
  $.tool.call({ tool: T.start, initiation: 'user_asked', title: 'x', prompt: 'p' } as never) as Promise<Reply>
const saved = (w: World, change: string) => JSON.parse(w.disk.get(`${BASE}/flows/${change}.json`) ?? '{}') as FlowState
const moves = (w: World) => w.calls.filter(c => c.tool === T.move)
const creates = (w: World) => w.calls.filter(c => c.tool === T.create)

/** Change A is over: its flow is done, with its group and its child, and its plan is the one published last. */
const changeA = async ($: Engine, w: World) => {
  await flow($, { action: 'start', change: 'a', flow: 'rapido' })
  w.disk.set(`${BASE}/flows/a.json`, JSON.stringify({ ...saved(w, 'a'), status: 'done', groupId: 'cg-A', sessions: ['local_a1'] }))
  const run: OrchestrationRun = {
    change: 'a', changePath: undefined, coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
    waves: [{
      title: undefined, summary: undefined, jira: undefined,
      phases: [{ id: '1', title: 'Fase', status: 'done', icon: undefined, tasks: '1.x', session: 'local_a1', dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates: undefined }],
    }],
    ownerQuestions: [], finalGates: undefined, updatedAt: 9_000,
  }
  w.disk.set(`${BASE}/runs/a.json`, JSON.stringify(run))
}

test('the flow records its coordinator, and a flow from before the field gets it at the next report', async ($, on) => {
  const w = world(on, [], [])
  const started = await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  expect(saved(w, 'b').coordinatorSession).toBe('local_ee')
  expect(String(started.result)).not.toMatch(/unarchived/)

  const { coordinatorSession: _gone, ...old } = saved(w, 'b')
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify(old))
  expect(saved(w, 'b').coordinatorSession).toBeUndefined()
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  expect(saved(w, 'b').coordinatorSession).toBe('local_ee')
})

test('with the plan of change A published and the flow of B running, the new child goes to B and A keeps its own', async ($, on) => {
  const w = world(on, [row('local_a1', 'cg-A')], [{ id: 'cg-A', name: '🪪 a' }])
  await changeA($, w)

  const started = await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  expect(String(started.result)).toMatch(/1 unarchived child session\(s\) of earlier changes/)
  expect(saved(w, 'b').earlier).toEqual(['local_a1'])

  w.rows.push(row('local_b1', 'cg-A'))
  expect((await startSession($)).deny).toBeUndefined()

  expect(creates(w).map(c => c.name)).toEqual(['🪪 b'])
  const [toB, back] = moves(w)
  expect(toB).toMatchObject({ group_id: 'cg-B', session_ids: ['self', 'local_b1'] })
  expect((toB!.session_ids as string[]).includes('local_a1')).toBe(false)
  // the app dragged A's child along with the coordinator; it goes back to A's group
  expect(back).toMatchObject({ group_id: 'cg-A', session_ids: ['local_a1'] })
  expect(w.rows.map(r => [r.sessionId, r.groupId])).toEqual([['local_ee', 'cg-B'], ['local_a1', 'cg-A'], ['local_b1', 'cg-B']])
  expect(saved(w, 'b')).toMatchObject({ groupId: 'cg-B', sessions: ['local_b1'] })
})

test('a list_groups that fails creates no group; the next hook does', async ($, on) => {
  const w = world(on, [], [])
  await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  w.rows.push(row('local_b1', 'cg-A'))
  w.groupsFail = true
  await startSession($)
  expect(creates(w)).toEqual([])
  expect(moves(w)).toEqual([])

  w.groupsFail = false
  await startSession($)
  expect(creates(w).map(c => c.name)).toEqual(['🪪 b'])
  expect(moves(w)[0]).toMatchObject({ group_id: 'cg-B', session_ids: ['self', 'local_b1'] })
})

test('a group that already carries the change name is reused, and its id is kept in the flow', async ($, on) => {
  const w = world(on, [], [{ id: 'cg-9', name: '🪪 b' }])
  await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  w.rows.push(row('local_b1', 'cg-A'))
  await startSession($)
  expect(creates(w)).toEqual([])
  expect(moves(w)[0]).toMatchObject({ group_id: 'cg-9' })
  expect(saved(w, 'b').groupId).toBe('cg-9')

  // the owner renames the group: the stored id still finds it
  w.groups[0]!.name = 'outro nome'
  await startSession($)
  expect(creates(w)).toEqual([])
})
