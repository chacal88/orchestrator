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
  /** When set, the app keeps the panes the mod opens, by id, so a second toggle closes them. */
  panes: boolean
  open: string[]
  /** The names the mod asked `$.command.register` and `$.tool.register` for. */
  registered: string[]
  tools: string[]
  /** Moves the clock forward, as minutes passing between two commands. */
  advance: (ms: number) => void
  /** With `ownState`, the mod's `$.state`, held by the world so a test can empty it as a reinstall does (the panes then draw nothing). */
  kept: Map<string, unknown>
}

/**
 * A coordinator (local_ee, at /w) whose app opens a running child on each start_session and answers with its
 * id, files sessions under sidebar groups, and asks `permission` for its session-list tools.
 */
const world = (on: On, permission: Decision = 'allow', ownState = false): World => {
  mock.store(on)
  let now = 1_000
  const w: World = {
    disk: new Map([ACTIVE]),
    rows: [{ sessionId: 'local_ee', cwd: '/w', title: 'Coordenação', isRunning: false }],
    calls: [],
    toasts: [],
    prompts: [],
    permission,
    appRefuses: false,
    panes: false,
    open: [],
    registered: [],
    tools: [],
    advance: ms => {
      now += ms
    },
    kept: new Map(),
  }
  let version = 0
  if (ownState) on('state.get', (_$, e) => ({ value: { value: w.kept.get((e as { key: string }).key), version } }) as never)
  if (ownState)
    on('state.set', (_$, e) => {
      const { key, value } = e as unknown as { key: string; value: unknown }
      w.kept.set(key, value)
      version += 1
      return { value: { isSet: true, version } } as never
    })
  const groups: { id: string; name: string }[] = []
  on('env.get', () => ({ value: '/h' }))
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
  on('ui.open', ($, e) => {
    if (w.panes && !w.open.includes(e.id)) w.open.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', ($, e) => {
    w.open = w.open.filter(id => id !== e.id)
    return { value: undefined } as never
  })
  on('ui.panes', () => ({ value: w.open.map(id => ({ id })) }) as never)
  on('command.register', ($, e) => {
    w.registered.push(e.name)
    return { value: undefined } as never
  })
  on('tool.register', ($, e) => {
    w.tools.push(e.name)
    return { value: undefined } as never
  })
  on('session.start', () => ({ cwd: '/w' }) as never)
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


type Origin = { kind: string; name?: string }
const COMPOSER: Origin = { kind: 'composer' }

/** The person (or whoever `origin` says) typing `/orchestrator:<action> <args>`; the text the command answers. */
const run = async ($: Engine, w: World, action: string, args = '', origin: Origin = COMPOSER): Promise<string> => {
  const done = (await $.command.run({ command: `orchestrator:${action}`, args, origin } as never)) as { text?: string }
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

const mount = (surface: 'desktop' | 'mobile' = 'desktop') => ({ plugin: 'orchestrator', surface, ...PANE }) as const
const click = async ($: Engine, ...keys: string[]) => {
  const ui = await $.ui.mount(mount())
  for (const key of keys) {
    await ui.press({ key })
    await settle()
  }
  await ui.unmount()
}

test('C10: approve with nothing after it, at the grill, records fechado and goes to the mockup, as the click does', async ($, on) => {
  const w = world(on)
  w.disk.set(`${BASE}/autowake.json`, JSON.stringify({ '/w': { on: true, at: 1 } }))
  await flow($, { action: 'start', change: 'b', flow: 'completo', visual: true })
  expect(saved(w).current).toBe('grill')

  const clicked = await rewound(w, () => click($, 'flow:grill:fechado'))
  expect(clicked.prompts.length).toBeGreaterThan(0)
  expect((clicked.state as FlowState).current).toBe('mockup')

  const typed = await run($, w, 'approve')
  expect(typed).toBe('Registrado: Entendimento fechado. Próximo passo: Mockup.')
  const after = snapshot(w)
  expect(saved(w).records.grill).toEqual(expect.objectContaining({ outcome: 'fechado', by: 'owner' }))
  expect(after.log.at(-2)).toEqual(expect.objectContaining({ kind: 'outcome', step: 'grill', outcome: 'fechado', by: 'owner' }))
  expect(after.prompts).toEqual(clicked.prompts)
  expect(after.log).toEqual(clicked.log)
  expect(after.state).toEqual(clicked.state)
})

test("approve and reject on a step that is not the owner's say the step and who answers it, and change nothing", async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  expect(saved(w).current).toBe('planejar')
  const before = snapshot(w)
  for (const action of ['approve', 'reject']) {
    expect(await run($, w, action, 'qualquer coisa')).toMatch(/^O passo atual \(.+\) não é seu: quem responde é a sessão da coordenação\.$/)
  }
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
    const typed: [string, string][] = [
      ['approve', 'fechado'],
      ['reject', ''],
      ['open', ''],
      ['status', ''],
      ['help', ''],
      ['skip-gate', '1'],
      ['end', ''],
    ]
    for (const [action, args] of typed) {
      expect([origin.kind, action, await run($, w, action, args, origin)]).toEqual([origin.kind, action, expect.stringMatching(/só vale digitado por você/)])
    }
  }
  expect(snapshot(w)).toEqual(before)
  expect(w.calls.filter(c => c.tool === T.start)).toEqual([])
  // opening a pane decides nothing, so any origin may
  expect(await run($, w, 'panel', '', { kind: 'plugin', name: 'x' })).toMatch(/Painel/)
  expect(await run($, w, 'workflows', '', { kind: 'plugin', name: 'x' })).toMatch(/Painel de workflows/)
})

