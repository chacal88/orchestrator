import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState } from '../types'
import { parseFlow, resolveFlow } from '../hooks/flow'
import { DEFAULT_FLOWS } from '../hooks/flows/index'
import { changesOf, draftFile, draftOf, moveStep, setStepField, toggleStep } from '../hooks/workflow-edit'
import { listAgents } from '../hooks/flow-files'
import { workflowsText } from '../hooks/i18n-workflows'
import { PROJECT, raw as RAPIDO_REPO } from './rapido-repo-flow'

type On = Parameters<TestBody>[1]
type Surface = 'desktop' | 'terminal' | 'mobile'

const DIR = '/w/.orchestrator/flows'

type World = { disk: Map<string, string>; panes: { id: string; title: string }[]; toasts: string[] }

/** A coordinator at /w with an in-memory disk, the app's panes answered from memory and the plugin's agents present. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), panes: [], toasts: [] }
  const plugin = ['planner', 'executor', 'code-reviewer', 'pr-opener', 'merge', 'workflow-merge', 'deploy']
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 1_000) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  const pluginDir = (path: string) => !path.startsWith('/w/') && path.endsWith('/agents')
  const pluginFile = (path: string) => (path.startsWith('/w/') ? undefined : plugin.find(name => path.endsWith(`/agents/${name}.md`)))
  on('fs.exists', ($, e) => ({
    value:
      w.disk.has(e.path) ||
      [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) ||
      pluginDir(e.path) ||
      pluginFile(e.path) !== undefined,
  }))
  on('fs.read', ($, e) => {
    const name = pluginFile(e.path)
    if (name !== undefined && !w.disk.has(e.path)) {
      return { value: `---\nname: ${name}\ndescription: Descrição do ${name}.\nmodel: ${name === 'planner' || name === 'code-reviewer' ? 'opus' : 'sonnet'}\ntools: Read\n---\n# ${name}\n` }
    }
    return { value: w.disk.get(e.path) ?? '' }
  })
  on('fs.write', ($, e) => {
    w.disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: (pluginDir(e.path)
      ? plugin.map(name => `${e.path}/${name}.md`)
      : [...w.disk.keys()]
    )
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
  }))
  // a session start, as a reload of the plugin's code runs again
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/w' }) as never)
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
    requestId: 'orchestrator-workflows',
    props: { title: '⚙️ Workflows', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} },
  }) as const

const mount = <S extends Surface = 'desktop'>($: Engine, surface: S = 'desktop' as S, columns = 60) =>
  $.ui.mount({ plugin: 'orchestrator', surface, ...pane(columns) })
const text = (pattern: RegExp) => ({ type: 'Text', text: pattern }) as const
const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orchestrator__flow', ...input } as never) as Promise<{ result?: unknown; isError?: boolean }>
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
    { id: 'orchestrator', title: '🧭 Orchestrator' },
    { id: 'orchestrator-workflows', title: '⚙️ Workflows' },
  ])
  const ui = await mount($)
  expect(await ui.find(text(/Os caminhos que uma change pode seguir/))).toBeDefined()
  await ui.unmount()

  const closed = await $.command.run({ command: 'orquestrador-workflows' } as never)
  expect(String((closed as { text?: string }).text)).toMatch(/Painel de workflows fechado/)
  expect(w.panes.map(p => p.id)).toEqual(['orchestrator'])
})

test('4.2 the list shows each workflow with its origin and the files in error; a workflow opens step by step', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  w.disk.set(`${DIR}/quebrado.json`, '{ not json')
  w.disk.set(`${DIR}/orfao.json`, JSON.stringify({ id: 'orfao', base: 'rapido', remove: ['nao-existe'] }))

  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const ui = await mount($, surface, 30)
    expect(await ui.find(text(/^Completo/))).toBeDefined()
    expect(await ui.find(text(/^Trunk/))).toBeDefined()
    // no "id · origem" line: the origin is a tag
    expect(await ui.find(text(/trunk · derivado/))).toBeUndefined()
    expect(await ui.find(text(/PR direto na main/))).toBeDefined()
    expect(await ui.find(text(/DESTE PROJETO/))).toBeDefined()
    expect(await ui.find(text(/PADRÕES DO PLUGIN/))).toBeDefined()
    expect(await ui.find(text(/2 arquivos com erro, ignorados/))).toBeDefined()
    expect(await ui.find(text(/quebrado\.json — o arquivo não é um JSON válido/))).toBeDefined()
    expect(await ui.find(text(/orfao\.json — `remove`: "nao-existe"/))).toBeDefined()
    expect(await ui.find(text(/^derivado de rapido$/))).toBeDefined()
    expect(await ui.find(text(/^merge automático$/))).toBeDefined()
    await ui.unmount()
  }

  const ui = await mount($, 'terminal', 30)
  await ui.press({ key: 'wf-open:trunk' })
  expect(await ui.find(text(/^derivado de rapido$/))).toBeDefined()
  const rows = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('wf-step:'))
  expect(rows).toEqual(
    ['planejar', 'validar', 'executar', 'revisao-codigo', 'checagem', 'pr', 'revisao-pr', 'merge', 'deploy', 'producao', 'arquivar'].map(
      id => `wf-step:${id}`,
    ),
  )
  expect(await ui.find(text(/^Uma sessão faz, com o agente planner \(Opus 5\.5, esforço alto\)$/))).toBeDefined()
  expect(await ui.find(text(/Automático · squash em main · só com PR aprovado e CI verde, nunca com --admin/))).toBeDefined()
  expect(await ui.find(text(/Você confirma · espera o CI e roda npm run migrate/))).toBeDefined()
  expect(await ui.find(text(/sessão faz/))).toBeDefined()

  await ui.press({ key: 'wf-step:planejar' })
  for (const label of ['Quem faz', 'Agente', 'Modelo', 'Recebe', 'Entrega', 'Se rejeitar']) {
    expect(await ui.find(text(new RegExp(`^${label}$`)))).toBeDefined()
  }
  expect(await ui.find(text(/^planner \(do plugin\)$/))).toBeDefined()

  await ui.press({ key: 'wf-step:revisao-codigo' })
  expect(await ui.find(text(/^Volta para Executar fases\.$/))).toBeDefined()

  await ui.press({ key: 'wf-step:merge' })
  expect(await ui.find(text(/branch main · squash · automático: sim/))).toBeDefined()
  expect(await ui.find(text(/^merge \(do plugin\)$/))).toBeDefined()
  expect(await ui.find(text(/^Aprovação no GitHub e CI verde: o PR precisa/))).toBeDefined()

  await ui.press({ key: 'wf-step:deploy' })
  expect(await ui.find(text(/CI sim · rotinas: npm run migrate · automático: não/))).toBeDefined()
  // viewing never edits: no field, no save
  expect(await ui.find({ key: 'wf-save' })).toBeUndefined()
  expect(await ui.find({ key: 'wf-toggle:deploy' })).toBeUndefined()
  await ui.press({ key: 'wf-back' })
  expect(await ui.find(text(/Os caminhos que uma change pode seguir/))).toBeDefined()
  await ui.unmount()
})

test('4.3 edits stay a draft in the mod until Salvar or Descartar', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  expect(await ui.find(text(/Editando Rápido/))).toBeDefined()
  expect(await ui.find(text(/Nenhuma mudança ainda/))).toBeDefined()

  // switch a step off (it goes to the end, struck, with "religar") and on, move one, set its agent, model and effort
  await ui.press({ key: 'wf-step:qa' })
  await ui.press({ key: 'wf-toggle:qa' })
  expect(await ui.find(text(/religar/))).toBeDefined()
  expect(await ui.find(text(/passo "Em QA" desligado/))).toBeDefined()
  await ui.press({ key: 'wf-toggle:qa' })
  expect(await ui.find(text(/religar/))).toBeUndefined()
  await ui.press({ key: 'wf-step:checagem' })
  await ui.press({ key: 'wf-up:checagem' })
  await ui.press({ key: 'wf-step:pr' })
  // the agent comes from a list: the plugin's files, the project's, and "Nenhum"
  const agentSelect = await ui.find({ key: 'wf-agent:pr' })
  expect(JSON.stringify(agentSelect)).toMatch(/code-reviewer \(do plugin\)/)
  expect(JSON.stringify(agentSelect)).toMatch(/Nenhum: a sessão segue só o pedido/)
  expect(await ui.find(text(/Descrição do pr-opener\./))).toBeDefined()
  await ui.select({ key: 'wf-agent:pr', value: 'code-reviewer' })
  expect(await ui.find(text(/Descrição do code-reviewer\./))).toBeDefined()
  await ui.select({ key: 'wf-model:pr', value: 'claude-haiku-5-5' })
  await ui.select({ key: 'wf-effort:pr', value: 'low' })
  expect(await ui.find(text(/passo "PR": agente, modelo, esforço/))).toBeDefined()
  expect(await ui.find(text(/ordem dos passos/))).toBeDefined()

  // "+ passo aqui" after the open step, from the library: the PR review, a merge, a deploy
  await ui.press({ key: 'wf-insert:pr' })
  expect(await ui.find(text(/Acrescentar depois de PR/))).toBeDefined()
  await ui.select({ key: 'wf-add-library', value: 'revisao-pr' })
  expect(await ui.find(text(/O dono revisa e aprova o PR no GitHub\./))).toBeDefined()
  await ui.press({ key: 'wf-add' })
  await ui.press({ key: 'wf-insert:revisao-pr' })
  await ui.select({ key: 'wf-add-library', value: 'merge' })
  await ui.press({ key: 'wf-add' })
  // the added step opens at once
  await ui.input({ key: 'wf-merge-branch:merge', text: 'dev' })
  await ui.select({ key: 'wf-merge-method:merge', value: 'rebase' })
  await ui.press({ key: 'wf-merge-auto:merge' })
  expect(JSON.stringify(await ui.find({ key: 'wf-merge-auto:merge' }))).toContain('Fazer o merge sozinho: sim')
  expect(await ui.find(text(/Trunk-based: main\. Com dev e master/))).toBeDefined()
  await ui.press({ key: 'wf-insert:merge' })
  await ui.select({ key: 'wf-add-library', value: 'deploy' })
  await ui.press({ key: 'wf-add' })
  await ui.press({ key: 'wf-deploy-ci:deploy' })
  expect(JSON.stringify(await ui.find({ key: 'wf-deploy-ci:deploy' }))).toContain('Esperar o CI do deploy: não')
  // routines: a list of fields with "+ rotina"
  await ui.press({ key: 'wf-routine-add:deploy' })
  await ui.input({ key: 'wf-routine-new:deploy', text: 'npm run migrate' })
  await ui.press({ key: 'wf-routine-add:deploy' })
  await ui.input({ key: 'wf-routine-new:deploy', text: 'npm run warm' })
  expect(await ui.find({ key: 'wf-routine:deploy:0' })).toBeDefined()
  expect(await ui.find({ key: 'wf-routine:deploy:1' })).toBeDefined()
  await ui.input({ key: 'wf-routine:deploy:1', text: 'npm run warm-up' })
  await ui.press({ key: 'wf-deploy-auto:deploy' })
  expect(JSON.stringify(await ui.find({ key: 'wf-deploy-auto:deploy' }))).toContain('Fazer o deploy sozinho: sim')
  await ui.press({ key: 'wf-routine-del:deploy:0' })
  expect(await ui.find({ key: 'wf-routine:deploy:1' })).toBeUndefined()

  // a new step of its own, with title, who answers and agent
  await ui.press({ key: 'wf-insert:deploy' })
  await ui.input({ key: 'wf-step-title', text: 'Revisão de segurança' })
  await ui.select({ key: 'wf-step-kind', value: 'session' })
  await ui.select({ key: 'wf-step-agent', value: 'executor' })
  await ui.press({ key: 'wf-add' })

  const rows = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('wf-step:'))
  expect(rows).toEqual(
    ['planejar', 'validar', 'executar', 'checagem', 'revisao-codigo', 'pr', 'revisao-pr', 'merge', 'deploy', 'revisao-de-seguranca', 'qa', 'producao', 'arquivar'].map(
      id => `wf-step:${id}`,
    ),
  )
  expect(await ui.find(text(/Descrição do executor\./))).toBeDefined()
  // nothing reached the disk
  expect([...w.disk.keys()].filter(k => k.startsWith(DIR))).toEqual([])

  // the draft outlives the pane being drawn again
  await ui.unmount()
  const again = await mount($)
  expect(await again.find({ key: 'wf-step:revisao-de-seguranca' })).toBeDefined()
  await again.press({ key: 'wf-discard' })
  expect(await again.find(text(/^Rápido/))).toBeDefined()
  expect([...w.disk.keys()].filter(k => k.startsWith(DIR))).toEqual([])
  await again.unmount()
})

test('4.4 saving a derived workflow writes the derived form, and the mod loads it as drawn', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  await ui.input({ key: 'wf-new-name', text: 'Trunk' })
  expect(await ui.find(text(/O id do arquivo sai do nome \(trunk\)/))).toBeDefined()
  await ui.select({ key: 'wf-new-base', value: 'rapido' })
  await ui.press({ key: 'wf-new' })
  expect(await ui.find(text(/Derivado de rapido/))).toBeDefined()
  expect(await ui.find(text(/Editando Trunk/))).toBeDefined()
  await ui.press({ key: 'wf-step:qa' })
  await ui.press({ key: 'wf-toggle:qa' })
  await ui.press({ key: 'wf-step:pr' })
  await ui.press({ key: 'wf-insert:pr' })
  await ui.select({ key: 'wf-add-library', value: 'revisao-pr' })
  await ui.press({ key: 'wf-add' })
  await ui.press({ key: 'wf-insert:revisao-pr' })
  await ui.select({ key: 'wf-add-library', value: 'merge' })
  await ui.press({ key: 'wf-add' })
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
  expect(await ui.find(text(/Salvo em \.orchestrator\/flows\/trunk\.json/))).toBeDefined()
  expect(await ui.find(text(/^derivado de rapido$/))).toBeDefined()
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
  await scratch.input({ key: 'wf-new-name', text: 'Vazio' })
  await scratch.press({ key: 'wf-new' })
  expect(await scratch.find(text(/Do zero/))).toBeUndefined()
  await scratch.press({ key: 'wf-save' })
  expect(await scratch.find(text(/Não salvei: .*`steps` must be a non-empty list/))).toBeDefined()
  expect(w.disk.has(`${DIR}/vazio.json`)).toBe(false)
  await scratch.unmount()
})

test('4.4 a workflow from scratch is written with its whole steps', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  await ui.input({ key: 'wf-new-name', text: 'curto' })
  await ui.press({ key: 'wf-new' })
  await ui.press({ key: 'wf-insert::fim' })
  await ui.input({ key: 'wf-step-title', text: 'Fazer' })
  await ui.select({ key: 'wf-step-agent', value: 'executor' })
  await ui.press({ key: 'wf-add' })
  await ui.press({ key: 'wf-insert:fazer' })
  await ui.input({ key: 'wf-step-title', text: 'Conferir' })
  await ui.select({ key: 'wf-step-kind', value: 'owner' })
  await ui.press({ key: 'wf-add' })
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
  expect(await ui.find(text(/^do projeto$/))).toBeDefined()
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
  expect(await ui.find(text(/⚠ rapido é um workflow padrão\. Salvar cria \.orchestrator\/flows\/rapido\.json/))).toBeDefined()
  await ui.press({ key: 'wf-step:qa' })
  await ui.press({ key: 'wf-toggle:qa' })
  await ui.press({ key: 'wf-save' })
  expect(file(w, 'rapido')).toEqual({ id: 'rapido', title: expect.any(String), description: expect.any(String), base: 'rapido', remove: ['qa'] })
  expect(await ui.find(text(/O workflow padrão rapido segue no mod, mas este projeto passa a usar o seu no lugar dele/))).toBeDefined()
  expect(await ui.find(text(/^derivado de rapido$/))).toBeDefined()
  await ui.unmount()

  // the change that started on the default keeps its snapshot, qa included
  expect(w.disk.get(state)).toBe(before)
  expect((JSON.parse(w.disk.get(state)!) as FlowState).flow.steps.map(s => s.id)).toContain('qa')
  const list = String((await flow($, { action: 'list' })).result)
  expect(list).toMatch(/rapido — .*: planejar → validar → executar → revisao-codigo → checagem → pr → producao → arquivar → fim/)

  // editing it again starts from the project's file, the removed step switched off
  const again = await mount($)
  await again.press({ key: 'wf-edit' })
  expect(await again.find(text(/religar/))).toBeDefined()
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
  await ui.input({ key: 'wf-new-name', text: 'quebrado' })
  await ui.press({ key: 'wf-new' })
  expect(w.toasts.at(-1)).toMatch(/Já existe \.orchestrator\/flows\/quebrado\.json com o id ou o nome quebrado; nada foi criado/)
  expect(await ui.find(text(/Os caminhos que uma change pode seguir/))).toBeDefined()
  await ui.input({ key: 'wf-new-name', text: 'orfao' })
  await ui.press({ key: 'wf-new' })
  expect(w.toasts.at(-1)).toMatch(/Já existe \.orchestrator\/flows\/outro-nome\.json com o id ou o nome orfao/)

  // saving: a file that turned up under the draft's name after it was created stays as it is
  await ui.input({ key: 'wf-new-name', text: 'novo' })
  await ui.select({ key: 'wf-new-base', value: 'rapido' })
  await ui.press({ key: 'wf-new' })
  w.disk.set(`${DIR}/novo.json`, '{ meu rascunho')
  await ui.press({ key: 'wf-save' })
  expect(await ui.find(text(/Não salvei: já existe \.orchestrator\/flows\/novo\.json com o id ou o nome novo; nada foi gravado/))).toBeDefined()
  expect(w.disk.get(`${DIR}/novo.json`)).toBe('{ meu rascunho')
  await ui.press({ key: 'wf-discard' })
  await ui.unmount()

  // saving a default edited while the project holds a broken file of its name
  w.disk.set(`${DIR}/rapido.json`, '{ rapido meu, quebrado')
  const edit = await mount($)
  await edit.press({ key: 'wf-open:rapido' })
  await edit.press({ key: 'wf-edit' })
  await edit.press({ key: 'wf-save' })
  expect(await edit.find(text(/Não salvei: já existe \.orchestrator\/flows\/rapido\.json/))).toBeDefined()
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
  expect(await ui.find(text(/Salvo em \.orchestrator\/flows\/meu-trunk\.json/))).toBeDefined()
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
  expect(said).toMatch(/ \.orchestrator\/flows\/filho\.json: `override`: "merge" is no step of the flow\./)
  expect(said).toMatch(/ \.orchestrator\/flows\/neto\.json: base "filho" does not resolve/)
  expect(said).not.toMatch(/outro\.json/)
  expect(w.disk.get(`${DIR}/trunk.json`)).toBe(before)

  // a change the derived ones still resolve with is saved
  await ui.press({ key: 'wf-toggle:merge' })
  await ui.press({ key: 'wf-step:planejar' })
  await ui.select({ key: 'wf-effort:planejar', value: 'low' })
  await ui.press({ key: 'wf-save' })
  expect(await ui.find(text(/Salvo em \.orchestrator\/flows\/trunk\.json/))).toBeDefined()
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

const SURFACES = [
  ['desktop', 60],
  ['terminal', 60],
  ['terminal', 30],
  ['mobile', 30],
] as const

type Ui = Awaited<ReturnType<typeof mount<'desktop'>>>
const mountAny = ($: Engine, surface: Surface, columns: number) => mount($, surface, columns) as unknown as Promise<Ui>
/** Text on screen, or a failure that names it. */
const see = async (ui: Ui, pattern: RegExp) => {
  if ((await ui.find(text(pattern))) === undefined) throw new Error(`not on screen: ${String(pattern)}`)
}

