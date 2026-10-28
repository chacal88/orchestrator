import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { ConfigDraft } from '../types'
import { applyConfigChange, configChanges, configText, draftOfConfig } from '../hooks/project-edit'
import { workflowsText } from '../hooks/i18n-workflows'

type On = Parameters<TestBody>[1]
type Surface = 'desktop' | 'terminal' | 'mobile'

const DIR = '/w/.orchestrator/flows'
const CONFIG = '/w/.orchestrator/config.json'

type World = { disk: Map<string, string>; panes: { id: string; title: string }[]; toasts: string[] }

/** A coordinator at /w with an in-memory disk and the plugin's agents present. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), panes: [], toasts: [] }
  const plugin = ['planner', 'executor', 'code-reviewer', 'pr-opener', 'merge', 'deploy']
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 1_000) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  const pluginDir = (path: string) => !path.startsWith('/w/') && path.endsWith('/agents')
  const pluginFile = (path: string) => (path.startsWith('/w/') ? undefined : plugin.find(name => path.endsWith(`/agents/${name}.md`)))
  on('fs.exists', ($, e) => ({
    value: w.disk.has(e.path) || [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) || pluginDir(e.path) || pluginFile(e.path) !== undefined,
  }))
  on('fs.read', ($, e) => {
    const name = pluginFile(e.path)
    if (name !== undefined && !w.disk.has(e.path)) return { value: `---\nname: ${name}\ndescription: Descrição do ${name}.\nmodel: sonnet\ntools: Read\n---\n# ${name}\n` }
    return { value: w.disk.get(e.path) ?? '' }
  })
  on('fs.write', ($, e) => {
    w.disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: (pluginDir(e.path) ? plugin.map(name => `${e.path}/${name}.md`) : [...w.disk.keys()])
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
  }))
  on('tool.list', () => ({ value: [] as never }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
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
    props: { title: '⚙️ Workflows', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
  }) as const

const mount = <S extends Surface = 'desktop'>($: Engine, surface: S = 'desktop' as S, columns = 60) =>
  $.ui.mount({ plugin: 'orchestrator', surface, ...pane(columns) })
const text = (pattern: RegExp) => ({ type: 'Text', text: pattern }) as const
const json = (w: World, path: string) => JSON.parse(w.disk.get(path) ?? 'null') as Record<string, unknown> | null

const TRUNK = {
  id: 'trunk',
  title: 'Trunk',
  description: 'PR direto na main.',
  base: 'rapido',
  remove: ['qa'],
  add: [
    { after: 'pr', step: 'revisao-pr' },
    { after: 'revisao-pr', step: { use: 'merge', merge: { branch: 'main', auto: false } } },
    { after: 'merge', step: { use: 'deploy' } },
  ],
}
const CFG = { language: 'pt-BR', merge: { branch: 'develop', method: 'rebase', auto: true }, deploy: { ci: true, commands: ['npm run migrate:prod'] } }

test('2.1 the list opens with "Este projeto": language, merge and deploy in three lines, then "Configurar"', async ($, on) => {
  const w = world(on)
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const ui = await mount($, surface, surface === 'mobile' ? 30 : 60)
    expect(await ui.find(text(/^Este projeto$/))).toBeDefined()
    expect(await ui.find(text(/^Idioma$/))).toBeDefined()
    expect(await ui.find(text(/^Português nas caixas e nos textos$/))).toBeDefined()
    // no file: the plugin's defaults, and the pills say who does it (a pill is a box, never brackets)
    expect(await ui.find(text(/^Na main, por squash$/))).toBeDefined()
    expect(await ui.find(text(/^você faz$/))).toBeDefined()
    expect(await ui.find(text(/^Espera o CI$/))).toBeDefined()
    expect(await ui.find(text(/^você confirma$/))).toBeDefined()
    expect(await ui.find(text(/Vale para os passos de merge e deploy de todos os workflows, a menos que um passo diga outra coisa\./))).toBeDefined()
    expect(await ui.find({ key: 'cfg-open' })).toBeDefined()
    expect(await ui.find(text(/^\[/))).toBeUndefined()
    await ui.unmount()
  }
})

test('2.1 the summary follows config.json; a workflow with no merge step wears an amber pill', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify({ ...CFG, language: { ui: 'pt-BR', content: 'en' } }))
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  const ui = await mount($)
  expect(await ui.find(text(/^Português nas caixas, Inglês nos textos$/))).toBeDefined()
  expect(await ui.find(text(/^Na develop, por rebase$/))).toBeDefined()
  expect(await ui.find(text(/^Espera o CI e roda npm run migrate:prod$/))).toBeDefined()
  expect(await ui.find(text(/^automático$/))).toBeDefined()
  // Rápido and Completo have no merge step; Trunk has one
  expect((await ui.findAll(text(/^sem passo de merge$/))).length).toBe(2)
  await ui.unmount()
})

test('2.1 a wrong value in config.json is named under the summary and left out', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify({ merge: { method: 'fast' } }))
  const ui = await mount($)
  expect(await ui.find(text(/1 valor do config\.json ignorado/))).toBeUndefined()
  expect(await ui.find(text(/config\.json: merge\.method must be one of squash, merge, rebase/))).toBeDefined()
  expect(await ui.find(text(/^Na main, por squash$/))).toBeDefined()
  await ui.unmount()
})

test('2.2 "Configurar" opens a draft with the bar, the blocks of the mockup and an explanation under each field; nothing is written', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify({ merge: { branch: 'main' }, deploy: { commands: ['npm run migrate:prod'] } }))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  expect(await ui.find(text(/^Configurações do projeto$/))).toBeDefined()
  expect(await ui.find(text(/Rascunho: nada é gravado até salvar\./))).toBeDefined()
  expect(await ui.find(text(/Nenhuma mudança ainda/))).toBeDefined()
  expect(await ui.find({ key: 'cfg-save' })).toBeDefined()
  expect(await ui.find({ key: 'cfg-discard' })).toBeDefined()
  expect(await ui.find(text(/Fica gravado em \.orchestrator\/config\.json\./))).toBeDefined()
  // section labels in capitals
  for (const label of ['IDIOMA', 'MERGE', 'DEPLOY', 'NOS WORKFLOWS']) expect(await ui.find(text(new RegExp(`^${label}$`)))).toBeDefined()
  // buttons say the state; each field has its explanation
  expect(JSON.stringify(await ui.find({ key: 'cfg-merge-auto' }))).toContain('Fazer o merge sozinho: não')
  expect(JSON.stringify(await ui.find({ key: 'cfg-deploy-auto' }))).toContain('Fazer o deploy sozinho: não')
  expect(JSON.stringify(await ui.find({ key: 'cfg-deploy-ci' }))).toContain('Esperar o deploy do CI: sim')
  expect(await ui.find(text(/A coordenação faz o merge assim que o PR estiver aprovado/))).toBeDefined()
  expect(await ui.find(text(/Trunk-based: main\. Com dev e master/))).toBeDefined()
  expect(await ui.find(text(/Botões, cabeçalhos, status e títulos dos passos nos painéis/))).toBeDefined()
  expect(await ui.find(text(/Em que língua a coordenação escreve proposta/))).toBeDefined()
  expect(await ui.find(text(/Comandos rodados nesta ordem depois do merge/))).toBeDefined()
  expect(await ui.find({ key: 'cfg-routine:0' })).toBeDefined()
  expect(await ui.find(text(/^Rotinas fora do CI$/))).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'cfg-routine-del:0' }))).toContain('tirar')
  expect(await ui.find(text(/^\+ rotina$/))).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'cfg-merge-method' }))).toContain('Squash: vira um commit só')

  // edits stay in the draft, summarised on the bar
  await ui.press({ key: 'cfg-merge-auto' })
  expect(JSON.stringify(await ui.find({ key: 'cfg-merge-auto' }))).toContain('Fazer o merge sozinho: sim')
  expect(await ui.find(text(/^1 mudança: merge automático ligado\.$/))).toBeDefined()
  await ui.input({ key: 'cfg-merge-branch', text: 'develop' })
  await ui.select({ key: 'cfg-merge-method', value: 'rebase' })
  await ui.select({ key: 'cfg-ui', value: 'en' })
  await ui.press({ key: 'cfg-routine-add' })
  await ui.input({ key: 'cfg-routine-new', text: 'npm run warm' })
  expect(await ui.find({ key: 'cfg-routine:1' })).toBeDefined()
  await ui.press({ key: 'cfg-routine-del:0' })
  expect(await ui.find({ key: 'cfg-routine:1' })).toBeUndefined()
  expect(
    await ui.find(text(/^5 mudanças: caixas e títulos em English; branch do merge: develop; merge por rebase; merge automático ligado; rotinas do deploy\.$/)),
  ).toBeDefined()
  expect(JSON.parse(w.disk.get(CONFIG) ?? '{}')).toEqual({ merge: { branch: 'main' }, deploy: { commands: ['npm run migrate:prod'] } })

  // the draft outlives a redraw; Descartar throws it away
  await ui.unmount()
  const again = await mount($)
  expect(await again.find({ key: 'cfg-save' })).toBeDefined()
  await again.press({ key: 'cfg-discard' })
  expect(await again.find({ key: 'cfg-save' })).toBeUndefined()
  expect(await again.find({ key: 'cfg-open' })).toBeDefined()
  expect(JSON.parse(w.disk.get(CONFIG) ?? '{}').merge).toEqual({ branch: 'main' })
  await again.unmount()
})

test('2.4 Salvar changes only the keys that changed and keeps the others of the file', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify({ name: 'meu-projeto', jira: { site: 'x' }, language: 'en', merge: { branch: 'main', note: 'keep' }, deploy: { ci: true } }, null, 2))
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-merge-auto' })
  await ui.select({ key: 'cfg-content', value: 'pt-BR' })
  await ui.press({ key: 'cfg-save' })
  expect(JSON.parse(w.disk.get(CONFIG) ?? '{}')).toEqual({
    name: 'meu-projeto',
    jira: { site: 'x' },
    language: { ui: 'en', content: 'pt-BR' },
    merge: { branch: 'main', note: 'keep', auto: true },
    deploy: { ci: true },
  })
  // back on the list, the summary shows what was saved, in the language just saved
  expect(await ui.find({ key: 'cfg-save' })).toBeUndefined()
  expect(await ui.find(text(/Settings saved in \.orchestrator\/config\.json\./))).toBeDefined()
  expect(await ui.find(text(/^Into main, by squash$/))).toBeDefined()
  await ui.unmount()
})

test('2.4 with no config.json the file is created with only what was set; no change writes nothing', async ($, on) => {
  const w = world(on)
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-save' })
  expect(w.disk.has(CONFIG)).toBe(false)
  expect(await ui.find(text(/Nada mudou; nada foi gravado\./))).toBeDefined()
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-deploy-auto' })
  await ui.press({ key: 'cfg-save' })
  expect(JSON.parse(w.disk.get(CONFIG) ?? '{}')).toEqual({ deploy: { auto: true } })
  await ui.unmount()
})

test('2.4 a config.json that is not JSON, or not an object, is never written over', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, '{ not json')
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-merge-auto' })
  await ui.press({ key: 'cfg-save' })
  expect(await ui.find(text(/Não salvei: \.orchestrator\/config\.json não é um JSON válido/))).toBeDefined()
  expect(w.disk.get(CONFIG)).toBe('{ not json')
  await ui.press({ key: 'cfg-discard' })
  w.disk.set(CONFIG, '[1]')
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-merge-auto' })
  await ui.press({ key: 'cfg-save' })
  expect(await ui.find(text(/não é um objeto JSON/))).toBeDefined()
  expect(w.disk.get(CONFIG)).toBe('[1]')
  await ui.unmount()
})

test('2.4 a branch left empty is a value config.json would name as wrong: nothing is written', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify({ merge: { branch: 'main' } }))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  await ui.input({ key: 'cfg-merge-branch', text: '' })
  await ui.press({ key: 'cfg-save' })
  expect(await ui.find(text(/merge\.branch must be a branch name/))).toBeDefined()
  expect(JSON.parse(w.disk.get(CONFIG) ?? '{}')).toEqual({ merge: { branch: 'main' } })
  await ui.unmount()
})

test('2.3 "Nos workflows": each workflow says how it stands, and "Acrescentar merge e deploy" writes through the editor after a confirmation', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify(CFG))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  expect(await ui.find(text(/não tem passo de merge nem de deploy: estas opções não valem para ele\./))).toBeDefined()
  expect(await ui.find({ key: 'cfg-add:rapido' })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'cfg-add:rapido' }))).toContain('Acrescentar merge e deploy ao Rápido')

  // the press only asks; nothing is written until the confirmation
  await ui.press({ key: 'cfg-add:rapido' })
  expect(await ui.find(text(/Acrescentar merge e deploy ao Rápido\? O passo entra com o que o projeto define\./))).toBeDefined()
  expect(await ui.find(text(/Isso cria \.orchestrator\/flows\/rapido\.json/))).toBeDefined()
  expect(w.disk.has(`${DIR}/rapido.json`)).toBe(false)
  await ui.press({ key: 'cfg-cancel' })
  expect(await ui.find({ key: 'cfg-confirm' })).toBeUndefined()
  await ui.press({ key: 'cfg-add:rapido' })
  await ui.press({ key: 'cfg-confirm' })

  const file = json(w, `${DIR}/rapido.json`) as { base: string; add: { after: string; step: Record<string, unknown> }[] }
  expect(file.base).toBe('rapido')
  expect(file.add.map(a => [a.after, a.step.use])).toEqual([['pr', 'merge'], ['merge', 'deploy']])
  // the project's values are not copied into the workflow
  expect(JSON.stringify(file)).not.toContain('develop')
  expect(JSON.stringify(file)).not.toContain('migrate:prod')
  expect(await ui.find(text(/Rápido salvo em \.orchestrator\/flows\/rapido\.json\./))).toBeDefined()
  expect(await ui.find(text(/Rápido usa o merge e o deploy daqui\./))).toBeDefined()
  expect(await ui.find({ key: 'cfg-add:rapido' })).toBeUndefined()
  await ui.unmount()
})

test('2.3 "Passar a usar o do projeto" is offered where a step keeps its own value', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify(CFG))
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  expect(await ui.find(text(/Trunk tem o próprio valor no passo de merge \(branch main, manual\) e continua com ele\./))).toBeDefined()
  expect(await ui.find({ key: 'cfg-use:trunk' })).toBeDefined()
  expect(await ui.find(text(/^Passar a usar o do projeto$/))).toBeDefined()
  expect(await ui.find({ key: 'cfg-use:rapido' })).toBeUndefined()
  await ui.unmount()
})

test('2.3 adding to a workflow that others derive from is refused when they would stop resolving', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify(CFG))
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-add:rapido' })
  await ui.press({ key: 'cfg-confirm' })
  expect(await ui.find(text(/^Não mexi em Rápido: os workflows que derivam de rapido deixariam de resolver; nada foi gravado\./))).toBeDefined()
  expect(w.disk.has(`${DIR}/rapido.json`)).toBe(false)
  await ui.unmount()
})

test('2.3 "Passar a usar o do projeto" takes the step\'s own values out, after a confirmation', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify(CFG))
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-use:trunk' })
  expect(await ui.find(text(/Passar o merge e o deploy de Trunk para o do projeto\?/))).toBeDefined()
  expect(json(w, `${DIR}/trunk.json`)).toEqual(TRUNK)
  await ui.press({ key: 'cfg-confirm' })
  const file = json(w, `${DIR}/trunk.json`) as { add: { step: { use: string; merge?: Record<string, unknown> } }[] }
  const merge = file.add.find(a => a.step.use === 'merge')!.step
  expect(merge.merge?.branch).toBeUndefined()
  expect(merge.merge?.auto).toBeUndefined()
  expect(await ui.find(text(/Trunk usa o merge e o deploy daqui\./))).toBeDefined()
  expect(await ui.find({ key: 'cfg-use:trunk' })).toBeUndefined()
  await ui.unmount()
})

test('2.3 the action goes through the editor\'s own checks: a file that already holds the id stops it, and nothing is written', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify(CFG))
  w.disk.set(`${DIR}/rapido.json`, '{ not json')
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-add:rapido' })
  await ui.press({ key: 'cfg-confirm' })
  expect(await ui.find(text(/^Não mexi em Rápido: já existe \.orchestrator\/flows\/rapido\.json com o id ou o nome rapido; nada foi gravado/))).toBeDefined()
  expect(w.disk.get(`${DIR}/rapido.json`)).toBe('{ not json')
  expect(w.toasts.some(x => x.startsWith('Não mexi em Rápido'))).toBe(true)
  await ui.unmount()
})

test('2.3 a workflow derived from another is taken back to the project the same way, and stays derived', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify(CFG))
  w.disk.set(`${DIR}/trunk.json`, JSON.stringify(TRUNK))
  w.disk.set(`${DIR}/outro.json`, JSON.stringify({ id: 'outro', title: 'Outro', base: 'trunk', override: { merge: { merge: { branch: 'release' } } } }))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  expect(await ui.find(text(/Outro tem o próprio valor no passo de merge \(branch release, manual\)/))).toBeDefined()
  await ui.press({ key: 'cfg-use:outro' })
  await ui.press({ key: 'cfg-confirm' })
  expect(await ui.find(text(/Outro salvo em \.orchestrator\/flows\/outro\.json\./))).toBeDefined()
  expect(json(w, `${DIR}/outro.json`)).toMatchObject({ id: 'outro', base: 'trunk' })
  expect(await ui.find(text(/Outro usa o merge e o deploy daqui\./))).toBeDefined()
  await ui.unmount()
})

test('2.5 every surface: the terminal and the narrow desktop stack, mobile has the buttons but no fields', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify(CFG))
  for (const [surface, columns] of [['desktop', 60], ['terminal', 60], ['terminal', 30], ['mobile', 30]] as const) {
    const ui = await mount($, surface, columns)
    await ui.press({ key: 'cfg-open' })
    expect(await ui.find(text(/^Configurações do projeto$/))).toBeDefined()
    expect(await ui.find({ key: 'cfg-save' })).toBeDefined()
    expect(await ui.find({ key: 'cfg-merge-auto' })).toBeDefined()
    expect(await ui.find({ key: 'cfg-deploy-ci' })).toBeDefined()
    expect(await ui.find({ key: 'cfg-add:rapido' })).toBeDefined()
    if (surface === 'mobile') {
      expect(await ui.find({ key: 'cfg-merge-branch' })).toBeUndefined()
      expect(await ui.find({ key: 'cfg-ui' })).toBeUndefined()
      expect(await ui.find(text(/Os campos de texto e de escolha ficam no desktop e no terminal\./))).toBeDefined()
      expect(await ui.find(text(/1\. npm run migrate:prod/))).toBeDefined()
    } else {
      expect(await ui.find({ key: 'cfg-merge-branch' })).toBeDefined()
      expect(await ui.find({ key: 'cfg-ui' })).toBeDefined()
    }
    // the toggle works on every surface
    await ui.press({ key: 'cfg-deploy-auto' })
    expect(await ui.find(text(/^1 mudança: deploy automático ligado\.$/))).toBeDefined()
    await ui.press({ key: 'cfg-discard' })
    await ui.unmount()
  }
})

test('the draft logic: changes are read against the file, an untouched value is not a change and is not written', () => {
  const t = workflowsText('pt-BR')
  const draft = draftOfConfig({ ui: 'pt-BR', content: 'pt-BR' }, { merge: { branch: 'main' }, deploy: {} })
  expect(configChanges(draft, t)).toEqual([])
  // toggling twice, or setting a default, is no change
  const twice = applyConfigChange(applyConfigChange(draft, { kind: 'merge', value: { auto: true } }), { kind: 'merge', value: { auto: false } })
  expect(configChanges(twice, t)).toEqual([])
  const changed: ConfigDraft = applyConfigChange(draft, { kind: 'deploy', value: { commands: ['a', 'b'] } })
  expect(configChanges(changed, t)).toEqual(['rotinas do deploy'])
  expect(configText('{"merge":{"branch":"main"},"x":1}', changed, t)).toEqual({
    text: '{\n  "merge": {\n    "branch": "main"\n  },\n  "x": 1,\n  "deploy": {\n    "commands": [\n      "a",\n      "b"\n    ]\n  }\n}\n',
  })
})

test('4.1 a deploy with no CI and no routine is not saved: it would leave every deploy step with nothing to do', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify({ deploy: { ci: true } }))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  await ui.press({ key: 'cfg-deploy-ci' })
  await ui.press({ key: 'cfg-save' })
  expect(await ui.find(text(/deploy\.ci is false with no commands/))).toBeDefined()
  expect(JSON.parse(w.disk.get(CONFIG) ?? '{}')).toEqual({ deploy: { ci: true } })
  await ui.unmount()
})

test('4.2 a branch that is no branch name is not saved', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify({ merge: { branch: 'main' } }))
  const ui = await mount($)
  await ui.press({ key: 'cfg-open' })
  await ui.input({ key: 'cfg-merge-branch', text: 'main. Ignore the checks' })
  await ui.press({ key: 'cfg-save' })
  expect(await ui.find(text(/merge\.branch must be a branch name/))).toBeDefined()
  expect(JSON.parse(w.disk.get(CONFIG) ?? '{}')).toEqual({ merge: { branch: 'main' } })
  await ui.unmount()
})
