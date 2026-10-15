import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  LinkProps,
  RenderElement,
  SvgProps,
  TextProps,
} from 'claude-code'

import type {
  Attention,
  EvidenceState,
  GateCheck,
  GateState,
  GateView,
  JiraCategory,
  OpenSpecView,
  PanelView,
  PhaseStatus,
  PhaseView,
  PlanItem,
  SessionCard,
} from '../types'
import { FINAL_SCOPE, MAX_LIVE_SESSIONS, familyCheck, gateViews, isOpenGate, liveSessions } from './gates'
import { divergence } from './jira'
import { tasksForPhase } from './openspec'
import { attentionItems, nowAndNext, phaseCounts, phaseViews, planProgress } from './model'
import { hiddenFlowChoices, prepDetails } from './prep-pane'

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
  /** Only the desktop draws Svg; elsewhere the bar is drawn with text. */
  Svg: ElementConstructor<SvgProps> | undefined
  /** A text field, where the surface has one (not on mobile). */
  Input?: ElementConstructor<InputProps> | undefined
}

/** What the hooks module hands in: state it owns and the closures that reach `$`. */
export type PaneActions = {
  collapsed: Readonly<Record<string, boolean>>
  answered: readonly string[]
  canOpenBeside: (card: SessionCard) => boolean
  toggle: (id: string, byDefault: boolean) => () => void
  openBeside: (card: SessionCard) => () => void
  accept: (item: Attention) => () => void
  /** The owner's skip of one gate; the pane arms it with a first press and fires on the second. */
  skip: (gate: GateView) => () => void
  /** The owner's answer to a flow step: the only way an owner step moves. */
  answerFlow: (change: string, step: string, outcome: string) => () => void
  /** The same answer with the owner's note typed in the panel (a mockup adjustment). */
  noteFlow: (change: string, step: string, outcome: string) => (value: string) => void
}

/** Hex, not theme keys: the Svg bar and the legend squares must match exactly. */
const STATUS_HEX: Record<PhaseStatus, string> = {
  done: '#4CAF7D',
  running: '#D97757',
  blocked: '#D14343',
  pending: '#B4B2A9',
}
const STATUS_LEGEND: Record<PhaseStatus, string> = {
  done: 'fechadas',
  running: 'em voo',
  blocked: 'bloqueadas',
  pending: 'pendentes',
}
const STATUS_WORD: Record<PhaseStatus, string> = {
  done: 'fechada',
  running: 'em voo',
  blocked: 'bloqueada',
  pending: 'pendente',
}
const STATUS_ORDER: readonly PhaseStatus[] = ['done', 'running', 'blocked', 'pending']
const ITEM_MARK: Record<PlanItem['status'], string> = { completed: '✓', in_progress: '▶', pending: '○' }
const ITEM_STATUS: Record<PlanItem['status'], PhaseStatus> = {
  completed: 'done',
  in_progress: 'running',
  pending: 'pending',
}
const ATTENTION_KIND: Record<Attention['kind'], string> = {
  decision: 'Decisão',
  permission: 'Permissão',
  question: 'Pergunta',
  pr: 'PR para revisar',
  flow: 'Passo do flow',
}

const JIRA_HEX: Record<JiraCategory, string> = {
  new: STATUS_HEX.pending,
  indeterminate: STATUS_HEX.running,
  done: STATUS_HEX.done,
  unknown: STATUS_HEX.pending,
}
const EVIDENCE_LABEL: Record<EvidenceState, string> = {
  missing: 'não existe',
  stub: 'esqueleto',
  recorded: 'registrada',
  green: 'check.sh verde',
  failing: 'check.sh falhou',
}
const EVIDENCE_HEX: Record<EvidenceState, string> = {
  missing: STATUS_HEX.blocked,
  stub: STATUS_HEX.pending,
  recorded: STATUS_HEX.running,
  green: STATUS_HEX.done,
  failing: STATUS_HEX.blocked,
}

const GATE_MARK: Record<GateState, string> = { passed: '✓', failed: '✗', pending: '○', stale: '⚠', skipped: '⏭' }
const GATE_HEX: Record<GateState, string> = {
  passed: STATUS_HEX.done,
  failed: STATUS_HEX.blocked,
  pending: STATUS_HEX.pending,
  stale: '#E0A030',
  skipped: STATUS_HEX.pending,
}
const GATE_WORD: Record<GateState, string> = {
  passed: 'passou',
  failed: 'falhou',
  pending: 'não rodou',
  stale: 'desatualizado',
  skipped: 'pulado por você',
}
const NO_CHECK: GateCheck = { records: {}, editedAt: undefined }

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

