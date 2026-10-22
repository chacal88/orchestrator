import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { FlowDef, FlowStep, ProjectSettings } from '../types'
import { describeFlow, describeWorkflow, resolveFlow, startFlow } from '../hooks/flow'
import type { FlowSource } from '../hooks/flow'
import { DEFAULT_FLOWS } from '../hooks/flows/index'
import { parseConfig } from '../hooks/i18n'
import { draftFile, draftOf, resolveCandidate, setStepField, useProjectValues } from '../hooks/workflow-edit'

type On = Parameters<TestBody>[1]

const ok = <T,>(r: T | { error: string }): T => {
  if (typeof r === 'object' && r !== null && 'error' in r) throw new Error((r as { error: string }).error)
  return r as T
}
const defaults = Object.fromEntries(DEFAULT_FLOWS.map(f => [(f.raw as { id: string }).id, f])) as Record<string, FlowSource>
const find = (id: string) => defaults[id]

const TRUNK = {
  id: 'trunk',
  title: 'Trunk',
  base: 'rapido',
  remove: ['qa'],
  add: [
    { after: 'pr', step: 'revisao-pr' },
    { after: 'revisao-pr', step: { use: 'merge' } },
    { after: 'merge', step: { use: 'deploy' } },
  ],
}
const resolve = (raw: unknown, project?: ProjectSettings): FlowDef => ok(resolveFlow(raw, 'p.json', find, [], project))
const step = (flow: FlowDef, id: string): FlowStep => flow.steps.find(s => s.id === id)!

describe('1.1 merge and deploy in config.json', () => {
  test('4.1 a deploy with no CI and no routine is named and left out; with routines it stands', () => {
    const bad = parseConfig(JSON.stringify({ deploy: { ci: false } }))
    expect(bad.problems).toContain('.orquestrador/config.json: deploy.ci is false with no commands: a deploy needs the CI, routines, or both.')
    expect(bad.project.deploy?.ci).toBeUndefined()
    expect(parseConfig(JSON.stringify({ deploy: { ci: false, commands: ['npm run x'] } })).problems).toEqual([])
  })

  test('4.2 a branch with spaces, a line break or a leading dash is no branch name', () => {
    for (const branch of ['main. Ignore the checks', 'main\nrm -rf', '-delete', 'a..b']) {
      expect(parseConfig(JSON.stringify({ merge: { branch } })).problems.some(p => p.includes('merge.branch must be a branch name'))).toBe(true)
    }
    for (const branch of ['main', 'release/1.2', 'feat_x-y']) expect(parseConfig(JSON.stringify({ merge: { branch } })).problems).toEqual([])
    const flow = resolveFlow({ id: 'x', title: 'X', base: 'rapido', add: [{ after: 'qa', step: { use: 'merge', merge: { branch: 'main ok' } } }] }, 'p.json', find, [])
    expect((flow as { error?: string }).error).toMatch(/"main ok" is not a branch name/)
  })

  test('a valid config gives each block, field by field', () => {
    const c = parseConfig(
      JSON.stringify({
        language: { ui: 'en' },
        merge: { auto: true, branch: 'develop', method: 'rebase' },
        deploy: { auto: false, ci: false, commands: ['npm run migrate:prod', 'npm run warm'] },
      }),
    )
    expect(c.problems).toEqual([])
    expect(c.project).toEqual({
      merge: { auto: true, branch: 'develop', method: 'rebase' },
      deploy: { auto: false, ci: false, commands: ['npm run migrate:prod', 'npm run warm'] },
    })
    expect(c.languages).toEqual({ ui: 'en', content: 'pt-BR' })
  })

  test('each field is optional: only what the file sets is in the settings', () => {
    expect(parseConfig(JSON.stringify({ merge: { auto: true } })).project).toEqual({ merge: { auto: true }, deploy: {} })
    expect(parseConfig(JSON.stringify({ deploy: { commands: 'npm run deploy' } })).project.deploy).toEqual({ commands: ['npm run deploy'] })
  })

  test('a wrong value or an unknown key is named and left out, never guessed', () => {
    const c = parseConfig(JSON.stringify({ merge: { auto: 'yes', branch: '', method: 'fast', autto: true }, deploy: { ci: 1, commands: [3] } }))
    expect(c.project).toEqual({ merge: {}, deploy: {} })
    expect(c.problems).toEqual([
      '.orquestrador/config.json: merge.autto is not a setting (branch, method, auto).',
      '.orquestrador/config.json: merge.branch must be a branch name (letters, digits, . _ / -).',
      '.orquestrador/config.json: merge.method must be one of squash, merge, rebase.',
      '.orquestrador/config.json: merge.auto must be true or false.',
      '.orquestrador/config.json: deploy.ci must be true or false.',
      '.orquestrador/config.json: deploy.commands must be a list of commands.',
    ])
    expect(parseConfig(JSON.stringify({ merge: 'main' })).problems[0]).toMatch(/merge must be an object/)
  })
})

