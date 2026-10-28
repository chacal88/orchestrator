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
  requestId: 'orquestrador',
  props: { title: 'Orquestrador', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
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
  // the wake of a typed `aprovar` goes through a timer, past the command's hook: the test lets it elapse at once
  on('clock.after', () => ({ value: undefined }) as never)
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
  $.tool.call({ tool: 'mcp__orquestrador__flow', ...input } as never) as Promise<Reply>
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


type Origin = { kind: string; name?: string }
const COMPOSER: Origin = { kind: 'composer' }

/** The person (or whoever `origin` says) typing `/orquestrador <args>`; the text the command answers. */
const run = async ($: Engine, w: World, args: string, origin: Origin = COMPOSER): Promise<string> => {
  const done = (await $.command.run({ command: 'orquestrador', args, origin } as never)) as { text?: string }
  await settle()
  return done.text ?? ''
}

/** The state or the log with every time taken out: two worlds that did the same thing differ only by the clock. */
const bare = (text: string): unknown =>
  JSON.parse(text, (key, value: unknown) => (key === 'at' || key.endsWith('At') || key === 'since' ? undefined : value)) as unknown
const logOf = (w: World) =>
  (w.disk.get(`${BASE}/flows/b.ndjson`) ?? '')
    .trim()
    .split('\n')
    .filter(l => l !== '')
    .map(l => bare(l))

/** What a world holds of the flow after something happened: the state, the log, the prompts, the toasts do not count. */
const snapshot = (w: World) => ({
  state: bare(w.disk.get(`${BASE}/flows/b.json`) ?? '{}'),
  log: logOf(w),
  skips: bare(w.disk.get(`${BASE}/gates/b.json`) ?? '{}'),
  prompts: [...w.prompts],
})

/** Runs `act`, then puts the disk and the prompts back as they were: the same world does the other gesture next. */
const rewound = async (w: World, act: () => Promise<void>) => {
  const disk = new Map(w.disk)
  const prompts = [...w.prompts]
  await act()
  const after = snapshot(w)
  w.disk.clear()
  for (const [k, v] of disk) w.disk.set(k, v)
  w.prompts.length = 0
  w.prompts.push(...prompts)
  return after
}

const mount = (surface: 'desktop' | 'mobile' = 'desktop') => ({ plugin: 'orquestrador', surface, ...PANE }) as const
const click = async ($: Engine, ...keys: string[]) => {
  const ui = await $.ui.mount(mount())
  for (const key of keys) {
    await ui.press({ key })
    await settle()
  }
  await ui.unmount()
}

test('aprovar from the composer leaves the flow, the log and the wake as a click on the same button does', async ($, on) => {
  const w = world(on)
  w.disk.set(`${BASE}/autowake.json`, JSON.stringify({ '/w': { on: true, at: 1 } }))
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  expect(saved(w).current).toBe('grill')

  const clicked = await rewound(w, () => click($, 'flow:grill:fechado'))
  expect(clicked.prompts.length).toBeGreaterThan(0)
  expect((clicked.state as FlowState).current).not.toBe('grill')

  const typed = await run($, w, 'aprovar fechado')
  expect(typed).toMatch(/Entendimento/)
  const after = snapshot(w)
  expect(after.prompts).toEqual(clicked.prompts)
  expect(after.log).toEqual(clicked.log)
  expect(after.state).toEqual(clicked.state)
})

test('aprovar with a note records it like the "Pedir ajuste" press, and an outcome the step does not declare is refused', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  const before = snapshot(w)
  const refused = await run($, w, 'aprovar inventado')
  expect(refused).toMatch(/^Não consegui registrar: /)
  expect(refused).toMatch(/inventado/)
  expect(snapshot(w)).toEqual(before)
})

test('only composer and bridge are the owner: plugin, peer and the rest are refused and the flow does not change', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  const before = snapshot(w)
  const origins: Origin[] = [
    { kind: 'plugin', name: 'x' },
    { kind: 'peer' },
    { kind: 'sdk' },
    { kind: 'task-notification' },
    { kind: 'scheduled-trigger' },
    { kind: 'unclassified' },
  ]
  for (const origin of origins) {
    for (const args of ['aprovar fechado', 'abrir', 'status', 'pular-portão 2 testes confirmar', 'encerrar confirmar']) {
      expect([origin.kind, await run($, w, args, origin)]).toEqual([origin.kind, expect.stringMatching(/só vale digitado por você/)])
    }
  }
  expect(snapshot(w)).toEqual(before)
  expect(w.calls.filter(c => c.tool === T.start)).toEqual([])
  // opening the panel decides nothing, so any origin may
  expect(await run($, w, '', { kind: 'plugin', name: 'x' })).toMatch(/Painel/)
})