const keysOf = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

test('10.1 the list: "Deste projeto" and "Padrões do plugin", a card each, a default left unused with its reason, errors in their own notice, Novo workflow with help', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  w.disk.set(`${DIR}/rapido.json`, JSON.stringify({ id: 'rapido', title: 'Rápido do projeto', description: 'O meu.', base: 'rapido' }))
  w.disk.set(`${DIR}/hotfix.json`, '{ not json')

  for (const [surface, columns] of SURFACES) {
    const ui = await mountAny($, surface, columns)
    await see(ui, /DESTE PROJETO/)
    await see(ui, /PADRÕES DO PLUGIN/)
    // a card each: a line of what it does, its steps and its tags
    await see(ui, /PR direto na main/)
    await see(ui, /^\d+ passos$/)
    await see(ui, /^derivado de rapido$/)
    await see(ui, /^merge automático$/)
    await see(ui, /^substitui o padrão rapido$/)
    // the default the project's own replaces is shown as unused, with why
    await see(ui, /fora de uso/)
    await see(ui, /Este projeto usa o seu Rápido do projeto no lugar deste\./)
    expect(await ui.find({ key: 'wf-open:completo' })).toBeDefined()
    // the file in error: its own notice, in plain words
    await see(ui, /^1 arquivo com erro, ignorado$/)
    await see(ui, /hotfix\.json — o arquivo não é um JSON válido\./)
    // Novo workflow
    await see(ui, /Novo workflow/)
    if (surface === 'mobile') {
      await see(ui, /Os campos de texto e de escolha ficam no desktop e no terminal/)
      expect(await ui.find({ key: 'wf-new' })).toBeUndefined()
    } else {
      await see(ui, /Como ele aparece na lista\. O id do arquivo sai do nome\./)
      await see(ui, /Partindo de um existente, ele guarda só o que você mudar\./)
      const base = JSON.stringify(await ui.find({ key: 'wf-new-base' }))
      expect(base).toContain('Completo — copia os')
      expect(base).toContain('Do zero — nenhum passo')
      expect(JSON.stringify(await ui.find({ key: 'wf-new' }))).toContain('Criar e editar')
    }
    await ui.unmount()
  }
})

