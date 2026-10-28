import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { OrchestrationRun } from '../types'
import { startFlow } from '../hooks/flow'
import { defaultFlows } from '../hooks/flows/index'
import { HOOK_COMMAND, HOOK_MARK, LEGACY_HOOK_MARK, activate, deactivate, parseSettings, readActivation, readAutowake, writeActivation, writeAutowake } from '../hooks/activation'

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }

const BASE = `/h/.claude/${'orquestrador'}`
const MARK = '/w/.claude/settings.local.json'
const ME = { sessionId: 'me', cwd: '/w', title: 'Coordenação' }

type World = {
  disk: Map<string, string>
  toasts: string[]
  /** What `git rev-parse --git-common-dir` answers; absent, git fails like outside a repository. */
  common: string | undefined
  /** What `git check-ignore` exits with. */
  ignored: boolean
  root: string
  /** The clock, in ms: a test moves it to let time pass. */
  now: number
  /** Directories `fs.list` was asked for. */
  lists: string[]
  /** A directory whose listing fails. */
  failList: string | undefined
  /** Files whose read / write fails. */
  failRead: Set<string>
  failWrite: Set<string>
  /** Writes made to files, by path. */
  writes: string[]
  /** What `git check-ignore` exits with when it is not `ignored`. */
  notIgnoredCode: number
  /** The sessions `list_sessions` answers. */
  family: unknown[]
  opened: number
  /** The mod's state, for the functions called straight with `engineOf`. */
  kept: Map<string, unknown>
}

