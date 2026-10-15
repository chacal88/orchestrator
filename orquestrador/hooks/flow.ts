import type {
  FlowActor,
  FlowChoice,
  FlowDef,
  FlowDetect,
  FlowEvent,
  FlowOutcome,
  FlowState,
  FlowStep,
  FlowStepKind,
  FlowStepView,
  FlowView,
} from '../types'
import { executedText, masksExitCode } from './gates'

/** The pseudo-step every flow ends on. */
export const FLOW_END = 'fim'
export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_FLOW_IDS = ['completo', 'rapido'] as const

/** An escalation's two answers, pressed only by the owner. */
export const ESCALATION_CHOICES: readonly FlowChoice[] = [
  { outcome: 'tentar-de-novo', label: 'Tentar de novo' },
  { outcome: 'encerrar', label: 'Encerrar o flow' },
]

/** The outcome a loop step ends on, given by the mod once every phase closed. */
export const LOOP_DONE = 'concluidas'

/** Which actor may answer a step of each kind: a session never answers for the owner, a command or the loop. */
const ANSWERED_BY: Record<FlowStepKind, FlowActor> = {
  session: 'session',
  loop: 'mod',
  automatic: 'automatic',
  owner: 'owner',
}

const KINDS = new Set<FlowStepKind>(['session', 'automatic', 'owner', 'loop'])
const AUTOMATIC_OUTCOMES = ['passou', 'falhou']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

/** A flow file, checked whole: every next step exists, every kind is known, every automatic step names its command. */
export const parseFlow = (raw: unknown, source: string): FlowDef | { error: string } => {
  const fail = (why: string) => ({ error: `${source}: ${why}` })
  if (!isRecord(raw)) return fail('a flow is a JSON object.')
  const id = text(raw.id)
  const title = text(raw.title)
  if (id === undefined || title === undefined) return fail('`id` and `title` are required.')
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return fail('`steps` must be a non-empty list.')
  const steps: FlowStep[] = []
  for (const [i, s] of raw.steps.entries()) {
    const where = `step ${i + 1}`
    if (!isRecord(s)) return fail(`${where} is not an object.`)
    const stepId = text(s.id)
    const stepTitle = text(s.title)
    if (stepId === undefined || stepTitle === undefined) return fail(`${where}: \`id\` and \`title\` are required.`)
    if (stepId === FLOW_END) return fail(`${where}: "${FLOW_END}" is reserved for the end of the flow.`)
    if (steps.some(p => p.id === stepId)) return fail(`step id "${stepId}" appears twice.`)
    const kind = s.kind as FlowStepKind
    if (!KINDS.has(kind)) return fail(`step "${stepId}": kind must be session, automatic, owner or loop.`)
    if (!isRecord(s.outcomes) || Object.keys(s.outcomes).length === 0) return fail(`step "${stepId}": \`outcomes\` is required.`)
    const outcomes: Record<string, FlowOutcome> = {}
    for (const [name, o] of Object.entries(s.outcomes)) {
      const next = isRecord(o) ? text(o.next) : text(o)
      if (next === undefined) return fail(`step "${stepId}", outcome "${name}": \`next\` is required.`)
      outcomes[name] = { label: (isRecord(o) ? text(o.label) : undefined) ?? name, next }
    }
    const maxAttempts = s.maxAttempts === undefined ? DEFAULT_MAX_ATTEMPTS : s.maxAttempts
    if (typeof maxAttempts !== 'number' || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
      return fail(`step "${stepId}": \`maxAttempts\` must be a whole number of at least 1.`)
    }
    const command = text(s.command)
    if (kind === 'automatic') {
      if (command === undefined) return fail(`step "${stepId}": an automatic step needs the \`command\` whose exit code decides.`)
      const missing = AUTOMATIC_OUTCOMES.filter(o => outcomes[o] === undefined)
      const extra = Object.keys(outcomes).filter(o => !AUTOMATIC_OUTCOMES.includes(o))
      if (missing.length > 0 || extra.length > 0) {
        return fail(`step "${stepId}": an automatic step has exactly the outcomes passou and falhou.`)
      }
    }
    if (s.when !== undefined && s.when !== 'visual') return fail(`step "${stepId}": \`when\` may only be "visual".`)
    if (s.over !== undefined && s.over !== 'tasks') return fail(`step "${stepId}": \`over\` may only be "tasks".`)
    if (kind === 'loop' && outcomes[LOOP_DONE] === undefined) {
      return fail(`step "${stepId}": a loop step declares the outcome ${LOOP_DONE}, given when every phase closed.`)
    }
    const detect = parseDetect(s.detect, outcomes)
    if (typeof detect === 'string') return fail(`step "${stepId}": ${detect}`)
    steps.push({
      id: stepId,
      title: stepTitle,
      description: text(s.description),
      kind,
      outcomes,
      maxAttempts,
      command,
      requiresEvidence: s.requiresEvidence === true,
      when: s.when === 'visual' ? 'visual' : undefined,
      over: kind === 'loop' ? 'tasks' : undefined,
      detect,
      cleanup: s.cleanup === true,
    })
  }
  const ids = new Set(steps.map(s => s.id))
  for (const step of steps) {
    for (const [name, o] of Object.entries(step.outcomes)) {
      if (o.next !== FLOW_END && !ids.has(o.next)) {
        return fail(`step "${step.id}", outcome "${name}" goes to "${o.next}", which is no step of this flow.`)
      }
    }
  }
  return { id, title, description: text(raw.description) ?? '', steps }
}

