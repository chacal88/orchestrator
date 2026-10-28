import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, TestBody } from 'claude-code/testing'

import type { FlowState, OrchestrationRun } from '../types'

/** The clone is activated, as the owner does from the panel: the mod works only where it is. */
const ACTIVE: [string, string] = [`/w/.claude/${'settings'}.local.json`, JSON.stringify({ env: { ORQUESTRADOR: 'barrar' } })]

type On = Parameters<TestBody>[1]
type Row = {
  sessionId: string
  cwd: string
  title: string
  startedBy?: string
  isArchived?: boolean
  isRunning?: boolean
  lastActivityAt?: string
}

const BASE = `/h/.claude/${'orquestrador'}`
const AUTOWAKE = `${BASE}/autowake.json`
const REFRESH_MS = 15_000
const T = {
  list: 'mcp__ccd_session_mgmt__list_sessions',
  get: 'mcp__ccd_session_mgmt__get_session',
}
const START = 'mcp__ccd_session__start_session'

type World = {
  disk: Map<string, string>
  rows: Row[]
  prompts: { text: string; asUser: boolean }[]
  toasts: string[]
  clock: MockClock
  /** While set, list_sessions answers only once it resolves: the refresh waits there, and the next one overlaps it. */
  hold?: Promise<void>
}

const child = (sessionId: string, extra: Partial<Row> = {}): Row => ({
  sessionId, cwd: `/w/.claude/worktrees/${sessionId}`, title: `Fase ${sessionId}`, startedBy: 'local_ee', isRunning: true, lastActivityAt: 't1', ...extra,
})

/**
 * A coordinator (local_ee, at /w) on a mocked clock, so its panel refreshes every 15 s as in the app; the
 * session list answers from `rows`, and the prompts the mod submits land in `prompts`.
 */
const world = (on: On, rows: Row[]): World => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w: World = { disk: new Map([ACTIVE]), rows: [{ sessionId: 'local_ee', cwd: '/w', title: 'Coordenação', isRunning: false }, ...rows], prompts: [], toasts: [], clock }
  on('env.get', () => ({ value: '/h' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('fs.exists', ($, e) => ({ value: w.disk.has(e.path) || [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.read', ($, e) => ({ value: w.disk.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    w.disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: [...w.disk.keys()]
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: clock.now(), isLink: false })) as never,
  }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repo' } as never }))
  on('tool.check', () => ({ decision: 'allow' }) as never)
  on('tool.list', () => ({ value: Object.values(T).map(name => ({ name })) as never }))
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === T.get) return answer(JSON.stringify(w.rows[0]))
    if (input.tool === T.list && w.hold !== undefined) await w.hold
    if (input.tool === T.list) return answer(JSON.stringify(w.rows))
    if (input.tool === START) {
      // the app opens the child and answers with its id
      const id = `local_c${w.rows.length}`
      w.rows.push(child(id))
      return answer(`Started session ${id}`)
    }
    return answer('ok')
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('prompt.submit', ($, e) => {
    const origin = e.origin as { kind: string; asUser?: true }
    w.prompts.push({ text: e.text, asUser: origin.kind === 'plugin' && origin.asUser === true })
    return { text: e.text } as never
  })
  return w
}

const flow = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__orquestrador__flow', ...input } as never)
const saved = (w: World, change: string) => JSON.parse(w.disk.get(`${BASE}/flows/${change}.json`) ?? '{}') as FlowState
const optionOn = (w: World) => w.disk.set(AUTOWAKE, JSON.stringify({ '/w': { on: true, at: 1 } }))
const stop = (w: World, id: string, activity = 't2') => {
  const row = w.rows.find(r => r.sessionId === id)!
  row.isRunning = false
  row.lastActivityAt = activity
}

/**
 * The coordinator's session opens, its flow starts and keeps the children it opened (by default, every one
 * of local_ee's; `earlier` ones belong to a change before), and one refresh records what each child is doing.
 */
const coordinate = async ($: Engine, w: World, earlier: string[] = []) => {
  await $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true } as never)
  await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  expect(saved(w, 'b').coordinatorSession).toBe('local_ee')
  const sessions = w.rows.filter(r => r.startedBy === 'local_ee' && !earlier.includes(r.sessionId)).map(r => r.sessionId)
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w, 'b'), sessions, earlier }))
  await w.clock.advance(REFRESH_MS)
}

