import { update } from 'claude-code'
import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  EngineInterface,
  InputProps,
  RenderElement,
  SelectProps,
  TextProps,
} from 'claude-code'

import type {
  ConfigAsk,
  ConfigDraft,
  FlowDef,
  FlowDeploy,
  FlowMerge,
  FlowStepDetails,
  FlowStepKind,
  Lang,
  Languages,
  ProjectSettings,
  Translations,
  WorkflowDraft,
  WorkflowForms,
} from '../types'
import { findAgent, listAgents, loadConfig, loadFlows } from './flow-files'
import type { AgentInfo } from './flow-files'
import { DEFAULT_FLOWS, defaultFlows } from './flows/index'
import { LIBRARY, libraryStep } from './flows/library'
import {
  EMPTY_FORMS,
  WORKFLOW_ID,
  addLibraryStep,
  addNewStep,
  brokenDependents,
  changesOf,
  draftFile,
  draftOf,
  moveStep,
  newDraft,
  resolveCandidate,
  setStepField,
  slug,
  toggleStep,
  useProjectValues,
} from './workflow-edit'
import type { StepField } from './workflow-edit'
import type { FlowSource } from './flow'
import { CONFIG_PATH, DEFAULT_LANGUAGES, localize, parseLocalized } from './i18n'
import { workflowsText } from './i18n-workflows'
import {
  applyConfigChange,
  configChanged,
  configChanges,
  configText,
  draftOfConfig,
  effectiveDeploy,
  effectiveMerge,
  workflowState,
} from './project-edit'
import type { ConfigChange, WorkflowState } from './project-edit'
import type { WorkflowsText } from './i18n-workflows'

export const WORKFLOWS_PANE = 'orquestrador-workflows'
export const WORKFLOWS_TITLE = '⚙️ Workflows'

const SELECTED = { plugin: 'orquestrador', key: 'wfSelected' } as const
const FOCUS = { plugin: 'orquestrador', key: 'wfFocus' } as const
const INSERT = { plugin: 'orquestrador', key: 'wfInsert' } as const
const DRAFT = { plugin: 'orquestrador', key: 'wfDraft' } as const
const FORMS = { plugin: 'orquestrador', key: 'wfForms' } as const
const NOTICE = { plugin: 'orquestrador', key: 'wfNotice' } as const
const CFG = { plugin: 'orquestrador', key: 'wfCfgDraft' } as const
const ASK = { plugin: 'orquestrador', key: 'wfCfgAsk' } as const
/** The `routineFor` value that opens "+ rotina" in the project's deploy settings. */
const CFG_ROUTINE = ':cfg'

/** Below this many columns the pane stacks what sits side by side. */
const NARROW_COLUMNS = 44
const LINK = '#2F6FD6'
const ERROR = '#D14343'
const WARN = '#B7791F'
const OWNER = '#C2410C'
const MOD = '#6B6A66'
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
/** A Select's "nothing chosen": its options' values must be words. */
const NONE = '-'
/** "+ passo aqui" open at the end of a workflow that has no step yet. */
export const INSERT_END = ':fim'
/** The focus value that opens the "Nome e descrição" block of the edit screen. */
export const HEAD_FOCUS = ':nome'
/** The "+ passo aqui" choice that is no library step. */
const NEW_STEP = 'novo'

const WHO_COLOR: Record<FlowStepKind, string> = { session: LINK, owner: OWNER, automatic: MOD, loop: MOD }
/** Who answers, as a pill: background and text colors of the mockup. */
const WHO_PILL: Record<FlowStepKind, { bg: string; fg: string }> = {
  session: { bg: '#E3ECFB', fg: '#1E4C9E' },
  owner: { bg: '#FDEBDD', fg: '#9A3412' },
  automatic: { bg: '#EDECE8', fg: '#3D3C39' },
  loop: { bg: '#EDECE8', fg: '#3D3C39' },
}
const TAG_BLUE = { bg: '#EEF3FC', fg: '#1E4C9E' }
const TAG_GRAY = { bg: '#F2F1EC', fg: '#3D3C39' }
const TAG_AMBER = { bg: '#FDF3E1', fg: '#7A4A00' }
const AMBER_BAR = '#FFF8EB'
const AMBER_RULE = '#F0DDB8'
const RULE = '#E4E2DC'
const MUTED = '#5F5E5A'

export type WorkflowsElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  /** Fields, where the surface has them (not on mobile). */
  Input: ElementConstructor<InputProps> | undefined
  Select: ElementConstructor<SelectProps> | undefined
}

/** A workflow on offer, with where it comes from. */
export type WorkflowEntry = { flow: FlowDef; origin: string; project: boolean; replaces: boolean }

/** A default workflow this project does not use because its own of the same id wins. */
export type RetiredEntry = { flow: FlowDef; by: FlowDef }

export type ConfigView = {
  project: ProjectSettings
  problems: string[]
  draft: ConfigDraft | null
  ask: ConfigAsk | null
  states: WorkflowState[]
}

export type WorkflowsView = {
  entries: WorkflowEntry[]
  retired: RetiredEntry[]
  problems: string[]
  selected: string | null
  focus: string | null
  /** Where "+ passo aqui" is open: a step id, INSERT_END, or none. */
  insert: string | null
  draft: WorkflowDraft | null
  forms: WorkflowForms
  notice: string | null
  /** Where each agent named by the steps shown was found. */
  agents: Record<string, 'project' | 'plugin' | null>
  /** Every agent that can be picked, with its description and model. */
  agentList: AgentInfo[]
  narrow: boolean
  /** The project's settings (config.json): what the summary shows, the edit in progress and how each workflow stands. */
  config?: ConfigView
  /** The project's languages: `ui` for the pane's words and titles, `content` for descriptions and details; absent, pt-BR. */
  languages?: Languages
}

export type WorkflowsActions = {
  open: (id: string) => () => void
  back: () => void
  focus: (step: string) => () => void
  edit: (id: string) => () => void
  form: (field: keyof WorkflowForms) => (value: string) => void
  create: () => void
  head: (field: 'title' | 'description') => (value: string) => void
  toggle: (step: string) => () => void
  move: (step: string, by: -1 | 1) => () => void
  set: (step: string, change: StepField) => () => void
  /** Opens (or closes) "+ passo aqui" after a step, or at the end. */
  insert: (after: string) => () => void
  add: () => void
  save: () => void
  discard: () => void
  /** "Configurar": opens the project settings as a draft. */
  configure: () => void
  cfgSet: (change: ConfigChange) => () => void
  cfgSave: () => void
  cfgDiscard: () => void
  /** "Acrescentar merge e deploy" / "Passar a usar o do projeto": asks for the confirmation. */
  ask: (what: ConfigAsk['what'], id: string) => () => void
  confirm: () => void
  cancel: () => void
}

/** A step as the pane reads it: a flow's, or a draft's raw one. */
type StepLike = {
  id: string
  /** Plain text, or one text per language (a draft's raw step). */
  title: unknown
  description?: unknown
  titles?: Translations
  descriptions?: Translations
  kind: FlowStepKind
  agent?: string
  model?: string
  effort?: string
  command?: string
  requiresEvidence?: boolean
  details?: { inputs?: unknown; produces?: unknown; blocks?: unknown }
  detailsByLang?: Partial<Record<Lang, FlowStepDetails>>
  merge?: FlowMerge
  deploy?: FlowDeploy
  outcomes?: Record<string, { label?: string; next: string }>
}

const yesNo = (t: WorkflowsText, b: boolean | undefined) => (b === true ? t.yes : t.no)

/** `claude-opus-5-5` as the owner reads it: Opus 5.5. */
export const modelName = (model: string): string => {
  const parts = model.replace(/^claude-/, '').split('-')
  const [name = model, ...version] = parts
  return [name.charAt(0).toUpperCase() + name.slice(1), version.join('.')].filter(x => x !== '').join(' ')
}

const effortName = (t: WorkflowsText, effort: string): string => t.effort[effort] ?? effort

/** A flow's title in the ui language; its description in the content language. */
const flowTitle = (flow: FlowDef, lang: Lang): string => localize(flow.titles, lang) ?? flow.title
const flowDescription = (flow: FlowDef, lang: Lang): string => localize(flow.descriptions, lang) ?? flow.description