test('through the bridge it works, and the answer is plain text: no table, no heading, no bold', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  const status = await run($, w, 'status', '', { kind: 'bridge' })
  // the grill has no adjustments: no reject line
  expect(status).toBe('Flow de b (Completo): em andamento\nPasso: Entendimento (você)\nPara seguir: /orchestrator:approve')
  expect(status).not.toMatch(/[|#*]|```/)
  const help = await run($, w, 'help', '', { kind: 'bridge' })
  expect(help).toMatch(/\/orchestrator:status: .*\n\/orchestrator:approve: .*\n\/orchestrator:reject: /)
  expect(help).not.toMatch(/[|#*]|```/)
  const moved = await run($, w, 'approve', '', { kind: 'bridge' })
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

test('the release step is refused with the plan-mode notice, as the button is, and nothing changes', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w), current: 'liberacao' }))
  const before = snapshot(w)
  expect(await run($, w, 'approve')).toBe('A liberação vem do plan mode: aprove o plano de execução no diálogo do app.')
  expect(snapshot(w)).toEqual(before)
})

test('C8: status through the bridge, at the mockup, is the mockup\'s four plain lines', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo', visual: true })
  await run($, w, 'approve')
  expect(saved(w).current).toBe('mockup')
  const status = await run($, w, 'status', '', { kind: 'bridge' })
  expect(status).toBe(
    'Flow de b (Completo): em andamento\nPasso: Mockup (você)\nPara seguir: /orchestrator:approve\nPara pedir ajustes: /orchestrator:reject <o que mudar>',
  )
  expect(status).not.toMatch(/[|#*]|```|^\s*[-+] /m)
})

test('C10: reject with free text at the mockup records ajustes with that note, as "Pedir ajuste" does', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo', visual: true })
  await run($, w, 'approve')
  expect(saved(w).current).toBe('mockup')
  const typed = await run($, w, 'reject', 'trocar skip-gate por skip')
  expect(typed).toBe('Registrado: Pedir ajustes (nota: trocar skip-gate por skip). Próximo passo: Mockup.')
  expect(saved(w).current).toBe('mockup')
  expect(logOf(w)).toContainEqual(expect.objectContaining({ kind: 'outcome', step: 'mockup', outcome: 'ajustes', by: 'owner', note: 'trocar skip-gate por skip' }))
})

