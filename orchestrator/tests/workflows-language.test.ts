import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { changesOf, draftOf, toggleStep } from '../hooks/workflow-edit'
import { workflowsText } from '../hooks/i18n-workflows'
import { defaultFlows } from '../hooks/flows/index'

type On = Parameters<TestBody>[1]

const CONFIG = '/w/.orquestrador/config.json'
const EN_UI = JSON.stringify({ language: { ui: 'en', content: 'pt-BR' } })

/** A coordinator at /w with an in-memory disk and the plugin's agents present. */
const world = (on: On): Map<string, string> => {
  mock.store(on)
  const disk = new Map<string, string>()
  const plugin = ['planejador', 'executor', 'revisor-codigo', 'abre-pr', 'merge', 'deploy']
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 1_000) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  const pluginDir = (path: string) => !path.startsWith('/w/') && path.endsWith('/agents')
  const pluginFile = (path: string) => (path.startsWith('/w/') ? undefined : plugin.find(name => path.endsWith(`/agents/${name}.md`)))
  on('fs.exists', ($, e) => ({
    value: disk.has(e.path) || [...disk.keys()].some(k => k.startsWith(`${e.path}/`)) || pluginDir(e.path) || pluginFile(e.path) !== undefined,
  }))
  on('fs.read', ($, e) => {
    const name = pluginFile(e.path)
    if (name !== undefined && !disk.has(e.path)) return { value: `---\nname: ${name}\ndescription: ${name}.\nmodel: sonnet\n---\n` }
    return { value: disk.get(e.path) ?? '' }
  })
  on('fs.write', ($, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: (pluginDir(e.path) ? plugin.map(name => `${e.path}/${name}.md`) : [...disk.keys()])
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
  }))
  on('tool.list', () => ({ value: [] as never }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return disk
}

const mount = ($: Engine) =>
  $.ui.mount({
    plugin: 'orchestrator',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'orchestrator-workflows',
    props: { title: '⚙️ Workflows', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} },
  } as const)
type Ui = Awaited<ReturnType<typeof mount>>

const see = async (ui: Ui, pattern: RegExp) => {
  if ((await ui.find({ type: 'Text', text: pattern })) === undefined) throw new Error(`not on screen: ${String(pattern)}`)
}
const missing = async (ui: Ui, pattern: RegExp) => {
  if ((await ui.find({ type: 'Text', text: pattern })) !== undefined) throw new Error(`still on screen: ${String(pattern)}`)
}
const button = async (ui: Ui, key: string) => JSON.stringify(await ui.find({ key }))

test('ui "en": the list, an open workflow and the editor speak English; descriptions and details stay in the content language', async ($, on) => {
  const disk = world(on)
  disk.set(CONFIG, EN_UI)
  const ui = await mount($)

  // the list
  await see(ui, /^Workflows$/)
  await see(ui, /^The paths a change can follow in this project/)
  await see(ui, /^PLUGIN DEFAULTS$/)
  await see(ui, /^Full ›$/)
  await see(ui, /^Do entendimento ao arquivamento/)
  await see(ui, /^New workflow$/)
  expect(await button(ui, 'wf-new')).toContain('Create and edit')
  await missing(ui, /Os caminhos que uma change pode seguir/)

  // an open workflow: English titles from the default flow
  await ui.press({ key: 'wf-open:completo' })
  expect(await button(ui, 'wf-edit')).toContain('Edit')
  expect(await button(ui, 'wf-back')).toContain('← Workflows')
  await see(ui, /^default$/)
  await see(ui, /a session does it/)
  await see(ui, /you approve/)
  await see(ui, /^Understanding$/)
  await see(ui, /^Plan OpenSpec$/)
  await missing(ui, /^Entendimento$/)
  await ui.press({ key: 'wf-step:grill' })
  await see(ui, /^Who does it$/)
  await see(ui, /^Receives$/)
  await see(ui, /^If rejected$/)
  await see(ui, /^You approve or confirm$/)
  // details follow the content language, pt-BR here
  await see(ui, /^O pedido do dono/)

  // the editor
  await ui.press({ key: 'wf-edit' })
  expect(await button(ui, 'wf-save')).toContain('Save')
  expect(await button(ui, 'wf-discard')).toContain('Discard')
  await see(ui, /^Draft: nothing is written until you save\.$/)
  await see(ui, /^No changes yet\.$/)
  await see(ui, /^Understanding$/)
  await see(ui, /^\+ step here$/)
  await see(ui, /^STEPS$/)
  await ui.unmount()
})

test('without config.json the pane stays in Portuguese', async ($, on) => {
  world(on)
  const ui = await mount($)
  await see(ui, /^Os caminhos que uma change pode seguir/)
  await see(ui, /^PADRÕES DO PLUGIN$/)
  await see(ui, /^Completo ›$/)
  await ui.press({ key: 'wf-open:completo' })
  expect(await button(ui, 'wf-edit')).toContain('Editar')
  await see(ui, /^Entendimento$/)
  await see(ui, /^Planejar OpenSpec$/)
  await missing(ui, /^Understanding$/)
  await ui.unmount()
})

test('an invalid config.json falls back to Portuguese', async ($, on) => {
  const disk = world(on)
  disk.set(CONFIG, '{ not json')
  const ui = await mount($)
  await see(ui, /^Os caminhos que uma change pode seguir/)
  await ui.unmount()
})

test('the editor summary speaks the language it is given; pt-BR by default', () => {
  const full = defaultFlows().find(f => f.id === 'completo')!
  const d = toggleStep(draftOf(full, undefined, true), 'grill')
  expect(changesOf(d)).toEqual(['passo "Entendimento" desligado'])
  expect(changesOf(d, workflowsText('en'))).toEqual(['step "Understanding" switched off'])
})