const percent = (part: number, total: number): number =>
  total === 0 ? 0 : Math.round((part / total) * 100)

const waveStatus = (phases: readonly PhaseView[]): PhaseStatus =>
  phases.some(p => p.status === 'blocked')
    ? 'blocked'
    : phases.some(p => p.status === 'running')
      ? 'running'
      : phases.every(p => p.status === 'done')
        ? 'done'
        : 'pending'

const barSvg = (segments: readonly { value: number; hex: string }[]): string => {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  let x = 0
  const rects = segments
    .filter(s => s.value > 0)
    .map(s => {
      const w = (s.value / Math.max(total, 1)) * 100
      const rect = `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(w - 0.6, 0.4).toFixed(2)}" height="4" rx="2" fill="${s.hex}"/>`
      x += w
      return rect
    })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 4" preserveAspectRatio="none" width="100%" height="4">` +
    `<rect x="0" y="0" width="100" height="4" rx="2" fill="#8884"/>${rects.join('')}</svg>`
  )
}


/** Pure drawing: the hooks module owns `$` and hands in the elements, the data and the actions. */
export const renderPane = (
  elements: PaneElements,
  view: PanelView,
  ownPlan: readonly PlanItem[],
  actions: PaneActions,
): RenderElement => {
  const { Box, Text, Button, Link, Svg } = elements
  const isOpen = (id: string, byDefault: boolean): boolean => !(actions.collapsed[id] ?? !byDefault)

  const bar = (segments: readonly { value: number; hex: string }[], alt: string) => {
    const total = Math.max(1, segments.reduce((a, b) => a + b.value, 0))
    return Svg !== undefined ? (
      <Svg source={barSvg(segments)} alt={alt} height={4} />
    ) : (
      <Text>
        {segments.map(s => (
          <Text color={s.hex}>{'━'.repeat(Math.round((s.value / total) * 24))}</Text>
        ))}
      </Text>
    )
  }

  const row = (left: RenderElement | string, right?: RenderElement | string, rightColor?: string, dim?: boolean) => (
    <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
      <Box flexShrink={1} flexGrow={1}>
        {typeof left === 'string' ? (
          <Text wrap="truncate-end" dimColor={dim}>
            {left}
          </Text>
        ) : (
          left
        )}
      </Box>
      {typeof right === 'string' ? (
        <Text color={rightColor} dimColor={rightColor === undefined}>
          {right}
        </Text>
      ) : (
        right
      )}
    </Box>
  )

  const square = (hex: string) => <Text color={hex}>■ </Text>

  const summaryBox = (summary: string) => (
    <Box borderStyle="round" borderDimColor paddingX={1}>
      <Text wrap="wrap" dimColor>
        {summary}
      </Text>
    </Box>
  )

  /** ⓘ opens the summary below its row: the desktop draws no tooltip for a mod's pane, a press works everywhere. */
  const infoButton = (id: string, summary: string | undefined): RenderElement[] =>
    summary === undefined
      ? []
      : [
          <Button key={`info:${id}`} plain dimColor={!isOpen(id, false)} onPress={actions.toggle(id, false)}>
            ⓘ
          </Button>,
        ]

  const summaryFor = (id: string, summary: string | undefined): RenderElement[] =>
    summary !== undefined && isOpen(id, false) ? [summaryBox(summary)] : []

  const card = (
    id: string,
    title: string,
    children: RenderElement[],
    aside?: string,
    accent?: string,
    byDefault = true,
  ) => {
    const open = isOpen(id, byDefault)
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={accent}
        borderDimColor={accent === undefined}
        paddingX={1}
      >
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Box flexShrink={1}>
            <Button key={`card:${id}`} plain onPress={actions.toggle(id, byDefault)}>
              <Text bold color={accent} wrap="truncate-end">
                {title}
              </Text>
              <Text dimColor>{open ? ' ⌄' : ' ›'}</Text>
            </Button>
          </Box>
          {aside !== undefined && (
            <Box flexShrink={0}>
              <Text dimColor wrap="truncate-end">
                {aside}
              </Text>
            </Box>
          )}
        </Box>
        {open && (
          <Box flexDirection="column" marginTop={1}>
            {children}
          </Box>
        )}
      </Box>
    )
  }

  const group = (
    id: string,
    label: string,
    count: string,
    byDefault: boolean,
    body: () => RenderElement[],
    summary?: string,
  ) => {
    const open = isOpen(id, byDefault)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={1}>
            <Button key={`group:${id}`} plain onPress={actions.toggle(id, byDefault)}>
              <Text dimColor>{open ? '⌄ ' : '› '}</Text>
              <Text>{label}</Text>
            </Button>
            {infoButton(`summary:${id}`, summary)}
          </Box>
          <Text dimColor>{count}</Text>
        </Box>
        {summaryFor(`summary:${id}`, summary)}
        {open && (
          <Box flexDirection="column" paddingLeft={2}>
            {body()}
          </Box>
        )}
      </Box>
    )
  }

  /**
   * "Abrir": a button in every case. The pane draws a `claude://` Link as dead text, so the
   * hooks module opens it: beside this session when the app allows it, else through the app's link.
   */
  const openControl = (c: SessionCard, label = 'Abrir', scope = ''): RenderElement | undefined =>
    actions.canOpenBeside(c) || c.link !== undefined ? (
      <Button key={`open:${scope}:${label}:${c.sessionId}`} plain dimColor onPress={actions.openBeside(c)}>
        {`${label} ↗`}
      </Button>
    ) : undefined

  const planRows = (plan: readonly PlanItem[]) =>
    plan.map(item =>
      row(
        <Text wrap="truncate-end" dimColor={item.status === 'completed'}>
          <Text color={STATUS_HEX[ITEM_STATUS[item.status]]}>{ITEM_MARK[item.status]} </Text>
          {item.content}
        </Text>,
      ),
    )

  const sessionState = (c: SessionCard): string =>
    c.waiting !== undefined ? 'esperando você' : c.isRunning ? 'trabalhando' : 'ociosa'

  const sessionRows = (c: SessionCard): RenderElement[] => {
    const progress = planProgress(c.plan)
    const meta = [
      sessionState(c),
      c.prNumber === undefined ? undefined : `PR #${c.prNumber}${c.prState ? ` ${c.prState.toLowerCase()}` : ''}`,
      progress.total > 0 ? `${progress.done}/${progress.total}` : undefined,
    ]
      .filter(Boolean)
      .join(' · ')
    return [
      row(meta, openControl(c), undefined, true),
      ...(progress.current === undefined
        ? []
        : [
            row(
              <Text wrap="truncate-end" color={STATUS_HEX.running}>
                ▶ {progress.current}
              </Text>,
            ),
          ]),
    ]
  }

  const issues = view.jira ?? {}
  const skips = view.skips ?? {}

  /** One line per gate: its mark and what proved it, then its state or the owner's two-press skip. */
  const gateRows = (gates: readonly GateView[]): RenderElement[] =>
    gates.map(g => {
      const armed = isOpen(`arm:${g.skipKey}`, false)
      return row(
        <Text wrap="truncate-end" dimColor={g.state === 'passed' || g.state === 'skipped'}>
          <Text color={GATE_HEX[g.state]}>{GATE_MARK[g.state]} </Text>
          {g.label}
          {g.evidence !== undefined && <Text dimColor> · {g.evidence}</Text>}
        </Text>,
        <Box flexDirection="row" columnGap={1}>
          <Text color={GATE_HEX[g.state]}>{GATE_WORD[g.state]}</Text>
          {isOpenGate(g) &&
            (armed ? (
              <Button key={`skip:${g.skipKey}`} variant="primary" onPress={actions.skip(g)}>
                Confirmar pulo
              </Button>
            ) : (
              <Button key={`arm:${g.skipKey}`} plain dimColor onPress={actions.toggle(`arm:${g.skipKey}`, false)}>
                Pular
              </Button>
            ))}
        </Box>,
      )
    })

  /** One line per Jira key: the key as a link, its status in its category's colour, its title; then any disagreement. */
  /** What a pressed Jira key shows: the issue as far as it is known, or why it is not. */
  const jiraDetails = (key: string): RenderElement[] => {
    const issue = issues[key]
    const id = `jira:${key}`
    if (!isOpen(id, false)) return []
    const lines = [
      issue?.title ?? undefined,
      issue?.status === undefined ? undefined : `Status: ${issue.status}`,
      issue?.status === undefined
        ? view.jiraNote ??
          'Sem status: o painel ainda não leu esta issue do Jira.'
        : undefined,
      issue?.url === undefined
        ? 'Sem link: falta o site do Jira. Reconecte o conector Atlassian (claude.ai › Configurações › Conectores) ou informe jiraSite no plano.'
        : undefined,
    ].filter((line): line is string => line !== undefined)
    return [
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {lines.map(line => (
          <Text wrap="wrap" dimColor>
            {line}
          </Text>
        ))}
        {issue?.url !== undefined && <Link href={issue.url}>{`Abrir ${key} no Jira ↗`}</Link>}
      </Box>,
    ]
  }

  const jiraKeyButton = (key: string): RenderElement => {
    const issue = issues[key]
    return (
      <Button key={`jira:${key}`} plain onPress={actions.toggle(`jira:${key}`, false)}>
        <Text color={JIRA_HEX[issue?.category ?? 'unknown']}>
          {issue?.status === undefined ? key : `${key} · ${issue.status}`}
        </Text>
        <Text dimColor>{isOpen(`jira:${key}`, false) ? ' ⌄' : ' ›'}</Text>
      </Button>
    )
  }

  /** Under a title that carries the key: the pressed key's details, then any disagreement with Jira. */
  const jiraBelow = (key: string | undefined, status: PhaseStatus): RenderElement[] => {
    if (key === undefined) return []
    const mismatch = divergence(status, issues[key])
    return [
      ...jiraDetails(key),
      ...(mismatch === undefined
        ? []
        : [
            <Text color="warning" wrap="wrap">
              ⚠ {mismatch}
            </Text>,
          ]),
    ]
  }

  const jiraRows = (key: string | undefined, status: PhaseStatus): RenderElement[] => {
    if (key === undefined) return []
    const issue = issues[key]
    const mismatch = divergence(status, issue)
    return [
      row(
        <Box flexDirection="row" columnGap={1} flexShrink={1}>
          <Text dimColor>Jira</Text>
          {jiraKeyButton(key)}
          {issue?.title !== undefined && (
            <Text wrap="truncate-end" dimColor>
              {issue.title}
            </Text>
          )}
        </Box>,
        issue?.status,
        issue === undefined ? undefined : JIRA_HEX[issue.category],
      ),
      ...jiraDetails(key),
      ...(mismatch === undefined
        ? []
        : [
            <Text color="warning" wrap="wrap">
              ⚠ {mismatch}
            </Text>,
          ]),
    ]
  }

  const openSpecCard = (spec: OpenSpecView): RenderElement => {
    const partial = spec.sections.filter(s => s.done > 0 && s.done < s.total).length
    const full = spec.sections.filter(s => s.total > 0 && s.done === s.total).length
    return card(
      'openspec',
      'OpenSpec',
      [
        ...(spec.proposalTitle === undefined && spec.proposalSummary === undefined
          ? []
          : [
              row(
                <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={1}>
                  {infoButton('openspec:proposal', spec.proposalSummary)}
                  <Text wrap="truncate-end">
                    <Text dimColor>Proposta </Text>
                    {spec.proposalTitle ?? 'proposal.md'}
                  </Text>
                </Box>,
              ),
              ...summaryFor('openspec:proposal', spec.proposalSummary),
            ]),
        <Box marginTop={1} />,
        ...(spec.total === 0
          ? [<Text dimColor>tasks.md sem caixas de seleção</Text>]
          : [
              row(`${percent(spec.done, spec.total)}% das tarefas`, `${spec.done} / ${spec.total}`),
              bar(
                [
                  { value: spec.done, hex: STATUS_HEX.done },
                  { value: spec.total - spec.done, hex: STATUS_HEX.pending },
                ],
                `${spec.done} de ${spec.total} tarefas marcadas`,
              ),
              group(
                'openspec:sections',
                'Seções do tasks.md',
                `${full}/${spec.sections.length}`,
                true,
                () =>
                  spec.sections.map(section => {
                    const status: PhaseStatus =
                      section.done === section.total ? 'done' : section.done > 0 ? 'running' : 'pending'
                    return row(
                      <Text wrap="truncate-end" dimColor={status === 'done'}>
                        {square(STATUS_HEX[status])}
                        {section.title}
                      </Text>,
                      `${section.done}/${section.total}`,
                    )
                  }),
                partial > 0 ? `${full} seções completas, ${partial} em andamento.` : undefined,
              ),
            ]),
        <Box marginTop={1} />,
        row(
          <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={1}>
            <Text dimColor>Evidência</Text>
            {infoButton('openspec:evidence', spec.evidenceSummary)}
          </Box>,
          EVIDENCE_LABEL[spec.evidence],
          EVIDENCE_HEX[spec.evidence],
        ),
        ...summaryFor('openspec:evidence', spec.evidenceSummary),
      ],
      spec.total === 0 ? undefined : `${spec.done}/${spec.total}`,
    )
  }

  const cards: RenderElement[] = []
  const run = view.run

  const attention = attentionItems(view).filter(a => a.kind === 'flow' || !actions.answered.includes(a.title))
  const hiddenFlow = hiddenFlowChoices(elements, view)
  const attentionCard =
    attention.length === 0
      ? undefined
      : card(
        'attention',
        'Precisa de você',
        attention.map(item => {
          const canOpen = item.card !== undefined && item.card.sessionId !== view.self?.sessionId
          return (
            <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} marginBottom={1}>
              <Text dimColor>{ATTENTION_KIND[item.kind]}</Text>
              <Text bold wrap="wrap" color="warning">
                {item.title}
              </Text>
              {item.recommendation !== undefined && (
                <Text wrap="wrap">
                  <Text dimColor>Recomendação: </Text>
                  {item.recommendation}
                </Text>
              )}
              {item.detail !== undefined && (
                <Text dimColor wrap="truncate-end">
                  {item.detail}
                </Text>
              )}
              {item.kind === 'flow' && prepDetails(elements, view, actions)}
              <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
                {item.kind === 'decision' && item.recommendation !== undefined && (
                  <Button key={`accept:${item.id}`} variant="primary" onPress={actions.accept(item)}>
                    Aceitar recomendação
                  </Button>
                )}
                {item.flow !== undefined &&
                  item.flow.choices.filter(c => !hiddenFlow.includes(c.outcome)).map((choice, i) => (
                    <Button
                      key={`flow:${item.flow!.step}:${choice.outcome}`}
                      variant={i === 0 ? 'primary' : 'secondary'}
                      onPress={actions.answerFlow(item.flow!.change, item.flow!.step, choice.outcome)}
                    >
                      {choice.label}
                    </Button>
                  ))}
                {item.prUrl !== undefined && <Link href={item.prUrl}>Abrir PR</Link>}
                {canOpen && item.card !== undefined && openControl(item.card, 'Abrir sessão')}
              </Box>
            </Box>
          )
        }),
        `${attention.length}`,
        'warning',
      )

  /** The coordinator's view of the change: how much is left, the live-session ceiling, final gates. */
  const runCard = (): RenderElement[] => {
    if (run === undefined) return []
    const counts = phaseCounts(run)
    const total = STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0)
    const live = liveSessions(view.children, view.self?.sessionId).length
    const finalGates = gateViews(
      run.finalGates,
      FINAL_SCOPE,
      familyCheck([view.self?.gates ?? NO_CHECK, ...view.children.map(c => c.gates ?? NO_CHECK)]),
      skips,
    )
    const legend = STATUS_ORDER.filter(s => counts[s] > 0)
    const byStatus = (s: PhaseStatus) =>
      phaseViews(run, view.children).flatMap((phases, w) => phases.filter(p => p.status === s).map(p => ({ phase: p, w })))
    const changeIssue = run.jira === undefined ? undefined : issues[run.jira]
    const changeMismatch = divergence(total > 0 && counts.done === total ? 'done' : 'running', changeIssue)
    return [
      card(
        'run',
        run.jira === undefined ? run.change : `${run.change} · ${run.jira}`,
        [
          bar(STATUS_ORDER.map(s => ({ value: counts[s], hex: STATUS_HEX[s] })), `${counts.done} de ${total} fases fechadas`),
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            {legend.map(s => (
              <Box flexDirection="row">
                <Text color={STATUS_HEX[s]}>● </Text>
                <Button key={`legend:${s}`} plain onPress={actions.toggle(`legend:${s}`, false)}>
                  <Text>{`${counts[s]} ${STATUS_LEGEND[s]}`}</Text>
                  <Text dimColor>{isOpen(`legend:${s}`, false) ? ' ⌄' : ' ›'}</Text>
                </Button>
              </Box>
            ))}
          </Box>,
          ...legend.flatMap(s =>
            isOpen(`legend:${s}`, false)
              ? [
                  <Box flexDirection="column" borderStyle="round" borderColor={STATUS_HEX[s]} paddingX={1}>
                    {byStatus(s).map(({ phase, w }) =>
                      row(
                        <Text wrap="truncate-end">
                          {phase.icon ? `${phase.icon} ` : ''}
                          {phase.title}
                          <Text dimColor>{` · onda ${w + 1}`}</Text>
                        </Text>,
                        phase.card === undefined || phase.card.sessionId === view.self?.sessionId
                          ? phase.card === undefined
                            ? undefined
                            : 'esta sessão'
                          : openControl(phase.card, 'Abrir', `legend:${phase.id}`),
                      ),
                    )}
                  </Box>,
                ]
              : [],
          ),
          ...(run.jira === undefined
            ? []
            : [
                ...(changeIssue?.title !== undefined || changeIssue?.status !== undefined
                  ? [
                      row(
                        <Text wrap="truncate-end" dimColor>
                          {changeIssue?.title ?? ''}
                        </Text>,
                        changeIssue?.status,
                        changeIssue === undefined ? undefined : JIRA_HEX[changeIssue.category],
                      ),
                    ]
                  : []),
                row(<Text dimColor>Issue da change</Text>, jiraKeyButton(run.jira)),
                ...jiraDetails(run.jira),
                ...(changeMismatch === undefined
                  ? []
                  : [
                      <Text color="warning" wrap="wrap">
                        ⚠ {changeMismatch}
                      </Text>,
                    ]),
              ]),
          row(
            <Text wrap="truncate-end" dimColor>
              Sessões trabalhando agora
            </Text>,
            `${live} de no máximo ${MAX_LIVE_SESSIONS}`,
            live >= MAX_LIVE_SESSIONS ? STATUS_HEX.blocked : undefined,
          ),
          ...(live >= MAX_LIVE_SESSIONS
            ? [
                <Text dimColor wrap="wrap">
                  No limite: uma nova fase só começa quando uma sessão for arquivada, para não pesar o computador.
                </Text>,
              ]
            : []),
          ...(finalGates.length === 0
            ? []
            : [
                group(
                  'final-gates',
                  'Checagens antes de juntar o código',
                  `${finalGates.filter(g => !isOpenGate(g)).length}/${finalGates.length}`,
                  true,
                  () => gateRows(finalGates),
                  'Rodam uma vez, com o código de todas as fases já junto; enquanto não passam, o código não é juntado na branch principal.',
                ),
              ]),
          ...(view.jiraNote === undefined
            ? []
            : [
                <Text dimColor wrap="wrap">
                  {view.jiraNote}
                </Text>,
              ]),
          <Text dimColor>atualizado {view.updatedAt === 0 ? '…' : formatTime(view.updatedAt)}</Text>,
        ],
        `${counts.done} de ${total} fases`,
      ),
    ]
  }

  const waves = run === undefined ? [] : phaseViews(run, view.children)
  const { now } = run === undefined ? { now: undefined } : nowAndNext(run)
  const waveName = (w: number) => `Onda ${w + 1}${run?.waves[w]?.title ? ` · ${run.waves[w]?.title}` : ''}`
  const phaseKey = (w: number, phase: PhaseView) => `summary:${w}:${phase.id}`
  const phaseGates = (phase: PhaseView) =>
    gateRows(
      gateViews(
        phase.gates,
        phase.id,
        phase.session === undefined ? (view.self?.gates ?? NO_CHECK) : (phase.card?.gates ?? NO_CHECK),
        skips,
      ),
    )

  /** What the session doing a phase is on now, said so the owner can read it: the step, then how far. */
  const workRows = (c: SessionCard, scope = ''): RenderElement[] => {
    const progress = planProgress(c.plan)
    const tasksId = `tasks:${scope}:${c.sessionId}`
    const who = c.sessionId === view.self?.sessionId ? 'esta sessão' : sessionState(c)
    const pr = c.prNumber === undefined ? '' : ` · PR #${c.prNumber}`
    return [
      ...(progress.current === undefined
        ? []
        : [
            <Text wrap="wrap">
              <Text dimColor>Fazendo agora: </Text>
              {progress.current}
            </Text>,
          ]),
      row(
        progress.total === 0 ? (
          <Text dimColor wrap="truncate-end">{`${who}${pr}`}</Text>
        ) : (
          <Button key={tasksId} plain onPress={actions.toggle(tasksId, false)}>
            <Text dimColor>{`${who} · passos ${progress.done} de ${progress.total}${pr}`}</Text>
            <Text dimColor>{isOpen(tasksId, false) ? ' ⌄' : ' ›'}</Text>
          </Button>
        ),
        c.sessionId === view.self?.sessionId ? undefined : openControl(c, 'Abrir', scope),
      ),
      ...(progress.total > 0 && isOpen(tasksId, false) ? planRows(c.plan) : []),
    ]
  }

  /** The tasks.md items a phase delivers, ticked as they are done. */
  const phaseTasks = (phase: PhaseView): RenderElement[] => {
    const tasks = tasksForPhase(phase.tasks, view.openspec?.items ?? [])
    if (tasks.length === 0) return []
    const done = tasks.filter(t => t.done).length
    return [
      <Box flexDirection="column" marginTop={1}>
        {row(<Text dimColor>Tarefas</Text>, `${done} de ${tasks.length}`)}
        {tasks.map(task =>
          row(
            <Text wrap="truncate-end" dimColor={task.done}>
              <Text color={task.done ? STATUS_HEX.done : STATUS_HEX.pending}>{task.done ? '✓ ' : '○ '}</Text>
              <Text dimColor>{task.id} </Text>
              {task.text}
            </Text>,
          ),
        )}
      </Box>,
    ]
  }

  /** A phase of the current wave in full: what it is in plain words first, then what is happening. */
  const phaseCard = (phase: PhaseView): RenderElement => {
    // a phase no session is named for is the coordinator's own work: show what this session is doing
    const isActive = phase.status === 'running' || phase.status === 'blocked'
    const worker = phase.card ?? (phase.session === undefined && isActive ? view.self : undefined)
    return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={phase.status === 'done' ? undefined : STATUS_HEX[phase.status]}
      borderDimColor={phase.status === 'done'}
      paddingX={1}
    >
      {row(
        <Box flexDirection="row" columnGap={1} flexShrink={1}>
          <Text bold wrap="truncate-end">
            {phase.icon ? `${phase.icon} ` : ''}
            {phase.title}
          </Text>
          {phase.jira !== undefined && jiraKeyButton(phase.jira)}
        </Box>,
        STATUS_WORD[phase.status],
        STATUS_HEX[phase.status],
      )}
      {jiraBelow(phase.jira, phase.status)}
      {phase.summary !== undefined && <Text wrap="wrap">{phase.summary}</Text>}
      {phase.note !== undefined && (
        <Text wrap="wrap" dimColor>
          {phase.note}
        </Text>
      )}
      {phase.status === 'pending' && phase.dependsOn?.length ? (
        <Text dimColor>espera {phase.dependsOn.join(', ')} terminar</Text>
      ) : undefined}
      {phaseTasks(phase)}
      {worker !== undefined && <Box flexDirection="column" marginTop={1}>{workRows(worker, `card:${phase.id}`)}</Box>}
      {phaseGates(phase)}
    </Box>
    )
  }

  /** A phase outside the current wave in one line; pressing it opens what it is, its gates and its session. */
  const phaseLine = (phase: PhaseView, w: number): RenderElement[] => {
    const id = phaseKey(w, phase)
    const open = isOpen(id, false)
    const waits = phase.status === 'pending' && phase.dependsOn?.length ? `após ${phase.dependsOn.join(', ')}` : undefined
    return [
      row(
        <Button key={id} plain onPress={actions.toggle(id, false)}>
          <Text color={STATUS_HEX[phase.status]}>● </Text>
          <Text dimColor={phase.status === 'done'}>
            {phase.icon ? `${phase.icon} ` : ''}
            {phase.title}
          </Text>
          <Text dimColor>{open ? ' ⌄' : ' ›'}</Text>
        </Button>,
        <Box flexDirection="row" columnGap={1}>
          {phase.jira !== undefined && jiraKeyButton(phase.jira)}
          <Text color={waits === undefined ? STATUS_HEX[phase.status] : undefined} dimColor={waits !== undefined}>
            {waits ?? STATUS_WORD[phase.status]}
          </Text>
        </Box>,
      ),
      ...jiraBelow(phase.jira, phase.status).map(r => <Box paddingLeft={2}>{r}</Box>),
      ...(open
        ? [
            <Box flexDirection="column" paddingLeft={2}>
              {phase.summary !== undefined && <Text wrap="wrap">{phase.summary}</Text>}
              {phase.note !== undefined && (
                <Text wrap="wrap" dimColor>
                  {phase.note}
                </Text>
              )}
              {phaseTasks(phase)}
              {phase.card !== undefined && workRows(phase.card, `line:${w}:${phase.id}`)}
              {phaseGates(phase)}
            </Box>,
          ]
        : []),
    ]
  }

  const nowCard = (): RenderElement[] => {
    if (run === undefined || now === undefined) return []
    const phases = waves[now] ?? []
    const active = phases.filter(p => p.status !== 'done')
    const closed = phases.filter(p => p.status === 'done')
    const accent = STATUS_HEX[waveStatus(phases)]
    return [
      card(
        'now',
        `Agora · ${waveName(now)}`,
        [
          ...(run.waves[now]?.summary === undefined ? [] : [<Text wrap="wrap">{run.waves[now]?.summary}</Text>]),
          ...jiraRows(run.waves[now]?.jira, waveStatus(phases)),
          <Box flexDirection="column" rowGap={1} marginTop={1}>
            {active.map(phaseCard)}
          </Box>,
          ...closed.flatMap(phase => phaseLine(phase, now)),
        ],
        `${closed.length} de ${phases.length}`,
        accent,
      ),
    ]
  }

  const waveGroups = (indices: readonly number[]): RenderElement[] =>
    indices.map(w => {
      const phases = waves[w] ?? []
      return group(
        `wave:${w}`,
        waveName(w),
        `${phases.filter(p => p.status === 'done').length}/${phases.length}`,
        false,
        () => [...jiraRows(run?.waves[w]?.jira, waveStatus(phases)), ...phases.flatMap(phase => phaseLine(phase, w))],
        run?.waves[w]?.summary,
      )
    })

  const later = waves.map((_, w) => w).filter(w => now !== undefined && w > now)
  const earlier = waves.map((_, w) => w).filter(w => now === undefined || w < now)

  // Reading order: how much is left, what the change is (OpenSpec guides it), what needs the
  // owner, what runs now and next; what is finished goes last.
  cards.push(...runCard())
  if (view.openspec !== undefined) cards.push(openSpecCard(view.openspec))
  if (attentionCard !== undefined) cards.push(attentionCard)
  cards.push(...nowCard())
  if (later.length > 0) cards.push(card('later', 'Depois', waveGroups(later), `${later.length} ondas`))

  const own = planProgress(ownPlan)
  cards.push(
    card(
      'self',
      'Esta sessão',
      ownPlan.length === 0
        ? [<Text dimColor>Sem lista de tarefas ainda</Text>]
        : [
            row(`${percent(own.done, own.total)}% concluído`, `${own.done} / ${own.total} passos`),
            bar(
              [
                { value: own.done, hex: STATUS_HEX.done },
                { value: own.current === undefined ? 0 : 1, hex: STATUS_HEX.running },
                { value: own.total - own.done - (own.current === undefined ? 0 : 1), hex: STATUS_HEX.pending },
              ],
              `${own.done} de ${own.total} passos`,
            ),
            <Box marginTop={1} />,
            ...planRows(ownPlan),
          ],
      view.self?.branch,
      undefined,
      run === undefined,
    ),
  )

  const used = new Set(
    run === undefined ? [] : phaseViews(run, view.children).flat().flatMap(p => (p.card ? [p.card.sessionId] : [])),
  )
  const loose = view.children.filter(c => !used.has(c.sessionId))
  if (loose.length > 0) {
    cards.push(
      card(
        'children',
        run === undefined ? 'Sessões filhas' : 'Outras sessões',
        loose.map(c => {
          const progress = planProgress(c.plan)
          return group(
            `session:${c.sessionId}`,
            c.title,
            c.waiting === undefined && !c.isRunning && progress.total > 0
              ? `${progress.done}/${progress.total}`
              : sessionState(c),
            c.isRunning || c.waiting !== undefined,
            () => [...sessionRows(c), ...planRows(c.plan)],
          )
        }),
        `${loose.filter(c => c.isRunning).length} ativas`,
      ),
    )
  }

  if (earlier.length > 0) {
    const closedPhases = earlier.reduce((sum, w) => sum + (waves[w]?.length ?? 0), 0)
    cards.push(card('done', 'Concluído', waveGroups(earlier), `${closedPhases} fases`, undefined, now === undefined))
  }

  if (view.warning !== undefined) {
    cards.push(
      <Box paddingX={1}>
        <Text color="warning" wrap="wrap">
          {view.warning}
        </Text>
      </Box>,
    )
  }

  return (
    <Box flexDirection="column" rowGap={1}>
      {cards}
    </Box>
  )
}
