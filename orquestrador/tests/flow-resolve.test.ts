import { describe, expect, test } from 'claude-code/testing'

import type { FlowDef, FlowStep } from '../types'
import { parseFlow, resolveFlow, resolveProjectFlows } from '../hooks/flow'
import type { FlowSource } from '../hooks/flow'
import { DEFAULT_FLOWS, defaultFlows } from '../hooks/flows/index'
import { LIBRARY } from '../hooks/flows/library'

const ok = <T,>(r: T | { error: string }): T => {
  if (typeof r === 'object' && r !== null && 'error' in r) throw new Error((r as { error: string }).error)
  return r as T
}

/** The refusal's text, empty when the call was accepted. */
const err = (r: unknown): string => (r as { error?: string }).error ?? ''

const defaults = Object.fromEntries(DEFAULT_FLOWS.map(f => [(f.raw as { id: string }).id, f])) as Record<string, FlowSource>
const parsed = Object.fromEntries(defaultFlows().map(f => [f.id, f])) as Record<string, FlowDef>

/** Resolves one project file against the defaults and the given other project files. */
const resolve = (raw: Record<string, unknown>, others: Record<string, Record<string, unknown>> = {}) =>
  resolveFlow(raw, 'p.json', (id, from) => (id === from ? undefined : others[id] && { source: `${id}.json`, raw: others[id] }) ?? defaults[id])

const at = (flow: FlowDef, id: string): FlowStep => {
  const step = flow.steps.find(s => s.id === id)
  if (step === undefined) throw new Error(`no step ${id}`)
  return step
}

/** Where each step's outcomes lead, as `step.outcome→next`. */
const wiring = (flow: FlowDef): string[] =>
  flow.steps.flatMap(s => Object.entries(s.outcomes).map(([name, o]) => `${s.id}.${name}→${o.next}`))

describe('parseFlow: describing a step', () => {
  const step = (over: Record<string, unknown>) => ({ id: 'a', title: 'A', kind: 'session', outcomes: { ok: 'fim' }, ...over })
  const parse = (s: Record<string, unknown>) => parseFlow({ id: 'x', title: 'X', steps: [s] }, 'x.json')

  test('details, agent, model and effort are kept', () => {
    const flow = ok(parse(step({ details: { inputs: 'O diff', blocks: 'Rejeitado volta' }, agent: 'revisor-codigo', model: 'claude-opus-5-5', effort: 'high' })))
    expect(flow.steps[0]).toMatchObject({
      details: { inputs: 'O diff', blocks: 'Rejeitado volta' },
      agent: 'revisor-codigo',
      model: 'claude-opus-5-5',
      effort: 'high',
    })
  })

  test('an agent goes only on a session or loop step, or one that merges or deploys', () => {
    expect(err(parse(step({ kind: 'owner', agent: 'x' })))).toBe(
      'x.json: step "a": `agent` goes only on a session or loop step, or on a merge or deploy step.',
    )
    expect(err(parse(step({ kind: 'automatic', command: 'c', outcomes: { passou: 'fim', falhou: 'a' }, agent: 'x' })))).toMatch(/only on a session/)
    expect(err(parse(step({ kind: 'loop', outcomes: { concluidas: 'fim' }, agent: 'publicador' })))).toBe('')
    expect(err(parse(step({ kind: 'owner', agent: 'merge', merge: { branch: 'main' } })))).toBe('')
  })

  test('wrong shapes are refused', () => {
    expect(err(parse(step({ details: 'x' })))).toMatch(/`details` is an object/)
    expect(err(parse(step({ details: { why: 'x' } })))).toMatch(/not why/)
    expect(err(parse(step({ details: { inputs: 3 } })))).toMatch(/`details.inputs` must be text/)
    expect(err(parse(step({ model: '' })))).toMatch(/`model` must be a name/)
    expect(err(parse(step({ effort: 'huge' })))).toMatch(/`effort` must be one of low, medium, high, xhigh, max/)
  })

  test('merge: a branch, squash unless said, and auto decides the kind', () => {
    const owner = ok(parse(step({ kind: 'owner', merge: { branch: 'dev' } })))
    expect(owner.steps[0]?.merge).toEqual({ branch: 'dev', method: 'squash', auto: false })
    const auto = ok(parse(step({ kind: 'automatic', command: 'gh pr merge', outcomes: { passou: 'fim', falhou: 'a' }, merge: { branch: 'main', method: 'rebase', auto: true } })))
    expect(auto.steps[0]?.merge).toEqual({ branch: 'main', method: 'rebase', auto: true })
    expect(err(parse(step({ kind: 'owner', merge: {} })))).toMatch(/`merge.branch`/)
    expect(err(parse(step({ kind: 'owner', merge: { branch: 'm', method: 'ff' } })))).toMatch(/`merge.method` must be one of squash, merge, rebase/)
    expect(err(parse(step({ kind: 'owner', merge: { branch: 'm', auto: 'yes' } })))).toMatch(/`merge.auto` must be true or false/)
    expect(err(parse(step({ kind: 'owner', merge: { branch: 'm', auto: true } })))).toBe(
      'x.json: step "a": a merge step with `auto: true` is automatic, not owner.',
    )
    expect(err(parse(step({ kind: 'session', merge: { branch: 'm' } })))).toMatch(/is an owner step, not session/)
  })

  test('deploy: the CI, routines or both', () => {
    const both = ok(parse(step({ kind: 'owner', deploy: { ci: true, commands: 'npm run migrate:prod' } })))
    expect(both.steps[0]?.deploy).toEqual({ ci: true, commands: ['npm run migrate:prod'], auto: false })
    expect(err(parse(step({ kind: 'owner', deploy: {} })))).toMatch(/needs `ci: true`, `commands`, or both/)
    expect(err(parse(step({ kind: 'owner', deploy: { commands: [3] } })))).toMatch(/list of commands/)
    expect(err(parse(step({ kind: 'owner', deploy: { ci: true }, merge: { branch: 'm' } })))).toMatch(/merges or deploys, not both/)
  })
})

