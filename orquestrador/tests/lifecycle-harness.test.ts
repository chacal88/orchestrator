import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { ActivityRecord, FlowEvent, FlowState, OrchestrationRun } from '../types'
import { activityKey } from '../hooks/model'

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }

const BASE = '/h/.claude/orquestrador'
const STATE = `${BASE}/flows/demo.json`
const LOG = `${BASE}/flows/demo.ndjson`
const TASKS = '/w/openspec/changes/demo/tasks.md'

const ME = { sessionId: 'me', cwd: '/w', title: 'Coordenação' }
const A = { sessionId: 'a', cwd: '/w/wt/a', title: 'Fase A', name: 'fase-a', startedBy: 'me' }
const B = { sessionId: 'b', cwd: '/w/wt/b', title: 'Fase B', name: 'fase-b', startedBy: 'me' }

type World = { disk: Map<string, string>; calls: Record<string, unknown>[]; dirty: Record<string, string>; rows: object[] }

/** A coordinator at /w with two phase sessions, an in-memory disk and git status per checkout. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), calls: [], dirty: {}, rows: [ME, A, B] }
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
  on('process.run', ($, e) => {
    const cwd = e.argv[2] ?? ''
    return { value: { exitCode: 0, stdout: w.dirty[cwd] ?? '', stderr: '' } as never }
  })
  on('tool.list', () => ({
    value: [
      { name: 'mcp__ccd_session_mgmt__list_sessions' },
      { name: 'mcp__ccd_session_mgmt__get_session' },
      { name: 'mcp__ccd_sidebar__list_groups' },
    ] as never,
  }))
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    w.calls.push(input)
    if (input.tool === 'mcp__ccd_session_mgmt__get_session') return answer(JSON.stringify(ME))
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return answer(JSON.stringify(w.rows))
    if (input.tool === 'mcp__ccd_sidebar__list_groups') return answer(JSON.stringify([{ id: 'cg-1', name: '🪪 demo' }]))
    if (input.tool === 'Bash') {
      return String(input.command).includes('FAIL')
        ? ({ isError: true, result: 'exit 1', text: 'Exit code 1' } as never)
        : ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never)
    }
    return answer('ok')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orquestrador__flow', ...input } as never) as Promise<Reply>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Reply>
const saved = (w: World) => JSON.parse(w.disk.get(STATE) ?? '{}') as FlowState
const log = (w: World) => (w.disk.get(LOG) ?? '').trim().split('\n').map(line => JSON.parse(line) as FlowEvent)
const archived = (w: World) =>
  w.calls.filter(c => c.tool === 'mcp__ccd_session_mgmt__archive_session').map(c => c.session_id)

const plan = (w: World) => {
  const run: OrchestrationRun = {
    change: 'demo', changePath: 'openspec/changes/demo', coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
    waves: [{
      title: undefined, summary: undefined, jira: undefined,
      phases: [
        { id: 'A', title: 'Base', status: 'running', icon: undefined, tasks: '1.x', session: 'fase-a', dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates: ['testes'] },
        { id: 'B', title: 'Tela', status: 'running', icon: undefined, tasks: '2.x', session: 'fase-b', dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates: undefined },
      ],
    }],
    ownerQuestions: [], finalGates: undefined, updatedAt: 1,
  }
  w.disk.set(`${BASE}/runs/demo.json`, JSON.stringify(run))
  w.disk.set(TASKS, '## 1. Base\n- [x] 1.1 Modelo\n- [ ] 1.2 Rotas\n\n## 2. Tela\n- [x] 2.1 Lista\n')
}

const passTests = (w: World, cwd: string) => {
  const record: ActivityRecord = {
    cwd, plan: [], lastTool: 'Bash', waiting: undefined, updatedAt: 2_000,
    gates: { testes: { gate: 'testes', result: 'passed', evidence: 'npm test', at: 2_000 } },
  }
  w.disk.set(`${BASE}/sessions/${activityKey(cwd)}.json`, JSON.stringify(record))
}

const toExecutar = async ($: Engine) => {
  await flow($, { action: 'start', change: 'demo', flow: 'rapido', changePath: 'openspec/changes/demo' })
  await flow($, { action: 'report', step: 'planejar', outcome: 'pronto' })
  await bash($, 'openspec validate demo')
}

test('a phase closes only with its tasks ticked, its gates passed and its work committed; then its session is archived', async ($, on) => {
  const w = world(on)
  plan(w)
  await toExecutar($)
  expect(saved(w).current).toBe('executar')

  const reported = await flow($, { action: 'report', step: 'executar', outcome: 'concluidas' })
  expect(String(reported.result)).toMatch(/is a loop step: only the mod/)

  const unticked = await flow($, { action: 'close', phase: 'A' })
  expect(String(unticked.result)).toMatch(/tasks 1\.2 are not ticked in tasks\.md\. phase A \(Base\) cannot close: testes not run/)

  w.disk.set(TASKS, '## 1. Base\n- [x] 1.1 Modelo\n- [x] 1.2 Rotas\n\n## 2. Tela\n- [x] 2.1 Lista\n')
  passTests(w, '/w/wt/a')
  w.dirty['/w/wt/a'] = ' M hooks/rotas.ts\n'
  const dirty = await flow($, { action: 'close', phase: 'A' })
  expect(String(dirty.result)).toMatch(/session "fase-a" has uncommitted changes in \/w\/wt\/a \(hooks\/rotas\.ts\)/)
  expect(archived(w)).toEqual([])

  w.dirty['/w/wt/a'] = ''
  const closed = await flow($, { action: 'close', phase: 'A' })
  expect(String(closed.result)).toBe('Phase A closed, session "fase-a" archived. Still open: B (Tela).')
  expect(archived(w)).toEqual(['a'])
  expect(saved(w).current).toBe('executar')

  w.rows = [ME, { ...A, isArchived: true }, B]
  const last = await flow($, { action: 'close', phase: 'B' })
  expect(String(last.result)).toMatch(/^Phase B closed, session "fase-b" archived\. Every phase is closed\. .*step "revisao-codigo"/)
  expect(saved(w).records.executar).toMatchObject({ outcome: 'concluidas', by: 'mod' })
  const kinds = log(w).map(e => [e.kind, e.by])
  expect(kinds.filter(([k]) => k === 'refused')).toHaveLength(3)
  expect(kinds.slice(-6)).toEqual([
    ['phase-closed', 'mod'], ['session-archived', 'mod'],
    ['phase-closed', 'mod'], ['session-archived', 'mod'],
    ['outcome', 'mod'], ['entered', 'mod'],
  ])
})

test('after QA asks for changes the loop waits for the new tasks; the deploy is seen; archiving cleans the sidebar up', async ($, on) => {
  const w = world(on)
  await toExecutar($)
  w.disk.set(TASKS, '## 1. Tudo\n- [x] 1.1 Feito\n')
  await flow($, { action: 'close', phase: '1' })
  await flow($, { action: 'report', step: 'revisao-codigo', outcome: 'aprovado' })
  w.disk.set('/w/openspec/changes/demo/evidence.md', '# Evidence\n\n## Testes\n\nok\n')
  await bash($, 'sh scripts/check.sh')
  await flow($, { action: 'report', step: 'pr', outcome: 'aberto' })
  expect(saved(w).current).toBe('qa')

  await flow($, { action: 'note', note: 'QA: o filtro não salva' })
  const ui = await $.ui.mount({
    plugin: 'orquestrador', surface: 'desktop', component: 'Pane', requestId: 'orquestrador',
    props: { title: 'Orquestrador', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as never)
  await ui.press({ key: 'flow:qa:ajustes' })
  await ui.unmount()
  expect(saved(w).current).toBe('executar')
  expect(String((await flow($, { action: 'status' })).result)).toMatch(/Came back from "qa" \(QA pediu ajustes\): QA: o filtro não salva\./)

  w.disk.set(TASKS, '## 1. Tudo\n- [x] 1.1 Feito\n- [ ] 1.2 Filtro salva\n')
  expect(String((await flow($, { action: 'close' })).result)).toBe('Still open: 1 (Tudo).')
  w.disk.set(TASKS, '## 1. Tudo\n- [x] 1.1 Feito\n- [x] 1.2 Filtro salva\n')
  await flow($, { action: 'close', phase: '1' })
  await flow($, { action: 'report', step: 'revisao-codigo', outcome: 'aprovado' })
  await bash($, 'sh scripts/check.sh')
  await flow($, { action: 'report', step: 'pr', outcome: 'aberto' })

  const ui2 = await $.ui.mount({
    plugin: 'orquestrador', surface: 'desktop', component: 'Pane', requestId: 'orquestrador',
    props: { title: 'Orquestrador', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as never)
  await ui2.press({ key: 'flow:qa:aprovado' })
  await ui2.unmount()
  expect(saved(w).current).toBe('producao')

  await bash($, 'npm run deploy FAIL')
  expect(saved(w).current).toBe('producao')
  await bash($, 'npm run deploy')
  expect(saved(w).current).toBe('arquivar')
  expect(saved(w).records.producao).toMatchObject({ outcome: 'publicado', by: 'detect', note: 'comando: npm run deploy' })

  w.dirty['/w/wt/b'] = '?? rascunho.md\n'
  await bash($, 'openspec archive demo --yes')
  expect(saved(w).status).toBe('done')
  expect(archived(w)).toEqual(['a'])
  expect(w.calls.filter(c => c.tool === 'mcp__ccd_sidebar__delete_group').map(c => c.group_id)).toEqual(['cg-1'])
  expect(log(w).slice(-5).map(e => [e.kind, e.note ?? e.outcome])).toEqual([
    ['outcome', 'passou'],
    ['session-archived', 'fase-a'],
    ['session-archived', 'fase-b not archived — session "fase-b" has uncommitted changes in /w/wt/b (rascunho.md); commit them in that session first.'],
    ['cleanup', 'sidebar group 🪪 demo removed'],
    ['done', undefined],
  ])
})

test('a phase sharing the coordinator\'s folder proves its gate by its own session id', async ($, on) => {
  const w = world(on)
  const SAME = { sessionId: 'a', cwd: '/w', title: 'Fase A', name: 'fase-a', startedBy: 'me' }
  w.rows = [ME, SAME, B]
  plan(w)
  await toExecutar($)
  w.disk.set(TASKS, '## 1. Base\n- [x] 1.1 Modelo\n- [x] 1.2 Rotas\n\n## 2. Tela\n- [x] 2.1 Lista\n')

  const unproven = await flow($, { action: 'close', phase: 'A' })
  expect(String(unproven.result)).toMatch(/testes not run/)

  // what the phase's own mod publishes after its test run, in the same folder as this session
  const record: ActivityRecord = {
    sessionId: 'a', cwd: '/w', plan: [], lastTool: 'Bash', waiting: undefined, updatedAt: 2_000,
    gates: { testes: { gate: 'testes', result: 'passed', evidence: 'claude plugin test orquestrador', at: 2_000 } },
  }
  w.disk.set(`${BASE}/sessions/id-a.json`, JSON.stringify(record))
  const closed = await flow($, { action: 'close', phase: 'A' })
  expect(String(closed.result)).toBe('Phase A closed, session "fase-a" archived. Still open: B (Tela).')
})

test('each session publishes its activity under its own id, and a sibling in the same folder never inherits it', async ($, on) => {
  const w = world(on)
  const SAME = { sessionId: 'a', cwd: '/w', title: 'Fase A', name: 'fase-a', startedBy: 'me' }
  w.rows = [ME, SAME, B]
  plan(w)
  await toExecutar($)
  await bash($, 'npm test')
  const own = JSON.parse(w.disk.get(`${BASE}/sessions/id-me.json`) ?? '{}') as ActivityRecord
  expect([own.sessionId, own.cwd]).toEqual(['me', '/w'])
  expect(w.disk.has(`${BASE}/sessions/${activityKey('/w')}.json`)).toBe(false)

  w.disk.set(TASKS, '## 1. Base\n- [x] 1.1 Modelo\n- [x] 1.2 Rotas\n\n## 2. Tela\n- [x] 2.1 Lista\n')
  expect(String((await flow($, { action: 'close', phase: 'A' })).result)).toMatch(/testes not run/)
})

test('the owner skips a phase gate from the Gates card while the loop runs, and the close honours it', async ($, on) => {
  const w = world(on)
  plan(w)
  await toExecutar($)
  w.disk.set(TASKS, '## 1. Base\n- [x] 1.1 Modelo\n- [x] 1.2 Rotas\n\n## 2. Tela\n- [x] 2.1 Lista\n')
  const PANE = {
    component: 'Pane',
    requestId: 'orquestrador',
    props: { title: 'Orquestrador', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  } as const
  // publishing the plan refreshes the view the panel draws from, as in the app
  await $.tool.call({
    tool: 'mcp__orquestrador__plano',
    change: 'demo',
    changePath: 'openspec/changes/demo',
    waves: [{ phases: [
      { id: 'A', title: 'Base', status: 'running', tasks: '1.x', session: 'fase-a', gates: ['testes'] },
      { id: 'B', title: 'Tela', status: 'running', tasks: '2.x', session: 'fase-b' },
    ] }],
  } as never)
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'arm:A:testes' })).toBeDefined()
  await ui.press({ key: 'arm:A:testes' })
  await ui.press({ key: 'skip:A:testes' })
  for (let i = 0; i < 20 && !w.disk.has(`${BASE}/gates/demo.json`); i++) await Promise.resolve()
  expect(JSON.parse(w.disk.get(`${BASE}/gates/demo.json`) ?? '{}').skips?.['A:testes']).toBeDefined()
  await ui.unmount()
  const closed = await flow($, { action: 'close', phase: 'A' })
  expect(String(closed.result)).toMatch(/^Phase A closed/)
})
