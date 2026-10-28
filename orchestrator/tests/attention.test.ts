import { describe, expect, test } from 'claude-code/testing'

import type { PanelView, SessionCard } from '../types'
import { attentionItems, nowAndNext, parseRun, parseSessionRows, prUrl, repoWebUrl, toCard } from '../hooks/model'

const card = (over: Record<string, unknown>, waiting?: SessionCard['waiting']): SessionCard => {
  const [row] = parseSessionRows(JSON.stringify([{ cwd: '/w/x', ...over }]))
  return { ...toCard(row!, undefined), waiting }
}

describe('repoWebUrl', () => {
  test('reads both git spellings of a GitHub remote', () => {
    expect(repoWebUrl('git@github.com:chacal88/repo.git')).toBe('https://github.com/chacal88/repo')
    expect(repoWebUrl('https://github.com/chacal88/repo')).toBe('https://github.com/chacal88/repo')
  })

  test('answers nothing for other hosts or no remote', () => {
    expect(repoWebUrl('git@gitlab.com:a/b.git')).toBeUndefined()
    expect(repoWebUrl(null)).toBeUndefined()
    expect(prUrl(undefined, 3)).toBeUndefined()
  })
})

describe('attentionItems', () => {
  const run = parseRun(
    {
      change: 'c',
      waves: [{ phases: [{ id: '1', title: 'A', status: 'done' }] }],
      ownerQuestions: [
        { question: 'Ligar a flag?', recommendation: 'sim', session: 'ads-api', pr: 12 },
        'Pergunta antiga em texto',
      ],
    },
    '/w/coord',
    1,
  )
  if ('error' in run) throw new Error(run.error)
  const api = card({ sessionId: 'local_a', title: '🛠 api', name: 'ads-api', prNumber: 12, prState: 'OPEN' })
  const waitingCard = card(
    { sessionId: 'local_b', title: '🧪 testes' },
    { kind: 'permission', text: 'Bash', since: 1 },
  )
  const view: PanelView = {
    self: card({ sessionId: 'local_self', title: 'coord' }),
    children: [api, waitingCard],
    run,
    updatedAt: 1,
    warning: undefined,
    repoUrl: 'https://github.com/o/r',
    openspec: undefined,
    jira: {},
    jiraNote: undefined,
    skips: {},
  }

  test('orders decisions, then waiting sessions, then open PRs', () => {
    expect(attentionItems(view).map(a => a.kind)).toEqual(['decision', 'decision', 'permission', 'pr'])
  })

  test('a decision links its session and PR', () => {
    const [first] = attentionItems(view)
    expect(first).toMatchObject({ recommendation: 'sim', prUrl: 'https://github.com/o/r/pull/12' })
    expect(first?.card?.sessionId).toBe('local_a')
  })

  test('a waiting session says what it waits on', () => {
    expect(attentionItems(view)[2]?.title).toBe('Permissão pendente: Bash')
  })

  test('a question about skipping a gate carries the skip, and leaves once the gate passes or is skipped', () => {
    const gated = parseRun(
      {
        change: 'c',
        waves: [{ phases: [{ id: '2', title: 'B', status: 'running', session: 'ads-api', gates: ['testes'] }] }],
        ownerQuestions: [
          { question: 'Liberar os portões da fase 2?', recommendation: 'sim', gate: { phase: '2', gate: 'testes' } },
          { question: 'Pular o check final?', gate: { phase: 'final', gate: 'deploy' } },
        ],
      },
      '/w/coord',
      1,
    )
    if ('error' in gated) throw new Error(gated.error)
    // an unknown gate is dropped from the question, which stays a plain decision
    expect(gated.ownerQuestions[1]?.gate).toBeUndefined()
    const open = { ...view, run: gated }
    const [ask] = attentionItems(open)
    expect(ask?.skip).toMatchObject({ gate: 'testes', state: 'pending', skipKey: '2:testes' })
    expect(attentionItems({ ...open, skips: { '2:testes': { at: 5 } } }).map(a => a.title)).not.toContain('Liberar os portões da fase 2?')
    const passed = { ...api, gates: { records: { testes: { gate: 'testes', result: 'passed' as const, evidence: 'npm test', at: 9 } }, editedAt: undefined } }
    expect(attentionItems({ ...open, children: [passed, waitingCard] }).map(a => a.title)).not.toContain('Liberar os portões da fase 2?')
  })

  test('a merged PR is not something to review', () => {
    const merged = { ...view, children: [card({ sessionId: 'm', title: 'm', prNumber: 9, prState: 'MERGED' })] }
    expect(attentionItems(merged).some(a => a.kind === 'pr')).toBe(false)
  })
})

test('nowAndNext points at the first open wave and the one after', () => {
  const run = parseRun(
    {
      change: 'c',
      waves: [
        { phases: [{ id: '1', title: 'A', status: 'done' }] },
        { phases: [{ id: '2', title: 'B', status: 'running' }] },
        { phases: [{ id: '3', title: 'C', status: 'pending' }] },
      ],
    },
    '/w',
    1,
  )
  if ('error' in run) throw new Error(run.error)
  expect(nowAndNext(run)).toEqual({ now: 1, next: 2 })
  const done = { ...run, waves: run.waves.map(w => ({ ...w, phases: w.phases.map(p => ({ ...p, status: 'done' as const })) })) }
  expect(nowAndNext(done)).toEqual({ now: undefined, next: undefined })
})
