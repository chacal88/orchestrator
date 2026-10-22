import { describe, expect, test } from 'claude-code/testing'

import {
  activityKey,
  findGroupId,
  groupName,
  latestActivity,
  applyPlanUpdate,
  completePlan,
  parseRun,
  parseSessionRows,
  phaseCounts,
  phaseViews,
  planProgress,
  toCard,
  withFlowStatus,
} from '../hooks/model'

const items = [
  { content: 'A', status: 'in_progress' },
  { content: 'B', status: 'pending' },
  { content: 'C', status: 'pending' },
] as const

describe('applyPlanUpdate', () => {
  test('a whole list replaces the plan and drops empty items', () => {
    const plan = applyPlanUpdate([], { items: [...items, { content: '', status: 'pending' }] })
    expect(plan.map(i => i.content)).toEqual(['A', 'B', 'C'])
  })

  test('advance completes the current step and starts the next pending one', () => {
    const plan = applyPlanUpdate(applyPlanUpdate([], { items: [...items] }), { advance: true })
    expect(plan.map(i => i.status)).toEqual(['completed', 'in_progress', 'pending'])
  })

  test('done and start are 1-based and ignore out-of-range numbers', () => {
    const plan = applyPlanUpdate(applyPlanUpdate([], { items: [...items] }), { done: [1, 9], start: 3 })
    expect(plan.map(i => i.status)).toEqual(['completed', 'pending', 'in_progress'])
  })

  test('wrap_up checks every step off', () => {
    expect(completePlan([...items]).every(i => i.status === 'completed')).toBe(true)
  })
})

test('planProgress counts done steps and names the current one', () => {
  expect(planProgress([...items])).toEqual({ done: 0, total: 3, current: 'A' })
  expect(planProgress([])).toEqual({ done: 0, total: 0, current: undefined })
})

test('activityKey is filesystem-safe and stable per cwd', () => {
  expect(activityKey('/Users/x/repo/.claude/worktrees/a-1')).toBe('Users-x-repo-claude-worktrees-a-1')
})

describe('parseSessionRows', () => {
  test('reads a list and a single object, skipping malformed rows', () => {
    const list = JSON.stringify([
      { sessionId: 'local_1', title: '🛠 x: api', cwd: '/w/1', isRunning: true, prNumber: 7, group: { id: 'g', name: 'G' } },
      { title: 'no id' },
    ])
    const rows = parseSessionRows(list)
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ sessionId: 'local_1', isRunning: true, prNumber: 7, groupId: 'g' })
    expect(parseSessionRows(JSON.stringify({ sessionId: 's', cwd: '/w' })).length).toBe(1)
  })

  test('answers nothing for empty or non-JSON text', () => {
    expect(parseSessionRows(undefined)).toEqual([])
    expect(parseSessionRows('Error: no window')).toEqual([])
  })
})

describe('parseRun', () => {
  const input = {
    change: 'chatgpt-ads',
    waves: [
      { title: 'base', phases: [{ id: '1.x', title: 'API', status: 'done', session: 'ads-api' }] },
      { phases: [{ id: '2.x', title: 'Store', status: 'bogus', dependsOn: ['1.x', 3] }] },
    ],
    ownerQuestions: ['Ligar a flag?', ''],
  }

  test('keeps valid fields and defaults an unknown status to pending', () => {
    const run = parseRun(input, '/w/coord', 1)
    if ('error' in run) throw new Error(run.error)
    expect(run.waves[1]?.phases[0]).toMatchObject({ status: 'pending', dependsOn: ['1.x'] })
    expect(run.ownerQuestions.map(q => q.question)).toEqual(['Ligar a flag?'])
    expect(phaseCounts(run)).toEqual({ pending: 1, running: 0, blocked: 0, done: 1 })
  })

  test('refuses a plan without change, waves or phase ids', () => {
    expect(parseRun({ waves: [] }, '/w', 1)).toEqual({ error: '`change` is required.' })
    expect(parseRun({ change: 'x', waves: [] }, '/w', 1)).toEqual({ error: '`waves` needs at least one wave.' })
    expect('error' in parseRun({ change: 'x', waves: [{ phases: [{ title: 'no id' }] }] }, '/w', 1)).toBe(true)
  })

  test('joins each phase to its session by name, id or title', () => {
    const run = parseRun(input, '/w/coord', 1)
    if ('error' in run) throw new Error(run.error)
    const [row] = parseSessionRows(JSON.stringify([{ sessionId: 'local_9', title: 'API', cwd: '/w/9', name: 'ads-api' }]))
    const views = phaseViews(run, [toCard(row!, undefined)])
    expect(views[0]?.[0]?.card?.sessionId).toBe('local_9')
    expect(views[1]?.[0]?.card).toBeUndefined()
  })

  test("the panel's plan follows the flow: a closed phase is done, a finished flow all done, an ended one none in flight", () => {
    const run = parseRun({ ...input, waves: [{ phases: [{ id: 'A', title: 'A', status: 'running' }, { id: 'B', title: 'B', status: 'blocked' }] }] }, '/w', 1)
    if ('error' in run) throw new Error(run.error)
    const closed = { A: { at: 2 } } as never
    expect(phaseCounts(withFlowStatus(run, { change: 'chatgpt-ads', status: 'running', closed }))).toMatchObject({ done: 1, blocked: 1 })
    expect(phaseCounts(withFlowStatus(run, { change: 'chatgpt-ads', status: 'done', closed: undefined }))).toMatchObject({ done: 2 })
    expect(phaseCounts(withFlowStatus(run, { change: 'chatgpt-ads', status: 'aborted', closed }))).toMatchObject({ done: 1, pending: 1 })
    expect(withFlowStatus(run, { change: 'other', status: 'done', closed: undefined })).toBe(run)
  })
})

describe('findGroupId', () => {
  test('finds a group by name in list_groups', () => {
    const text = JSON.stringify([{ id: 'cg-1', name: '🪪 a' }, { id: 'cg-2', name: '🪪 b' }])
    expect(findGroupId(text, '🪪 b')).toBe('cg-2')
    expect(findGroupId(text, '🪪 c')).toBeUndefined()
  })

  test("reads create_group's id from JSON or from plain text", () => {
    expect(findGroupId(JSON.stringify({ id: 'cg-9' }))).toBe('cg-9')
    expect(findGroupId('Created group cg-abc-123')).toBe('cg-abc-123')
    expect(findGroupId(undefined)).toBeUndefined()
  })

  test('groupName marks the change with its badge', () => {
    expect(groupName('chatgpt-ads')).toBe('🪪 chatgpt-ads')
  })
})

test('latestActivity takes the freshest record from the folder or beneath it', () => {
  const record = (cwd: string, updatedAt: number) => ({ cwd, plan: [], lastTool: undefined, waiting: undefined, updatedAt })
  const records = [record('/w/a', 1), record('/w/a/openspec', 5), record('/w/ab', 9)]
  expect(latestActivity(records, '/w/a')?.updatedAt).toBe(5)
  expect(latestActivity(records, '/w/z')).toBeUndefined()
})
