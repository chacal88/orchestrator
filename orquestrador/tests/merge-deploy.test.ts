import { describe, expect, test } from 'claude-code/testing'

import type { FlowDef, FlowState, FlowStep } from '../types'
import {
  DEPLOY_CI_OUTCOME,
  applyOutcome,
  automaticOutcome,
  describeFlow,
  detectedOutcome,
  flowView,
  observeDeploy,
  ownerPress,
  pendingCodeReview,
  pendingReview,
  resolveFlow,
  startFlow,
} from '../hooks/flow'
import type { FlowSource } from '../hooks/flow'
import { DEFAULT_FLOWS, defaultFlows } from '../hooks/flows/index'

const ok = <T,>(r: T | { error: string } | undefined): T => {
  if (r === undefined) throw new Error('nothing happened')
  if (typeof r === 'object' && r !== null && 'error' in r) throw new Error((r as { error: string }).error)
  return r as T
}

/** The refusal's text, empty when the call was accepted. */
const err = (r: unknown): string => (r as { error?: string } | undefined)?.error ?? ''

const defaults = Object.fromEntries(DEFAULT_FLOWS.map(f => [(f.raw as { id: string }).id, f])) as Record<string, FlowSource>

/** rapido without QA: pr → revisao-pr → merge → deploy → producao → arquivar. */
const trunk = (merge: Record<string, unknown>, deploy: Record<string, unknown> = { ci: true }): FlowDef =>
  ok(
    resolveFlow(
      {
        id: 'trunk',
        title: 'Trunk',
        base: 'rapido',
        remove: ['qa'],
        add: [
          { after: 'pr', step: 'revisao-pr' },
          { after: 'revisao-pr', step: { use: 'merge', merge } },
          { after: 'merge', step: { use: 'deploy', deploy } },
        ],
      },
      'p.json',
      id => defaults[id],
    ),
  )

const stepAt = (flow: FlowDef, id: string): FlowStep => flow.steps.find(s => s.id === id)!

/** The flow parked on `current`, every step before it answered. */
const parked = (flow: FlowDef, current: string): FlowState => {
  const { state } = startFlow(flow, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1)
  const before = flow.steps.slice(0, flow.steps.findIndex(s => s.id === current))
  const records = Object.fromEntries(before.map(s => [s.id, { outcome: Object.keys(s.outcomes)[0]!, by: 'owner' as const, at: 1 }]))
  return { ...state, current, attempts: { [current]: 1 }, records }
}

describe('merge', () => {
  test('auto: false is the owner\'s, answered by the button or by seeing gh pr merge pass', () => {
    const flow = trunk({ branch: 'main', method: 'rebase' })
    const merge = stepAt(flow, 'merge')
    expect(merge).toMatchObject({ kind: 'owner', detect: { commands: ['gh pr merge'], outcome: 'feito' } })
    expect(merge.description).toBe('O PR da change entra em main por rebase.')
    const state = parked(flow, 'merge')
    expect(describeFlow(state)).toContain('The owner merges into main by rebase; never with --admin.')
    expect(describeFlow(state)).toContain('The mod also answers feito when it sees `gh pr merge` succeed.')

    expect(detectedOutcome(merge, 'gh pr merge 801 --rebase', false)).toBe('feito')
    expect(detectedOutcome(merge, 'gh pr merge 801 --rebase', true)).toBeUndefined()
    expect(detectedOutcome(merge, 'gh pr merge 801 --rebase || true', false)).toBeUndefined()
    const seen = ok(applyOutcome(state, { step: 'merge', outcome: 'feito', by: 'detect' }, 5))
    expect(seen.state.current).toBe('deploy')

    const pressed = ok(ownerPress(state, 'merge', 'feito', 5))
    expect(pressed.state.current).toBe('deploy')
    expect(err(applyOutcome(state, { step: 'merge', outcome: 'feito', by: 'session' }, 5))).toMatch(/only the owner/)
  })

  test('auto: true is automatic: the coordinator runs gh pr merge with the method, and its exit code decides', () => {
    const flow = trunk({ branch: 'main', auto: true })
    const merge = stepAt(flow, 'merge')
    expect(merge).toMatchObject({ kind: 'automatic', command: 'gh pr merge', merge: { method: 'squash', auto: true } })
    expect(merge.description).toBe('O PR da change entra em main por squash.')
    const text = describeFlow(parked(flow, 'merge'))
    expect(text).toContain('Merge the change\'s PR into main yourself, by squash')
    expect(text).toContain('`gh pr view <pr> --json reviewDecision,statusCheckRollup`')
    expect(text).toContain('`gh pr merge <pr> --squash` alone, never with --admin')
    expect(text).toContain('exit 0 → deploy, otherwise → merge')

    expect(automaticOutcome(merge, 'gh pr merge 801 --squash', false)).toBe('passou')
    expect(automaticOutcome(merge, 'gh pr merge 801 --squash', true)).toBe('falhou')
    expect(automaticOutcome(merge, 'gh pr merge 801 --squash | cat', false)).toBeUndefined()
    expect(err(applyOutcome(parked(flow, 'merge'), { step: 'merge', outcome: 'passou', by: 'session' }, 5))).toMatch(/only the mod/)
  })

  test('the method a project chose is the one the step names', () => {
    const text = describeFlow(parked(trunk({ branch: 'master', method: 'merge', auto: true }), 'merge'))
    expect(text).toContain('into master yourself, by merge')
    expect(text).toContain('`gh pr merge <pr> --merge`')
  })
})

