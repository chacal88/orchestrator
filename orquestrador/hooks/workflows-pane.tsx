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

import type { FlowDef, FlowDeploy, FlowMerge, FlowStepKind, WorkflowDraft, WorkflowForms } from '../types'
import { findAgent, listAgents, loadFlows } from './flow-files'
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
} from './workflow-edit'
import type { StepField } from './workflow-edit'
import type { FlowSource } from './flow'

export const WORKFLOWS_PANE = 'orquestrador-workflows'
export const WORKFLOWS_TITLE = '⚙️ Workflows'

const SELECTED = { plugin: 'orquestrador', key: 'wfSelected' } as const
const FOCUS = { plugin: 'orquestrador', key: 'wfFocus' } as const
const INSERT = { plugin: 'orquestrador', key: 'wfInsert' } as const
const DRAFT = { plugin: 'orquestrador', key: 'wfDraft' } as const
const FORMS = { plugin: 'orquestrador', key: 'wfForms' } as const
const NOTICE = { plugin: 'orquestrador', key: 'wfNotice' } as const

/** Below this many columns the pane stacks what sits side by side. */
const NARROW_COLUMNS = 44
const LINK = '#2F6FD6'
const ERROR = '#D14343'
const WARN = '#B7791F'
const OWNER = '#C2410C'
const MOD = '#6B6A66'
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_NAMES: Record<string, string> = { low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'muito alto', max: 'máximo' }
const METHODS: Record<string, string> = {
  squash: 'Squash: vira um commit só',
  merge: 'Merge: guarda todos os commits',
  rebase: 'Rebase: commits em linha, sem commit de merge',
}
/** A Select's "nothing chosen": its options' values must be words. */
const NONE = '-'
/** "+ passo aqui" open at the end of a workflow that has no step yet. */
export const INSERT_END = ':fim'
/** The "+ passo aqui" choice that is no library step. */
const NEW_STEP = 'novo'

const WHO_COLOR: Record<FlowStepKind, string> = { session: LINK, owner: OWNER, automatic: MOD, loop: MOD }
const WHO_TAG: Record<FlowStepKind, string> = { session: 'sessão', owner: 'você', automatic: 'mod', loop: 'sessões' }

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
}

/** A step as the pane reads it: a flow's, or a draft's raw one. */
type StepLike = {
  id: string
  title: string
  description?: string
  kind: FlowStepKind
  agent?: string
  model?: string
  effort?: string
  command?: string
  requiresEvidence?: boolean
  details?: { inputs?: string; produces?: string; blocks?: string }
  merge?: FlowMerge
  deploy?: FlowDeploy
  outcomes?: Record<string, { label?: string; next: string }>
}

const yes = (b: boolean | undefined) => (b === true ? 'sim' : 'não')

/** `claude-opus-5-5` as the owner reads it: Opus 5.5. */
export const modelName = (model: string): string => {
  const parts = model.replace(/^claude-/, '').split('-')
  const [name = model, ...version] = parts
  return [name.charAt(0).toUpperCase() + name.slice(1), version.join('.')].filter(x => x !== '').join(' ')
}

const effortName = (effort: string): string => EFFORT_NAMES[effort] ?? effort

/** Where a problem line from the loader names its file, shortened, and what is wrong with it in plain words. */
const problemParts = (problem: string): { file: string; what: string } => {
  const at = problem.indexOf(': ')
  const path = at === -1 ? problem : problem.slice(0, at)
  const what = at === -1 ? '' : problem.slice(at + 2)
  const file = path.includes('.orquestrador/flows/') ? path.slice(path.indexOf('.orquestrador/flows/') + '.orquestrador/flows/'.length) : path
  return { file, what: what === 'not valid JSON.' ? 'o arquivo não é um JSON válido.' : what }
}

