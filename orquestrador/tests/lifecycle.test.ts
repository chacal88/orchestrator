import { describe, expect, test } from 'claude-code/testing'

import type { FlowDef, FlowState, GateView, OrchestrationRun, SessionRow } from '../types'
import { applyOutcome, describeFlow, detectedOutcome, noteOwnerStep, ownerPress, parseFlow, startFlow } from '../hooks/flow'
import { defaultFlows } from '../hooks/flows/index'
import {
  closePhase,
  finishLoop,
  isClosed,
  loopUnits,
  phaseSessions,
  uncommitted,
  unitRefusal,
  withEvents,
} from '../hooks/lifecycle'

const flows = Object.fromEntries(defaultFlows().map(f => [f.id, f])) as Record<string, FlowDef>
const rapido = flows.rapido!

const ok = <T,>(r: T | { error: string }): T => {
  if (typeof r === 'object' && r !== null && 'error' in r) throw new Error((r as { error: string }).error)
  return r as T
}
const err = (r: unknown): string => (r as { error?: string }).error ?? ''

const TASKS = [
  '## 1. Base',
  '',
  '- [x] 1.1 Modelo',
  '- [ ] 1.2 Rotas',
  '',
  '## 2. Tela',
  '',
  '- [x] 2.1 Lista',
  '',
].join('\n')

const atExecutar = (): FlowState => {
  const s = startFlow(rapido, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1).state
  const planned = ok(applyOutcome(s, { step: 'planejar', outcome: 'pronto', by: 'session' }, 2)).state
  return ok(applyOutcome(planned, { step: 'validar', outcome: 'passou', by: 'automatic' }, 3)).state
}

const run = (phases: OrchestrationRun['waves'][number]['phases']): OrchestrationRun => ({
  change: 'demo',
  changePath: undefined,
  coordinatorCwd: '/w',
  jira: undefined,
  jiraSite: undefined,
  waves: [{ title: undefined, summary: undefined, jira: undefined, phases }],
  ownerQuestions: [],
  finalGates: undefined,
  updatedAt: 0,
})

const phase = (id: string, tasks: string, gates?: string[]) => ({
  id, title: `Fase ${id}`, status: 'running' as const, icon: undefined, tasks, session: undefined,
  dependsOn: undefined, note: undefined, summary: undefined, jira: undefined, gates,
})

describe('the phases of the loop', () => {
  test('without a plan, each numbered section of tasks.md is a phase', () => {
    const units = loopUnits(undefined, TASKS)
    expect(units.map(u => [u.id, u.title, u.tasks.map(t => t.id)])).toEqual([
      ['1', 'Base', ['1.1', '1.2']],
      ['2', 'Tela', ['2.1']],
    ])
  })

  test("with a plan, the plan's phases carry their tasks and gates", () => {
    const units = loopUnits(run([phase('A', '1.1–1.2', ['testes']), phase('B', '2.x')]), TASKS)
    expect(units.map(u => [u.id, u.tasks.map(t => t.id), u.gates])).toEqual([
      ['A', ['1.1', '1.2'], ['testes']],
      ['B', ['2.1'], undefined],
    ])
  })

  test('a phase with unticked tasks or open gates cannot close, and says why', () => {
    const [base, tela] = loopUnits(undefined, TASKS)
    const open: GateView = { gate: 'testes', label: 'testes', state: 'pending', evidence: undefined, at: undefined, skipKey: '1:testes' }
    expect(unitRefusal(base!, [], 'this session')).toBe('phase 1 (Base) cannot close: tasks 1.2 are not ticked in tasks.md.')
    expect(unitRefusal(tela!, [open], 'session "x"')).toMatch(/^phase 2 \(Tela\) cannot close: testes not run — needs a test command/)
    expect(unitRefusal(tela!, [], 'this session')).toBeUndefined()
  })
})

