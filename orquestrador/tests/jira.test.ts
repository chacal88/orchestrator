import { describe, expect, test } from 'claude-code/testing'

import type { JiraIssue } from '../types'
import { parseFlow } from '../hooks/flow'
import { divergence, firstSite, issueUrl, jiraKeys, moveFor, normalizeKey, parseIssue, parseTransitions, pickTransition, reached, targetLabel, targetOf, wishes } from '../hooks/jira'
import { parseRun } from '../hooks/model'

describe('normalizeKey', () => {
  test('accepts Jira keys in any case and refuses anything else', () => {
    expect(normalizeKey(' proj-12 ')).toBe('PROJ-12')
    expect(normalizeKey('PROJ')).toBeUndefined()
    expect(normalizeKey('12-PROJ')).toBeUndefined()
    expect(normalizeKey('')).toBeUndefined()
    expect(normalizeKey(42)).toBeUndefined()
  })
})

describe('the plan carries Jira keys', () => {
  const run = parseRun(
    {
      change: 'c',
      jira: 'EP-1',
      jiraSite: 'https://acme.atlassian.net/jira',
      waves: [
        { jira: 'EP-2', phases: [{ id: '1', title: 'A', status: 'done', jira: 'ep-3' }] },
        { phases: [{ id: '2', title: 'B', status: 'pending', jira: 'EP-3' }, { id: '3', title: 'C', status: 'pending', jira: 'nope' }] },
      ],
    },
    '/w',
    1,
  )
  if ('error' in run) throw new Error(run.error)

  test('change, wave and phase keys are read, repeats and malformed keys dropped', () => {
    expect(jiraKeys(run)).toEqual(['EP-1', 'EP-2', 'EP-3'])
    expect(run.waves[1]?.phases[1]?.jira).toBeUndefined()
  })

  test('the link is built from a bare host or a full URL', () => {
    expect(issueUrl(run.jiraSite, 'EP-1')).toBe('https://acme.atlassian.net/browse/EP-1')
    expect(issueUrl(undefined, 'EP-1')).toBeUndefined()
  })
})

describe('connector answers', () => {
  test('firstSite reads the first site with a URL and an id', () => {
    expect(firstSite('[]')).toBeUndefined()
    expect(firstSite('not json')).toBeUndefined()
    expect(firstSite(JSON.stringify([{ id: 'c1', url: 'https://a.atlassian.net', name: 'a' }]))).toEqual({
      url: 'https://a.atlassian.net',
      cloudId: 'c1',
    })
  })

  test('parseIssue finds the fields however deep the connector nests them', () => {
    const text = JSON.stringify({
      issue: { key: 'EP-3', fields: { summary: 'Fazer X', status: { name: 'Em andamento', statusCategory: { key: 'indeterminate' } } } },
    })
    expect(parseIssue(text, 'EP-3', 'a.atlassian.net')).toEqual({
      key: 'EP-3',
      title: 'Fazer X',
      status: 'Em andamento',
      category: 'indeterminate',
      url: 'https://a.atlassian.net/browse/EP-3',
    })
  })

  test('an unreadable answer keeps the key and the link only', () => {
    expect(parseIssue(undefined, 'EP-3', undefined)).toEqual({
      key: 'EP-3', title: undefined, status: undefined, category: 'unknown', url: undefined,
    })
  })
})

describe('divergence', () => {
  const issue = (category: 'new' | 'indeterminate' | 'done' | 'unknown') =>
    ({ key: 'EP-1', title: undefined, status: 'S', category, url: undefined }) as const

  test('flags a closed phase with an open issue, and an open phase with a closed issue', () => {
    expect(divergence('done', issue('indeterminate'))).toContain('Fase fechada')
    expect(divergence('running', issue('done'))).toContain('já está')
  })

  test('says nothing when they agree or Jira is unknown', () => {
    expect(divergence('done', issue('done'))).toBeUndefined()
    expect(divergence('pending', issue('new'))).toBeUndefined()
    expect(divergence('done', issue('unknown'))).toBeUndefined()
    expect(divergence('done', undefined)).toBeUndefined()
  })
})

