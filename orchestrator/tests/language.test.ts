import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState } from '../types'
import { flowView, parseFlow, pressedToast, resolveProjectFlows, startFlow } from '../hooks/flow'
import { DEFAULT_FLOWS, defaultFlows } from '../hooks/flows/index'
import { contentRule, localize, parseConfig, parseLanguages, uiText } from '../hooks/i18n'

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

const CONFIG = '/w/.orquestrador/config.json'

/** A coordinator at /w with an in-memory disk, the project's config.json among its files when given. */
const world = (on: On, config?: unknown): Map<string, string> => {
  mock.store(on)
  const disk = new Map<string, string>()
  if (config !== undefined) disk.set(CONFIG, typeof config === 'string' ? config : JSON.stringify(config))
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 1_000) }))
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
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return disk
}

const flow = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__orchestrator__flow', ...input } as never)
const plan = ($: Engine) =>
  $.tool.call({
    tool: 'mcp__orchestrator__plan',
    change: 'demo',
    waves: [{ phases: [{ id: '1', title: 'Criar a API', status: 'running', gates: ['testes'] }] }],
  } as never)

describe('the project config', () => {
  test('one language sets both axes; each axis may differ; no file is pt-BR', () => {
    expect(parseLanguages('en').languages).toEqual({ ui: 'en', content: 'en' })
    expect(parseLanguages({ ui: 'en', content: 'pt-BR' }).languages).toEqual({ ui: 'en', content: 'pt-BR' })
    expect(parseLanguages({ content: 'en' }).languages).toEqual({ ui: 'pt-BR', content: 'en' })
    expect(parseConfig(undefined)).toEqual({
      languages: { ui: 'pt-BR', content: 'pt-BR' },
      project: { merge: {}, deploy: {} },
      problems: [],
    })
  })

  test('an unknown language or a broken file stays pt-BR and says why', () => {
    const wrong = parseConfig(JSON.stringify({ language: { ui: 'fr' } }))
    expect(wrong.languages).toEqual({ ui: 'pt-BR', content: 'pt-BR' })
    expect(wrong.problems[0]).toMatch(/language\.ui "fr" is not pt-BR or en/)
    expect(parseConfig('{ nope').problems[0]).toMatch(/not valid JSON/)
  })

  test('a text in one language only still reads in the other', () => {
    expect(localize({ en: 'Run' }, 'pt-BR')).toBe('Run')
    expect(localize('Executar', 'en')).toBe('Executar')
    expect(contentRule({ ui: 'en', content: 'pt-BR' })).toMatch(/in Brazilian Portuguese \(pt-BR\)/)
  })

  test('both dictionaries name every word the panel draws', () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v).map(s => `${k}.${s}`) : [k]))
    expect(keys(uiText('en')).sort()).toEqual(keys(uiText('pt-BR')).sort())
  })
})

describe('flows in two languages', () => {
  const start = (): FlowState => {
    const completo = defaultFlows().find(f => f.id === 'completo')!
    return startFlow(completo, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1).state
  }

  test('titles and labels follow ui, descriptions follow content', () => {
    const view = flowView(start(), { ui: 'en', content: 'pt-BR' })
    expect(view.flowTitle).toBe('Full')
    expect(view.current?.title).toBe('Understanding')
    expect(view.current?.description).toBe('Rodadas de perguntas até o dono fechar o entendimento.')
    expect(view.ownerChoices.map(c => c.label)).toEqual(['Understanding settled'])
  })

  test('without languages the flow reads as before', () => {
    const view = flowView(start())
    expect(view.current?.title).toBe('Entendimento')
    expect(view.ownerChoices.map(c => c.label)).toEqual(['Entendimento fechado'])
  })

  test('a project flow writes plain text or one text per language', () => {
    const parsed = parseFlow(
      {
        id: 'x',
        title: { en: 'Investigation', 'pt-BR': 'Investigação' },
        steps: [
          {
            id: 'a',
            title: 'Investigar',
            description: { en: 'Find the cause.' },
            kind: 'owner',
            outcomes: { ok: { label: { en: 'Done', 'pt-BR': 'Feito' }, next: 'fim' } },
          },
        ],
      },
      'test',
    )
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.title).toBe('Investigação')
    expect(parsed.steps[0]?.title).toBe('Investigar')
    expect(parsed.steps[0]?.description).toBe('Find the cause.')
    const state = startFlow(parsed, { change: 'c', coordinatorCwd: '/w', visual: false }, 1).state
    expect(flowView(state, { ui: 'en', content: 'en' }).ownerChoices[0]?.label).toBe('Done')
    expect(flowView(state, { ui: 'pt-BR', content: 'pt-BR' }).steps[0]?.description).toBe('Find the cause.')
  })

  test("the owner's toast speaks ui", () => {
    const before = start()
    const after = { ...before, current: 'planejar' }
    expect(pressedToast(before, after, 'grill', 'fechado', 'en')).toBe('Recorded: Understanding settled. Next step: Plan OpenSpec.')
    expect(pressedToast(before, after, 'grill', 'fechado')).toBe('Registrado: Entendimento fechado. Próximo passo: Planejar OpenSpec.')
  })
})