describe('the default flows describe their steps', () => {
  test('every step has details; every session step names its agent', () => {
    for (const flow of Object.values(parsed)) {
      expect(flow.steps.filter(s => s.details?.inputs === undefined || s.details.produces === undefined || s.details.blocks === undefined)).toEqual([])
      expect(flow.steps.filter(s => s.kind === 'session' && s.agent === undefined)).toEqual([])
    }
    expect(Object.fromEntries(parsed.completo!.steps.filter(s => s.agent).map(s => [s.id, s.agent]))).toEqual({
      planejar: 'planejador',
      'revisao-plano': 'revisor-plano',
      executar: 'executor',
      'revisao-codigo': 'revisor-codigo',
      pr: 'abre-pr',
    })
  })
})

describe('resolveFlow', () => {
  test('a flow with steps is parsed as always', () => {
    const own = { id: 'meu', title: 'Meu', steps: [{ id: 'a', title: 'A', kind: 'session', outcomes: { ok: 'fim' } }] }
    expect(ok(resolve(own)).steps.map(s => s.id)).toEqual(['a'])
    expect(ok(resolve(own)).base).toBeUndefined()
  })

  test('the trunk-based flow of the design', () => {
    const trunk = ok(
      resolve({
        id: 'trunk',
        title: 'Trunk-based',
        base: 'completo',
        remove: ['mockup', 'qa'],
        add: [
          { after: 'pr', step: 'revisao-pr' },
          { after: 'revisao-pr', step: { use: 'merge', merge: { branch: 'main', auto: true } } },
          { after: 'merge', step: { use: 'deploy', deploy: { ci: true, commands: ['npm run migrate:prod'], auto: true } } },
        ],
        override: { 'revisao-codigo': { model: 'claude-sonnet-5-5' } },
      }),
    )
    expect(trunk.base).toBe('completo')
    expect(trunk.description).toBe(parsed.completo!.description)
    expect(trunk.steps.map(s => s.id)).toEqual([
      'grill', 'planejar', 'validar', 'revisao-plano', 'liberacao', 'executar', 'revisao-codigo',
      'checagem', 'pr', 'revisao-pr', 'merge', 'deploy', 'producao', 'arquivar',
    ])
    expect(wiring(trunk)).toContain('grill.fechado→planejar')
    expect(wiring(trunk)).toContain('pr.aberto→revisao-pr')
    expect(wiring(trunk)).toContain('revisao-pr.aprovado→merge')
    expect(wiring(trunk)).toContain('merge.passou→deploy')
    expect(wiring(trunk)).toContain('merge.falhou→merge')
    expect(wiring(trunk)).toContain('deploy.passou→producao')
    expect(at(trunk, 'merge')).toMatchObject({ kind: 'automatic', command: 'gh pr merge', agent: 'merge', title: 'Merge em main', merge: { branch: 'main', method: 'squash', auto: true } })
    expect(at(trunk, 'deploy')).toMatchObject({ kind: 'automatic', agent: 'deploy', deploy: { ci: true, commands: ['npm run migrate:prod'], auto: true } })
    expect(at(trunk, 'revisao-codigo')).toMatchObject({ model: 'claude-sonnet-5-5', agent: 'revisor-codigo', effort: 'high' })
  })

  test('remove rewires through a chain of removed steps', () => {
    const flow = ok(resolve({ id: 'x', title: 'X', base: 'completo', remove: ['qa', 'producao'] }))
    expect(wiring(flow)).toContain('pr.aberto→arquivar')
    expect(wiring(flow).some(w => /→(qa|producao)$/.test(w))).toBe(false)
  })

  test('a manual merge is the owner\'s, seen through gh pr merge', () => {
    const flow = ok(resolve({ id: 'x', title: 'X', base: 'rapido', add: [{ after: 'qa', step: { use: 'merge', id: 'merge-dev', merge: { branch: 'dev' } } }] }))
    expect(at(flow, 'merge-dev')).toMatchObject({
      kind: 'owner',
      title: 'Merge em dev',
      detect: { commands: ['gh pr merge'], outcome: 'feito' },
      outcomes: { feito: { label: 'Merge feito', next: 'producao' } },
    })
    expect(wiring(flow)).toContain('qa.aprovado→merge-dev')
    expect(wiring(flow)).toContain('qa.ajustes→executar')
  })

  test('a whole new step with no outcomes gets the forward one of its kind', () => {
    const flow = ok(resolve({ id: 'x', title: 'X', base: 'rapido', add: [{ after: 'checagem', step: { id: 'lint', title: 'Lint', kind: 'automatic', command: 'npm run lint' } }] }))
    expect(at(flow, 'lint').outcomes).toEqual({ passou: { label: 'Passou', next: 'pr' }, falhou: { label: 'Falhou', next: 'lint' } })
    expect(wiring(flow)).toContain('checagem.passou→lint')
  })

  test('order puts the steps in the given sequence', () => {
    const ids = parsed.rapido!.steps.map(s => s.id)
    const swapped = [...ids.slice(0, 5), 'qa', 'pr', ...ids.slice(7)]
    expect(ok(resolve({ id: 'x', title: 'X', base: 'rapido', order: swapped })).steps.map(s => s.id)).toEqual(swapped)
    expect(err(resolve({ id: 'x', title: 'X', base: 'rapido', order: ids.slice(1) }))).toMatch(/`order` names every step of the flow once/)
  })

  test('a project flow may derive from another project flow', () => {
    const curto = { id: 'curto', title: 'Curto', base: 'rapido', remove: ['qa'] }
    const flow = ok(resolve({ id: 'mais-curto', title: 'Mais curto', base: 'curto', remove: ['producao'] }, { curto }))
    expect(flow.base).toBe('curto')
    expect(wiring(flow)).toContain('pr.aberto→arquivar')
  })

  describe('refusals', () => {
    test('a base that does not exist', () => {
      expect(err(resolve({ id: 'x', title: 'X', base: 'nenhum' }))).toBe('p.json: base "nenhum" is no flow of the mod or of the project.')
    })

    test('a base that goes round in a circle', () => {
      const a = { id: 'a', title: 'A', base: 'b' }
      const b = { id: 'b', title: 'B', base: 'a' }
      const files: Record<string, FlowSource> = { a: { source: 'a.json', raw: a }, b: { source: 'b.json', raw: b } }
      expect(err(resolveFlow(a, 'a.json', id => files[id]))).toBe(
        'a.json: base "b" does not resolve: b.json: `base` goes round in a circle: a → b → a.',
      )
      const self = { id: 'c', title: 'C', base: 'c' }
      expect(err(resolveFlow(self, 'c.json', () => ({ source: 'c.json', raw: self })))).toBe('c.json: `base` goes round in a circle: c → c.')
    })

    test('removing the loop over the phases', () => {
      expect(err(resolve({ id: 'x', title: 'X', base: 'completo', remove: ['executar'] }))).toBe(
        'p.json: `remove`: "executar" runs the change\'s phases; it cannot be removed.',
      )
    })

    test('a remove, after or override naming no step', () => {
      expect(err(resolve({ id: 'x', title: 'X', base: 'rapido', remove: ['mockup'] }))).toBe('p.json: `remove`: "mockup" is no step of rapido.')
      expect(err(resolve({ id: 'x', title: 'X', base: 'rapido', add: [{ after: 'grill', step: 'revisao-pr' }] }))).toBe(
        'p.json: add 1: `after` "grill" is no step of the flow.',
      )
      expect(err(resolve({ id: 'x', title: 'X', base: 'rapido', override: { grill: { model: 'm' } } }))).toBe(
        'p.json: `override`: "grill" is no step of the flow.',
      )
    })

    test('an added step whose id is already in the flow', () => {
      expect(err(resolve({ id: 'x', title: 'X', base: 'completo', add: [{ after: 'pr', step: 'qa' }] }))).toBe(
        'p.json: add 1: step id "qa" is already in the flow.',
      )
    })

    test('an override that changes the id or the kind', () => {
      expect(err(resolve({ id: 'x', title: 'X', base: 'rapido', override: { pr: { kind: 'owner' } } }))).toBe(
        'p.json: `override` of "pr" cannot change its `kind`.',
      )
      expect(err(resolve({ id: 'x', title: 'X', base: 'rapido', override: { pr: { id: 'pull' } } }))).toMatch(/cannot change its `id`/)
    })

    test('a library step that does not exist, and a resolved flow parseFlow refuses', () => {
      expect(err(resolve({ id: 'x', title: 'X', base: 'rapido', add: [{ after: 'pr', step: 'nada' }] }))).toMatch(/"nada" is no step of the library/)
      expect(err(resolve({ id: 'x', title: 'X', base: 'rapido', override: { pr: { agent: 'abre-pr', effort: 'huge' } } }))).toMatch(
        /^p.json: step "pr": `effort` must be one of/,
      )
    })
  })
})

