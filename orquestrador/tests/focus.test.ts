import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  component: 'Pane',
  requestId: 'orquestrador',
  props: { title: 'Orquestrador', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** A home folder in memory and no app tools: the pane draws from the published plan alone. */
const world = (on: On) => {
  const disk = new Map<string, string>()
  on('env.get', () => ({ value: '/h' }))
  on('clock.now', () => ({ value: 1_000 }))
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
  on('tool.call', () => ({ result: '', text: '' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return disk
}

const PLAN = {
  tool: 'mcp__orquestrador__plano',
  change: 'mods-orquestrador',
  waves: [
    { title: 'painel v1', phases: [{ id: '1.1', title: 'Painel', status: 'done', summary: 'Primeiro painel.' }] },
    {
      title: 'evolução',
      summary: 'Próximas camadas do painel.',
      phases: [
        { id: '2.1', title: 'Visão OpenSpec', status: 'done' },
        { id: '2.2', title: 'Portões', status: 'running', summary: 'A fase só fecha com os testes passando.' },
      ],
    },
    {
      title: 'validação',
      phases: [{ id: '3.1', title: 'Reiniciar e conferir', status: 'pending', dependsOn: ['2.2'], summary: 'Conferir no app.' }],
    },
  ],
}

test('the current wave leads with its phases in plain words; later and closed waves start folded', async ($, on) => {
  world(on)
  await $.tool.call(PLAN as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orquestrador', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /2 de 4 fases/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Agora · Onda 2 · evolução/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /A fase só fecha com os testes passando/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Próximas camadas do painel/ })).toBeDefined()

    // later and closed waves are one line each until pressed
    expect(await ui.find({ type: 'Text', text: /Reiniciar e conferir/ })).toBeUndefined()
    await ui.press({ key: 'group:wave:2' })
    expect(await ui.find({ type: 'Text', text: /Reiniciar e conferir/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /após 2\.2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Conferir no app/ })).toBeUndefined()
    await ui.press({ key: 'summary:2:3.1' })
    expect(await ui.find({ type: 'Text', text: /Conferir no app/ })).toBeDefined()

    // the closed waves sit folded in one card
    expect(await ui.find({ type: 'Text', text: /Onda 1 · painel v1/ })).toBeUndefined()
    await ui.press({ key: 'card:done' })
    await ui.press({ key: 'group:wave:0' })
    expect(await ui.find({ type: 'Text', text: /^Painel$/ })).toBeDefined()

    await ui.press({ key: 'summary:2:3.1' })
    await ui.press({ key: 'group:wave:2' })
    await ui.press({ key: 'group:wave:0' })
    await ui.press({ key: 'card:done' })
    await ui.unmount()
  }
})

test('the phase in progress lists the tasks.md items it delivers, ticked as they are done', async ($, on) => {
  const disk = world(on)
  disk.set('/w/openspec/changes/demo/tasks.md', '## 2. Evolução\n- [x] 2.1 Ler o tasks.md\n- [ ] 2.2 Mostrar na fase\n- [ ] 3.1 Outra fase\n')
  await $.tool.call({ ...PLAN, changePath: 'openspec/changes/demo', waves: PLAN.waves.map((wave, w) => (w === 1 ? { ...wave, phases: wave.phases.map(p => (p.id === '2.2' ? { ...p, tasks: '2.1–2.2' } : p)) } : wave)) } as never)

  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Tarefas$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 de 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Mostrar na fase/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Outra fase/ })).toBeUndefined()
  await ui.unmount()
})
