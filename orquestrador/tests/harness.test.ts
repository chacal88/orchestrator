import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const PANE = {
  component: 'Pane',
  requestId: 'orquestrador',
  props: { title: 'Orquestrador', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const ME = { sessionId: 'local_me', cwd: '/w', title: 'coordenador' }
const child = (name: string, archived = false) => ({
  sessionId: `local_${name}`,
  cwd: `/w/.claude/worktrees/${name}`,
  title: `🛠 ${name}`,
  name,
  startedBy: ME.sessionId,
  isArchived: archived,
})

type World = { disk: Map<string, string>; family: Record<string, unknown>[]; calls: string[] }

/** A coordinator at /w with its family, a disk in memory, and an engine that answers every tool. */
const world = (on: On, family: Record<string, unknown>[]): World => {
  mock.store(on)
  const w: World = { disk: new Map(), family, calls: [] }
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
  on('tool.list', () => ({
    value: [{ name: 'mcp__ccd_session_mgmt__list_sessions' }, { name: 'mcp__ccd_session_mgmt__get_session' }] as never,
  }))
  const answer = (text: string, result: unknown = text) => ({ result, text }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    w.calls.push(String(input.tool))
    if (input.tool === 'mcp__ccd_session_mgmt__get_session') return answer(JSON.stringify(ME))
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return answer(JSON.stringify(w.family))
    if (input.tool === 'Bash') {
      const failing = String(input.command).includes('FAIL')
      return failing
        ? ({ isError: true, result: 'exit 1', text: 'Exit code 1' } as never)
        : answer('ok', { stdout: 'ok', stderr: '', interrupted: false })
    }
    return answer('ok')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

const plan = ($: Engine, status: string, extra: Record<string, unknown> = {}) =>
  $.tool.call({
    tool: 'mcp__orquestrador__plano',
    change: 'demo',
    waves: [{ phases: [{ id: '1', title: 'API', status, gates: ['testes'], ...extra }] }],
  } as never) as Promise<{ result?: unknown; isError?: boolean; deny?: string }>

test('a phase cannot be marked done until its gate passed, and a later edit makes it stale', async ($, on) => {
  world(on, [])
  expect((await plan($, 'running')).isError).toBeUndefined()

  const early = await plan($, 'done')
  expect(early.isError).toBe(true)
  expect(String(early.result)).toMatch(/phase 1 \(API\) cannot close: testes not run/)

  await $.tool.call({ tool: 'Bash', command: 'npx vitest run FAIL' } as never)
  expect(String((await plan($, 'done')).result)).toMatch(/testes failed/)

  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(String((await plan($, 'done')).result)).toMatch(/testes stale/)

  await $.tool.call({ tool: 'Edit', file_path: '/w/openspec/changes/demo/evidence.md', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/w/openspec/changes/demo/evidence.md', old_string: 'b', new_string: 'c' } as never)
  const closed = await plan($, 'done')
  expect(closed.isError).toBeUndefined()
  // once closed, the phase stays closed on later publishes
  await $.tool.call({ tool: 'Edit', file_path: '/w/src/a.ts', old_string: 'b', new_string: 'c' } as never)
  expect((await plan($, 'done')).isError).toBeUndefined()
})

test('a phase session is judged by what its own mod published, and cannot be archived while a gate is open', async ($, on) => {
  const w = world(on, [child('api')])
  expect((await plan($, 'running', { session: 'api' })).isError).toBeUndefined()

  const archive = { tool: 'mcp__ccd_session_mgmt__archive_session', session_id: 'local_api' }
  const refused = (await $.tool.call(archive as never)) as { deny?: string }
  expect(refused.deny).toMatch(/Orchestrator gate: phase 1 \(API\) cannot close: testes not run .*session "🛠 api"/)
  expect(w.calls).not.toContain('mcp__ccd_session_mgmt__archive_session')

  w.disk.set(
    '/h/.claude/orquestrador/sessions/w-claude-worktrees-api.json',
    JSON.stringify({
      cwd: '/w/.claude/worktrees/api', plan: [], updatedAt: 1,
      gates: { testes: { gate: 'testes', result: 'passed', evidence: 'npm test', at: 50 } },
      editedAt: 40,
    }),
  )
  expect(((await $.tool.call(archive as never)) as { deny?: string }).deny).toBeUndefined()
  expect((await plan($, 'done', { session: 'api' })).isError).toBeUndefined()
})

test('the fourth live phase session is refused; archived ones do not count', async ($, on) => {
  const w = world(on, [child('a'), child('b'), child('c', true)])
  const start = { tool: 'mcp__ccd_session__start_session', initiation: 'user_asked', title: 'x', prompt: 'p' }
  expect(((await $.tool.call(start as never)) as { deny?: string }).deny).toBeUndefined()
  w.family = [child('a'), child('b'), child('d')]
  const refused = (await $.tool.call(start as never)) as { deny?: string }
  expect(refused.deny).toMatch(/3 phase sessions are alive \(a, b, d\); the ceiling is 3/)
})

test('the model cannot write the gate files; gh pr merge waits for the final gates', async ($, on) => {
  world(on, [])
  const forged = (await $.tool.call({
    tool: 'Write',
    file_path: '/h/.claude/orquestrador/gates/demo.json',
    content: '{"skips":{}}',
  } as never)) as { deny?: string }
  expect(forged.deny).toMatch(/written by the mod only/)

  await $.tool.call({
    tool: 'mcp__orquestrador__plano',
    change: 'demo',
    finalGates: ['check'],
    waves: [{ phases: [{ id: '1', title: 'API', status: 'running' }] }],
  } as never)
  const merge = { tool: 'Bash', command: 'gh pr merge 12 --squash' }
  expect(((await $.tool.call(merge as never)) as { deny?: string }).deny).toMatch(/final gates of demo not passed: check \(pending\)/)
  await $.tool.call({ tool: 'Bash', command: 'sh scripts/check.sh' } as never)
  expect(((await $.tool.call(merge as never)) as { deny?: string }).deny).toBeUndefined()
})

test('the panel shows each gate, and only the owner skips one, with two presses', async ($, on) => {
  const w = world(on, [child('api')])
  await plan($, 'running')
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /não rodou/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Sessões trabalhando agora/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 de no máximo 3/ })).toBeDefined()

  await ui.press({ key: 'arm:1:testes' })
  expect(w.disk.has('/h/.claude/orquestrador/gates/demo.json')).toBe(false)
  await ui.press({ key: 'skip:1:testes' })
  for (let i = 0; i < 20 && !w.disk.has('/h/.claude/orquestrador/gates/demo.json'); i++) await Promise.resolve()
  expect(JSON.parse(w.disk.get('/h/.claude/orquestrador/gates/demo.json') ?? '{}').skips['1:testes']).toBeDefined()
  expect(w.disk.get('/h/.claude/orquestrador/gates/demo.ndjson')).toMatch(/"kind":"skipped","key":"1:testes".*"by":"owner"/)
  expect((await plan($, 'done')).isError).toBeUndefined()
  await ui.unmount()
})

test('an app restart keeps what the session proved: the task list and the gate passes come back', async ($, on) => {
  const w = world(on, [])
  w.disk.set(
    '/h/.claude/orquestrador/sessions/w.json',
    JSON.stringify({
      cwd: '/w',
      plan: [{ content: 'Conferir o painel', status: 'in_progress' }],
      updatedAt: 60,
      gates: { testes: { gate: 'testes', result: 'passed', evidence: 'claude plugin test', at: 50 } },
      editedAt: 40,
    }),
  )
  await $.tool.call({
    tool: 'mcp__orquestrador__plano',
    change: 'demo',
    waves: [{ phases: [{ id: '1', title: 'Conferir', status: 'running', gates: ['testes'] }] }],
  } as never)

  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /passou/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Conferir o painel/ })).toBeDefined()
  await ui.unmount()
})

test('a shell may read the gate files but never write them', async ($, on) => {
  world(on, [])
  const bash = async (command: string) => ((await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }).deny
  expect(await bash('ls -la ~/.claude/orquestrador/sessions/ | tail -8')).toBeUndefined()
  expect(await bash('cat ~/.claude/orquestrador/gates/demo.json 2>/dev/null | jq .skips')).toBeUndefined()
  expect(await bash('echo {} > ~/.claude/orquestrador/gates/demo.json')).toMatch(/written by the mod only/)
  expect(await bash('rm -rf ~/.claude/orquestrador/gates')).toMatch(/written by the mod only/)
  expect(await bash('find ~/.claude/orquestrador -name "*.json" -delete')).toMatch(/written by the mod only/)
  expect(await bash(`python3 -c "open('/h/.claude/orquestrador/gates/x', 'w')"`)).toMatch(/written by the mod only/)
})