/**
 * A step's `detect`: one command or a list (`"vercel --prod"`), or `{ commands, outcome }`; the
 * outcome may be left out when the step declares only one.
 */
const parseDetect = (raw: unknown, outcomes: Record<string, FlowOutcome>): FlowDetect | undefined | string => {
  if (raw === undefined) return undefined
  const spec = isRecord(raw) ? raw : { commands: raw }
  const list = typeof spec.commands === 'string' ? [spec.commands] : spec.commands
  const commands = Array.isArray(list) ? list.map(text).filter((c): c is string => c !== undefined) : []
  if (commands.length === 0) return '`detect` needs at least one command.'
  const names = Object.keys(outcomes)
  const outcome = text(spec.outcome) ?? (names.length === 1 ? names[0] : undefined)
  if (outcome === undefined || outcomes[outcome] === undefined) {
    return `\`detect.outcome\` must name one of the step's outcomes (${names.join(', ')}).`
  }
  return { commands, outcome }
}

/** The flows on offer: the mod's defaults, each replaced by a project's flow of the same id. */
export const mergeFlows = (defaults: readonly FlowDef[], project: readonly FlowDef[]): Record<string, FlowDef> => {
  const all: Record<string, FlowDef> = {}
  for (const flow of [...defaults, ...project]) all[flow.id] = flow
  return all
}

export type Moved = { state: FlowState; events: FlowEvent[] }

export const stepOf = (flow: FlowDef, id: string): FlowStep | undefined => flow.steps.find(s => s.id === id)
const indexOf = (flow: FlowDef, id: string): number => flow.steps.findIndex(s => s.id === id)

const applies = (step: FlowStep, state: FlowState): boolean => step.when !== 'visual' || state.traits.visual

/**
 * Enters `target`: skips steps whose trait the change lacks, forgets the outcomes of the target and
 * every step after it (they must be done again), and counts the attempt. A session's or a command's
 * outcome that would enter a step past its ceiling escalates to the owner instead; the owner's own
 * press never does, since the owner already chose.
 */
const enter = (state: FlowState, target: string, by: FlowActor, cause: { from: string; outcome: string }, at: number): Moved => {
  const events: FlowEvent[] = []
  let seq = state.seq
  const push = (e: Omit<FlowEvent, 'seq' | 'at'>) => events.push({ seq: ++seq, at, ...e })
  let id = target
  while (id !== FLOW_END) {
    const step = stepOf(state.flow, id)
    if (step === undefined || applies(step, state)) break
    push({ kind: 'skipped', step: id, by: 'mod', note: `only when the change is ${step.when}` })
    id = state.flow.steps[indexOf(state.flow, id) + 1]?.id ?? FLOW_END
  }
  if (id === FLOW_END) {
    push({ kind: 'done', step: FLOW_END, by: 'mod' })
    return { state: { ...state, current: FLOW_END, status: 'done', escalation: undefined, seq, updatedAt: at }, events }
  }
  const step = stepOf(state.flow, id) as FlowStep
  const from = indexOf(state.flow, id)
  const records = Object.fromEntries(
    Object.entries(state.records).filter(([sid]) => indexOf(state.flow, sid) < from),
  )
  // going back keeps why (e.g. QA's request), until the flow reaches that step again
  const cause_ = state.records[cause.from]
  const source = stepOf(state.flow, cause.from)
  const reopened =
    cause_ !== undefined && source !== undefined && from <= indexOf(state.flow, cause.from)
      ? {
          step: cause.from,
          outcome: cause.outcome,
          label: source.outcomes[cause.outcome]?.label ?? cause.outcome,
          by: cause_.by,
          at,
          ...(cause_.note === undefined ? {} : { note: cause_.note }),
        }
      : state.reopened !== undefined && id !== state.reopened.step
        ? state.reopened
        : undefined
  const { reopened: _drop, ...rest } = state
  state = reopened === undefined ? rest : { ...rest, reopened }
  const attempts = state.attempts[id] ?? 0
  if (by !== 'owner' && attempts >= step.maxAttempts) {
    const escalation = { step: id, from: cause.from, outcome: cause.outcome, attempts }
    push({ kind: 'escalated', step: id, by: 'mod', note: `${attempts} attempts, the ceiling is ${step.maxAttempts}` })
    return { state: { ...state, current: id, status: 'escalated', escalation, records, seq, updatedAt: at }, events }
  }
  push({ kind: 'entered', step: id, by: 'mod' })
  return {
    state: {
      ...state,
      current: id,
      status: 'running',
      escalation: undefined,
      attempts: { ...state.attempts, [id]: attempts + 1 },
      records,
      seq,
      updatedAt: at,
    },
    events,
  }
}

