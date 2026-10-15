import type { FlowEvent, FlowState, FlowView, GrillAnswer, GrillItem, PrepState, PrepView } from '../types'

/**
 * The owner steps before execution, by their ids in the flows: the grill (rounds of questions until
 * the owner closes the understanding), the mockup (only for a visual change) and the owner's
 * release, answered in the app's plan mode.
 */
export const GRILL_STEP = 'grill'
export const MOCKUP_STEP = 'mockup'
export const RELEASE_STEP = 'liberacao'
export const MOCKUP_APPROVED = 'aprovado'
export const MOCKUP_ADJUST = 'ajustes'
export const RELEASE_OUTCOME = 'liberado'

const MAX_TEXT = 2_000
const MAX_PLAN = 8_000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max = MAX_TEXT): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined

export const emptyPrep = (change: string): PrepState => ({ change, rounds: [], adjustments: [], planRejections: [] })

/** A round's questions as the tool sends them: each with its question, and the answer and criterion once known. */
export const parseRoundItems = (raw: unknown): GrillItem[] | { error: string } => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: '`questions` must list the round\'s questions: [{ question, answer?, criterion? }].' }
  }
  const items: GrillItem[] = []
  for (const [i, q] of raw.entries()) {
    const question = isRecord(q) ? text(q.question) : text(q)
    if (question === undefined) return { error: `question ${i + 1} has no \`question\` text.` }
    const answer = isRecord(q) ? text(q.answer) : undefined
    const criterion = isRecord(q) ? text(q.criterion) : undefined
    items.push({ question, ...(answer === undefined ? {} : { answer }), ...(criterion === undefined ? {} : { criterion }) })
  }
  return items
}

const onStep = (state: FlowState, step: string, what: string): string | undefined => {
  if (state.status !== 'running' || state.current !== step) {
    return `${what} only while the flow of ${state.change} is on "${step}"; it is on "${state.current}" (${state.status}).`
  }
  return undefined
}

type Prepped = { prep: PrepState; event: Pick<FlowEvent, 'kind' | 'step' | 'by' | 'note'> }

/**
 * One grill round: appended, or with `amend` merged into the latest round (answers filled by
 * question text, new questions added). Only while the flow is on the grill; the round never closes
 * it, since only the owner does, in the panel.
 */
export const recordRound = (
  prep: PrepState,
  state: FlowState,
  items: readonly GrillItem[],
  amend: boolean,
  at: number,
): Prepped | { error: string } => {
  const wrong = onStep(state, GRILL_STEP, 'a grill round is recorded')
  if (wrong !== undefined) return { error: wrong }
  const last = prep.rounds[prep.rounds.length - 1]
  let rounds = prep.rounds
  if (amend && last !== undefined) {
    const merged = [...last.items]
    for (const item of items) {
      const i = merged.findIndex(m => m.question === item.question)
      if (i === -1) merged.push(item)
      else merged[i] = { ...merged[i]!, ...item }
    }
    rounds = [...prep.rounds.slice(0, -1), { ...last, items: merged, at }]
  } else {
    rounds = [...prep.rounds, { n: prep.rounds.length + 1, at, items: [...items] }]
  }
  const round = rounds[rounds.length - 1]!
  const open = round.items.filter(i => i.answer === undefined).length
  return {
    prep: { ...prep, rounds },
    event: {
      kind: 'round',
      step: GRILL_STEP,
      by: 'session',
      note: `rodada ${round.n}: ${round.items.length} perguntas, ${open} em aberto`,
    },
  }
}

/**
 * The owner's answers typed in the panel, merged into the latest round the way `round` with
 * `amend: true` does; each must still be an open question of that round and none may be empty.
 */
export const ownerAnswers = (
  prep: PrepState,
  state: FlowState,
  answers: readonly GrillAnswer[],
  at: number,
): Prepped | { error: string } => {
  const filled = answers.flatMap(a => {
    const answer = text(a.answer)
    return answer === undefined ? [] : [{ ...a, answer }]
  })
  if (filled.length === 0) return { error: 'escreva a resposta antes de enviar.' }
  const last = prep.rounds[prep.rounds.length - 1]
  const stale = filled.find(a => last?.items.find(i => i.question === a.question && i.answer === undefined) === undefined)
  if (stale !== undefined) return { error: `a pergunta ${stale.n} não está mais em aberto na rodada atual.` }
  const done = recordRound(prep, state, filled.map(a => ({ question: a.question, answer: a.answer })), true, at)
  return 'error' in done ? done : { prep: done.prep, event: { ...done.event, by: 'owner' } }
}