test('10.2 an open workflow: the legend, numbered steps with a line each, and the open step with who, agent, model, receives, delivers, if rejected', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  for (const [surface, columns] of SURFACES) {
    const ui = await mountAny($, surface, columns)
    await ui.press({ key: 'wf-open:trunk' })
    const keys = await keysOf(ui)
    // "Editar" sits above the steps
    expect(keys.indexOf('wf-edit')).toBeGreaterThan(-1)
    expect(keys.indexOf('wf-edit')).toBeLessThan(keys.indexOf('wf-step:planejar'))
    await see(ui, /sessão faz/)
    await see(ui, /você aprova/)
    await see(ui, /o mod confere/)
    await see(ui, /^1$/)
    await see(ui, /^Uma sessão faz, com o agente planner \(Opus 5\.5, esforço alto\)$/)
    expect(await ui.find({ key: 'wf-save' })).toBeUndefined()
    await ui.press({ key: 'wf-step:revisao-codigo' })
    for (const label of ['Quem faz', 'Agente', 'Modelo', 'Recebe', 'Entrega', 'Se rejeitar']) {
      await see(ui, new RegExp(`^${label}$`))
    }
    await see(ui, /^Uma sessão, com o agente abaixo$/)
    await see(ui, /^code-reviewer \(do plugin\)$/)
    await see(ui, /^Volta para Executar fases\.$/)
    await ui.press({ key: 'wf-back' })
    await ui.unmount()
  }
})

