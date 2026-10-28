import { describe, expect, test } from 'claude-code/testing'

import type { FlowView } from '../types'
import { ACTIONS, fromOwner, parseAction, statusText } from '../hooks/command'
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

  test('approve takes the outcome and keeps the rest of the line as the note', () => {
    expect(parseAction('approve', 'fechado')).toEqual({ kind: 'approve', outcome: 'fechado' })
    expect(parseAction('approve', 'ajustar  falta o botão de salvar')).toEqual({
      kind: 'approve',
      outcome: 'ajustar',
      note: 'falta o botão de salvar',
    })
    expect(parseAction('approve', '')).toEqual({ kind: 'usage', action: 'approve' })
  })

  test('skip-gate asks for the phase and the gate; confirmar is the last word', () => {
    expect(parseAction('skip-gate', '2 testes')).toEqual({ kind: 'skip', phase: '2', gate: 'testes', confirmed: false })
    expect(parseAction('skip-gate', '2 testes confirmar')).toEqual({ kind: 'skip', phase: '2', gate: 'testes', confirmed: true })
    expect(parseAction('skip-gate', '2')).toEqual({ kind: 'usage', action: 'skip-gate' })
    expect(parseAction('skip-gate', '2 testes lint')).toEqual({ kind: 'usage', action: 'skip-gate' })
  })

  test('end takes an optional reason; confirmar at the end confirms', () => {
    expect(parseAction('end', '')).toEqual({ kind: 'end', confirmed: false })
    expect(parseAction('end', 'confirmar')).toEqual({ kind: 'end', confirmed: true })
    expect(parseAction('end', 'mudou o escopo')).toEqual({ kind: 'end', reason: 'mudou o escopo', confirmed: false })
    expect(parseAction('end', 'mudou o escopo confirmar')).toEqual({ kind: 'end', reason: 'mudou o escopo', confirmed: true })
  })

  test('reject keeps the whole line as the note, and there is one action per command file', () => {
    expect(parseAction('reject', '')).toEqual({ kind: 'reject' })
    expect(parseAction('reject', ' trocar skip-gate por skip ')).toEqual({ kind: 'reject', note: 'trocar skip-gate por skip' })
    expect([...ACTIONS]).toEqual(['status', 'approve', 'reject', 'open', 'skip-gate', 'end', 'panel', 'workflows', 'help'])
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
    change: 'demo',
    flowId: 'completo',
    flowTitle: 'Completo',
    status: 'running',
    current: { title: 'Grill' },
    ownerChoices: [{ outcome: 'fechado' }, { outcome: 'ajustar' }],
  } as unknown as FlowView
  const t = uiText('pt-BR').command

  test('short plain lines: no table, no heading, no bold', () => {
    const text = statusText({ flow, gates: ['2: testes'], pending: ['Fase 1', 'Fase 2'], permission: 'Permita get_session e list_sessions' }, t)
    expect(text.split('\n')).toEqual([
      'Flow de demo (Completo): running',
      'Passo: Grill',
      'Você responde com: fechado, ajustar',
      'Portões abertos: 2: testes',
      'Sessões pendentes: Fase 1, Fase 2',
      'Permita get_session e list_sessions',
    ])
    expect(text).not.toMatch(/[|#*]/)
  })

  test('without a flow it says to use the coordination session', () => {
    expect(statusText({ flow: undefined, gates: [], pending: [], permission: undefined }, t)).toMatch(/use na sessão da coordenação/)
  })
})