/** What the coordinator reads from the panel: one line per answer, as the owner's own message. */
export const answersPrompt = (answers: readonly GrillAnswer[]): string =>
  answers
    .filter(a => a.answer.trim() !== '')
    .map(a => `Resposta à pergunta ${a.n}: ${a.answer.trim()}`)
    .join('\n')

/** A URL or a file path: what the panel can show the owner as the mockup. */
const isArtifact = (v: string): boolean =>
  /^https?:\/\/\S+$/.test(v) || /^(\/|~\/|\.\.?\/)/.test(v) || /^[^\s:]*[/.][^\s:]*$/.test(v)

/** The coordinator attaches the mockup (an Artifact URL or a file path) while the flow is on it. */
export const attachMockup = (prep: PrepState, state: FlowState, artifact: unknown, at: number): Prepped | { error: string } => {
  const wrong = onStep(state, MOCKUP_STEP, 'a mockup is attached')
  if (wrong !== undefined) return { error: wrong }
  const value = text(artifact)
  if (value === undefined || !isArtifact(value)) {
    return { error: '`artifact` must be the mockup\'s URL (e.g. an Artifact link) or a file path.' }
  }
  return {
    prep: { ...prep, mockup: { artifact: value, at } },
    event: { kind: 'attached', step: MOCKUP_STEP, by: 'session', note: value },
  }
}

/**
 * The owner's press on the mockup: approving needs an attached mockup; asking for an adjustment keeps
 * the owner's note and the mockup it was about, and clears the mockup so a new one is attached.
 */
export const pressMockup = (prep: PrepState, outcome: string, note: string | undefined, at: number): PrepState | { error: string } => {
  if (outcome === MOCKUP_APPROVED && prep.mockup === undefined) return { error: 'nenhum mockup foi anexado ainda.' }
  if (outcome !== MOCKUP_ADJUST) return prep
  const { mockup: _left, ...rest } = prep
  const adjustment = {
    note: text(note) ?? '',
    at,
    ...(prep.mockup === undefined ? {} : { artifact: prep.mockup.artifact }),
  }
  return { ...rest, adjustments: [...prep.adjustments, adjustment] }
}

type PlanRun = { result?: unknown; isError?: true; deny?: string; ref?: number; text?: string }

export type PlanVerdict = { approved: true; plan: string | undefined; filePath: string | undefined } | { approved: false; feedback: string }

/**
 * What one ExitPlanMode call says of the owner's release. The tool runs only once the person
 * approves the plan in the app's own dialog (a hook cannot dismiss it), so core's answered result
 * is the approval and an errored call is the refusal at the dialog, its text holding the owner's
 * words. Not counted: a call in a subagent's loop, a teammate's plan sent to its leader, a result
 * core did not produce (no `ref`), and a plugin's deny.
 */
export const planVerdict = (input: { agentId?: unknown }, ran: PlanRun): PlanVerdict | undefined => {
  if (input.agentId !== undefined || ran.deny !== undefined) return undefined
  if (ran.isError === true) {
    return { approved: false, feedback: text(ran.text, MAX_TEXT) ?? text(ran.result, MAX_TEXT) ?? 'plano não aprovado' }
  }
  if (ran.ref === undefined || !isRecord(ran.result)) return undefined
  const result = ran.result
  if (result.isAgent === true || result.awaitingLeaderApproval === true) return undefined
  return { approved: true, plan: text(result.plan, MAX_PLAN), filePath: text(result.filePath) }
}

/** The owner's refusal of the execution plan, kept so the coordinator reads what to change. */
export const rejectPlan = (prep: PrepState, feedback: string, at: number): Prepped => ({
  prep: { ...prep, planRejections: [...prep.planRejections, { feedback, at }].slice(-10) },
  event: { kind: 'plan-rejected', step: RELEASE_STEP, by: 'owner', note: feedback.slice(0, 300) },
})

export const approvePlan = (prep: PrepState, verdict: Extract<PlanVerdict, { approved: true }>, at: number): PrepState => ({
  ...prep,
  release: {
    at,
    ...(verdict.plan === undefined ? {} : { plan: verdict.plan }),
    ...(verdict.filePath === undefined ? {} : { filePath: verdict.filePath }),
  },
})

