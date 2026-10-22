import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

/** The clone is activated, as the owner does from the panel: the mod works only where it is. */
const ACTIVE: [string, string] = ['/w/.claude/settings.local.json', JSON.stringify({ env: { ORQUESTRADOR: 'barrar' } })]

/** Marks the clone as activated for a test that has no disk of its own. */
const activate = (on: Parameters<TestBody>[1]) => {
  on("session.root", () => ({ value: "/w" }))
  on("fs.exists", ($, e, next) => (e.path === ACTIVE[0] ? { value: true } : next(e)))
  on("fs.read", ($, e, next) => (e.path === ACTIVE[0] ? { value: ACTIVE[1] } : next(e)))
}

const PANE = {
  component: 'Pane',
  requestId: 'orquestrador',
  props: { title: 'Orquestrador', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the pane shows the plan this session tracks, on every surface', async ($, on) => {
  mock.store(on)
  activate(on)
  on('tool.call', ($, e, next) => ((e.tool as string).endsWith('update_plan') ? { result: 'ok' } : next(e)))

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Montar ondas', status: 'in_progress' },
      { content: 'Disparar fases', status: 'pending' },
    ],
  } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)

  for (const surface of ['desktop', 'terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'orquestrador', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /✓ Montar ondas/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ Disparar fases/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing a card title collapses and reopens it', async ($, on) => {
  mock.store(on)
  activate(on)
  on('tool.call', ($, e, next) => ((e.tool as string).endsWith('update_plan') ? { result: 'ok' } : next(e)))
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [{ content: 'Montar ondas', status: 'in_progress' }],
  } as never)

  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Montar ondas/ })).toBeDefined()
  await ui.press({ key: 'card:self' })
  expect(await ui.find({ type: 'Text', text: /Montar ondas/ })).toBeUndefined()
  await ui.press({ key: 'card:self' })
  expect(await ui.find({ type: 'Text', text: /Montar ondas/ })).toBeDefined()
  await ui.unmount()
})

const CHANGE = '/w/openspec/changes/demo'
const FILES: Record<string, string> = {
  [`${CHANGE}/tasks.md`]: '## 1. Setup\n- [x] a\n- [x] b\n- [ ] c\n',
  [`${CHANGE}/proposal.md`]: '# Proposal: Demo\n\n## Why\n\nPor que existe.\n',
  [`${CHANGE}/evidence.md`]: '```\n== check summary ==\nPASS  repo:guard  0s\n```\n',
}
const JIRA = {
  'EP-1': { summary: 'Épico', status: { name: 'Em andamento', statusCategory: { key: 'indeterminate' } } },
  'EP-2': { summary: 'Fase A no Jira', status: { name: 'A fazer', statusCategory: { key: 'new' } } },
} as Record<string, unknown>

type Body = Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>
type Env = Parameters<Body>
type Seed = { sites?: unknown[]; sessions?: unknown[]; opened?: string[][] }

/** Stands in for the engine beneath the mod: an in-memory disk, the Jira connector and the app's session tools. */
const seed = ($: Env[0], on: Env[1], { sites = [{ id: 'c1', url: 'https://a.atlassian.net' }], sessions = [], opened = [] }: Seed = {}) => {
  mock.store(on)
  const disk = new Map([ACTIVE, ...Object.entries(FILES)])
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
  on('tool.list', () => ({
    value: [
      { name: 'mcp__x__getJiraIssue' },
      { name: 'mcp__x__getAccessibleAtlassianResources' },
      { name: 'mcp__ccd_session_mgmt__list_sessions' },
    ] as never,
  }))
  on('process.run', ($, e) => {
    opened.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  /** The engine relays a tool's answer as `text` too; standing in for it, the test does the same. */
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === 'mcp__x__getAccessibleAtlassianResources') {
      return answer(JSON.stringify(sites))
    }
    if (input.tool === 'mcp__x__getJiraIssue') {
      return answer(JSON.stringify({ key: input.issueIdOrKey, fields: JIRA[String(input.issueIdOrKey)] }))
    }
    if (input.tool === 'mcp__ccd_session_mgmt__get_session') {
      return answer(JSON.stringify({ sessionId: 'local_self', title: 'coord', cwd: '/w' }))
    }
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return answer(JSON.stringify(sessions))
    return answer('')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)

}

