import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, TestBody } from 'claude-code/testing'

/** The clone is activated, as the owner does from the panel: the mod works only where it is. */
const ACTIVE: [string, string] = ['/w/.claude/settings.local.json', JSON.stringify({ env: { ORQUESTRADOR: 'barrar' } })]

type On = Parameters<TestBody>[1]
type Decision = 'allow' | 'ask' | 'deny'

const T = {
  list: 'mcp__ccd_session_mgmt__list_sessions',
  get: 'mcp__ccd_session_mgmt__get_session',
}
const REFRESH_MS = 15_000
const ME = { sessionId: 'local_me', cwd: '/w', title: 'Coordenação', isRunning: false }
const WARNING = /Permita get_session e list_sessions para o painel ver as sessões\./

const PANE = {
  component: 'Pane',
  requestId: 'orquestrador',
  props: { title: 'Orquestrador', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

type World = {
  disk: Map<string, string>
  clock: MockClock
  /** What the app answers when asked whether the session-list tools may run. */
  permission: Decision
  /** Every call that reached the app's session tools. */
  calls: string[]
  /** While set, get_session answers only once it resolves: the ask stays pending, as under a dialog. */
  hold?: Promise<void>
}

/** A coordinator at /w on a mocked clock; the model's own tools (Bash) are "ask", the session tools follow `permission`. */
const world = (on: On, permission: Decision): World => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w: World = { disk: new Map([ACTIVE]), clock, permission, calls: [] }
  on('env.get', () => ({ value: '/h' }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('fs.exists', ($, e) => ({ value: w.disk.has(e.path) || [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.read', ($, e) => ({ value: w.disk.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    w.disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: [...w.disk.keys()]
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: clock.now(), isLink: false })) as never,
  }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repo' } as never }))
  on('tool.list', () => ({ value: Object.values(T).map(name => ({ name })) as never }))
  on('tool.check', ($, e) => ({ decision: Object.values(T).includes(e.tool) ? w.permission : e.tool === 'Bash' ? 'ask' : 'allow' }) as never)
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === T.get) {
      w.calls.push(T.get)
      if (w.hold !== undefined) await w.hold
      return answer(JSON.stringify(ME))
    }
    if (input.tool === T.list) {
      w.calls.push(T.list)
      return answer(JSON.stringify([ME]))
    }
    return answer('ok')
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

const count = (w: World, tool: string): number => w.calls.filter(c => c === tool).length
/** What the session published as its wait, read from its activity file. */
const waiting = (w: World): unknown => {
  const file = [...w.disk.keys()].find(k => k.startsWith('/h/.claude/orquestrador/sessions/'))
  return file === undefined ? null : (JSON.parse(w.disk.get(file) ?? '{}').waiting ?? null)
}
const start = ($: Engine) => $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true } as never)

test('with a get_session pending, publishing, waiting and three turns of the clock make at most one get_session', async ($, on) => {
  const w = world(on, 'allow')
  let release: () => void = () => undefined
  w.hold = new Promise<void>(resolve => (release = resolve))
  const started = start($)
  await Promise.resolve()

  // a model tool the owner has to approve marks the wait, which publishes, which asks for the id
  const model = $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)
  const read = $.tool.call({ tool: 'Read', file_path: '/w/a' } as never)
  await w.clock.advance(REFRESH_MS * 3)
  expect(count(w, T.get)).toBeLessThanOrEqual(1)

  release()
  await Promise.all([started, model, read])
  // the session start's own loading finishes before the test ends
  await w.clock.advance(REFRESH_MS)
})

test('with "ask" on the session tools the clock makes no call to them, and the panel and the band say what to allow', async ($, on) => {
  const w = world(on, 'ask')
  await start($)
  await w.clock.advance(REFRESH_MS * 3)
  expect(w.calls).toEqual([])

  const pane = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await pane.find({ type: 'Text', text: WARNING })).toBeDefined()
  await pane.unmount()
  // no plan loaded: the band still carries the notice
  const band = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: WARNING })).toBeDefined()
  await band.unmount()
  expect(w.calls).toEqual([])
})

test("the mod's own check marks no wait; a model tool with \"ask\" still does", async ($, on) => {
  const w = world(on, 'ask')
  await start($)
  await w.clock.advance(REFRESH_MS * 2)
  expect(waiting(w)).toBeNull()

  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)
  expect(waiting(w)).toMatchObject({ kind: 'permission' })
})

test('once the owner allows, the next turn calls and the notice goes away', async ($, on) => {
  const w = world(on, 'ask')
  await start($)
  await w.clock.advance(REFRESH_MS * 2)
  expect(w.calls).toEqual([])

  w.permission = 'allow'
  await w.clock.advance(REFRESH_MS)
  expect(count(w, T.get)).toBeGreaterThan(0)
  expect(count(w, T.list)).toBeGreaterThan(0)

  const pane = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await pane.find({ type: 'Text', text: WARNING })).toBeUndefined()
  await pane.unmount()
  const band = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: WARNING })).toBeUndefined()
  await band.unmount()
})

test('a phase session is refused with the reason "allow the session tools" while they are on "ask"', async ($, on) => {
  const w = world(on, 'ask')
  await start($)
  const refused = (await $.tool.call({ tool: 'mcp__ccd_session__start_session', prompt: 'x' } as never)) as { deny?: string }
  expect(refused.deny).toMatch(/allow get_session and list_sessions/)
  expect(w.calls).toEqual([])
  await w.clock.advance(REFRESH_MS)
})
