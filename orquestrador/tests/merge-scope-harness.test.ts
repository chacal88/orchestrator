import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { ActivityRecord, FlowState, OrchestrationRun } from '../types'
import { startFlow } from '../hooks/flow'
import { defaultFlows } from '../hooks/flows/index'
import { sessionActivityKey } from '../hooks/model'

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean; deny?: string }

const BASE = '/h/.claude/orquestrador'
const ME = { sessionId: 'me', cwd: '/w', title: 'Coordenação' }

type World = {
  disk: Map<string, string>
  rows: object[]
  self: object
  /** The head branch `gh pr view <n>` answers, by PR number; a missing one fails like gh offline. */
  heads: Record<string, string>
  /** What `git branch --show-current` answers in the checkout. */
  branch: string
  /** Files a Bash command reports it changed, by a word of the command. */
  edits: Record<string, string[]>
}

/** A coordinator at /w, an in-memory disk, gh and git answering from the world. */
const world = (on: On): World => {
  mock.store(on)
  const w: World = { disk: new Map(), rows: [ME], self: ME, heads: {}, branch: 'main', edits: {} }
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
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: now, isLink: false })) as never,
  }))
  on('process.run', ($, e) => {
    const argv = e.argv
    if (argv[0] === 'git' && argv.includes('branch')) return { value: { exitCode: 0, stdout: `${w.branch}\n`, stderr: '' } as never }
    if (argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'view') {
      const head = w.heads[String(argv[3])]
      return { value: (head === undefined ? { exitCode: 1, stdout: '', stderr: 'offline' } : { exitCode: 0, stdout: `${head}\n`, stderr: '' }) as never }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } as never }
  })
  on('tool.list', () => ({
    value: [{ name: 'mcp__ccd_session_mgmt__list_sessions' }, { name: 'mcp__ccd_session_mgmt__get_session' }] as never,
  }))
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    if (input.tool === 'mcp__ccd_session_mgmt__get_session') return answer(JSON.stringify(w.self))
    if (input.tool === 'mcp__ccd_session_mgmt__list_sessions') return answer(JSON.stringify(w.rows))
    if (input.tool === 'Bash') {
      const command = String(input.command)
      const files = Object.entries(w.edits).find(([word]) => command.includes(word))?.[1] ?? []
      return { result: { stdout: 'ok', stderr: '', interrupted: false, bashEditDiff: { files: files.map(filePath => ({ filePath })) } }, text: 'ok' } as never
    }
    return answer('ok')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

const run = (extra: Partial<OrchestrationRun> = {}): OrchestrationRun => ({
  change: 'demo', changePath: 'openspec/changes/demo', coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
  waves: [{
    title: undefined, summary: undefined, jira: undefined,
    phases: [{ id: 'A', title: 'Base', status: 'running', icon: undefined, tasks: '1.x', session: 'fase-a', dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates: undefined }],
  }],
  ownerQuestions: [], finalGates: ['check', 'openspec'], updatedAt: 1, ...extra,
})

/** The change's flow parked at `current`, with the PR step's note citing #801. */
const flowAt = (w: World, current: string, status: FlowState['status'] = 'running', flowId = 'rapido') => {
  const def = defaultFlows().find(f => f.id === flowId)!
  const { state } = startFlow(def, { change: 'demo', coordinatorCwd: '/w', changePath: 'openspec/changes/demo', visual: false }, 1)
  const parked: FlowState = { ...state, current, status, records: { pr: { outcome: 'aberto', by: 'session', at: 5, note: 'PR aberto #801' } } }
  w.disk.set(`${BASE}/flows/demo.json`, JSON.stringify(parked))
}

const setup = (w: World, extra: Partial<OrchestrationRun> = {}) => w.disk.set(`${BASE}/runs/demo.json`, JSON.stringify(run(extra)))
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<Reply>
const merge = async ($: Engine, command: string) => (await bash($, command)).deny
const passFinalGates = async ($: Engine) => {
  await bash($, 'sh scripts/check.sh')
  await bash($, 'openspec validate demo --strict')
}

test('a merge after the flow finished passes, for the change PR and any other', async ($, on) => {
  const w = world(on)
  setup(w)
  w.heads = { '801': 'claude/demo-pr', '805': 'claude/product-feed-purpose' }
  flowAt(w, 'qa')
  expect(await merge($, 'gh pr merge 801 --squash')).toMatch(/final gates of demo not passed: check \(pending\), openspec \(pending\)/)

  flowAt(w, 'arquivar', 'done')
  expect(await merge($, 'gh pr merge 801 --squash')).toBeUndefined()
  expect(await merge($, 'gh pr merge 805 --squash')).toBeUndefined()
  flowAt(w, 'qa', 'aborted')
  expect(await merge($, 'gh pr merge 801 --squash')).toBeUndefined()
})

test('a merge of an unrelated PR passes while the flow runs, in the coordinator and in a session it started', async ($, on) => {
  const w = world(on)
  setup(w)
  flowAt(w, 'qa')
  w.heads = { '805': 'claude/product-feed-purpose' }
  expect(await merge($, 'gh pr merge 805 --squash --delete-branch')).toBeUndefined()
  expect(await merge($, 'gh pr merge claude/product-feed-purpose --squash')).toBeUndefined()

  // a session the coordinator started, sharing its folder, reads the same plan and flow
  const side = { sessionId: 'side', cwd: '/w', title: 'Doc do feed', name: 'product-feed-purpose', startedBy: 'me' }
  w.self = side
  w.rows = [ME, side]
  w.branch = 'claude/product-feed-purpose'
  expect(await merge($, 'gh pr merge --squash')).toBeUndefined()
})

