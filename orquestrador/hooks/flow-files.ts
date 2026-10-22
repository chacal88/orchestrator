import type { EngineInterface } from 'claude-code'

import type { FlowDef, Languages, ProjectSettings } from '../types'
import { mergeFlows, resolveProjectFlows } from './flow'
import type { AgentFound, FlowSource } from './flow'
import { DEFAULT_FLOWS, defaultFlows } from './flows/index'
import { isAgentName } from './gates'
import { CONFIG_PATH, parseConfig } from './i18n'

// Function declarations: the engine follows `$` past an import only into one of these.

/** Every flow file of one folder as read, the ones that are not JSON named in `problems`. */
export async function readFlowDir($: EngineInterface, dir: string): Promise<{ files: FlowSource[]; problems: string[] }> {
  if (!(await $.fs.exists(dir))) return { files: [], problems: [] }
  const entries = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json'))
  const files: FlowSource[] = []
  const problems: string[] = []
  for (const file of entries) {
    try {
      files.push({ source: `${dir}/${file.name}`, raw: JSON.parse(await $.fs.read(`${dir}/${file.name}`)) })
    } catch {
      problems.push(`${dir}/${file.name}: not valid JSON.`)
    }
  }
  return { files, problems }
}

export type LoadedConfig = {
  languages: Languages
  project: ProjectSettings
  problems: string[]
  /** The file's text as read, so a save can change only its own keys. */
  text: string | undefined
}

/** The project's settings from `config.json`, read fresh; a file that cannot be read counts as absent. */
export async function loadConfig($: EngineInterface): Promise<LoadedConfig> {
  const root = await $.session.root()
  const read = async (path: string): Promise<string | undefined> => {
    try {
      return (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
    } catch {
      return undefined
    }
  }
  const text = await read(`${root}/${CONFIG_PATH}`)
  return { ...parseConfig(text), text }
}

export type LoadedFlows = {
  /** The project's merge and deploy settings the flows inherited. */
  config: LoadedConfig
  flows: Record<string, FlowDef>
  problems: string[]
  projectIds: Set<string>
  /** The project's flow files as read, and their folder. */
  files: FlowSource[]
  dir: string
}

/**
 * The mod's default flows, then the project's own in `<repo>/.orquestrador/flows`, which win by id;
 * a project flow derived from another is resolved, and one that does not resolve is named in `problems`.
 */
export async function loadFlows($: EngineInterface): Promise<LoadedFlows> {
  const dir = `${await $.session.root()}/.orquestrador/flows`
  const read = await readFlowDir($, dir)
  const config = await loadConfig($)
  const project = resolveProjectFlows(DEFAULT_FLOWS, read.files, config.project)
  return {
    config,
    files: read.files,
    dir,
    flows: mergeFlows(defaultFlows(), project.flows),
    problems: [...read.problems, ...project.problems],
    projectIds: new Set(project.flows.map(f => f.id)),
  }
}

/**
 * A step's agent: the project's `.orquestrador/agents/<name>.md` wins over the plugin's `agents/<name>.md`.
 * A name that is not one (`../x`) builds no path: no agent.
 */
export async function findAgent($: EngineInterface, name: string): Promise<AgentFound> {
  if (!isAgentName(name)) return undefined
  const project = `${await $.session.root()}/.orquestrador/agents/${name}.md`
  if (await $.fs.exists(project)) return { source: 'project', path: project }
  const plugin = `${$.plugin.root}/agents/${name}.md`
  return (await $.fs.exists(plugin)) ? { source: 'plugin', path: plugin } : undefined
}

/** An agent the owner can pick for a step, as its file's frontmatter says. */
export type AgentInfo = { name: string; description: string; model: string | undefined; source: 'project' | 'plugin' }

const frontmatter = (text: string): Record<string, string> => {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  return Object.fromEntries(
    head.split(/\r?\n/).flatMap(line => {
      const at = line.indexOf(':')
      return at <= 0 ? [] : [[line.slice(0, at).trim(), line.slice(at + 1).trim()] as const]
    }),
  )
}

/**
 * The agents on offer: the plugin's `agents/*.md` and the project's `.orquestrador/agents/*.md`, by name;
 * a project agent of the same name replaces the plugin's, as `findAgent` has it.
 */
export async function listAgents($: EngineInterface): Promise<AgentInfo[]> {
  const found = new Map<string, AgentInfo>()
  const dirs = [
    ['plugin', `${$.plugin.root}/agents`],
    ['project', `${await $.session.root()}/.orquestrador/agents`],
  ] as const
  for (const [source, dir] of dirs) {
    if (!(await $.fs.exists(dir))) continue
    for (const file of await $.fs.list(dir)) {
      if (file.kind !== 'file' || !file.name.endsWith('.md')) continue
      const name = file.name.slice(0, -3)
      if (!isAgentName(name)) continue
      const head = frontmatter(await $.fs.read(`${dir}/${file.name}`))
      found.set(name, { name, source, description: head.description ?? '', model: head.model === undefined || head.model === '' ? undefined : head.model })
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}