/** A step's title in `lang`: a parsed step's `titles`, or a raw step's `title` written as text or per language. */
const titleOf = (s: { id?: unknown; title?: unknown; titles?: Translations }, lang: Lang): string =>
  localize(s.titles ?? parseLocalized(s.title), lang) ?? String(s.id ?? '')
const descriptionOf = (s: { description?: unknown; descriptions?: Translations }, lang: Lang): string | undefined =>
  localize(s.descriptions ?? parseLocalized(s.description), lang)
/** One of the step's details in `lang`: a parsed step's per-language one, else the field as written (text or per language). */
const detailOf = (s: StepLike, key: keyof FlowStepDetails, lang: Lang): string | undefined =>
  localize(parseLocalized(s.detailsByLang?.[lang]?.[key] ?? s.details?.[key]), lang)

/** Where a problem line from the loader names its file, shortened, and what is wrong with it in plain words. */
const problemParts = (t: WorkflowsText, problem: string): { file: string; what: string } => {
  const at = problem.indexOf(': ')
  const path = at === -1 ? problem : problem.slice(0, at)
  const what = at === -1 ? '' : problem.slice(at + 2)
  const file = path.includes('.orquestrador/flows/') ? path.slice(path.indexOf('.orquestrador/flows/') + '.orquestrador/flows/'.length) : path
  return { file, what: what === 'not valid JSON.' ? t.invalidJson : what }
}