test("the change's own merge is still gated while its gates are pending, matched by plan, bound PR or branch", async ($, on) => {
  const w = world(on)
  setup(w, { ownerQuestions: [{ question: 'Mergear?', recommendation: undefined, session: undefined, pr: 803 }] })
  flowAt(w, 'qa')
  w.rows = [ME, { sessionId: 'a', cwd: '/w/wt/a', title: 'Fase A', name: 'fase-a', startedBy: 'me', branch: 'feat/base', prNumber: 802, prState: 'OPEN' }]
  w.heads = { '804': 'feat/base', '806': 'claude/demo-archive-fix' }

  const pending = /final gates of demo not passed: check \(pending\), openspec \(pending\)/
  expect(await merge($, 'gh pr merge 801 --squash')).toMatch(pending) // cited by the flow's PR step
  expect(await merge($, 'gh pr merge 802 --squash')).toMatch(pending) // bound to the phase session
  expect(await merge($, 'gh pr merge 803 --squash')).toMatch(pending) // named by the plan
  expect(await merge($, 'gh pr merge 804 --squash')).toMatch(pending) // the phase session's branch
  expect(await merge($, 'gh pr merge 806 --squash')).toMatch(pending) // the change id in the branch
  expect(await merge($, 'gh pr merge 999 --squash')).toMatch(pending) // gh cannot tell the head: fails closed
  w.branch = 'feat/demo-checkout'
  expect(await merge($, 'gh pr merge --squash')).toMatch(pending) // the checkout's own branch

  await passFinalGates($)
  expect(await merge($, 'gh pr merge 801 --squash')).toBeUndefined()
})

test('the archive PR is not blocked on stale gates after a successful archive', async ($, on) => {
  const w = world(on)
  setup(w)
  flowAt(w, 'arquivar')
  w.heads = { '810': 'claude/demo-archive' }
  w.edits = {
    'openspec archive': [
      '/w/openspec/changes/archive/2026-10-22-demo/.openspec.yaml',
      '/w/openspec/changes/archive/2026-10-22-demo/tasks.md',
      '/w/openspec/specs/demo/spec.md',
    ],
  }
  await passFinalGates($)
  await bash($, 'openspec archive demo -y')
  expect(JSON.parse(w.disk.get(`${BASE}/flows/demo.json`) ?? '{}').status).toBe('done')
  expect(await merge($, 'gh pr merge 810 --squash')).toBeUndefined()
})

test('without a flow, the archive does not make the final gates stale', async ($, on) => {
  const w = world(on)
  setup(w)
  w.heads = { '810': 'claude/demo-archive' }
  w.edits = {
    'openspec archive': ['/w/openspec/changes/archive/2026-10-22-demo/.openspec.yaml', '/w/openspec/specs/demo/spec.md'],
    'apply-fix': ['/w/src/checkout.ts'],
  }
  await passFinalGates($)
  await bash($, 'openspec archive demo -y')
  expect(await merge($, 'gh pr merge 810 --squash')).toBeUndefined()
  // a code edit still makes them stale for the change's PR
  await bash($, 'node apply-fix.js')
  expect(await merge($, 'gh pr merge 810 --squash')).toMatch(/check \(stale\), openspec \(stale\)/)
})

test('the ceiling ignores finished sessions and names why each counted one counts', async ($, on) => {
  const w = world(on)
  setup(w)
  const kid = (name: string, extra: Record<string, unknown> = {}) => ({
    sessionId: name, cwd: `/w/wt/${name}`, title: name, name, startedBy: 'me', isArchived: false, ...extra,
  })
  const activity = (name: string, record: Partial<ActivityRecord>) =>
    w.disk.set(
      `${BASE}/sessions/${sessionActivityKey(name)}.json`,
      JSON.stringify({ sessionId: name, cwd: `/w/wt/${name}`, plan: [], lastTool: undefined, waiting: undefined, updatedAt: 1, ...record }),
    )
  const start = async () =>
    ((await $.tool.call({ tool: 'mcp__ccd_session__start_session', initiation: 'user_asked', title: 'x', prompt: 'p' } as never)) as Reply).deny

  w.rows = [
    ME,
    kid('orq-pr', { prNumber: 3, prState: 'MERGED', isRunning: true }),
    kid('catalogo', { prNumber: 7, prState: 'CLOSED', isRunning: true }),
    kid('doc-feed', { prNumber: 805, prState: 'merged', isRunning: true }),
    kid('ociosa'),
    kid('fase-a', { isRunning: true }),
    kid('feita'),
  ]
  // each of these would count before 0.7.7: six unarchived sessions, four of them running
  activity('feita', { plan: [{ content: 'Abrir o PR', status: 'completed' }] })
  flowAt(w, 'arquivar', 'done') // fase-a's change finished: it no longer counts even while running
  expect(await start()).toBeUndefined()

  flowAt(w, 'qa')
  w.rows = [
    ME,
    kid('fase-a', { isRunning: true }),
    kid('perguntando'),
    kid('pendente'),
    kid('orq-pr', { prNumber: 3, prState: 'MERGED' }),
  ]
  activity('perguntando', { waiting: { kind: 'question', text: 'Qual?', since: 1 } })
  activity('pendente', { plan: [{ content: 'Rodar testes', status: 'in_progress' }, { content: 'PR', status: 'pending' }] })
  expect(await start()).toMatch(
    /3 phase sessions are alive: fase-a \(running now\), perguntando \(waiting on the owner \(question\)\), pendente \(2 open tasks in its list\); the ceiling is 3/,
  )
})
