import type { EngineInterface } from 'claude-code'

import type { ActivationLevel } from '../types'

/** The file the activation lives in: local to the clone, kept out of git, read by Claude Code on every change. */
export const SETTINGS_PATH = '.claude/settings.local.json'
export const LEVELS: readonly ActivationLevel[] = ['barrar', 'lembrar']
/** The word in the hook's command by which "Desativar" finds the hook the mod put there, and only it. */
export const HOOK_MARK = 'orquestrador:ativar'

/** What the SessionStart hook prints: stdout of a `command` hook becomes context for the session. */
export const HOOK_COMMAND =
  'printf \'%s\\n\' "Orquestrador ativo neste clone (nível: ${ORQUESTRADOR:-barrar}). Siga o flow da change em andamento; ' +
  'passos do dono, só o dono responde no painel (/orquestrador); sem merge --admin e sem pular portões." ' +
  `# ${HOOK_MARK}`

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The file's text as an object, or why it is not one; an empty or absent file is an empty object. */
export const parseSettings = (text: string | undefined): { data: Json } | { error: 'notJson' | 'notObject' } => {
  if (text === undefined || text.trim() === '') return { data: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: 'notJson' }
  }
  return isRecord(parsed) ? { data: parsed } : { error: 'notObject' }
}

/** The level the file marks, or none: only the two known words count. */
export const levelOf = (data: Json): ActivationLevel | undefined => {
  const env = data.env
  const level = isRecord(env) ? env.ORQUESTRADOR : undefined
  return LEVELS.find(l => l === level)
}

const ours = (hook: unknown): boolean => isRecord(hook) && typeof hook.command === 'string' && hook.command.includes(HOOK_MARK)

/** The SessionStart groups without the mod's hook; a group left with no hook goes too. */
const withoutOurs = (groups: unknown): unknown[] =>
  (Array.isArray(groups) ? groups : []).flatMap((group: unknown) => {
    if (!isRecord(group) || !Array.isArray(group.hooks)) return [group]
    const kept = group.hooks.filter(h => !ours(h))
    if (kept.length === group.hooks.length) return [group]
    return kept.length === 0 ? [] : [{ ...group, hooks: kept }]
  })

/** The settings with the mark at `level` and the mod's hook; every other key and hook as it was. */
export const activate = (data: Json, level: ActivationLevel): Json => {
  const next: Json = { ...data }
  next.env = { ...(isRecord(data.env) ? data.env : {}), ORQUESTRADOR: level }
  const hooks: Json = isRecord(data.hooks) ? { ...data.hooks } : {}
  hooks.SessionStart = [...withoutOurs(hooks.SessionStart), { hooks: [{ type: 'command', command: HOOK_COMMAND }] }]
  next.hooks = hooks
  return next
}

/** The settings without the mark and the mod's hook, and without the `env`/`hooks` keys that leaves empty. */
export const deactivate = (data: Json): Json => {
  const next: Json = { ...data }
  if (isRecord(data.env)) {
    const { ORQUESTRADOR: _gone, ...env } = data.env
    if (Object.keys(env).length === 0) delete next.env
    else next.env = env
  }
  if (isRecord(data.hooks)) {
    const { SessionStart: groups, ...hooks } = data.hooks
    if (groups !== undefined) {
      const kept = withoutOurs(groups)
      if (kept.length > 0) (hooks as Json).SessionStart = kept
    }
    if (Object.keys(hooks).length === 0) delete next.hooks
    else next.hooks = hooks
  }
  return next
}

export const settingsText = (data: Json): string => `${JSON.stringify(data, null, 2)}\n`

/**
 * The repository's main checkout and its git dir: a worktree reads the main checkout's settings,
 * so the activation lives there. Without git, the session's own folder.
 */
const found = new Map<string, { root: string; gitDir: string }>()
export async function projectRoot($: EngineInterface): Promise<{ root: string; gitDir: string | undefined }> {
  const cwd = await $.session.root()
  const known = found.get(cwd)
  if (known !== undefined) return known
  const ran = await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, timeoutMs: 10_000 }).catch(() => undefined)
  const dir = ran?.exitCode === 0 ? ran.stdout.trim() : ''
  if (dir.startsWith('/') && dir.endsWith('/.git')) {
    const here = { root: dir.slice(0, -'/.git'.length), gitDir: dir }
    found.set(cwd, here)
    return here
  }
  return { root: cwd, gitDir: undefined }
}

/**
 * What the clone's mark says and what the mod trusts. `level` is the one that counts; `tampered` is true when the
 * file's mark differs from what the panel wrote (a "lembrar" the panel never wrote, or a mark taken away).
 */
export type Activation = { level: ActivationLevel | undefined; invalid: boolean; tampered: boolean }

/** The level the panel itself wrote for each repository, by the main checkout's path: in the mod's own state, which no tool of the model writes. */
const RECORD = { plugin: 'orquestrador', key: 'activationRecord' } as const

async function recordedLevel($: EngineInterface, root: string): Promise<ActivationLevel | undefined> {
  const { value } = await $.state.get(RECORD)
  const level = value?.[root]
  return LEVELS.find(l => l === level)
}

