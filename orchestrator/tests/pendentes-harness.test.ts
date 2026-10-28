import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowState } from '../types'

/** The clone is activated, as the owner does from the panel: the mod works only where it is. */
const ACTIVE: [string, string] = ['/w/.claude/settings.local.json', JSON.stringify({ env: { ORQUESTRADOR: 'barrar' } })]

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }
type Decision = 'allow' | 'ask' | 'deny'
type Row = { sessionId: string; cwd: string; title: string; startedBy?: string; groupId?: string; isArchived?: boolean; isRunning?: boolean }

const BASE = '/h/.claude/orquestrador'
const T = {
  list: 'mcp__ccd_session_mgmt__list_sessions',
  get: 'mcp__ccd_session_mgmt__get_session',
  groups: 'mcp__ccd_sidebar__list_groups',
  create: 'mcp__ccd_sidebar__create_group',
  move: 'mcp__ccd_sidebar__move_sessions',
  start: 'mcp__ccd_session__start_session',
  model: 'mcp__ccd_session_mgmt__set_session_model',
  effort: 'mcp__ccd_session_mgmt__set_session_effort',
}

const PANE = {
  component: 'Pane',
  requestId: 'orchestrator',
  props: { title: 'Orchestrator', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

type World = {
  disk: Map<string, string>
  rows: Row[]
  /** Every call that reached the app, with what the mod put in it. */
  calls: Record<string, unknown>[]
  toasts: string[]
  prompts: string[]
  /** What the app answers when asked whether the session-list tools may run. */
  permission: Decision
  /** The app refuses a start the panel asks for (its rule on `user_asked`). */
  appRefuses: boolean
}

/**
 * A coordinator (local_ee, at /w) whose app opens a running child on each start_session and answers with its
 * id, files sessions under sidebar groups, and asks `permission` for its session-list tools.
 */
const world = (on: On, permission: Decision = 'allow'): World => {
  mock.store(on)
  const w: World = {
    disk: new Map([ACTIVE]),
    rows: [{ sessionId: 'local_ee', cwd: '/w', title: 'Coordenação', isRunning: false }],
    calls: [],
    toasts: [],
    prompts: [],
    permission,
    appRefuses: false,
  }
  const groups: { id: string; name: string }[] = []
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 10) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('fs.exists', ($, e) => ({ value: w.disk.has(e.path) || [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
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
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repo' } as never }))
  on('tool.list', () => ({ value: Object.values(T).map(name => ({ name })) as never }))
  on('tool.check', ($, e) => ({ decision: e.tool === T.get || e.tool === T.list ? w.permission : 'allow' }) as never)
  const answer = (text: string, isError?: true) => ({ result: text, text, ...(isError === undefined ? {} : { isError }) }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    w.calls.push(input)
    if (input.tool === T.get) return answer(JSON.stringify(w.rows[0]))
    if (input.tool === T.list) return answer(JSON.stringify(w.rows))
    if (input.tool === T.groups) return answer(JSON.stringify(groups))
    if (input.tool === T.create) {
      const group = { id: `cg-${groups.length + 1}`, name: String(input.name) }
      groups.push(group)
      return answer(JSON.stringify(group))
    }
    if (input.tool === T.move) {
      for (const id of input.session_ids as string[]) {
        const target = w.rows.find(r => r.sessionId === (id === 'self' ? 'local_ee' : id))
        if (target !== undefined) target.groupId = String(input.group_id)
      }
      return answer('ok')
    }
    if (input.tool === T.start) {
      if (w.appRefuses) return answer('start_session: initiation "user_asked" needs the user\'s own words in this turn', true)
      const id = `local_c${w.rows.length}`
      w.rows.push({ sessionId: id, cwd: `/w/wt/${id}`, title: String(input.title), startedBy: 'local_ee', isRunning: true })
      return answer(`Started session ${id}`)
    }
    if (input.tool === 'Bash') return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
    return answer('ok')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('prompt.submit', ($, e) => {
    w.prompts.push(e.text)
    return { text: e.text } as never
  })
  return w
}

const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orchestrator__flow', ...input } as never) as Promise<Reply>
const saved = (w: World): FlowState => JSON.parse(w.disk.get(`${BASE}/flows/b.json`) ?? '{}') as FlowState
/** The starts that reached the app, without the call id the engine gives each one. */
const starts = (w: World) => w.calls.filter(c => c.tool === T.start).map(({ tool_use_id: _id, ...c }) => c)
const entry = (key: string, extra: Record<string, unknown> = {}) => ({ key, title: `Fase ${key}`, prompt: `faça a fase ${key}`, ...extra })

/** A few turns of the event loop: enough for a press's work, which the pane does not wait on, to finish. */
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => resolve(undefined), 0))
}

/** The flow of change b on its phase loop, with three phase sessions the app refused kept by the coordination. */
const atLoopWithPending = async ($: Engine, w: World) => {
  expect((await flow($, { action: 'start', change: 'b', flow: 'rapido' })).isError).toBeUndefined()
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await $.tool.call({ tool: 'Bash', command: 'npx openspec validate b --strict' } as never)
  expect(saved(w).current).toBe('executar')
  const kept = await flow($, { action: 'pending', sessions: [entry('1', { model: 'claude-opus-5-5', effort: 'high', use_worktree: true }), entry('2'), entry('3')] })
  expect(kept.isError).toBeUndefined()
  expect(String(kept.result)).toMatch(/Abrir as 3 sessões pendentes/)
  expect(saved(w).pendingStarts?.map(p => p.key)).toEqual(['1', '2', '3'])
}

const press = async ($: Engine, surface: 'desktop' | 'mobile' = 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'orchestrator', surface, ...PANE })
  await ui.press({ key: 'pending:open' })
  await settle()
  await ui.unmount()
}

test('the panel shows one button for the pending sessions; one press opens all three as the owner asked, and they leave the list', async ($, on) => {
  const w = world(on)
  await atLoopWithPending($, w)
  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'orchestrator', surface, ...PANE })
    expect(await ui.find({ type: 'Button', text: 'Abrir as 3 sessões pendentes' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fase 1 · Fase 2 · Fase 3/ })).toBeDefined()
    await ui.unmount()
  }
  expect(starts(w)).toEqual([])

  await press($)
  const consent = 'The user pressed "Abrir as 3 sessões pendentes" in the orchestrator panel.'
  expect(starts(w)).toEqual([
    { tool: T.start, title: 'Fase 1', prompt: 'faça a fase 1', initiation: 'user_asked', wake_when_done: true, use_worktree: true, consent },
    { tool: T.start, title: 'Fase 2', prompt: 'faça a fase 2', initiation: 'user_asked', wake_when_done: true, consent },
    { tool: T.start, title: 'Fase 3', prompt: 'faça a fase 3', initiation: 'user_asked', wake_when_done: true, consent },
  ])
  // the entry's model and effort go to the session it opened, as the skill does
  expect(w.calls.filter(c => c.tool === T.model || c.tool === T.effort).map(({ tool_use_id: _id, ...c }) => c)).toEqual([
    { tool: T.model, session_id: 'local_c1', model: 'claude-opus-5-5' },
    { tool: T.effort, session_id: 'local_c1', effort: 'high' },
  ])
  const after = saved(w)
  expect(after.pendingStarts).toBeUndefined()
  expect(after.sessions).toEqual(expect.arrayContaining(['local_c1', 'local_c2', 'local_c3']))
  expect(after.tracked).toEqual(['local_c1', 'local_c2', 'local_c3'])
  expect(w.toasts).toContain('Abriram 3 sessões pendentes.')
  const log = (w.disk.get(`${BASE}/flows/b.ndjson`) ?? '').trim().split('\n').map(l => JSON.parse(l) as { kind: string; note?: string; by: string })
  expect(log.filter(e => e.kind === 'pending' || e.kind === 'pending-opened')).toEqual([
    expect.objectContaining({ kind: 'pending', by: 'session', note: '1, 2, 3' }),
    expect.objectContaining({ kind: 'pending-opened', by: 'owner', note: '1, 2, 3' }),
  ])
  // the prompts never reach the log, and only the starts carry the owner's words
  expect(w.disk.get(`${BASE}/flows/b.ndjson`)).not.toMatch(/faça a fase/)
  expect(w.calls.filter(c => 'consent' in c).map(c => c.tool)).toEqual([T.start, T.start, T.start])

  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Button', text: /sessões pendentes/ })).toBeUndefined()
  await ui.unmount()
})

