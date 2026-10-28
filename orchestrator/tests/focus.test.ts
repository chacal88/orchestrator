import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  component: 'Pane',
  requestId: 'orchestrator',
  props: { title: 'Orchestrator', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
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
  tool: 'mcp__orchestrator__plan',
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

test('Tarefas leads with the phase in progress; pending phases are one line each, closed ones fold into one line', async ($, on) => {
  world(on)
  await $.tool.call(PLAN as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestrator', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /2 de 4 fases/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Agora: Onda 2 · evolução/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /A fase só fecha com os testes passando/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Próximas camadas do painel/ })).toBeDefined()
    // the separate Agora / Depois / Concluído cards are gone
    expect(await ui.find({ key: 'card:now' })).toBeUndefined()
    expect(await ui.find({ key: 'card:later' })).toBeUndefined()
    expect(await ui.find({ key: 'card:done' })).toBeUndefined()

    // a pending phase is one line; pressing it opens what it is
    expect(await ui.find({ type: 'Text', text: /Reiniciar e conferir/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /após 2\.2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Conferir no app/ })).toBeUndefined()
    await ui.press({ key: 'summary:2:3.1' })
    expect(await ui.find({ type: 'Text', text: /Conferir no app/ })).toBeDefined()

    // closed phases sit folded in one line
    expect(await ui.find({ type: 'Text', text: /✓ 2 concluídas/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Painel$/ })).toBeUndefined()
    await ui.press({ key: 'group:tasks:done' })
    expect(await ui.find({ type: 'Text', text: /^Painel$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Visão OpenSpec$/ })).toBeDefined()

    await ui.press({ key: 'summary:2:3.1' })
    await ui.press({ key: 'group:tasks:done' })
    await ui.unmount()
  }
})

test('the phase in progress lists the tasks.md items it delivers, ticked as they are done', async ($, on) => {
  const disk = world(on)
  disk.set('/w/openspec/changes/demo/tasks.md', '## 2. Evolução\n- [x] 2.1 Ler o tasks.md\n- [ ] 2.2 Mostrar na fase\n- [ ] 3.1 Outra fase\n')
  await $.tool.call({ ...PLAN, changePath: 'openspec/changes/demo', waves: PLAN.waves.map((wave, w) => (w === 1 ? { ...wave, phases: wave.phases.map(p => (p.id === '2.2' ? { ...p, tasks: '2.1–2.2' } : p)) } : wave)) } as never)

  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^tasks\.md$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 de 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Mostrar na fase/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Outra fase/ })).toBeUndefined()
  await ui.unmount()
})
