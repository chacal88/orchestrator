import { describe, expect, test } from 'claude-code/testing'

import type { OrchestrationRun, SessionRow } from '../types'
import { childStops, eligibleChildren, sessionTitle, stopPrompt } from '../hooks/wake'

const row = (sessionId: string, extra: Partial<SessionRow> = {}): SessionRow => ({
  sessionId, title: `Fase ${sessionId}`, cwd: `/w/wt/${sessionId}`, branch: undefined, isRunning: false, isArchived: false,
  prNumber: undefined, prState: undefined, lastActivityAt: undefined, name: undefined, startedBy: 'local_co', link: undefined,
  groupId: undefined, groupName: undefined, ...extra,
})

const run: OrchestrationRun = {
  change: 'b', changePath: undefined, coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
  waves: [{
    title: undefined, summary: undefined, jira: undefined,
    phases: [{ id: '1', title: 'Fase', status: 'running', icon: undefined, tasks: '1.x', session: 'local_plan', dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates: undefined }],
  }],
  ownerQuestions: [], finalGates: undefined, updatedAt: 1,
}

describe('which children wake the coordination', () => {
  test('its own unarchived children and the plan phases count; archived, foreign and itself do not', () => {
    const rows = [
      row('local_a'),
      row('local_old', { isArchived: true }),
      row('local_hand', { startedBy: undefined }),
      row('local_plan', { startedBy: undefined }),
      row('local_co', { startedBy: undefined }),
      row('local_other', { startedBy: 'local_xx' }),
    ]
    expect(eligibleChildren(run, 'local_co', rows).map(r => r.sessionId)).toEqual(['local_a', 'local_plan'])
    expect(eligibleChildren(undefined, 'local_co', rows).map(r => r.sessionId)).toEqual(['local_a'])
  })
})

describe('when a child ended its turn', () => {
  test('the first look only records; running then stopped is one stop', () => {
    const first = childStops({}, [row('local_a', { isRunning: true, lastActivityAt: 't1' })], 100)
    expect(first.stopped).toEqual([])
    expect(first.seen).toEqual({ local_a: { running: true, activity: 't1' } })

    const second = childStops(first.seen, [row('local_a', { lastActivityAt: 't2' })], 200)
    expect(second.stopped.map(r => r.sessionId)).toEqual(['local_a'])
    expect(second.seen.local_a).toEqual({ running: false, activity: 't2', told: 't2' })
  })

  test('a child already stopped when first seen is not told: turning the option on tells no old stop', () => {
    const first = childStops({}, [row('local_a', { lastActivityAt: 't1' })], 100)
    expect(first.stopped).toEqual([])
    expect(childStops(first.seen, [row('local_a', { lastActivityAt: 't1' })], 200).stopped).toEqual([])
  })

  test('a short turn between two looks is a stop, by the last activity that moved', () => {
    const first = childStops({}, [row('local_a', { lastActivityAt: 't1' })], 100)
    expect(childStops(first.seen, [row('local_a', { lastActivityAt: 't5' })], 200).stopped.map(r => r.sessionId)).toEqual(['local_a'])
  })

  test('the same stop seen twice is told once, with or without a last activity', () => {
    let seen = childStops({}, [row('local_a', { isRunning: true, lastActivityAt: 't1' })], 100).seen
    const told = childStops(seen, [row('local_a', { lastActivityAt: 't2' })], 200)
    expect(told.stopped).toHaveLength(1)
    expect(childStops(told.seen, [row('local_a', { lastActivityAt: 't2' })], 300).stopped).toEqual([])

    seen = childStops({}, [row('local_b', { isRunning: true })], 100).seen
    const bare = childStops(seen, [row('local_b')], 200)
    expect(bare.stopped).toHaveLength(1)
    expect(childStops(bare.seen, [row('local_b')], 300).stopped).toEqual([])
  })

  test('a child still running is no stop, and one that left the list is forgotten', () => {
    const first = childStops({}, [row('local_a', { isRunning: true, lastActivityAt: 't1' }), row('local_b')], 100)
    const second = childStops(first.seen, [row('local_a', { isRunning: true, lastActivityAt: 't2' })], 200)
    expect(second.stopped).toEqual([])
    expect(Object.keys(second.seen)).toEqual(['local_a'])
  })
})

describe('what the coordination reads', () => {
  test('one session, and several together', () => {
    expect(stopPrompt(['Fase 1'])).toBe('Painel: a sessão "Fase 1" terminou o turno. Siga o flow.')
    expect(stopPrompt(['Fase 1', 'Fase 2'])).toBe('Painel: as sessões "Fase 1", "Fase 2" terminaram o turno. Siga o flow.')
    // the plan B, should the app refuse user_asked after the panel's prompt
    expect(stopPrompt(['Fase 1'], true)).toBe('Painel (opção "Seguir o flow sem clique" ligada por mim): a sessão "Fase 1" terminou o turno. Siga o flow.')
  })

  test('the title is the session name when it has one', () => {
    expect(sessionTitle(row('local_a', { name: 'ac-fase-1' }))).toBe('ac-fase-1')
    expect(sessionTitle(row('local_a'))).toBe('Fase local_a')
  })
})