/** A change starts on the flow's first step that applies to it. */
export const startFlow = (
  flow: FlowDef,
  init: { change: string; coordinatorCwd: string; changePath?: string; visual: boolean },
  at: number,
): Moved => {
  const blank: FlowState = {
    change: init.change,
    coordinatorCwd: init.coordinatorCwd,
    ...(init.changePath === undefined ? {} : { changePath: init.changePath }),
    flow,
    traits: { visual: init.visual },
    current: flow.steps[0]!.id,
    status: 'running',
    attempts: {},
    records: {},
    seq: 1,
    startedAt: at,
    updatedAt: at,
  }
  const started: FlowEvent = { seq: 1, at, kind: 'started', step: flow.id, by: 'mod', note: init.visual ? 'visual' : undefined }
  const moved = enter(blank, flow.steps[0]!.id, 'owner', { from: '', outcome: '' }, at)
  return { state: moved.state, events: [JSON.parse(JSON.stringify(started)) as FlowEvent, ...moved.events] }
}

const WHO: Record<FlowActor, string> = {
  session: 'a session (through the flow tool)',
  automatic: 'the mod, watching its command run',
  owner: 'the owner, pressing a button in the panel',
  mod: 'the mod, once every phase is closed (close each with action "close")',
  detect: "the mod, seeing the step's detect command succeed",
}

/**
 * One outcome reported for one step. Refused, with the reason in the model's words, when the flow
 * is not on that step (no skipping ahead or back), when the step's kind is not answered by this
 * actor, or when the step does not declare the outcome.
 */
export const applyOutcome = (
  state: FlowState,
  report: { step: string; outcome: string; by: FlowActor; note?: string },
  at: number,
): Moved | { error: string } => {
  const asked = stepOf(state.flow, report.step)
  if (asked === undefined) {
    return { error: `flow ${state.flow.id} has no step "${report.step}"; its steps are ${state.flow.steps.map(s => s.id).join(', ')}.` }
  }
  if (state.status === 'done') return { error: `the flow of ${state.change} is finished; nothing is left to report.` }
  if (state.status === 'aborted') return { error: `the owner ended the flow of ${state.change}.` }
  const current = stepOf(state.flow, state.current) as FlowStep
  if (state.status === 'escalated') {
    return {
      error:
        `step "${current.id}" (${current.title}) hit its ceiling of ${current.maxAttempts} attempts; ` +
        'the owner decides in the panel whether it goes again.',
    }
  }
  if (report.step !== state.current) {
    const ahead = indexOf(state.flow, report.step) > indexOf(state.flow, state.current)
    return {
      error:
        `the flow of ${state.change} is on "${current.id}" (${current.title}), not on "${report.step}"` +
        (ahead ? ': steps cannot be skipped' : '') +
        `. "${current.id}" is answered by ${WHO[ANSWERED_BY[current.kind]]}.`,
    }
  }
  const detected = report.by === 'detect' && asked.detect !== undefined
  if (ANSWERED_BY[asked.kind] !== report.by && !detected) {
    return { error: `step "${asked.id}" (${asked.title}) is a ${asked.kind} step: only ${WHO[ANSWERED_BY[asked.kind]]} answers it.` }
  }
  if (detected && report.outcome !== asked.detect?.outcome) {
    return { error: `step "${asked.id}": a detected command gives only ${asked.detect?.outcome}.` }
  }
  const outcome = asked.outcomes[report.outcome]
  if (outcome === undefined) {
    return { error: `step "${asked.id}" has no outcome "${report.outcome}"; it declares ${Object.keys(asked.outcomes).join(', ')}.` }
  }
  const note = report.note ?? state.pendingNote
  const record = { outcome: report.outcome, by: report.by, at, ...(note === undefined ? {} : { note }) }
  const reported: FlowEvent = {
    seq: state.seq + 1,
    at,
    kind: 'outcome',
    step: asked.id,
    by: report.by,
    outcome: report.outcome,
    ...(note === undefined ? {} : { note }),
  }
  const { pendingNote: _used, ...unnoted } = state
  const moved = enter(
    { ...unnoted, records: { ...state.records, [asked.id]: record }, seq: state.seq + 1 },
    outcome.next,
    report.by,
    { from: asked.id, outcome: report.outcome },
    at,
  )
  return { state: moved.state, events: [reported, ...moved.events] }
}

