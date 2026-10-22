import { describe, expect, test } from 'claude-code/testing'

import type { FlowDef, FlowStep } from '../types'
import { automaticOutcome, resolveProjectFlows } from '../hooks/flow'
import { DEFAULT_FLOWS } from '../hooks/flows/index'
import { parseConfig } from '../hooks/i18n'

/** The config.json the instalar skill shows as its example. */
const CONFIG = {
  language: { ui: 'pt-BR', content: 'pt-BR' },
  merge: { auto: true, branch: 'main', method: 'squash' },
  deploy: { auto: true, ci: true, commands: [] },
}

const gate = (id: string, title: string, command: string) => ({
  id,
  title,
  kind: 'automatic',
  command,
  description: `O mod vê o \`${command}\` passar; o código de saída decide.`,
  outcomes: { passou: { label: 'Passou', next: '$seguinte' }, falhou: { label: 'Falhou', next: 'executar' } },
})

/** The flow the instalar skill shows as its example: a Node project without OpenSpec. */
const RAPIDO = {
  id: 'rapido',
  title: 'Rápido (projeto)',
  base: 'rapido',
  remove: ['validar', 'arquivar'],
  add: [
    { after: 'revisao-codigo', step: gate('lint', 'Lint', 'npm run lint') },
    { after: 'lint', step: gate('tipos', 'Tipos', 'npm run typecheck') },
    { after: 'pr', step: { use: 'merge', agent: 'merge-pelo-workflow' } },
    { after: 'merge', step: { use: 'deploy' } },
  ],
  override: {
    checagem: { command: 'npm test', description: 'O mod vê o `npm test` passar, com o evidence.md preenchido.' },
  },
}

const load = (raw: unknown, config: unknown = CONFIG): FlowDef => {
  const read = parseConfig(JSON.stringify(config))
  expect(read.problems).toEqual([])
  // a fresh copy, as from the file: resolving writes the placed `$seguinte` into the step it was given
  const file = JSON.parse(JSON.stringify(raw)) as unknown
  const { flows, problems } = resolveProjectFlows(DEFAULT_FLOWS, [{ source: '.orquestrador/flows/x.json', raw: file }], read.project)
  expect(problems).toEqual([])
  return flows[0]!
}
const step = (flow: FlowDef, id: string): FlowStep => flow.steps.find(s => s.id === id)!

describe('instalar: the files the skill writes load in the mod', () => {
  test('the rapido example resolves with the gates as automatic steps, merge and deploy from config.json', () => {
    const flow = load(RAPIDO)
    expect(flow.steps.map(s => s.id)).toEqual(['planejar', 'executar', 'revisao-codigo', 'lint', 'tipos', 'checagem', 'pr', 'merge', 'deploy', 'qa', 'producao'])
    expect(step(flow, 'planejar').outcomes.pronto?.next).toBe('executar')
    expect(step(flow, 'lint').outcomes.passou?.next).toBe('tipos')
    expect(step(flow, 'tipos').outcomes.falhou?.next).toBe('executar')
    expect(step(flow, 'checagem').command).toBe('npm test')
    const merge = step(flow, 'merge')
    expect([merge.kind, merge.agent, merge.merge?.branch, merge.merge?.method]).toEqual(['automatic', 'merge-pelo-workflow', 'main', 'squash'])
    expect([step(flow, 'deploy').kind, step(flow, 'deploy').deploy?.ci]).toEqual(['automatic', true])
  })

  test('a gate step counts its command run alone, never one whose exit code a pipe hides', () => {
    const lint = step(load(RAPIDO), 'lint')
    expect(automaticOutcome(lint, 'npm run lint', false)).toBe('passou')
    expect(automaticOutcome(lint, 'npm run lint', true)).toBe('falhou')
    expect(automaticOutcome(lint, 'npm run lint | tail -5', false)).toBeUndefined()
  })

  test('with the merge agent, revisao-pr goes before the merge and the merge stays the owner\'s without auto', () => {
    const flow = load(
      {
        id: 'completo',
        title: 'Completo (projeto)',
        base: 'completo',
        add: [
          { after: 'pr', step: 'revisao-pr' },
          { after: 'revisao-pr', step: { use: 'merge', agent: 'merge' } },
        ],
      },
      { language: 'en', merge: { auto: false, branch: 'develop', method: 'rebase' } },
    )
    const at = (id: string) => flow.steps.findIndex(s => s.id === id)
    expect([at('pr') < at('revisao-pr'), at('revisao-pr') < at('merge')]).toEqual([true, true])
    const merge = step(flow, 'merge')
    expect([merge.kind, merge.agent, merge.merge?.branch]).toEqual(['owner', 'merge', 'develop'])
  })
})