test('10.3 10.4 10.5 editing: the bar on top, compact steps with the open one in a card, agent from a list, "+ passo aqui", off steps struck at the end', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  // the project's own agent of the plugin's name replaces it in the list
  w.disk.set('/w/.orchestrator/agents/code-reviewer.md', '---\nname: code-reviewer\ndescription: O revisor deste projeto.\nmodel: haiku\n---\n')
  w.disk.set('/w/.orchestrator/agents/seguranca.md', '---\nname: seguranca\ndescription: Procura brechas.\n---\n')

  for (const [surface, columns] of SURFACES) {
    const ui = await mountAny($, surface, columns)
    await ui.press({ key: 'wf-open:trunk' })
    await ui.press({ key: 'wf-edit' })
    const keys = await keysOf(ui)
    // the bar: Salvar and Descartar come before every step
    expect(keys.indexOf('wf-save')).toBe(0)
    expect(keys.indexOf('wf-discard')).toBe(1)
    await see(ui, /Rascunho: nada é gravado até salvar\./)
    await see(ui, /Nenhuma mudança ainda\./)
    await see(ui, /Toque num passo para editar\. "\+ passo aqui" acrescenta naquele lugar\./)
    // one "+ passo aqui", at the end while no step is open (not between every two steps)
    expect(keys.filter(k => k.startsWith('wf-insert:'))).toEqual(['wf-insert::fim'])

    await ui.press({ key: 'wf-step:revisao-codigo' })
    const footer = (await keysOf(ui)).filter(k => /^wf-(up|down|toggle):revisao-codigo$/.test(k))
    expect(footer).toEqual(['wf-up:revisao-codigo', 'wf-down:revisao-codigo', 'wf-toggle:revisao-codigo'])
    expect(JSON.stringify(await ui.find({ key: 'wf-toggle:revisao-codigo' }))).toContain('Desligar este passo')
    await ui.press({ key: 'wf-step:planejar' })
    expect((await keysOf(ui)).includes('wf-up:planejar')).toBe(false)

    if (surface === 'mobile') {
      expect(await ui.find({ key: 'wf-agent:planejar' })).toBeUndefined()
      await see(ui, /Os campos de texto e de escolha ficam no desktop e no terminal/)
    } else {
      const agents = JSON.stringify(await ui.find({ key: 'wf-agent:planejar' }))
      expect(agents).toContain('code-reviewer (do projeto)')
      expect(agents).not.toContain('code-reviewer (do plugin)')
      expect(agents).toContain('seguranca (do projeto)')
      expect(agents).toContain('executor (do plugin)')
      expect(agents).toContain('Nenhum: a sessão segue só o pedido')
      // the chosen agent's description sits under the list
      await see(ui, /Descrição do planner\./)
      await ui.select({ key: 'wf-agent:planejar', value: 'code-reviewer' })
      await see(ui, /O revisor deste projeto\./)
      // model and effort come from the agent until the owner changes them
      await ui.press({ key: 'wf-step:merge' })
      const model = JSON.stringify(await ui.find({ key: 'wf-model:merge' }))
      expect(model).toContain('Sonnet (do agente)')
      await see(ui, /Vêm do agente escolhido\. Mude só se este projeto pedir mais ou menos/)
      await see(ui, /A coordenação faz o merge assim que o PR estiver aprovado no GitHub/)
      await ui.select({ key: 'wf-model:merge', value: 'claude-haiku-5-5' })
      expect(JSON.stringify(await ui.find({ key: 'wf-model:merge' }))).toContain('"value":"claude-haiku-5-5"')
      // "+ passo aqui": a library step with its explanation, then a new one
      await ui.press({ key: 'wf-insert:merge' })
      await see(ui, /Acrescentar depois de Merge em main/)
      await ui.select({ key: 'wf-add-library', value: 'deploy' })
      await see(ui, /A change é publicada depois do merge/)
      await ui.press({ key: 'wf-add-cancel' })
      expect(await ui.find({ key: 'wf-add' })).toBeUndefined()
      await ui.press({ key: 'wf-insert:merge' })
      await ui.select({ key: 'wf-add-library', value: 'novo' })
      await ui.input({ key: 'wf-step-title', text: 'Rodar scanner' })
      await ui.select({ key: 'wf-step-kind', value: 'automatic' })
      await ui.input({ key: 'wf-step-command', text: 'npm run scan' })
      await ui.press({ key: 'wf-add' })
      expect(await ui.find({ key: 'wf-step:rodar-scanner' })).toBeDefined()
      await see(ui, /passo "Rodar scanner" acrescentado/)
    }
    // a step switched off goes to the end, struck, with "religar"
    await ui.press({ key: 'wf-step:merge' })
    await ui.press({ key: 'wf-toggle:merge' })
    await see(ui, /religar/)
    const after = await keysOf(ui)
    expect(after.at(-1)).toBe('wf-toggle:merge')
    expect(after.includes('wf-step:merge')).toBe(false)
    await ui.press({ key: 'wf-discard' })
    await ui.press({ key: 'wf-back' })
    await ui.unmount()
  }
  expect([...w.disk.keys()].filter(k => k.startsWith(DIR) && !k.endsWith('trunk.json'))).toEqual([])
})