test('with the option on, a child that ends its turn wakes the coordination once, with its id', async ($, on) => {
  const w = world(on, [child('local_b1')])
  optionOn(w)
  await coordinate($, w)
  expect(w.prompts).toEqual([])

  stop(w, 'local_b1')
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toEqual([{ text: 'Painel: a sessão local_b1 terminou o turno. Confira no flow status e siga o flow.', asUser: false }])

  // the same stop seen by the next refreshes is told once
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toHaveLength(1)
})

test('with the option off, nothing is told and nothing is watched', async ($, on) => {
  const w = world(on, [child('local_b1')])
  await coordinate($, w)
  stop(w, 'local_b1')
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toEqual([])

  // turning it on later tells no stop that happened while it was off
  optionOn(w)
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toEqual([])
})

test('a session outside the plan or archived wakes nothing', async ($, on) => {
  const w = world(on, [child('local_hand', { startedBy: undefined }), child('local_old')])
  optionOn(w)
  await coordinate($, w)
  stop(w, 'local_hand')
  stop(w, 'local_old')
  w.rows.find(r => r.sessionId === 'local_old')!.isArchived = true
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toEqual([])
})

test('the mod of a child in the same folder, not the coordinator, tells nothing', async ($, on) => {
  const w = world(on, [child('local_b1')])
  optionOn(w)
  await coordinate($, w)
  // the flow is coordinated by another session: this one is a child sharing the folder
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w, 'b'), coordinatorSession: 'local_other' }))
  stop(w, 'local_b1')
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toEqual([])
})

test('while the coordination works the stops wait, and go in one prompt once it stops', async ($, on) => {
  const w = world(on, [child('local_b1'), child('local_b2')])
  optionOn(w)
  await coordinate($, w)

  w.rows[0]!.isRunning = true
  stop(w, 'local_b1')
  await w.clock.advance(REFRESH_MS)
  stop(w, 'local_b2')
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toEqual([])

  w.rows[0]!.isRunning = false
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toEqual([{ text: 'Painel: as sessões local_b1, local_b2 terminaram o turno. Confira no flow status e siga o flow.', asUser: false }])
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toHaveLength(1)
})

test('a child of an earlier change, or of another flow, wakes nothing even when the coordination opened it', async ($, on) => {
  const w = world(on, [child('local_a1'), child('local_c1'), child('local_b1')])
  optionOn(w)
  await coordinate($, w, ['local_a1'])
  // change c ran before on this coordination and keeps its own child, which b's list names by mistake
  w.disk.set(`${BASE}/flows/c.json`, JSON.stringify({ ...saved(w, 'b'), change: 'c', status: 'done', sessions: ['local_c1'], earlier: [] }))
  expect(saved(w, 'b').sessions).toContain('local_c1')
  stop(w, 'local_a1')
  stop(w, 'local_c1')
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toEqual([])

  stop(w, 'local_b1')
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts.map(p => p.text)).toEqual(['Painel: a sessão local_b1 terminou o turno. Confira no flow status e siga o flow.'])
})

test('two refreshes that overlap tell a stop once', async ($, on) => {
  const w = world(on, [child('local_b1')])
  optionOn(w)
  await coordinate($, w)
  stop(w, 'local_b1')
  // the first tick's refresh waits on the session list while the second tick starts: both look together
  let release = () => {}
  w.hold = new Promise(resolve => (release = resolve))
  await w.clock.advance(REFRESH_MS)
  await w.clock.advance(REFRESH_MS)
  w.hold = undefined
  release()
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toHaveLength(1)
})

test('a refresh run by a flow report leaves the stop to the tick, which tells it', async ($, on) => {
  const w = world(on, [child('local_b1')])
  optionOn(w)
  await coordinate($, w)
  stop(w, 'local_b1')
  // a prompt submitted inside the report's tool call would wait on that call's turn: the stop must not go there
  await Promise.all([w.clock.advance(REFRESH_MS), flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })])
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toHaveLength(1)
})

