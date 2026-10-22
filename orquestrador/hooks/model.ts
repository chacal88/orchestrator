import type {
  ActivityRecord,
  Attention,
  FlowState,
  GateView,
  OrchestrationRun,
  OwnerQuestion,
  PanelView,
  PhaseStatus,
  PhaseView,
  PlanItem,
  SessionCard,
  SessionRow,
} from '../types'
import { FINAL_SCOPE, GATES, citedPrs, familyCheck, gateViews, isOpenGate, parseGates } from './gates'
import { normalizeKey } from './jira'

export const PHASE_STATUSES: readonly PhaseStatus[] = [
  'pending',
  'running',
  'blocked',
  'done',
]

/** One file per session, keyed by its working directory: each worktree belongs to one session. */
export const activityKey = (cwd: string): string =>
  cwd.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-180)

/** The activity file of a session the mod knows the id of; two sessions in one folder never share it. */
export const sessionActivityKey = (sessionId: string): string => `id-${activityKey(sessionId)}`

/**
 * What a session's card shows: the record it published under its own id, else, for a
 * record from before ids, the freshest one from its folder. A child sharing the
 * coordinator's folder gets no folder fallback, or it would read the coordinator's.
 */
export const activityFor = (
  records: readonly ActivityRecord[],
  row: { sessionId: string; cwd: string },
  selfCwd: string | undefined,
): ActivityRecord | undefined =>
  records.filter(r => r.sessionId === row.sessionId).sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
  (row.cwd === selfCwd ? undefined : latestActivity(records.filter(r => r.sessionId === undefined), row.cwd))

/**
 * The freshest record a session published from its folder or any folder beneath it:
 * an older copy of the mod keyed its file by the shell's cwd, which a `cd` moves.
 */
export const latestActivity = (
  records: readonly ActivityRecord[],
  cwd: string,
): ActivityRecord | undefined =>
  records
    .filter(r => r.cwd === cwd || r.cwd.startsWith(`${cwd}/`))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]

export const runKey = (change: string): string =>
  change.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'change'

type PlanUpdate = {
  items?: readonly { content?: unknown; status?: unknown }[]
  advance?: boolean
  done?: readonly number[]
  start?: number
}

const asStatus = (value: unknown): PlanItem['status'] =>
  value === 'completed' || value === 'in_progress' ? value : 'pending'

/**
 * Replays one update_plan call on the list the session already shows, the way
 * the app applies it: a whole list replaces, advance moves the cursor, done/start
 * are 1-based.
 */
export const applyPlanUpdate = (
  plan: readonly PlanItem[],
  input: PlanUpdate,
): PlanItem[] => {
  if (Array.isArray(input.items)) {
    return input.items
      .filter(item => typeof item?.content === 'string' && item.content !== '')
      .map(item => ({ content: String(item.content), status: asStatus(item.status) }))
  }
  const next = plan.map(item => ({ ...item }))
  if (input.advance === true) {
    const current = next.findIndex(item => item.status === 'in_progress')
    if (current >= 0) next[current] = { ...next[current]!, status: 'completed' }
    const pending = next.findIndex(item => item.status === 'pending')
    if (pending >= 0) next[pending] = { ...next[pending]!, status: 'in_progress' }
  }
  for (const n of input.done ?? []) {
    const item = next[n - 1]
    if (item !== undefined) next[n - 1] = { ...item, status: 'completed' }
  }
  if (typeof input.start === 'number') {
    const item = next[input.start - 1]
    if (item !== undefined) next[input.start - 1] = { ...item, status: 'in_progress' }
  }
  return next
}

/** wrap_up checks the whole list off. */
export const completePlan = (plan: readonly PlanItem[]): PlanItem[] =>
  plan.map(item => ({ ...item, status: 'completed' }))

export const planProgress = (
  plan: readonly PlanItem[],
): { done: number; total: number; current: string | undefined } => ({
  done: plan.filter(item => item.status === 'completed').length,
  total: plan.length,
  current: plan.find(item => item.status === 'in_progress')?.content,
})

