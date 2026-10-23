import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, TestBody } from 'claude-code/testing'

import type { FlowState } from '../types'

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

type World = { disk: Map<string, string>; rows: Row[]; prompts: { text: string; asUser: boolean }[]; clock: MockClock }

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
  const w: World = { disk: new Map([ACTIVE]), rows: [{ sessionId: 'local_ee', cwd: '/w', title: 'Coordenação', isRunning: false }, ...rows], prompts: [], clock }
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
  on('tool.list', () => ({ value: Object.values(T).map(name => ({ name })) as never }))
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === T.get) return answer(JSON.stringify(w.rows[0]))
    if (input.tool === T.list) return answer(JSON.stringify(w.rows))
    return answer('ok')
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
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

/** The coordinator's session opens, its flow starts, and one refresh records what each child is doing. */
const coordinate = async ($: Engine, w: World) => {
  await $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true } as never)
  await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  expect(saved(w, 'b').coordinatorSession).toBe('local_ee')
  await w.clock.advance(REFRESH_MS)
}

test('with the option on, a child that ends its turn wakes the coordination once, with its title', async ($, on) => {
  const w = world(on, [child('local_b1')])
  optionOn(w)
  await coordinate($, w)
  expect(w.prompts).toEqual([])

  stop(w, 'local_b1')
  await w.clock.advance(REFRESH_MS)
  expect(w.prompts).toEqual([{ text: 'Painel: a sessão "Fase local_b1" terminou o turno. Siga o flow.', asUser: false }])

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
  expect(w.prompts).toEqual([{ text: 'Painel: as sessões "Fase local_b1", "Fase local_b2" terminaram o turno. Siga o flow.', asUser: false }])
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.prompts).toHaveLength(1)
})
