import { describe, expect, test } from 'claude-code/testing'

import type { FlowActor, FlowDef, FlowState } from '../types'
import {
  applyOutcome,
  automaticOutcome,
  describeFlow,
  dropPending,
  flowView,
  mergeFlows,
  ownerPress,
  parseFlow,
  registerPending,
  startFlow,
} from '../hooks/flow'
import { closePhase } from '../hooks/lifecycle'
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

type Report = [string, string, FlowActor]

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
    expect(err(applyOutcome(released, { step: 'executar', outcome: 'concluidas', by: 'session' }, 4))).toMatch(
      /is a loop step: only the mod, once every phase is closed/,
    )
    expect(ok(applyOutcome(released, { step: 'executar', outcome: 'concluidas', by: 'mod' }, 4)).state.current).toBe('revisao-codigo')
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

  test('a session step tells the coordination to open a session for it, never to do it there', () => {
    const text = describeFlow(start(rapido))
    expect(text).toMatch(/start_session/)
    expect(text).toMatch(/"user_asked"/)
    expect(text).toMatch(/do not do the step in this session/)
    expect(text).toMatch(/user_asked" with wake_when_done/)
    // a refused start is kept for the owner's single press, never proposed as a card
    expect(text).toMatch(/action "pending"/)
    expect(text).toMatch(/Abrir as N sessões pendentes/)
    expect(text).not.toMatch(/own_initiative|as a card/)
    expect(text).toMatch(/agent, model and effort/)
    expect(text).not.toMatch(/Do the step/)
  })

  test('the loop step says one session per phase', () => {
    const atExecutar = walk(start(rapido), [
      ['planejar', 'pronto', 'session'],
      ['validar', 'passou', 'automatic'],
    ])
    expect(atExecutar.current).toBe('executar')
    expect(describeFlow(atExecutar)).toMatch(/one session per phase/)
    expect(describeFlow(atExecutar)).toMatch(/action "pending"/)
  })

  test('QA asking for changes goes back to the phases and forgets what came after', () => {
    const atQa = walk(start(rapido), [
      ['planejar', 'pronto', 'session'],
      ['validar', 'passou', 'automatic'],
      ['executar', 'concluidas', 'mod'],
      ['revisao-codigo', 'aprovado', 'session'],
      ['checagem', 'passou', 'automatic'],
      ['pr', 'aberto', 'session'],
    ])
    expect(atQa.current).toBe('qa')
    const back = ok(ownerPress(atQa, 'qa', 'ajustes', 30)).state
    expect(back.current).toBe('executar')
    expect(Object.keys(back.records)).toEqual(['planejar', 'validar'])
    expect(back.attempts.executar).toBe(2)
    expect(back.reopened).toEqual({ step: 'qa', outcome: 'ajustes', label: 'QA pediu ajustes', by: 'owner', at: 30 })
    expect(describeFlow(back)).toMatch(/Came back from "qa" \(QA pediu ajustes\)\.$/)
  })

  test('the last step ends the flow; nothing more is accepted', () => {
    const atArquivar = walk(start(rapido), [
      ['planejar', 'pronto', 'session'],
      ['validar', 'passou', 'automatic'],
      ['executar', 'concluidas', 'mod'],
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

describe('flow pending', () => {
  const atExecutar = (): FlowState =>
    walk(start(rapido), [
      ['planejar', 'pronto', 'session'],
      ['validar', 'passou', 'automatic'],
    ])
  const entry = (key: string, extra: Record<string, unknown> = {}) => ({ key, title: `Fase ${key}`, prompt: `faça a fase ${key}`, ...extra })

  test('registers the sessions on the loop, logs the keys without the prompt, and shows them in the view', () => {
    const before = atExecutar()
    const moved = ok(registerPending(before, [entry('1', { model: 'claude-opus-5-5', effort: 'high', use_worktree: true }), entry('2')], 50))
    expect(moved.state.pendingStarts).toEqual([
      { key: '1', step: 'executar', title: 'Fase 1', prompt: 'faça a fase 1', model: 'claude-opus-5-5', effort: 'high', use_worktree: true },
      { key: '2', step: 'executar', title: 'Fase 2', prompt: 'faça a fase 2' },
    ])
    expect(moved.state.seq).toBe(before.seq + 1)
    expect(moved.events).toEqual([{ seq: before.seq + 1, at: 50, kind: 'pending', step: 'executar', by: 'session', note: '1, 2' }])
    expect(JSON.stringify(moved.events)).not.toMatch(/faça a fase/)
    expect(flowView(moved.state).pendingStarts).toEqual([{ key: '1', title: 'Fase 1' }, { key: '2', title: 'Fase 2' }])
  })

  test('a repeated key replaces the entry before it', () => {
    const once = ok(registerPending(atExecutar(), [entry('1'), entry('2')], 50)).state
    const again = ok(registerPending(once, [entry('1', { prompt: 'outro prompt' })], 51)).state
    expect(again.pendingStarts?.map(p => [p.key, p.prompt])).toEqual([
      ['2', 'faça a fase 2'],
      ['1', 'outro prompt'],
    ])
  })

  test('a session step takes it too; an automatic or owner step, or a flow not running, refuses it', () => {
    expect(ok(registerPending(start(rapido), [entry('planejar')], 50)).state.pendingStarts?.[0]?.step).toBe('planejar')
    const atValidar = walk(start(rapido), [['planejar', 'pronto', 'session']])
    expect(err(registerPending(atValidar, [entry('1')], 50))).toMatch(/opens no session/)
    const atQa = walk(atExecutar(), [
      ['executar', 'concluidas', 'mod'],
      ['revisao-codigo', 'aprovado', 'session'],
      ['checagem', 'passou', 'automatic'],
      ['pr', 'aberto', 'session'],
    ])
    expect(err(registerPending(atQa, [entry('1')], 50))).toMatch(/opens no session/)
    expect(err(registerPending({ ...atExecutar(), status: 'aborted' }, [entry('1')], 50))).toMatch(/aborted/)
  })

  test('refuses past the limits: 6 entries, a title of 120 and a prompt of 20 000 characters', () => {
    const six = ['1', '2', '3', '4', '5', '6'].map(k => entry(k))
    const full = ok(registerPending(atExecutar(), six, 50)).state
    expect(err(registerPending(full, [entry('7')], 51))).toMatch(/at most 6/)
    expect(err(registerPending(atExecutar(), [...six, entry('7')], 51))).toMatch(/at most 6/)
    expect(err(registerPending(atExecutar(), [entry('1', { title: 'x'.repeat(121) })], 51))).toMatch(/at most 120/)
    expect(err(registerPending(atExecutar(), [entry('1', { prompt: 'x'.repeat(20_001) })], 51))).toMatch(/at most 20000/)
    expect(err(registerPending(atExecutar(), [], 51))).toMatch(/at least one/)
    expect(err(registerPending(atExecutar(), [{ key: '1', title: 'Fase 1' }], 51))).toMatch(/needs `key`, `title` and `prompt`/)
    expect(err(registerPending(atExecutar(), [entry('1', { wake_when_done: true })], 51))).toMatch(/unknown fields: wake_when_done/)
    expect(ok(registerPending(atExecutar(), [entry('1', { title: 'x'.repeat(120), prompt: 'x'.repeat(20_000) })], 51)).state.pendingStarts).toHaveLength(1)
  })

  test('a phase closed drops its entry; the others stay', () => {
    const kept = ok(registerPending(atExecutar(), [entry('1'), entry('2')], 50)).state
    const closed = closePhase(kept, { id: '1', title: 'Um', tasks: [], gates: undefined, session: undefined }, { session: undefined, archived: false }, 60)
    expect(closed.state.pendingStarts?.map(p => p.key)).toEqual(['2'])
  })

  test('leaving the step drops every entry of it', () => {
    const kept = ok(registerPending(atExecutar(), [entry('1')], 50)).state
    const left = walk(kept, [['executar', 'concluidas', 'mod']])
    expect(left.current).toBe('revisao-codigo')
    expect(left.pendingStarts).toBeUndefined()
    expect(flowView(left).pendingStarts).toEqual([])
    const atPlanejar = ok(registerPending(start(rapido), [entry('planejar')], 50)).state
    expect(walk(atPlanejar, [['planejar', 'pronto', 'session']]).pendingStarts).toBeUndefined()
  })

  test('dropPending takes the matching entries out, and the field goes once the list is empty', () => {
    const kept = ok(registerPending(atExecutar(), [entry('1'), entry('2')], 50)).state
    expect(dropPending(kept, p => p.title === 'Fase 1').pendingStarts?.map(p => p.key)).toEqual(['2'])
    expect('pendingStarts' in dropPending(kept, () => true)).toBe(false)
    expect(dropPending(kept, () => false)).toBe(kept)
  })
})