describe('closing phases and ending the loop', () => {
  test('the loop ends by the mod only once every phase is closed', () => {
    const units = loopUnits(undefined, TASKS.replace('- [ ] 1.2', '- [x] 1.2'))
    const state = atExecutar()
    const one = closePhase(state, units[0]!, { session: 'fase-a', archived: true }, 10)
    expect(one.events.map(e => [e.kind, e.by, e.note])).toEqual([
      ['phase-closed', 'mod', '1 Base'],
      ['session-archived', 'mod', '1: fase-a'],
    ])
    expect(one.state.closed?.['1']).toEqual({ at: 10, tasks: ['1.1', '1.2'], session: 'fase-a', archived: true })
    const still = finishLoop(one.state, units, 11)
    expect('open' in still && still.open.map(u => u.id)).toEqual(['2'])

    const two = closePhase(one.state, units[1]!, { session: undefined, archived: false }, 12)
    const done = ok(finishLoop(two.state, units, 13) as ReturnType<typeof applyOutcome>)
    expect(done.state.current).toBe('revisao-codigo')
    expect(done.state.records.executar).toEqual({ outcome: 'concluidas', by: 'mod', at: 13, note: '2 phase(s) closed' })
  })

  test('a task added to a closed phase reopens it', () => {
    const units = loopUnits(undefined, '## 2. Tela\n- [x] 2.1 Lista\n')
    const closed = closePhase(atExecutar(), units[0]!, { session: undefined, archived: false }, 10).state
    expect(isClosed(closed, units[0]!)).toBe(true)
    const grown = loopUnits(undefined, '## 2. Tela\n- [x] 2.1 Lista\n- [ ] 2.2 Ajuste do QA\n')
    expect(isClosed(closed, grown[0]!)).toBe(false)
  })

  test('nothing closes off the loop step, nor with no phase at all', () => {
    const planning = startFlow(rapido, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1).state
    expect(err(finishLoop(planning, loopUnits(undefined, TASKS), 2))).toMatch(/is on "planejar".*not on the phase loop/)
    expect(err(finishLoop(atExecutar(), [], 2))).toMatch(/no plan phases and no numbered tasks/)
  })
})