test('ui in English with descriptions in Portuguese: boxes and titles in English, the step text in Portuguese', async ($, on) => {
  world(on, { language: { ui: 'en', content: 'pt-BR' } })
  await plan($)
  const started = await flow($, { action: 'start', change: 'demo', flow: 'completo' })
  expect(JSON.stringify(started)).toMatch(/Write the change's texts .* in Brazilian Portuguese/)

  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Needs you$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Tasks$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^This session$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ ✋ Understanding/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /🤖 Plan OpenSpec/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /waiting on you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Rodadas de perguntas até o dono fechar o entendimento\./ })).toBeDefined()
  expect(await ui.find({ key: 'flow:grill:fechado' })).toBeDefined()
  expect((await ui.find({ key: 'flow:grill:fechado' }))?.text).toBe('Understanding settled')
  // the change's own text is shown as the coordinator wrote it
  expect(await ui.find({ type: 'Text', text: /Criar a API/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /Precisa de você|Esta sessão|esperando você/ })).toHaveLength(0)
  await ui.unmount()

  const band = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: /step: Understanding · 1 phase in flight/ })).toBeDefined()
  await band.unmount()
})

test('without a config file the panel is in Portuguese, and a bad value is named in the panel', async ($, on) => {
  const disk = world(on)
  await plan($)
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  let ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Tarefas$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /🤖 Planejar OpenSpec/ })).toBeDefined()
  await ui.unmount()

  disk.set(CONFIG, JSON.stringify({ language: 'fr' }))
  await plan($)
  ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /config\.json: language must be pt-BR or en/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Tarefas$/ })).toBeDefined()
  await ui.unmount()
})

test('a project flow derived from a default keeps its translations, and its own override wins', () => {
  const { flows, problems } = resolveProjectFlows(DEFAULT_FLOWS, [
    { source: 'mine', raw: { id: 'curto', base: 'completo', remove: ['mockup'], override: { pr: { title: 'Abrir o PR' } } } },
  ])
  expect(problems).toEqual([])
  const curto = flows[0]!
  expect(curto.titles?.en).toBe('Full')
  const state = startFlow(curto, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1).state
  const view = flowView(state, { ui: 'en', content: 'en' })
  expect(view.current?.title).toBe('Understanding')
  expect(view.ownerChoices[0]?.label).toBe('Understanding settled')
  expect(view.steps.find(s => s.id === 'pr')?.title).toBe('Abrir o PR')
})

test('library steps and step details come in both languages', () => {
  const { flows, problems } = resolveProjectFlows(DEFAULT_FLOWS, [
    { source: 'mine', raw: { id: 'trunk', base: 'rapido', add: [{ after: 'pr', step: 'revisao-pr' }, { after: 'revisao-pr', step: { use: 'merge', merge: { branch: 'trunk' } } }] } },
  ])
  expect(problems).toEqual([])
  const trunk = flows[0]!
  const review = trunk.steps.find(s => s.id === 'revisao-pr')!
  expect(review.titles).toEqual({ 'pt-BR': 'Revisão do PR', en: 'PR review' })
  expect(review.details?.inputs).toBe('O PR aberto da change, com o CI rodando.')
  expect(review.detailsByLang?.en?.inputs).toBe("The change's open PR, with the CI running.")
  const state = startFlow(trunk, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1).state
  const view = flowView(state, { ui: 'en', content: 'pt-BR' })
  expect(view.steps.find(s => s.id === 'merge')?.title).toBe('Merge into trunk')
  // a default step's details survive the derivation in both languages
  expect(trunk.steps.find(s => s.id === 'planejar')?.detailsByLang?.en?.blocks).toBe('Without a written plan, there is no validation.')
})