const listing = (w: World, dir: string) => ({
  value: [...w.disk.keys()]
    .filter(k => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
    .map(k => ({ name: k.slice(dir.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
})

/** A coordinator at /w with an in-memory disk; git answers from the world. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), toasts: [], common: undefined, ignored: true, root: '/w', now: 1_000, lists: [], failList: undefined, failRead: new Set(), failWrite: new Set(), writes: [], notIgnoredCode: 1, family: [ME], opened: 0, kept: new Map() }
  // the mod's state, held by the world so the hooks and the functions called straight see the same one
  let version = 0
  on('state.get', (_$, e) => ({ value: { value: w.kept.get((e as { key: string }).key), version } }) as never)
  on('state.set', (_$, e) => {
    const { key, value } = e as unknown as { key: string; value: unknown }
    w.kept.set(key, value)
    version += 1
    return { value: { isSet: true, version } } as never
  })
  on('env.get', () => ({ value: '/h' }))
  on('clock.now', () => ({ value: (w.now += 10) }))
  on('session.root', () => ({ value: w.root }))
  on('session.repo', () => ({ value: null }))
  on('fs.exists', ($, e) => ({ value: w.disk.has(e.path) || [...w.disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.read', ($, e) => {
    if (w.failRead.has(e.path)) throw new Error('EIO')
    return { value: w.disk.get(e.path) ?? '' }
  })
  on('fs.write', ($, e) => {
    if (w.failWrite.has(e.path)) throw new Error('EROFS')
    w.writes.push(e.path)
    w.disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    w.lists.push(e.path)
    if (w.failList === e.path) throw new Error('EIO')
    return listing(w, e.path)
  })
  on('process.run', ($, e) => {
    const argv = e.argv
    if (argv.includes('--git-common-dir')) {
      return { value: (w.common === undefined ? { exitCode: 128, stdout: '', stderr: 'not a repo' } : { exitCode: 0, stdout: `${w.common}\n`, stderr: '' }) as never }
    }
    if (argv.includes('check-ignore')) return { value: { exitCode: w.ignored ? 0 : w.notIgnoredCode, stdout: '', stderr: '' } as never }
    if (argv[0] === 'gh') return { value: { exitCode: 0, stdout: 'claude/other\n', stderr: '' } as never }
    return { value: { exitCode: 0, stdout: 'main\n', stderr: '' } as never }
  })
  on('tool.check', ($, e) => ({ decision: e.tool === 'Bash' ? 'ask' : 'allow' }) as never)
  on('tool.list', () => ({ value: [{ name: 'mcp__ccd_session_mgmt__list_sessions' }, { name: 'mcp__ccd_session_mgmt__get_session' }] as never }))
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === 'mcp__ccd_session_mgmt__get_session') return { result: JSON.stringify(ME), text: JSON.stringify(ME) } as never
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return { result: JSON.stringify(w.family), text: JSON.stringify(w.family) } as never
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/w' }) as never)
  on('ui.open', () => {
    w.opened += 1
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined } as never
  })
  return w
}

/** The `$` of a hook, standing on the world: for calling the activation functions straight. */
const engineOf = (w: World): never =>
  ({
    session: { root: async () => w.root },
    env: { get: async () => '/h' },
    state: {
      get: async (k: { key: string }) => ({ value: w.kept.get(k.key) }),
      set: async (k: { key: string }, v: unknown) => void w.kept.set(k.key, v),
    },
    fs: {
      exists: async (p: string) => w.disk.has(p),
      read: async (p: string) => {
        if (w.failRead.has(p)) throw new Error('EIO')
        return w.disk.get(p) ?? ''
      },
      write: async (p: string, text: string) => {
        if (w.failWrite.has(p)) throw new Error('EROFS')
        w.writes.push(p)
        w.disk.set(p, text)
      },
    },
    process: {
      run: async (argv: string[]) =>
        argv.includes('--git-common-dir')
          ? w.common === undefined
            ? { exitCode: 128, stdout: '', stderr: '' }
            : { exitCode: 0, stdout: `${w.common}\n`, stderr: '' }
          : { exitCode: w.ignored ? 0 : w.notIgnoredCode, stdout: '', stderr: '' },
    },
  }) as never

const run: OrchestrationRun = {
  change: 'demo', changePath: 'openspec/changes/demo', coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
  waves: [], ownerQuestions: [], finalGates: ['check'], updatedAt: 1,
}
const withRun = (w: World) => w.disk.set(`${BASE}/runs/demo.json`, JSON.stringify(run))
const withFlow = (w: World, status: 'running' | 'done' = 'running') => {
  const def = defaultFlows().find(f => f.id === 'rapido')!
  const { state } = startFlow(def, { change: 'demo', coordinatorCwd: '/w', changePath: 'openspec/changes/demo', visual: false }, 1)
  w.disk.set(`${BASE}/flows/demo.json`, JSON.stringify({ ...state, status }))
  w.now += 60_000 // time passes: the mod's short memory of "is a flow running" has run out
}
const RECORDS = `${BASE}/activation.json`
const record = (w: World, level: 'barrar' | 'lembrar', root = w.root) => w.disk.set(RECORDS, JSON.stringify({ [root]: { level, at: 1 } }))
const mark = (w: World, level: string) => w.disk.set(MARK, JSON.stringify({ env: { ORQUESTRADOR: level } }))
/** The level as the panel wrote it: the file and the mod's record of it. */
const panelMark = (w: World, level: 'barrar' | 'lembrar') => {
  mark(w, level)
  record(w, level)
}
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Reply>
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const OTHER = { permissions: { allow: ['Bash(ls)'] }, env: { FOO: '1' }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } }

test('activating adds the mark and the hook and keeps everything else; deactivating takes back only those', () => {
  const on = activate(OTHER, 'lembrar')
  expect(on.permissions).toEqual(OTHER.permissions)
  expect(on.env).toEqual({ FOO: '1', ORQUESTRADOR: 'lembrar' })
  const groups = (on.hooks as { SessionStart: { hooks: { type: string; command: string }[] }[] }).SessionStart
  expect(groups).toHaveLength(2)
  expect(groups[0]).toEqual(OTHER.hooks.SessionStart[0])
  expect(groups[1]).toEqual({ hooks: [{ type: 'command', command: HOOK_COMMAND }] })
  expect(HOOK_COMMAND).toContain(HOOK_MARK)
  expect((on.hooks as { Stop: unknown }).Stop).toEqual(OTHER.hooks.Stop)

  // activating again swaps the level without a second hook
  const again = activate(on, 'barrar')
  expect((again.hooks as { SessionStart: unknown[] }).SessionStart).toHaveLength(2)
  expect((again.env as Record<string, string>).ORQUESTRADOR).toBe('barrar')

  expect(deactivate(again)).toEqual(OTHER)
  // what the mod put is all that was there: nothing empty is left behind
  expect(deactivate(activate({}, 'barrar'))).toEqual({})
  expect(deactivate(activate({ theme: 'dark' }, 'barrar'))).toEqual({ theme: 'dark' })
})

test('the file is read as an object; broken JSON and other shapes are named, an empty file is nothing', () => {
  expect(parseSettings(undefined)).toEqual({ data: {} })
  expect(parseSettings('  ')).toEqual({ data: {} })
  expect(parseSettings('{ nope')).toEqual({ error: 'notJson' })
  expect(parseSettings('[1]')).toEqual({ error: 'notObject' })
})

/** The SessionStart hook exactly as the 0.14.1 panel wrote it. */
const HOOK_0_14_1 =
  'printf \'%s\\n\' "Orquestrador ativo neste clone (nível: ${ORQUESTRADOR:-barrar}). Siga o flow da change em andamento; ' +
  'passos do dono, só o dono responde no painel (/orquestrador); sem merge --admin e sem pular portões." # orquestrador:ativar'

test('2.6 the hook cites /orchestrator:panel and reads the new level variable before the old one', () => {
  expect(HOOK_MARK).toBe('orchestrator:activate')
  expect(LEGACY_HOOK_MARK).toBe('orquestrador:ativar')
  expect(HOOK_COMMAND).toContain('${ORCHESTRATOR:-${ORQUESTRADOR:-barrar}}')
  expect(HOOK_COMMAND).toContain('/orchestrator:panel')
  expect(HOOK_COMMAND.endsWith(`# ${HOOK_MARK}`)).toBe(true)
})

test('2.6 the activation file written by 0.14.1 reads as active; "Desativar" takes its hook out, and reactivating leaves one hook', async ($, on) => {
  const w = world(on)
  const old = {
    ...OTHER,
    env: { ...OTHER.env, ORQUESTRADOR: 'barrar' },
    hooks: { ...OTHER.hooks, SessionStart: [...OTHER.hooks.SessionStart, { hooks: [{ type: 'command', command: HOOK_0_14_1 }] }] },
  }
  w.disk.set(MARK, JSON.stringify(old))
  expect(await readActivation(engineOf(w))).toEqual({ level: 'barrar', invalid: false, tampered: false })
  // reactivating swaps the old hook for the new, never two
  expect(deactivate(activate(old, 'barrar'))).toEqual(OTHER)
  const again = activate(old, 'barrar') as { hooks: { SessionStart: { hooks: { command: string }[] }[] } }
  const commands = again.hooks.SessionStart.flatMap(g => g.hooks.map(h => h.command))
  expect(commands.filter(c => c.includes(HOOK_MARK) || c.includes(LEGACY_HOOK_MARK))).toEqual([HOOK_COMMAND])
  // "Desativar": the old hook and the mark go, everything else stays
  expect(await writeActivation(engineOf(w), null)).toEqual({ ok: true })
  expect(JSON.parse(w.disk.get(MARK) ?? '')).toEqual(OTHER)
  expect((await readActivation(engineOf(w))).level).toBeUndefined()
})

test('writing the activation preserves the file, refuses a broken one, and a worktree writes the main checkout', async ($, on) => {
  const w = world(on)
  w.disk.set(MARK, JSON.stringify(OTHER))
  expect(await readActivation(engineOf(w))).toEqual({ level: undefined, invalid: false, tampered: false })
  expect(await writeActivation(engineOf(w), 'lembrar')).toEqual({ ok: true })
  expect(JSON.parse(w.disk.get(MARK) ?? '')).toMatchObject({ permissions: OTHER.permissions, env: { FOO: '1', ORQUESTRADOR: 'lembrar' } })
  expect((await readActivation(engineOf(w))).level).toBe('lembrar')
  expect(await writeActivation(engineOf(w), null)).toEqual({ ok: true })
  expect(JSON.parse(w.disk.get(MARK) ?? '')).toEqual(OTHER)

  const broken = '{ "env": '
  w.disk.set(MARK, broken)
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: false, error: 'notJson' })
  expect(w.disk.get(MARK)).toBe(broken)
  expect(await readActivation(engineOf(w))).toEqual({ level: undefined, invalid: true, tampered: false })
})

test('"Seguir o flow sem clique" is off when absent, on and off as written, and off when the record is broken', async ($, on) => {
  const w = world(on)
  const AUTOWAKE = `${BASE}/autowake.json`
  expect(await readAutowake(engineOf(w))).toBe(false)
  await writeAutowake(engineOf(w), true)
  expect(JSON.parse(w.disk.get(AUTOWAKE) ?? '')).toMatchObject({ '/w': { on: true } })
  expect(await readAutowake(engineOf(w))).toBe(true)
  // another repository's entry is its own
  w.disk.set(AUTOWAKE, JSON.stringify({ ...JSON.parse(w.disk.get(AUTOWAKE) ?? ''), '/other': { on: true, at: 1 } }))
  await writeAutowake(engineOf(w), false)
  expect(await readAutowake(engineOf(w))).toBe(false)
  expect(Object.keys(JSON.parse(w.disk.get(AUTOWAKE) ?? ''))).toEqual(['/other'])
  // a broken record is off, and the panel replaces it
  w.disk.set(AUTOWAKE, '{ "/w": ')
  expect(await readAutowake(engineOf(w))).toBe(false)
  w.disk.set(AUTOWAKE, JSON.stringify({ '/w': { on: 'yes' } }))
  expect(await readAutowake(engineOf(w))).toBe(false)
  w.disk.set(AUTOWAKE, '{ "/w": ')
  await writeAutowake(engineOf(w), true)
  expect(await readAutowake(engineOf(w))).toBe(true)
  // a worktree reads the main checkout's entry
  w.root = '/w/.claude/worktrees/x'
  w.common = '/w/.git'
  expect(await readAutowake(engineOf(w))).toBe(true)
})

test('a worktree activates the main checkout\'s file, the one Claude Code reads', async ($, on) => {
  const w = world(on)
  w.root = '/main/.claude/worktrees/x'
  w.common = '/main/.git'
  await writeActivation(engineOf(w), 'barrar')
  expect(JSON.parse(w.disk.get('/main/.claude/settings.local.json') ?? '').env).toEqual({ ORQUESTRADOR: 'barrar' })
  expect(w.disk.has('/main/.claude/worktrees/x/.claude/settings.local.json')).toBe(false)
  expect((await readActivation(engineOf(w))).level).toBe('barrar')
})

test('a file the mod creates is kept out of git in the clone\'s exclude, never in the .gitignore', async ($, on) => {
  const w = world(on)
  w.root = '/main'
  w.common = '/main/.git'
  w.ignored = false
  w.disk.set('/main/.git/info/exclude', '# comment')
  await writeActivation(engineOf(w), 'barrar')
  expect(w.disk.get('/main/.git/info/exclude')).toBe('# comment\n.claude/settings.local.json\n')
  expect(w.disk.has('/main/.gitignore')).toBe(false)
})

test('a file already ignored (Claude Code\'s own exclude) gets nothing added', async ($, on) => {
  const w = world(on)
  w.root = '/main'
  w.common = '/main/.git'
  await writeActivation(engineOf(w), 'barrar')
  expect(w.disk.has('/main/.git/info/exclude')).toBe(false)
})

test('a clone with no mark and no flow is quiet: no band, no merge refusal', async ($, on) => {
  const w = world(on)
  withRun(w)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...BAND })
  expect(await ui.find({ key: 'band:pane' })).toBeUndefined()
  await ui.unmount()
})

