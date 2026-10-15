import { describe, expect, test } from 'claude-code/testing'

import type { FlowDef, FlowState } from '../types'
import {
  applyOutcome,
  automaticOutcome,
  describeFlow,
  flowView,
  mergeFlows,
  ownerPress,
  parseFlow,
  startFlow,
} from '../hooks/flow'
import { DEFAULT_FLOWS, defaultFlows } from '../hooks/flows/index'

const flows = Object.fromEntries(defaultFlows().map(f => [f.id, f])) as Record<string, FlowDef>
const completo = flows.completo!
const rapido = flows.rapido!

const ok = <T,>(r: T | { error: string }): T => {
  if (typeof r === 'object' && r !== null && 'error' in r) throw new Error((r as { error: string }).error)
  return r as T
}

/** The refusal's text, empty when the call was accepted. */
const err = (r: unknown): string => (r as { error?: string }).error ?? ''

const start = (flow: FlowDef, visual = false): FlowState =>
  startFlow(flow, { change: 'demo', coordinatorCwd: '/w', visual }, 1).state

type Report = [string, string, 'session' | 'automatic' | 'owner']

/** Walks a flow by a list of [step, outcome, by] reports, failing on the first refusal. */
const walk = (state: FlowState, reports: Report[]): FlowState =>
  reports.reduce((s, [step, outcome, by], i) => ok(applyOutcome(s, { step, outcome, by }, 10 + i)).state, state)

const toLiberacao: Report[] = [
  ['grill', 'fechado', 'owner'],
  ['planejar', 'pronto', 'session'],
  ['validar', 'passou', 'automatic'],
  ['revisao-plano', 'aprovado', 'session'],
]

describe('default flows', () => {
  test('both parse, and their steps run in the agreed order', () => {
    expect(DEFAULT_FLOWS.map(({ raw, source }) => err(parseFlow(raw, source)))).toEqual(['', ''])
    expect(completo.steps.map(s => s.id)).toEqual([
      'grill', 'mockup', 'planejar', 'validar', 'revisao-plano', 'liberacao',
      'executar', 'revisao-codigo', 'checagem', 'pr', 'qa', 'producao', 'arquivar',
    ])
    expect(rapido.steps.map(s => s.id)).toEqual([
      'planejar', 'validar', 'executar', 'revisao-codigo', 'checagem', 'pr', 'qa', 'producao', 'arquivar',
    ])
  })

  test('kinds, commands and the default ceiling of 3 attempts', () => {
    const at = (f: FlowDef, id: string) => f.steps.find(s => s.id === id)
    expect(at(completo, 'grill')?.kind).toBe('owner')
    expect(at(completo, 'grill')?.outcomes.fechado?.label).toBe('Entendimento fechado')
    expect(at(completo, 'mockup')?.when).toBe('visual')
    expect(at(completo, 'validar')?.command).toBe('openspec validate')
    expect(at(completo, 'checagem')?.requiresEvidence).toBe(true)
    expect(at(completo, 'executar')?.kind).toBe('loop')
    expect(at(completo, 'liberacao')?.kind).toBe('owner')
    expect(at(completo, 'arquivar')?.command).toBe('openspec archive')
    expect(completo.steps.every(s => s.maxAttempts === 3)).toBe(true)
    expect(at(rapido, 'validar')?.outcomes.passou?.next).toBe('executar')
  })
})

describe('parseFlow', () => {
  const step = (over: Record<string, unknown>) => ({ id: 'a', title: 'A', kind: 'session', outcomes: { ok: { next: 'fim' } }, ...over })
  const parse = (steps: unknown[]) => parseFlow({ id: 'x', title: 'X', steps }, 'x.json')

  test('refuses what would strand a run', () => {
    expect(err(parse([step({ outcomes: { ok: { next: 'nowhere' } } })]))).toBe(
      'x.json: step "a", outcome "ok" goes to "nowhere", which is no step of this flow.',
    )
    expect(err(parse([step({ kind: 'automatic', outcomes: { passou: 'fim', falhou: 'a' } })]))).toMatch(/needs the `command`/)
    expect(err(parse([step({ kind: 'automatic', command: 'x', outcomes: { ok: 'fim' } })]))).toMatch(/exactly the outcomes passou and falhou/)
    expect(err(parse([step({}), step({})]))).toMatch(/appears twice/)
    expect(err(parse([step({ kind: 'robot' })]))).toMatch(/kind must be/)
    expect(err(parse([step({ maxAttempts: 0 })]))).toMatch(/maxAttempts/)
    expect(err(parse([step({ id: 'fim' })]))).toMatch(/reserved/)
    expect(err(parse([]))).toMatch(/non-empty/)
  })

  test('a bare next is accepted and its label falls back to the outcome', () => {
    const flow = ok(parse([step({ outcomes: { ok: 'fim' }, maxAttempts: 5 })]))
    expect(flow.steps[0]?.outcomes.ok).toEqual({ label: 'ok', next: 'fim' })
    expect(flow.steps[0]?.maxAttempts).toBe(5)
  })
})

