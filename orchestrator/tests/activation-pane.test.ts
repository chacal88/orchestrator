import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'


type On = Parameters<TestBody>[1]
type Surface = 'desktop' | 'terminal' | 'mobile'

const DIR = '/w/.orquestrador/flows'
const CONFIG = '/w/.orquestrador/config.json'
const MARK = '/w/.claude/settings.local.json'

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
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } as never }))
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

const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const OTHER = { permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } }

test('2.1 inactive: the card says the plugin is quiet, offers "Ativar neste clone" beside "Configurar", and writes nothing', async ($, on) => {
  const w = world(on)
  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const ui = await mount($, surface, surface === 'mobile' ? 30 : 60)
    expect(await ui.find(text(/^Este projeto$/))).toBeDefined()
    expect(await ui.find(text(/^inativo neste clone$/))).toBeDefined()
    expect(await ui.find(text(/O orquestrador está quieto aqui: sem painel abrindo sozinho/))).toBeDefined()
    expect((await ui.find({ key: 'act-open' }))?.text).toBe('Ativar neste clone')
    expect(await ui.find({ key: 'cfg-open' })).toBeDefined()
    expect(await ui.find({ key: 'act-off' })).toBeUndefined()
    // pills are boxes, never words between brackets
    expect(await ui.find(text(/^\[/))).toBeUndefined()
    await ui.unmount()
  }
  expect(w.disk.has(MARK)).toBe(false)
})

test('2.1 "Ativar neste clone" opens the confirmation with the level and "O que é gravado"; Cancelar writes nothing', async ($, on) => {
  const w = world(on)
  for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
    const ui = await mount($, surface, surface === 'mobile' ? 30 : 60)
    await ui.press({ key: 'act-open' })
    await settle()
    expect(await ui.find(text(/^Ativar o orquestrador neste clone$/))).toBeDefined()
    // a field where the surface has one; two buttons on the mobile
    if (surface === 'mobile') {
      expect((await ui.find({ key: 'act-level:barrar' }))?.text).toBe('Barrar: segue o flow e recusa merge e deploy fora dele')
      expect((await ui.find({ key: 'act-level:lembrar' }))?.text).toBe('Lembrar: só põe o flow e as regras na conversa; merge com --admin, merge sem revisão e pulo de portões deixam de ser barrados')
    } else {
      expect(await ui.find({ key: 'act-level' })).toBeDefined()
    }
    expect(await ui.find(text(/"Barrar" é o que garante o workflow\. "Lembrar" orienta o Claude e só avisa: merge com --admin, merge sem revisão e pulo de portões passam \(ficam no log do flow e no painel\)\./))).toBeDefined()
    expect(await ui.find(text(/^O que é gravado$/))).toBeDefined()
    expect(await ui.find(text(/Só em \.claude\/settings\.local\.json, que fica fora do git e vale para este clone e as worktrees dele:/))).toBeDefined()
    expect(await ui.find(text(/Nada vai para o repositório\. Quem clona o projeto não é afetado\./))).toBeDefined()
    expect(await ui.find({ key: 'act-open' })).toBeUndefined()
    expect(w.disk.has(MARK)).toBe(false)
    await ui.press({ key: 'act-confirm-cancel' })
    await settle()
    expect(await ui.find({ key: 'act-open' })).toBeDefined()
    expect(await ui.find(text(/^Ativar o orquestrador neste clone$/))).toBeUndefined()
    await ui.unmount()
  }
  expect(w.disk.has(MARK)).toBe(false)
})

test('2.1 "Ativar" writes the mark and the hook, keeps the rest of the file, and the card turns active', async ($, on) => {
  const w = world(on)
  w.disk.set(MARK, JSON.stringify(OTHER))
  const ui = await mount($)
  await ui.press({ key: 'act-open' })
  await settle()
  await ui.select({ key: 'act-level', value: 'lembrar' })
  await settle()
  await ui.press({ key: 'act-confirm-go' })
  await settle()
  const file = json(w, MARK) as { env: Record<string, string>; permissions: unknown; hooks: { Stop: unknown; SessionStart: { hooks: { command: string }[] }[] } }
  expect(file.env).toEqual({ ORQUESTRADOR: 'lembrar' })
  expect(file.permissions).toEqual(OTHER.permissions)
  expect(file.hooks.Stop).toEqual(OTHER.hooks.Stop)
  expect(file.hooks.SessionStart).toHaveLength(1)
  expect(file.hooks.SessionStart[0]?.hooks[0]?.command).toContain('orchestrator:activate')
  expect(await ui.find(text(/^ativo neste clone · lembrar$/))).toBeDefined()
  expect(await ui.find(text(/^Orquestrador ativado neste clone \(lembrar\)\.$/))).toBeDefined()
  expect(await ui.find({ key: 'act-open' })).toBeUndefined()
  await ui.unmount()
})

test('2.1 active: "Trocar para …" switches the level in place and "Desativar neste clone" takes back only what was put', async ($, on) => {
  const w = world(on)
  w.disk.set(MARK, JSON.stringify(OTHER))
  const ui = await mount($)
  await ui.press({ key: 'act-open' })
  await ui.press({ key: 'act-confirm-go' })
  await settle()
  expect(await ui.find(text(/^ativo neste clone · barrar$/))).toBeDefined()
  expect((await ui.find({ key: 'act-switch' }))?.text).toBe('Trocar para lembrar')
  expect((await ui.find({ key: 'act-off' }))?.text).toBe('Desativar neste clone')
  expect(await ui.find(text(/Desativar tira só o que o "Ativar" pôs no \.claude\/settings\.local\.json; o resto do arquivo fica como está\. Vale a partir da próxima mensagem, sem reiniciar\./))).toBeDefined()
  expect(await ui.find(text(/O orquestrador está quieto aqui/))).toBeUndefined()

  await ui.press({ key: 'act-switch' })
  await settle()
  expect((json(w, MARK)?.env as Record<string, string>).ORQUESTRADOR).toBe('lembrar')
  expect(await ui.find(text(/^ativo neste clone · lembrar$/))).toBeDefined()
  expect((await ui.find({ key: 'act-switch' }))?.text).toBe('Trocar para barrar')
  expect((json(w, MARK)?.hooks as { SessionStart: unknown[] }).SessionStart).toHaveLength(1)

  await ui.press({ key: 'act-off' })
  await settle()
  expect(json(w, MARK)).toEqual(OTHER)
  expect(await ui.find(text(/^inativo neste clone$/))).toBeDefined()
  expect(await ui.find({ key: 'act-open' })).toBeDefined()
  await ui.unmount()
})