test('through the bridge it works, and the answer is plain text: no table, no heading, no bold', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  const status = await run($, w, 'status', { kind: 'bridge' })
  expect(status).toMatch(/^Flow de b \(Completo\): running\nPasso: Entendimento/)
  expect(status).toMatch(/Você responde com: fechado/)
  expect(status).not.toMatch(/[|#*]|```/)
  const help = await run($, w, 'ajuda', { kind: 'bridge' })
  expect(help).toMatch(/status:.*\naprovar .*\nabrir:/)
  expect(help).not.toMatch(/[|#*]|```/)
  const moved = await run($, w, 'aprovar fechado', { kind: 'bridge' })
  expect(moved).not.toMatch(/[|#*]/)
  expect(saved(w).current).not.toBe('grill')
})

test('status does not list sessions beyond what the permission lets, and says so', async ($, on) => {
  const w = world(on, 'ask')
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  const before = w.calls.length
  const status = await run($, w, 'status')
  expect(status).toMatch(/Permita get_session e list_sessions/)
  expect(w.calls.slice(before).filter(c => c.tool === T.list || c.tool === T.get)).toEqual([])
})

test('the release step is refused with the plan-mode notice, and liberar is only the help', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w), current: 'liberacao' }))
  const before = snapshot(w)
  const refused = await run($, w, 'aprovar liberado')
  expect(refused).toBe('A liberação vem do plan mode: aprove o plano de execução no diálogo do app.')
  expect(snapshot(w)).toEqual(before)
  const liberar = await run($, w, 'liberar')
  expect(liberar).toMatch(/^Não conheço "liberar"\.\nSubcomandos de \/orquestrador:/)
  expect(snapshot(w)).toEqual(before)
})

test('abrir opens the pending sessions as the owner typed it, and the phone is told when the app refuses', async ($, on) => {
  const w = world(on)
  await atLoopWithPending($, w)
  const typed = await run($, w, 'abrir')
  expect(typed).toBe('Abriram 3 sessões pendentes.')
  const consent = 'The user typed "/orquestrador abrir".'
  expect(starts(w).map(c => [c.title, c.initiation, c.consent])).toEqual([
    ['Fase 1', 'user_asked', consent],
    ['Fase 2', 'user_asked', consent],
    ['Fase 3', 'user_asked', consent],
  ])
  expect(saved(w).pendingStarts).toBeUndefined()
  expect(saved(w).tracked).toEqual(['local_c1', 'local_c2', 'local_c3'])
  expect(logOf(w).filter(e => (e as { kind: string }).kind === 'pending-opened')).toEqual([expect.objectContaining({ by: 'owner', note: '1, 2, 3' })])
  expect(await run($, w, 'abrir')).toBe('Nenhuma sessão pendente para abrir.')
})

test('abrir through the bridge, with the app refusing, says the phone cannot open sessions', async ($, on) => {
  const w = world(on)
  await atLoopWithPending($, w)
  w.appRefuses = true
  expect(await run($, w, 'abrir', { kind: 'bridge' })).toMatch(/Pelo celular o app não abre sessões; digite \/orquestrador abrir no desktop\.$/)
  expect(saved(w).pendingStarts).toHaveLength(3)
  expect(await run($, w, 'abrir')).toMatch(/O app não aceitou abrir pelo painel; digite \/orquestrador abrir no desktop\.$/)
})

const PLAN = {
  change: 'b',
  changePath: 'openspec/changes/b',
  waves: [{ phases: [{ id: '2', title: 'Tela', status: 'running', gates: ['testes', 'lint'], tasks: '2.1' }] }],
}

test('pular-portão asks for confirmar; with it, it records the skip the panel records', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await $.tool.call({ tool: 'Bash', command: 'npx openspec validate b --strict' } as never)
  expect(saved(w).current).toBe('executar')
  await $.tool.call({ tool: 'mcp__orquestrador__plano', ...PLAN } as never)
  const none = snapshot(w)
  expect(none.skips).toEqual({})

  const clicked = await rewound(w, () => click($, 'arm:2:testes', 'skip:2:testes'))
  expect(clicked.skips).toEqual({ skips: { '2:testes': {} } })

  const ask = await run($, w, 'pular-portão 2 testes')
  expect(ask).toMatch(/Vou pular o portão testes da fase 2\. Para confirmar, digite o mesmo comando com confirmar no fim\./)
  expect(snapshot(w)).toEqual(none)
  expect(await run($, w, 'pular-portão 2 inventado confirmar')).toMatch(/Não achei o portão "inventado"/)
  expect(snapshot(w)).toEqual(none)

  expect(await run($, w, 'pular-portao 2 testes confirmar')).toBe('Portão testes pulado por você.')
  expect(snapshot(w)).toEqual(clicked)
})

test('with no argument the command opens and closes the pane as before, for any origin', async ($, on) => {
  const w = world(on)
  expect(await run($, w, '')).toBe('Painel do orquestrador aberto.')
})

