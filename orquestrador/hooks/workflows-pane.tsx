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
import { findAgent, loadFlows } from './flow-files'
import { DEFAULT_FLOWS, defaultFlows } from './flows/index'
import { LIBRARY } from './flows/library'
import {
  EMPTY_FORMS,
  WORKFLOW_ID,
  addLibraryStep,
  addNewStep,
  draftFile,
  draftOf,
  moveStep,
  newDraft,
  resolveCandidate,
  setStepField,
  toggleStep,
} from './workflow-edit'
import type { StepField } from './workflow-edit'

export const WORKFLOWS_PANE = 'orquestrador-workflows'
export const WORKFLOWS_TITLE = '⚙️ Workflows'

const SELECTED = { plugin: 'orquestrador', key: 'wfSelected' } as const
const FOCUS = { plugin: 'orquestrador', key: 'wfFocus' } as const
const DRAFT = { plugin: 'orquestrador', key: 'wfDraft' } as const
const FORMS = { plugin: 'orquestrador', key: 'wfForms' } as const
const NOTICE = { plugin: 'orquestrador', key: 'wfNotice' } as const

/** Below this many columns the pane stacks what sits side by side. */
const NARROW_COLUMNS = 44
const LINK = '#2F6FD6'
const ERROR = '#D14343'
const WARN = '#B7791F'
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const METHODS = ['squash', 'merge', 'rebase']
/** A Select's "nothing chosen": its options' values must be words. */
const NONE = '-'

const WHO: Record<FlowStepKind, string> = {
  session: '🤖 sessão',
  owner: '✋ dono',
  automatic: '⚙ mod (comando)',
  loop: '🔁 mod (fases)',
}

export type WorkflowsElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  /** Fields, where the surface has them (not on mobile). */
  Input: ElementConstructor<InputProps> | undefined
  Select: ElementConstructor<SelectProps> | undefined
}

/** A workflow on offer, with where it comes from. */
export type WorkflowEntry = { flow: FlowDef; origin: string }

export type WorkflowsView = {
  entries: WorkflowEntry[]
  problems: string[]
  selected: string | null
  focus: string | null
  draft: WorkflowDraft | null
  forms: WorkflowForms
  notice: string | null
  /** Where each agent named by the steps shown was found. */
  agents: Record<string, 'project' | 'plugin' | null>
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
  addLibrary: (use: string) => void
  addNew: () => void
  save: () => void
  discard: () => void
}

/** A step as the pane reads it: a flow's, or a draft's raw one. */
type StepLike = {
  id: string
  title: string
  kind: FlowStepKind
  agent?: string
  model?: string
  effort?: string
  command?: string
  requiresEvidence?: boolean
  details?: { inputs?: string; produces?: string; blocks?: string }
  merge?: FlowMerge
  deploy?: FlowDeploy
}

const yes = (b: boolean | undefined) => (b === true ? 'sim' : 'não')

