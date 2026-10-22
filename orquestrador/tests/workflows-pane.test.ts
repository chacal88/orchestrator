import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState } from '../types'
import { parseFlow, resolveFlow } from '../hooks/flow'
import { DEFAULT_FLOWS } from '../hooks/flows/index'
import { draftFile, draftOf } from '../hooks/workflow-edit'

type On = Parameters<TestBody>[1]
type Surface = 'desktop' | 'terminal' | 'mobile'

const DIR = '/w/.orquestrador/flows'

type World = { disk: Map<string, string>; panes: { id: string; title: string }[]; toasts: string[] }

/** A coordinator at /w with an in-memory disk, the app's panes answered from memory and the plugin's agents present. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), panes: [], toasts: [] }
  const plugin = ['planejador', 'executor', 'revisor-codigo', 'abre-pr', 'merge', 'deploy']
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 1_000) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('fs.exists', ($, e) => ({
    value:
      w.disk.has(e.path) ||
      [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) ||
      (!e.path.startsWith('/w/') && plugin.some(name => e.path.endsWith(`/agents/${name}.md`))),
  }))
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
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('ui.open', ($, e) => {
    if (!w.panes.some(p => p.id === e.id)) w.panes.push({ id: e.id, title: e.title ?? '' })
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', () => ({ value: w.panes.map(p => ({ ...p, isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('ui.close', ($, e) => {
    w.panes = w.panes.filter(p => p.id !== e.id)
    return { value: undefined } as never
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined } as never
  })
  return w
}

const pane = (columns = 60) =>
  ({
    component: 'Pane',
    requestId: 'orquestrador-workflows',
    props: { title: '⚙️ Workflows', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} },
  }) as const

const mount = <S extends Surface = 'desktop'>($: Engine, surface: S = 'desktop' as S, columns = 60) =>
  $.ui.mount({ plugin: 'orquestrador', surface, ...pane(columns) })
const text = (pattern: RegExp) => ({ type: 'Text', text: pattern }) as const
const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orquestrador__flow', ...input } as never) as Promise<{ result?: unknown; isError?: boolean }>
const file = (w: World, id: string) => JSON.parse(w.disk.get(`${DIR}/${id}.json`) ?? 'null') as Record<string, unknown> | null

const TRUNK = {
  id: 'trunk',
  title: 'Trunk',
  description: 'PR direto na main.',
  base: 'rapido',
  remove: ['qa'],
  add: [
    { after: 'pr', step: 'revisao-pr' },
    { after: 'revisao-pr', step: { use: 'merge', merge: { branch: 'main', auto: true } } },
    { after: 'merge', step: { use: 'deploy', deploy: { ci: true, commands: ['npm run migrate'], auto: false } } },
  ],
}

test('4.1 /orquestrador-workflows opens and closes its own pane, beside the 🧭 one', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'orquestrador' } as never)
  const opened = await $.command.run({ command: 'orquestrador-workflows' } as never)
  expect(String((opened as { text?: string }).text)).toMatch(/Painel de workflows aberto/)
  expect(w.panes).toEqual([
    { id: 'orquestrador', title: '🧭 Orquestrador' },
    { id: 'orquestrador-workflows', title: '⚙️ Workflows' },
  ])
  const ui = await mount($)
  expect(await ui.find(text(/Workflows disponíveis/))).toBeDefined()
  await ui.unmount()

  const closed = await $.command.run({ command: 'orquestrador-workflows' } as never)
  expect(String((closed as { text?: string }).text)).toMatch(/Painel de workflows fechado/)
  expect(w.panes.map(p => p.id)).toEqual(['orquestrador'])
})

test('4.2 the list shows each workflow with its origin and the files in error; a workflow opens step by step', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  w.disk.set(`${DIR}/quebrado.json`, '{ not json')
  w.disk.set(`${DIR}/orfao.json`, JSON.stringify({ id: 'orfao', base: 'rapido', remove: ['nao-existe'] }))

  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const ui = await mount($, surface, 30)
    expect(await ui.find(text(/completo · padrão/))).toBeDefined()
    expect(await ui.find(text(/rapido · padrão/))).toBeDefined()
    expect(await ui.find(text(/trunk · derivado de rapido/))).toBeDefined()
    expect(await ui.find(text(/PR direto na main/))).toBeDefined()
    expect(await ui.find(text(/Arquivos com erro/))).toBeDefined()
    expect(await ui.find(text(/quebrado\.json: not valid JSON/))).toBeDefined()
    expect(await ui.find(text(/orfao\.json: `remove`: "nao-existe"/))).toBeDefined()
    await ui.unmount()
  }

  const ui = await mount($, 'terminal', 30)
  await ui.press({ key: 'wf-open:trunk' })
  expect(await ui.find(text(/trunk · derivado de rapido/))).toBeDefined()
  const rows = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('wf-step:'))
  expect(rows).toEqual(
    ['planejar', 'validar', 'executar', 'revisao-codigo', 'checagem', 'pr', 'revisao-pr', 'merge', 'deploy', 'producao', 'arquivar'].map(
      id => `wf-step:${id}`,
    ),
  )
  expect(await ui.find(text(/🤖 sessão · agente planejador \(do plugin\)/))).toBeDefined()
  expect(await ui.find(text(/✋ dono$/))).toBeDefined()

  await ui.press({ key: 'wf-step:planejar' })
  expect(await ui.find(text(/^Entrada: /))).toBeDefined()
  expect(await ui.find(text(/^Saída: /))).toBeDefined()
  expect(await ui.find(text(/^Bloqueia: /))).toBeDefined()
  expect(await ui.find(text(/Exige evidência: não/))).toBeDefined()

  await ui.press({ key: 'wf-step:merge' })
  expect(await ui.find(text(/Merge: branch main · método squash · automático: sim/))).toBeDefined()
  expect(await ui.find(text(/Comando: gh pr merge/))).toBeDefined()
  expect(await ui.find(text(/Agente: agente merge \(do plugin\)/))).toBeDefined()

  await ui.press({ key: 'wf-step:deploy' })
  expect(await ui.find(text(/Deploy: CI sim · rotinas: npm run migrate · automático: não/))).toBeDefined()
  // viewing never edits: no field, no save
  expect(await ui.find({ key: 'wf-save' })).toBeUndefined()
  expect(await ui.find({ key: 'wf-toggle:deploy' })).toBeUndefined()
  await ui.press({ key: 'wf-back' })
  expect(await ui.find(text(/Workflows disponíveis/))).toBeDefined()
  await ui.unmount()
})

test('4.3 edits stay a draft in the mod until Salvar or Descartar', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  expect(await ui.find(text(/Editando rapido/))).toBeDefined()

  // switch a step off and on, move one, set its agent, model and effort
  await ui.press({ key: 'wf-step:qa' })
  await ui.press({ key: 'wf-toggle:qa' })
  expect(await ui.find(text(/^desligado · ✋ dono/))).toBeDefined()
  await ui.press({ key: 'wf-toggle:qa' })
  await ui.press({ key: 'wf-step:checagem' })
  await ui.press({ key: 'wf-up:checagem' })
  await ui.press({ key: 'wf-step:pr' })
  await ui.select({ key: 'wf-model:pr', value: 'claude-sonnet-5-5' })
  await ui.select({ key: 'wf-effort:pr', value: 'low' })
  await ui.input({ key: 'wf-agent:pr', text: 'abre-pr-rapido' })
  expect(await ui.find(text(/🤖 sessão · agente abre-pr-rapido \(sem arquivo\) · claude-sonnet-5-5 · esforço low/))).toBeDefined()

  // from the library, after the open step: the PR review, a merge, a deploy
  await ui.select({ key: 'wf-add-library', value: 'revisao-pr' })
  await ui.press({ key: 'wf-step:revisao-pr' })
  await ui.select({ key: 'wf-add-library', value: 'merge' })
  await ui.press({ key: 'wf-step:merge' })
  await ui.input({ key: 'wf-merge-branch:merge', text: 'dev' })
  await ui.select({ key: 'wf-merge-method:merge', value: 'rebase' })
  await ui.press({ key: 'wf-merge-auto:merge' })
  expect(await ui.find(text(/Merge: branch dev · método rebase · automático: sim/))).toBeDefined()
  expect(await ui.find(text(/⚙ mod \(comando\) · agente merge/))).toBeDefined()
  await ui.select({ key: 'wf-add-library', value: 'deploy' })
  await ui.press({ key: 'wf-step:deploy' })
  await ui.press({ key: 'wf-deploy-ci:deploy' })
  await ui.input({ key: 'wf-deploy-commands:deploy', text: 'npm run migrate\nnpm run warm' })
  await ui.press({ key: 'wf-deploy-auto:deploy' })
  expect(await ui.find(text(/Deploy: CI não · rotinas: npm run migrate ; npm run warm · automático: sim/))).toBeDefined()

  // a new step of its own, with title, who answers and agent
  await ui.input({ key: 'wf-step-title', text: 'Revisão de segurança' })
  await ui.select({ key: 'wf-step-kind', value: 'session' })
  await ui.input({ key: 'wf-step-agent', text: 'seguranca' })
  await ui.press({ key: 'wf-add-new' })

  const rows = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('wf-step:'))
  expect(rows).toEqual(
    ['planejar', 'validar', 'executar', 'checagem', 'revisao-codigo', 'pr', 'revisao-pr', 'merge', 'deploy', 'revisao-de-seguranca', 'qa', 'producao', 'arquivar'].map(
      id => `wf-step:${id}`,
    ),
  )
  expect(await ui.find(text(/🤖 sessão · agente seguranca \(sem arquivo\)/))).toBeDefined()
  // nothing reached the disk
  expect([...w.disk.keys()].filter(k => k.startsWith(DIR))).toEqual([])

  // the draft outlives the pane being drawn again
  await ui.unmount()
  const again = await mount($)
  expect(await again.find({ key: 'wf-step:revisao-de-seguranca' })).toBeDefined()
  await again.press({ key: 'wf-discard' })
  expect(await again.find(text(/rapido · padrão/))).toBeDefined()
  expect([...w.disk.keys()].filter(k => k.startsWith(DIR))).toEqual([])
  await again.unmount()
})

test('4.4 saving a derived workflow writes the derived form, and the mod loads it as drawn', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  await ui.input({ key: 'wf-new-id', text: 'trunk' })
  await ui.select({ key: 'wf-new-base', value: 'rapido' })
  await ui.press({ key: 'wf-new' })
  expect(await ui.find(text(/Derivado de rapido/))).toBeDefined()
  await ui.input({ key: 'wf-title', text: 'Trunk' })
  await ui.press({ key: 'wf-step:qa' })
  await ui.press({ key: 'wf-toggle:qa' })
  await ui.press({ key: 'wf-step:pr' })
  await ui.select({ key: 'wf-add-library', value: 'revisao-pr' })
  await ui.press({ key: 'wf-step:revisao-pr' })
  await ui.select({ key: 'wf-add-library', value: 'merge' })
  await ui.press({ key: 'wf-step:merge' })
  await ui.press({ key: 'wf-merge-auto:merge' })
  await ui.press({ key: 'wf-step:checagem' })
  await ui.press({ key: 'wf-up:checagem' })
  await ui.press({ key: 'wf-step:planejar' })
  await ui.select({ key: 'wf-model:planejar', value: 'claude-sonnet-5-5' })
  await ui.press({ key: 'wf-save' })

  expect(file(w, 'trunk')).toEqual({
    id: 'trunk',
    title: 'Trunk',
    description: expect.any(String),
    base: 'rapido',
    remove: ['qa'],
    add: [
      { after: 'pr', step: { use: 'revisao-pr' } },
      { after: 'revisao-pr', step: { use: 'merge', merge: { branch: 'main', method: 'squash', auto: true } } },
    ],
    override: {
      planejar: { model: 'claude-sonnet-5-5' },
      executar: { outcomes: { concluidas: { next: 'checagem' } } },
      checagem: { outcomes: { passou: { next: 'revisao-codigo' } } },
      'revisao-codigo': { outcomes: { aprovado: { next: 'pr' } } },
    },
    order: ['planejar', 'validar', 'executar', 'checagem', 'revisao-codigo', 'pr', 'revisao-pr', 'merge', 'producao', 'arquivar'],
  })
  expect(await ui.find(text(/Salvo em \.orquestrador\/flows\/trunk\.json/))).toBeDefined()
  expect(await ui.find(text(/trunk · derivado de rapido/))).toBeDefined()
  await ui.unmount()

  const list = String((await flow($, { action: 'list' })).result)
  expect(list).toMatch(/trunk — Trunk: planejar → validar → executar → checagem → revisao-codigo → pr → revisao-pr → merge → producao → arquivar → fim/)
  expect(list).not.toMatch(/ignored/)
})

test('4.4 a draft that does not resolve shows the error and writes nothing', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  await ui.press({ key: 'wf-step:executar' })
  await ui.press({ key: 'wf-toggle:executar' })
  await ui.press({ key: 'wf-save' })
  expect(await ui.find(text(/Não salvei: .*"executar" runs the change's phases; it cannot be removed/))).toBeDefined()
  expect([...w.disk.keys()].filter(k => k.startsWith(DIR))).toEqual([])
  // still the draft: fix it and save
  await ui.press({ key: 'wf-toggle:executar' })
  expect(await ui.find(text(/Não salvei/))).toBeUndefined()
  await ui.unmount()

  // a new workflow from scratch with no step does not resolve either
  const scratch = await mount($)
  await scratch.press({ key: 'wf-discard' })
  // discarding goes back to the workflow that was open
  expect(await scratch.find({ key: 'wf-edit' })).toBeDefined()
  await scratch.press({ key: 'wf-back' })
  await scratch.input({ key: 'wf-new-id', text: 'vazio' })
  await scratch.press({ key: 'wf-new' })
  expect(await scratch.find(text(/Do zero/))).toBeDefined()
  await scratch.press({ key: 'wf-save' })
  expect(await scratch.find(text(/Não salvei: .*`steps` must be a non-empty list/))).toBeDefined()
  expect(w.disk.has(`${DIR}/vazio.json`)).toBe(false)
  await scratch.unmount()
})

test('4.4 a workflow from scratch is written with its whole steps', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  await ui.input({ key: 'wf-new-id', text: 'curto' })
  await ui.press({ key: 'wf-new' })
  await ui.input({ key: 'wf-step-title', text: 'Fazer' })
  await ui.input({ key: 'wf-step-agent', text: 'executor' })
  await ui.press({ key: 'wf-add-new' })
  await ui.input({ key: 'wf-step-title', text: 'Conferir' })
  await ui.select({ key: 'wf-step-kind', value: 'owner' })
  await ui.press({ key: 'wf-add-new' })
  await ui.press({ key: 'wf-save' })
  const saved = file(w, 'curto')
  expect(saved).toEqual({
    id: 'curto',
    title: 'curto',
    description: '',
    steps: [
      { id: 'fazer', title: 'Fazer', kind: 'session', agent: 'executor', outcomes: { pronto: { label: 'Pronto', next: 'conferir' } } },
      { id: 'conferir', title: 'Conferir', kind: 'owner', outcomes: { feito: { label: 'Feito', next: 'fim' } } },
    ],
  })
  expect(await ui.find(text(/curto · do projeto/))).toBeDefined()
  await ui.unmount()
})

test('4.4 editing a default writes a project workflow of the same id, with a warning, and a running change keeps its snapshot', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const state = '/h/.claude/orquestrador/flows/demo.json'
  const before = w.disk.get(state)

  const ui = await mount($)
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  expect(await ui.find(text(/⚠ rapido é um workflow padrão\. Salvar cria \.orquestrador\/flows\/rapido\.json/))).toBeDefined()
  await ui.press({ key: 'wf-step:qa' })
  await ui.press({ key: 'wf-toggle:qa' })
  await ui.press({ key: 'wf-save' })
  expect(file(w, 'rapido')).toEqual({ id: 'rapido', title: expect.any(String), description: expect.any(String), base: 'rapido', remove: ['qa'] })
  expect(await ui.find(text(/O workflow padrão rapido segue no mod, mas este projeto passa a usar o seu no lugar dele/))).toBeDefined()
  expect(await ui.find(text(/rapido · derivado de rapido/))).toBeDefined()
  await ui.unmount()

  // the change that started on the default keeps its snapshot, qa included
  expect(w.disk.get(state)).toBe(before)
  expect((JSON.parse(w.disk.get(state)!) as FlowState).flow.steps.map(s => s.id)).toContain('qa')
  const list = String((await flow($, { action: 'list' })).result)
  expect(list).toMatch(/rapido — .*: planejar → validar → executar → revisao-codigo → checagem → pr → producao → arquivar → fim/)

  // editing it again starts from the project's file, the removed step switched off
  const again = await mount($)
  await again.press({ key: 'wf-edit' })
  expect(await again.find(text(/^desligado · ✋ dono/))).toBeDefined()
  await again.press({ key: 'wf-step:qa' })
  await again.press({ key: 'wf-toggle:qa' })
  await again.press({ key: 'wf-save' })
  expect(file(w, 'rapido')).toEqual({ id: 'rapido', title: expect.any(String), description: expect.any(String), base: 'rapido' })
  await again.unmount()
})

test('7.4 Novo workflow and Salvar never write over a flow file of the same id or name, valid or broken', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/quebrado.json`, '{ not json')
  w.disk.set(`${DIR}/outro-nome.json`, JSON.stringify({ id: 'orfao', base: 'rapido', remove: ['nao-existe'] }))
  const ui = await mount($)

  // creating: the broken file by its name, and the one that does not resolve by its id
  await ui.input({ key: 'wf-new-id', text: 'quebrado' })
  await ui.press({ key: 'wf-new' })
  expect(w.toasts.at(-1)).toMatch(/Já existe \.orquestrador\/flows\/quebrado\.json com o id ou o nome quebrado; nada foi criado/)
  expect(await ui.find(text(/Workflows disponíveis/))).toBeDefined()
  await ui.input({ key: 'wf-new-id', text: 'orfao' })
  await ui.press({ key: 'wf-new' })
  expect(w.toasts.at(-1)).toMatch(/Já existe \.orquestrador\/flows\/outro-nome\.json com o id ou o nome orfao/)

  // saving: a file that turned up under the draft's name after it was created stays as it is
  await ui.input({ key: 'wf-new-id', text: 'novo' })
  await ui.select({ key: 'wf-new-base', value: 'rapido' })
  await ui.press({ key: 'wf-new' })
  w.disk.set(`${DIR}/novo.json`, '{ meu rascunho')
  await ui.press({ key: 'wf-save' })
  expect(await ui.find(text(/Não salvei: já existe \.orquestrador\/flows\/novo\.json com o id ou o nome novo; nada foi gravado/))).toBeDefined()
  expect(w.disk.get(`${DIR}/novo.json`)).toBe('{ meu rascunho')
  await ui.press({ key: 'wf-discard' })
  await ui.unmount()

  // saving a default edited while the project holds a broken file of its name
  w.disk.set(`${DIR}/rapido.json`, '{ rapido meu, quebrado')
  const edit = await mount($)
  await edit.press({ key: 'wf-open:rapido' })
  await edit.press({ key: 'wf-edit' })
  await edit.press({ key: 'wf-save' })
  expect(await edit.find(text(/Não salvei: já existe \.orquestrador\/flows\/rapido\.json/))).toBeDefined()
  expect(w.disk.get(`${DIR}/rapido.json`)).toBe('{ rapido meu, quebrado')
  await edit.unmount()
})

test('7.4 a project workflow opened for editing is saved over its own file', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/meu-trunk.json`, JSON.stringify(TRUNK))
  const ui = await mount($)
  await ui.press({ key: 'wf-open:trunk' })
  await ui.press({ key: 'wf-edit' })
  await ui.press({ key: 'wf-step:planejar' })
  await ui.select({ key: 'wf-model:planejar', value: 'claude-sonnet-5-5' })
  await ui.press({ key: 'wf-save' })
  expect(await ui.find(text(/Salvo em \.orquestrador\/flows\/meu-trunk\.json/))).toBeDefined()
  expect(JSON.parse(w.disk.get(`${DIR}/meu-trunk.json`)!)).toMatchObject({ id: 'trunk', override: { planejar: { model: 'claude-sonnet-5-5' } } })
  expect(w.disk.has(`${DIR}/trunk.json`)).toBe(false)
  await ui.unmount()
})

test('7.5 Salvar refuses when a workflow deriving from the saved one would stop resolving, and lists them', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  w.disk.set(`${DIR}/filho.json`, JSON.stringify({ id: 'filho', title: 'Filho', base: 'trunk', override: { merge: { model: 'claude-haiku-5-5' } } }))
  w.disk.set(`${DIR}/neto.json`, JSON.stringify({ id: 'neto', title: 'Neto', base: 'filho', remove: ['revisao-pr'] }))
  w.disk.set(`${DIR}/outro.json`, JSON.stringify({ id: 'outro', title: 'Outro', base: 'rapido', remove: ['qa'] }))
  const before = w.disk.get(`${DIR}/trunk.json`)
  const ui = await mount($)
  await ui.press({ key: 'wf-open:trunk' })
  await ui.press({ key: 'wf-edit' })
  await ui.press({ key: 'wf-step:merge' })
  await ui.press({ key: 'wf-toggle:merge' })
  await ui.press({ key: 'wf-save' })
  const refusal = await ui.find(text(/Não salvei: os workflows que derivam de trunk deixariam de resolver; nada foi gravado\./))
  const said = (refusal as { text?: string } | undefined)?.text ?? ''
  expect(said).toMatch(/ \.orquestrador\/flows\/filho\.json: `override`: "merge" is no step of the flow\./)
  expect(said).toMatch(/ \.orquestrador\/flows\/neto\.json: base "filho" does not resolve/)
  expect(said).not.toMatch(/outro\.json/)
  expect(w.disk.get(`${DIR}/trunk.json`)).toBe(before)

  // a change the derived ones still resolve with is saved
  await ui.press({ key: 'wf-toggle:merge' })
  await ui.press({ key: 'wf-step:planejar' })
  await ui.select({ key: 'wf-effort:planejar', value: 'low' })
  await ui.press({ key: 'wf-save' })
  expect(await ui.find(text(/Salvo em \.orquestrador\/flows\/trunk\.json/))).toBeDefined()
  expect(file(w, 'trunk')).toMatchObject({ override: { planejar: { effort: 'low' } } })
  await ui.unmount()
})

test('7.6 producao\'s own detect is kept on save, with a notice, and the deploy\'s routines are not written as its own', async ($, on) => {
  const w = world(on)
  w.disk.set(
    `${DIR}/meu.json`,
    JSON.stringify({ ...TRUNK, id: 'meu', title: 'Meu', override: { producao: { detect: 'fly deploy' } } }),
  )
  const ui = await mount($)
  await ui.press({ key: 'wf-open:meu' })
  await ui.press({ key: 'wf-edit' })
  await ui.press({ key: 'wf-step:planejar' })
  await ui.select({ key: 'wf-model:planejar', value: 'claude-sonnet-5-5' })
  await ui.press({ key: 'wf-save' })
  expect(file(w, 'meu')?.override).toEqual({
    planejar: { model: 'claude-sonnet-5-5' },
    producao: { detect: { commands: ['fly deploy'], outcome: 'publicado' } },
  })
  expect(await ui.find(text(/O passo producao tem detect próprio \(fly deploy\), gravado no override/))).toBeDefined()
  await ui.unmount()

})

test('7.6 the final guard compares the editable fields too; a whole workflow writes producao\'s own detect only', () => {
  const defaults = Object.fromEntries(DEFAULT_FLOWS.map(f => [(f.raw as { id: string }).id, f]))
  const trunk = resolveFlow(TRUNK, 'trunk.json', id => defaults[id])
  if ('error' in trunk) throw new Error(trunk.error)
  const whole = draftOf(trunk, undefined, false)
  const saved = draftFile(whole, raw => parseFlow(raw, 'x.json'))
  if ('error' in saved) throw new Error(saved.error)
  const steps = saved.raw.steps as { id: string; detect?: { commands: string[] } }[]
  const producao = steps.find(s => s.id === 'producao')!
  expect(producao.detect?.commands).not.toContain('npm run migrate')
  expect(producao.detect).not.toHaveProperty('routines')
  expect(saved.flow.steps.find(s => s.id === 'producao')!.detect?.commands).toContain('npm run migrate')

  // a load that would lose a field the owner set is refused, naming the step and the field
  const lossy = (field: 'model' | 'deploy') => (raw: Record<string, unknown>) => {
    const flow = parseFlow(raw, 'x.json')
    if ('error' in flow) return flow
    return { ...flow, steps: flow.steps.map(s => (s.id === (field === 'model' ? 'planejar' : 'deploy') ? { ...s, [field]: undefined } : s)) }
  }
  const edited = { ...whole, steps: whole.steps.map(s => (s.step.id === 'planejar' ? { ...s, step: { ...s.step, model: 'claude-haiku-5-5' } } : s)) }
  expect(draftFile(edited, lossy('model'))).toEqual({
    error: 'O workflow salvo não sairia igual ao rascunho (passo "planejar": model); nada foi gravado.',
  })
  expect(draftFile(whole, lossy('deploy'))).toEqual({
    error: 'O workflow salvo não sairia igual ao rascunho (passo "deploy": deploy); nada foi gravado.',
  })
})
