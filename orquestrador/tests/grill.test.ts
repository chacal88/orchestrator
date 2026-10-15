import { expect, test } from 'claude-code/testing'

import type { FlowDef, FlowState, FlowView, PrepState } from '../types'
import { applyOutcome, flowView, startFlow } from '../hooks/flow'
import { defaultFlows } from '../hooks/flows/index'
import {
  approvePlan,
  attachMockup,
  describePrep,
  emptyPrep,
  grillMarkdown,
  hiddenChoices,
  parseRoundItems,
  planVerdict,
  pressMockup,
  prepView,
  recordRound,
  rejectPlan,
} from '../hooks/grill'

const completo = defaultFlows().find(f => f.id === 'completo') as FlowDef

const ok = <T,>(r: T | { error: string }): T => {
  if (typeof r === 'object' && r !== null && 'error' in r) throw new Error((r as { error: string }).error)
  return r as T
}
const err = (r: unknown): string => (r as { error?: string }).error ?? ''

const start = (visual = false): FlowState => startFlow(completo, { change: 'demo', coordinatorCwd: '/w', visual }, 1).state
const at = (state: FlowState, step: string): FlowState => ({ ...state, current: step })

test('a grill round records questions and answers; answers become acceptance criteria', () => {
  const state = start()
  const items = ok(parseRoundItems([{ question: 'Quem usa?', answer: 'O dono' }, { question: 'Precisa de mobile?' }]))
  let prep = ok(recordRound(emptyPrep('demo'), state, items, false, 5)).prep
  expect(prepView(prep)).toMatchObject({ rounds: 1, openQuestions: ['Precisa de mobile?'], criteria: ['O dono'] })

  const filled = ok(parseRoundItems([{ question: 'Precisa de mobile?', answer: 'Não', criterion: 'Funciona só no desktop' }]))
  const amended = ok(recordRound(prep, state, filled, true, 6))
  prep = amended.prep
  expect(amended.event).toMatchObject({ kind: 'round', step: 'grill', note: 'rodada 1: 2 perguntas, 0 em aberto' })
  expect(prepView(prep)).toMatchObject({ rounds: 1, openQuestions: [], criteria: ['O dono', 'Funciona só no desktop'] })

  prep = ok(recordRound(prep, state, ok(parseRoundItems(['E o Jira?'])), false, 7)).prep
  expect(prepView(prep)).toMatchObject({ rounds: 2, openQuestions: ['E o Jira?'] })

  const md = grillMarkdown(prep)
  expect(md).toMatch(/## Rodada 1\n\n- \*\*Pergunta:\*\* Quem usa\?\n  \*\*Resposta:\*\* O dono/)
  expect(md).toMatch(/\*\*Resposta:\*\* _\(em aberto\)_/)
  expect(md).toMatch(/## Critérios de aceite\n\n- \[ \] O dono\n- \[ \] Funciona só no desktop/)
  expect(describePrep(state, prep)).toMatch(/Grill: 2 round\(s\) recorded, 1 open question\(s\), 2 acceptance criteria/)
})

test('a round is refused off the grill or without questions', () => {
  expect(err(parseRoundItems([]))).toMatch(/must list the round's questions/)
  expect(err(parseRoundItems([{ answer: 'x' }]))).toMatch(/question 1 has no `question`/)
  const off = at(start(), 'planejar')
  expect(err(recordRound(emptyPrep('demo'), off, [{ question: 'q' }], false, 1))).toMatch(/only while the flow of demo is on "grill"/)
})

test('the mockup is attached on its step, approved only once attached, and an adjustment keeps the note', () => {
  const state = at(start(true), 'mockup')
  expect(err(attachMockup(emptyPrep('demo'), at(state, 'grill'), 'https://claude.ai/artifact/x', 1))).toMatch(/on "mockup"/)
  expect(err(attachMockup(emptyPrep('demo'), state, 'um mockup', 1))).toMatch(/URL .* or a file path/)
  expect(err(pressMockup(emptyPrep('demo'), 'aprovado', undefined, 1))).toMatch(/nenhum mockup/)

  const attached = ok(attachMockup(emptyPrep('demo'), state, 'https://claude.ai/artifact/x', 2))
  expect(attached.event).toMatchObject({ kind: 'attached', step: 'mockup', note: 'https://claude.ai/artifact/x' })
  expect(prepView(attached.prep)).toMatchObject({ mockup: 'https://claude.ai/artifact/x', mockupIsUrl: true })
  expect(ok(attachMockup(emptyPrep('demo'), state, '/w/design/mock up.png', 2)).prep.mockup?.artifact).toBe('/w/design/mock up.png')

  const adjusted = ok(pressMockup(attached.prep, 'ajustes', ' botão maior ', 3)) as PrepState
  expect(adjusted.mockup).toBeUndefined()
  expect(adjusted.adjustments).toEqual([{ note: 'botão maior', at: 3, artifact: 'https://claude.ai/artifact/x' }])
  expect(describePrep(state, adjusted)).toMatch(/none attached.*last adjustment: "botão maior"/)
})

test('only the dialog answer counts as the release: approval, refusal with words, and what is ignored', () => {
  expect(planVerdict({}, { ref: 1, result: { plan: '## Plano', isAgent: false, filePath: '/p.md' } })).toEqual({
    approved: true,
    plan: '## Plano',
    filePath: '/p.md',
  })
  expect(planVerdict({}, { isError: true, result: 'x', text: 'The user said: falta a fase 3' })).toEqual({
    approved: false,
    feedback: 'The user said: falta a fase 3',
  })
  expect(planVerdict({ agentId: 'a1' }, { ref: 1, result: { plan: 'p', isAgent: false } })).toBeUndefined()
  expect(planVerdict({}, { result: { plan: 'p', isAgent: false } })).toBeUndefined()
  expect(planVerdict({}, { ref: 1, result: { plan: 'p', isAgent: true } })).toBeUndefined()
  expect(planVerdict({}, { ref: 1, result: { plan: 'p', isAgent: false, awaitingLeaderApproval: true } })).toBeUndefined()
  expect(planVerdict({}, { deny: 'no' })).toBeUndefined()

  const rejected = rejectPlan(emptyPrep('demo'), 'falta a fase 3', 4)
  expect(rejected.event).toMatchObject({ kind: 'plan-rejected', step: 'liberacao', by: 'owner' })
  expect(prepView(rejected.prep)).toMatchObject({ lastPlanFeedback: 'falta a fase 3', released: false })
  expect(prepView(approvePlan(rejected.prep, { approved: true, plan: 'p', filePath: undefined }, 5)).released).toBe(true)
})

test('the panel hides the release button, and the mockup buttons until they make sense', () => {
  const view = (step: string): FlowView => flowView(at(start(true), step))
  expect(hiddenChoices(view('liberacao'), undefined, true)).toEqual(['liberado'])
  expect(hiddenChoices(view('mockup'), undefined, true)).toEqual(['aprovado', 'ajustes'])
  const attached = prepView(ok(attachMockup(emptyPrep('demo'), at(start(true), 'mockup'), 'https://x.y/m', 1)).prep)
  expect(hiddenChoices(view('mockup'), attached, true)).toEqual(['ajustes'])
  expect(hiddenChoices(view('mockup'), attached, false)).toEqual([])
  expect(hiddenChoices(view('grill'), undefined, true)).toEqual([])
})

test('a session can never report the release, whatever it says', () => {
  const state = at(start(), 'liberacao')
  expect(err(applyOutcome(state, { step: 'liberacao', outcome: 'liberado', by: 'session' }, 1))).toMatch(
    /only the owner, pressing a button in the panel/,
  )
})
