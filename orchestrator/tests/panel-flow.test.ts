import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowEvent, PanelView } from '../types'
import { bandSummary, formatElapsed, parseEvents, stepTimes } from '../hooks/glance'

type On = Parameters<TestBody>[1]

const PANE = {
  component: 'Pane',
  requestId: 'orchestrator',
  props: { title: 'Orchestrator', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

type World = { disk: Map<string, string>; panes: { id: string }[]; closed: string[] }

/** A coordinator at /w with an in-memory disk; the app's pane list and close answer from memory too. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), panes: [], closed: [] }
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 1_000) }))
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
  on('tool.list', () => ({ value: [] as never }))
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === 'Bash') return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
    return { result: 'ok', text: 'ok' } as never
  })
  on('ui.open', ($, e) => {
    if (!w.panes.some(p => p.id === e.id)) w.panes.push({ id: e.id })
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', () => ({ value: w.panes.map(p => ({ ...p, title: p.id, isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('ui.close', ($, e) => {
    w.closed.push(e.id)
    w.panes = w.panes.filter(p => p.id !== e.id)
    return { value: undefined } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

/** The person typing `/orchestrator:panel`. */
const toggle = ($: Engine) => $.command.run({ command: 'orchestrator:panel' } as never)
const flow = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__orchestrator__flow', ...input } as never)
const plan = ($: Engine) =>
  $.tool.call({
    tool: 'mcp__orchestrator__plan',
    change: 'demo',
    changePath: 'openspec/changes/demo',
    waves: [
      {
        phases: [
          { id: '1', title: 'API', status: 'running', gates: ['testes', 'lint'], tasks: '1.1' },
          { id: '2', title: 'Tela', status: 'pending', dependsOn: ['1'] },
        ],
      },
    ],
  } as never)

const TASKS = '## 1. Base\n- [ ] 1.1 Criar a API\n'

test('cards read in order: header, OpenSpec, Gates, Precisa de você, Tarefas', async ($, on) => {
  const w = world(on)
  w.disk.set('/w/openspec/changes/demo/tasks.md', TASKS)
  await plan($)
  await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  await toggle($)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestrator', surface, ...PANE })
    const cards = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('card:'))
    expect(cards).toEqual(['card:run', 'card:openspec', 'card:gates', 'card:attention', 'card:tasks', 'card:self'])
    // the owner's step is the current one, highlighted, and waits on the owner
    expect(await ui.find({ type: 'Text', text: /▶ ✋ Entendimento/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /esperando você/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /🤖 Planejar OpenSpec/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⚙ Validar OpenSpec/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⚙ automático \(um script decide\) · 🤖 sessão faz · ✋ você decide no painel/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /portões/i })).toHaveLength(0)
    // the phase in progress shows its tasks, ticked from tasks.md
    expect(await ui.find({ type: 'Text', text: /Criar a API/ })).toBeDefined()
    await ui.unmount()
  }
})

test('finished steps fold into one line, and the running loop lists each phase with its gates and the skip', async ($, on) => {
  const w = world(on)
  await plan($)
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await $.tool.call({ tool: 'Bash', command: 'openspec validate demo' } as never)
  expect(JSON.parse(w.disk.get('/h/.claude/orquestrador/flows/demo.json') ?? '{}').current).toBe('executar')
  // publishing the plan opened the pane: close it, then open it fresh
  expect((await toggle($)).text).toMatch(/fechado/)
  expect((await toggle($)).text).toMatch(/aberto/)

  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /✓ 2 concluídas/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Planejar OpenSpec/ })).toBeUndefined()
  await ui.press({ key: 'group:gates:done' })
  expect(await ui.find({ type: 'Text', text: /🤖 Planejar OpenSpec/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Plano escrito/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\d+ s$/ })).toBeDefined()
  await ui.press({ key: 'group:gates:done' })

  expect(await ui.find({ type: 'Text', text: /▶ 🤖 Executar fases/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /em andamento/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /testes ○ lint ○/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Tela$/ })).toBeDefined()
  await ui.press({ key: 'arm:1:lint' })
  expect(await ui.find({ key: 'skip:1:lint' })).toBeDefined()
  await ui.unmount()
})

test('a question to release a gate offers the skip itself; "Aceitar" never stands in for it', async ($, on) => {
  const w = world(on)
  await $.tool.call({
    tool: 'mcp__orchestrator__plan',
    change: 'demo',
    waves: [{ phases: [{ id: '1', title: 'API', status: 'running', gates: ['testes', 'lint'] }] }],
    ownerQuestions: [
      { question: 'Liberar o lint da fase 1?', recommendation: 'sim', gate: { phase: '1', gate: 'lint' } },
      { question: 'Pular os portões da fase 1?', recommendation: 'sim' },
      { question: 'Ligar a flag?', recommendation: 'sim' },
    ],
  } as never)
  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'accept:decision:0' })).toBeUndefined()
  expect(await ui.find({ key: 'accept:decision:1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Só o seu pulo libera um portão/ })).toBeDefined()
  expect(await ui.find({ key: 'accept:decision:2' })).toBeDefined()

  // two presses, as beside the gate itself
  const skips = '/h/.claude/orquestrador/gates/demo.json'
  await ui.press({ key: 'arm:1:lint:ask' })
  await ui.press({ key: 'skip:1:lint:ask' })
  for (let i = 0; i < 20 && !w.disk.has(skips); i++) await Promise.resolve()
  expect(Object.keys(JSON.parse(w.disk.get(skips) ?? '{}').skips ?? {})).toEqual(['1:lint'])
  await ui.unmount()
})

test('without a flow, the Gates card still lists the phases and their gates', async ($, on) => {
  world(on)
  await plan($)
  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'card:gates' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /testes ○ lint ○/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /você decide no painel/ })).toBeUndefined()
  await ui.unmount()
})