test('with two live phase sessions only one opens; the rest stays and the toast says why', async ($, on) => {
  const w = world(on)
  w.rows.push(
    { sessionId: 'local_a', cwd: '/w/wt/a', title: 'Outra A', startedBy: 'local_ee', isRunning: true },
    { sessionId: 'local_b', cwd: '/w/wt/b', title: 'Outra B', startedBy: 'local_ee', isRunning: true },
  )
  await atLoopWithPending($, w)
  await press($)
  // the second start is refused by the mod's ceiling before the app sees it
  expect(starts(w).map(c => c.title)).toEqual(['Fase 1'])
  expect(saved(w).pendingStarts?.map(p => p.key)).toEqual(['2', '3'])
  expect(saved(w).tracked).toEqual(['local_c3'])
  expect(w.toasts.at(-1)).toMatch(/^Abriu 1 sessão pendente\. Ficaram 2: 3 phase sessions are alive: .*the ceiling is 3/)
  expect(w.toasts.at(-1)).not.toMatch(/digite/)
})

test('the app refusing the start leaves the list as it was and says to type it on the desktop (or that the phone cannot)', async ($, on) => {
  const w = world(on)
  await atLoopWithPending($, w)
  w.appRefuses = true
  await press($)
  expect(starts(w)).toHaveLength(1)
  expect(saved(w).pendingStarts?.map(p => p.key)).toEqual(['1', '2', '3'])
  expect(w.toasts.at(-1)).toMatch(/^Nenhuma sessão pendente abriu\. Ficaram 3: .*user_asked.* O app não aceitou abrir pelo painel; digite \/orchestrator:open no desktop\.$/)

  await press($, 'mobile')
  expect(w.toasts.at(-1)).toMatch(/Pelo celular o app não abre sessões; digite \/orchestrator:open no desktop\.$/)
  expect(saved(w).pendingStarts).toHaveLength(3)
})