describe('the library', () => {
  test('every step it offers resolves when added after the PR', () => {
    for (const id of Object.keys(LIBRARY).filter(id => !parsed.completo!.steps.some(s => s.id === id))) {
      expect([id, err(resolve({ id: 'x', title: 'X', base: 'completo', add: [{ after: 'pr', step: id }] }))]).toEqual([id, ''])
    }
    expect(Object.keys(LIBRARY)).toEqual(expect.arrayContaining(['revisao-pr', 'merge', 'deploy', 'qa', 'producao', 'mockup', 'grill']))
  })

  test('the PR review is the owner\'s "PR aprovado"', () => {
    const flow = ok(resolve({ id: 'x', title: 'X', base: 'rapido', add: [{ after: 'pr', step: 'revisao-pr' }] }))
    expect(at(flow, 'revisao-pr')).toMatchObject({ kind: 'owner', outcomes: { aprovado: { label: 'PR aprovado', next: 'qa' } } })
  })
})

describe('resolveProjectFlows', () => {
  test('resolves derived files and gathers the ones that do not resolve', () => {
    const files: FlowSource[] = [
      { source: 'a/completo.json', raw: { id: 'completo', title: 'Completo sem mockup', base: 'completo', remove: ['mockup'] } },
      { source: 'a/trunk.json', raw: { id: 'trunk', title: 'Trunk', base: 'completo', remove: ['qa'] } },
      { source: 'a/ruim.json', raw: { id: 'ruim', title: 'Ruim', base: 'rapido', remove: ['executar'] } },
    ]
    const { flows, problems } = resolveProjectFlows(DEFAULT_FLOWS, files)
    expect([flows.map(f => f.id), problems.length]).toEqual([['completo', 'trunk'], 1])
    // the project's completo derives from the default; trunk derives from the project's completo
    expect(flows[0]?.steps.some(s => s.id === 'mockup')).toBe(false)
    expect(flows[1]?.steps.some(s => s.id === 'mockup')).toBe(false)
    expect(problems).toEqual(['a/ruim.json: `remove`: "executar" runs the change\'s phases; it cannot be removed.'])
  })
})
