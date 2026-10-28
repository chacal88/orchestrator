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
  world(on, ['planejador'])
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const text = await status($)
  expect(text).toMatch(/Agente: "planejador" \(do plugin\)\. Instruções do agente: \S+\/agents\/planejador\.md/)
  expect(text).toMatch(/Modelo: claude-opus-5-5/)
  expect(text).toMatch(/Esforço: high/)
  expect(text).toMatch(/Entrada: O pedido do dono/)
  expect(text).toMatch(/Saída: proposal\.md e tasks\.md/)
  expect(text).toMatch(/Bloqueia: Sem plano escrito/)
})

test("the project's agent wins over the plugin's", async ($, on) => {
  const disk = world(on, ['planejador'])
  disk.set('/w/.orquestrador/agents/planejador.md', '# meu planejador')
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const text = await status($)
  expect(text).toMatch(/\(do projeto\)\. Instruções do agente: \/w\/\.orquestrador\/agents\/planejador\.md/)
  expect(text).not.toMatch(/do plugin/)
})

test('an agent no file holds is said so, without an error', async ($, on) => {
  world(on)
  await flow($, { action: 'start', change: 'demo', flow: 'rapido' })
  const reply = await flow($, { action: 'status' })
  expect(reply.isError).toBeUndefined()
  expect(String(reply.result)).toMatch(/Agente: "planejador" — nenhum arquivo encontrado/)
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