test('"barrar" refuses what leaves the flow; "lembrar" warns and lets it go', async ($, on) => {
  const w = world(on)
  withRun(w)
  mark(w, 'barrar')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)

  panelMark(w, 'lembrar')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  expect(w.toasts.join(' ')).toMatch(/--admin/)

  // any other word is no mark (the panel's record is gone with it)
  w.disk.delete(RECORDS)
  mark(w, 'talvez')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  expect(w.toasts).toHaveLength(1)
})

test('a flow still running keeps the mod working in a clone with no mark; a finished one does not', async ($, on) => {
  const w = world(on)
  withRun(w)
  withFlow(w)
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
  withFlow(w, 'done')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
})

const kid = (name: string) => ({
  sessionId: `local_${name}`, cwd: `/w/.claude/worktrees/${name}`, title: name, name, startedBy: ME.sessionId, isArchived: false, isRunning: true,
})
const START = { tool: 'mcp__ccd_session__start_session', initiation: 'user_asked', title: 'x', prompt: 'p' }
const tool = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<Reply>
const SETTINGS_DENY = /settings\.local\.json is the owner's/
const flowLog = (w: World) => w.disk.get(`${BASE}/flows/demo.ndjson`) ?? ''
const settle = () => new Promise(resolve => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(() => resolve(undefined), 30))

