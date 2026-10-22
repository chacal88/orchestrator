import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState } from '../types'

/** The clone is activated, as the owner does from the panel: the mod works only where it is. */
const ACTIVE: [string, string] = ['/w/.claude/settings.local.json', JSON.stringify({ env: { ORQUESTRADOR: 'barrar' } })]

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }

const PANE = {
  component: 'Pane',
  requestId: 'orquestrador',
  props: { title: 'Orquestrador', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const STATE = '/h/.claude/orquestrador/flows/demo.json'
const LOG = '/h/.claude/orquestrador/flows/demo.ndjson'

/** A prompt the mod submitted, and whether it went as the person's own words. */
type Sent = { text: string; asUser: boolean }

/**
 * A coordinator at /w with an in-memory disk; Bash commands holding FAIL exit 1; toasts land in
 * `toasts` and the prompts the mod submits in `prompts`.
 */
const world = (on: On, toasts: string[] = [], prompts: Sent[] = []): Map<string, string> => {
  mock.store(on)
  const disk = new Map<string, string>([ACTIVE])
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
    if (input.tool === 'Bash') {
      return String(input.command).includes('FAIL')
        ? ({ isError: true, result: 'exit 1', text: 'Exit code 1' } as never)
        : ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never)
    }
    return { result: 'ok', text: 'ok' } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('prompt.submit', ($, e) => {
    const origin = e.origin as { kind: string; asUser?: true }
    prompts.push({ text: e.text, asUser: origin.kind === 'plugin' && origin.asUser === true })
    return { text: e.text } as never
  })
  return disk
}

const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orquestrador__flow', ...input } as never) as Promise<Reply>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Reply>
const saved = (disk: Map<string, string>) => JSON.parse(disk.get(STATE) ?? '{}') as FlowState

test('the coordinator starts a flow, reports session steps, and cannot skip or answer for others', async ($, on) => {
  const disk = world(on)
  expect(String((await flow($, { action: 'list' })).result)).toMatch(/^completo — Completo: grill → mockup → planejar/)

  const started = await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  expect(String(started.result)).toMatch(/step "planejar" \(Planejar OpenSpec\), attempt 1 of 3/)
  expect(saved(disk).current).toBe('planejar')

  const again = await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  expect([again.isError, String(again.result)]).toEqual([true, expect.stringMatching(/already runs flow rapido/)])

  const skip = await flow($, { action: 'report', step: 'executar', outcome: 'concluidas' })
  expect(skip.isError).toBe(true)
  expect(String(skip.result)).toMatch(/steps cannot be skipped/)

  const undeclared = await flow($, { action: 'report', step: 'planejar', outcome: 'feito' })
  expect(String(undeclared.result)).toMatch(/it declares pronto/)

  expect((await flow($, { action: 'report', step: 'planejar', outcome: 'pronto', note: 'proposta e tarefas' })).isError).toBeUndefined()
  expect(saved(disk).current).toBe('validar')

  const claimed = await flow($, { action: 'report', step: 'validar', outcome: 'passou' })
  expect(String(claimed.result)).toMatch(/only the mod, watching its command run/)
  expect(String((await flow($, { action: 'status' })).result)).toMatch(/Run `openspec validate` in this session/)

  const log = (disk.get(LOG) ?? '').trim().split('\n').map(line => JSON.parse(line) as { kind: string; step: string })
  expect(log.map(e => e.kind)).toEqual(['started', 'entered', 'refused', 'refused', 'outcome', 'entered', 'refused'])
})

test('an automatic step moves only when the mod sees its command finish', async ($, on) => {
  const disk = world(on)
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })

  await bash($, 'echo "openspec validate"')
  expect(saved(disk).current).toBe('validar')
  await bash($, 'npx openspec validate demo FAIL')
  expect([saved(disk).current, saved(disk).attempts.planejar]).toEqual(['planejar', 2])
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await bash($, 'npx openspec validate demo --strict')
  expect(saved(disk).current).toBe('executar')
  expect(saved(disk).records.validar).toEqual({ outcome: 'passou', by: 'automatic', at: expect.any(Number) })
})

