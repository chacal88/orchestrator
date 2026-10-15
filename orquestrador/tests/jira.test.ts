import { describe, expect, test } from 'claude-code/testing'

import { divergence, firstSite, issueUrl, jiraKeys, normalizeKey, parseIssue } from '../hooks/jira'
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
