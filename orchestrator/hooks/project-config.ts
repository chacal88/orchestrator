import type { EngineInterface } from 'claude-code'

import type { ProjectDeploy, ProjectMerge, ProjectSettings } from '../types'

/** The project's own folder, under its repository root. */
export const PROJECT_DIR = '.orchestrator'
/** The folder's name before 0.15.0, still read (and written) where the project has only it. */
export const LEGACY_DIR = '.orquestrador'
/** The project's settings file, inside its folder. */
export const CONFIG_FILE = 'config.json'

/** The project's folder: `dir` the absolute path, `name` the folder as a text names it, `legacy` when it is the old one. */
export type ProjectDir = { dir: string; name: string; legacy: boolean }

/**
 * Where the project keeps its config, flows and agents: `.orchestrator/` when it exists, else the old
 * one (`LEGACY_DIR`) when only that one does, else the new one. A write goes where the read went, so a
 * project never ends up with half of its settings in each folder.
 */
export async function projectDir($: EngineInterface, root: string): Promise<ProjectDir> {
  const fresh = { dir: `${root}/${PROJECT_DIR}`, name: PROJECT_DIR, legacy: false }
  if (await $.fs.exists(fresh.dir)) return fresh
  const old = `${root}/${LEGACY_DIR}`
  return (await $.fs.exists(old)) ? { dir: old, name: LEGACY_DIR, legacy: true } : fresh
}

export const MERGE_METHODS = ['squash', 'merge', 'rebase'] as const
/** The fields of each block, in the order the step records which of them came from the project. */
export const MERGE_KEYS = ['branch', 'method', 'auto'] as const
export const DEPLOY_KEYS = ['ci', 'commands', 'auto'] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const word = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

/** A git branch name as a merge step names it: no spaces, line breaks or leading dash, so it never carries more than a name. */
export const isBranchName = (v: string): boolean => /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/.test(v) && !v.includes('..')

/**
 * The `merge` and `deploy` blocks of one config file, each field checked: a wrong value or an unknown
 * key is named in `problems` and left out, never guessed.
 */
export const parseProjectBlocks = (raw: Record<string, unknown>): { settings: Required<ProjectSettings>; problems: string[] } => {
  const problems: string[] = []
  const merge: ProjectMerge = {}
  const deploy: ProjectDeploy = {}
  const block = (name: 'merge' | 'deploy', keys: readonly string[]): Record<string, unknown> | undefined => {
    const value = raw[name]
    if (value === undefined) return undefined
    if (!isRecord(value)) {
      problems.push(`${name} must be an object (${keys.join(', ')}).`)
      return undefined
    }
    for (const key of Object.keys(value)) if (!keys.includes(key)) problems.push(`${name}.${key} is not a setting (${keys.join(', ')}).`)
    return value
  }
  const flag = (b: Record<string, unknown>, name: string, key: string): boolean | undefined => {
    if (b[key] === undefined) return undefined
    if (typeof b[key] === 'boolean') return b[key]
    problems.push(`${name}.${key} must be true or false.`)
    return undefined
  }
  const m = block('merge', MERGE_KEYS)
  if (m !== undefined) {
    if (m.branch !== undefined) {
      const branch = word(m.branch)
      if (branch === undefined || !isBranchName(branch)) problems.push('merge.branch must be a branch name (letters, digits, . _ / -).')
      else merge.branch = branch
    }
    if (m.method !== undefined) {
      if (typeof m.method === 'string' && (MERGE_METHODS as readonly string[]).includes(m.method)) merge.method = m.method as ProjectMerge['method']
      else problems.push(`merge.method must be one of ${MERGE_METHODS.join(', ')}.`)
    }
    const auto = flag(m, 'merge', 'auto')
    if (auto !== undefined) merge.auto = auto
  }
  const d = block('deploy', DEPLOY_KEYS)
  if (d !== undefined) {
    const ci = flag(d, 'deploy', 'ci')
    if (ci !== undefined) deploy.ci = ci
    const auto = flag(d, 'deploy', 'auto')
    if (auto !== undefined) deploy.auto = auto
    if (d.commands !== undefined) {
      const list = typeof d.commands === 'string' ? [d.commands] : d.commands
      if (Array.isArray(list) && list.every(c => word(c) !== undefined)) deploy.commands = list.map(c => word(c) as string)
      else problems.push('deploy.commands must be a list of commands.')
    }
    // a deploy that waits on no CI and runs no routine would leave every workflow's deploy step with nothing to do
    if (deploy.ci === false && (deploy.commands ?? []).length === 0) {
      problems.push('deploy.ci is false with no commands: a deploy needs the CI, routines, or both.')
      delete deploy.ci
    }
  }
  return { settings: { merge, deploy }, problems }
}