/** The owner's answer to an escalation: go again with a fresh count, or end the flow. */
export const resolveEscalation = (state: FlowState, choice: string, at: number): Moved | { error: string } => {
  if (state.status !== 'escalated' || state.escalation === undefined) return { error: 'nothing is escalated.' }
  const step = state.escalation.step
  if (choice === 'encerrar') {
    const event: FlowEvent = { seq: state.seq + 1, at, kind: 'aborted', step, by: 'owner' }
    return { state: { ...state, status: 'aborted', seq: state.seq + 1, updatedAt: at }, events: [event] }
  }
  if (choice !== 'tentar-de-novo') return { error: `an escalation is answered with tentar-de-novo or encerrar, not "${choice}".` }
  const retried: FlowEvent = { seq: state.seq + 1, at, kind: 'retried', step, by: 'owner' }
  const moved = enter(
    { ...state, attempts: { ...state.attempts, [step]: 0 }, seq: state.seq + 1 },
    step,
    'owner',
    { from: state.escalation.from, outcome: state.escalation.outcome },
    at,
  )
  return { state: moved.state, events: [retried, ...moved.events] }
}

/** The owner's press: an escalation's choice while one is open, else the owner step's outcome. */
export const ownerPress = (state: FlowState, step: string, outcome: string, at: number, note?: string): Moved | { error: string } =>
  state.status === 'escalated' && state.escalation?.step === step
    ? resolveEscalation(state, outcome, at)
    : applyOutcome(state, { step, outcome, by: 'owner', ...(note === undefined ? {} : { note }) }, at)

/** Words of a declared command, matched in what the shell ran: `openspec validate` in `npx openspec validate x --strict`. */
const commandPattern = (command: string): RegExp =>
  new RegExp(
    `(^|[\\s/;&|(])${command
      .trim()
      .split(/\s+/)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+')}(?=$|[\\s;&|)])`,
  )

/**
 * What one finished Bash command proves for an automatic step: passou on exit 0, falhou otherwise.
 * A run whose exit code a pipe or `|| true` hides proves a failure, never a pass.
 */
export const automaticOutcome = (step: FlowStep, command: string, failed: boolean): 'passou' | 'falhou' | undefined => {
  if (step.kind !== 'automatic' || step.command === undefined) return undefined
  const code = executedText(command)
  if (!commandPattern(step.command).test(code)) return undefined
  if (!failed && masksExitCode(code)) return undefined
  return failed ? 'falhou' : 'passou'
}

/** A step's detect command seen succeeding: its outcome. A masked exit code or a failure proves nothing. */
export const detectedOutcome = (step: FlowStep, command: string, failed: boolean): string | undefined => {
  if (step.detect === undefined || failed) return undefined
  const code = executedText(command)
  if (masksExitCode(code)) return undefined
  return step.detect.commands.some(c => commandPattern(c).test(code)) ? step.detect.outcome : undefined
}

/** A session's note for the owner step that waits now; it joins the owner's answer. */
export const noteOwnerStep = (state: FlowState, note: string, at: number): Moved | { error: string } => {
  const step = currentStep(state)
  if (step === undefined || state.status !== 'running') return { error: 'no step is waiting.' }
  if (step.kind !== 'owner') return { error: `step "${step.id}" is not the owner's; report its outcome instead.` }
  const event: FlowEvent = { seq: state.seq + 1, at, kind: 'noted', step: step.id, by: 'session', note }
  return { state: { ...state, pendingNote: note, seq: state.seq + 1, updatedAt: at }, events: [event] }
}