test('C10: reject at production, which has no adjustments, says so and points to approve; the flow does not move', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify({ ...saved(w), current: 'producao' }))
  const before = snapshot(w)
  expect(await run($, w, 'reject', 'algo')).toBe('O passo atual (Em produção) não tem opção de ajustes. Para seguir: /orchestrator:approve')
  expect(await run($, w, 'reject')).toBe('O passo atual (Em produção) não tem opção de ajustes. Para seguir: /orchestrator:approve')
  expect(snapshot(w)).toEqual(before)
})

test('abrir opens the pending sessions as the owner typed it, and the phone is told when the app refuses', async ($, on) => {
  const w = world(on)
  await atLoopWithPending($, w)
  const typed = await run($, w, 'open')
  expect(typed).toBe('Abriram 3 sessões pendentes.')
  const consent = 'The user typed "/orchestrator:open".'
  expect(starts(w).map(c => [c.title, c.initiation, c.consent])).toEqual([
    ['Fase 1', 'user_asked', consent],
    ['Fase 2', 'user_asked', consent],
    ['Fase 3', 'user_asked', consent],
  ])
  expect(saved(w).pendingStarts).toBeUndefined()
  expect(saved(w).tracked).toEqual(['local_c1', 'local_c2', 'local_c3'])
  expect(logOf(w).filter(e => (e as { kind: string }).kind === 'pending-opened')).toEqual([expect.objectContaining({ by: 'owner', note: '1, 2, 3' })])
  expect(await run($, w, 'open')).toBe('Nenhuma sessão pendente para abrir.')
})

test('abrir through the bridge, with the app refusing, says the phone cannot open sessions', async ($, on) => {
  const w = world(on)
  await atLoopWithPending($, w)
  w.appRefuses = true
  expect(await run($, w, 'open', '', { kind: 'bridge' })).toMatch(/Pelo celular o app não abre sessões; digite \/orchestrator:open no desktop\.$/)
  expect(saved(w).pendingStarts).toHaveLength(3)
  expect(await run($, w, 'open')).toMatch(/O app não aceitou abrir pelo painel; digite \/orchestrator:open no desktop\.$/)
})

const PLAN = {
  change: 'b',
  changePath: 'openspec/changes/b',
  waves: [{ phases: [{ id: '2', title: 'Tela', status: 'running', gates: ['testes', 'lint'], tasks: '2.1' }] }],
}

/** The flow of change b on its phase loop, with phase 2's plan published: gates testes and lint, both open. */
const atLoopWithPlan = async ($: Engine, w: World) => {
  await flow($, { action: 'start', change: 'b', flow: 'rapido' })
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await $.tool.call({ tool: 'Bash', command: 'npx openspec validate b --strict' } as never)
  expect(saved(w).current).toBe('executar')
  await $.tool.call({ tool: 'mcp__orchestrator__plan', ...PLAN } as never)
  expect(snapshot(w).skips).toEqual({})
}

const LIST = 'Portões abertos:\n1. fase 2: testes\n2. fase 2: lint\nPara pular: /orchestrator:skip-gate 2'
const ASK_2 = 'Pular "fase 2: lint"? Rode /orchestrator:skip-gate 2 de novo em até 2 minutos.'

test('C12: skip-gate lists the open gates numbered; a number the list does not have, or no number, answers the list', async ($, on) => {
  const w = world(on, 'allow', true)
  await atLoopWithPlan($, w)
  const none = snapshot(w)
  expect(await run($, w, 'skip-gate')).toBe(LIST)
  expect(await run($, w, 'skip-gate', 'x')).toBe(LIST)
  expect(await run($, w, 'skip-gate', '9')).toBe(LIST)
  expect(snapshot(w)).toEqual(none)
  expect(w.kept.get('skip-ask')).toBeUndefined()
})