test('the final check needs evidence.md recorded before its pass counts', async ($, on) => {
  const disk = world(on)
  await flow($, { action: 'start', change: 'demo', flow: 'rapido', changePath: 'openspec/changes/demo' })
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await bash($, 'openspec validate demo')
  disk.set('/w/openspec/changes/demo/tasks.md', '## 1. Tudo\n\n- [x] 1.1 Feito\n')
  await flow($, { action: 'close', phase: '1' })
  await flow($, { action: 'report', step: 'revisao-codigo', outcome: 'aprovado' })
  await bash($, 'sh scripts/check.sh')
  expect(saved(disk).current).toBe('checagem')
  disk.set('/w/openspec/changes/demo/evidence.md', '# Evidence\n\n## Testes\n\n```\n83 pass\n0 fail\n```\n')
  await bash($, 'sh scripts/check.sh')
  expect(saved(disk).current).toBe('pr')
})

test("an owner step moves only on the owner's press in the panel", async ($, on) => {
  const disk = world(on)
  await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  const forged = await flow($, { action: 'report', step: 'grill', outcome: 'fechado' })
  expect(String(forged.result)).toMatch(/only the owner, pressing a button in the panel/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'orquestrador', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Entendimento/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  await ui.press({ key: 'flow:grill:fechado' })
  await ui.unmount()
  expect(saved(disk).current).toBe('planejar')
  expect(saved(disk).records.grill?.by).toBe('owner')
})

test('an owner press shows a toast naming the answer recorded and the next step', async ($, on) => {
  const toasts: string[] = []
  const disk = world(on, toasts)
  disk.set(
    '/w/.orquestrador/flows/rapido.json',
    JSON.stringify({
      id: 'rapido',
      title: 'Rápido da casa',
      steps: [
        { id: 'qa', title: 'Conferência do dono', kind: 'owner', outcomes: { aprovado: { label: 'Instalei e funciona', next: 'lancar' } } },
        { id: 'lancar', title: 'Lançar a versão', kind: 'owner', outcomes: { lancado: { label: 'Lancei', next: 'fim' } } },
      ],
    }),
  )
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  await ui.press({ key: 'flow:qa:aprovado' })
  expect(toasts).toEqual(['Registrado: Instalei e funciona. Próximo passo: Lançar a versão.'])
  await ui.press({ key: 'flow:lancar:lancado' })
  await ui.unmount()
  expect(toasts.at(-1)).toBe('Registrado: Lancei. Flow concluído.')
  expect(saved(disk).status).toBe('done')
})

const press = async ($: Engine, key: string) => {
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  await ui.press({ key })
  await ui.unmount()
}

test('an owner press that lands on a step the coordinator drives wakes it with one message in the mod\'s name', async ($, on) => {
  const toasts: string[] = []
  const prompts: Sent[] = []
  const disk = world(on, toasts, prompts)
  await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  await press($, 'flow:grill:fechado')
  expect(saved(disk).current).toBe('planejar')
  expect(toasts).toEqual(['Registrado: Entendimento fechado. Próximo passo: Planejar OpenSpec.'])
  expect(prompts).toEqual([
    {
      text: 'Painel: o dono apertou "Entendimento fechado". Próximo passo: planejar (Planejar OpenSpec). Siga o flow.',
      asUser: false,
    },
  ])
})

test('a press that lands on another owner step or ends the flow sends no message', async ($, on) => {
  const prompts: Sent[] = []
  const disk = world(on, [], prompts)
  disk.set(
    '/w/.orquestrador/flows/rapido.json',
    JSON.stringify({
      id: 'rapido',
      title: 'Rápido da casa',
      steps: [
        { id: 'qa', title: 'Conferência do dono', kind: 'owner', outcomes: { aprovado: { label: 'Instalei e funciona', next: 'lancar' } } },
        { id: 'lancar', title: 'Lançar a versão', kind: 'owner', outcomes: { lancado: { label: 'Lancei', next: 'fim' } } },
      ],
    }),
  )
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  await press($, 'flow:qa:aprovado')
  expect(saved(disk).current).toBe('lancar')
  await press($, 'flow:lancar:lancado')
  expect(saved(disk).status).toBe('done')
  expect(prompts).toEqual([])
})

test('an escalation retried on a session step wakes the coordinator; ended, it sends nothing', async ($, on) => {
  const prompts: Sent[] = []
  const disk = world(on, [], prompts)
  disk.set(
    '/w/.orquestrador/flows/rapido.json',
    JSON.stringify({
      id: 'rapido',
      title: 'Rápido da casa',
      steps: [
        {
          id: 'fazer',
          title: 'Fazer',
          kind: 'session',
          maxAttempts: 1,
          outcomes: { feito: { label: 'Feito', next: 'fim' }, refazer: { label: 'Refazer', next: 'fazer' } },
        },
      ],
    }),
  )
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  await flow($, { action: 'report', step: 'fazer', outcome: 'refazer' })
  expect(saved(disk).status).toBe('escalated')
  await press($, 'flow:fazer:tentar-de-novo')
  expect(saved(disk).status).toBe('running')
  expect(prompts).toEqual([
    { text: 'Painel: o dono apertou "Tentar de novo". Próximo passo: fazer (Fazer). Siga o flow.', asUser: false },
  ])
  await flow($, { action: 'report', step: 'fazer', outcome: 'refazer' })
  await press($, 'flow:fazer:encerrar')
  expect(saved(disk).status).toBe('aborted')
  expect(prompts).toHaveLength(1)
})

test('a press the flow refuses sends no message and still says why', async ($, on) => {
  const toasts: string[] = []
  const prompts: Sent[] = []
  const disk = world(on, toasts, prompts)
  await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  disk.set(STATE, JSON.stringify({ ...saved(disk), current: 'planejar' }))
  await ui.press({ key: 'flow:grill:fechado' })
  await ui.unmount()
  expect(saved(disk).current).toBe('planejar')
  expect(toasts).toEqual(['Não consegui registrar: the flow of demo is on "planejar" (Planejar OpenSpec), not on "grill". "planejar" is answered by a session (through the flow tool).'])
  expect(prompts).toEqual([])
})

test('the flow files are the mod\'s alone, and a project flow overrides a default', async ($, on) => {
  const disk = world(on)
  const write = (await $.tool.call({ tool: 'Write', file_path: STATE, content: '{}' } as never)) as Reply
  expect(write.deny).toMatch(/written by the mod only/)

  disk.set(
    '/w/.orquestrador/flows/rapido.json',
    JSON.stringify({ id: 'rapido', title: 'Rápido da casa', steps: [{ id: 'fazer', title: 'Fazer', kind: 'session', outcomes: { feito: { label: 'Feito', next: 'fim' } } }] }),
  )
  disk.set('/w/.orquestrador/flows/quebrado.json', '{ not json')
  const listed = String((await flow($, { action: 'list' })).result)
  expect(listed).toMatch(/rapido — Rápido da casa: fazer → fim/)
  expect(listed).toMatch(/ignored: \/w\/\.orquestrador\/flows\/quebrado\.json: not valid JSON/)

  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const done = await flow($, { action: 'report', step: 'fazer', outcome: 'feito' })
  expect(String(done.result)).toMatch(/finished/)
  expect(saved(disk).status).toBe('done')
})

test('a derived project flow is resolved on load, and one that does not resolve is named', async ($, on) => {
  const disk = world(on)
  disk.set(
    '/w/.orquestrador/flows/trunk.json',
    JSON.stringify({ id: 'trunk', title: 'Trunk', base: 'rapido', remove: ['qa'], add: [{ after: 'pr', step: 'revisao-pr' }] }),
  )
  disk.set('/w/.orquestrador/flows/ruim.json', JSON.stringify({ id: 'ruim', title: 'Ruim', base: 'nenhum' }))
  const listed = String((await flow($, { action: 'list' })).result)
  expect(listed).toMatch(/trunk — Trunk: planejar → validar → executar → revisao-codigo → checagem → pr → revisao-pr → producao → arquivar/)
  expect(listed).toMatch(/ignored: \/w\/\.orquestrador\/flows\/ruim\.json: base "nenhum" is no flow of the mod or of the project/)
})