/** Every answered question becomes an acceptance criterion: its own criterion, else the answer. */
export const criteria = (prep: PrepState): string[] =>
  prep.rounds.flatMap(r => r.items.flatMap(i => (i.answer === undefined ? [] : [i.criterion ?? i.answer])))

export const prepView = (prep: PrepState): PrepView => {
  const last = prep.rounds[prep.rounds.length - 1]
  const artifact = prep.mockup?.artifact
  return {
    change: prep.change,
    rounds: prep.rounds.length,
    openQuestions: last === undefined ? [] : last.items.filter(i => i.answer === undefined).map(i => i.question),
    openItems:
      last === undefined
        ? []
        : last.items.flatMap((i, k) => (i.answer === undefined ? [{ n: k + 1, question: i.question }] : [])),
    criteria: criteria(prep),
    ...(artifact === undefined ? {} : { mockup: artifact, mockupIsUrl: /^https?:\/\//.test(artifact) }),
    ...(prep.adjustments.length === 0 ? {} : { lastAdjustment: prep.adjustments[prep.adjustments.length - 1]!.note }),
    ...(prep.planRejections.length === 0 ? {} : { lastPlanFeedback: prep.planRejections[prep.planRejections.length - 1]!.feedback }),
    released: prep.release !== undefined,
  }
}

/**
 * The owner buttons the panel leaves out: the release is pressed in the app's plan-mode dialog,
 * never in the panel; the mockup is approved only once attached; and where the surface has a text
 * field, the adjustment goes through it so the owner's note comes along.
 */
export const hiddenChoices = (flow: FlowView, prep: PrepView | undefined, hasInput: boolean): string[] => {
  if (flow.status !== 'running') return []
  switch (flow.current?.id) {
    case RELEASE_STEP:
      return [RELEASE_OUTCOME]
    case MOCKUP_STEP:
      return [...(prep?.mockup === undefined ? [MOCKUP_APPROVED] : []), ...(hasInput ? [MOCKUP_ADJUST] : [])]
    default:
      return []
  }
}

/** grill.md: every round with its questions and answers, then the acceptance criteria they became. */
export const grillMarkdown = (prep: PrepState): string => {
  const lines = [`# Grill — ${prep.change}`, '']
  for (const round of prep.rounds) {
    lines.push(`## Rodada ${round.n}`, '')
    for (const item of round.items) {
      lines.push(`- **Pergunta:** ${item.question}`, `  **Resposta:** ${item.answer ?? '_(em aberto)_'}`)
    }
    lines.push('')
  }
  const found = criteria(prep)
  lines.push('## Critérios de aceite', '')
  lines.push(...(found.length === 0 ? ['_(nenhum ainda)_'] : found.map(c => `- [ ] ${c}`)), '')
  return lines.join('\n')
}

/** What the coordinator must do on a pre-execution step, in the model's words; undefined elsewhere. */
export const describePrep = (state: FlowState, prep: PrepState): string | undefined => {
  if (state.status !== 'running') return undefined
  const view = prepView(prep)
  switch (state.current) {
    case GRILL_STEP:
      return (
        `Grill: ${view.rounds} round(s) recorded, ${view.openQuestions.length} open question(s), ` +
        `${view.criteria.length} acceptance criteria. Ask the owner one round of questions, then record it with ` +
        'action "round" (questions with the owner\'s answers; amend: true fills the latest round). ' +
        'Only the owner closes the understanding, in the panel.'
      )
    case MOCKUP_STEP:
      return (
        (view.mockup === undefined
          ? 'Mockup: none attached; attach it with action "mockup" (artifact: an Artifact URL or a file path).'
          : `Mockup attached: ${view.mockup}; the owner approves it or asks for an adjustment in the panel.`) +
        (view.lastAdjustment === undefined ? '' : ` The owner's last adjustment: "${view.lastAdjustment}".`)
      )
    case RELEASE_STEP:
      return (
        'Release: write the execution plan and call ExitPlanMode with it; the owner\'s approval in the app\'s ' +
        'plan dialog releases execution (no tool call can).' +
        (view.lastPlanFeedback === undefined ? '' : ` The owner refused the last plan: "${view.lastPlanFeedback}".`)
      )
    default:
      return undefined
  }
}