test('C12: skip-gate 2 asks; the same again within 60 s skips the gate the panel skips', async ($, on) => {
  const w = world(on)
  await atLoopWithPlan($, w)
  const clicked = await rewound(w, () => click($, 'arm:2:lint', 'skip:2:lint'))
  expect(clicked.skips).toEqual({ skips: { '2:lint': {} } })
  const none = snapshot(w)

  expect(await run($, w, 'skip-gate', '2')).toBe(ASK_2)
  expect(snapshot(w)).toEqual(none)
  w.advance(60_000)
  expect(await run($, w, 'skip-gate', '2')).toBe('Portão "fase 2: lint" pulado.')
  expect(snapshot(w).skips).toEqual(clicked.skips)
  // the skip is the panel's: the log has it, by the owner
  expect(bare(w.disk.get(`${BASE}/gates/b.ndjson`)?.trim() ?? '{}')).toEqual(expect.objectContaining({ kind: 'skipped', key: '2:lint', by: 'owner' }))
  expect(await run($, w, 'skip-gate')).toBe('Portões abertos:\n1. fase 2: testes\nPara pular: /orchestrator:skip-gate 1')
})

test('C12: the repetition after 121 s only asks again, and the one right after that skips', async ($, on) => {
  const w = world(on)
  await atLoopWithPlan($, w)
  expect(await run($, w, 'skip-gate', '2')).toBe(ASK_2)
  w.advance(121_000)
  expect(await run($, w, 'skip-gate', '2')).toBe(ASK_2)
  expect(snapshot(w).skips).toEqual({})
  expect(await run($, w, 'skip-gate', '2')).toBe('Portão "fase 2: lint" pulado.')
})

test('C12: skip-gate 2 then skip-gate 1 skips neither; 1 again then skips only that one, and the ask is gone', async ($, on) => {
  const w = world(on, 'allow', true)
  await atLoopWithPlan($, w)
  expect(await run($, w, 'skip-gate', '2')).toBe(ASK_2)
  expect(await run($, w, 'skip-gate', '1')).toBe('Pular "fase 2: testes"? Rode /orchestrator:skip-gate 1 de novo em até 2 minutos.')
  expect(snapshot(w).skips).toEqual({})
  expect(await run($, w, 'skip-gate', '1')).toBe('Portão "fase 2: testes" pulado.')
  expect(Object.keys((snapshot(w).skips as { skips: object }).skips)).toEqual(['2:testes'])
  expect(w.kept.get('skip-ask')).toBeNull()
})

test('C12: when the list changes between the two, the gate now numbered N is never skipped on the old ask', async ($, on) => {
  const w = world(on)
  await atLoopWithPlan($, w)
  expect(await run($, w, 'skip-gate', '1')).toBe('Pular "fase 2: testes"? Rode /orchestrator:skip-gate 1 de novo em até 2 minutos.')
  // the panel skips testes meanwhile: number 1 is lint now
  await click($, 'arm:2:testes', 'skip:2:testes')
  expect(await run($, w, 'skip-gate', '1')).toBe('Pular "fase 2: lint"? Rode /orchestrator:skip-gate 1 de novo em até 2 minutos.')
  expect(Object.keys((snapshot(w).skips as { skips: object }).skips)).toEqual(['2:testes'])
})

test("skip-gate and status read the open gates from disk: with the mod's state emptied, as a reinstall leaves it, they are still listed", async ($, on) => {
  const w = world(on, 'allow', true)
  await atLoopWithPlan($, w)
  w.kept.clear()
  expect(await run($, w, 'skip-gate')).toBe(LIST)
  w.kept.clear()
  expect(await run($, w, 'status')).toMatch(/\nPortões abertos: fase 2: testes, fase 2: lint(\n|$)/)
})

test('panel opens and closes the pane as /orquestrador with no argument did, for any origin', async ($, on) => {
  const w = world(on)
  w.panes = true
  expect(await run($, w, 'panel')).toBe('Painel do Orchestrator aberto.')
  expect(w.open).toEqual(['orchestrator'])
  expect(await run($, w, 'panel', '', { kind: 'plugin', name: 'x' })).toBe('Painel do Orchestrator fechado.')
  expect(w.open).toEqual([])
})