// 10.7 — what the review asked to see exercised

const rapidoDef = () => {
  const raw = DEFAULT_FLOWS.find(f => f.source === 'default flow rapido')!.raw
  const def = parseFlow(raw, 'rapido')
  if ('error' in def) throw new Error(def.error)
  return def
}
const order = (draft: ReturnType<typeof draftOf>) => draft.steps.map(s => `${s.step.id}${s.on ? '' : '(off)'}`)

test('10.7 Subir and Descer swap with the nearest switched-on step; a switched-off one stays put and does not move', () => {
  const def = rapidoDef()
  let draft = toggleStep(draftOf(def, undefined, false), 'validar')
  const ids = def.steps.map(s => s.id)
  expect(ids.slice(0, 3)).toEqual(['planejar', 'validar', 'executar'])
  // executar goes up past the switched-off validar and swaps with planejar
  draft = moveStep(draft, 'executar', -1)
  expect(order(draft).slice(0, 3)).toEqual(['executar', 'validar(off)', 'planejar'])
  // and back down, past validar again
  draft = moveStep(draft, 'executar', 1)
  expect(order(draft).slice(0, 3)).toEqual(['planejar', 'validar(off)', 'executar'])
  // the first switched-on step cannot go up, and a switched-off step does not move at all
  expect(moveStep(draft, 'planejar', -1)).toBe(draft)
  expect(moveStep(draft, 'validar', 1)).toBe(draft)
})