test('the band shows in a clone with only the mark: a published run, no flow', async ($, on) => {
  const w = world(on)
  withRun(w)
  mark(w, 'barrar')
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await settle()
  expect(w.disk.has(`${BASE}/flows/demo.json`)).toBe(false)
  const ui = await $.ui.mount({ plugin: 'orchestrator', surface: 'desktop', ...BAND })
  expect(await ui.find({ key: 'band:pane' })).toBeDefined()
  await ui.unmount()
})

test('without the mark a session start opens no panel; with it, it does', async ($, on) => {
  const w = world(on)
  withRun(w)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await settle()
  expect(w.opened).toBe(0)
  mark(w, 'barrar')
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  await settle()
  expect(w.opened).toBeGreaterThan(0)
})

test('an inactive clone does not track permission waits or prompts; an active one does', async ($, on) => {
  const w = world(on)
  withRun(w)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  const kept = w.kept
  const waiting = async () => ({ value: kept.get('waiting') })
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)
  expect((await waiting()).value ?? null).toBeNull()

  mark(w, 'barrar')
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)
  expect((await waiting()).value).toMatchObject({ kind: 'permission' })

  // the mark goes: a prompt no longer clears what an inactive mod never tracked
  w.disk.delete(MARK)
  await $.prompt.submit({ text: 'oi', wait: false } as never)
  expect((await waiting()).value).toMatchObject({ kind: 'permission' })
  mark(w, 'barrar')
  await $.prompt.submit({ text: 'oi', wait: false } as never)
  expect((await waiting()).value ?? null).toBeNull()
})