describe('after the PR', () => {
  const atQa = (): FlowState => {
    let s = ok(applyOutcome(atExecutar(), { step: 'executar', outcome: 'concluidas', by: 'mod' }, 4)).state
    s = ok(applyOutcome(s, { step: 'revisao-codigo', outcome: 'aprovado', by: 'session' }, 5)).state
    s = ok(applyOutcome(s, { step: 'checagem', outcome: 'passou', by: 'automatic' }, 6)).state
    return ok(applyOutcome(s, { step: 'pr', outcome: 'aberto', by: 'session' }, 7)).state
  }

  test("QA's request, noted by a session, joins the owner's press and stays while the phases run again", () => {
    const qa = atQa()
    expect(err(noteOwnerStep(atExecutar(), 'x', 8))).toMatch(/not the owner's/)
    const noted = ok(noteOwnerStep(qa, 'QA: o filtro não salva', 8))
    expect(noted.events.map(e => [e.kind, e.by])).toEqual([['noted', 'session']])
    const back = ok(ownerPress(noted.state, 'qa', 'ajustes', 9)).state
    expect(back.current).toBe('executar')
    expect(back.pendingNote).toBeUndefined()
    expect(back.reopened?.note).toBe('QA: o filtro não salva')
    expect(describeFlow(back)).toMatch(/Came back from "qa" \(QA pediu ajustes\): QA: o filtro não salva\./)
    const again = ok(applyOutcome(back, { step: 'executar', outcome: 'concluidas', by: 'mod' }, 10)).state
    expect(again.reopened?.step).toBe('qa')
  })

  test('producao is answered by the owner or by the deploy the mod sees, and the log tells which', () => {
    const qa = atQa()
    const prod = ok(ownerPress(qa, 'qa', 'aprovado', 8)).state
    expect(prod.current).toBe('producao')
    expect(describeFlow(prod)).toMatch(/also answers publicado when it sees `npm run deploy`/)
    const step = rapido.steps.find(s => s.id === 'producao')!
    expect(detectedOutcome(step, 'npm run deploy', false)).toBe('publicado')
    expect(detectedOutcome(step, 'cd app && npx vercel --prod', false)).toBe('publicado')
    expect(detectedOutcome(step, 'npm run deploy', true)).toBeUndefined()
    expect(detectedOutcome(step, 'npm run deploy | tee log', false)).toBeUndefined()
    expect(detectedOutcome(step, 'echo "npm run deploy"', false)).toBeUndefined()
    expect(detectedOutcome(rapido.steps.find(s => s.id === 'qa')!, 'npm run deploy', false)).toBeUndefined()

    const seen = ok(applyOutcome(prod, { step: 'producao', outcome: 'publicado', by: 'detect', note: 'comando: npm run deploy' }, 9))
    expect(seen.state.current).toBe('arquivar')
    expect(seen.events[0]).toMatchObject({ kind: 'outcome', by: 'detect', outcome: 'publicado' })
    expect(err(applyOutcome(qa, { step: 'qa', outcome: 'aprovado', by: 'detect' }, 9))).toMatch(/only the owner/)
    expect(err(applyOutcome(prod, { step: 'producao', outcome: 'publicado', by: 'session' }, 9))).toMatch(/only the owner/)
  })

  test('a detect field is checked when the flow file is read', () => {
    const flow = (detect: unknown) =>
      parseFlow(
        { id: 'f', title: 'F', steps: [{ id: 'p', title: 'P', kind: 'owner', detect, outcomes: { a: 'fim', b: 'fim' } }] },
        'f.json',
      )
    expect(err(flow('fly deploy'))).toMatch(/`detect.outcome` must name one of the step's outcomes \(a, b\)/)
    expect(err(flow({ commands: [] }))).toMatch(/needs at least one command/)
    expect((ok(flow({ commands: 'fly deploy', outcome: 'b' })) as FlowDef).steps[0]!.detect).toEqual({ commands: ['fly deploy'], outcome: 'b' })
    expect(err(parseFlow({ id: 'f', title: 'F', steps: [{ id: 'l', title: 'L', kind: 'loop', outcomes: { feito: 'fim' } }] }, 'f.json'))).toMatch(
      /a loop step declares the outcome concluidas/,
    )
    expect(rapido.steps.find(s => s.id === 'arquivar')?.cleanup).toBe(true)
  })
})

describe('cleanup helpers', () => {
  const row = (sessionId: string, startedBy?: string, isArchived = false): SessionRow => ({
    sessionId, title: sessionId, cwd: `/w/${sessionId}`, branch: undefined, isRunning: false, isArchived,
    prNumber: undefined, prState: undefined, lastActivityAt: undefined, name: undefined, startedBy, link: undefined,
    groupId: 'g', groupName: undefined,
  })

  test("the phase sessions are the group's sessions started by another member, never this one nor a side chat", () => {
    const side = { ...row('side', 'coord'), cwd: '/w' }
    const rows = [row('coord'), row('a', 'coord'), row('b', 'coord', true), row('c', 'elsewhere'), row('d', 'a'), side]
    expect(phaseSessions(rows, 'coord', '/w').map(r => r.sessionId)).toEqual(['a', 'd'])
    expect(phaseSessions(rows, 'a', '/w').map(r => r.sessionId)).toEqual(['d'])
  })

  test('git status --porcelain lists the uncommitted paths', () => {
    expect(uncommitted(' M hooks/a.ts\n?? new.ts\n')).toEqual(['hooks/a.ts', 'new.ts'])
    expect(uncommitted('')).toEqual([])
  })

  test('cleanup events go before the closing done event, renumbered', () => {
    const moved = { state: { seq: 7 } as FlowState, events: [
      { seq: 6, at: 1, kind: 'outcome' as const, step: 'arquivar', by: 'automatic' as const },
      { seq: 7, at: 1, kind: 'done' as const, step: 'fim', by: 'mod' as const },
    ] }
    const out = withEvents(moved, [{ at: 1, kind: 'cleanup', step: 'arquivar', by: 'mod', note: 'x' }])
    expect(out.events.map(e => [e.seq, e.kind])).toEqual([[6, 'outcome'], [7, 'cleanup'], [8, 'done']])
    expect(out.state.seq).toBe(8)
  })
})