test('10.7 the summary names each change: a step off, back on, an agent swapped, the order', () => {
  const def = rapidoDef()
  const opened = draftOf(def, undefined, false)
  expect(changesOf(opened)).toEqual([])
  let draft = toggleStep(opened, 'qa')
  draft = setStepField(draft, 'revisao-codigo', { field: 'agent', value: 'plan-reviewer' })
  draft = moveStep(draft, 'executar', -1)
  const said = changesOf(draft)
  expect(said).toContain(`passo "${def.steps.find(s => s.id === 'qa')!.title}" desligado`)
  expect(said).toContain(`passo "${def.steps.find(s => s.id === 'revisao-codigo')!.title}": agente`)
  expect(said).toContain('ordem dos passos')
  // switched back on, the step is no longer a change
  expect(changesOf(toggleStep(draft, 'qa')).some(c => c.includes('desligado'))).toBe(false)
})

test('10.7 listAgents: one with no frontmatter shows without a description; a file that is no agent is left out', async () => {
  const disk = new Map<string, string>([
    ['/p/agents/code-reviewer.md', '---\nname: code-reviewer\ndescription: Do plugin.\nmodel: opus\n---\n'],
    ['/p/agents/executor.md', '---\nname: executor\ndescription: Executa uma fase.\nmodel: sonnet\n---\n'],
    ['/w/.orchestrator/agents/sem-cabecalho.md', '# Só o corpo, sem frontmatter\n'],
    ['/w/.orchestrator/agents/notas.txt', 'não é agente'],
    ['/w/.orchestrator/agents/Nome Ruim.md', '---\ndescription: nome inválido\n---\n'],
    ['/w/.orchestrator/agents/code-reviewer.md', '---\nname: code-reviewer\ndescription: O revisor deste projeto.\n---\n'],
  ])
  const engine = {
    plugin: { root: '/p' },
    session: { root: async () => '/w' },
    fs: {
      exists: async (path: string) => [...disk.keys()].some(k => k.startsWith(`${path}/`)),
      list: async (path: string) =>
        [...disk.keys()]
          .filter(k => k.startsWith(`${path}/`))
          .map(k => ({ name: k.slice(path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
      read: async (path: string) => disk.get(path) ?? '',
    },
  }
  const agents = await listAgents(engine as never)
  expect(agents.find(a => a.name === 'executor')).toMatchObject({ source: 'plugin', description: 'Executa uma fase.', model: 'sonnet' })
  const bare = agents.find(a => a.name === 'sem-cabecalho')
  expect(bare).toMatchObject({ source: 'project', description: '' })
  expect(bare?.model).toBeUndefined()
  expect(agents.some(a => a.name === 'notas' || a.name.includes(' ') || a.name === 'Nome Ruim')).toBe(false)
  expect(agents.find(a => a.name === 'code-reviewer')).toMatchObject({ source: 'project', description: 'O revisor deste projeto.' })
  expect(agents.filter(a => a.name === 'code-reviewer')).toHaveLength(1)
})

test('11.1 11.3 11.4 11.6 tags are pills, no brackets; the step summary is plain; the card has no "id · origem" line', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  w.disk.set(`${DIR}/rapido.json`, JSON.stringify({ id: 'rapido', title: 'Rápido do projeto', description: 'O meu.', base: 'rapido' }))
  for (const [surface, columns] of SURFACES) {
    const ui = await mountAny($, surface, columns)
    expect(await ui.find(text(/\[.*\]/))).toBeUndefined()
    expect(await ui.find(text(/^\S+ · (padrão|do projeto|derivado)/))).toBeUndefined()
    // a tag is a Text inside a rounded Box with a background
    const pill = JSON.stringify(await ui.find(text(/^substitui o padrão rapido$/)))
    expect(pill).toContain('substitui o padrão rapido')
    expect(JSON.stringify(await ui.findAll({ type: 'Box', borderStyle: 'round', backgroundColor: '#FDF3E1' } as never))).toContain('substitui o padrão rapido')
    await ui.press({ key: 'wf-open:trunk' })
    await see(ui, /^Uma sessão faz, com o agente planner \(Opus 5\.5, esforço alto\)$/)
    expect(await ui.find(text(/o da sessão/))).toBeUndefined()
    expect(await ui.find(text(/[▸▾]/))).toBeUndefined()
    await ui.press({ key: 'wf-edit' })
    expect(await ui.find(text(/\[(sessão|você|mod)\]/))).toBeUndefined()
    await see(ui, /^sessão$/)
    await see(ui, /^você$/)
    await ui.press({ key: 'wf-discard' })
    await ui.press({ key: 'wf-back' })
    await ui.unmount()
  }
})

test('11.5 editing: one "+ passo aqui" after the open step, Nome e descrição folded, no "Do zero" line', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  const ui = await mount($)
  await ui.press({ key: 'wf-open:trunk' })
  await ui.press({ key: 'wf-edit' })
  expect(await ui.find({ key: 'wf-title' })).toBeUndefined()
  expect(await ui.find(text(/^› Nome e descrição$/))).toBeDefined()
  await ui.press({ key: 'wf-head-toggle' })
  expect(await ui.find({ key: 'wf-title' })).toBeDefined()
  expect(await ui.find({ key: 'wf-description' })).toBeDefined()
  await ui.press({ key: 'wf-head-toggle' })
  const inserts = async () => (await keysOf(ui)).filter(k => k.startsWith('wf-insert:'))
  expect(await inserts()).toEqual(['wf-insert::fim'])
  await ui.press({ key: 'wf-step:merge' })
  expect(await inserts()).toEqual(['wf-insert:merge'])
  await ui.press({ key: 'wf-step:deploy' })
  expect(await inserts()).toEqual(['wf-insert:deploy'])
  await ui.press({ key: 'wf-discard' })
  await ui.unmount()

  const scratch = await mount($)
  await scratch.press({ key: 'wf-back' })
  await scratch.input({ key: 'wf-new-name', text: 'Vazio' })
  await scratch.press({ key: 'wf-new' })
  expect(await scratch.find(text(/Do zero/))).toBeUndefined()
  expect(await keysOf(scratch as unknown as Ui)).toContain('wf-insert::fim')
  await scratch.unmount()
})

test('11.6 a step with no agent says so', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/semagente.json`, JSON.stringify({ id: 'semagente', title: 'Sem agente', description: 'x', steps: [{ id: 'fazer', title: 'Fazer', kind: 'session', outcomes: { pronto: { label: 'Pronto', next: 'fim' } } }] }))
  const ui = await mount($)
  await ui.press({ key: 'wf-open:semagente' })
  expect(await ui.find(text(/^Uma sessão faz, sem agente definido$/))).toBeDefined()
  await ui.unmount()
})

test('a merge step with the workflow-merge agent says the workflow approves it, not GitHub', async ($, on) => {
  const w = world(on)
  const step = { use: 'merge', agent: 'workflow-merge', merge: { branch: 'main', auto: true } }
  w.disk.set(`${DIR}/pelowf.json`, JSON.stringify({ ...TRUNK, id: 'pelowf', add: [{ after: 'pr', step }] }))
  const ui = await mount($, 'terminal', 30)
  await ui.press({ key: 'wf-open:pelowf' })
  // the step's one-line summary in the list says the workflow approves it, too
  expect(await ui.find(text(/Automático · squash em main · quando o workflow aprovou/))).toBeDefined()
  expect(await ui.find(text(/só com PR aprovado e CI verde/))).toBeUndefined()
  await ui.press({ key: 'wf-step:merge' })
  expect(await ui.find(text(/^workflow-merge \(do plugin\)$/))).toBeDefined()
  expect(await ui.find(text(/^Aprovação do workflow: a revisão de código do flow aprovada/))).toBeDefined()
  expect(await ui.find(text(/^Aprovação no GitHub e CI verde/))).toBeUndefined()
  expect(await ui.find(text(/declarada pela coordenação/))).toBeDefined()
  await ui.unmount()
})

test('the merge texts follow the agent: workflow, GitHub, and an unknown project agent promises neither', () => {
  const pt = workflowsText('pt-BR')
  const en = workflowsText('en')
  for (const t of [pt, en]) {
    expect(t.merge.autoHelp('workflow-merge')).not.toMatch(/GitHub/)
    expect(t.merge.autoHelp('merge')).toMatch(/GitHub/)
    expect(t.merge.autoHelp(undefined)).toMatch(/GitHub/)
    expect(t.merge.autoHelp('meu-merge')).not.toMatch(/GitHub/)
    expect(t.merge.approval('meu-merge')).not.toMatch(/GitHub/)
    expect(t.merge.approval('workflow-merge')).toMatch(/aprovado/)
  }
})

/** This repository's rapido.json as the disk holds it, beside its config.json (merge and deploy automatic, routines). */
const repoRapido = (w: World): string => {
  const text$ = `${JSON.stringify(RAPIDO_REPO, null, 2)}\n`
  w.disk.set(`${DIR}/rapido.json`, text$)
  w.disk.set('/w/.orchestrator/config.json', JSON.stringify({ language: { ui: 'pt-BR' }, ...PROJECT }))
  return text$
}
/** `/reload-plugins`: the mod's code loaded again, its `session.start` run again, the state kept. */
const reload = ($: Engine) => $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true } as never)
const repoCopy = () => JSON.parse(JSON.stringify(RAPIDO_REPO)) as { steps: Record<string, unknown>[] }

test('a draft kept from before (the pane drawn again, the command run again) and Salvar with nothing changed leaves the file as it was', async ($, on) => {
  const w = world(on)
  const before = repoRapido(w)
  const ui = await mount($)
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  await ui.unmount()
  // the pane closed and opened again: the editor comes back with the draft, "Salvar" its first button
  await $.command.run({ command: 'orquestrador-workflows' } as never)
  await $.command.run({ command: 'orquestrador-workflows' } as never)
  const again = await mount($)
  expect(await again.find(text(/Editando Rápido \(plugin\)/))).toBeDefined()
  expect(await again.find(text(/Nenhuma mudança ainda/))).toBeDefined()
  await again.press({ key: 'wf-save' })
  // this press used to write the file again, with method squash, auto and the defaults in every step
  expect(w.disk.get(`${DIR}/rapido.json`)).toBe(before)
  expect(await again.find(text(/Nada mudou: \.orchestrator\/flows\/rapido\.json ficou como estava/))).toBeDefined()
  expect(await again.find(text(/Salvo em/))).toBeUndefined()
  await again.unmount()
})

test('after the code reloads, a draft and a notice of the earlier load are set aside: nothing is offered to save', async ($, on) => {
  const w = world(on)
  const before = repoRapido(w)
  const ui = await mount($)
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  await ui.press({ key: 'wf-step:planejar' })
  await ui.select({ key: 'wf-agent:planejar', value: 'executor' })
  expect(await ui.find(text(/passo "Planejar": agente/))).toBeDefined()
  await ui.unmount()

  await reload($)
  const after = await mount($)
  expect(await after.find({ key: 'wf-save' })).toBeUndefined()
  expect(await after.find(text(/Editando/))).toBeUndefined()
  expect(await after.find(text(/O rascunho de Rápido \(plugin\) era de antes de o plugin ser recarregado/))).toBeDefined()
  expect(w.disk.get(`${DIR}/rapido.json`)).toBe(before)
  // a new edit starts from the file, and its save is this load's
  await after.press({ key: 'wf-edit' })
  expect(await after.find(text(/Nenhuma mudança ainda/))).toBeDefined()
  await after.press({ key: 'wf-step:planejar' })
  await after.select({ key: 'wf-agent:planejar', value: 'executor' })
  await after.press({ key: 'wf-save' })
  expect(await after.find(text(/Salvo em \.orchestrator\/flows\/rapido\.json/))).toBeDefined()
  await after.unmount()

  // the "Salvo em" of the earlier load is not shown again after a reload
  await reload($)
  const later = await mount($)
  expect(await later.find(text(/Salvo em/))).toBeUndefined()
  await later.unmount()
})

test('Salvar writes only what changed: the agent alone, in the file\'s order, merge and deploy still following the project', async ($, on) => {
  const w = world(on)
  repoRapido(w)
  const ui = await mount($)
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  await ui.press({ key: 'wf-step:planejar' })
  await ui.select({ key: 'wf-agent:planejar', value: 'executor' })
  await ui.press({ key: 'wf-save' })
  const want = repoCopy()
  want.steps[0]!.agent = 'executor'
  expect(w.disk.get(`${DIR}/rapido.json`)).toBe(`${JSON.stringify(want, null, 2)}\n`)

  // what the project supplies stays the project's: the saved file reads it from config.json still
  const saved = parseFlow(file(w, 'rapido'), 'rapido.json', PROJECT)
  if ('error' in saved) throw new Error(saved.error)
  expect(saved.steps.find(s => s.id === 'merge')?.merge?.fromProject).toEqual(['auto'])
  expect(saved.steps.find(s => s.id === 'deploy')?.deploy?.fromProject).toEqual(expect.arrayContaining(['auto', 'commands']))

  // a merge field changed is the only one the block gains; method and auto stay out
  await ui.press({ key: 'wf-edit' })
  await ui.press({ key: 'wf-step:merge' })
  await ui.input({ key: 'wf-merge-branch:merge', text: 'dev' })
  await ui.press({ key: 'wf-save' })
  want.steps.find(s => s.id === 'merge')!.merge = { branch: 'dev' }
  expect(w.disk.get(`${DIR}/rapido.json`)).toBe(`${JSON.stringify(want, null, 2)}\n`)
  await ui.unmount()
})

test('draftFile: a whole workflow opened from its file and saved unchanged is the file itself, no default nor inherited value added', () => {
  const t = workflowsText(undefined)
  const flow = parseFlow(RAPIDO_REPO, 'rapido.json', PROJECT)
  if ('error' in flow) throw new Error(flow.error)
  const draft = draftOf(flow, undefined, false)
  const out = draftFile(draft, raw => parseFlow(raw, 'rapido.json', PROJECT), t, PROJECT, RAPIDO_REPO as Record<string, unknown>)
  if ('error' in out) throw new Error(out.error)
  expect(JSON.stringify(out.raw, null, 2)).toBe(JSON.stringify(RAPIDO_REPO, null, 2))
  // with no file to follow, the defaults still stay out
  const fresh = draftFile(draft, raw => parseFlow(raw, 'rapido.json', PROJECT), t, PROJECT)
  if ('error' in fresh) throw new Error(fresh.error)
  const text$ = JSON.stringify(fresh.raw)
  for (const field of ['"maxAttempts":3', '"requiresEvidence":false', '"cleanup":false', '"method":"squash"']) expect(text$).not.toContain(field)
})

test('2.5 2.8 a project still on .orquestrador/: the texts name it, the save goes there, and ⚙️ says to rename it', async ($, on) => {
  const w = world(on)
  const OLD = '/w/.orquestrador'
  w.disk.set(`${OLD}/config.json`, JSON.stringify({ merge: { branch: 'main' } }))
  const ui = await mount($)
  expect(await ui.find(text(/Este projeto usa \.orquestrador\/; renomeie para \.orchestrator\//))).toBeDefined()
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  expect(await ui.find(text(/⚠ rapido é um workflow padrão\. Salvar cria \.orquestrador\/flows\/rapido\.json/))).toBeDefined()
  await ui.press({ key: 'wf-step:qa' })
  await ui.press({ key: 'wf-toggle:qa' })
  await ui.press({ key: 'wf-save' })
  expect(await ui.find(text(/\.orquestrador\/flows\/rapido\.json/))).toBeDefined()
  expect(JSON.parse(w.disk.get(`${OLD}/flows/rapido.json`) ?? 'null')).toMatchObject({ id: 'rapido', base: 'rapido', remove: ['qa'] })
  expect([...w.disk.keys()].some(k => k.startsWith('/w/.orchestrator/'))).toBe(false)
  await ui.unmount()
})

test('2.8 a new project: the save names .orchestrator/flows/<id>.json, and ⚙️ shows no rename warning', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  expect(await ui.find(text(/Este projeto usa \.orquestrador\//))).toBeUndefined()
  await ui.press({ key: 'wf-open:rapido' })
  await ui.press({ key: 'wf-edit' })
  await ui.press({ key: 'wf-step:qa' })
  await ui.press({ key: 'wf-toggle:qa' })
  await ui.press({ key: 'wf-save' })
  expect(await ui.find(text(/\.orchestrator\/flows\/rapido\.json/))).toBeDefined()
  expect(file(w, 'rapido')).toMatchObject({ id: 'rapido', remove: ['qa'] })
  expect([...w.disk.keys()].some(k => k.startsWith('/w/.orquestrador/'))).toBe(false)
  await ui.unmount()
})