test('2.1 a settings.local.json that is not valid JSON is named, left untouched, and offers no activation', async ($, on) => {
  const w = world(on)
  w.disk.set(MARK, '{ "env": ')
  const ui = await mount($)
  expect(await ui.find(text(/\.claude\/settings\.local\.json não é um JSON válido: sem uma marca legível/))).toBeDefined()
  expect(await ui.find({ key: 'act-open' })).toBeUndefined()
  expect(w.disk.get(MARK)).toBe('{ "env": ')
  await ui.unmount()
})

test('2.1 the card in English', async ($, on) => {
  const w = world(on)
  w.disk.set(CONFIG, JSON.stringify({ language: 'en' }))
  const ui = await mount($)
  expect(await ui.find(text(/^inactive in this clone$/))).toBeDefined()
  expect((await ui.find({ key: 'act-open' }))?.text).toBe('Activate in this clone')
  await ui.press({ key: 'act-open' })
  await settle()
  expect(await ui.find(text(/^What is written$/))).toBeDefined()
  await ui.press({ key: 'act-confirm-go' })
  await settle()
  expect(await ui.find(text(/^active in this clone · block$/))).toBeDefined()
  await ui.unmount()
})

test('5.1 a mark the panel did not write is warned in the card, counts as "barrar", and pressing confirm makes it the panel\'s', async ($, on) => {
  const w = world(on)
  w.disk.set(MARK, JSON.stringify({ env: { ORQUESTRADOR: 'lembrar' } })) // by hand, not by the panel
  const ui = await mount($)
  expect(await ui.find(text(/^ativo neste clone · barrar$/))).toBeDefined()
  expect(await ui.find(text(/A ativação foi mudada fora do painel/))).toBeDefined()
  expect((await ui.find({ key: 'act-confirm-level' }))?.text).toBe('Confirmar barrar')
  // "barrar" is a brake, not a barrier
  expect(await ui.find(text(/freio do orquestrador, não uma barreira.*proteção de branch do GitHub/))).toBeDefined()

  await ui.press({ key: 'act-switch' }) // to "lembrar", the level on the file: now the panel wrote it
  await settle()
  expect(await ui.find(text(/^ativo neste clone · lembrar$/))).toBeDefined()
  expect(await ui.find(text(/A ativação foi mudada fora do painel/))).toBeUndefined()
  expect(await ui.find({ key: 'act-confirm-level' })).toBeUndefined()
  await ui.unmount()
})

test('2.4 "Seguir o flow sem clique": hidden in an inactive clone, off by default when active, and the button writes autowake.json', async ($, on) => {
  const w = world(on)
  const AUTOWAKE = `/h/.claude/${'orquestrador'}/autowake.json`
  const ui = await mount($)
  expect(await ui.find({ key: 'autowake' })).toBeUndefined()

  await ui.press({ key: 'act-open' })
  await ui.press({ key: 'act-confirm-go' })
  await settle()
  expect(await ui.find(text(/^Seguir o flow sem clique$/))).toBeDefined()
  expect(await ui.find(text(/^desligada$/))).toBeDefined()
  expect((await ui.find({ key: 'autowake-toggle' }))?.text).toBe('Ligar')
  expect(await ui.find(text(/^Ligada, o painel avisa a coordenação cada vez que uma sessão do flow termina\. Assim ela abre as próximas sessões em seu nome, sem cartão para clicar\. Fica só nesta máquina\.$/))).toBeDefined()
  expect(w.disk.has(AUTOWAKE)).toBe(false)

  await ui.press({ key: 'autowake-toggle' })
  await settle()
  expect(json(w, AUTOWAKE)).toMatchObject({ '/w': { on: true } })
  expect(await ui.find(text(/^ligada$/))).toBeDefined()
  expect((await ui.find({ key: 'autowake-toggle' }))?.text).toBe('Desligar')

  await ui.press({ key: 'autowake-toggle' })
  await settle()
  expect(json(w, AUTOWAKE)).toEqual({})
  expect((await ui.find({ key: 'autowake-toggle' }))?.text).toBe('Ligar')

  // deactivating the clone hides it again
  await ui.press({ key: 'act-off' })
  await settle()
  expect(await ui.find({ key: 'autowake' })).toBeUndefined()
  await ui.unmount()
})

test('2.4 in English the option reads "Follow the flow without clicking"', async ($, on) => {
  world(on).disk.set(CONFIG, JSON.stringify({ language: { ui: 'en', content: 'en' } }))
  const ui = await mount($)
  await ui.press({ key: 'act-open' })
  await ui.press({ key: 'act-confirm-go' })
  await settle()
  expect(await ui.find(text(/^Follow the flow without clicking$/))).toBeDefined()
  expect((await ui.find({ key: 'autowake-toggle' }))?.text).toBe('Turn on')
  expect(await ui.find(text(/opens the next sessions on your behalf/))).toBeDefined()
  await ui.unmount()
})
