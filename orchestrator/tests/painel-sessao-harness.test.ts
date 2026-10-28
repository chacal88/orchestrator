import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState, OrchestrationRun } from '../types'

type On = Parameters<TestBody>[1]
type Row = { sessionId: string; cwd: string; title: string; startedBy?: string; isArchived?: boolean; isRunning?: boolean }

const BASE = '/h/.claude/orquestrador'
const DAY_MS = 24 * 60 * 60 * 1000
const T = {
  list: 'mcp__ccd_session_mgmt__list_sessions',
  get: 'mcp__ccd_session_mgmt__get_session',
}

const PANE = {
  component: 'Pane',
  requestId: 'orchestrator',
  props: { title: 'Orchestrator', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

type World = { disk: Map<string, string>; rows: Row[]; advance: (ms: number) => void }

/** A coordinator (local_ee, at /w) the app knows by its id; another session (local_other) works in the same clone. */
const world = (on: On): World => {
  mock.store(on)
  let now = 10 * DAY_MS
  const w: World = {
    disk: new Map(),
    rows: [
      { sessionId: 'local_ee', cwd: '/w', title: 'Coordenação', isRunning: false },
      { sessionId: 'local_other', cwd: '/w', title: 'Outra coordenação', isRunning: true },
    ],
    advance: ms => {
      now += ms
    },
  }
  on('env.get', () => ({ value: '/h' }))
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
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repo' } as never }))
  on('tool.list', () => ({ value: Object.values(T).map(name => ({ name })) as never }))
  on('tool.check', () => ({ decision: 'allow' }) as never)
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === T.get) return answer(JSON.stringify(w.rows[0]))
    if (input.tool === T.list) return answer(JSON.stringify(w.rows))
    if (input.tool === 'Bash') return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
    return answer('ok')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  return w
}

const flow = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__orchestrator__flow', ...input } as never)
const flowOf = (w: World, change: string): FlowState => JSON.parse(w.disk.get(`${BASE}/flows/${change}.json`) ?? '{}') as FlowState
const setFlow = (w: World, change: string, patch: Partial<FlowState>) =>
  w.disk.set(`${BASE}/flows/${change}.json`, JSON.stringify({ ...flowOf(w, change), ...patch }))
const runOf = (w: World, change: string): OrchestrationRun => JSON.parse(w.disk.get(`${BASE}/runs/${change}.json`) ?? '{}') as OrchestrationRun

/** The plan of `freio-aviso`, published by this coordination. */
const publish = ($: Engine, change: string) =>
  $.tool.call({
    tool: 'mcp__orchestrator__plan',
    change,
    waves: [{ phases: [{ id: '1', title: `Fase de ${change}`, status: 'running', gates: ['testes'] }] }],
  } as never)

/** The run as a 0.14.1 mod wrote it: no `coordinatorSession`. */
const asOldRun = (w: World, change: string, patch: Partial<OrchestrationRun> = {}) => {
  const { coordinatorSession: _drop, ...old } = runOf(w, change)
  w.disk.set(`${BASE}/runs/${change}.json`, JSON.stringify({ ...old, ...patch }))
}

/** `freio-aviso`, coordinated here before: its plan published and its flow done. */
const finishedChange = async ($: Engine, w: World) => {
  expect((await flow($, { action: 'start', change: 'freio-aviso', flow: 'completo' })).isError).toBeUndefined()
  expect((await publish($, 'freio-aviso')).isError).toBeUndefined()
  setFlow(w, 'freio-aviso', { status: 'done', current: 'fim' })
}

/** `/orchestrator:panel`, which reads the disk again, then the pane as the owner sees it. */
const mount = async ($: Engine) => {
  await $.command.run({ command: 'orchestrator:panel', args: '', origin: { kind: 'composer' } } as never)
  return $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...PANE })
}

test('C14: with the plan of a done change and a running flow of another change of this session, the panel shows the running one with the owner\'s button', async ($, on) => {
  const w = world(on)
  await finishedChange($, w)
  // the plan was published by the 0.14.1 mod, before the field existed
  asOldRun(w, 'freio-aviso')
  expect((await flow($, { action: 'start', change: 'orchestrator-commands', flow: 'completo' })).isError).toBeUndefined()
  expect(flowOf(w, 'orchestrator-commands').coordinatorSession).toBe('local_ee')

  const ui = await mount($)
  expect(await ui.find({ key: 'flow:grill:fechado' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ ✋ Entendimento/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /esperando você/ })).toBeDefined()
  // neither the done flow nor its plan: an old run never shows in a session that has another flow
  expect(await ui.find({ type: 'Text', text: /freio-aviso/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Fase de freio-aviso/ })).toBeUndefined()
  await ui.unmount()
})

test('C14: a running flow another session coordinates in the same clone does not show here', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'outra', flow: 'completo' })
  setFlow(w, 'outra', { coordinatorSession: 'local_other' })

  const ui = await mount($)
  expect(await ui.find({ key: 'flow:grill:fechado' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Entendimento/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /outra/ })).toBeUndefined()
  await ui.unmount()
})

test('C14: without a flow of this session, the plan of a concluded flow does not bring that flow to the panel', async ($, on) => {
  const w = world(on)
  await finishedChange($, w)
  expect(runOf(w, 'freio-aviso').coordinatorSession).toBe('local_ee')

  const ui = await mount($)
  // the plan is this session's, an orchestration of its own; the done flow never enters
  expect(await ui.find({ type: 'Text', text: /Fase de freio-aviso/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Entendimento/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /flow concluído/i })).toBeUndefined()
  expect(await ui.find({ key: 'end:arm' })).toBeUndefined()
  await ui.unmount()
})

test('C14: an escalated flow of this session shows with the escalation\'s buttons', async ($, on) => {
  const w = world(on)
  await finishedChange($, w)
  await flow($, { action: 'start', change: 'orchestrator-commands', flow: 'completo' })
  setFlow(w, 'orchestrator-commands', { status: 'escalated', escalation: { step: 'grill', from: 'grill', outcome: 'x', attempts: 3 } })

  const ui = await mount($)
  expect(await ui.find({ key: 'flow:grill:tentar-de-novo' })).toBeDefined()
  expect(await ui.find({ key: 'flow:grill:encerrar' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /orchestrator-commands/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Fase de freio-aviso/ })).toBeUndefined()
  await ui.unmount()
})

test('a plan without a flow shows to the session that published it, never to another; an old one only within 24 h', async ($, on) => {
  const w = world(on)
  expect((await publish($, 'solta')).isError).toBeUndefined()
  let ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /Fase de solta/ })).toBeDefined()
  await ui.unmount()

  // published by the other coordination of this clone
  w.disk.set(`${BASE}/runs/solta.json`, JSON.stringify({ ...runOf(w, 'solta'), coordinatorSession: 'local_other' }))
  ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /Fase de solta/ })).toBeUndefined()
  await ui.unmount()

  // from the 0.14.1 mod, an hour old: it still shows, so updating the plugin mid-way hides nothing
  asOldRun(w, 'solta', { updatedAt: 10 * DAY_MS - 60 * 60 * 1000 })
  ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /Fase de solta/ })).toBeDefined()
  await ui.unmount()

  w.advance(DAY_MS)
  ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /Fase de solta/ })).toBeUndefined()
  await ui.unmount()
})
