import { describe, expect, test } from 'claude-code/testing'

import type { FlowDef, FlowState, FlowView } from '../types'
import { ACTIONS, fromOwner, gateList, parseAction, pickOutcome, statusText } from '../hooks/command'
import { startFlow } from '../hooks/flow'
import { defaultFlows } from '../hooks/flows/index'
import { uiText } from '../hooks/i18n'

describe('parseAction', () => {
  test('panel and workflows toggle their pane, whatever follows', () => {
    expect(parseAction('panel', '')).toEqual({ kind: 'toggle' })
    expect(parseAction('panel', '   ')).toEqual({ kind: 'toggle' })
    expect(parseAction('workflows', 'x')).toEqual({ kind: 'workflows' })
  })

  test('status, help and open take no words', () => {
    expect(parseAction('status', '')).toEqual({ kind: 'status' })
    expect(parseAction('status', ' qualquer ')).toEqual({ kind: 'status' })
    expect(parseAction('help', '')).toEqual({ kind: 'help' })
    expect(parseAction('open', '')).toEqual({ kind: 'open' })
  })

  test('approve and reject keep the whole line as the note; nothing after them is no note', () => {
    expect(parseAction('approve', '')).toEqual({ kind: 'approve' })
    expect(parseAction('approve', ' falta o botão de salvar ')).toEqual({ kind: 'approve', note: 'falta o botão de salvar' })
    // the old outcome word is a note now, never a choice
    expect(parseAction('approve', 'fechado')).toEqual({ kind: 'approve', note: 'fechado' })
    expect(parseAction('reject', '')).toEqual({ kind: 'reject' })
    expect(parseAction('reject', ' trocar skip-gate por skip ')).toEqual({ kind: 'reject', note: 'trocar skip-gate por skip' })
  })

  test('skip-gate takes only a positive number; anything else is the list', () => {
    expect(parseAction('skip-gate', '')).toEqual({ kind: 'skip' })
    expect(parseAction('skip-gate', ' 2 ')).toEqual({ kind: 'skip', n: 2 })
    for (const args of ['x', '0', '-1', '2.5', '2 testes', '2 testes confirmar']) expect(parseAction('skip-gate', args)).toEqual({ kind: 'skip' })
  })

  test('end takes an optional reason and nothing more: confirmar is a word of the reason like any other', () => {
    expect(parseAction('end', '')).toEqual({ kind: 'end' })
    expect(parseAction('end', 'mudou o escopo')).toEqual({ kind: 'end', reason: 'mudou o escopo' })
    expect(parseAction('end', 'confirmar')).toEqual({ kind: 'end', reason: 'confirmar' })
  })

  test('there is one action per command file', () => {
    expect([...ACTIONS]).toEqual(['status', 'approve', 'reject', 'open', 'skip-gate', 'end', 'panel', 'workflows', 'help'])
  })
})

describe('pickOutcome', () => {
  const flows = Object.fromEntries(defaultFlows().map(f => [f.id, f])) as Record<string, FlowDef>
  const at = (flow: FlowDef, current: string, extra: Partial<FlowState> = {}): FlowState => ({
    ...startFlow(flow, { change: 'demo', coordinatorCwd: '/w', visual: true }, 1).state,
    current,
    ...extra,
  })
  const pick = (state: FlowState) => [pickOutcome(state, 'forward'), pickOutcome(state, 'adjust')]

  test("completo: the owner's five steps, as the design's table", () => {
    const completo = flows.completo!
    expect(pick(at(completo, 'grill'))).toEqual([{ outcome: 'fechado' }, { none: true }])
    expect(pick(at(completo, 'mockup'))).toEqual([{ outcome: 'aprovado' }, { outcome: 'ajustes' }])
    expect(pick(at(completo, 'liberacao'))).toEqual([{ outcome: 'liberado' }, { outcome: 'ajustes' }])
    expect(pick(at(completo, 'qa'))).toEqual([{ outcome: 'aprovado' }, { outcome: 'ajustes' }])
    expect(pick(at(completo, 'producao'))).toEqual([{ outcome: 'publicado' }, { none: true }])
  })

  test("rapido: the owner's steps", () => {
    const rapido = flows.rapido!
    const owner = rapido.steps.filter(s => s.kind === 'owner').map(s => s.id)
    expect(owner).toEqual(['qa', 'producao'])
    expect(pick(at(rapido, 'qa'))).toEqual([{ outcome: 'aprovado' }, { outcome: 'ajustes' }])
    expect(pick(at(rapido, 'producao'))).toEqual([{ outcome: 'publicado' }, { none: true }])
  })

  test('a project flow with two outcomes forward takes the first declared, and one back to an earlier step is the adjustment', () => {
    const flow: FlowDef = {
      id: 'proj',
      title: 'Projeto',
      description: '',
      steps: [
        { ...flows.completo!.steps[0]!, id: 'a', outcomes: { x: { label: 'X', next: 'b' } } },
        {
          ...flows.completo!.steps[0]!,
          id: 'b',
          outcomes: {
            voltar: { label: 'Voltar', next: 'a' },
            publicar: { label: 'Publicar', next: 'c' },
            fechar: { label: 'Fechar', next: 'fim' },
          },
        },
        { ...flows.completo!.steps[0]!, id: 'c', outcomes: { y: { label: 'Y', next: '$seguinte' } } },
      ],
    }
    expect(pick(at(flow, 'b'))).toEqual([{ outcome: 'publicar' }, { outcome: 'voltar' }])
    // $seguinte and the end are forward too
    expect(pick(at(flow, 'c'))).toEqual([{ outcome: 'y' }, { none: true }])
  })

  test('a step without adjustments is none; an outcome to an unknown step counts for neither', () => {
    const flow: FlowDef = {
      id: 'proj',
      title: 'Projeto',
      description: '',
      steps: [{ ...flows.completo!.steps[0]!, id: 'a', outcomes: { perdido: { label: 'Perdido', next: 'nenhum' } } }],
    }
    expect(pick(at(flow, 'a'))).toEqual([{ none: true }, { none: true }])
    expect(pick(at(flows.completo!, 'grill'))[1]).toEqual({ none: true })
  })

  test('an escalation goes forward by trying again and has no adjustments', () => {
    const escalated = at(flows.completo!, 'mockup', { status: 'escalated', escalation: { step: 'mockup', from: 'mockup', outcome: 'ajustes', attempts: 3 } })
    expect(pick(escalated)).toEqual([{ outcome: 'tentar-de-novo' }, { none: true }])
  })
})