export const renderWorkflows = (els: WorkflowsElements, view: WorkflowsView, actions: WorkflowsActions): RenderElement => {
  const { Box, Text, Button, Input, Select } = els
  const fields = Input !== undefined && Select !== undefined

  const line = (text: string, color?: string, dim?: boolean) => (
    <Text wrap="wrap" color={color} dimColor={dim}>
      {text}
    </Text>
  )
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

  const agentLine = (name: string): string => {
    const found = view.agents[name]
    return `agente ${name} (${found === 'project' ? 'do projeto' : found === 'plugin' ? 'do plugin' : 'sem arquivo'})`
  }

  /** The step's one-line summary: who answers it, its agent, model and effort. */
  const summary = (s: StepLike): string =>
    [WHO[s.kind], s.agent === undefined ? undefined : agentLine(s.agent), s.model, s.effort === undefined ? undefined : `esforço ${s.effort}`]
      .filter((x): x is string => x !== undefined)
      .join(' · ')

  const configLines = (s: StepLike): RenderElement[] => {
    const out: RenderElement[] = []
    if (s.details?.inputs !== undefined) out.push(line(`Entrada: ${s.details.inputs}`))
    if (s.details?.produces !== undefined) out.push(line(`Saída: ${s.details.produces}`))
    if (s.details?.blocks !== undefined) out.push(line(`Bloqueia: ${s.details.blocks}`))
    out.push(line(`Agente: ${s.agent === undefined ? 'nenhum' : agentLine(s.agent)}`, undefined, true))
    out.push(line(`Modelo: ${s.model ?? 'o da sessão'} · Esforço: ${s.effort ?? 'o da sessão'}`, undefined, true))
    if (s.command !== undefined) out.push(line(`Comando: ${s.command}`, undefined, true))
    out.push(line(`Exige evidência: ${yes(s.requiresEvidence)}`, undefined, true))
    if (s.merge !== undefined) {
      out.push(line(`Merge: branch ${s.merge.branch} · método ${s.merge.method} · automático: ${yes(s.merge.auto)}`))
    }
    if (s.deploy !== undefined) {
      const routines = s.deploy.commands.length === 0 ? 'nenhuma' : s.deploy.commands.join(' ; ')
      out.push(line(`Deploy: CI ${yes(s.deploy.ci)} · rotinas: ${routines} · automático: ${yes(s.deploy.auto)}`))
    }
    return out
  }

  const editLines = (s: StepLike, on: boolean, last: boolean, first: boolean): RenderElement[] => {
    const out: RenderElement[] = [
      buttons(
        <Button key={`wf-toggle:${s.id}`} onPress={actions.toggle(s.id)}>
          {on ? 'Desligar passo' : 'Ligar passo'}
        </Button>,
        ...(first ? [] : [<Button key={`wf-up:${s.id}`} onPress={actions.move(s.id, -1)}>↑ Subir</Button>]),
        ...(last ? [] : [<Button key={`wf-down:${s.id}`} onPress={actions.move(s.id, 1)}>↓ Descer</Button>]),
      ),
    ]
    const takesAgent = s.kind === 'session' || s.kind === 'loop' || s.merge !== undefined || s.deploy !== undefined
    if (!fields) {
      out.push(noFields)
    } else {
      const text = (key: string, label: string, value: string | undefined, apply: (v: string) => void, rows?: number) => (
        <Input
          key={key}
          label={label}
          submitLabel="aplicar"
          {...(value === undefined || value === '' ? {} : { value })}
          {...(rows === undefined ? {} : { rows })}
          onInput={apply}
          onSubmit={apply}
        />
      )
      const pick = (key: string, label: string, options: string[], value: string | undefined, apply: (v: string) => void) => (
        <Select
          key={key}
          label={label}
          options={[{ value: NONE, label: 'o da sessão' }, ...[...new Set([...options, ...(value === undefined ? [] : [value])])].map(v => ({ value: v }))]}
          value={value ?? NONE}
          onSelect={v => apply(v === NONE ? '' : v)}
        />
      )
      if (takesAgent) out.push(text(`wf-agent:${s.id}`, 'Agente:', s.agent, v => actions.set(s.id, { field: 'agent', value: v })()))
      out.push(pick(`wf-model:${s.id}`, 'Modelo:', MODELS, s.model, v => actions.set(s.id, { field: 'model', value: v })()))
      out.push(pick(`wf-effort:${s.id}`, 'Esforço:', EFFORTS, s.effort, v => actions.set(s.id, { field: 'effort', value: v })()))
      if (s.merge !== undefined) {
        out.push(text(`wf-merge-branch:${s.id}`, 'Branch do merge:', s.merge.branch, v => actions.set(s.id, { field: 'merge', value: { branch: v.trim() } })()))
        out.push(
          <Select
            key={`wf-merge-method:${s.id}`}
            label="Método:"
            options={METHODS.map(m => ({ value: m }))}
            value={s.merge.method}
            onSelect={v => actions.set(s.id, { field: 'merge', value: { method: v as FlowMerge['method'] } })()}
          />,
        )
      }
      if (s.deploy !== undefined) {
        out.push(
          text(
            `wf-deploy-commands:${s.id}`,
            'Rotinas (uma por linha):',
            s.deploy.commands.join('\n'),
            v => actions.set(s.id, { field: 'deploy', value: { commands: v.split('\n').map(c => c.trim()).filter(c => c !== '') } })(),
            3,
          ),
        )
      }
    }
    if (s.merge !== undefined) {
      out.push(
        buttons(
          <Button key={`wf-merge-auto:${s.id}`} onPress={actions.set(s.id, { field: 'merge', value: { auto: !s.merge.auto } })}>
            {`Merge automático: ${yes(s.merge.auto)}`}
          </Button>,
        ),
      )
    }
    if (s.deploy !== undefined) {
      out.push(
        buttons(
          <Button key={`wf-deploy-ci:${s.id}`} onPress={actions.set(s.id, { field: 'deploy', value: { ci: !s.deploy.ci } })}>
            {`Deploy pelo CI: ${yes(s.deploy.ci)}`}
          </Button>,
          <Button key={`wf-deploy-auto:${s.id}`} onPress={actions.set(s.id, { field: 'deploy', value: { auto: !s.deploy.auto } })}>
            {`Deploy automático: ${yes(s.deploy.auto)}`}
          </Button>,
        ),
      )
    }
    return out
  }

  const stepBlock = (s: StepLike, n: number, opts: { on: boolean; editing: boolean; first: boolean; last: boolean }): RenderElement => {
    const open = view.focus === s.id
    return (
      <Box key={`wf-row:${s.id}`} flexDirection="column" minWidth={0} marginTop={1}>
        <Button key={`wf-step:${s.id}`} plain onPress={actions.focus(s.id)}>
          <Text strikethrough={!opts.on} dimColor={!opts.on}>{`${open ? '▾' : '▸'} ${n}. ${s.title}`}</Text>
        </Button>
        <Box flexDirection="column" paddingLeft={2} minWidth={0}>
          {line(opts.on ? summary(s) : `desligado · ${summary(s)}`, undefined, true)}
          {open ? configLines(s) : []}
          {open && opts.editing ? editLines(s, opts.on, opts.last, opts.first) : []}
        </Box>
      </Box>
    )
  }

  const back = (
    <Button key="wf-back" plain onPress={actions.back}>
      <Text color={LINK}>← Workflows</Text>
    </Button>
  )

  if (view.draft !== null) {
    const d = view.draft
    const steps = d.steps.map(s => s.step as unknown as StepLike)
    let n = 0
    const after = view.focus !== null && d.steps.some(s => s.step.id === view.focus) ? view.focus : null
    const libraryIds = Object.keys(LIBRARY).sort()
    return (
      <Box flexDirection="column" minWidth={0}>
        <Text bold wrap="wrap">{`Editando ${d.id}`}</Text>
        {line(d.base === undefined ? 'Do zero: grava os passos completos.' : `Derivado de ${d.base}: grava só o que muda em relação a ele.`, undefined, true)}
        {d.replacesDefault
          ? box([line(`⚠ ${d.id} é um workflow padrão. Salvar cria .orquestrador/flows/${d.id}.json, que passa a valer no lugar do padrão neste projeto.`, WARN)], WARN)
          : []}
        {line('Rascunho: nada é gravado até "Salvar". Changes em andamento seguem com o workflow com que começaram.', undefined, true)}
        {fields
          ? [
              <Input key="wf-title" label="Título:" submitLabel="aplicar" value={d.title} onInput={actions.head('title')} onSubmit={actions.head('title')} />,
              <Input
                key="wf-description"
                label="Descrição:"
                submitLabel="aplicar"
                {...(d.description === '' ? {} : { value: d.description })}
                onInput={actions.head('description')}
                onSubmit={actions.head('description')}
              />,
            ]
          : [line(d.title, undefined, false)]}
        {steps.length === 0 ? [line('Nenhum passo ainda: acrescente abaixo.', undefined, true)] : []}
        {steps.map((s, i) => {
          const on = d.steps[i]!.on
          if (on) n++
          return stepBlock(s, on ? n : 0, { on, editing: true, first: i === 0, last: i === steps.length - 1 })
        })}
        <Box flexDirection="column" marginTop={1} minWidth={0}>
          <Text bold wrap="wrap">{`Acrescentar passo ${after === null ? 'no fim' : `depois de ${after}`}`}</Text>
          {line('Abra um passo acima para acrescentar depois dele.', undefined, true)}
          {Select !== undefined && Input !== undefined
            ? [
                <Select
                  key="wf-add-library"
                  label="Da biblioteca:"
                  options={[{ value: NONE, label: 'escolha um passo' }, ...libraryIds.map(id => ({ value: id }))]}
                  value={NONE}
                  onSelect={v => {
                    if (v !== NONE) actions.addLibrary(v)
                  }}
                />,
                <Text wrap="wrap">Ou um passo novo:</Text>,
                <Input
                  key="wf-step-title"
                  label="Título:"
                  submitLabel="ok"
                  {...(view.forms.stepTitle === '' ? {} : { value: view.forms.stepTitle })}
                  onInput={actions.form('stepTitle')}
                  onSubmit={actions.form('stepTitle')}
                />,
                <Select
                  key="wf-step-kind"
                  label="Quem responde:"
                  options={[
                    { value: 'session', label: 'sessão' },
                    { value: 'owner', label: 'dono' },
                    { value: 'automatic', label: 'mod (comando)' },
                  ]}
                  value={view.forms.stepKind}
                  onSelect={actions.form('stepKind')}
                />,
                ...(view.forms.stepKind === 'session'
                  ? [
                      <Input
                        key="wf-step-agent"
                        label="Agente:"
                        submitLabel="ok"
                        {...(view.forms.stepAgent === '' ? {} : { value: view.forms.stepAgent })}
                        onInput={actions.form('stepAgent')}
                        onSubmit={actions.form('stepAgent')}
                      />,
                    ]
                  : []),
                ...(view.forms.stepKind === 'automatic'
                  ? [
                      <Input
                        key="wf-step-command"
                        label="Comando:"
                        submitLabel="ok"
                        {...(view.forms.stepCommand === '' ? {} : { value: view.forms.stepCommand })}
                        onInput={actions.form('stepCommand')}
                        onSubmit={actions.form('stepCommand')}
                      />,
                    ]
                  : []),
                buttons(
                  <Button key="wf-add-new" onPress={actions.addNew}>
                    Acrescentar passo novo
                  </Button>,
                ),
              ]
            : [noFields]}
        </Box>
        {d.error === undefined ? [] : box([line(`Não salvei: ${d.error}`, ERROR)], ERROR)}
        <Box marginTop={1} minWidth={0}>
          {buttons(
            <Button key="wf-save" variant="primary" onPress={actions.save}>
              Salvar
            </Button>,
            <Button key="wf-discard" onPress={actions.discard}>
              Descartar
            </Button>,
          )}
        </Box>
      </Box>
    )
  }

  const notice = view.notice === null ? [] : [box([line(view.notice)])]
  const chosen = view.selected === null ? undefined : view.entries.find(e => e.flow.id === view.selected)
  if (chosen !== undefined) {
    const steps = chosen.flow.steps as unknown as StepLike[]
    return (
      <Box flexDirection="column" minWidth={0}>
        {back}
        {notice}
        <Text bold wrap="wrap">{chosen.flow.title}</Text>
        {line(`${chosen.flow.id} · ${chosen.origin}`, undefined, true)}
        {chosen.flow.description === '' ? [] : [line(chosen.flow.description)]}
        {buttons(
          <Button key="wf-edit" onPress={actions.edit(chosen.flow.id)}>
            Editar
          </Button>,
        )}
        {steps.map((s, i) => stepBlock(s, i + 1, { on: true, editing: false, first: i === 0, last: i === steps.length - 1 }))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" minWidth={0}>
      {notice}
      <Text bold>Workflows disponíveis</Text>
      {view.entries.map(({ flow, origin }) => (
        <Box key={`wf-entry:${flow.id}`} flexDirection="column" minWidth={0} marginTop={1}>
          <Button key={`wf-open:${flow.id}`} plain onPress={actions.open(flow.id)}>
            <Text color={LINK}>{flow.title}</Text>
          </Button>
          {line(`${flow.id} · ${origin} · ${flow.steps.length} passos`, undefined, true)}
          {flow.description === '' ? [] : [line(flow.description)]}
        </Box>
      ))}
      {view.problems.length === 0
        ? []
        : [
            <Box flexDirection="column" marginTop={1} minWidth={0}>
              <Text bold color={ERROR}>Arquivos com erro em .orquestrador/flows/</Text>
              {view.problems.map(p => line(p, ERROR))}
            </Box>,
          ]}
      <Box flexDirection="column" marginTop={1} minWidth={0}>
        <Text bold>Novo workflow</Text>
        {Input !== undefined && Select !== undefined
          ? [
              <Input
                key="wf-new-id"
                label="Id:"
                placeholder="ex.: trunk"
                submitLabel="ok"
                {...(view.forms.newId === '' ? {} : { value: view.forms.newId })}
                onInput={actions.form('newId')}
                onSubmit={actions.form('newId')}
              />,
              <Select
                key="wf-new-base"
                label="Começar:"
                options={[{ value: NONE, label: 'do zero' }, ...view.entries.map(e => ({ value: e.flow.id, label: `a partir de ${e.flow.id}` }))]}
                value={view.forms.newBase === '' ? NONE : view.forms.newBase}
                onSelect={v => actions.form('newBase')(v === NONE ? '' : v)}
              />,
              buttons(
                <Button key="wf-new" onPress={actions.create}>
                  Criar workflow
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
  const [selected, focus, draft, forms, notice] = await Promise.all([
    $.state.get(SELECTED),
    $.state.get(FOCUS),
    $.state.get(DRAFT),
    $.state.get(FORMS),
    $.state.get(NOTICE),
  ])
  const entries = Object.values(loaded.flows).map(flow => ({ flow, origin: originOf(flow, loaded.projectIds.has(flow.id)) }))
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
    problems: loaded.problems,
    selected: selected.value ?? null,
    focus: focus.value ?? null,
    draft: draft.value ?? null,
    forms: { ...EMPTY_FORMS, ...(forms.value ?? {}) },
    notice: notice.value ?? null,
    agents,
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
      void Promise.all([$.state.set(SELECTED, id), $.state.set(FOCUS, null), $.state.set(NOTICE, null)]).catch(fail('abrir o workflow'))
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
      const defaults = defaultsById()
      const project = loaded.projectIds.has(id)
      const base = !project ? flow : flow.base === undefined ? undefined : flow.base === id ? defaults[id] : loaded.flows[flow.base]
      if (project && flow.base !== undefined && base === undefined) {
        $.ui.toast(`Não achei o workflow base ${flow.base}.`)
        return
      }
      const d = draftOf(flow, base, defaults[id] !== undefined)
      void Promise.all([$.state.set(DRAFT, d), $.state.set(FOCUS, null), $.state.set(NOTICE, null)]).catch(fail('abrir a edição'))
    },
    form: field => value => {
      void update($, FORMS, f => ({ ...EMPTY_FORMS, ...(f ?? {}), [field]: value })).catch(fail('guardar o campo'))
    },
    create: () => {
      const id = forms$.newId.trim()
      if (!WORKFLOW_ID.test(id)) {
        $.ui.toast('O id do workflow novo é em minúsculas, com hífens (ex.: trunk).')
        return
      }
      if (loaded.flows[id] !== undefined) {
        $.ui.toast(`Já existe o workflow ${id}: abra-o e use "Editar".`)
        return
      }
      const base = forms$.newBase === '' ? undefined : loaded.flows[forms$.newBase]
      void Promise.all([
        $.state.set(DRAFT, newDraft(id, base)),
        $.state.set(FORMS, { ...forms$, newId: '', newBase: '' }),
        $.state.set(FOCUS, null),
        $.state.set(NOTICE, null),
      ]).catch(fail('criar o workflow'))
    },
    head: field => value => editDraft(d => ({ ...d, [field]: value })),
    toggle: step => () => editDraft(d => toggleStep(d, step)),
    move: (step, by) => () => editDraft(d => moveStep(d, step, by)),
    set: (step, change) => () => editDraft(d => setStepField(d, step, change)),
    addLibrary: use => editDraft(d => addLibraryStep(d, use, view.focus)),
    addNew: () => {
      const d = view.draft
      if (d === null) return
      const added = addNewStep(d, forms$, view.focus)
      const done =
        'steps' in added
          ? Promise.all([$.state.set(DRAFT, added), $.state.set(FORMS, { ...forms$, stepTitle: '', stepAgent: '', stepCommand: '' })])
          : $.state.set(DRAFT, { ...d, error: added.error })
      void done.catch(fail('acrescentar o passo'))
    },
    save: () => {
      void saveDraft($).catch(fail('salvar o workflow'))
    },
    discard: () => {
      void Promise.all([$.state.set(DRAFT, null), $.state.set(FOCUS, null)]).catch(fail('descartar o rascunho'))
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
  const target = files.find(f => (f.raw as { id?: unknown } | null)?.id === draft.id)?.source ?? `${dir}/${draft.id}.json`
  const result = draftFile(draft, raw => resolveCandidate(DEFAULT_FLOWS, files, target, raw))
  if ('error' in result) {
    await $.state.set(DRAFT, { ...draft, error: result.error })
    return
  }
  await $.fs.write(target, `${JSON.stringify(result.raw, null, 2)}\n`)
  const relative = `.orquestrador/flows/${target.slice(dir.length + 1)}`
  await $.state.set(DRAFT, null)
  await $.state.set(SELECTED, draft.id)
  await $.state.set(FOCUS, null)
  await $.state.set(
    NOTICE,
    (draft.replacesDefault
      ? `Salvo em ${relative}. O workflow padrão ${draft.id} segue no mod, mas este projeto passa a usar o seu no lugar dele.`
      : `Salvo em ${relative}.`) + ' Changes em andamento seguem com o workflow com que começaram.',
  )
}