test('a project flow replaces the default of the same id and adds new ones', () => {
  const mine = ok(parseFlow({ id: 'rapido', title: 'Meu rápido', steps: [{ id: 'a', title: 'A', kind: 'session', outcomes: { ok: 'fim' } }] }, 'p'))
  const merged = mergeFlows([completo, rapido], [mine, { ...mine, id: 'hotfix' }])
  expect(Object.keys(merged)).toEqual(['completo', 'rapido', 'hotfix'])
  expect(merged.rapido?.title).toBe('Meu rápido')
})

describe('the engine', () => {
  test('a change that is not visual skips the mockup; a visual one stops there', () => {
    const plain = walk(start(completo), [['grill', 'fechado', 'owner']])
    expect(plain.current).toBe('planejar')
    const visual = walk(start(completo, true), [['grill', 'fechado', 'owner']])
    expect(visual.current).toBe('mockup')
    expect(walk(visual, [['mockup', 'ajustes', 'owner']]).current).toBe('mockup')
    expect(flowView(plain).steps.find(s => s.id === 'mockup')?.state).toBe('skipped')
  })

  test('a session never answers an owner step, nor an automatic one', () => {
    expect(err(applyOutcome(start(completo), { step: 'grill', outcome: 'fechado', by: 'session' }, 2))).toMatch(
      /owner step: only the owner, pressing a button in the panel/,
    )
    const atValidar = walk(start(rapido), [['planejar', 'pronto', 'session']])
    expect(err(applyOutcome(atValidar, { step: 'validar', outcome: 'passou', by: 'session' }, 2))).toMatch(
      /only the mod, watching its command run/,
    )
  })

  test("steps cannot be skipped: executar fases waits for the owner's release", () => {
    const atLiberacao = walk(start(completo), toLiberacao)
    expect(atLiberacao.current).toBe('liberacao')
    expect(err(applyOutcome(atLiberacao, { step: 'executar', outcome: 'concluidas', by: 'session' }, 2))).toMatch(
      /is on "liberacao" \(Liberação do dono\), not on "executar": steps cannot be skipped/,
    )
    const released = ok(ownerPress(atLiberacao, 'liberacao', 'liberado', 3)).state
    expect(released.current).toBe('executar')
    expect(ok(applyOutcome(released, { step: 'executar', outcome: 'concluidas', by: 'session' }, 4)).state.current).toBe('revisao-codigo')
  })

  test('only outcomes the step declares are accepted', () => {
    expect(err(applyOutcome(start(rapido), { step: 'planejar', outcome: 'talvez', by: 'session' }, 2))).toBe(
      'step "planejar" has no outcome "talvez"; it declares pronto.',
    )
    expect(err(applyOutcome(start(rapido), { step: 'nada', outcome: 'x', by: 'session' }, 2))).toMatch(/has no step "nada"/)
  })

  test('a step entered past its ceiling escalates; the owner retries it or ends the flow', () => {
    const fail: Report[] = [
      ['planejar', 'pronto', 'session'],
      ['validar', 'falhou', 'automatic'],
    ]
    const twice = walk(start(rapido), [...fail, ...fail])
    expect(twice.attempts.planejar).toBe(3)
    expect(twice.status).toBe('running')
    const third = walk(twice, fail)
    expect(third.status).toBe('escalated')
    expect(third.escalation).toEqual({ step: 'planejar', from: 'validar', outcome: 'falhou', attempts: 3 })
    expect(err(applyOutcome(third, { step: 'planejar', outcome: 'pronto', by: 'session' }, 9))).toMatch(/ceiling of 3 attempts/)
    expect(flowView(third).ownerChoices.map(c => c.outcome)).toEqual(['tentar-de-novo', 'encerrar'])
    expect(flowView(third).waitingOn).toBe('owner')
    expect(describeFlow(third)).toMatch(/waits on the owner/)

    const retried = ok(ownerPress(third, 'planejar', 'tentar-de-novo', 20)).state
    expect([retried.status, retried.current, retried.attempts.planejar]).toEqual(['running', 'planejar', 1])
    expect(ok(ownerPress(third, 'planejar', 'encerrar', 20)).state.status).toBe('aborted')
  })

  test('QA asking for changes goes back to the phases and forgets what came after', () => {
    const atQa = walk(start(rapido), [
      ['planejar', 'pronto', 'session'],
      ['validar', 'passou', 'automatic'],
      ['executar', 'concluidas', 'session'],
      ['revisao-codigo', 'aprovado', 'session'],
      ['checagem', 'passou', 'automatic'],
      ['pr', 'aberto', 'session'],
    ])
    expect(atQa.current).toBe('qa')
    const back = ok(ownerPress(atQa, 'qa', 'ajustes', 30)).state
    expect(back.current).toBe('executar')
    expect(Object.keys(back.records)).toEqual(['planejar', 'validar'])
    expect(back.attempts.executar).toBe(2)
  })

  test('the last step ends the flow; nothing more is accepted', () => {
    const atArquivar = walk(start(rapido), [
      ['planejar', 'pronto', 'session'],
      ['validar', 'passou', 'automatic'],
      ['executar', 'concluidas', 'session'],
      ['revisao-codigo', 'aprovado', 'session'],
      ['checagem', 'passou', 'automatic'],
      ['pr', 'aberto', 'session'],
      ['qa', 'aprovado', 'owner'],
      ['producao', 'publicado', 'owner'],
    ])
    const moved = ok(applyOutcome(atArquivar, { step: 'arquivar', outcome: 'passou', by: 'automatic' }, 50))
    expect(moved.state.status).toBe('done')
    expect(moved.events.map(e => e.kind)).toEqual(['outcome', 'done'])
    expect(flowView(moved.state).steps.every(s => s.state === 'done')).toBe(true)
    expect(flowView(moved.state).waitingOn).toBeUndefined()
    expect(err(applyOutcome(moved.state, { step: 'arquivar', outcome: 'passou', by: 'automatic' }, 51))).toMatch(/finished/)
  })

  test('events are numbered in order from the start', () => {
    const started = startFlow(completo, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1)
    expect(started.events.map(e => [e.seq, e.kind, e.step])).toEqual([
      [1, 'started', 'completo'],
      [2, 'entered', 'grill'],
    ])
    const moved = ok(ownerPress(started.state, 'grill', 'fechado', 2))
    expect(moved.events.map(e => [e.seq, e.kind, e.step])).toEqual([
      [3, 'outcome', 'grill'],
      [4, 'skipped', 'mockup'],
      [5, 'entered', 'planejar'],
    ])
    expect(moved.state.seq).toBe(5)
  })
})