describe('fromOwner', () => {
  const OWNER = ['composer', 'bridge']
  const OTHERS = [
    'sdk',
    'task-notification',
    'scheduled-trigger',
    'peer',
    'peer-send-message',
    'projects-relay',
    'channel',
    'coordinator',
    'observer',
    'observer-activity',
    'auto-continuation',
    'unclassified',
    'slack-ping',
    'plugin',
  ]

  for (const kind of OWNER) {
    test(`${kind} is the owner typing`, () => {
      expect(fromOwner({ kind })).toBe(true)
    })
  }

  for (const kind of OTHERS) {
    test(`${kind} is not`, () => {
      expect(fromOwner({ kind })).toBe(false)
    })
  }
})

describe('statusText', () => {
  const flow = {
    change: 'orchestrator-commands',
    flowId: 'completo',
    flowTitle: 'Completo',
    status: 'running',
    current: { title: 'Mockup' },
    waitingOn: 'owner',
    ownerChoices: [{ outcome: 'aprovado' }, { outcome: 'ajustes' }],
  } as unknown as FlowView
  const t = uiText('pt-BR').command

  test("the mockup's answer: the flow, the step and both commands spelled out whole", () => {
    expect(statusText({ flow, canAdjust: true, gates: [], pending: [], permission: undefined }, t)).toBe(
      'Flow de orchestrator-commands (Completo): em andamento\n' +
        'Passo: Mockup (você)\n' +
        'Para seguir: /orchestrator:approve\n' +
        'Para pedir ajustes: /orchestrator:reject <o que mudar>',
    )
  })

  test('short plain lines: no table, no heading, no bold; the reject line only when the step has adjustments', () => {
    const text = statusText(
      { flow, canAdjust: false, gates: [{ phase: '2', gate: 'testes' }, { phase: 'final', gate: 'check' }], pending: ['Fase 1', 'Fase 2'], permission: 'Permita get_session e list_sessions' },
      t,
    )
    expect(text.split('\n')).toEqual([
      'Flow de orchestrator-commands (Completo): em andamento',
      'Passo: Mockup (você)',
      'Para seguir: /orchestrator:approve',
      'Portões abertos: fase 2: testes, final: check',
      'Sessões pendentes: Fase 1, Fase 2',
      'Permita get_session e list_sessions',
    ])
    expect(text).not.toMatch(/[|#*]|```/)
  })

  test("a step that is not the owner's names who answers it and offers no command", () => {
    const session = { ...flow, current: { title: 'Planejar' }, waitingOn: 'session', ownerChoices: [] } as unknown as FlowView
    expect(statusText({ flow: session, canAdjust: false, gates: [], pending: [], permission: undefined }, t).split('\n')).toEqual([
      'Flow de orchestrator-commands (Completo): em andamento',
      'Passo: Planejar (a sessão da coordenação)',
    ])
  })

  test('an escalation offers trying again and ending, never adjustments', () => {
    const escalated = { ...flow, status: 'escalated', ownerChoices: [{ outcome: 'tentar-de-novo' }, { outcome: 'encerrar' }] } as unknown as FlowView
    expect(statusText({ flow: escalated, canAdjust: true, gates: [], pending: [], permission: undefined }, t).split('\n')).toEqual([
      'Flow de orchestrator-commands (Completo): parado no limite de tentativas',
      'Passo: Mockup (você)',
      'Para tentar de novo: /orchestrator:approve',
      'Para encerrar: /orchestrator:end [motivo]',
    ])
  })

  test('without a flow it says to use the coordination session', () => {
    expect(statusText({ flow: undefined, canAdjust: false, gates: [], pending: [], permission: undefined }, t)).toMatch(/use na sessão da coordenação/)
  })
})

describe('gateList', () => {
  const t = uiText('pt-BR').command
  test("numbered, phases first, with how to skip one, as the mockup", () => {
    expect(gateList([{ phase: '2', gate: 'testes' }, { phase: 'final', gate: 'check' }], t)).toBe(
      'Portões abertos:\n1. fase 2: testes\n2. final: check\nPara pular: /orchestrator:skip-gate 2',
    )
    expect(gateList([], t)).toBe('Nenhum portão aberto.')
  })
})