export const currentStep = (state: FlowState): FlowStep | undefined =>
  state.status === 'done' || state.status === 'aborted' ? undefined : stepOf(state.flow, state.current)

const stepView = (state: FlowState, step: FlowStep, index: number, currentIndex: number): FlowStepView => {
  const record = state.records[step.id]
  const isCurrent = step.id === state.current && (state.status === 'running' || state.status === 'escalated')
  const finished = state.status === 'done'
  const state_: FlowStepView['state'] = isCurrent
    ? 'current'
    : record !== undefined
      ? 'done'
      : !applies(step, state) && (finished || index < currentIndex)
        ? 'skipped'
        : 'pending'
  return {
    id: step.id,
    title: step.title,
    description: step.description,
    kind: step.kind,
    state: state_,
    attempts: state.attempts[step.id] ?? 0,
    maxAttempts: step.maxAttempts,
    outcome: record?.outcome,
    outcomeLabel: record === undefined ? undefined : step.outcomes[record.outcome]?.label,
  }
}

/** Everything the panel draws of a flow, from the saved state alone. */
export const flowView = (state: FlowState): FlowView => {
  const currentIndex = state.status === 'done' ? state.flow.steps.length : indexOf(state.flow, state.current)
  const steps = state.flow.steps.map((s, i) => stepView(state, s, i, currentIndex))
  const step = currentStep(state)
  const ownerChoices: FlowChoice[] =
    state.status === 'escalated'
      ? [...ESCALATION_CHOICES]
      : step?.kind === 'owner'
        ? Object.entries(step.outcomes).map(([outcome, o]) => ({ outcome, label: o.label }))
        : []
  return {
    change: state.change,
    flowId: state.flow.id,
    flowTitle: state.flow.title,
    status: state.status,
    current: steps.find(s => s.state === 'current'),
    waitingOn: step === undefined ? undefined : state.status === 'escalated' ? 'owner' : ANSWERED_BY[step.kind],
    ownerChoices,
    escalation: state.escalation,
    steps,
  }
}

/** Where the flow stands, in the model's words: the step, who answers it and how. */
export const describeFlow = (state: FlowState): string => {
  const head = `Flow ${state.flow.id} for ${state.change}`
  if (state.status === 'done') return `${head}: finished.`
  if (state.status === 'aborted') return `${head}: ended by the owner.`
  const step = stepOf(state.flow, state.current) as FlowStep
  const where = `${head}: step "${step.id}" (${step.title}), attempt ${state.attempts[step.id] ?? 0} of ${step.maxAttempts}`
  if (state.status === 'escalated') {
    return `${where}; it hit its attempt ceiling and waits on the owner in the panel (retry or end the flow).`
  }
  const outcomes = Object.entries(step.outcomes).map(([o, d]) => `${o} → ${d.next}`).join(', ')
  const back = state.reopened
  const reopened =
    back === undefined ? '' : ` Came back from "${back.step}" (${back.label})${back.note === undefined ? '' : `: ${back.note}`}.`
  return describeStep(state, step, where, outcomes) + reopened
}

const describeStep = (state: FlowState, step: FlowStep, where: string, outcomes: string): string => {
  switch (step.kind) {
    case 'session':
      return `${where}. Do the step, then report one of its outcomes with action "report": ${outcomes}.`
    case 'loop': {
      const closed = Object.keys(state.closed ?? {})
      return (
        `${where}. Run the phases of tasks.md; close each with action "close" and its \`phase\` id once its gates ` +
        'passed, its tasks are ticked and its work is committed (the mod then archives its session). The step ends ' +
        `on its own when every phase is closed (→ ${step.outcomes[LOOP_DONE]?.next}).` +
        (closed.length > 0 ? ` Closed: ${closed.join(', ')}.` : '')
      )
    }
    case 'automatic':
      return (
        `${where}. Run \`${step.command}\` in this session; the mod reads its exit code ` +
        `(exit 0 → ${step.outcomes.passou?.next}, otherwise → ${step.outcomes.falhou?.next})` +
        (step.requiresEvidence ? ', and a pass also needs evidence.md recorded in the change folder' : '') +
        '. It cannot be reported.'
      )
    case 'owner':
      return (
        `${where}. Waits on the owner's press in the panel (${Object.values(step.outcomes).map(o => o.label).join(' / ')}); ` +
        'no session can answer it, but action "note" leaves a note that joins the answer' +
        (step.detect === undefined
          ? '.'
          : `. The mod also answers ${step.detect.outcome} when it sees ${step.detect.commands.map(c => `\`${c}\``).join(' or ')} succeed.`)
      )
  }
}