/** The plan of change b, published by the coordination: one phase per child, the first `done` ones done. */
const publishPlan = (w: World, ids: readonly string[], done: number, updatedAt: number) => {
  const run: OrchestrationRun = {
    change: 'b', changePath: undefined, coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
    waves: [{
      title: undefined, summary: undefined, jira: undefined,
      phases: ids.map((id, i) => ({
        id: String(i + 1), title: `Fase ${i + 1}`, status: i < done ? 'done' : 'running', icon: undefined, tasks: `${i + 1}.x`, session: id,
        dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates: undefined,
      })),
    }],
    ownerQuestions: [], finalGates: undefined, updatedAt,
  }
  w.disk.set(`${BASE}/runs/b.json`, JSON.stringify(run))
}

const FOUR = ['local_b1', 'local_b2', 'local_b3', 'local_b4']

test('4 phases that end one by one in the executar loop, with the seq standing still, are 4 stops told and no toast', async ($, on) => {
  // between the stops the coordination closes the phase that ended (`flow close`), which keeps the seq
  const w = world(on, FOUR.map(id => child(id)))
  optionOn(w)
  await coordinate($, w)
  const seq = saved(w, 'b').seq
  for (const [i, id] of FOUR.entries()) {
    stop(w, id)
    await w.clock.advance(REFRESH_MS)
    const now = saved(w, 'b')
    w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...now, closed: { ...now.closed, [String(i + 1)]: { at: 1, tasks: [], archived: true } } }))
  }
  expect(saved(w, 'b').seq).toBe(seq)
  expect(w.prompts.map(p => p.text)).toEqual(FOUR.map(id => `Painel: a sessão ${id} terminou o turno. Confira no flow status e siga o flow.`))
  expect(w.toasts.filter(t => /parece parado/.test(t))).toEqual([])
})

test('4 phases that end one by one, with the plan republished between them and the seq standing still, are 4 stops told', async ($, on) => {
  const w = world(on, FOUR.map(id => child(id)))
  optionOn(w)
  publishPlan(w, FOUR, 0, 10)
  await coordinate($, w)
  for (const [i, id] of FOUR.entries()) {
    stop(w, id)
    await w.clock.advance(REFRESH_MS)
    publishPlan(w, FOUR, i + 1, 20 + i)
  }
  expect(w.prompts).toHaveLength(4)
  expect(w.toasts.filter(t => /parece parado/.test(t))).toEqual([])
})

test('4 different children that end while nothing moves in the flow are still 4 stops told: the brake counts per child', async ($, on) => {
  // a wave of parallel phases: the coordination waits for all of them before it closes any
  const w = world(on, FOUR.map(id => child(id)))
  optionOn(w)
  await coordinate($, w)
  const before = JSON.stringify(saved(w, 'b'))
  for (const id of FOUR) {
    stop(w, id)
    await w.clock.advance(REFRESH_MS)
  }
  expect(JSON.stringify(saved(w, 'b'))).toBe(before)
  expect(w.prompts).toHaveLength(4)
  expect(w.toasts.filter(t => /parece parado/.test(t))).toEqual([])
})

test('the same child that stops again and again while nothing moves is braked, even with the plan republished as it was', async ($, on) => {
  const w = world(on, [child('local_b1'), child('local_b2')])
  optionOn(w)
  publishPlan(w, ['local_b1', 'local_b2'], 0, 10)
  await coordinate($, w)
  for (const [i, activity] of ['t2', 't3', 't4', 't5', 't6', 't7'].entries()) {
    stop(w, 'local_b1', activity)
    await w.clock.advance(REFRESH_MS)
    // republishing the same plan is not progress
    publishPlan(w, ['local_b1', 'local_b2'], 0, 20 + i)
  }
  expect(w.prompts).toHaveLength(3)
  expect(w.toasts.filter(t => /parece parado/.test(t))).toHaveLength(1)
  expect(w.toasts.find(t => /parece parado/.test(t))).toMatch(/local_b1/)

  // another child of the flow is still told, without a second toast
  stop(w, 'local_b2')
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts.map(p => p.text).slice(3)).toEqual(['Painel: a sessão local_b2 terminou o turno. Confira no flow status e siga o flow.'])
  expect(w.toasts.filter(t => /parece parado/.test(t))).toHaveLength(1)
})