test('publishing a plan fills the OpenSpec card and the Jira rows; ⓘ opens the summaries', async ($, on) => {
  seed($, on)
  await $.tool.call({
    tool: 'mcp__orquestrador__plano',
    change: 'demo',
    changePath: 'openspec/changes/demo',
    jira: 'EP-1',
    waves: [{ title: 'W', phases: [{ id: '1', title: 'Fase A', status: 'done', jira: 'EP-2' }] }],
  } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orquestrador', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /1\. Setup/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /check\.sh verde/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fase fechada, mas EP-1/ })).toBeDefined()
    // closed phases start folded
    expect(await ui.find({ type: 'Text', text: /Fase A no Jira/ })).toBeUndefined()
    await ui.press({ key: 'group:tasks:done' })
    expect(await ui.find({ type: 'Text', text: /EP-2 · A fazer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fase fechada, mas EP-2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fase A no Jira/ })).toBeUndefined()
    await ui.press({ key: 'jira:EP-2' })
    expect(await ui.find({ type: 'Text', text: /Fase A no Jira/ })).toBeDefined()
    await ui.press({ key: 'jira:EP-2' })
    expect(await ui.find({ type: 'Text', text: /Por que existe/ })).toBeUndefined()
    await ui.press({ key: 'info:openspec:proposal' })
    expect(await ui.find({ type: 'Text', text: /Por que existe/ })).toBeDefined()
    await ui.press({ key: 'info:openspec:proposal' })
    await ui.press({ key: 'group:tasks:done' })
    await ui.unmount()
  }
})

test('a Jira key without a reachable site opens a box that says what is missing', async ($, on) => {
  seed($, on, { sites: [] })
  await $.tool.call({
    tool: 'mcp__orquestrador__plano',
    change: 'demo',
    jira: 'EP-1',
    waves: [{ phases: [{ id: '1', title: 'Fase A', status: 'running', jira: 'EP-2' }] }],
  } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orquestrador', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /demo · EP-1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sem link: falta o site/ })).toBeUndefined()
    await ui.press({ key: 'jira:EP-1' })
    expect(await ui.find({ type: 'Text', text: /Sem link: falta o site/ })).toBeDefined()
    await ui.press({ key: 'jira:EP-1' })
    await ui.unmount()
  }
})

test('a legend entry lists its phases, and "Abrir" opens a session the app will not place beside', async ($, on) => {
  const opened: string[][] = []
  seed($, on, {
    opened,
    sessions: [
      { sessionId: 'local_c', title: 'Filha', cwd: '/w2', name: 'filha', startedBy: 'local_outro', isRunning: true, link: 'claude://claude.ai/epitaxy/local_c' },
    ],
  })
  await $.tool.call({
    tool: 'mcp__orquestrador__plano',
    change: 'demo',
    waves: [{ phases: [{ id: '1', title: 'Fase A', status: 'running', session: 'filha' }, { id: '2', title: 'Fase B', status: 'done' }] }],
  } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orquestrador', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Fase B · onda 1/ })).toBeUndefined()
    await ui.press({ key: 'legend:done' })
    expect(await ui.find({ type: 'Text', text: /Fase B · onda 1/ })).toBeDefined()
    await ui.press({ key: 'legend:done' })
    await ui.press({ key: 'legend:running' })
    await ui.press({ key: 'open:legend:1:Abrir:local_c' })
    expect(opened.at(-1)).toEqual(['open', 'claude://claude.ai/epitaxy/local_c'])
    await ui.press({ key: 'open:card:1:Abrir:local_c' })
    expect(opened.at(-1)).toEqual(['open', 'claude://claude.ai/epitaxy/local_c'])
    expect(await ui.find({ type: 'Text', text: /Montar/ })).toBeUndefined()
    await ui.press({ key: 'legend:running' })
    await ui.unmount()
  }
})
