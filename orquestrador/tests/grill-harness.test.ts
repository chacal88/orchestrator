import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState, PrepState } from '../types'

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }

const PANE = {
  component: 'Pane',
  requestId: 'orquestrador',
  props: { title: 'Orquestrador', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const STATE = '/h/.claude/orquestrador/flows/demo.json'
const LOG = '/h/.claude/orquestrador/flows/demo.ndjson'
const PREP = '/h/.claude/orquestrador/prep/demo.json'
const GRILL_MD = '/w/openspec/changes/demo/grill.md'

/** How the app's plan dialog answers the next ExitPlanMode. */
type Dialog = { answer: 'approve' | 'refuse'; words?: string }

/** What reached the person: the toasts and the prompts the mod submitted. */
type Sink = { toasts: string[]; prompts: { text: string; asUser: boolean }[] }

/** A coordinator at /w with an in-memory disk, and a plan dialog the test answers. */
const world = (on: On, dialog: Dialog, sink: Sink = { toasts: [], prompts: [] }): Map<string, string> => {
  mock.store(on)
  const disk = new Map<string, string>()
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 10) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('fs.exists', ($, e) => ({ value: disk.has(e.path) || [...disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.read', ($, e) => ({ value: disk.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: [...disk.keys()]
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
  }))
  on('tool.list', () => ({ value: [] as never }))
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === 'ExitPlanMode') {
      return dialog.answer === 'approve'
        ? ({ ref: 7, result: { plan: '## Plano de execução\n- fase 1', isAgent: false }, text: 'User has approved your plan.' } as never)
        : ({ isError: true, ref: 7, result: dialog.words, text: dialog.words } as never)
    }
    if (input.tool === 'Bash') return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
    return { result: 'ok', text: 'ok' } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', ($, e) => {
    sink.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('prompt.submit', ($, e) => {
    const origin = e.origin as { kind: string; asUser?: true }
    sink.prompts.push({ text: e.text, asUser: origin.kind === 'plugin' && origin.asUser === true })
    return { text: e.text } as never
  })
  return disk
}

const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orquestrador__flow', ...input } as never) as Promise<Reply>
const saved = (disk: Map<string, string>) => JSON.parse(disk.get(STATE) ?? '{}') as FlowState
const prep = (disk: Map<string, string>) => JSON.parse(disk.get(PREP) ?? '{}') as PrepState
const logKinds = (disk: Map<string, string>) =>
  (disk.get(LOG) ?? '').trim().split('\n').map(line => (JSON.parse(line) as { kind: string }).kind)

const press = async ($: Engine, key: string) => {
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  await ui.press({ key })
  await ui.unmount()
}

test('grill rounds go to grill.md and the panel, and only the owner closes the understanding', async ($, on) => {
  const disk = world(on, { answer: 'approve' })
  await flow($, { action: 'start', change: 'demo', flow: 'completo', changePath: 'openspec/changes/demo' })

  const round = await flow($, {
    action: 'round',
    questions: [{ question: 'Quem aprova?', answer: 'Só o dono', criterion: 'Só o dono libera a execução' }, { question: 'Tem mobile?' }],
  })
  expect(String(round.result)).toMatch(/Grill: 1 round\(s\) recorded, 1 open question\(s\), 1 acceptance criteria/)
  expect(disk.get(GRILL_MD)).toMatch(/- \[ \] Só o dono libera a execução/)
  expect(logKinds(disk)).toContain('round')

  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'orquestrador', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /1 rodada · 1 critério de aceite/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Tem mobile\?/ })).toBeDefined()
    await ui.unmount()
  }

  const wrong = await flow($, { action: 'mockup', artifact: 'https://claude.ai/artifact/m' })
  expect(String(wrong.result)).toMatch(/refused: a mockup is attached only while the flow of demo is on "mockup"/)
  expect(String((await flow($, { action: 'report', step: 'grill', outcome: 'fechado' })).result)).toMatch(/only the owner/)

  await press($, 'flow:grill:fechado')
  expect(saved(disk).current).toBe('planejar')
  const late = await flow($, { action: 'round', questions: ['Mais uma?'] })
  expect(late.isError).toBe(true)
})

