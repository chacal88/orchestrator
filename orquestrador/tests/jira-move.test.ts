import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { FlowState } from '../types'
import { parseFlow } from '../hooks/flow'
import { completo } from '../hooks/flows/completo'

type On = Parameters<TestBody>[1]

const PANE = {
  component: 'Pane',
  requestId: 'orquestrador',
  props: { title: 'Orquestrador', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const HOME = '/h/.claude/orquestrador'
const LOG = `${HOME}/flows/demo.ndjson`

type World = { disk: Map<string, string>; calls: Record<string, unknown>[]; status: { name: string; cat: string } }

/** A coordinator at /w, an in-memory disk and an Atlassian connector whose issue EP-1 sits in "Em andamento". */
const world = (on: On, opts: { connector?: boolean; transitions?: unknown[] } = {}): World => {
  mock.store(on)
  const w: World = { disk: new Map(), calls: [], status: { name: 'Em andamento', cat: 'indeterminate' } }
  const transitions = opts.transitions ?? [
    { id: '11', name: 'Enviar para QA', to: { name: 'Em QA', statusCategory: { key: 'indeterminate' } } },
    { id: '31', name: 'Concluir', to: { name: 'Concluído', statusCategory: { key: 'done' } } },
  ]
  on('env.get', () => ({ value: '/h' }))
  on('clock.now', () => ({ value: 1_000 }))
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
    value: (opts.connector === false
      ? []
      : [
          { name: 'mcp__x__getJiraIssue' },
          { name: 'mcp__x__getAccessibleAtlassianResources' },
          { name: 'mcp__x__getTransitionsForJiraIssue' },
          { name: 'mcp__x__transitionJiraIssue' },
        ]) as never,
  }))
  const answer = (text: string) => ({ result: text, text }) as never
  on('tool.call', ($, e) => {
    const input = e as unknown as Record<string, unknown>
    w.calls.push(input)
    switch (input.tool) {
      case 'mcp__x__getAccessibleAtlassianResources':
        return answer(JSON.stringify([{ id: 'c1', url: 'https://a.atlassian.net' }]))
      case 'mcp__x__getJiraIssue':
        return answer(JSON.stringify({ fields: { summary: 'Épico', status: { name: w.status.name, statusCategory: { key: w.status.cat } } } }))
      case 'mcp__x__getTransitionsForJiraIssue':
        return answer(JSON.stringify({ transitions }))
      case 'mcp__x__transitionJiraIssue':
        w.status = { name: 'Em QA', cat: 'indeterminate' }
        return answer('{}')
      default:
        return answer('')
    }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return w
}

const startAt = async ($: Parameters<TestBody>[0], w: World, step: string, flow: unknown = completo) => {
  const def = parseFlow(flow, 'test')
  if ('error' in def) throw new Error(def.error)
  const state: FlowState = {
    change: 'demo', coordinatorCwd: '/w', flow: def, traits: { visual: false }, current: step, status: 'running',
    attempts: {}, records: {}, seq: 5, startedAt: 1, updatedAt: 2,
  }
  w.disk.set(`${HOME}/flows/demo.json`, JSON.stringify(state))
  // publishing the plan refreshes the panel, so the flow is on disk first
  await $.tool.call({ tool: 'mcp__orquestrador__plano', change: 'demo', jira: 'EP-1', waves: [{ phases: [{ id: '1', title: 'A', status: 'running' }] }] } as never)
}

test('at qa the panel offers the move, and only the owner’s press makes it, logged in the flow', async ($, on) => {
  const w = world(on)
  await startAt($, w, 'qa')
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /A issue EP-1 pode ir para Em QA/ })).toBeDefined()
  expect(w.calls.some(c => c.tool === 'mcp__x__transitionJiraIssue')).toBe(false)

  await ui.press({ key: 'jira-move:EP-1' })
  const moved = w.calls.find(c => c.tool === 'mcp__x__transitionJiraIssue')
  expect(moved).toMatchObject({ cloudId: 'c1', issueIdOrKey: 'EP-1', transition: { id: '11' } })
  expect(w.disk.get(LOG)).toMatch(/"kind":"jira-moved".*"by":"owner".*Em andamento.*Em QA/)
  // refreshed: the issue is where it should be, so the item is gone
  expect(await ui.find({ type: 'Text', text: /pode ir para Em QA/ })).toBeUndefined()
  await ui.unmount()
})

test('a session cannot move an issue by itself', async ($, on) => {
  const w = world(on)
  await startAt($, w, 'qa')
  const call = { tool: 'mcp__x__transitionJiraIssue', cloudId: 'c1', issueIdOrKey: 'EP-1', transition: { id: '11' } }
  expect(((await $.tool.call(call as never)) as { deny?: string }).deny).toMatch(/Mover no Jira/)
  expect(w.calls.some(c => c.tool === 'mcp__x__transitionJiraIssue')).toBe(false)
})

test('nothing is offered while the issue is already there', async ($, on) => {
  const w = world(on)
  w.status = { name: 'em qa', cat: 'indeterminate' }
  await startAt($, w, 'qa')
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /EP-1 (pode|deveria)/ })).toBeUndefined()
  await ui.unmount()
})

test('with no matching transition the item says so plainly and offers no button', async ($, on) => {
  const w = world(on, { transitions: [{ id: '99', name: 'Pausar', to: { name: 'Pausada', statusCategory: { key: 'new' } } }] })
  await startAt($, w, 'qa')
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /não oferece essa transição/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Disponíveis: Pausada/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Mover no Jira/ })).toBeUndefined()
  await ui.unmount()
})

test('with the connector not authenticated the item says so and offers no button', async ($, on) => {
  const w = world(on, { connector: false })
  await startAt($, w, 'qa')
  const ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /não consigo mexer no Jira/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /não está autenticado/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Mover no Jira/ })).toBeUndefined()
  await ui.unmount()
})

test('the flow file sets the target per step, by name or category, or turns it off', async ($, on) => {
  const w = world(on)
  const custom = JSON.parse(JSON.stringify(completo)) as { steps: { id: string; jira?: unknown }[] }
  custom.steps.find(s => s.id === 'qa')!.jira = { category: 'done' }
  await startAt($, w, 'qa', custom)
  let ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /pode ir para Concluído/ })).toBeDefined()
  await ui.unmount()

  custom.steps.find(s => s.id === 'qa')!.jira = false
  await startAt($, w, 'qa', custom)
  ui = await $.ui.mount({ plugin: 'orquestrador', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /EP-1 (pode|deveria)/ })).toBeUndefined()
  await ui.unmount()
})