test('the hook text keeps its accents, written as they are and read back whole', () => {
  expect(HOOK_COMMAND).toContain('nível')
  expect(HOOK_COMMAND).toContain('portões')
  expect(HOOK_COMMAND).toContain('só o dono')
  const text = JSON.stringify(activate({}, 'barrar'), null, 2)
  expect(text).toContain('portões')
  expect(text).not.toMatch(/\\u00/)
  const hooks = (JSON.parse(text) as { hooks: { SessionStart: { hooks: { command: string }[] }[] } }).hooks
  expect(hooks.SessionStart[0]?.hooks[0]?.command).toBe(HOOK_COMMAND)
})

test('the model cannot write the activation file in any mode, with or without the mark', async ($, on) => {
  const w = world(on)
  withRun(w)
  const attempts: Record<string, unknown>[] = [
    { tool: 'Write', file_path: '/w/.claude/settings.local.json', content: '{"env":{"ORQUESTRADOR":"lembrar"}}' },
    { tool: 'Edit', file_path: '/w/.claude/settings.local.json', old_string: 'barrar', new_string: 'lembrar' },
    { tool: 'MultiEdit', file_path: '/main/.claude/settings.local.json', edits: [] },
    { tool: 'Bash', command: `sed -i 's/barrar/lembrar/' .claude/settings.local.json` },
    { tool: 'Bash', command: `echo '{"env":{"ORQUESTRADOR":"lembrar"}}' > /w/.claude/settings.local.json` },
    { tool: 'Bash', command: `cd /w && cat .claude/settings.local.json | tee .claude/settings.local.json` },
  ]
  // where the mod is active (a mark, even one the panel did not record); an inactive clone's file is free
  for (const mode of ['barrar', 'lembrar'] as const) {
    mark(w, mode)
    for (const attempt of attempts) expect((await tool($, attempt)).deny).toMatch(SETTINGS_DENY)
  }
  // reading it is fine, and the panel (not a tool call) still writes it
  expect((await bash($, 'cat .claude/settings.local.json')).deny).toBeUndefined()
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: true })
})