test("the mockup: attached, adjusted with the owner's note typed in the panel, then approved", async ($, on) => {
  const disk = world(on, { answer: 'approve' })
  await flow($, { action: 'start', change: 'demo', flow: 'completo', visual: true })
  await press($, 'flow:grill:fechado')
  expect(saved(disk).current).toBe('mockup')

  let ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Aguardando a coordenação anexar o mockup/ })).toBeDefined()
  expect(await ui.find({ key: 'flow:mockup:aprovado' })).toBeUndefined()
  await ui.unmount()

  await flow($, { action: 'mockup', artifact: 'https://claude.ai/artifact/m1' })
  ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Link', text: /Abrir mockup/ })).toBeDefined()
  expect(await ui.find({ key: 'flow:mockup:aprovado' })).toBeDefined()
  await ui.input({ key: 'flow-note:mockup:ajustes', text: 'botão de salvar maior' } as never)
  await ui.unmount()

  expect(saved(disk).current).toBe('mockup')
  expect(saved(disk).attempts.mockup).toBe(2)
  expect(prep(disk).adjustments).toEqual([
    { note: 'botão de salvar maior', at: expect.any(Number), artifact: 'https://claude.ai/artifact/m1' },
  ])
  expect(String((await flow($, { action: 'status' })).result)).toMatch(/last adjustment: "botão de salvar maior"/)

  await flow($, { action: 'mockup', artifact: 'https://claude.ai/artifact/m2' })
  await press($, 'flow:mockup:aprovado')
  expect(saved(disk).current).toBe('planejar')
  expect(saved(disk).records.mockup).toMatchObject({ outcome: 'aprovado', by: 'owner' })
})

const toRelease = async ($: Engine) => {
  await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  await press($, 'flow:grill:fechado')
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await $.tool.call({ tool: 'Bash', command: 'openspec validate demo' } as never)
  await flow($, { action: 'report', step: 'revisao-plano', outcome: 'aprovado' })
}

test("the release comes only from the owner approving ExitPlanMode in the app's dialog", async ($, on) => {
  const dialog: Dialog = { answer: 'refuse', words: "The user doesn't want to proceed. The user said: falta a fase de QA" }
  const disk = world(on, dialog)
  await toRelease($)
  expect(saved(disk).current).toBe('liberacao')

  const forged = await flow($, { action: 'report', step: 'liberacao', outcome: 'liberado' })
  expect(String(forged.result)).toMatch(/only the owner/)
  let ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'flow:liberacao:liberado' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /diálogo do plan mode/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(saved(disk).current).toBe('liberacao')
  expect(prep(disk).planRejections[0]?.feedback).toMatch(/falta a fase de QA/)
  expect(logKinds(disk)).toContain('plan-rejected')
  expect(String((await flow($, { action: 'status' })).result)).toMatch(/The owner refused the last plan: ".*falta a fase de QA"/)
  ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Você recusou o último plano/ })).toBeDefined()
  await ui.unmount()

  dialog.answer = 'approve'
  await $.tool.call({ tool: 'ExitPlanMode', agentId: 'sub-1' } as never)
  expect(saved(disk).current).toBe('liberacao')

  await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(saved(disk).current).toBe('executar')
  expect(saved(disk).records.liberacao).toMatchObject({ outcome: 'liberado', by: 'owner', note: 'aprovado no plan mode' })
  expect(prep(disk).release?.plan).toMatch(/Plano de execução/)
})

test('a plan approved while the flow is elsewhere moves nothing', async ($, on) => {
  const disk = world(on, { answer: 'approve' })
  await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(saved(disk).current).toBe('grill')
  expect(disk.has(PREP)).toBe(false)
})

const mount = <S extends 'desktop' | 'terminal' | 'mobile'>($: Engine, surface: S) =>
  $.ui.mount({ plugin: 'orquestrador', surface, ...PANE })