describe('pendingReview', () => {
  const flow = trunk({ branch: 'main', auto: true })

  test('the review before the next merge, until it is answered', () => {
    expect(pendingReview(parked(flow, 'pr'))?.id).toBe('revisao-pr')
    expect(pendingReview(parked(flow, 'revisao-pr'))?.id).toBe('revisao-pr')
    expect(pendingReview(parked(flow, 'merge'))).toBeUndefined()
    expect(pendingReview({ ...parked(flow, 'pr'), status: 'done' })).toBeUndefined()
  })

  test('a flow without the review step waits on none', () => {
    const rapido = defaultFlows().find(f => f.id === 'rapido')!
    expect(pendingReview(parked(rapido, 'qa'))).toBeUndefined()
  })

  test('dev/master: the review before the dev merge holds that one, not the later merge into main', () => {
    const devMaster = ok(
      resolveFlow(
        {
          id: 'dm',
          title: 'Dev/master',
          base: 'rapido',
          add: [
            { after: 'pr', step: 'revisao-pr' },
            { after: 'revisao-pr', step: { use: 'merge', id: 'merge-dev', merge: { branch: 'dev' } } },
            { after: 'qa', step: { use: 'merge', id: 'merge-main', merge: { branch: 'main' } } },
          ],
        },
        'p.json',
        id => defaults[id],
      ),
    )
    expect(devMaster.steps.map(s => s.id)).toEqual([
      'planejar', 'validar', 'executar', 'revisao-codigo', 'checagem', 'pr', 'revisao-pr', 'merge-dev', 'qa', 'merge-main', 'producao', 'arquivar',
    ])
    expect(pendingReview(parked(devMaster, 'revisao-pr'))?.id).toBe('revisao-pr')
    expect(pendingReview(parked(devMaster, 'merge-main'))).toBeUndefined()
  })
})