describe('the Jira state a step implies', () => {
  const steps = (jira?: unknown) => {
    const flow = parseFlow(
      {
        id: 'f', title: 'F',
        steps: [
          { id: 'executar', title: 'E', kind: 'loop', over: 'tasks', outcomes: { concluidas: 'qa' } },
          { id: 'qa', title: 'Q', kind: 'owner', ...(jira === undefined ? {} : { jira }), outcomes: { ok: 'fim' } },
        ],
      },
      'test',
    )
    if ('error' in flow) throw new Error(flow.error)
    return flow.steps
  }
  const run = parseRun(
    { change: 'c', jira: 'EP-1', waves: [{ phases: [{ id: '1', title: 'A', status: 'running', jira: 'EP-2' }, { id: '2', title: 'B', status: 'done', jira: 'EP-3' }] }] },
    '/w',
    1,
  )
  if ('error' in run) throw new Error(run.error)
  const issue = (status: string, category: 'new' | 'indeterminate' | 'done'): JiraIssue => ({ key: 'EP-1', title: undefined, status, category, url: undefined })

  test('defaults: the loop wants Em andamento for the change and running phases, Concluído for closed ones', () => {
    expect(wishes(run, steps(), 'executar').map(w => [w.key, targetLabel(w.target)])).toEqual([
      ['EP-1', 'Em andamento'], ['EP-2', 'Em andamento'], ['EP-3', 'Concluído'],
    ])
    expect(wishes(run, steps(), 'qa').map(w => [w.key, targetLabel(w.target)])).toEqual([['EP-1', 'Em QA']])
  })

  test('a flow file overrides a step: a name, a list, a category, or false', () => {
    expect(targetOf(steps('Em validação'), 'qa')).toEqual({ status: ['Em validação'] })
    expect(targetOf(steps(['A', 'B']), 'qa')).toEqual({ status: ['A', 'B'] })
    expect(targetOf(steps({ category: 'done' }), 'qa')).toEqual({ status: [], category: 'done' })
    expect(targetOf(steps(false), 'qa')).toBeUndefined()
    expect(parseFlow({ id: 'f', title: 'F', steps: [{ id: 'a', title: 'A', kind: 'owner', jira: { category: 'x' }, outcomes: { ok: 'fim' } }] }, 'src')).toEqual({
      error: 'src: step "a": `jira.category` must be new, indeterminate or done.',
    })
  })

  test('reached ignores case and falls back to the category when no name is given', () => {
    expect(reached(issue('em qa', 'indeterminate'), { status: ['Em QA'] })).toBe(true)
    expect(reached(issue('Em andamento', 'indeterminate'), { status: ['Em QA'] })).toBe(false)
    expect(reached(issue('Pronto', 'done'), { status: [], category: 'done' })).toBe(true)
  })

  const transitions = parseTransitions(
    JSON.stringify({ transitions: [{ id: 11, name: 'Enviar', to: { name: 'Em QA', statusCategory: { key: 'indeterminate' } } }, { id: '31', name: 'Fechar', to: { name: 'Pronto', statusCategory: { key: 'done' } } }] }),
  )

  test('transitions are read however the connector wraps them, and matched case-insensitively', () => {
    expect(transitions.map(t => t.id)).toEqual(['11', '31'])
    expect(pickTransition(transitions, { status: ['em qa'] })?.id).toBe('11')
    expect(pickTransition(transitions, { status: ['Concluído'], category: 'done' })?.id).toBe('31')
    expect(pickTransition(transitions, { status: ['Em teste'] })).toBeUndefined()
    expect(parseTransitions('nope')).toEqual([])
  })

  test('moveFor: ready, no matching transition, connector off, already there', () => {
    const w = { key: 'EP-1', target: { status: ['Em QA'] } }
    expect(moveFor(w, issue('Em andamento', 'indeterminate'), transitions, 'qa', undefined)).toMatchObject({ state: 'ready', transitionId: '11', toLabel: 'Em QA' })
    expect(moveFor({ ...w, target: { status: ['Em teste'] } }, issue('Em andamento', 'indeterminate'), transitions, 'qa', undefined)).toMatchObject({ state: 'no-transition', available: ['Em QA', 'Pronto'] })
    expect(moveFor(w, undefined, undefined, 'qa', 'sem conector')).toMatchObject({ state: 'no-connector', note: 'sem conector' })
    expect(moveFor(w, issue('Em QA', 'indeterminate'), transitions, 'qa', undefined)).toBeUndefined()
  })
})