test('from a worktree the main checkout\'s activation file is protected too, by the absolute and the relative path', async ($, on) => {
  const w = world(on)
  w.root = '/main/.claude/worktrees/x'
  w.common = '/main/.git'
  w.disk.set('/main/.claude/settings.local.json', JSON.stringify({ env: { ORQUESTRADOR: 'barrar' } }))
  expect((await tool($, { tool: 'Write', file_path: '/main/.claude/settings.local.json', content: '{}' })).deny).toMatch(SETTINGS_DENY)
  expect((await tool($, { tool: 'Edit', file_path: '.claude/settings.local.json', old_string: 'a', new_string: 'b' })).deny).toMatch(SETTINGS_DENY)
  expect((await bash($, `echo '{}' > /main/.claude/settings.local.json`)).deny).toMatch(SETTINGS_DENY)
})

test('the gate records stay refused in "lembrar" as well', async ($, on) => {
  const w = world(on)
  mark(w, 'lembrar')
  expect((await tool($, { tool: 'Write', file_path: `${BASE}/gates/demo.json`, content: '{"skips":{}}' })).deny).toMatch(/written by the mod only/)
  expect((await bash($, `rm -rf ${BASE}`)).deny).toMatch(/written by the mod only/)
})

test('"lembrar" lets a merge through but leaves a line in the flow log and one in the panel', async ($, on) => {
  const w = world(on)
  withRun(w)
  withFlow(w)
  panelMark(w, 'lembrar')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  expect(w.toasts.join(' ')).toMatch(/--admin/)
  const refused = flowLog(w)
    .split('\n')
    .filter(l => l !== '')
    .map(l => JSON.parse(l) as { kind: string; note?: string })
    .filter(e => e.kind === 'refused')
  expect(refused).toHaveLength(1)
  expect(refused[0]?.note).toMatch(/^lembrar: Orchestrator gate: .*--admin/)

  const ui = await $.ui.mount({
    plugin: 'orchestrator', surface: 'desktop', component: 'Pane', requestId: 'orchestrator',
    props: { title: 'Orchestrator', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as never)
  expect(await ui.find({ text: /Em "lembrar", 1 recusa\(s\) viraram só aviso\..*--admin/ } as never)).toBeDefined()
  await ui.unmount()
})

test('"lembrar" lets a fourth phase session start, warning and leaving a line in the log', async ($, on) => {
  const w = world(on)
  withRun(w)
  withFlow(w)
  w.family = [ME, kid('a'), kid('b'), kid('c')]
  mark(w, 'barrar')
  expect((await tool($, START)).deny).toMatch(/the ceiling is 3/)
  panelMark(w, 'lembrar')
  expect((await tool($, START)).deny).toBeUndefined()
  expect(w.toasts.join(' ')).toMatch(/the ceiling is 3/)
  expect(flowLog(w)).toMatch(/lembrar: Orchestrator gate: .*the ceiling is 3/)
})

test('a clone with no mark does not scan the flows on every call, and a failed scan neither denies nor breaks', async ($, on) => {
  const w = world(on)
  withRun(w)
  withFlow(w)
  const scans = () => w.lists.filter(d => d === `${BASE}/flows`).length
  for (let i = 0; i < 5; i += 1) expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
  expect(scans()).toBe(1)

  // the mark needs no scan at all
  panelMark(w, 'lembrar')
  const before = scans()
  await tool($, { tool: 'Read', file_path: '/w/README.md' })
  expect(scans()).toBe(before)

  // the panel's level still counts when the flow directory cannot be listed
  w.failList = `${BASE}/flows`
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  // no mark, flow directory unreadable, a flow already known to run here: fails closed
  w.disk.delete(MARK)
  w.disk.delete(RECORDS)
  w.now += 60_000
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
  // nothing known to run: the failed scan leaves the clone quiet
  w.kept.set('running', { root: '/w', at: 0, running: false })
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
})

test('a "lembrar" mark written by hand, with a flow running, keeps refusing: only the panel\'s record lowers the guard', async ($, on) => {
  const w = world(on)
  withRun(w)
  withFlow(w)
  mark(w, 'lembrar') // nobody told the panel
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
  expect((await readActivation(engineOf(w))).tampered).toBe(true)

  // the panel's own write makes it count
  panelMark(w, 'lembrar')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  expect((await readActivation(engineOf(w))).tampered).toBe(false)

  // a record for another level than the mark: the mark is not what the panel wrote
  record(w, 'barrar')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
})

test('switching and deactivating through the panel keep the record in step; a mark that reappears by hand is "barrar"', async ($, on) => {
  const w = world(on)
  withRun(w)
  expect(await writeActivation(engineOf(w), 'lembrar')).toEqual({ ok: true })
  expect(await readActivation(engineOf(w))).toEqual({ level: 'lembrar', invalid: false, tampered: false })
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: true })
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
  expect(await writeActivation(engineOf(w), 'lembrar')).toEqual({ ok: true })

  expect(await writeActivation(engineOf(w), null)).toEqual({ ok: true })
  expect(await readActivation(engineOf(w))).toEqual({ level: undefined, invalid: false, tampered: false })
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  mark(w, 'lembrar') // written by hand after the panel took it back
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
  expect((await readActivation(engineOf(w))).tampered).toBe(true)
  // "barrar" with no record stands, and is no tampering
  mark(w, 'barrar')
  expect(await readActivation(engineOf(w))).toEqual({ level: 'barrar', invalid: false, tampered: false })
})