export const renderWorkflows = (els: WorkflowsElements, view: WorkflowsView, actions: WorkflowsActions): RenderElement => {
  const { Box, Text, Button, Input, Select } = els
  const languages = view.languages ?? DEFAULT_LANGUAGES
  const ui = languages.ui
  const content = languages.content
  const t = workflowsText(ui)
  const yes = (b: boolean | undefined) => yesNo(t, b)
  const title = (s: StepLike) => titleOf(s, ui)
  const fields = Input !== undefined && Select !== undefined

  const line = (text: string, color?: string, dim?: boolean) => (
    <Text wrap="wrap" color={color} dimColor={dim}>
      {text}
    </Text>
  )
  const help = (text: string) => line(text, undefined, true)
  const buttons = (...items: RenderElement[]) => (
    <Box flexDirection={view.narrow ? 'column' : 'row'} flexWrap="wrap" columnGap={1} minWidth={0}>
      {items}
    </Box>
  )
  const box = (children: RenderElement[], color?: string) => (
    <Box flexDirection="column" borderStyle="round" borderColor={color} borderDimColor={color === undefined} paddingX={1} minWidth={0}>
      {children}
    </Box>
  )
  const noFields = line(t.noFields, undefined, true)
  /** A pill: a rounded Box with its own background, never the label between brackets. */
  const pill = (label: string, tone: { bg: string; fg: string }) => (
    <Box key={`wf-pill:${label}`} borderStyle="round" borderColor={tone.bg} backgroundColor={tone.bg} paddingX={1} flexShrink={0}>
      <Text size="caption" color={tone.fg} backgroundColor={tone.bg}>
        {label}
      </Text>
    </Box>
  )
  const tag = (label: string) => pill(label, TAG_GRAY)
  /** A hairline under the header, cut to the width of the pane. */
  const divider = (
    <Box key="wf-divider" width="100%" height={1} overflow="hidden" minWidth={0}>
      <Text color={RULE} wrap="truncate">{'─'.repeat(200)}</Text>
    </Box>
  )
  /** A small section label in capitals. */
  const label = (title: string) => (
    <Text size="caption" weight="semibold" color={MUTED}>
      {title.toUpperCase()}
    </Text>
  )

  const agentModel = (name: string | undefined): string | undefined =>
    name === undefined ? undefined : view.agentList.find(a => a.name === name)?.model
  const originOf = (name: string): string => {
    const found = view.agents[name]
    return found === 'project' ? t.agentOrigin.project : found === 'plugin' ? t.agentOrigin.plugin : t.agentOrigin.missing
  }

  /** Who answers the step, in the words of the legend. */
  const who = (s: StepLike): string =>
    s.kind === 'session'
      ? t.who.session
      : s.kind === 'owner'
        ? t.who.owner
        : s.kind === 'loop'
          ? t.who.loop
          : s.merge !== undefined || s.deploy !== undefined
            ? t.who.coordination
            : t.who.mod
  const whoShort = (s: StepLike): string => (s.merge !== undefined || s.deploy !== undefined ? (s.kind === 'automatic' ? t.whoTagAutomatic : t.whoTag[s.kind]) : t.whoTag[s.kind])

  const modelLine = (s: StepLike): string => {
    const fromAgent = s.model === undefined ? agentModel(s.agent) : undefined
    const model = s.model ?? fromAgent
    const parts = [model === undefined ? undefined : modelName(model), s.effort === undefined ? undefined : t.effortOf(effortName(t, s.effort))]
    return parts.filter((x): x is string => x !== undefined).join(', ')
  }
  /** The detail row's model: the summary's, or the session's own when nothing sets one. */
  const modelRow = (s: StepLike): string => {
    const fromAgent = s.model === undefined ? agentModel(s.agent) : undefined
    return modelLine(s) === '' ? t.sessionDefault : `${modelLine(s)}${fromAgent === undefined ? '' : t.fromAgentSuffix}`
  }

  /** The step's one-line summary, in plain words. */
  const summary = (s: StepLike): string => {
    if (s.merge !== undefined) {
      return s.merge.auto
        ? t.summary.mergeAuto(s.merge.method, s.merge.branch)
        : t.summary.mergeOwner(s.merge.method, s.merge.branch)
    }
    if (s.deploy !== undefined) {
      const part = [s.deploy.ci ? t.summary.waitsCi : undefined, s.deploy.commands.length > 0 ? t.summary.runs(s.deploy.commands.join(', ')) : undefined]
        .filter((x): x is string => x !== undefined)
        .join(t.summary.and)
      return `${s.deploy.auto ? t.summary.deployAuto : t.summary.deployOwner} · ${part === '' ? t.summary.noCiNoRoutines : part}`
    }
    if (s.kind === 'session' || s.kind === 'loop') {
      const lead = s.kind === 'loop' ? t.summary.loopLead : t.summary.sessionLead
      if (s.agent === undefined) return t.summary.noAgent(lead)
      return t.summary.withAgent(lead, s.agent, modelLine(s))
    }
    if (s.kind === 'automatic' && s.command !== undefined) return t.summary.modSees(s.command)
    return descriptionOf(s, content) ?? who(s)
  }

  const row = (label: string, value: string) => (
    <Box key={`wf-row-${label}`} flexDirection={view.narrow ? 'column' : 'row'} columnGap={1} minWidth={0}>
      <Box width={view.narrow ? undefined : 12} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">{value}</Text>
      </Box>
    </Box>
  )

  /** Where a rejected step goes back to: its outcomes that lead to an earlier step. */
  const rejects = (s: StepLike, all: StepLike[]): string => {
    const here = all.findIndex(x => x.id === s.id)
    const back = Object.values(s.outcomes ?? {})
      .map(o => all.findIndex(x => x.id === o.next))
      .filter(i => i !== -1 && i < here)
      .map(i => title(all[i]!))
    return back.length === 0 ? t.noBack : t.backTo([...new Set(back)])
  }

  const detailRows = (s: StepLike, all: StepLike[]): RenderElement[] => {
    const out: RenderElement[] = [row(t.rows.who, who(s))]
    out.push(row(t.rows.agent, s.agent === undefined ? t.none : `${s.agent} (${originOf(s.agent)})`))
    out.push(row(t.rows.model, modelRow(s)))
    if (s.command !== undefined) out.push(row(t.rows.command, s.command))
    if (s.merge !== undefined) out.push(row(t.rows.merge, t.mergeRow(s.merge.branch, s.merge.method, yes(s.merge.auto))))
    if (s.deploy !== undefined) {
      out.push(row(t.rows.deploy, t.deployRow(yes(s.deploy.ci), s.deploy.commands.length === 0 ? t.noneRoutine : s.deploy.commands.join(' ; '), yes(s.deploy.auto))))
    }
    const inputs = detailOf(s, 'inputs', content)
    const produces = detailOf(s, 'produces', content)
    const blocks = detailOf(s, 'blocks', content)
    if (inputs !== undefined) out.push(row(t.rows.inputs, inputs))
    if (produces !== undefined) out.push(row(t.rows.produces, produces))
    out.push(row(t.rows.ifRejected, rejects(s, all)))
    if (blocks !== undefined) out.push(row(t.rows.blocks, blocks))
    out.push(row(t.rows.evidence, s.requiresEvidence === true ? t.evidenceRequired : t.evidenceNotRequired))
    return out
  }

  /** The step's number inside a circle in the color of who answers it. */
  const stepNumber = (s: StepLike, n: number | string, off = false) => {
    const bg = off ? RULE : WHO_COLOR[s.kind]
    return (
      <Box width={5} flexShrink={0}>
        <Box width={3} borderStyle="round" borderColor={bg} backgroundColor={bg} alignItems="center" justifyContent="center" flexShrink={0}>
          <Text weight="bold" color={off ? MUTED : '#FFFFFF'} backgroundColor={bg}>{`${n}`}</Text>
        </Box>
      </Box>
    )
  }

  /** A step of the workflow shown, not edited: number, title, one line, and its rows when opened. */
  const viewStep = (s: StepLike, n: number, all: StepLike[]): RenderElement => {
    const open = view.focus === s.id
    return (
      <Box key={`wf-row:${s.id}`} flexDirection="row" minWidth={0} marginTop={1}>
        {stepNumber(s, n)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Button key={`wf-step:${s.id}`} plain onPress={actions.focus(s.id)}>
            <Text weight="semibold">{title(s)}</Text>
          </Button>
          <Text wrap="wrap" color={MUTED} size="footnote">{summary(s)}</Text>
          {open ? <Box flexDirection="column" marginTop={1} rowGap={1} minWidth={0}>{detailRows(s, all)}</Box> : []}
        </Box>
      </Box>
    )
  }

  const back = (
    <Button key="wf-back" plain onPress={actions.back}>
      <Text color={LINK}>{t.back}</Text>
    </Button>
  )

  const heading = (title: string, extra?: RenderElement) => (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} minWidth={0}>
      <Text size="heading" weight="semibold" wrap="wrap">{title}</Text>
      {extra ?? []}
    </Box>
  )

  /* ---------- edição ---------- */

  const text = (key: string, label: string, value: string | undefined, apply: (v: string) => void, submit?: (v: string) => void) =>
    Input === undefined ? (
      noFields
    ) : (
      <Input
        key={key}
        label={label}
        submitLabel={t.apply}
        {...(value === undefined || value === '' ? {} : { value })}
        onInput={apply}
        onSubmit={submit ?? apply}
      />
    )

  const agentSelect = (key: string, current: string | undefined, apply: (v: string) => void) => {
    const known = view.agentList.some(a => a.name === current)
    const options = [
      ...view.agentList.map(a => ({ value: a.name, label: t.agentOption(a.name, a.source === 'project' ? t.agentOrigin.project : t.agentOrigin.plugin) })),
      ...(current === undefined || known ? [] : [{ value: current, label: t.agentOption(current, t.agentOrigin.missing) }]),
      { value: NONE, label: t.noAgentOption },
    ]
    return Select === undefined ? (
      noFields
    ) : (
      <Select key={key} label={t.agentLabel} options={options} value={current ?? NONE} onSelect={v => apply(v === NONE ? '' : v)} />
    )
  }
  const agentAbout = (name: string | undefined) => {
    if (name === undefined) return help(t.noAgentHelp)
    const found = view.agentList.find(a => a.name === name)
    return help(found === undefined ? t.noAgentFile(name) : found.description)
  }

  const editCard = (s: StepLike, n: number, opts: { first: boolean; last: boolean }): RenderElement => {
    const set = (field: 'agent' | 'model' | 'effort') => (v: string) => actions.set(s.id, { field, value: v })()
    const takesAgent = s.kind === 'session' || s.kind === 'loop' || s.merge !== undefined || s.deploy !== undefined
    const body: RenderElement[] = []
    if (!fields) body.push(noFields)
    else if (Select !== undefined) {
      if (takesAgent) {
        body.push(agentSelect(`wf-agent:${s.id}`, s.agent, set('agent')), agentAbout(s.agent))
      }
      const fromAgent = agentModel(s.agent)
      const models = [...new Set([...MODELS, ...(s.model === undefined ? [] : [s.model])])]
      body.push(
        <Select
          key={`wf-model:${s.id}`}
          label={t.modelLabel}
          options={[
            { value: NONE, label: fromAgent === undefined ? t.sessionDefault : t.fromAgent(modelName(fromAgent)) },
            ...models.map(m => ({ value: m, label: modelName(m) })),
          ]}
          value={s.model ?? NONE}
          onSelect={v => set('model')(v === NONE ? '' : v)}
        />,
        <Select
          key={`wf-effort:${s.id}`}
          label={t.effortLabel}
          options={[
            { value: NONE, label: t.sessionDefault },
            ...[...new Set([...EFFORTS, ...(s.effort === undefined ? [] : [s.effort])])].map(e => ({ value: e, label: effortName(t, e) })),
          ]}
          value={s.effort ?? NONE}
          onSelect={v => set('effort')(v === NONE ? '' : v)}
        />,
        help(t.modelHelp),
      )
      if (s.merge !== undefined) {
        body.push(
          text(`wf-merge-branch:${s.id}`, t.merge.branchLabel, s.merge.branch, v => actions.set(s.id, { field: 'merge', value: { branch: v.trim() } })()),
          help(t.merge.branchHelp),
          <Select
            key={`wf-merge-method:${s.id}`}
            label={t.merge.methodLabel}
            options={Object.entries(t.methods).map(([value, label]) => ({ value, label }))}
            value={s.merge.method}
            onSelect={v => actions.set(s.id, { field: 'merge', value: { method: v as FlowMerge['method'] } })()}
          />,
        )
      }
    }
    if (s.merge !== undefined) {
      body.push(
        buttons(
          <Button key={`wf-merge-auto:${s.id}`} onPress={actions.set(s.id, { field: 'merge', value: { auto: !s.merge.auto } })}>
            {t.merge.auto(yes(s.merge.auto))}
          </Button>,
        ),
        help(t.merge.autoHelp),
      )
    }
    if (s.deploy !== undefined) {
      const deploy = s.deploy
      const commands = (list: string[]) => actions.set(s.id, { field: 'deploy', value: { commands: list } })()
      body.push(
        buttons(
          <Button key={`wf-deploy-ci:${s.id}`} onPress={actions.set(s.id, { field: 'deploy', value: { ci: !deploy.ci } })}>
            {t.deploy.ci(yes(deploy.ci))}
          </Button>,
        ),
        help(t.deploy.ciHelp),
        line(t.deploy.routines),
      )
      if (fields) {
        deploy.commands.forEach((command, i) => {
          body.push(
            text(
              `wf-routine:${s.id}:${i}`,
              t.deploy.routine(i + 1),
              command,
              v => {
                if (v.trim() !== '') commands(deploy.commands.map((c, j) => (j === i ? v.trim() : c)))
              },
              v => commands(v.trim() === '' ? deploy.commands.filter((_, j) => j !== i) : deploy.commands.map((c, j) => (j === i ? v.trim() : c))),
            ),
            buttons(
              <Button key={`wf-routine-del:${s.id}:${i}`} onPress={() => commands(deploy.commands.filter((_, j) => j !== i))}>
                {t.deploy.removeRoutine(i + 1)}
              </Button>,
            ),
          )
        })
        if (view.forms.routineFor === s.id) {
          body.push(text(`wf-routine-new:${s.id}`, t.deploy.newRoutine, undefined, () => {}, v => {
            if (v.trim() !== '') commands([...deploy.commands, v.trim()])
            actions.form('routineFor')('')
          }))
        }
      }
      body.push(
        buttons(
          <Button key={`wf-routine-add:${s.id}`} onPress={() => actions.form('routineFor')(s.id)}>
            {t.deploy.addRoutine}
          </Button>,
        ),
        help(t.deploy.routinesHelp),
        buttons(
          <Button key={`wf-deploy-auto:${s.id}`} onPress={actions.set(s.id, { field: 'deploy', value: { auto: !deploy.auto } })}>
            {t.deploy.auto(yes(deploy.auto))}
          </Button>,
        ),
        help(t.deploy.autoHelp),
      )
    }
    return box([
      <Box key={`wf-card-head:${s.id}`} flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
        <Button key={`wf-step:${s.id}`} plain onPress={actions.focus(s.id)}>
          <Text weight="semibold">{`${n}. ${title(s)}`}</Text>
        </Button>
        {pill(whoShort(s), WHO_PILL[s.kind])}
      </Box>,
      line(who(s), undefined, true),
      ...body,
      buttons(
        ...(opts.first ? [] : [<Button key={`wf-up:${s.id}`} onPress={actions.move(s.id, -1)}>{t.up}</Button>]),
        ...(opts.last ? [] : [<Button key={`wf-down:${s.id}`} onPress={actions.move(s.id, 1)}>{t.down}</Button>]),
        <Button key={`wf-toggle:${s.id}`} onPress={actions.toggle(s.id)}>
          {t.switchOff}
        </Button>,
      ),
    ])
  }

  const insertForm = (d: WorkflowDraft, after: StepLike | undefined): RenderElement => {
    const forms = view.forms
    const use = forms.libraryUse === '' ? NEW_STEP : forms.libraryUse
    const libraryIds = Object.keys(LIBRARY).sort()
    const chosen = use === NEW_STEP ? undefined : libraryStep(use)
    const about =
      chosen === undefined || typeof chosen === 'string'
        ? t.insert.newAbout
        : (descriptionOf(chosen as { description?: unknown }, content) ?? '')
    const labelOf = (id: string): string => {
      const step = libraryStep(id)
      return typeof step === 'string' ? id : localize(parseLocalized(step.title), ui) ?? id
    }
    const body: RenderElement[] = []
    if (Select === undefined || Input === undefined) body.push(noFields)
    else {
      body.push(
        <Select
          key="wf-add-library"
          label={t.insert.libraryLabel}
          options={[...libraryIds.map(id => ({ value: id, label: labelOf(id) })), { value: NEW_STEP, label: t.insert.newStepOption }]}
          value={use}
          onSelect={v => actions.form('libraryUse')(v === NEW_STEP ? '' : v)}
        />,
        help(about),
      )
      if (use === NEW_STEP) {
        body.push(
          <Input
            key="wf-step-title"
            label={t.insert.titleLabel}
            submitLabel={t.ok}
            {...(forms.stepTitle === '' ? {} : { value: forms.stepTitle })}
            onInput={actions.form('stepTitle')}
            onSubmit={actions.form('stepTitle')}
          />,
          help(t.insert.titleHelp),
          <Select
            key="wf-step-kind"
            label={t.insert.kindLabel}
            options={[
              { value: 'session', label: t.insert.kinds.session },
              { value: 'owner', label: t.insert.kinds.owner },
              { value: 'automatic', label: t.insert.kinds.automatic },
            ]}
            value={forms.stepKind}
            onSelect={actions.form('stepKind')}
          />,
        )
        if (forms.stepKind === 'session') {
          body.push(agentSelect('wf-step-agent', forms.stepAgent === '' ? undefined : forms.stepAgent, actions.form('stepAgent')), agentAbout(forms.stepAgent === '' ? undefined : forms.stepAgent))
        }
        if (forms.stepKind === 'automatic') {
          body.push(
            <Input
              key="wf-step-command"
              label={t.insert.commandLabel}
              submitLabel={t.ok}
              {...(forms.stepCommand === '' ? {} : { value: forms.stepCommand })}
              onInput={actions.form('stepCommand')}
              onSubmit={actions.form('stepCommand')}
            />,
            help(t.insert.commandHelp),
          )
        }
      }
    }
    return box(
      [
        <Text weight="semibold" wrap="wrap">{after === undefined ? t.insert.atStart : t.insert.after(title(after))}</Text>,
        ...body,
        buttons(
          <Button key="wf-add" variant="primary" onPress={actions.add}>
            {t.insert.add}
          </Button>,
          <Button key="wf-add-cancel" onPress={actions.insert(String(view.insert))}>
            {t.insert.cancel}
          </Button>,
        ),
      ],
      LINK,
    )
  }

  /* ---------- configurações do projeto ---------- */

  const notice$ = (n: string | null): RenderElement[] => (n === null ? [] : [box([line(n)])])

  const cfg = view.config
  const P = t.project
  const rule = (key: string) => (
    <Box key={key} width="100%" height={1} overflow="hidden" minWidth={0}>
      <Text color={RULE} wrap="truncate">{'─'.repeat(200)}</Text>
    </Box>
  )
  /** A button that says its state: filled when on. */
  const stateButton = (key: string, label: string, on: boolean, press: () => void) =>
    buttons(
      <Button key={key} variant={on ? 'primary' : 'secondary'} onPress={press}>
        {label}
      </Button>,
    )
  const entryTitle = (id: string): string => {
    const entry = view.entries.find(e => e.flow.id === id)
    return entry === undefined ? id : flowTitle(entry.flow, ui)
  }

  /** "Nos workflows": how each workflow stands, and what can be done about it. */
  const workflowCards = (c: ConfigView): RenderElement[] =>
    c.states.map(state => {
      const name = entryTitle(state.id)
      const W = P.workflows
      const sentence =
        state.missing.length === 2
          ? W.none(name)
          : state.missing[0] === 'merge'
            ? W.noMerge(name)
            : state.missing[0] === 'deploy'
              ? W.noDeploy(name)
              : state.own.length > 0
                ? W.own(
                    name,
                    state.own.map(o => {
                      const block = o.step[o.what] as unknown as Record<string, unknown>
                      const words = W.fieldText as Record<string, (v: never) => string>
                      return W.ownPart(
                        W.what[o.what],
                        o.fields.map(f => words[f]!(block[f] as never)).join(', '),
                      )
                    }),
                  )
                : W.uses(name)
      const rest = sentence.startsWith(name) ? sentence.slice(name.length) : ` ${sentence}`
      const asked = c.ask !== null && c.ask.id === state.id ? c.ask : null
      const missingNames = state.missing.map(m => W.what[m])
      const replaces = view.entries.find(e => e.flow.id === state.id)?.project === false
      const actions$: RenderElement[] = []
      if (asked !== null) {
        actions$.push(
          line(
            (asked.what === 'add' ? W.confirmAdd(name, missingNames) : W.confirmUse(name)) + (replaces ? W.replacesDefault(state.id) : ''),
          ),
          buttons(
            <Button key="cfg-confirm" variant="primary" onPress={actions.confirm}>
              {W.confirm}
            </Button>,
            <Button key="cfg-cancel" onPress={actions.cancel}>
              {W.cancel}
            </Button>,
          ),
        )
      } else {
        if (state.missing.length > 0) {
          actions$.push(
            buttons(
              <Button key={`cfg-add:${state.id}`} onPress={actions.ask('add', state.id)}>
                {W.add(name, missingNames)}
              </Button>,
            ),
          )
        }
        if (state.own.length > 0) {
          actions$.push(
            <Button key={`cfg-use:${state.id}`} plain onPress={actions.ask('use', state.id)}>
              <Text color={LINK}>{W.use}</Text>
            </Button>,
          )
        }
      }
      const missing = state.missing.length > 0
      return (
        <Box
          key={`cfg-wf:${state.id}`}
          flexDirection="column"
          rowGap={1}
          borderStyle="round"
          borderColor={missing ? AMBER_RULE : RULE}
          backgroundColor={missing ? AMBER_BAR : undefined}
          paddingX={1}
          minWidth={0}
        >
          <Text wrap="wrap">
            <Text weight="semibold">{name}</Text>
            {rest}
          </Text>
          {actions$}
        </Box>
      )
    })

  if (cfg?.draft != null) {
    const c = cfg.draft
    const E = P.edit
    const changes = configChanges(c, t)
    const merge = effectiveMerge(c.merge)
    const deploy = effectiveDeploy(c.deploy)
    const set = (change: ConfigChange) => actions.cfgSet(change)
    const langOptions = Object.entries(E.langOption).map(([value, label]) => ({ value, label }))
    const langSelect = (axis: 'ui' | 'content', label$: string, about: string) =>
      Select === undefined
        ? [noFields]
        : [
            <Select
              key={`cfg-${axis}`}
              label={label$}
              options={langOptions}
              value={c.languages[axis]}
              onSelect={v => set({ kind: axis, value: v as Lang })()}
            />,
            help(about),
          ]
    const commands = (list: string[]) => set({ kind: 'deploy', value: { commands: list } })()
    const block = (key: string, title$: string, children: RenderElement[]) => (
      <Box key={key} flexDirection="column" rowGap={1} marginTop={1} minWidth={0}>
        {rule(`${key}-rule`)}
        {label(title$)}
        {children}
      </Box>
    )
    return (
      <Box flexDirection="column" minWidth={0}>
        {notice$(view.notice)}
        <Box flexDirection="column" borderStyle="round" borderColor={AMBER_RULE} backgroundColor={AMBER_BAR} paddingX={1} minWidth={0}>
          <Text weight="semibold">{E.title}</Text>
          <Text size="caption" color="#6B4A12">{E.draftHelp}</Text>
          {buttons(
            <Button key="cfg-discard" onPress={actions.cfgDiscard}>
              {E.discard}
            </Button>,
            <Button key="cfg-save" variant="primary" onPress={actions.cfgSave}>
              {E.save}
            </Button>,
          )}
          <Text size="caption" color="#6B4A12" wrap="wrap">
            {changes.length === 0 ? E.noChanges : t.edit.changes(changes)}
          </Text>
        </Box>
        {c.error === undefined ? [] : box([line(E.notSaved(c.error), ERROR)], ERROR)}
        <Box marginTop={1} minWidth={0}>
          {help(E.about)}
        </Box>
        <Box flexDirection="column" rowGap={1} marginTop={1} minWidth={0}>
          {label(E.language)}
          {langSelect('ui', E.uiLabel, E.uiHelp)}
          {langSelect('content', E.contentLabel, E.contentHelp)}
        </Box>
        {block('cfg-merge', E.merge, [
          stateButton('cfg-merge-auto', E.mergeAuto(yes(merge.auto)), merge.auto, set({ kind: 'merge', value: { auto: !merge.auto } })),
          help(E.mergeAutoHelp),
          ...(fields
            ? [
                text('cfg-merge-branch', E.branchLabel, merge.branch, v => set({ kind: 'merge', value: { branch: v.trim() } })()),
                help(E.branchHelp),
                <Select
                  key="cfg-merge-method"
                  label={E.methodLabel}
                  options={Object.entries(t.methods).map(([value, label$]) => ({ value, label: label$ }))}
                  value={merge.method}
                  onSelect={v => set({ kind: 'merge', value: { method: v as FlowMerge['method'] } })()}
                />,
              ]
            : []),
        ])}
        {block('cfg-deploy', E.deploy, [
          stateButton('cfg-deploy-auto', E.deployAuto(yes(deploy.auto)), deploy.auto, set({ kind: 'deploy', value: { auto: !deploy.auto } })),
          help(E.deployAutoHelp),
          stateButton('cfg-deploy-ci', E.ci(yes(deploy.ci)), deploy.ci, set({ kind: 'deploy', value: { ci: !deploy.ci } })),
          help(E.ciHelp),
          <Text key="cfg-routines" weight="medium">{E.routines}</Text>,
          ...(fields
            ? deploy.commands.flatMap((command, i) => [
                text(
                  `cfg-routine:${i}`,
                  E.routine(i + 1),
                  command,
                  v => {
                    if (v.trim() !== '') commands(deploy.commands.map((x, j) => (j === i ? v.trim() : x)))
                  },
                  v => commands(v.trim() === '' ? deploy.commands.filter((_, j) => j !== i) : deploy.commands.map((x, j) => (j === i ? v.trim() : x))),
                ),
                buttons(
                  <Button key={`cfg-routine-del:${i}`} onPress={() => commands(deploy.commands.filter((_, j) => j !== i))}>
                    {E.remove}
                  </Button>,
                ),
              ])
            : deploy.commands.map((command, i) => line(`${i + 1}. ${command}`))),
          ...(fields && view.forms.routineFor === CFG_ROUTINE
            ? [
                text('cfg-routine-new', E.newRoutine, undefined, () => {}, v => {
                  if (v.trim() !== '') commands([...deploy.commands, v.trim()])
                  actions.form('routineFor')('')
                }),
              ]
            : []),
          ...(fields
            ? [
                <Button key="cfg-routine-add" plain onPress={() => actions.form('routineFor')(CFG_ROUTINE)}>
                  <Text color={LINK}>{E.addRoutine}</Text>
                </Button>,
              ]
            : []),
          help(E.routinesHelp),
        ])}
        {block('cfg-workflows', E.inWorkflows, workflowCards(cfg))}
      </Box>
    )
  }

  if (view.draft !== null) {
    const d = view.draft
    const onSteps = d.steps.filter(s => s.on).map(s => s.step as unknown as StepLike)
    const offSteps = d.steps.filter(s => !s.on).map(s => s.step as unknown as StepLike)
    const changes = changesOf(d, t)
    // the one "+ passo aqui": where it is open, else after the open step, else at the end
    const slot =
      view.insert !== null && (view.insert === INSERT_END || onSteps.some(s => s.id === view.insert))
        ? view.insert
        : onSteps.some(s => s.id === view.focus)
          ? String(view.focus)
          : INSERT_END
    const insertAt = (id: string, step: StepLike | undefined) => (
      <Box key={`wf-insert-box:${id}`} flexDirection="column" marginTop={1} minWidth={0}>
        {view.insert === id ? insertForm(d, step) : (
          <Button key={`wf-insert:${id}`} plain onPress={actions.insert(id)}>
            <Text color={LINK}>{t.insert.here}</Text>
          </Button>
        )}
      </Box>
    )
    return (
      <Box flexDirection="column" minWidth={0}>
        <Box flexDirection="column" borderStyle="round" borderColor={RULE} paddingX={1} minWidth={0}>
          {heading(t.edit.editing(d.title))}
          {help(t.edit.draftHelp)}
          {buttons(
            <Button key="wf-save" variant="primary" onPress={actions.save}>
              {t.edit.save}
            </Button>,
            <Button key="wf-discard" onPress={actions.discard}>
              {t.edit.discard}
            </Button>,
          )}
          {line(changes.length === 0 ? t.edit.noChanges : t.edit.changes(changes), undefined, changes.length === 0)}
        </Box>
        {d.error === undefined ? [] : box([line(t.edit.notSaved(d.error), ERROR)], ERROR)}
        {d.base === undefined ? [] : help(t.edit.derived(d.base))}
        {d.replacesDefault
          ? box([line(t.edit.replacesDefault(d.id), WARN)], WARN)
          : []}
        {help(t.edit.runningKeep)}
        {fields
          ? [
              <Box key="wf-head-block" flexDirection="column" marginTop={1} minWidth={0}>
                <Button key="wf-head-toggle" plain onPress={actions.focus(HEAD_FOCUS)}>
                  <Text weight="semibold">{`${view.focus === HEAD_FOCUS ? '▾' : '›'} ${t.edit.nameAndDescription}`}</Text>
                </Button>
                {view.focus === HEAD_FOCUS
                  ? [
                      <Input key="wf-title" label={t.edit.nameLabel} submitLabel={t.apply} value={d.title} onInput={actions.head('title')} onSubmit={actions.head('title')} />,
                      <Input
                        key="wf-description"
                        label={t.edit.descriptionLabel}
                        submitLabel={t.apply}
                        {...(d.description === '' ? {} : { value: d.description })}
                        onInput={actions.head('description')}
                        onSubmit={actions.head('description')}
                      />,
                      help(t.edit.headHelp),
                    ]
                  : []}
              </Box>,
            ]
          : [line(d.title, undefined, false)]}
        <Box flexDirection="column" marginTop={1} minWidth={0}>
          {label(t.edit.steps)}
          {help(t.edit.stepsHelp)}
        </Box>
        {onSteps.length === 0 ? [help(t.edit.noSteps), insertAt(INSERT_END, undefined)] : []}
        {onSteps.map((s, i) => {
          const open = view.focus === s.id
          return (
            <Box key={`wf-row:${s.id}`} flexDirection="column" minWidth={0} marginTop={1}>
              {open ? (
                editCard(s, i + 1, { first: i === 0, last: i === onSteps.length - 1 })
              ) : (
                <Box flexDirection="row" minWidth={0}>
                  {stepNumber(s, i + 1)}
                  <Box flexDirection="row" justifyContent="space-between" flexGrow={1} flexShrink={1} columnGap={1} minWidth={0}>
                    <Button key={`wf-step:${s.id}`} plain onPress={actions.focus(s.id)}>
                      <Text weight="semibold">{title(s)}</Text>
                    </Button>
                    {pill(whoShort(s), WHO_PILL[s.kind])}
                  </Box>
                </Box>
              )}
              {slot === s.id ? insertAt(s.id, s) : []}
            </Box>
          )
        })}
        {onSteps.length > 0 && slot === INSERT_END ? insertAt(INSERT_END, onSteps[onSteps.length - 1]) : []}
        {offSteps.map(s => (
          <Box key={`wf-off:${s.id}`} flexDirection="row" justifyContent="space-between" columnGap={1} marginTop={1} minWidth={0}>
            <Box flexDirection="row" minWidth={0}>
              {stepNumber(s, '—', true)}
              <Text strikethrough dimColor wrap="wrap">{title(s)}</Text>
            </Box>
            <Button key={`wf-toggle:${s.id}`} plain onPress={actions.toggle(s.id)}>
              <Text color={LINK}>{t.edit.switchOn}</Text>
            </Button>
          </Box>
        ))}
      </Box>
    )
  }

  /* ---------- um workflow aberto ---------- */

  const notice = view.notice === null ? [] : [box([line(view.notice)])]
  const chosen = view.selected === null ? undefined : view.entries.find(e => e.flow.id === view.selected)
  if (chosen !== undefined) {
    const steps = chosen.flow.steps as unknown as StepLike[]
    const legend = (color: string, label: string) => (
      <Text key={label} dimColor wrap="wrap">
        <Text color={color}>●</Text>
        {` ${label}`}
      </Text>
    )
    return (
      <Box flexDirection="column" minWidth={0}>
        {back}
        {notice}
        {heading(
          flowTitle(chosen.flow, ui),
          <Button key="wf-edit" variant="primary" onPress={actions.edit(chosen.flow.id)}>
            {t.view.edit}
          </Button>,
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1} minWidth={0}>
          {pill(chosen.origin, chosen.flow.base !== undefined ? TAG_BLUE : TAG_GRAY)}
        </Box>
        {flowDescription(chosen.flow, content) === '' ? [] : [<Text key="wf-desc" wrap="wrap" color={MUTED}>{flowDescription(chosen.flow, content)}</Text>]}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1} minWidth={0}>
          {legend(LINK, t.view.legendSession)}
          {legend(OWNER, t.view.legendOwner)}
          {legend(MOD, t.view.legendMod)}
        </Box>
        {steps.map((s, i) => viewStep(s, i + 1, steps))}
      </Box>
    )
  }

  /* ---------- a lista ---------- */

  const card = ({ flow, origin, project, replaces }: WorkflowEntry) => {
    const steps = flow.steps as unknown as StepLike[]
    const tags = [
      flow.base !== undefined ? { label: t.origin.derived(flow.base), tone: TAG_BLUE } : undefined,
      steps.some(s => s.merge?.auto === true) ? { label: t.list.mergeAuto, tone: TAG_GRAY } : undefined,
      steps.some(s => s.deploy?.auto === true) ? { label: t.list.deployAuto, tone: TAG_GRAY } : undefined,
      project && replaces ? { label: t.list.replaces(flow.id), tone: TAG_AMBER } : undefined,
      view.config?.states.find(x => x.id === flow.id)?.missing.includes('merge') ? { label: P.noMergeStep, tone: TAG_AMBER } : undefined,
    ].filter((x): x is { label: string; tone: { bg: string; fg: string } } => x !== undefined)
    return (
      <Box key={`wf-entry:${flow.id}`} flexDirection="column" borderStyle="round" borderColor={RULE} paddingX={1} minWidth={0}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
          <Button key={`wf-open:${flow.id}`} plain onPress={actions.open(flow.id)}>
            <Text weight="semibold">{`${flowTitle(flow, ui)} ›`}</Text>
          </Button>
          <Text color={MUTED} size="footnote">{t.list.steps(steps.length)}</Text>
        </Box>
        {flowDescription(flow, content) === '' ? [] : [<Text key="wf-desc" wrap="wrap" color={MUTED}>{flowDescription(flow, content)}</Text>]}
        {tags.length === 0 ? [] : [<Box key="wf-tags" flexDirection="row" flexWrap="wrap" columnGap={1} minWidth={0}>{tags.map(t => pill(t.label, t.tone))}</Box>]}
      </Box>
    )
  }
  /** "Este projeto": the settings in three lines, with "Configurar". */
  const projectCard = (c: ConfigView) => {
    const merge = effectiveMerge(c.project.merge ?? {})
    const deploy = effectiveDeploy(c.project.deploy ?? {})
    const name = (l: Lang) => P.langName[l] ?? l
    const line$ = (key: string, value: string, who?: string) => (
      <Box key={key} flexDirection={view.narrow ? 'column' : 'row'} columnGap={1} minWidth={0}>
        <Box width={view.narrow ? undefined : 10} flexShrink={0}>
          <Text color={MUTED} size="footnote">{P.rows[key as 'language' | 'merge' | 'deploy']}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={1} minWidth={0}>
          <Text wrap="wrap" size="footnote">{value}</Text>
          {who === undefined ? [] : pill(who, TAG_GRAY)}
        </Box>
      </Box>
    )
    return (
      <Box key="cfg-card" flexDirection="column" rowGap={1} borderStyle="round" borderColor={RULE} paddingX={1} marginTop={1} minWidth={0}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} minWidth={0}>
          <Text weight="semibold">{P.title}</Text>
          <Button key="cfg-open" onPress={actions.configure}>
            {P.configure}
          </Button>
        </Box>
        {line$('language', P.languageSummary(name(languages.ui), name(languages.content)))}
        {line$('merge', P.mergeSummary(merge.branch, merge.method), merge.auto ? P.mergeWho.auto : P.mergeWho.owner)}
        {line$('deploy', P.deploySummary(deploy.ci, deploy.commands), deploy.auto ? P.deployWho.auto : P.deployWho.owner)}
        <Text size="caption" color={MUTED} wrap="wrap">{P.applies}</Text>
        {c.problems.length === 0 ? [] : box(c.problems.map(p => line(p, ERROR)), ERROR)}
      </Box>
    )
  }
  const mine = view.entries.filter(e => e.project)
  const standard = view.entries.filter(e => !e.project)
  const section = (title: string, children: RenderElement[]) => (
    <Box flexDirection="column" rowGap={1} marginTop={1} minWidth={0}>
      {label(title)}
      {children}
    </Box>
  )

  return (
    <Box flexDirection="column" minWidth={0}>
      {notice}
      <Text size="title" weight="semibold">{t.list.title}</Text>
      {divider}
      {help(t.list.intro)}
      {view.config === undefined ? [] : [projectCard(view.config)]}
      {mine.length === 0 ? [] : [section(t.list.mine, mine.map(card))]}
      {section(t.list.standard, [
        ...standard.map(card),
        ...view.retired.map(r => (
          <Box key={`wf-retired:${r.flow.id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={0}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
              <Text bold dimColor>{flowTitle(r.flow, ui)}</Text>
              <Text dimColor>{t.list.retired}</Text>
            </Box>
            {help(t.list.retiredHelp(flowTitle(r.by, ui)))}
          </Box>
        )),
      ])}
      {view.problems.length === 0
        ? []
        : [
            <Box key="wf-problems" flexDirection="column" marginTop={1} minWidth={0}>
              {box(
                [
                  <Text bold color={ERROR} wrap="wrap">
                    {t.list.problems(view.problems.length)}
                  </Text>,
                  ...view.problems.map(p => {
                    const { file, what } = problemParts(t, p)
                    return line(`${file} — ${what}`, ERROR)
                  }),
                  help(t.list.problemsHelp),
                ],
                ERROR,
              )}
            </Box>,
          ]}
      <Box flexDirection="column" marginTop={1} rowGap={1} minWidth={0}>
        <Text weight="semibold">{t.list.newTitle}</Text>
        {Input !== undefined && Select !== undefined
          ? [
              <Input
                key="wf-new-name"
                label={t.list.nameLabel}
                placeholder={t.list.namePlaceholder}
                submitLabel={t.ok}
                {...(view.forms.newId === '' ? {} : { value: view.forms.newId })}
                onInput={actions.form('newId')}
                onSubmit={actions.form('newId')}
              />,
              help(t.list.nameHelp(view.forms.newId.trim() === '' ? undefined : slug(view.forms.newId))),
              <Select
                key="wf-new-base"
                label={t.list.baseLabel}
                options={[
                  ...view.entries.map(e => ({ value: e.flow.id, label: t.list.baseOption(flowTitle(e.flow, ui), e.flow.steps.length) })),
                  { value: NONE, label: t.list.scratchOption },
                ]}
                value={view.forms.newBase === '' ? NONE : view.forms.newBase}
                onSelect={v => actions.form('newBase')(v === NONE ? '' : v)}
              />,
              help(t.list.baseHelp),
              buttons(
                <Button key="wf-new" variant="primary" onPress={actions.create}>
                  {t.list.create}
                </Button>,
              ),
            ]
          : [noFields]}
      </Box>
    </Box>
  )
}

/** `/orquestrador-workflows`: closes the pane when it is up, else opens it; the 🧭 pane is left as it is. */
export async function toggleWorkflowsPane($: EngineInterface): Promise<'opened' | 'waiting' | 'closed'> {
  if ((await $.ui.panes()).some(pane => pane.id === WORKFLOWS_PANE)) {
    await $.ui.close({ id: WORKFLOWS_PANE })
    return 'closed'
  }
  return (await $.ui.open({ id: WORKFLOWS_PANE, title: WORKFLOWS_TITLE })).isPlaced ? 'opened' : 'waiting'
}

const defaultsById = (): Record<string, FlowDef> => Object.fromEntries(defaultFlows().map(f => [f.id, f]))

const originOf = (t: WorkflowsText, flow: FlowDef, project: boolean): string =>
  flow.base !== undefined ? t.origin.derived(flow.base) : project ? t.origin.project : t.origin.standard

/** The ⚙️ pane drawn: its view read from the disk and the state, its presses bound to `$`. */
export async function drawWorkflows(
  $: EngineInterface,
  els: WorkflowsElements,
  columns: number,
): Promise<RenderElement> {
  const loaded = await loadFlows($)
  const languages = loaded.config.languages
  const project = loaded.config.project
  const t = workflowsText(languages.ui)
  const [selected, focus, insert, draft, forms, notice, cfgDraft, cfgAsk] = await Promise.all([
    $.state.get(SELECTED),
    $.state.get(FOCUS),
    $.state.get(INSERT),
    $.state.get(DRAFT),
    $.state.get(FORMS),
    $.state.get(NOTICE),
    $.state.get(CFG),
    $.state.get(ASK),
  ])
  const defaults = defaultsById()
  const entries = Object.values(loaded.flows).map(flow => ({
    flow,
    origin: originOf(t, flow, loaded.projectIds.has(flow.id)),
    project: loaded.projectIds.has(flow.id),
    replaces: defaults[flow.id] !== undefined,
  }))
  const retired = Object.values(defaults).flatMap(flow => {
    const by = loaded.projectIds.has(flow.id) ? loaded.flows[flow.id] : undefined
    return by === undefined ? [] : [{ flow, by }]
  })
  const shown =
    draft.value != null
      ? draft.value.steps.map(s => s.step as { agent?: unknown })
      : (entries.find(e => e.flow.id === selected.value)?.flow.steps ?? [])
  const names = [...new Set(shown.flatMap(s => (typeof s.agent === 'string' ? [s.agent] : [])))]
  const agents = Object.fromEntries(
    await Promise.all(names.map(async name => [name, (await findAgent($, name))?.source ?? null] as const)),
  )
  const view: WorkflowsView = {
    entries,
    retired,
    problems: loaded.problems,
    selected: selected.value ?? null,
    focus: focus.value ?? null,
    insert: insert.value ?? null,
    draft: draft.value ?? null,
    forms: { ...EMPTY_FORMS, ...(forms.value ?? {}) },
    notice: notice.value ?? null,
    agents,
    agentList: await listAgents($),
    narrow: columns < NARROW_COLUMNS,
    languages,
    config: {
      project,
      problems: loaded.config.problems,
      draft: cfgDraft.value ?? null,
      ask: cfgAsk.value ?? null,
      states: entries.map(e => workflowState(e.flow, project)),
    },
  }

  const fail = (what: keyof WorkflowsText['failed']) => () => $.ui.toast(t.couldNot(t.failed[what]))
  const editDraft = (fn: (d: WorkflowDraft) => WorkflowDraft | { error: string }) => {
    void update($, DRAFT, d => {
      if (d == null) return d ?? null
      const next = fn(d)
      return 'steps' in next ? next : { ...d, error: next.error }
    }).catch(fail('draft'))
  }
  const forms$ = view.forms
  /** A draft to edit workflow `id` as the editor opens it; a text when it cannot (its base is gone). */
  const openDraft = (id: string): WorkflowDraft | string | undefined => {
    const flow = loaded.flows[id]
    if (flow === undefined) return undefined
    const mine = loaded.projectIds.has(id)
    const base = !mine ? flow : flow.base === undefined ? undefined : flow.base === id ? defaults[id] : loaded.flows[flow.base]
    if (mine && flow.base !== undefined && base === undefined) return t.toast.noBase(flow.base)
    const source = mine ? loaded.files.find(f => idOf(f.raw) === id)?.source : undefined
    return { ...draftOf(flow, base, defaults[id] !== undefined), ...(source === undefined ? {} : { source }) }
  }
  const W = t.project.workflows
  const say = (text$: string) => $.state.set(NOTICE, text$)
  /** "Acrescentar merge e deploy" / "Passar a usar o do projeto", written through the editor's own save. */
  const runAsk = async (ask: ConfigAsk): Promise<void> => {
    const flow = loaded.flows[ask.id]
    const name = flow === undefined ? ask.id : flowTitle(flow, languages.ui)
    const stop = async (why: string) => {
      await Promise.all([say(W.failed(name, why)), $.state.set(ASK, null)])
      $.ui.toast(W.failed(name, why))
    }
    const opened = openDraft(ask.id)
    if (opened === undefined || typeof opened === 'string') {
      await stop(opened ?? W.nothing)
      return
    }
    let d: WorkflowDraft = opened
    if (ask.what === 'use') {
      for (const s of d.steps) if (s.on && (s.step.merge !== undefined || s.step.deploy !== undefined)) d = useProjectValues(d, String(s.step.id), project)
    } else {
      const has = (field: 'merge' | 'deploy') => d.steps.find(s => s.on && s.step[field] !== undefined)?.step.id
      const ids = (x: WorkflowDraft) => new Set(x.steps.map(s => String(s.step.id)))
      const on = (id: string) => d.steps.some(s => s.on && s.step.id === id)
      const before = d.steps.filter(s => s.on)
      const idx = before.findIndex(s => s.step.id === 'producao')
      const anchor: string | null =
        ['revisao-pr', 'pr'].find(on) ?? (idx > 0 ? String(before[idx - 1]!.step.id) : null)
      let mergeId = has('merge') as string | undefined
      for (const field of ['merge', 'deploy'] as const) {
        if (has(field) !== undefined) continue
        const known = ids(d)
        const added = addLibraryStep(d, field, field === 'deploy' ? (mergeId ?? anchor) : anchor, project)
        if (!('steps' in added)) {
          await stop(added.error)
          return
        }
        d = added
        const fresh = added.steps.find(s => !known.has(String(s.step.id)))
        if (field === 'merge' && fresh !== undefined) mergeId = String(fresh.step.id)
      }
    }
    const written = await writeDraft($, t, d)
    if ('error' in written) {
      await stop(written.error)
      return
    }
    await Promise.all([say(W.done(name, written.relative)), $.state.set(ASK, null)])
  }

  return renderWorkflows(els, view, {
    open: id => () => {
      void Promise.all([$.state.set(SELECTED, id), $.state.set(FOCUS, null), $.state.set(INSERT, null), $.state.set(NOTICE, null)]).catch(fail('open'))
    },
    back: () => {
      void Promise.all([$.state.set(SELECTED, null), $.state.set(FOCUS, null)]).catch(fail('back'))
    },
    focus: step => () => {
      void update($, FOCUS, f => (f === step ? null : step)).catch(fail('step'))
    },
    edit: id => () => {
      const d = openDraft(id)
      if (d === undefined) return
      if (typeof d === 'string') {
        $.ui.toast(d)
        return
      }
      void Promise.all([$.state.set(DRAFT, d), $.state.set(FOCUS, null), $.state.set(INSERT, null), $.state.set(NOTICE, null)]).catch(fail('edit'))
    },
    form: field => value => {
      void update($, FORMS, f => ({ ...EMPTY_FORMS, ...(f ?? {}), [field]: value })).catch(fail('field'))
    },
    create: () => {
      const name = forms$.newId.trim()
      const id = slug(name)
      if (name === '' || !WORKFLOW_ID.test(id)) {
        $.ui.toast(t.toast.nameNew)
        return
      }
      if (loaded.flows[id] !== undefined) {
        $.ui.toast(t.toast.exists(id))
        return
      }
      const base = forms$.newBase === '' ? undefined : loaded.flows[forms$.newBase]
      void takenBy($, loaded.files, loaded.dir, id)
        .then(taken => {
          if (taken !== undefined) {
            $.ui.toast(t.toast.taken(taken, id))
            return
          }
          return Promise.all([
            $.state.set(DRAFT, newDraft(id, base, name)),
            $.state.set(FORMS, { ...forms$, newId: '', newBase: '' }),
            $.state.set(FOCUS, null),
            $.state.set(INSERT, null),
            $.state.set(NOTICE, null),
          ])
        })
        .catch(fail('create'))
    },
    head: field => value => editDraft(d => ({ ...d, [field]: value })),
    toggle: step => () => editDraft(d => toggleStep(d, step)),
    move: (step, by) => () => editDraft(d => moveStep(d, step, by)),
    set: (step, change) => () => editDraft(d => setStepField(d, step, change, project)),
    insert: after => () => {
      void update($, INSERT, i => (i === after ? null : after)).catch(fail('insert'))
    },
    add: () => {
      const d = view.draft
      const at = view.insert
      if (d === null || at === null) return
      const after = at === INSERT_END ? null : at
      const added = forms$.libraryUse === '' ? addNewStep(d, forms$, after, t) : addLibraryStep(d, forms$.libraryUse, after, project)
      if (!('steps' in added)) {
        void $.state.set(DRAFT, { ...d, error: added.error }).catch(fail('add'))
        return
      }
      const known = new Set(d.steps.map(s => String(s.step.id)))
      const fresh = added.steps.find(s => !known.has(String(s.step.id)))
      void Promise.all([
        $.state.set(DRAFT, added),
        $.state.set(FORMS, { ...forms$, stepTitle: '', stepAgent: '', stepCommand: '', libraryUse: '' }),
        $.state.set(INSERT, null),
        $.state.set(FOCUS, fresh === undefined ? null : String(fresh.step.id)),
      ]).catch(fail('add'))
    },
    save: () => {
      void saveDraft($, t).catch(fail('save'))
    },
    configure: () => {
      void Promise.all([$.state.set(CFG, draftOfConfig(languages, project)), $.state.set(NOTICE, null), $.state.set(ASK, null)]).catch(fail('open'))
    },
    cfgSet: change => () => {
      void update($, CFG, c => (c == null ? null : applyConfigChange(c, change))).catch(fail('draft'))
    },
    cfgSave: () => {
      void saveConfig($, t).catch(fail('save'))
    },
    cfgDiscard: () => {
      void Promise.all([$.state.set(CFG, null), $.state.set(ASK, null), $.state.set(NOTICE, null)]).catch(fail('discard'))
    },
    ask: (what, id) => () => {
      void $.state.set(ASK, { what, id }).catch(fail('open'))
    },
    confirm: () => {
      const ask = view.config?.ask
      if (ask == null) return
      void runAsk(ask).catch(fail('save'))
    },
    cancel: () => {
      void $.state.set(ASK, null).catch(fail('discard'))
    },
    discard: () => {
      void Promise.all([$.state.set(DRAFT, null), $.state.set(FOCUS, null), $.state.set(INSERT, null)]).catch(fail('discard'))
    },
  })
}

/**
 * The draft resolved as the mod would load it and, when it does, written. With an error nothing is
 * written. Only "Salvar" and the project settings' two workflow actions write a workflow file, here.
 */
async function writeDraft($: EngineInterface, t: WorkflowsText, draft: WorkflowDraft): Promise<{ error: string } | { relative: string; target: string; notice?: string }> {
  const { files, dir, config } = await loadFlows($)
  const relative = (path: string) => `.orquestrador/flows/${path.slice(dir.length + 1)}`
  // only the file the draft was opened from may be written over; any other of the same id or name stays
  const target = draft.source ?? `${dir}/${draft.id}.json`
  if (draft.source === undefined) {
    const taken = await takenBy($, files, dir, draft.id)
    if (taken !== undefined) return { error: t.saved.taken(taken, draft.id) }
  }
  const result = draftFile(draft, raw => resolveCandidate(DEFAULT_FLOWS, files, target, raw, t, config.project), t, config.project)
  if ('error' in result) return { error: result.error }
  const broken = brokenDependents(DEFAULT_FLOWS, files, target, result.raw, config.project)
  if (broken.length > 0) {
    const named = broken.map(p => p.split(`${dir}/`).join('.orquestrador/flows/'))
    return { error: t.saved.broken(draft.id, named.join(' ')) }
  }
  await $.fs.write(target, `${JSON.stringify(result.raw, null, 2)}\n`)
  return { relative: relative(target), target, ...(result.notice === undefined ? {} : { notice: result.notice }) }
}

/** "Salvar": the draft written by `writeDraft`; with an error it stays on the draft. */
async function saveDraft($: EngineInterface, t: WorkflowsText): Promise<void> {
  const { value: draft } = await $.state.get(DRAFT)
  if (draft == null) return
  const written = await writeDraft($, t, draft)
  if ('error' in written) {
    await $.state.set(DRAFT, { ...draft, error: written.error })
    return
  }
  await $.state.set(DRAFT, null)
  await $.state.set(SELECTED, draft.id)
  await $.state.set(FOCUS, null)
  await $.state.set(INSERT, null)
  await $.state.set(
    NOTICE,
    (draft.replacesDefault ? t.saved.replacing(written.relative, draft.id) : t.saved.at(written.relative)) +
      t.saved.runningKeep +
      (written.notice === undefined ? '' : ` ${written.notice}`),
  )
}

/**
 * "Salvar" of the project settings: the file read again, only the keys the draft changed set, every
 * other key kept; a file that would not parse cleanly is not written.
 */
async function saveConfig($: EngineInterface, t: WorkflowsText): Promise<void> {
  const { value: draft } = await $.state.get(CFG)
  if (draft == null) return
  const refuse = (error: string) => $.state.set(CFG, { ...draft, error })
  if (!configChanged(draft)) {
    await Promise.all([$.state.set(CFG, null), $.state.set(NOTICE, t.project.edit.nothingToSave)])
    return
  }
  const config = await loadConfig($)
  const next = configText(config.text, draft, t)
  if ('error' in next) {
    await refuse(next.error)
    return
  }
  await $.fs.write(`${await $.session.root()}/${CONFIG_PATH}`, next.text)
  await Promise.all([$.state.set(CFG, null), $.state.set(ASK, null), $.state.set(NOTICE, t.project.edit.saved)])
}

const idOf = (raw: unknown): unknown => (raw as { id?: unknown } | null)?.id

/** The project file, as the owner reads its path, that already holds `id`: by its id, or by its name `<id>.json`, valid or broken. */
async function takenBy($: EngineInterface, files: readonly FlowSource[], dir: string, id: string): Promise<string | undefined> {
  const named = `${dir}/${id}.json`
  const path = files.find(f => idOf(f.raw) === id)?.source ?? ((await $.fs.exists(named)) ? named : undefined)
  return path === undefined ? undefined : `.orquestrador/flows/${path.slice(dir.length + 1)}`
}