/** The app's list_sessions/get_session rows, read defensively: the shape is the app's, not ours. */
export const parseSessionRows = (text: string | undefined): SessionRow[] => {
  if (text === undefined || text.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((row): SessionRow[] => {
    if (typeof row !== 'object' || row === null) return []
    const r = row as Record<string, unknown>
    if (typeof r.sessionId !== 'string' || typeof r.cwd !== 'string') return []
    const group = r.group as { id?: unknown; name?: unknown } | null | undefined
    return [
      {
        sessionId: r.sessionId,
        title: typeof r.title === 'string' ? r.title : r.sessionId,
        cwd: r.cwd,
        branch: typeof r.branch === 'string' ? r.branch : undefined,
        isRunning: r.isRunning === true,
        isArchived: r.isArchived === true,
        prNumber: typeof r.prNumber === 'number' ? r.prNumber : undefined,
        prState: typeof r.prState === 'string' ? r.prState : undefined,
        lastActivityAt: typeof r.lastActivityAt === 'string' ? r.lastActivityAt : undefined,
        name: typeof r.name === 'string' ? r.name : undefined,
        startedBy: typeof r.startedBy === 'string' ? r.startedBy : undefined,
        link: typeof r.link === 'string' ? r.link : undefined,
        groupId: typeof group?.id === 'string' ? group.id : undefined,
        groupName: typeof group?.name === 'string' ? group.name : undefined,
      },
    ]
  })
}

export const toCard = (
  row: SessionRow,
  activity: ActivityRecord | undefined,
): SessionCard => ({
  ...row,
  plan: activity?.plan ?? [],
  lastTool: activity?.lastTool,
  waiting: activity?.waiting,
  hasActivity: activity !== undefined,
  gates: { records: activity?.gates ?? {}, editedAt: activity?.editedAt, tried: activity?.tried },
})

const matches = (card: SessionCard, ref: string): boolean => {
  const needle = ref.trim().toLowerCase()
  if (needle === '') return false
  return (
    card.sessionId.toLowerCase() === needle ||
    card.name?.toLowerCase() === needle ||
    card.title.toLowerCase().includes(needle)
  )
}

/** Joins each phase of the coordinator's plan to the live session doing it. */
export const phaseViews = (
  run: OrchestrationRun,
  cards: readonly SessionCard[],
): PhaseView[][] =>
  run.waves.map(wave =>
    wave.phases.map(phase => ({
      ...phase,
      card:
        phase.session === undefined
          ? undefined
          : cards.find(card => matches(card, phase.session ?? '')),
    })),
  )

/**
 * Sessions whose work is over for the ceiling: every phase session of a change whose flow is done
 * or aborted, and the session of a phase the plan marks done or the loop closed.
 */
export const finishedSessionIds = (
  changes: readonly { run: OrchestrationRun | undefined; flow: Pick<FlowState, 'status' | 'closed'> | undefined }[],
  cards: readonly SessionCard[],
): Set<string> => {
  const ids = new Set<string>()
  for (const { run, flow } of changes) {
    if (run === undefined) continue
    const over = flow?.status === 'done' || flow?.status === 'aborted'
    for (const phase of phaseViews(run, cards).flat()) {
      if (phase.card !== undefined && (over || phase.status === 'done' || flow?.closed?.[phase.id] !== undefined)) {
        ids.add(phase.card.sessionId)
      }
    }
  }
  return ids
}

/**
 * What ties a PR to a change: the PRs bound to its phase sessions, the ones its plan's questions
 * name, the ones the flow's PR step cites in its note; and the branches its phase sessions work on.
 */
export const changePrs = (
  run: OrchestrationRun,
  flow: Pick<FlowState, 'flow' | 'records'> | undefined,
  cards: readonly SessionCard[],
): { numbers: Set<number>; branches: Set<string> } => {
  const sessions = phaseViews(run, cards).flatMap(phases => phases.flatMap(p => (p.card === undefined ? [] : [p.card])))
  const prSteps = (flow?.flow.steps ?? []).filter(s => /^(pr|merge)$/i.test(s.id))
  const numbers = [
    ...sessions.flatMap(c => (c.prNumber === undefined ? [] : [c.prNumber])),
    ...run.ownerQuestions.flatMap(q => (q.pr === undefined ? [] : [q.pr])),
    ...prSteps.flatMap(s => citedPrs(flow?.records[s.id]?.note)),
  ]
  return { numbers: new Set(numbers), branches: new Set(sessions.flatMap(c => (c.branch === undefined ? [] : [c.branch]))) }
}

export const phaseCounts = (
  run: OrchestrationRun,
): Record<PhaseStatus, number> => {
  const counts: Record<PhaseStatus, number> = { pending: 0, running: 0, blocked: 0, done: 0 }
  for (const wave of run.waves) for (const phase of wave.phases) counts[phase.status] += 1
  return counts
}

/** The coordinator's plan as the plan tool receives it, checked field by field. */
export const parseRun = (
  input: Record<string, unknown>,
  coordinatorCwd: string,
  updatedAt: number,
): OrchestrationRun | { error: string } => {
  const change = input.change
  if (typeof change !== 'string' || change.trim() === '') return { error: '`change` is required.' }
  if (!Array.isArray(input.waves) || input.waves.length === 0) {
    return { error: '`waves` needs at least one wave.' }
  }
  const waves: OrchestrationRun['waves'] = []
  for (const [w, rawWave] of input.waves.entries()) {
    const wave = rawWave as Record<string, unknown>
    if (!Array.isArray(wave?.phases)) return { error: `wave ${w + 1}: \`phases\` must be a list.` }
    const phases: OrchestrationRun['waves'][number]['phases'] = []
    for (const [p, rawPhase] of wave.phases.entries()) {
      const phase = rawPhase as Record<string, unknown>
      if (typeof phase?.id !== 'string' || typeof phase.title !== 'string') {
        return { error: `wave ${w + 1}, phase ${p + 1}: \`id\` and \`title\` are required.` }
      }
      const status = PHASE_STATUSES.find(s => s === phase.status) ?? 'pending'
      const gates = parseGates(phase.gates, `phase ${phase.id}`)
      if (gates !== undefined && 'error' in gates) return gates
      phases.push({
        id: phase.id,
        title: phase.title,
        status,
        icon: typeof phase.icon === 'string' ? phase.icon : undefined,
        tasks: typeof phase.tasks === 'string' ? phase.tasks : undefined,
        session: typeof phase.session === 'string' ? phase.session : undefined,
        dependsOn: Array.isArray(phase.dependsOn)
          ? phase.dependsOn.filter((d): d is string => typeof d === 'string')
          : undefined,
        note: typeof phase.note === 'string' ? phase.note : undefined,
        summary: typeof phase.summary === 'string' ? phase.summary : undefined,
        jira: normalizeKey(phase.jira),
        gates,
      })
    }
    waves.push({
      title: typeof wave.title === 'string' ? wave.title : undefined,
      summary: typeof wave.summary === 'string' ? wave.summary : undefined,
      jira: normalizeKey(wave.jira),
      phases,
    })
  }
  const finalGates = parseGates(input.finalGates, 'finalGates')
  if (finalGates !== undefined && 'error' in finalGates) return finalGates
  const ownerQuestions = Array.isArray(input.ownerQuestions)
    ? input.ownerQuestions.flatMap(parseOwnerQuestion)
    : []
  return {
    change: change.trim(),
    changePath: typeof input.changePath === 'string' ? input.changePath : undefined,
    coordinatorCwd,
    jira: normalizeKey(input.jira),
    jiraSite: typeof input.jiraSite === 'string' && input.jiraSite.trim() !== '' ? input.jiraSite.trim() : undefined,
    waves,
    ownerQuestions,
    finalGates,
    updatedAt,
  }
}

const parseOwnerQuestion = (raw: unknown): OwnerQuestion[] => {
  if (typeof raw === 'string') {
    return raw.trim() === '' ? [] : [{ question: raw, recommendation: undefined, session: undefined, pr: undefined }]
  }
  if (typeof raw !== 'object' || raw === null) return []
  const q = raw as Record<string, unknown>
  if (typeof q.question !== 'string' || q.question.trim() === '') return []
  return [
    {
      question: q.question,
      recommendation: typeof q.recommendation === 'string' ? q.recommendation : undefined,
      session: typeof q.session === 'string' ? q.session : undefined,
      pr: typeof q.pr === 'number' && q.pr > 0 ? q.pr : undefined,
      ...ownerGate(q.gate),
    },
  ]
}

const ownerGate = (raw: unknown): { gate?: { phase: string; gate: string } } => {
  if (typeof raw !== 'object' || raw === null) return {}
  const { phase, gate } = raw as Record<string, unknown>
  if (typeof phase !== 'string' || phase.trim() === '' || typeof gate !== 'string' || GATES[gate] === undefined) return {}
  return { gate: { phase: phase.trim(), gate } }
}

/**
 * The gate an owner question asks to skip, as the panel shows it: the final gates are proven
 * by the whole family, a phase's by its own session (the coordinator's when it has none).
 */
const questionGate = (view: PanelView, ref: { phase: string; gate: string }): GateView | undefined => {
  const self = view.self?.gates ?? { records: {}, editedAt: undefined }
  if (ref.phase === 'final') {
    const check = familyCheck([self, ...view.children.map(c => c.gates)])
    return gateViews([ref.gate], FINAL_SCOPE, check, view.skips ?? {})[0]
  }
  if (view.run === undefined) return undefined
  const phase = phaseViews(view.run, view.children).flat().find(p => p.id === ref.phase)
  if (phase === undefined) return undefined
  const check = phase.session === undefined ? self : (phase.card?.gates ?? { records: {}, editedAt: undefined })
  return gateViews([ref.gate], phase.id, check, view.skips ?? {})[0]
}

/** The web address of a GitHub remote, in either of git's spellings. */
export const repoWebUrl = (remote: string | null | undefined): string | undefined => {
  const match = remote?.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  return match ? `https://github.com/${match[1]}/${match[2]}` : undefined
}

export const prUrl = (repoUrl: string | undefined, pr: number | undefined): string | undefined =>
  repoUrl === undefined || pr === undefined ? undefined : `${repoUrl}/pull/${pr}`

export const findCard = (cards: readonly SessionCard[], ref: string | undefined): SessionCard | undefined =>
  ref === undefined ? undefined : cards.find(card => matches(card, ref))

/**
 * Everything waiting on the owner, most blocking first: the coordinator's decisions,
 * sessions stopped on a permission or a question, then open PRs to look at.
 */
export const attentionItems = (view: PanelView): Attention[] => {
  const cards = view.self === undefined ? view.children : [view.self, ...view.children]
  const decisions: Attention[] = (view.run?.ownerQuestions ?? []).flatMap((q, i): Attention[] => {
    const card = findCard(cards, q.session)
    const pr = q.pr ?? card?.prNumber
    const skip = q.gate === undefined ? undefined : questionGate(view, q.gate)
    // a gate that passed or was skipped answers the question: it leaves the list by itself
    if (skip !== undefined && !isOpenGate(skip)) return []
    return [
      {
        id: `decision:${i}`,
      kind: 'decision',
      title: q.question,
      detail: card?.title,
      recommendation: q.recommendation,
      card,
      prUrl: q.pr === undefined ? undefined : prUrl(view.repoUrl, pr),
        ...(skip === undefined ? {} : { skip }),
      },
    ]
  })
  const waiting: Attention[] = view.children.flatMap(card =>
    card.waiting === undefined
      ? []
      : [
          {
            id: `waiting:${card.sessionId}`,
            kind: card.waiting.kind,
            title:
              card.waiting.kind === 'permission'
                ? `Permissão pendente: ${card.waiting.text}`
                : card.waiting.text,
            detail: card.title,
            recommendation: undefined,
            card,
            prUrl: undefined,
          },
        ],
  )
  const prs: Attention[] = cards.flatMap(card =>
    card.prNumber === undefined || card.prState?.toUpperCase() !== 'OPEN'
      ? []
      : [
          {
            id: `pr:${card.prNumber}`,
            kind: 'pr',
            title: `PR #${card.prNumber} aberto`,
            detail: card.title,
            recommendation: undefined,
            card,
            prUrl: prUrl(view.repoUrl, card.prNumber),
          },
        ],
  )
  const flow = view.flow
  const step = flow?.current
  const flowItems: Attention[] =
    flow === undefined || step === undefined || flow.ownerChoices.length === 0
      ? []
      : [
          {
            id: `flow:${flow.change}:${step.id}`,
            kind: 'flow',
            title:
              flow.status === 'escalated'
                ? `${step.title}: ${step.attempts} tentativas sem sucesso`
                : step.title,
            detail:
              flow.status === 'escalated'
                ? `Flow ${flow.flowTitle} de ${flow.change}: tentar de novo ou encerrar?`
                : step.description ?? `Flow ${flow.flowTitle} de ${flow.change}`,
            recommendation: undefined,
            card: undefined,
            prUrl: undefined,
            flow: { change: flow.change, step: step.id, choices: flow.ownerChoices },
          },
        ]
  const change = view.flow?.change ?? view.run?.change ?? ''
  const jiraItems: Attention[] = (view.jiraMoves ?? []).map(move => {
    const now = move.from === undefined ? '' : ` Hoje: "${move.from}".`
    const base = { id: `jira:${move.key}`, kind: 'jira' as const, recommendation: undefined, card: undefined, prUrl: undefined }
    if (move.state === 'ready') {
      return {
        ...base,
        title: `A issue ${move.key} pode ir para ${move.toLabel}`,
        detail: `${move.title ?? ''}${now} O Jira só muda quando você apertar o botão.`.trim(),
        jira: { change, key: move.key, transitionId: move.transitionId ?? '', toLabel: move.toLabel },
      }
    }
    if (move.state === 'no-transition') {
      const options = move.available.length === 0 ? 'nenhuma transição disponível' : move.available.join(', ')
      return {
        ...base,
        title: `A issue ${move.key} deveria ir para ${move.toLabel}, mas o Jira não oferece essa transição`,
        detail: `${now.trim()} Disponíveis: ${options}. Ajuste o campo jira do passo no flow, ou mova na mão.`.trim(),
      }
    }
    return {
      ...base,
      title: `A issue ${move.key} deveria ir para ${move.toLabel}, mas não consigo mexer no Jira`,
      detail: move.note,
    }
  })
  return [...flowItems, ...decisions, ...jiraItems, ...waiting, ...prs]
}

/** Where the plan stands: the first wave not closed, and the one after it. */
export const nowAndNext = (
  run: OrchestrationRun,
): { now: number | undefined; next: number | undefined } => {
  const now = run.waves.findIndex(w => w.phases.some(p => p.status !== 'done'))
  if (now < 0) return { now: undefined, next: undefined }
  return { now, next: now + 1 < run.waves.length ? now + 1 : undefined }
}

/** The sidebar group a change's sessions live in. */
export const groupName = (change: string): string => `🪪 ${change}`.slice(0, 200)

/** Reads a group id out of list_groups' array or create_group's answer, whichever shape it takes. */
export const findGroupId = (text: string | undefined, name?: string): string | undefined => {
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue
      const r = row as Record<string, unknown>
      const id = r.id ?? r.group_id ?? r.groupId
      if (typeof id === 'string' && (name === undefined || r.name === name)) return id
    }
    return undefined
  } catch {
    return name === undefined ? text.match(/cg-[\w-]+/)?.[0] : undefined
  }
}