test('a mark taken away outside the panel after it activated is still "barrar" and warned', async ($, on) => {
  const w = world(on)
  withRun(w)
  expect(await writeActivation(engineOf(w), 'lembrar')).toEqual({ ok: true })
  w.disk.set(MARK, '{ broken')
  expect(await readActivation(engineOf(w))).toEqual({ level: 'barrar', invalid: true, tampered: true })
  w.disk.delete(MARK)
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
})

test('the settings file is free in an inactive clone and protected, in any letter case, in an active one', async ($, on) => {
  const w = world(on)
  withRun(w)
  const edit = { tool: 'Edit', file_path: '/w/.claude/settings.local.json', old_string: 'a', new_string: 'b' }
  expect((await tool($, edit)).deny).toBeUndefined()
  expect((await bash($, `echo '{}' > .claude/settings.local.json`)).deny).toBeUndefined()
  mark(w, 'barrar')
  expect((await tool($, edit)).deny).toMatch(SETTINGS_DENY)
  expect((await tool($, { ...edit, file_path: '/w/.CLAUDE/Settings.Local.JSON' })).deny).toMatch(SETTINGS_DENY)
  expect((await bash($, `echo '{}' > .claude/SETTINGS.local.json`)).deny).toMatch(SETTINGS_DENY)
  // a flow running makes the clone active too
  w.disk.delete(MARK)
  withFlow(w)
  expect((await tool($, edit)).deny).toMatch(SETTINGS_DENY)
})

test('an unreadable settings file fails closed', async ($, on) => {
  const w = world(on)
  withRun(w)
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  w.disk.set(MARK, '{}')
  w.failRead.add(MARK)
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
})

test('a read that fails is not an absent file: nothing is written over it', async ($, on) => {
  const w = world(on)
  w.disk.set(MARK, JSON.stringify(OTHER))
  w.failRead.add(MARK)
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: false, error: 'unreadable' })
  expect(await writeActivation(engineOf(w), null)).toEqual({ ok: false, error: 'unreadable' })
  expect(w.writes).toEqual([])
  expect(w.disk.get(MARK)).toBe(JSON.stringify(OTHER))
  expect((await readActivation(engineOf(w))).level).toBe('barrar') // fails closed
})