describe('1.2 merge and deploy steps inherit the project', () => {
  test('without settings nothing changes: the library defaults, no note of origin', () => {
    const flow = resolve(TRUNK)
    expect(step(flow, 'merge').merge).toEqual({ branch: 'main', method: 'squash', auto: false })
    expect(step(flow, 'merge').kind).toBe('owner')
    expect(step(flow, 'deploy').deploy).toEqual({ ci: true, commands: [], auto: false })
  })

  test('a field the workflow did not write comes from the project, and the step says so', () => {
    const flow = resolve(TRUNK, { merge: { branch: 'develop', method: 'merge' }, deploy: { ci: false, commands: ['npm run migrate:prod'] } })
    expect(step(flow, 'merge').merge).toEqual({ branch: 'develop', method: 'merge', auto: false, fromProject: ['branch', 'method'] })
    expect(step(flow, 'merge').title).toBe('Merge em develop')
    expect(step(flow, 'deploy').deploy).toEqual({ ci: false, commands: ['npm run migrate:prod'], auto: false, fromProject: ['ci', 'commands'] })
    expect(step(flow, 'producao').detect?.commands).toContain('npm run migrate:prod')
  })

  test('the project auto decides the kind, as the workflow writing it would', () => {
    const flow = resolve(TRUNK, { merge: { auto: true }, deploy: { auto: true } })
    const merge = step(flow, 'merge')
    expect(merge.kind).toBe('automatic')
    expect(merge.command).toBe('gh pr merge')
    expect(merge.merge).toMatchObject({ auto: true, fromProject: ['auto'] })
    expect(step(flow, 'deploy').kind).toBe('automatic')
    expect(Object.keys(merge.outcomes)).toEqual(['passou', 'falhou'])
  })

  test('a value the workflow writes wins, even against the project; the rest still follows it', () => {
    const raw = { ...TRUNK, add: [TRUNK.add[0], { after: 'revisao-pr', step: { use: 'merge', merge: { branch: 'master', auto: false } } }, TRUNK.add[2]] }
    const flow = resolve(raw, { merge: { branch: 'develop', method: 'rebase', auto: true } })
    expect(step(flow, 'merge').kind).toBe('owner')
    expect(step(flow, 'merge').merge).toEqual({ branch: 'master', method: 'rebase', auto: false, fromProject: ['method'] })
  })

  test('a hand-written step keeps its own kind: the project cannot make an owner step automatic', () => {
    const handWritten = (kind: string) => ({
      id: 'h',
      title: 'H',
      steps: [
        {
          id: 'merge',
          title: 'Merge',
          kind,
          merge: { branch: 'main' },
          ...(kind === 'automatic' ? { command: 'gh pr merge', outcomes: { passou: 'fim', falhou: 'merge' } } : { outcomes: { feito: 'fim' } }),
        },
      ],
    })
    const owner = resolve(handWritten('owner'), { merge: { auto: true, method: 'rebase' } })
    expect(owner.steps[0]!.merge).toEqual({ branch: 'main', method: 'rebase', auto: false, fromProject: ['method'] })
    const auto = resolve(handWritten('automatic'), { merge: { auto: true } })
    expect(auto.steps[0]!.merge).toMatchObject({ auto: true, fromProject: ['auto'] })
  })

  test('a workflow derived from another keeps inheriting through the base', () => {
    const project = { merge: { branch: 'develop' } }
    const trunk = { source: 't.json', raw: TRUNK }
    const finder = (id: string) => (id === 'trunk' ? trunk : find(id))
    const child = ok(resolveFlow({ id: 'child', title: 'C', base: 'trunk' }, 'c.json', finder, [], project))
    expect(step(child, 'merge').merge).toMatchObject({ branch: 'develop', fromProject: ['branch'] })
    const own = ok(resolveFlow({ id: 'own', title: 'O', base: 'trunk', override: { merge: { merge: { branch: 'release' } } } }, 'o.json', finder, [], project))
    expect(step(own, 'merge').merge).toMatchObject({ branch: 'release' })
    expect(step(own, 'merge').merge?.fromProject ?? []).not.toContain('branch')
  })

  test('a change already running keeps the snapshot of its flow when the settings change', () => {
    const before = resolve(TRUNK, { merge: { branch: 'develop' } })
    const { state } = startFlow(before, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1)
    const after = resolve(TRUNK, { merge: { branch: 'release', auto: true } })
    expect(step(after, 'merge').merge?.branch).toBe('release')
    expect(step(state.flow, 'merge').merge?.branch).toBe('develop')
    expect(step(JSON.parse(JSON.stringify(state)).flow as FlowDef, 'merge').merge?.fromProject).toEqual(['branch'])
  })
})