test('with the session tools on "ask" the press is refused with the permission notice; once allowed, it opens', async ($, on) => {
  const w = world(on)
  await atLoopWithPending($, w)
  w.permission = 'ask'
  await press($)
  // the mod's own gate refused before the app saw any start
  expect(starts(w)).toEqual([])
  expect(saved(w).pendingStarts).toHaveLength(3)
  expect(w.toasts.at(-1)).toMatch(/^Nenhuma sessão pendente abriu\. Ficaram 3: .*allow get_session and list_sessions/)
  expect(w.toasts.at(-1)).not.toMatch(/digite/)
  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Permita get_session e list_sessions/ })).toBeDefined()
  await ui.unmount()

  w.permission = 'allow'
  await press($)
  expect(starts(w)).toHaveLength(3)
  expect(saved(w).pendingStarts).toBeUndefined()
})

test('a start the model makes with the same title takes the entry out, and a later `flow pending` does not bring it back', async ($, on) => {
  const w = world(on)
  await atLoopWithPending($, w)
  await $.tool.call({ tool: T.start, initiation: 'user_asked', wake_when_done: true, title: 'Fase 2', prompt: 'faça a fase 2' } as never)
  expect(saved(w).pendingStarts?.map(p => p.key)).toEqual(['1', '3'])
  expect(saved(w).tracked).toEqual(['local_c1'])

  const more = await flow($, { action: 'pending', sessions: [entry('4')] })
  expect(more.isError).toBeUndefined()
  expect(saved(w).pendingStarts?.map(p => p.key)).toEqual(['1', '3', '4'])
})

test('outside a session step or the loop, or from another session than the coordination, nothing is kept', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  expect(saved(w).current).toBe('validar')
  const atValidar = await flow($, { action: 'pending', sessions: [entry('1')] })
  expect([atValidar.isError, String(atValidar.result)]).toEqual([true, expect.stringMatching(/opens no session/)])

  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w), current: 'executar', coordinatorSession: 'local_other' }))
  const other = await flow($, { action: 'pending', sessions: [entry('1')] })
  expect([other.isError, String(other.result)]).toEqual([true, expect.stringMatching(/only the session that coordinates/)])
  expect(saved(w).pendingStarts).toBeUndefined()
})

test('only the pending press hands a start the owner\'s words: an owner step press and the wake never do', async ($, on) => {
  const w = world(on)
  w.disk.set(`${BASE}/autowake.json`, JSON.stringify({ '/w': { on: true, at: 1 } }))
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  // the grill's press (pressFlow) wakes the coordination by its own message
  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...PANE })
  await ui.press({ key: 'flow:grill:fechado' })
  await settle()
  await ui.unmount()
  expect(w.prompts).toHaveLength(1)
  expect(w.calls.some(c => 'consent' in c)).toBe(false)
})

/** The clone on "lembrar": the file's mark and the record the panel keeps for it. */
const lembrar = (w: World) => {
  w.disk.set(ACTIVE[0], JSON.stringify({ env: { ORQUESTRADOR: 'lembrar' } }))
  w.disk.set(`${BASE}/activation.json`, JSON.stringify({ '/w': { level: 'lembrar', at: 1 } }))
}

test('on "lembrar" with the session tools on "ask" the press opens none (it cannot count the ceiling) and shows the permission notice; on "allow" it opens', async ($, on) => {
  const w = world(on)
  lembrar(w)
  await atLoopWithPending($, w)
  w.permission = 'ask'
  await press($)
  expect(starts(w)).toEqual([])
  expect(saved(w).pendingStarts).toHaveLength(3)
  expect(w.toasts.at(-1)).toMatch(/^Nenhuma sessão pendente abriu\. Ficaram 3: .*allow get_session and list_sessions/)

  w.permission = 'allow'
  await press($)
  expect(starts(w)).toHaveLength(3)
  expect(saved(w).pendingStarts).toBeUndefined()
})