export const renderWorkflows = (els: WorkflowsElements, view: WorkflowsView, actions: WorkflowsActions): RenderElement => {
  const { Box, Text, Button, Input, Select } = els
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
  const noFields = line('Os campos de texto e de escolha ficam no desktop e no terminal.', undefined, true)
  const tag = (label: string) => <Text dimColor>{`[${label}]`}</Text>

  const agentModel = (name: string | undefined): string | undefined =>
    name === undefined ? undefined : view.agentList.find(a => a.name === name)?.model
  const originOf = (name: string): string => {
    const found = view.agents[name]
    return found === 'project' ? 'do projeto' : found === 'plugin' ? 'do plugin' : 'sem arquivo'
  }

  /** Who answers the step, in the words of the legend. */
  const who = (s: StepLike): string =>
    s.kind === 'session'
      ? 'Uma sessão, com o agente abaixo'
      : s.kind === 'owner'
        ? 'Você aprova ou confirma'
        : s.kind === 'loop'
          ? 'Uma sessão por fase'
          : s.merge !== undefined || s.deploy !== undefined
            ? 'A coordenação, sozinha'
            : 'O mod confere o comando'
  const whoShort = (s: StepLike): string => (s.merge !== undefined || s.deploy !== undefined ? (s.kind === 'automatic' ? 'automático' : WHO_TAG[s.kind]) : WHO_TAG[s.kind])

  const modelLine = (s: StepLike): string => {
    const fromAgent = s.model === undefined ? agentModel(s.agent) : undefined
    const model = s.model ?? fromAgent
    const parts = [
      model === undefined ? 'o da sessão' : `${modelName(model)}${fromAgent === undefined ? '' : ' (do agente)'}`,
      s.effort === undefined ? undefined : `esforço ${effortName(s.effort)}`,
    ]
    return parts.filter((x): x is string => x !== undefined).join(' · ')
  }

  /** The step's one-line summary, in plain words. */
  const summary = (s: StepLike): string => {
    if (s.merge !== undefined) {
      return s.merge.auto
        ? `Automático · ${s.merge.method} em ${s.merge.branch} · só com PR aprovado e CI verde, nunca com --admin`
        : `Você faz o merge · ${s.merge.method} em ${s.merge.branch}`
    }
    if (s.deploy !== undefined) {
      const part = [s.deploy.ci ? 'espera o CI' : undefined, s.deploy.commands.length > 0 ? `roda ${s.deploy.commands.join(', ')}` : undefined]
        .filter((x): x is string => x !== undefined)
        .join(' e ')
      return `${s.deploy.auto ? 'Automático' : 'Você confirma'} · ${part === '' ? 'sem CI nem rotinas' : part}`
    }
    if (s.kind === 'session' || s.kind === 'loop') {
      const lead = s.kind === 'loop' ? 'Uma sessão por fase' : undefined
      const agent = s.agent === undefined ? (lead === undefined ? 'Sessão sem agente' : undefined) : `agente ${s.agent}`
      return [lead, agent, s.agent === undefined && lead !== undefined ? undefined : modelLine(s)].filter((x): x is string => x !== undefined && x !== '').join(' · ')
    }
    if (s.kind === 'automatic' && s.command !== undefined) return `O mod vê ${s.command} passar.`
    return s.description ?? who(s)
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
      .map(i => all[i]!.title)
    return back.length === 0 ? 'Não volta: o passo só avança.' : `Volta para ${[...new Set(back)].join(' ou ')}.`
  }

  const detailRows = (s: StepLike, all: StepLike[]): RenderElement[] => {
    const out: RenderElement[] = [row('Quem faz', who(s))]
    out.push(row('Agente', s.agent === undefined ? 'nenhum' : `${s.agent} (${originOf(s.agent)})`))
    out.push(row('Modelo', modelLine(s)))
    if (s.command !== undefined) out.push(row('Comando', s.command))
    if (s.merge !== undefined) out.push(row('Merge', `branch ${s.merge.branch} · ${s.merge.method} · automático: ${yes(s.merge.auto)}`))
    if (s.deploy !== undefined) {
      out.push(row('Deploy', `CI ${yes(s.deploy.ci)} · rotinas: ${s.deploy.commands.length === 0 ? 'nenhuma' : s.deploy.commands.join(' ; ')} · automático: ${yes(s.deploy.auto)}`))
    }
    if (s.details?.inputs !== undefined) out.push(row('Recebe', s.details.inputs))
    if (s.details?.produces !== undefined) out.push(row('Entrega', s.details.produces))
    out.push(row('Se rejeitar', rejects(s, all)))
    if (s.details?.blocks !== undefined) out.push(row('Bloqueia', s.details.blocks))
    out.push(row('Evidência', s.requiresEvidence === true ? 'exigida' : 'não exigida'))
    return out
  }

  const stepNumber = (s: StepLike, n: number | string, off = false) => (
    <Box width={4} flexShrink={0}>
      <Text bold color={off ? undefined : WHO_COLOR[s.kind]} dimColor={off}>{`${n}.`}</Text>
    </Box>
  )

  /** A step of the workflow shown, not edited: number, title, one line, and its rows when opened. */
  const viewStep = (s: StepLike, n: number, all: StepLike[]): RenderElement => {
    const open = view.focus === s.id
    return (
      <Box key={`wf-row:${s.id}`} flexDirection="row" minWidth={0} marginTop={1}>
        {stepNumber(s, n)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Button key={`wf-step:${s.id}`} plain onPress={actions.focus(s.id)}>
            <Text bold>{`${open ? '▾' : '▸'} ${s.title}`}</Text>
          </Button>
          {line(summary(s), undefined, true)}
          {open ? <Box flexDirection="column" marginTop={1} rowGap={1} minWidth={0}>{detailRows(s, all)}</Box> : []}
        </Box>
      </Box>
    )
  }

  const back = (
    <Button key="wf-back" plain onPress={actions.back}>
      <Text color={LINK}>← Workflows</Text>
    </Button>
  )

  const heading = (title: string, extra?: RenderElement) => (
    <Box flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
      <Text bold wrap="wrap">{title}</Text>
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
        submitLabel="aplicar"
        {...(value === undefined || value === '' ? {} : { value })}
        onInput={apply}
        onSubmit={submit ?? apply}
      />
    )

  const agentSelect = (key: string, current: string | undefined, apply: (v: string) => void) => {
    const known = view.agentList.some(a => a.name === current)
    const options = [
      ...view.agentList.map(a => ({ value: a.name, label: `${a.name} (${a.source === 'project' ? 'do projeto' : 'do plugin'})` })),
      ...(current === undefined || known ? [] : [{ value: current, label: `${current} (sem arquivo)` }]),
      { value: NONE, label: 'Nenhum: a sessão segue só o pedido' },
    ]
    return Select === undefined ? (
      noFields
    ) : (
      <Select key={key} label="Agente" options={options} value={current ?? NONE} onSelect={v => apply(v === NONE ? '' : v)} />
    )
  }
  const agentAbout = (name: string | undefined) => {
    if (name === undefined) return help('Sem agente: a sessão segue só o pedido do passo.')
    const found = view.agentList.find(a => a.name === name)
    return help(found === undefined ? `Não há arquivo para ${name}: a sessão segue só o pedido.` : found.description)
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
          label="Modelo"
          options={[
            { value: NONE, label: fromAgent === undefined ? 'o da sessão' : `${modelName(fromAgent)} (do agente)` },
            ...models.map(m => ({ value: m, label: modelName(m) })),
          ]}
          value={s.model ?? NONE}
          onSelect={v => set('model')(v === NONE ? '' : v)}
        />,
        <Select
          key={`wf-effort:${s.id}`}
          label="Esforço"
          options={[
            { value: NONE, label: 'o da sessão' },
            ...[...new Set([...EFFORTS, ...(s.effort === undefined ? [] : [s.effort])])].map(e => ({ value: e, label: effortName(e) })),
          ]}
          value={s.effort ?? NONE}
          onSelect={v => set('effort')(v === NONE ? '' : v)}
        />,
        help('Vêm do agente escolhido. Mude só se este projeto pedir mais ou menos: o mais forte custa mais.'),
      )
      if (s.merge !== undefined) {
        body.push(
          text(`wf-merge-branch:${s.id}`, 'Branch que recebe o PR', s.merge.branch, v => actions.set(s.id, { field: 'merge', value: { branch: v.trim() } })()),
          help('Trunk-based: main. Com dev e master, use dois passos de merge: um em dev (antes do QA) e um em master (produção).'),
          <Select
            key={`wf-merge-method:${s.id}`}
            label="Como juntar"
            options={Object.entries(METHODS).map(([value, label]) => ({ value, label }))}
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
            {`Fazer o merge sozinho: ${yes(s.merge.auto)}`}
          </Button>,
        ),
        help('A coordenação faz o merge assim que o PR estiver aprovado no GitHub e com o CI verde. Nunca com --admin. Desligado, o merge fica com você.'),
      )
    }
    if (s.deploy !== undefined) {
      const deploy = s.deploy
      const commands = (list: string[]) => actions.set(s.id, { field: 'deploy', value: { commands: list } })()
      body.push(
        buttons(
          <Button key={`wf-deploy-ci:${s.id}`} onPress={actions.set(s.id, { field: 'deploy', value: { ci: !deploy.ci } })}>
            {`Esperar o CI do deploy: ${yes(deploy.ci)}`}
          </Button>,
        ),
        help('Espera o deploy que o CI faz depois do merge, antes de seguir.'),
        line('Rotinas fora do CI (opcional)'),
      )
      if (fields) {
        deploy.commands.forEach((command, i) => {
          body.push(
            text(
              `wf-routine:${s.id}:${i}`,
              `Rotina ${i + 1}`,
              command,
              v => {
                if (v.trim() !== '') commands(deploy.commands.map((c, j) => (j === i ? v.trim() : c)))
              },
              v => commands(v.trim() === '' ? deploy.commands.filter((_, j) => j !== i) : deploy.commands.map((c, j) => (j === i ? v.trim() : c))),
            ),
            buttons(
              <Button key={`wf-routine-del:${s.id}:${i}`} onPress={() => commands(deploy.commands.filter((_, j) => j !== i))}>
                {`Tirar a rotina ${i + 1}`}
              </Button>,
            ),
          )
        })
        if (view.forms.routineFor === s.id) {
          body.push(text(`wf-routine-new:${s.id}`, 'Nova rotina', undefined, () => {}, v => {
            if (v.trim() !== '') commands([...deploy.commands, v.trim()])
            actions.form('routineFor')('')
          }))
        }
      }
      body.push(
        buttons(
          <Button key={`wf-routine-add:${s.id}`} onPress={() => actions.form('routineFor')(s.id)}>
            + rotina
          </Button>,
        ),
        help('Um comando por campo, rodados nesta ordem depois do merge. Sem nenhum: só espera o CI.'),
        buttons(
          <Button key={`wf-deploy-auto:${s.id}`} onPress={actions.set(s.id, { field: 'deploy', value: { auto: !deploy.auto } })}>
            {`Fazer o deploy sozinho: ${yes(deploy.auto)}`}
          </Button>,
        ),
        help('Logo depois do merge, sem esperar você. Desligado, você aperta "Deploy concluído" quando terminar.'),
      )
    }
    return box([
      <Box key={`wf-card-head:${s.id}`} flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
        <Button key={`wf-step:${s.id}`} plain onPress={actions.focus(s.id)}>
          <Text bold color={WHO_COLOR[s.kind]}>{`▾ ${n}. ${s.title}`}</Text>
        </Button>
        {tag(whoShort(s))}
      </Box>,
      line(who(s), undefined, true),
      ...body,
      buttons(
        ...(opts.first ? [] : [<Button key={`wf-up:${s.id}`} onPress={actions.move(s.id, -1)}>Subir</Button>]),
        ...(opts.last ? [] : [<Button key={`wf-down:${s.id}`} onPress={actions.move(s.id, 1)}>Descer</Button>]),
        <Button key={`wf-toggle:${s.id}`} onPress={actions.toggle(s.id)}>
          Desligar este passo
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
        ? 'Você escolhe o título, quem responde e, se for um passo do mod, o comando.'
        : String(chosen.description ?? '')
    const labelOf = (id: string): string => {
      const step = libraryStep(id)
      return typeof step === 'string' ? id : String(step.title ?? id)
    }
    const body: RenderElement[] = []
    if (Select === undefined || Input === undefined) body.push(noFields)
    else {
      body.push(
        <Select
          key="wf-add-library"
          label="Passo pronto"
          options={[...libraryIds.map(id => ({ value: id, label: labelOf(id) })), { value: NEW_STEP, label: 'Um passo novo, do zero' }]}
          value={use}
          onSelect={v => actions.form('libraryUse')(v === NEW_STEP ? '' : v)}
        />,
        help(about),
      )
      if (use === NEW_STEP) {
        body.push(
          <Input
            key="wf-step-title"
            label="Título do passo"
            submitLabel="ok"
            {...(forms.stepTitle === '' ? {} : { value: forms.stepTitle })}
            onInput={actions.form('stepTitle')}
            onSubmit={actions.form('stepTitle')}
          />,
          help('Como o passo aparece na lista. O id dele sai do título.'),
          <Select
            key="wf-step-kind"
            label="Quem responde"
            options={[
              { value: 'session', label: 'Uma sessão faz' },
              { value: 'owner', label: 'Você aprova ou confirma' },
              { value: 'automatic', label: 'O mod confere um comando' },
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
              label="Comando"
              submitLabel="ok"
              {...(forms.stepCommand === '' ? {} : { value: forms.stepCommand })}
              onInput={actions.form('stepCommand')}
              onSubmit={actions.form('stepCommand')}
            />,
            help('O mod vê este comando rodar; o código de saída 0 passa o passo.'),
          )
        }
      }
    }
    return box(
      [
        <Text bold wrap="wrap">{after === undefined ? 'Acrescentar no começo' : `Acrescentar depois de ${after.title}`}</Text>,
        ...body,
        buttons(
          <Button key="wf-add" variant="primary" onPress={actions.add}>
            Acrescentar
          </Button>,
          <Button key="wf-add-cancel" onPress={actions.insert(String(view.insert))}>
            Cancelar
          </Button>,
        ),
      ],
      LINK,
    )
  }

  if (view.draft !== null) {
    const d = view.draft
    const onSteps = d.steps.filter(s => s.on).map(s => s.step as unknown as StepLike)
    const offSteps = d.steps.filter(s => !s.on).map(s => s.step as unknown as StepLike)
    const changes = changesOf(d)
    const insertAt = (id: string, step: StepLike | undefined) => (
      <Box key={`wf-insert-box:${id}`} flexDirection="column" marginTop={1} minWidth={0}>
        {view.insert === id ? insertForm(d, step) : (
          <Button key={`wf-insert:${id}`} plain onPress={actions.insert(id)}>
            <Text color={LINK}>+ passo aqui</Text>
          </Button>
        )}
      </Box>
    )
    return (
      <Box flexDirection="column" minWidth={0}>
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={0}>
          {heading(`Editando ${d.title}`)}
          {help('Rascunho: nada é gravado até salvar.')}
          {buttons(
            <Button key="wf-save" variant="primary" onPress={actions.save}>
              Salvar
            </Button>,
            <Button key="wf-discard" onPress={actions.discard}>
              Descartar
            </Button>,
          )}
          {line(changes.length === 0 ? 'Nenhuma mudança ainda.' : `${changes.length} ${changes.length === 1 ? 'mudança' : 'mudanças'}: ${changes.join('; ')}.`, undefined, changes.length === 0)}
        </Box>
        {d.error === undefined ? [] : box([line(`Não salvei: ${d.error}`, ERROR)], ERROR)}
        {help(d.base === undefined ? 'Do zero: grava os passos completos.' : `Derivado de ${d.base}: grava só o que muda em relação a ele.`)}
        {d.replacesDefault
          ? box([line(`⚠ ${d.id} é um workflow padrão. Salvar cria .orquestrador/flows/${d.id}.json, que passa a valer no lugar do padrão neste projeto.`, WARN)], WARN)
          : []}
        {help('Changes em andamento seguem com o workflow com que começaram.')}
        {fields
          ? [
              <Input key="wf-title" label="Nome" submitLabel="aplicar" value={d.title} onInput={actions.head('title')} onSubmit={actions.head('title')} />,
              <Input
                key="wf-description"
                label="Descrição"
                submitLabel="aplicar"
                {...(d.description === '' ? {} : { value: d.description })}
                onInput={actions.head('description')}
                onSubmit={actions.head('description')}
              />,
              help('O nome e a descrição aparecem na lista de workflows.'),
            ]
          : [line(d.title, undefined, false)]}
        <Box flexDirection="column" marginTop={1} minWidth={0}>
          <Text bold>Passos</Text>
          {help('Toque num passo para editar. "+ passo aqui" acrescenta naquele lugar.')}
        </Box>
        {onSteps.length === 0 ? [help('Nenhum passo ainda.'), insertAt(INSERT_END, undefined)] : []}
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
                      <Text>{`▸ ${s.title}`}</Text>
                    </Button>
                    {tag(whoShort(s))}
                  </Box>
                </Box>
              )}
              {insertAt(s.id, s)}
            </Box>
          )
        })}
        {offSteps.map(s => (
          <Box key={`wf-off:${s.id}`} flexDirection="row" justifyContent="space-between" columnGap={1} marginTop={1} minWidth={0}>
            <Box flexDirection="row" minWidth={0}>
              {stepNumber(s, '—', true)}
              <Text strikethrough dimColor wrap="wrap">{s.title}</Text>
            </Box>
            <Button key={`wf-toggle:${s.id}`} plain onPress={actions.toggle(s.id)}>
              <Text color={LINK}>religar</Text>
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
          chosen.flow.title,
          <Button key="wf-edit" variant="primary" onPress={actions.edit(chosen.flow.id)}>
            Editar
          </Button>,
        )}
        {line(`${chosen.flow.id} · ${chosen.origin}`, undefined, true)}
        {chosen.flow.description === '' ? [] : [line(chosen.flow.description)]}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1} minWidth={0}>
          {legend(LINK, 'sessão faz')}
          {legend(OWNER, 'você aprova')}
          {legend(MOD, 'o mod confere')}
        </Box>
        {steps.map((s, i) => viewStep(s, i + 1, steps))}
      </Box>
    )
  }

  /* ---------- a lista ---------- */

  const card = ({ flow, origin, project, replaces }: WorkflowEntry) => {
    const steps = flow.steps as unknown as StepLike[]
    const tags = [
      flow.base !== undefined ? `derivado de ${flow.base}` : undefined,
      steps.some(s => s.merge?.auto === true) ? 'merge automático' : undefined,
      steps.some(s => s.deploy?.auto === true) ? 'deploy automático' : undefined,
      project && replaces ? `substitui o padrão ${flow.id}` : undefined,
    ].filter((x): x is string => x !== undefined)
    return (
      <Box key={`wf-entry:${flow.id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={0}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
          <Button key={`wf-open:${flow.id}`} plain onPress={actions.open(flow.id)}>
            <Text bold color={LINK}>{`${flow.title} ›`}</Text>
          </Button>
          <Text dimColor>{`${steps.length} passos`}</Text>
        </Box>
        {line(`${flow.id} · ${origin}`, undefined, true)}
        {flow.description === '' ? [] : [line(flow.description)]}
        {tags.length === 0 ? [] : [<Box flexDirection="row" flexWrap="wrap" columnGap={1} minWidth={0}>{tags.map(t => tag(t))}</Box>]}
      </Box>
    )
  }
  const mine = view.entries.filter(e => e.project)
  const standard = view.entries.filter(e => !e.project)
  const section = (title: string, children: RenderElement[]) => (
    <Box flexDirection="column" rowGap={1} marginTop={1} minWidth={0}>
      <Text bold dimColor>{title}</Text>
      {children}
    </Box>
  )

  return (
    <Box flexDirection="column" minWidth={0}>
      {notice}
      <Text bold>Workflows</Text>
      {help('Os caminhos que uma change pode seguir neste projeto. Abra um para ver os passos; edite para mudar.')}
      {mine.length === 0 ? [] : [section('Deste projeto', mine.map(card))]}
      {section('Padrões do plugin', [
        ...standard.map(card),
        ...view.retired.map(r => (
          <Box key={`wf-retired:${r.flow.id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={0}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
              <Text bold dimColor>{r.flow.title}</Text>
              <Text dimColor>fora de uso</Text>
            </Box>
            {help(`Este projeto usa o seu ${r.by.title} no lugar deste.`)}
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
                    {view.problems.length === 1 ? '1 arquivo com erro, ignorado' : `${view.problems.length} arquivos com erro, ignorados`}
                  </Text>,
                  ...view.problems.map(p => {
                    const { file, what } = problemParts(p)
                    return line(`${file} — ${what}`, ERROR)
                  }),
                  help('Corrija ou apague o arquivo em .orquestrador/flows/; até lá o mod não o usa.'),
                ],
                ERROR,
              )}
            </Box>,
          ]}
      <Box flexDirection="column" marginTop={1} rowGap={1} minWidth={0}>
        <Text bold>Novo workflow</Text>
        {Input !== undefined && Select !== undefined
          ? [
              <Input
                key="wf-new-name"
                label="Nome"
                placeholder="ex.: Dev e master"
                submitLabel="ok"
                {...(view.forms.newId === '' ? {} : { value: view.forms.newId })}
                onInput={actions.form('newId')}
                onSubmit={actions.form('newId')}
              />,
              help(`Como ele aparece na lista. O id do arquivo sai do nome${view.forms.newId.trim() === '' ? '' : ` (${slug(view.forms.newId)})`}.`),
              <Select
                key="wf-new-base"
                label="Começar de"
                options={[
                  ...view.entries.map(e => ({ value: e.flow.id, label: `${e.flow.title} — copia os ${e.flow.steps.length} passos` })),
                  { value: NONE, label: 'Do zero — nenhum passo' },
                ]}
                value={view.forms.newBase === '' ? NONE : view.forms.newBase}
                onSelect={v => actions.form('newBase')(v === NONE ? '' : v)}
              />,
              help('Partindo de um existente, ele guarda só o que você mudar.'),
              buttons(
                <Button key="wf-new" variant="primary" onPress={actions.create}>
                  Criar e editar
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

const originOf = (flow: FlowDef, project: boolean): string =>
  flow.base !== undefined ? `derivado de ${flow.base}` : project ? 'do projeto' : 'padrão'

/** The ⚙️ pane drawn: its view read from the disk and the state, its presses bound to `$`. */
export async function drawWorkflows(
  $: EngineInterface,
  els: WorkflowsElements,
  columns: number,
): Promise<RenderElement> {
  const loaded = await loadFlows($)
  const [selected, focus, insert, draft, forms, notice] = await Promise.all([
    $.state.get(SELECTED),
    $.state.get(FOCUS),
    $.state.get(INSERT),
    $.state.get(DRAFT),
    $.state.get(FORMS),
    $.state.get(NOTICE),
  ])
  const defaults = defaultsById()
  const entries = Object.values(loaded.flows).map(flow => ({
    flow,
    origin: originOf(flow, loaded.projectIds.has(flow.id)),
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
  }

  const fail = (what: string) => () => $.ui.toast(`Não consegui ${what}.`)
  const editDraft = (fn: (d: WorkflowDraft) => WorkflowDraft | { error: string }) => {
    void update($, DRAFT, d => {
      if (d == null) return d ?? null
      const next = fn(d)
      return 'steps' in next ? next : { ...d, error: next.error }
    }).catch(fail('mudar o rascunho'))
  }
  const forms$ = view.forms

  return renderWorkflows(els, view, {
    open: id => () => {
      void Promise.all([$.state.set(SELECTED, id), $.state.set(FOCUS, null), $.state.set(INSERT, null), $.state.set(NOTICE, null)]).catch(fail('abrir o workflow'))
    },
    back: () => {
      void Promise.all([$.state.set(SELECTED, null), $.state.set(FOCUS, null)]).catch(fail('voltar'))
    },
    focus: step => () => {
      void update($, FOCUS, f => (f === step ? null : step)).catch(fail('abrir o passo'))
    },
    edit: id => () => {
      const flow = loaded.flows[id]
      if (flow === undefined) return
      const project = loaded.projectIds.has(id)
      const base = !project ? flow : flow.base === undefined ? undefined : flow.base === id ? defaults[id] : loaded.flows[flow.base]
      if (project && flow.base !== undefined && base === undefined) {
        $.ui.toast(`Não achei o workflow base ${flow.base}.`)
        return
      }
      const source = project ? loaded.files.find(f => idOf(f.raw) === id)?.source : undefined
      const d = { ...draftOf(flow, base, defaults[id] !== undefined), ...(source === undefined ? {} : { source }) }
      void Promise.all([$.state.set(DRAFT, d), $.state.set(FOCUS, null), $.state.set(INSERT, null), $.state.set(NOTICE, null)]).catch(fail('abrir a edição'))
    },
    form: field => value => {
      void update($, FORMS, f => ({ ...EMPTY_FORMS, ...(f ?? {}), [field]: value })).catch(fail('guardar o campo'))
    },
    create: () => {
      const name = forms$.newId.trim()
      const id = slug(name)
      if (name === '' || !WORKFLOW_ID.test(id)) {
        $.ui.toast('Dê um nome ao workflow novo (ex.: Dev e master); o id do arquivo sai dele.')
        return
      }
      if (loaded.flows[id] !== undefined) {
        $.ui.toast(`Já existe o workflow ${id}: abra-o e use "Editar".`)
        return
      }
      const base = forms$.newBase === '' ? undefined : loaded.flows[forms$.newBase]
      void takenBy($, loaded.files, loaded.dir, id)
        .then(taken => {
          if (taken !== undefined) {
            $.ui.toast(`Já existe ${taken} com o id ou o nome ${id}; nada foi criado. Corrija ou apague esse arquivo, ou use outro nome.`)
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
        .catch(fail('criar o workflow'))
    },
    head: field => value => editDraft(d => ({ ...d, [field]: value })),
    toggle: step => () => editDraft(d => toggleStep(d, step)),
    move: (step, by) => () => editDraft(d => moveStep(d, step, by)),
    set: (step, change) => () => editDraft(d => setStepField(d, step, change)),
    insert: after => () => {
      void update($, INSERT, i => (i === after ? null : after)).catch(fail('abrir o acréscimo de passo'))
    },
    add: () => {
      const d = view.draft
      const at = view.insert
      if (d === null || at === null) return
      const after = at === INSERT_END ? null : at
      const added = forms$.libraryUse === '' ? addNewStep(d, forms$, after) : addLibraryStep(d, forms$.libraryUse, after)
      if (!('steps' in added)) {
        void $.state.set(DRAFT, { ...d, error: added.error }).catch(fail('acrescentar o passo'))
        return
      }
      const known = new Set(d.steps.map(s => String(s.step.id)))
      const fresh = added.steps.find(s => !known.has(String(s.step.id)))
      void Promise.all([
        $.state.set(DRAFT, added),
        $.state.set(FORMS, { ...forms$, stepTitle: '', stepAgent: '', stepCommand: '', libraryUse: '' }),
        $.state.set(INSERT, null),
        $.state.set(FOCUS, fresh === undefined ? null : String(fresh.step.id)),
      ]).catch(fail('acrescentar o passo'))
    },
    save: () => {
      void saveDraft($).catch(fail('salvar o workflow'))
    },
    discard: () => {
      void Promise.all([$.state.set(DRAFT, null), $.state.set(FOCUS, null), $.state.set(INSERT, null)]).catch(fail('descartar o rascunho'))
    },
  })
}

/**
 * "Salvar": the draft resolved as the mod would load it; with an error nothing is written and the
 * error stays on the draft. Only this press writes a workflow file.
 */
async function saveDraft($: EngineInterface): Promise<void> {
  const { value: draft } = await $.state.get(DRAFT)
  if (draft == null) return
  const { files, dir } = await loadFlows($)
  const refuse = (error: string) => $.state.set(DRAFT, { ...draft, error })
  const relative = (path: string) => `.orquestrador/flows/${path.slice(dir.length + 1)}`
  // only the file the draft was opened from may be written over; any other of the same id or name stays
  const target = draft.source ?? `${dir}/${draft.id}.json`
  if (draft.source === undefined) {
    const taken = await takenBy($, files, dir, draft.id)
    if (taken !== undefined) {
      await refuse(`já existe ${taken} com o id ou o nome ${draft.id}; nada foi gravado. Corrija ou apague esse arquivo, ou use outro id.`)
      return
    }
  }
  const result = draftFile(draft, raw => resolveCandidate(DEFAULT_FLOWS, files, target, raw))
  if ('error' in result) {
    await refuse(result.error)
    return
  }
  const broken = brokenDependents(DEFAULT_FLOWS, files, target, result.raw)
  if (broken.length > 0) {
    const named = broken.map(p => p.split(`${dir}/`).join('.orquestrador/flows/'))
    await refuse(`os workflows que derivam de ${draft.id} deixariam de resolver; nada foi gravado. ${named.join(' ')}`)
    return
  }
  await $.fs.write(target, `${JSON.stringify(result.raw, null, 2)}\n`)
  await $.state.set(DRAFT, null)
  await $.state.set(SELECTED, draft.id)
  await $.state.set(FOCUS, null)
  await $.state.set(INSERT, null)
  await $.state.set(
    NOTICE,
    (draft.replacesDefault
      ? `Salvo em ${relative(target)}. O workflow padrão ${draft.id} segue no mod, mas este projeto passa a usar o seu no lugar dele.`
      : `Salvo em ${relative(target)}.`) +
      ' Changes em andamento seguem com o workflow com que começaram.' +
      (result.notice === undefined ? '' : ` ${result.notice}`),
  )
}

const idOf = (raw: unknown): unknown => (raw as { id?: unknown } | null)?.id

/** The project file, as the owner reads its path, that already holds `id`: by its id, or by its name `<id>.json`, valid or broken. */
async function takenBy($: EngineInterface, files: readonly FlowSource[], dir: string, id: string): Promise<string | undefined> {
  const named = `${dir}/${id}.json`
  const path = files.find(f => idOf(f.raw) === id)?.source ?? ((await $.fs.exists(named)) ? named : undefined)
  return path === undefined ? undefined : `.orquestrador/flows/${path.slice(dir.length + 1)}`
}