test('help lists the eleven commands, one per line, in plain text', async ($, on) => {
  const w = world(on)
  const help = await run($, w, 'help')
  const names = help
    .split('\n')
    .slice(1)
    .map(line => line.split(':').slice(0, 2).join(':'))
  expect(names).toEqual([
    '/orchestrator:status',
    '/orchestrator:approve',
    '/orchestrator:reject',
    '/orchestrator:open',
    '/orchestrator:skip-gate',
    '/orchestrator:end',
    '/orchestrator:panel',
    '/orchestrator:workflows',
    '/orchestrator:change',
    '/orchestrator:install',
    '/orchestrator:help',
  ])
  expect(help).not.toMatch(/[|#*]|```/)
})

test('/orquestrador and /orquestrador-workflows are no longer registered, and no command is: the plugin\'s come from commands/', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true } as never)
  await settle()
  // the start ran: the tools are there, and no command beside them
  expect(w.tools).toEqual(['plan', 'flow'])
  expect(w.registered).toEqual([])
  const old = (await $.command.run({ command: 'orquestrador', args: 'status', origin: COMPOSER } as never).catch(() => ({}))) as { text?: string }
  expect(old.text ?? '').not.toMatch(/Flow de|Painel/)
})

test('C11: end ends the flow at once, as the second press of the button does, and nothing is sent', async ($, on) => {
  const w = world(on)
  w.disk.set(`${BASE}/autowake.json`, JSON.stringify({ '/w': { on: true, at: 1 } }))
  await flow($, { action: 'start', change: 'b', flow: 'completo' })

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
  expect(await run($, w, 'end')).toBe('Flow de b encerrado.')
  expect(saved(w).status).toBe('aborted')
  expect(logOf(w).at(-1)).toEqual(expect.objectContaining({ kind: 'aborted', by: 'owner' }))
  expect(snapshot(w)).toEqual(clicked)
  expect(w.prompts.length).toBe(prompts)
  expect(w.calls.filter(c => c.tool === T.start)).toEqual([])
})

test('C11: end mudou o escopo leaves the flow aborted with that note, in one call; a plugin origin is refused and the flow runs on', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  expect(await run($, w, 'end', 'mudou o escopo', { kind: 'plugin', name: 'x' })).toMatch(/só vale digitado por você/)
  expect(saved(w).status).toBe('running')
  expect(await run($, w, 'end', 'mudou o escopo', { kind: 'bridge' })).toBe('Flow de b encerrado (motivo: mudou o escopo).')
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
  expect(await run($, w, 'end')).toBe('Flow de b encerrado.')
  expect(saved(w).status).toBe('aborted')

  // an ended flow is no flow of this coordination any more; the command says so, and the button is gone
  expect(await run($, w, 'end')).toMatch(/Nenhum flow em andamento/)
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

test('on an escalation approve tries again, as its first button, and reject points to end; nothing asks for a word', async ($, on) => {
  const w = world(on)
  await flow($, { action: 'start', change: 'b', flow: 'completo' })
  const escalated = { ...saved(w), status: 'escalated', escalation: { step: 'grill', from: 'grill', outcome: 'x', attempts: 3 } }
  w.disk.set(`${BASE}/flows/b.json`, JSON.stringify(escalated))
  expect(await run($, w, 'reject', 'algo')).toBe('Uma escalada não tem ajustes. Para encerrar o flow: /orchestrator:end [motivo]')
  expect(saved(w).status).toBe('escalated')
  // the panel draws the escalation's buttons once a refresh read it
  expect(await run($, w, 'status')).toMatch(/Para tentar de novo: \/orchestrator:approve\nPara encerrar: \/orchestrator:end \[motivo\]/)
  const clicked = await rewound(w, () => click($, 'flow:grill:tentar-de-novo'))
  expect((clicked.state as FlowState).status).toBe('running')
  expect(await run($, w, 'approve')).toMatch(/^Registrado: Tentar de novo\./)
  expect(snapshot(w).state).toEqual(clicked.state)
  expect(snapshot(w).log).toEqual(clicked.log)
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
  expect(await run($, w, 'open')).toMatch(/Permita get_session e list_sessions/)
  expect(await run($, w, 'open')).not.toMatch(/Nenhum flow/)
  const kept = await flow($, { action: 'pending', sessions: [entry('1')] })
  expect(kept.isError).toBe(true)
  expect(String(kept.result)).toMatch(/Permita get_session e list_sessions/)
  expect(String(kept.result)).not.toMatch(/only the session that coordinates/)
})
