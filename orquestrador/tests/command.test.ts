import { describe, expect, test } from 'claude-code/testing'

import type { FlowView } from '../types'
import { fromOwner, parseCommand, statusText } from '../hooks/command'
import { uiText } from '../hooks/i18n'

describe('parseCommand', () => {
  test('no argument toggles the panel, whatever the spaces', () => {
    expect(parseCommand('')).toEqual({ kind: 'toggle' })
    expect(parseCommand('   ')).toEqual({ kind: 'toggle' })
  })

  test('status, ajuda and abrir', () => {
    expect(parseCommand('status')).toEqual({ kind: 'status' })
    expect(parseCommand(' STATUS ')).toEqual({ kind: 'status' })
    expect(parseCommand('ajuda')).toEqual({ kind: 'help' })
    expect(parseCommand('abrir')).toEqual({ kind: 'open' })
  })

  test('aprovar takes the outcome and keeps the rest of the line as the note', () => {
    expect(parseCommand('aprovar fechado')).toEqual({ kind: 'approve', outcome: 'fechado' })
    expect(parseCommand('aprovar ajustar  falta o botão de salvar')).toEqual({
      kind: 'approve',
      outcome: 'ajustar',
      note: 'falta o botão de salvar',
    })
    expect(parseCommand('aprovar')).toEqual({ kind: 'unknown', word: 'aprovar' })
  })

  test('pular-portão, with or without the accent, asks for the phase and the gate; confirmar is the last word', () => {
    expect(parseCommand('pular-portão 2 testes')).toEqual({ kind: 'skip', phase: '2', gate: 'testes', confirmed: false })
    expect(parseCommand('pular-portao 2 testes confirmar')).toEqual({ kind: 'skip', phase: '2', gate: 'testes', confirmed: true })
    expect(parseCommand('pular-portão 2')).toEqual({ kind: 'unknown', word: 'pular-portão' })
    expect(parseCommand('pular-portão 2 testes lint')).toEqual({ kind: 'unknown', word: 'pular-portão' })
  })

  test('encerrar takes an optional reason; confirmar at the end confirms', () => {
    expect(parseCommand('encerrar')).toEqual({ kind: 'end', confirmed: false })
    expect(parseCommand('encerrar confirmar')).toEqual({ kind: 'end', confirmed: true })
    expect(parseCommand('encerrar mudou o escopo')).toEqual({ kind: 'end', reason: 'mudou o escopo', confirmed: false })
    expect(parseCommand('encerrar mudou o escopo confirmar')).toEqual({ kind: 'end', reason: 'mudou o escopo', confirmed: true })
  })

  test('there is no liberar: it is an unknown word, like any other', () => {
    expect(parseCommand('liberar')).toEqual({ kind: 'unknown', word: 'liberar' })
    expect(parseCommand('liberar liberado')).toEqual({ kind: 'unknown', word: 'liberar' })
    expect(parseCommand('qualquer')).toEqual({ kind: 'unknown', word: 'qualquer' })
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