/** Remembers the level the panel wrote for `root` (`null`: the panel took the activation back). */
export async function recordLevel($: EngineInterface, root: string, level: ActivationLevel | null): Promise<void> {
  const { value } = await $.state.get(RECORD)
  const { [root]: _old, ...others } = value ?? {}
  await $.state.set(RECORD, level === null ? others : { ...others, [root]: level })
}

/** The file's text; `undefined` only when it is absent. A read that fails throws: it is not "absent". */
async function readSettings($: EngineInterface, path: string): Promise<string | undefined> {
  return (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
}

/**
 * The level that counts, read from the file itself so it counts at once, with no restart, but only as far as the
 * panel's record backs it: "barrar" stands alone (the strictest); "lembrar" lowers the guard, so it counts only
 * when it is what the panel wrote; a mark with no record or another one is "barrar". A mark taken away or a file
 * that cannot be parsed after the panel activated is still "barrar". A file that cannot be read is "barrar" too:
 * only a confirmed absence of mark leaves the mod quiet. Throws when the state cannot be read.
 */
export async function readActivation($: EngineInterface): Promise<Activation> {
  const { root } = await projectRoot($)
  const recorded = await recordedLevel($, root)
  let text: string | undefined
  try {
    text = await readSettings($, `${root}/${SETTINGS_PATH}`)
  } catch {
    return { level: 'barrar', invalid: true, tampered: recorded !== undefined }
  }
  const parsed = parseSettings(text)
  const marked = 'error' in parsed ? undefined : levelOf(parsed.data)
  const invalid = 'error' in parsed
  if (marked === 'barrar') return { level: 'barrar', invalid, tampered: false }
  if (marked === 'lembrar') return recorded === 'lembrar' ? { level: 'lembrar', invalid, tampered: false } : { level: 'barrar', invalid, tampered: true }
  return recorded === undefined ? { level: undefined, invalid, tampered: false } : { level: 'barrar', invalid, tampered: true }
}

/**
 * Keeps the file out of git: the clone's exclude, never the .gitignore. Only `git check-ignore` exiting 1
 * (not ignored) adds the line; any other code (128: git failed) leaves the exclude alone. Throws when it cannot write.
 */
async function ensureIgnored($: EngineInterface, root: string, gitDir: string | undefined): Promise<void> {
  if (gitDir === undefined) return
  const ran = await $.process.run(['git', '-C', root, 'check-ignore', '-q', SETTINGS_PATH], { cwd: root, timeoutMs: 10_000 }).catch(() => undefined)
  if (ran === undefined || ran.exitCode !== 1) return
  const exclude = `${gitDir}/info/exclude`
  const prior = (await readSettings($, exclude)) ?? ''
  if (prior.split('\n').some(l => l.trim() === SETTINGS_PATH || l.trim() === `**/${SETTINGS_PATH}`)) return
  await $.fs.write(exclude, `${prior}${prior === '' || prior.endsWith('\n') ? '' : '\n'}${SETTINGS_PATH}\n`)
}

export type Written = { ok: true } | { ok: false; error: 'notJson' | 'notObject' | 'unreadable' | 'badHooks' | 'notIgnored' }

/**
 * Turns the activation on at `level`, or off with `null`. A file that is not a JSON object, that cannot be read,
 * or whose `hooks.SessionStart` is not a list is left untouched; so is a write with nothing to change.
 */
export async function writeActivation($: EngineInterface, level: ActivationLevel | null): Promise<Written> {
  const written = await writeFile($, level)
  // the panel's record follows the file: what the panel wrote is what the mod trusts
  if (written.ok) {
    await recordLevel($, (await projectRoot($)).root, level)
    await $.state.set({ plugin: 'orquestrador', key: 'reminded' }, null) // a new level (or none) starts a new count of warnings
  }
  return written
}

async function writeFile($: EngineInterface, level: ActivationLevel | null): Promise<Written> {
  const { root, gitDir } = await projectRoot($)
  const path = `${root}/${SETTINGS_PATH}`
  let text: string | undefined
  try {
    text = await readSettings($, path)
  } catch {
    return { ok: false, error: 'unreadable' }
  }
  const parsed = parseSettings(text)
  if ('error' in parsed) return { ok: false, error: parsed.error }
  if (level === null && text === undefined) return { ok: true }
  const groups = isRecord(parsed.data.hooks) ? parsed.data.hooks.SessionStart : undefined
  if (groups !== undefined && !Array.isArray(groups)) return { ok: false, error: 'badHooks' }
  const next = settingsText(level === null ? deactivate(parsed.data) : activate(parsed.data, level))
  if (next === text) return { ok: true }
  if (text === undefined) {
    // the exclude comes first: a file git would show must never exist, so a failure here writes nothing
    try {
      await ensureIgnored($, root, gitDir)
    } catch {
      return { ok: false, error: 'notIgnored' }
    }
  }
  await $.fs.write(path, next) // creates `.claude/` when it is missing
  return { ok: true }
}