describe('automaticOutcome', () => {
  const validar = completo.steps.find(s => s.id === 'validar')!
  const checagem = completo.steps.find(s => s.id === 'checagem')!

  test('the exit code of the declared command decides', () => {
    expect(automaticOutcome(validar, 'cd /w && npx openspec validate demo --strict', false)).toBe('passou')
    expect(automaticOutcome(validar, 'node_modules/.bin/openspec validate demo', true)).toBe('falhou')
    expect(automaticOutcome(checagem, 'sh scripts/check.sh', false)).toBe('passou')
    expect(automaticOutcome(checagem, './scripts/check.sh', false)).toBe('passou')
  })

  test('a mention, another command or a hidden exit code proves nothing', () => {
    expect(automaticOutcome(validar, 'echo "openspec validate"', false)).toBeUndefined()
    expect(automaticOutcome(validar, 'openspec list', false)).toBeUndefined()
    expect(automaticOutcome(validar, 'openspec validate demo | tail -5', false)).toBeUndefined()
    expect(automaticOutcome(validar, 'openspec validate demo || true', false)).toBeUndefined()
    expect(automaticOutcome(completo.steps[0]!, 'openspec validate', false)).toBeUndefined()
  })
})

test('flowView shows the owner step and its buttons', () => {
  const view = flowView(walk(start(completo), toLiberacao))
  expect(view.current?.id).toBe('liberacao')
  expect(view.waitingOn).toBe('owner')
  expect(view.ownerChoices).toEqual([
    { outcome: 'liberado', label: 'Liberar execução' },
    { outcome: 'ajustes', label: 'Pedir ajustes no plano' },
  ])
  expect(view.steps.filter(s => s.state === 'done').map(s => s.id)).toEqual(['grill', 'planejar', 'validar', 'revisao-plano'])
  expect(view.steps.find(s => s.id === 'validar')?.outcomeLabel).toBe('Validou')
})
