import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { OrchestrationRun } from '../types'
import { startFlow } from '../hooks/flow'
import { defaultFlows } from '../hooks/flows/index'
import { HOOK_COMMAND, HOOK_MARK, activate, deactivate, parseSettings, readActivation, writeActivation } from '../hooks/activation'

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
}

/** A coordinator at /w with an in-memory disk; git answers from the world. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), toasts: [], common: undefined, ignored: true, root: '/w' }
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 10) }))
  on('session.root', () => ({ value: w.root }))
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
    const argv = e.argv
    if (argv.includes('--git-common-dir')) {
      return { value: (w.common === undefined ? { exitCode: 128, stdout: '', stderr: 'not a repo' } : { exitCode: 0, stdout: `${w.common}\n`, stderr: '' }) as never }
    }
    if (argv.includes('check-ignore')) return { value: { exitCode: w.ignored ? 0 : 1, stdout: '', stderr: '' } as never }
    if (argv[0] === 'gh') return { value: { exitCode: 0, stdout: 'claude/other\n', stderr: '' } as never }
    return { value: { exitCode: 0, stdout: 'main\n', stderr: '' } as never }
  })
  on('tool.list', () => ({ value: [{ name: 'mcp__ccd_session_mgmt__list_sessions' }, { name: 'mcp__ccd_session_mgmt__get_session' }] as never }))
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === 'mcp__ccd_session_mgmt__get_session') return { result: JSON.stringify(ME), text: JSON.stringify(ME) } as never
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return { result: JSON.stringify([ME]), text: JSON.stringify([ME]) } as never
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
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
    fs: {
      exists: async (p: string) => w.disk.has(p),
      read: async (p: string) => w.disk.get(p) ?? '',
      write: async (p: string, text: string) => void w.disk.set(p, text),
    },
    process: {
      run: async (argv: string[]) =>
        argv.includes('--git-common-dir')
          ? w.common === undefined
            ? { exitCode: 128, stdout: '', stderr: '' }
            : { exitCode: 0, stdout: `${w.common}\n`, stderr: '' }
          : { exitCode: w.ignored ? 0 : 1, stdout: '', stderr: '' },
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
}
const mark = (w: World, level: string) => w.disk.set(MARK, JSON.stringify({ env: { ORQUESTRADOR: level } }))
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

test('writing the activation preserves the file, refuses a broken one, and a worktree writes the main checkout', async ($, on) => {
  const w = world(on)
  w.disk.set(MARK, JSON.stringify(OTHER))
  expect(await readActivation(engineOf(w))).toEqual({ level: undefined, invalid: false })
  expect(await writeActivation(engineOf(w), 'lembrar')).toEqual({ ok: true })
  expect(JSON.parse(w.disk.get(MARK) ?? '')).toMatchObject({ permissions: OTHER.permissions, env: { FOO: '1', ORQUESTRADOR: 'lembrar' } })
  expect((await readActivation(engineOf(w))).level).toBe('lembrar')
  expect(await writeActivation(engineOf(w), null)).toEqual({ ok: true })
  expect(JSON.parse(w.disk.get(MARK) ?? '')).toEqual(OTHER)

  const broken = '{ "env": '
  w.disk.set(MARK, broken)
  expect(await writeActivation(engineOf(w), 'barrar')).toEqual({ ok: false, error: 'notJson' })
  expect(w.disk.get(MARK)).toBe(broken)
  expect(await readActivation(engineOf(w))).toEqual({ level: undefined, invalid: true })
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
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...BAND })
  expect(await ui.find({ key: 'band:pane' })).toBeUndefined()
  await ui.unmount()
})

test('"barrar" refuses what leaves the flow; "lembrar" warns and lets it go', async ($, on) => {
  const w = world(on)
  withRun(w)
  mark(w, 'barrar')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toMatch(/--admin/)

  mark(w, 'lembrar')
  expect((await bash($, 'gh pr merge 5 --squash --admin')).deny).toBeUndefined()
  expect(w.toasts.join(' ')).toMatch(/--admin/)

  // any other word is no mark
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

test('the band shows in an activated clone', async ($, on) => {
  const w = world(on)
  mark(w, 'barrar')
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  await $.tool.call({
    tool: 'mcp__orquestrador__plano',
    change: 'demo',
    changePath: 'openspec/changes/demo',
    waves: [{ phases: [{ id: '1', title: 'API', status: 'running', tasks: '1.1' }] }],
  } as never)
  await $.tool.call({ tool: 'mcp__orquestrador__flow', action: 'start', change: 'demo', flow: 'completo' } as never)
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...BAND })
  expect(await ui.find({ key: 'band:pane' })).toBeDefined()
  await ui.unmount()
})