const openRound = async ($: Engine) => {
  await flow($, { action: 'start', change: 'demo', flow: 'completo', changePath: 'openspec/changes/demo' })
  await flow($, {
    action: 'round',
    questions: [{ question: 'Quem aprova?', answer: 'Só o dono' }, { question: 'Tem mobile?' }, { question: 'E o Jira?' }],
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`grill answers typed in the panel fill the round and reach the coordinator as the owner's words (${surface})`, async ($, on) => {
    const sink: Sink = { toasts: [], prompts: [] }
    const disk = world(on, { answer: 'approve' }, sink)
    await openRound($)

    const ui = await mount($, surface)
    expect(await ui.find({ key: 'grill-answer:1' })).toBeUndefined()
    expect(await ui.find({ key: 'grill-answer:2' })).toBeDefined()
    expect(await ui.find({ key: 'grill-send:3' })).toBeDefined()
    expect(await ui.find({ key: 'grill-send-all' })).toBeUndefined()

    await ui.input({ key: 'grill-answer:2', text: 'Não, só desktop', kind: 'change' } as never)
    expect(await ui.find({ key: 'grill-send-all' })).toBeUndefined()
    await ui.input({ key: 'grill-answer:3', text: 'Fica para depois', kind: 'change' } as never)
    expect(await ui.find({ key: 'grill-send-all' })).toBeDefined()
    await ui.press({ key: 'grill-send-all' })

    const items = prep(disk).rounds[0]!.items
    expect(prep(disk).rounds.length).toBe(1)
    expect(items.map(i => i.answer)).toEqual(['Só o dono', 'Não, só desktop', 'Fica para depois'])
    expect(disk.get(GRILL_MD)).toMatch(/- \[ \] Não, só desktop/)
    expect(disk.get(GRILL_MD)).toMatch(/- \[ \] Fica para depois/)
    const last = JSON.parse((disk.get(LOG) ?? '').trim().split('\n').pop()!) as { kind: string; by: string }
    expect(last).toMatchObject({ kind: 'round', by: 'owner' })
    expect(sink.prompts).toEqual([
      { text: 'Resposta à pergunta 2: Não, só desktop\nResposta à pergunta 3: Fica para depois', asUser: true },
    ])
    expect(await ui.find({ key: 'grill-answer:2' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Perguntas em aberto/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('one grill answer goes by Enter or by "Responder"; an empty one is refused', async ($, on) => {
  const sink: Sink = { toasts: [], prompts: [] }
  const disk = world(on, { answer: 'approve' }, sink)
  await openRound($)
  const ui = await mount($, 'desktop')

  await ui.press({ key: 'grill-send:2' })
  expect(sink.toasts).toEqual(['Escreva a resposta antes de enviar.'])
  await ui.input({ key: 'grill-answer:2', text: '   ' } as never)
  expect(sink.toasts.length).toBe(2)
  expect(sink.prompts).toEqual([])
  expect(prep(disk).rounds[0]!.items[1]!.answer).toBeUndefined()

  await ui.input({ key: 'grill-answer:2', text: 'Não' } as never)
  expect(sink.prompts).toEqual([{ text: 'Resposta à pergunta 2: Não', asUser: true }])
  expect(prep(disk).rounds[0]!.items[1]!.answer).toBe('Não')

  await ui.input({ key: 'grill-answer:3', text: 'Depois', kind: 'change' } as never)
  await ui.press({ key: 'grill-send:3' })
  expect(sink.prompts[1]).toEqual({ text: 'Resposta à pergunta 3: Depois', asUser: true })
  expect(prep(disk).rounds[0]!.items.every(i => i.answer !== undefined)).toBe(true)
  expect(String((await flow($, { action: 'status' })).result)).toMatch(/0 open question\(s\), 3 acceptance criteria/)
  await ui.unmount()
})

test('without a text field (mobile) the open questions say to answer in the chat', async ($, on) => {
  world(on, { answer: 'approve' })
  await openRound($)
  const ui = await mount($, 'mobile')
  expect(await ui.find({ type: 'Text', text: /2\. Tem mobile\?/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Responda no chat/ })).toBeDefined()
  expect(await ui.find({ key: 'grill-send:2' })).toBeUndefined()
  await ui.unmount()
})