test('after 3 stops told with the flow standing still, the mod stops telling and says so; a moving flow tells again', async ($, on) => {
  const w = world(on, [child('local_b1')])
  optionOn(w)
  await coordinate($, w)
  for (const activity of ['t2', 't3', 't4', 't5', 't6']) {
    stop(w, 'local_b1', activity)
    await w.clock.advance(REFRESH_MS)
  }
  expect(w.prompts).toHaveLength(3)
  expect(w.toasts.filter(t => /parece parado/.test(t))).toHaveLength(1)

  // the coordination moves the flow (a new seq): the next stop is told again
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  stop(w, 'local_b1', 't7')
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toHaveLength(4)
})

/** The coordination opens a new child of the flow: a new row in the session list, adopted in the flow's `sessions`. */
const openChild = (w: World, id: string) => {
  w.rows.push(child(id))
  const now = saved(w, 'b')
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...now, sessions: [...(now.sessions ?? []), id] }))
}

test('a coordination that opens a new child on each stop while the flow stands still is told 10 times, then not at all, with one toast', async ($, on) => {
  const w = world(on, [child('local_n1')])
  optionOn(w)
  await coordinate($, w)
  for (let i = 1; i <= 12; i++) {
    stop(w, `local_n${i}`)
    await w.clock.advance(REFRESH_MS)
    // each stop makes the coordination open one more child, and nothing else moves in the flow
    openChild(w, `local_n${i + 1}`)
    await w.clock.advance(REFRESH_MS)
  }
  expect(w.prompts.map(p => p.text)).toEqual(
    Array.from({ length: 10 }, (_, i) => `Painel: a sessão local_n${i + 1} terminou o turno. Confira no flow status e siga o flow.`),
  )
  const stuck = w.toasts.filter(t => /parece parado/.test(t))
  expect(stuck).toEqual(['Orquestrador: o flow de b parece parado: 10 avisos à coordenação sem o flow andar. Parei de avisar até o flow andar.'])
})

test('after the cap, a report that moves the flow makes the next stop be told again', async ($, on) => {
  const w = world(on, [child('local_n1')])
  optionOn(w)
  await coordinate($, w)
  for (let i = 1; i <= 11; i++) {
    stop(w, `local_n${i}`)
    await w.clock.advance(REFRESH_MS)
    openChild(w, `local_n${i + 1}`)
    await w.clock.advance(REFRESH_MS)
  }
  expect(w.prompts).toHaveLength(10)

  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  stop(w, 'local_n12')
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toHaveLength(11)
  expect(w.prompts[10]!.text).toBe('Painel: a sessão local_n12 terminou o turno. Confira no flow status e siga o flow.')
  expect(w.toasts.filter(t => /parece parado/.test(t))).toHaveLength(1)
})

test('with the clone inactive nothing is kept, so a stop from then is not told once it is active again', async ($, on) => {
  const w = world(on, [child('local_b1')])
  optionOn(w)
  await coordinate($, w)
  w.disk.delete(ACTIVE[0])
  stop(w, 'local_b1')
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toEqual([])

  w.disk.set(...ACTIVE)
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toEqual([])
})

test('a child opened with wake_when_done wakes nothing from the mod (the app wakes for it); one opened without it still does', async ($, on) => {
  const w = world(on, [])
  optionOn(w)
  await coordinate($, w)
  const followed = (await $.tool.call({ tool: START, initiation: 'user_asked', wake_when_done: true, title: 'Fase 1', prompt: 'p' } as never)) as { text?: string }
  const carded = (await $.tool.call({ tool: START, initiation: 'own_initiative', title: 'Fase 2', prompt: 'p' } as never)) as { text?: string }
  expect([followed.text, carded.text]).toEqual(['Started session local_c1', 'Started session local_c2'])
  // the flow keeps the child the app follows, and only that one
  expect(saved(w, 'b').tracked).toEqual(['local_c1'])
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w, 'b'), sessions: ['local_c1', 'local_c2'] }))
  await w.clock.advance(REFRESH_MS)

  stop(w, 'local_c1')
  stop(w, 'local_c2')
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toEqual([{ text: 'Painel: a sessão local_c2 terminou o turno. Confira no flow status e siga o flow.', asUser: false }])

  // the followed child ending again is still not told; it stays watched, so it is never told as new either
  w.rows.find(r => r.sessionId === 'local_c1')!.isRunning = true
  await w.clock.advance(REFRESH_MS)
  stop(w, 'local_c1', 't3')
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toHaveLength(1)
})