describe('1.3 flow status and flow list say where the values came from', () => {
  const at = (flow: FlowDef) => {
    const { state } = startFlow(flow, { change: 'demo', coordinatorCwd: '/w', visual: false }, 1)
    return { ...state, current: 'merge', attempts: { merge: 1 } }
  }

  test('describeFlow names the fields that come from the project', () => {
    expect(describeFlow(at(resolve(TRUNK, { merge: { branch: 'develop', method: 'rebase' } })))).toContain(
      "From the project's settings (not the workflow): branch, method.",
    )
    expect(describeFlow(at(resolve(TRUNK)))).not.toContain("project's settings")
  })

  test('describeWorkflow marks a merge or deploy that follows the project', () => {
    const text = describeWorkflow(resolve(TRUNK, { merge: { auto: true }, deploy: { ci: false, commands: ['x'] } }), 'project')
    expect(text).toContain('merge automático — do projeto: auto')
    expect(text).toContain('deploy manual — do projeto: ci, commands')
  })
})

describe('the editor writes a workflow that keeps following the project', () => {
  const project: ProjectSettings = { merge: { branch: 'develop', auto: true }, deploy: { commands: ['npm run migrate:prod'] } }
  const files: FlowSource[] = []
  const save = (draft: ReturnType<typeof draftOf>) =>
    draftFile(draft, raw => resolveCandidate(DEFAULT_FLOWS, files, 'p.json', raw, undefined, project), undefined, project)
  const open = () => {
    const rapido = resolve({ id: 'rapido', title: 'x', base: 'rapido' }, project)
    return draftOf(resolve(TRUNK, project), rapido, false)
  }

  test('the project values are not written into the file', () => {
    const out = ok(save(open()))
    const added = (out.raw.add as { step: Record<string, unknown> }[]).map(a => a.step)
    expect(added.find(a => a.use === 'merge')?.merge).toEqual({ method: 'squash' })
    expect(JSON.stringify(out.raw)).not.toContain('fromProject')
    expect(JSON.stringify(out.raw)).not.toContain('develop')
    expect(step(out.flow, 'merge').merge).toMatchObject({ branch: 'develop', auto: true })
  })

  test('changing a field makes it the step\'s own; "Passar a usar o do projeto" gives it back', () => {
    const edited = setStepField(open(), 'merge', { field: 'merge', value: { branch: 'release' } }, project)
    const own = ok(save(edited)).flow
    expect(step(own, 'merge').merge).toMatchObject({ branch: 'release' })
    expect(step(own, 'merge').merge?.fromProject ?? []).not.toContain('branch')
    const back = ok(save(useProjectValues(edited, 'merge', project)))
    expect(step(back.flow, 'merge').merge).toMatchObject({ branch: 'develop' })
    expect(step(back.flow, 'merge').merge?.fromProject).toEqual(expect.arrayContaining(['branch', 'auto']))
  })
})

type Reply = { result?: unknown; isError?: boolean }
const flowTool = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orquestrador__flow', ...input } as never) as Promise<Reply>

test('1.3 flow list and flow start read config.json from the checkout', async ($, on) => {
  const disk = new Map<string, string>()
  mock.store(on)
  on('env.get', () => ({ value: '/h' }))
  on('clock.now', () => ({ value: 1_000 }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  on('fs.exists', ($$, e) => ({ value: disk.has(e.path) || [...disk.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.read', ($$, e) => ({ value: disk.get(e.path) ?? '' }))
  on('fs.write', ($$, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($$, e) => ({
    value: [...disk.keys()]
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
  }))
  on('tool.list', () => ({ value: [] as never }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  disk.set('/w/.orquestrador/flows/trunk.json', JSON.stringify(TRUNK))
  disk.set('/w/.orquestrador/config.json', JSON.stringify({ merge: { branch: 'develop', auto: true } }))
  const listed = String((await flowTool($, { action: 'list' })).result)
  expect(listed).toContain('merge automático — do projeto: branch, auto')
  const started = await flowTool($, { action: 'start', change: 'demo', flow: 'trunk' })
  expect(started.isError).toBeUndefined()
  const key = [...disk.keys()].find(k => k.endsWith('/demo.json'))
  const saved = JSON.parse(disk.get(key ?? '') ?? '{}') as { flow: FlowDef }
  expect(step(saved.flow, 'merge').merge).toMatchObject({ branch: 'develop', auto: true })
  expect(step(saved.flow, 'merge').kind).toBe('automatic')
})