test('encerrar without confirmar changes nothing; with it, the flow is aborted like the second press of the button, and nothing is sent', async ($, on) => {
  const w = world(on)
  w.disk.set(`${BASE}/autowake.json`, JSON.stringify({ '/w': { on: true, at: 1 } }))
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  const before = snapshot(w)

  const ask = await run($, w, 'encerrar')
  expect(ask).toMatch(/Vou encerrar o flow de b no passo grill\. Nada é arquivado\. Para confirmar, digite o mesmo comando com confirmar no fim\./)
  expect(snapshot(w)).toEqual(before)

  // the button shows from the start, armed by one press and fired by the second
  const ui = await $.ui.mount(mount('mobile'))
  expect(await ui.find({ type: 'Button', text: 'Encerrar o flow' })).toBeDefined()
  await ui.press({ key: 'end:arm' })
  expect(saved(w).status).toBe('running')
  expect(await ui.find({ type: 'Button', text: 'Confirmar: encerrar o flow de b' })).toBeDefined()
  await ui.press({ key: 'end:arm' }) // cancel: the arming is the pane's state, which the next mount would share
  await settle()
  await ui.unmount()
  const clicked = await rewound(w, () => click($, 'end:arm', 'end:confirm'))
  expect((clicked.state as FlowState).status).toBe('aborted')

  const prompts = w.prompts.length
  expect(await run($, w, 'encerrar confirmar')).toBe('Flow de b encerrado por você.')
  expect(saved(w).status).toBe('aborted')
  expect(logOf(w).at(-1)).toEqual(expect.objectContaining({ kind: 'aborted', by: 'owner' }))
  expect(snapshot(w)).toEqual(clicked)
  expect(w.prompts.length).toBe(prompts)
  expect(w.calls.filter(c => c.tool === T.start)).toEqual([])
})

test('encerrar with a reason keeps it on the event; a plugin origin is refused and the flow runs on', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  expect(await run($, w, 'encerrar confirmar', { kind: 'plugin', name: 'x' })).toMatch(/só vale digitado por você/)
  expect(saved(w).status).toBe('running')
  await run($, w, 'encerrar mudou o escopo confirmar', { kind: 'bridge' })
  expect(saved(w).status).toBe('aborted')
  expect(logOf(w).at(-1)).toEqual(expect.objectContaining({ kind: 'aborted', by: 'owner', note: 'mudou o escopo' }))
})

test('an escalated flow ends by the command and by the button; a flow already ended answers the reason', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w), status: 'escalated', escalation: { step: 'grill', from: 'grill', outcome: 'x', attempts: 3 } }))
  const ui = await $.ui.mount(mount())
  expect(await ui.find({ type: 'Button', text: 'Encerrar o flow' })).toBeDefined()
  await ui.unmount()
  expect(await run($, w, 'encerrar confirmar')).toBe('Flow de b encerrado por você.')
  expect(saved(w).status).toBe('aborted')

  // an ended flow is no flow of this coordination any more; the command says so, and the button is gone
  expect(await run($, w, 'encerrar confirmar')).toMatch(/Nenhum flow em andamento/)
  const after = await $.ui.mount(mount())
  expect(await after.find({ type: 'Button', text: 'Encerrar o flow' })).toBeUndefined()
  await after.unmount()
})

test('no tool of the model ends the flow, and endFlow is reached only by the button, the command and the escalation', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  for (const action of ['end', 'encerrar', 'abort', 'cancel']) {
    const refused = await flow($, { action, change: 'b' })
    expect(refused.isError).toBe(true)
  }
  expect(saved(w).status).toBe('running')
})

test('aprovar encerrar on an escalated flow is refused and points to encerrar confirmar; the flow stays escalated', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w), status: 'escalated', escalation: { step: 'grill', from: 'grill', outcome: 'x', attempts: 3 } }))
  const answer = await run($, w, 'aprovar encerrar')
  expect(answer).toMatch(/\/orquestrador encerrar \[motivo\] confirmar/)
  expect(saved(w).status).toBe('escalated')
  expect(logOf(w).some(e => (e as { kind?: string }).kind === 'aborted')).toBe(false)
  // the typed command with confirmar still ends it
  expect(await run($, w, 'encerrar confirmar')).toBe('Flow de b encerrado por você.')
})

test('status shows the permission notice even before the panel has a view', async ($, on) => {
  const w = world(on, 'ask')
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  expect(await run($, w, 'status')).toMatch(/Permita get_session e list_sessions/)
})

test('with "ask" and this session\'s id not kept yet, the commands and flow pending answer with the permission notice, not "other session" or "no flow"', async ($, on) => {
  const w = world(on, 'ask')
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  // the coordination of the flow is known (written when the permission was allowed), this session's id is not
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w), coordinatorSession: 'local_ee' }))
  expect(await run($, w, 'abrir')).toMatch(/Permita get_session e list_sessions/)
  expect(await run($, w, 'abrir')).not.toMatch(/Nenhum flow/)
  const kept = await flow($, { action: 'pending', sessions: [entry('1')] })
  expect(kept.isError).toBe(true)
  expect(String(kept.result)).toMatch(/Permita get_session e list_sessions/)
  expect(String(kept.result)).not.toMatch(/only the session that coordinates/)
})
