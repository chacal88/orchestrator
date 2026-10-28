import { expect, test } from 'claude-code/testing'

import { parseFlow } from '../hooks/flow'
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