describe('deploy', () => {
  const at = 10

  test('only the CI: the owner\'s button or gh run watch --exit-status passing moves it on', () => {
    const flow = trunk({ branch: 'main', auto: true }, { ci: true, auto: true })
    const state = parked(flow, 'deploy')
    expect(flowView(state).ownerChoices).toEqual([{ outcome: DEPLOY_CI_OUTCOME, label: 'Deploy do CI concluído' }])
    const text = describeFlow(state)
    expect(text).toContain('Deploy by yourself right after the merge, without waiting on the owner.')
    expect(text).toContain('`gh run watch <run> --exit-status`')

    expect(observeDeploy(state, 'gh run watch 123', false, at)).toBeUndefined()
    expect(err(observeDeploy(state, 'gh run watch 123 --exit-status || true', false, at))).toMatch(/exit code hidden/)
    const watched = ok(observeDeploy(state, 'gh run watch 123 --exit-status', false, at))
    expect(watched.state.current).toBe('producao')
    expect(watched.state.records.deploy).toMatchObject({ outcome: 'passou', by: 'automatic' })
    expect(watched.events.map(e => e.kind)).toEqual(['progress', 'outcome', 'entered'])

    const pressed = ok(ownerPress(state, 'deploy', DEPLOY_CI_OUTCOME, at))
    expect(pressed.state.current).toBe('producao')
    expect(ok(observeDeploy(state, 'gh run view 123 --exit-status', true, at)).state).toMatchObject({ current: 'deploy', attempts: { deploy: 2 } })
  })

  test('only routines, owner\'s: each passing in order, and the step moves on with the last', () => {
    const flow = trunk({ branch: 'main' }, { ci: false, commands: ['npm run migrate:prod', 'npm run seed:prod'] })
    let state = parked(flow, 'deploy')
    expect(stepAt(flow, 'deploy').kind).toBe('owner')
    expect(describeFlow(state)).toContain('Waits on the owner: do not start the deploy unless they ask')

    state = ok(observeDeploy(state, 'npm run migrate:prod', false, at)).state
    expect(state.current).toBe('deploy')
    expect(state.progress?.deploy).toEqual({ ci: false, commands: ['npm run migrate:prod'] })
    expect(describeFlow(state)).toContain('Routines left, each as its own command and in this order: `npm run seed:prod`.')
    expect(err(observeDeploy(state, 'npm run migrate:prod', false, at))).toMatch(/already passed/)

    const done = ok(observeDeploy(state, 'npm run seed:prod', false, at))
    expect(done.state.current).toBe('producao')
    expect(done.state.records.deploy).toMatchObject({ outcome: 'publicado', by: 'mod' })
  })

  test('both: the CI first, then the routines', () => {
    const flow = trunk({ branch: 'main', auto: true }, { ci: true, commands: ['npm run migrate:prod'], auto: true })
    let state = parked(flow, 'deploy')
    expect(err(observeDeploy(state, 'npm run migrate:prod', false, at))).toMatch(/before the CI's deploy was confirmed/)
    expect(state.progress).toBeUndefined()

    state = ok(ownerPress(state, 'deploy', DEPLOY_CI_OUTCOME, at)).state
    expect(state.current).toBe('deploy')
    expect(flowView(state).ownerChoices).toEqual([])
    expect(describeFlow(state)).toContain("The CI's deploy is confirmed.")
    expect(err(ownerPress(state, 'deploy', DEPLOY_CI_OUTCOME, at))).toMatch(/already confirmed/)

    const done = ok(observeDeploy(state, 'npm run migrate:prod', false, at))
    expect(done.state.current).toBe('producao')
  })

  test('a routine failing: an automatic deploy fails and retries keeping what passed; an owner\'s holds', () => {
    const commands = ['npm run migrate:prod', 'npm run seed:prod']
    const auto = trunk({ branch: 'main', auto: true }, { ci: false, commands, auto: true })
    let state = ok(observeDeploy(parked(auto, 'deploy'), 'npm run migrate:prod', false, at)).state
    state = ok(observeDeploy(state, 'npm run seed:prod', true, at)).state
    expect(state).toMatchObject({ current: 'deploy', attempts: { deploy: 2 }, records: {} })
    expect(state.progress?.deploy?.commands).toEqual(['npm run migrate:prod'])
    expect(ok(observeDeploy(state, 'npm run seed:prod', false, at)).state.current).toBe('producao')

    const owner = trunk({ branch: 'main' }, { ci: false, commands })
    const held = observeDeploy(parked(owner, 'deploy'), 'npm run migrate:prod', true, at)
    expect(err(held)).toBe('the routine `npm run migrate:prod` failed; the deploy holds until it passes.')
  })

  test('7.2 an owner\'s deploy of routines alone has the owner\'s "Deploy concluído", which moves it on', () => {
    const flow = trunk({ branch: 'main' }, { ci: false, commands: ['npm run migrate:prod', 'npm run seed:prod'] })
    let state = parked(flow, 'deploy')
    expect(flowView(state).ownerChoices).toEqual([{ outcome: 'publicado', label: 'Deploy concluído' }])
    expect(describeFlow(state)).toContain('The owner may also press "Deploy concluído" once they ran the routines.')
    // a session cannot answer it, and neither can an outcome the step lacks
    expect(err(applyOutcome(state, { step: 'deploy', outcome: 'publicado', by: 'session' }, at))).toMatch(/only the owner/)
    // halfway through the routines, the owner still gets out
    state = ok(observeDeploy(state, 'npm run migrate:prod', false, at)).state
    expect(flowView(state).ownerChoices).toEqual([{ outcome: 'publicado', label: 'Deploy concluído' }])
    const pressed = ok(ownerPress(state, 'deploy', 'publicado', at))
    expect(pressed.state.current).toBe('producao')
    expect(pressed.state.records.deploy).toMatchObject({ outcome: 'publicado', by: 'owner' })

    // a deploy that waits on the CI keeps only the CI's button
    const withCi = parked(trunk({ branch: 'main' }, { ci: true, commands: ['npm run migrate:prod'] }), 'deploy')
    expect(flowView(withCi).ownerChoices).toEqual([{ outcome: DEPLOY_CI_OUTCOME, label: 'Deploy do CI concluído' }])
    expect(err(ownerPress(withCi, 'deploy', 'publicado', at))).toMatch(/moves on by itself once the mod saw the whole deploy/)
  })

  test('8.2 once the CI is confirmed and only routines are left, the owner gets "Deploy concluído" too', () => {
    let state = parked(trunk({ branch: 'main' }, { ci: true, commands: ['npm run migrate:prod', 'npm run seed:prod'] }), 'deploy')
    state = ok(ownerPress(state, 'deploy', DEPLOY_CI_OUTCOME, at)).state
    expect(state.current).toBe('deploy')
    expect(flowView(state).ownerChoices).toEqual([{ outcome: 'publicado', label: 'Deploy concluído' }])
    expect(describeFlow(state)).toContain('The owner may also press "Deploy concluído" once they ran the routines.')
    expect(err(applyOutcome(state, { step: 'deploy', outcome: 'publicado', by: 'session' }, at))).toMatch(/only the owner/)
    const pressed = ok(ownerPress(state, 'deploy', 'publicado', at))
    expect(pressed.state.current).toBe('producao')
    expect(pressed.state.records.deploy).toMatchObject({ outcome: 'publicado', by: 'owner' })
  })

  test('7.3 a failing gh run --exit-status fails the deploy only while it waits on the CI', () => {
    const watch = 'gh run watch 123 --exit-status'
    // ci: false — the CI is none of the deploy's, automatic or the owner's
    const auto = parked(trunk({ branch: 'main', auto: true }, { ci: false, commands: ['npm run migrate:prod'], auto: true }), 'deploy')
    expect(observeDeploy(auto, watch, true, at)).toBeUndefined()
    expect(observeDeploy(auto, 'gh run view 123 --exit-status', true, at)).toBeUndefined()
    const owner = parked(trunk({ branch: 'main' }, { ci: false, commands: ['npm run migrate:prod'] }), 'deploy')
    expect(observeDeploy(owner, watch, true, at)).toBeUndefined()

    // ci: true, already confirmed — a later watch, passing or failing, is ignored
    const both = parked(trunk({ branch: 'main', auto: true }, { ci: true, commands: ['npm run migrate:prod'], auto: true }), 'deploy')
    const confirmed = ok(ownerPress(both, 'deploy', DEPLOY_CI_OUTCOME, at)).state
    expect(observeDeploy(confirmed, watch, true, at)).toBeUndefined()
    expect(observeDeploy(confirmed, watch, false, at)).toBeUndefined()
    expect(ok(observeDeploy(confirmed, 'npm run migrate:prod', false, at)).state.current).toBe('producao')

    // ci: true, not confirmed yet — the failure still fails it
    expect(ok(observeDeploy(both, watch, true, at)).state).toMatchObject({ current: 'deploy', attempts: { deploy: 2 } })
  })

  test('a routine out of order does not count', () => {
    const flow = trunk({ branch: 'main' }, { ci: false, commands: ['npm run migrate:prod', 'npm run seed:prod'] })
    const state = parked(flow, 'deploy')
    expect(err(observeDeploy(state, 'npm run seed:prod', false, at))).toBe(
      'the routine `npm run seed:prod` ran out of order; `npm run migrate:prod` comes first, so it does not count.',
    )
  })

  test('coming back from a later step starts the deploy over', () => {
    const flow = trunk({ branch: 'main' }, { ci: false, commands: ['npm run migrate:prod', 'npm run seed:prod'] })
    const half = ok(observeDeploy(parked(flow, 'deploy'), 'npm run migrate:prod', false, at)).state
    const back = ok(applyOutcome({ ...half, current: 'revisao-pr' }, { step: 'revisao-pr', outcome: 'aprovado', by: 'owner' }, at)).state
    expect(back.current).toBe('merge')
    expect(back.progress).toBeUndefined()
  })
})

describe('the deploy\'s routines answer production', () => {
  test('with a deploy and producao, the routines join producao\'s detect', () => {
    const flow = trunk({ branch: 'main' }, { ci: true, commands: ['npm run migrate:prod'] })
    const producao = stepAt(flow, 'producao')
    expect(producao.detect?.commands).toEqual(expect.arrayContaining(['vercel --prod', 'npm run migrate:prod']))
    expect(producao.detect?.outcome).toBe('publicado')
    expect(detectedOutcome(producao, 'npm run migrate:prod', false)).toBe('publicado')
  })

  /** A project workflow deriving from the project's trunk (rapido + a deploy running migrate). */
  const fromTrunk = (raw: Record<string, unknown>): FlowDef => {
    const trunkRaw = {
      id: 'trunk',
      title: 'Trunk',
      base: 'rapido',
      add: [{ after: 'pr', step: { use: 'deploy', deploy: { ci: true, commands: ['npm run migrate:prod'] } } }],
    }
    const find = (id: string) => (id === 'trunk' ? { source: 'trunk.json', raw: trunkRaw } : defaults[id])
    return ok(resolveFlow({ id: 'filho', title: 'Filho', base: 'trunk', ...raw }, 'filho.json', find))
  }

  const OWN = stepAt(defaultFlows().find(f => f.id === 'rapido')!, 'producao').detect!.commands

  test('7.1 a derived flow that removes the deploy drops its routines from producao, keeping producao\'s own', () => {
    const producao = stepAt(fromTrunk({}), 'producao')
    expect(producao.detect?.commands).toEqual([...OWN, 'npm run migrate:prod'])
    const removed = stepAt(fromTrunk({ remove: ['deploy'] }), 'producao')
    expect(removed.detect).toEqual({ commands: OWN, outcome: 'publicado' })
    expect(detectedOutcome(removed, 'npm run migrate:prod', false)).toBeUndefined()
    expect(detectedOutcome(removed, 'vercel --prod', false)).toBe('publicado')
  })

  test('7.1 a derived flow that overrides deploy.commands keeps only the new routines', () => {
    const flow = fromTrunk({ override: { deploy: { deploy: { commands: ['npm run seed:prod'] } } } })
    expect(stepAt(flow, 'deploy').deploy?.commands).toEqual(['npm run seed:prod'])
    const producao = stepAt(flow, 'producao')
    expect(producao.detect?.commands).toEqual([...OWN, 'npm run seed:prod'])
    expect(detectedOutcome(producao, 'npm run migrate:prod', false)).toBeUndefined()
    // producao's own commands stay, also when the derived flow overrides them
    const own = stepAt(fromTrunk({ override: { producao: { detect: 'fly deploy' } } }), 'producao')
    expect(own.detect?.commands).toEqual(['fly deploy', 'npm run migrate:prod'])
  })

  test('without a deploy, producao keeps its own', () => {
    const rapido = defaultFlows().find(f => f.id === 'rapido')!
    expect(stepAt(rapido, 'producao').detect?.commands).not.toContain('npm run migrate:prod')
  })
})

describe('pendingCodeReview', () => {
  const flow = trunk({ branch: 'main', auto: true })

  test('the code review before the merge, until it is approved', () => {
    const at = parked(flow, 'merge')
    expect(pendingCodeReview(at)).toBeUndefined()
    const noRecord = { ...at, records: Object.fromEntries(Object.entries(at.records).filter(([id]) => id !== 'revisao-codigo')) }
    expect(pendingCodeReview(noRecord)?.id).toBe('revisao-codigo')
    const rejected = { ...at, records: { ...at.records, 'revisao-codigo': { outcome: 'rejeitado', by: 'session' as const, at: 2 } } }
    expect(pendingCodeReview(rejected)?.id).toBe('revisao-codigo')
    expect(pendingCodeReview({ ...noRecord, status: 'done' })).toBeUndefined()
  })

  test('a rejection turns the flow back to run, and the record is gone until the review is approved again', () => {
    const review = parked(flow, 'revisao-codigo')
    const back = ok(applyOutcome(review, { step: 'revisao-codigo', outcome: 'rejeitado', by: 'session' }, 2))
    expect(back.state.current).toBe('executar')
    expect(back.state.records['revisao-codigo']).toBeUndefined()
    expect(pendingCodeReview(back.state)?.id).toBe('revisao-codigo')
  })
})

describe('the merge agents', () => {
  test('describeFlow says which approval the merge needs, by agent', () => {
    const workflow = trunk({ branch: 'main', auto: true })
    const withAgent = { ...workflow, steps: workflow.steps.map(s => (s.id === 'merge' ? { ...s, agent: 'merge-pelo-workflow' } : s)) }
    const text = describeFlow(parked(withAgent, 'merge'))
    expect(text).toContain("on the workflow's own approval")
    expect(text).toContain('GitHub approval is not required')
    expect(text).toContain('`gh pr merge <pr> --squash`')
    expect(text).not.toContain('approved on GitHub and its CI is green')
    expect(describeFlow(parked(workflow, 'merge'))).toContain('approved on GitHub and its CI is green')
    const byOwner = { ...withAgent, steps: withAgent.steps.map(s => (s.id === 'merge' ? { ...s, merge: { ...s.merge!, auto: false }, kind: 'owner' as const } : s)) }
    expect(describeFlow(parked(byOwner, 'merge'))).toContain("waits on the workflow's approval")
  })
})
