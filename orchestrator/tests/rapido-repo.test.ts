import { expect, test } from 'claude-code/testing'

import type { FlowDef, FlowState, OrchestrationRun } from '../types'
import { LEGACY_AGENTS, describeFlow, normalizeAgents, parseFlow, pendingCodeReview, resolveFlow, startFlow } from '../hooks/flow'
import { changePrs } from '../hooks/model'
import { PROJECT, raw } from './rapido-repo-flow'

test("this repository's rapido.json resolves, in the order of the change, with merge and deploy following config.json", () => {
  const flow = parseFlow(raw, '.orquestrador/flows/rapido.json', PROJECT)
  if ('error' in flow) throw new Error(flow.error)
  expect(flow.steps.map(s => s.id)).toEqual([
    'planejar', 'validar', 'executar', 'revisao-codigo', 'checagem', 'tipos', 'publicar', 'merge', 'deploy', 'lancar',
  ])
  const step = (id: string) => flow.steps.find(s => s.id === id)!
  expect(step('tipos')).toMatchObject({ kind: 'automatic', command: 'tsc' })
  expect(step('tipos').outcomes.falhou!.next).toBe('executar')
  expect(step('merge')).toMatchObject({ kind: 'automatic', agent: 'merge-pelo-workflow', merge: { branch: 'main', method: 'squash', auto: true } })
  expect(step('merge').merge?.fromProject).toEqual(['auto'])
  expect(step('deploy')).toMatchObject({
    kind: 'automatic',
    deploy: { ci: false, auto: true, commands: PROJECT.deploy.commands },
  })
  expect(step('lancar').outcomes.passou!.next).toBe('fim')
  expect(flow.steps.some(s => s.id === 'qa')).toBe(false)
})

/** The repository's flow as the mod loads it: through resolveFlow, which reads the old agent names as the new. */
const loaded = (): FlowDef => {
  const flow = resolveFlow(raw, '.orquestrador/flows/rapido.json', () => undefined, [], PROJECT)
  if ('error' in flow) throw new Error(flow.error)
  return flow
}

const parked = (flow: FlowDef, current: string, records: FlowState['records'] = {}): FlowState => {
  const { state } = startFlow(flow, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1)
  return { ...state, current, attempts: { [current]: 1 }, records }
}

test('2.2 the old agent names of the repository flow load as the new ones', () => {
  const agents = Object.fromEntries(loaded().steps.flatMap(s => (s.agent === undefined ? [] : [[s.id, s.agent]])))
  expect(agents).toMatchObject({ planejar: 'planner', 'revisao-codigo': 'code-reviewer', publicar: 'pr-opener', merge: 'workflow-merge' })
  expect(Object.values(agents).some(a => Object.hasOwn(LEGACY_AGENTS, a))).toBe(false)
})

test('2.2 with the old names, the merge stays automatic on the workflow approval, never "The owner merges"', () => {
  const text = describeFlow(parked(loaded(), 'merge'))
  expect(text).toContain("on the workflow's own approval")
  expect(text).toContain('GitHub approval is not required')
  expect(text).not.toContain('The owner merges')
  expect(text).not.toContain('approved on GitHub and its CI is green')
})

test('2.2 with the old names, the step that opens the PR still cites its number', () => {
  const flow = loaded()
  const state = parked(flow, 'merge', { publicar: { outcome: Object.keys(flow.steps.find(s => s.id === 'publicar')!.outcomes)[0]!, by: 'session', at: 2, note: 'PR aberto #812' } })
  const run: OrchestrationRun = {
    change: 'demo', changePath: undefined, coordinatorCwd: '/w', jira: undefined, jiraSite: undefined,
    waves: [], ownerQuestions: [], finalGates: undefined, updatedAt: 1,
  }
  expect([...changePrs(run, state, []).numbers]).toEqual([812])
})

test('2.2 a flow state saved with "revisor-codigo" reads as code-reviewer, and the review still waits on aprovado', () => {
  const flow = loaded()
  // the flow as a 0.14.1 state file holds it: the old name in `state.flow`, on a step known by its agent alone
  const old: FlowDef = {
    ...flow,
    steps: flow.steps.map(s => (s.id === 'revisao-codigo' ? { ...s, id: 'revisao', agent: 'revisor-codigo' } : s)),
  }
  expect(pendingCodeReview(parked(old, 'checagem'))).toBeUndefined()
  const read = normalizeAgents(old)
  expect(read.steps.find(s => s.id === 'revisao')!.agent).toBe('code-reviewer')
  const waiting = parked(read, 'checagem', { revisao: { outcome: 'rejeitado', by: 'session', at: 2 } })
  expect(pendingCodeReview(waiting)?.id).toBe('revisao')
  expect(pendingCodeReview({ ...waiting, records: { revisao: { outcome: 'aprovado', by: 'session', at: 2 } } })).toBeUndefined()
})

test('2.2 normalizeAgents leaves a new name and an unknown name as they are', () => {
  const flow = loaded()
  const named = (agent: string): FlowDef => ({ ...flow, steps: flow.steps.map(s => (s.id === 'planejar' ? { ...s, agent } : s)) })
  for (const agent of ['planner', 'seguranca-do-projeto', 'constructor']) {
    const def = named(agent)
    expect(normalizeAgents(def).steps.find(s => s.id === 'planejar')!.agent).toBe(agent)
  }
  const fresh = named('planner')
  expect(normalizeAgents(fresh)).toBe(fresh)
})
