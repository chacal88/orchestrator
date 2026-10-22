import type { EngineInterface } from 'claude-code'

import type { FlowDef } from '../types'
import { mergeFlows, resolveProjectFlows } from './flow'
import type { AgentFound, FlowSource } from './flow'
import { DEFAULT_FLOWS, defaultFlows } from './flows/index'

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

export type LoadedFlows = {
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
  const project = resolveProjectFlows(DEFAULT_FLOWS, read.files)
  return {
    files: read.files,
    dir,
    flows: mergeFlows(defaultFlows(), project.flows),
    problems: [...read.problems, ...project.problems],
    projectIds: new Set(project.flows.map(f => f.id)),
  }
}

/** A step's agent: the project's `.orquestrador/agents/<name>.md` wins over the plugin's `agents/<name>.md`. */
export async function findAgent($: EngineInterface, name: string): Promise<AgentFound> {
  const project = `${await $.session.root()}/.orquestrador/agents/${name}.md`
  if (await $.fs.exists(project)) return { source: 'project', path: project }
  const plugin = `${$.plugin.root}/agents/${name}.md`
  return (await $.fs.exists(plugin)) ? { source: 'plugin', path: plugin } : undefined
}