test('a SessionStart that is not a list is left alone, with the reason', async ($, on) => {
  const w = world(on)
  const odd = JSON.stringify({ hooks: { SessionStart: { hooks: [] } } })
  w.disk.set(MARK, odd)
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: false, error: 'badHooks' })
  expect(await writeActivation(engineOf(w), null)).toEqual({ ok: false, error: 'badHooks' })
  expect(w.disk.get(MARK)).toBe(odd)
})

test('only "not ignored" (exit 1) adds to the exclude; a failing git leaves it alone', async ($, on) => {
  const w = world(on)
  w.root = '/main'
  w.common = '/main/.git'
  w.ignored = false
  w.notIgnoredCode = 128
  await writeActivation(engineOf(w), 'barrar')
  expect(w.disk.has('/main/.git/info/exclude')).toBe(false)
  expect(w.disk.has('/main/.claude/settings.local.json')).toBe(true)
})

test('the exclude comes first: if it cannot be written, the settings are not created', async ($, on) => {
  const w = world(on)
  w.root = '/main'
  w.common = '/main/.git'
  w.ignored = false
  w.failWrite.add('/main/.git/info/exclude')
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: false, error: 'notIgnored' })
  expect(w.disk.has('/main/.claude/settings.local.json')).toBe(false)
  expect(w.writes).toEqual([])
})

test('nothing is rewritten when nothing changes, and a missing .claude/ is no obstacle', async ($, on) => {
  const w = world(on)
  const marks = () => w.writes.filter(p => p === MARK) // the panel's record file is written beside it
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: true })
  expect(marks()).toEqual([MARK])
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: true })
  expect(marks()).toEqual([MARK])
  expect(await writeActivation(engineOf(w), 'lembrar')).toEqual({ ok: true })
  expect(marks()).toEqual([MARK, MARK])
  // deactivating what is not there writes nothing
  w.disk.clear()
  expect(await writeActivation(engineOf(w), null)).toEqual({ ok: true })
  expect(marks()).toEqual([MARK, MARK])
})

test('the main panel warns of an activation changed outside it; switching level clears the "lembrar" count', async ($, on) => {
  const w = world(on)
  withRun(w)
  mark(w, 'lembrar') // by hand
  const open = () =>
    $.ui.mount({
      plugin: 'orchestrator', surface: 'desktop', component: 'Pane', requestId: 'orchestrator',
      props: { title: 'Orchestrator', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    } as never)
  let ui = await open()
  expect(await ui.find({ text: /A ativação foi mudada fora do painel/ } as never)).toBeDefined()
  await ui.unmount()

  w.kept.set('reminded', { count: 2, last: 'x' })
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: true })
  expect(w.kept.get('reminded')).toBeNull()
  ui = await open()
  expect(await ui.find({ text: /A ativação foi mudada fora do painel/ } as never)).toBeUndefined()
  await ui.unmount()
})

test('the panel\'s record is a file in the registry folder, one entry per repository root, and survives a restart', async ($, on) => {
  const w = world(on)
  withRun(w)
  expect(await writeActivation(engineOf(w), 'lembrar')).toEqual({ ok: true })
  expect(JSON.parse(w.disk.get(RECORDS) ?? '')).toEqual({ '/w': { level: 'lembrar', at: expect.any(Number) } })
  // a restart empties the session's state; the record on disk still backs the "lembrar"
  w.kept.clear()
  expect(await readActivation(engineOf(w))).toEqual({ level: 'lembrar', invalid: false, tampered: false })
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  // the mark erased after the restart: "barrar" with the warning
  w.disk.delete(MARK)
  expect(await readActivation(engineOf(w))).toEqual({ level: 'barrar', invalid: false, tampered: true })
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)
  // deactivating takes only this root's entry
  w.disk.set(RECORDS, JSON.stringify({ '/w': { level: 'lembrar', at: 1 }, '/other': { level: 'barrar', at: 1 } }))
  mark(w, 'lembrar')
  expect(await writeActivation(engineOf(w), null)).toEqual({ ok: true })
  expect(Object.keys(JSON.parse(w.disk.get(RECORDS) ?? ''))).toEqual(['/other'])
})
