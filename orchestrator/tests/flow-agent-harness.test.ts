import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Reply = { result?: unknown; isError?: boolean }

/** A coordinator at /w with an in-memory disk. */
const world = (on: On, plugin: string[] = []): Map<string, string> => {
  mock.store(on)
  const disk = new Map<string, string>()
  on('env.get', () => ({ value: '/h' }))
  let now = 1_000
  on('clock.now', () => ({ value: (now += 10) }))
  on('session.root', () => ({ value: '/w' }))
  on('session.repo', () => ({ value: null }))
  // The plugin's own files live outside /w: its agents exist when `plugin` says so.
  on('fs.exists', ($, e) => ({
    value:
      disk.has(e.path) ||
      [...disk.keys()].some(k => k.startsWith(`${e.path}/`)) ||
      (!e.path.startsWith('/w/') && [...plugin].some(name => e.path.endsWith(`/agents/${name}.md`))),
  }))
  on('fs.read', ($, e) => ({ value: disk.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: [...disk.keys()]
      .filter(k => k.startsWith(`${e.path}/`) && !k.slice(e.path.length + 1).includes('/'))
      .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never,
  }))
  on('tool.list', () => ({ value: [] as never }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  return disk
}

const flow = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__orchestrator__flow', ...input } as never) as Promise<Reply>

const status = async ($: Engine) => String((await flow($, { action: 'status' })).result)

test('status names the plugin agent, with its path, model, effort and details', async ($, on) => {
  world(on, ['planner'])
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const text = await status($)
  expect(text).toMatch(/Agente: "planner" \(do plugin\)\. Instruções do agente: \S+\/agents\/planner\.md/)
  expect(text).toMatch(/Modelo: claude-opus-5-5/)
  expect(text).toMatch(/Esforço: high/)
  expect(text).toMatch(/Entrada: O pedido do dono/)
  expect(text).toMatch(/Saída: proposal\.md e tasks\.md/)
  expect(text).toMatch(/Bloqueia: Sem plano escrito/)
})

test("the project's agent wins over the plugin's", async ($, on) => {
  const disk = world(on, ['planner'])
  disk.set('/w/.orchestrator/agents/planner.md', '# meu planner')
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const text = await status($)
  expect(text).toMatch(/\(do projeto\)\. Instruções do agente: \/w\/\.orchestrator\/agents\/planner\.md/)
  expect(text).not.toMatch(/do plugin/)
})

test('2.3 a project agent under the old name (.orquestrador/agents/planejador.md) is the one a flow asking for planner gets', async ($, on) => {
  const disk = world(on, ['planner'])
  disk.set('/w/.orquestrador/agents/planejador.md', '# meu planejador')
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const text = await status($)
  expect(text).toMatch(/Agente: "planner" \(do projeto\)\. Instruções do agente: \/w\/\.orquestrador\/agents\/planejador\.md/)
  expect(text).not.toMatch(/do plugin/)
})

test('2.3 with planner.md and planejador.md in the project, planner.md wins', async ($, on) => {
  const disk = world(on, ['planner'])
  disk.set('/w/.orchestrator/agents/planejador.md', '# o antigo')
  disk.set('/w/.orchestrator/agents/planner.md', '# o novo')
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  expect(await status($)).toMatch(/\(do projeto\)\. Instruções do agente: \/w\/\.orchestrator\/agents\/planner\.md/)
})

test("2.3 with neither in the project, the plugin's agent comes", async ($, on) => {
  const disk = world(on, ['planner'])
  disk.set('/w/.orchestrator/agents/outro.md', '# outro agente')
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const text = await status($)
  expect(text).toMatch(/Agente: "planner" \(do plugin\)\. Instruções do agente: \S+\/agents\/planner\.md/)
  expect(text).not.toMatch(/do projeto/)
})

test('an agent no file holds is said so, without an error, naming the folder the project uses', async ($, on) => {
  const disk = world(on)
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const reply = await flow($, { action: 'status' })
  expect(reply.isError).toBeUndefined()
  expect(String(reply.result)).toMatch(/Agente: "planner" — nenhum arquivo encontrado \(nem \.orchestrator\/agents\/planner\.md no projeto/)
  disk.set('/w/.orquestrador/config.json', '{}')
  expect(await status($)).toMatch(/nem \.orquestrador\/agents\/planner\.md no projeto/)
})

test('2.2 a flow going since 0.14.1, with "revisor-codigo" in its saved state, reads as code-reviewer by change and in the list', async ($, on) => {
  const disk = world(on, ['code-reviewer'])
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const path = [...disk.keys()].find(k => k.endsWith('/flows/demo.json'))!
  const saved = JSON.parse(disk.get(path)!) as { current: string; flow: { steps: { id: string; agent?: string }[] } }
  saved.current = 'revisao-codigo'
  for (const step of saved.flow.steps) if (step.id === 'revisao-codigo') step.agent = 'revisor-codigo'
  disk.set(path, JSON.stringify(saved))
  // by change: loadFlowState
  const byChange = String((await flow($, { action: 'status', change: 'demo' })).result)
  expect(byChange).toMatch(/Agente: "code-reviewer" \(do plugin\)/)
  expect(byChange).not.toMatch(/revisor-codigo/)
  // with no change named: the list of every flow, allFlowStates
  const listed = await status($)
  expect(listed).toMatch(/Agente: "code-reviewer" \(do plugin\)/)
  expect(listed).not.toMatch(/revisor-codigo/)
})

test('a step with no agent says no agent, and an owner step carries none', async ($, on) => {
  const disk = world(on)
  disk.set(
    '/w/.orquestrador/flows/solo.json',
    JSON.stringify({ id: 'solo', title: 'Solo', steps: [{ id: 'fazer', title: 'Fazer', kind: 'session', outcomes: { feito: { label: 'Feito', next: 'fim' } } }] }),
  )
  await flow($, { action: 'start', change: 'demo', flow: 'solo' })
  const text = await status($)
  expect(text).not.toMatch(/Agente:/)
  expect(text).not.toMatch(/Neste passo/)
})

test('the executar loop says the agent each phase uses', async ($, on) => {
  const disk = world(on, ['executor'])
  disk.set(
    '/w/.orquestrador/flows/fases.json',
    JSON.stringify({
      id: 'fases',
      title: 'Fases',
      steps: [{ id: 'executar', title: 'Executar', kind: 'loop', over: 'tasks', agent: 'executor', outcomes: { concluidas: { label: 'Fases fechadas', next: 'fim' } } }],
    }),
  )
  await flow($, { action: 'start', change: 'demo', flow: 'fases' })
  const text = await status($)
  expect(text).toMatch(/Cada fase deste passo usa:\n  Agente: "executor" \(do plugin\)/)
})

test('flow list shows each workflow whole: description, origin, steps with their answerers, and file errors', async ($, on) => {
  const disk = world(on)
  disk.set(
    '/w/.orquestrador/flows/trunk.json',
    JSON.stringify({ id: 'trunk', title: 'Trunk', base: 'rapido', add: [{ after: 'pr', step: 'merge' }] }),
  )
  disk.set('/w/.orquestrador/flows/casa.json', JSON.stringify({ id: 'casa', title: 'Casa', description: 'Do jeito da casa.', steps: [{ id: 'fazer', title: 'Fazer', kind: 'session', outcomes: { feito: { label: 'Feito', next: 'fim' } } }] }))
  disk.set('/w/.orquestrador/flows/quebrado.json', '{ not json')
  const listed = String((await flow($, { action: 'list' })).result)
  expect(listed).toMatch(/^completo — Completo: grill → mockup → planejar/)
  expect(listed).toMatch(/completo[^]*Descrição: [^\n]+\n  Origem: padrão\n  Passos: grill \(dono\)/)
  expect(listed).toMatch(/trunk — Trunk:[^\n]*\n  Descrição:[^\n]*\n  Origem: derivado de rapido/)
  expect(listed).toMatch(/casa — Casa: fazer → fim\n  Descrição: Do jeito da casa\.\n  Origem: do projeto\n  Passos: fazer \(sessão\)/)
  expect(listed).toMatch(/merge \([^)]*merge manual/)
  expect(listed).toMatch(/ignored: \/w\/\.orquestrador\/flows\/quebrado\.json: not valid JSON/)
})