test('/orchestrator:panel opens the pane, and closes it when it is up', async ($, on) => {
  const w = world(on)
  expect((await toggle($)).text).toBe('Painel do Orchestrator aberto.')
  expect(w.panes.map(p => p.id)).toEqual(['orchestrator'])
  expect((await toggle($)).text).toBe('Painel do Orchestrator fechado.')
  expect(w.closed).toEqual(['orchestrator'])
})

test('the band shows only while this session orchestrates, and its button opens and closes the pane', async ($, on) => {
  const w = world(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestrator', surface, ...BAND })
    expect(await ui.find({ key: 'band:pane' })).toBeUndefined()
    await ui.unmount()
  }

  await plan($)
  await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  // publishing the plan opened the pane; the command closes it
  await toggle($)
  expect(w.panes).toEqual([])

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestrator', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /passo: Entendimento · 1 fase em voo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 pendência sua/ })).toBeDefined()
    expect((await ui.find({ key: 'band:pane' }))?.text).toBe('Abrir painel')
    await ui.press({ key: 'band:pane' })
    for (let i = 0; i < 20 && w.panes.length === 0; i++) await Promise.resolve()
    expect(w.panes.map(p => p.id)).toEqual(['orchestrator'])
    expect((await ui.find({ key: 'band:pane' }))?.text).toBe('Fechar painel')
    await ui.press({ key: 'band:pane' })
    for (let i = 0; i < 20 && w.panes.length > 0; i++) await Promise.resolve()
    expect(w.panes).toEqual([])
    await ui.unmount()
  }
})

describe('glance', () => {
  const event = (seq: number, kind: FlowEvent['kind'], step: string, at: number): FlowEvent => ({ seq, at, kind, step, by: 'mod' })

  test('step times come from the log; entering a step again starts its clock over', () => {
    const events = [
      event(1, 'started', 'rapido', 0),
      event(2, 'entered', 'planejar', 10),
      event(3, 'outcome', 'planejar', 70),
      event(4, 'entered', 'validar', 70),
      event(5, 'outcome', 'validar', 80),
      event(6, 'entered', 'planejar', 90),
    ]
    expect(stepTimes(events)).toEqual({ planejar: { from: 90 }, validar: { from: 70, to: 80 } })
    expect(parseEvents(`${JSON.stringify(events[1])}\n{ torn\n\n`)).toEqual([events[1]!])
  })

  test('elapsed reads like the app: seconds, minutes, hours', () => {
    expect([formatElapsed(40_000), formatElapsed(12 * 60_000), formatElapsed(125 * 60_000), formatElapsed(120 * 60_000)]).toEqual([
      '40 s',
      '12 min',
      '2 h 5 min',
      '2 h',
    ])
  })

  test('the band has nothing to say without a plan or a flow', () => {
    const view: PanelView = {
      self: undefined, children: [], run: undefined, updatedAt: 0, warning: undefined, repoUrl: undefined,
      openspec: undefined, jira: {}, jiraNote: undefined, skips: {},
    }
    expect(bandSummary(view, [])).toBeUndefined()
  })
})

const LONG = 'Grill com rodadas até o dono clicar Entendimento fechado; as respostas propostas viram critérios de aceite da change'

test('at a narrow width every text row may shrink, prose wraps, and status is a pill, not a border colour', async ($, on) => {
  const w = world(on)
  w.disk.set('/w/openspec/changes/demo/tasks.md', `## 1. Base\n- [ ] 1.1 ${LONG}\n`)
  await $.tool.call({
    tool: 'mcp__orchestrator__plan',
    change: 'demo-com-um-nome-bem-comprido-para-o-cabecalho',
    changePath: 'openspec/changes/demo',
    waves: [
      {
        summary: LONG,
        phases: [
          { id: '1', title: `Fase com título longo: ${LONG}`, status: 'running', summary: LONG, note: LONG, tasks: '1.1', gates: ['testes', 'lint', 'check', 'openspec'] },
          { id: '2', title: `Depois: ${LONG}`, status: 'pending', dependsOn: ['1'] },
        ],
      },
    ],
  } as never)
  const NARROW = { ...PANE, props: { ...PANE.props, bodyColumns: 36 } }

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestrator', surface, ...NARROW })
    // a Box that shrinks also gives up its content's minimum width, or its text spills past the border
    const boxes = await ui.findAll({ type: 'Box' })
    const stuck = boxes.filter(b => b.props.flexShrink === 1 && b.props.minWidth !== 0)
    expect(stuck.map(b => b.text.slice(0, 40))).toEqual([])
    // prose wraps, one-line labels truncate
    const summaries = await ui.findAll({ type: 'Text', text: new RegExp(`^${LONG}$`) })
    expect(summaries.length).toBeGreaterThan(0)
    expect(summaries.every(t => t.props.wrap === 'wrap')).toBe(true)
    const titles = await ui.findAll({ type: 'Text', text: /Fase com título longo/ })
    expect(titles.some(t => t.props.wrap === 'truncate-end' && t.props.bold === true)).toBe(true)
    // the phase card's border is neutral; its status sits in a tinted pill
    const pills = await ui.findAll({ type: 'Text', text: /^ em voo $/ })
    expect(pills.some(t => t.props.backgroundColor === '#FAECE7' && t.props.color === '#993C1D')).toBe(true)
    const bordered = boxes.filter(b => b.props.borderStyle === 'round' && /Fase com título longo/.test(b.text))
    expect(bordered.some(b => b.props.borderDimColor === true && b.props.borderColor === undefined)).toBe(true)
    expect(await ui.find({ type: 'Text', text: /após 1/ })).toBeDefined()
    await ui.unmount()
  }
})
