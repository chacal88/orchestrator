export type PlanItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Why a session stands still until the owner acts. */
export type Waiting = {
  kind: 'permission' | 'question'
  text: string
  since: number
}

/** What a session's own copy of the mod publishes for the others to read. */
export type ActivityRecord = {
  /** The app's id of the publishing session; absent in a record from before 0.7.1, keyed by folder. */
  sessionId?: string
  cwd: string
  plan: PlanItem[]
  lastTool: string | undefined
  waiting: Waiting | undefined
  updatedAt: number
  /** What the gates saw this session run; absent in a record from before the gates. */
  gates?: Record<string, GateRecord>
  /** When this session last edited a file: a pass older than that is stale. */
  editedAt?: number
  /** Its latest commands that looked like a gate run but did not count, with why. */
  tried?: GateAttempt[]
}

/** One finished run of a gate's command or tool, as the session's own mod saw it. */
export type GateRecord = {
  gate: string
  result: 'passed' | 'failed'
  /** The command (cut short) or the tool that proved it. */
  evidence: string
  at: number
}

/** A command that looked like a gate run but proved nothing, and why: quoted when a phase is refused. */
export type GateAttempt = { command: string; why: string; at: number }

/** What a session proved: its latest record per gate and its last edit; `tried`, what it ran that did not count. */
export type GateCheck = { records: Record<string, GateRecord>; editedAt: number | undefined; tried?: GateAttempt[] }

/** Only the owner skips a gate, from the panel. */
export type GateSkip = { at: number }

export type GateState = 'passed' | 'failed' | 'pending' | 'stale' | 'skipped'

export type GateView = {
  gate: string
  label: string
  state: GateState
  evidence: string | undefined
  at: number | undefined
  skipKey: string
}

export type FlowStepKind = 'session' | 'automatic' | 'owner' | 'loop'

/** The languages the mod speaks. */
export type Lang = 'pt-BR' | 'en'

/** A project's two languages: `ui` for boxes and titles, `content` for descriptions and the change's own texts. */
export type Languages = { ui: Lang; content: Lang }

/** A flow field as a file writes it: plain text, or one text per language. */
export type Localized = string | Partial<Record<Lang, string>>

/** The same text per language, where the flow file gave more than one. */
export type Translations = Partial<Record<Lang, string>>

/** Where one outcome of a step leads; `label` is what the owner reads (pt-BR). */
export type FlowOutcome = { label: string; next: string; labels?: Translations }

export type FlowStep = {
  id: string
  /** Plain words for the owner (pt-BR). */
  title: string
  description: string | undefined
  /** The title and description per language; absent in a flow saved before 0.8.0, which keeps its plain text. */
  titles?: Translations
  descriptions?: Translations
  kind: FlowStepKind
  outcomes: Record<string, FlowOutcome>
  maxAttempts: number
  /** automatic: the command the mod watches a session run; its exit code decides passou/falhou. */
  command: string | undefined
  /** automatic: a pass also needs evidence.md recorded in the change folder. */
  requiresEvidence: boolean
  /** The step runs only when the change has this trait; otherwise the flow goes on to the next step. */
  when: 'visual' | undefined
  /** loop: what it iterates over. */
  over: 'tasks' | undefined
  /** Besides its own answerer, the mod answers the step when it sees one of these commands succeed (e.g. the deploy). */
  detect: FlowDetect | undefined
  /** On its pass the mod archives the change's remaining phase sessions and removes its sidebar group. */
  cleanup: boolean
  /** The Jira state this step implies for the change's issue: a target, or false for none; absent, the default of the step id. */
  jira?: JiraTarget | false
  /** What the step reads, what it hands on and what it holds back (pt-BR), for the owner and the session. */
  details?: FlowStepDetails
  /** The details per language, where the flow file gave more than one; `details` holds the pt-BR (or only) text. */
  detailsByLang?: Partial<Record<Lang, FlowStepDetails>>
  /** session or loop (or a merge/deploy step, which a session carries out): the specialist agent that runs it. */
  agent?: string
  /** The model suggested for the session that runs the step. */
  model?: string
  /** The effort suggested for the session that runs the step. */
  effort?: FlowEffort
  /** The step merges the change's PR. */
  merge?: FlowMerge
  /** The step deploys the change after the merge. */
  deploy?: FlowDeploy
}

export type FlowStepDetails = { inputs?: string; produces?: string; blocks?: string }

export type FlowEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** auto: the coordinator merges by itself (an automatic step); otherwise the owner merges (an owner step). */
export type FlowMerge = {
  branch: string
  method: 'squash' | 'merge' | 'rebase'
  auto: boolean
  /** The fields the step did not write: their value comes from the project's settings (config.json). */
  fromProject?: string[]
}

/** ci: the merge's CI deploys and the step waits for it; commands: routines run after the merge, in order. */
export type FlowDeploy = {
  ci: boolean
  commands: string[]
  auto: boolean
  /** The fields the step did not write: their value comes from the project's settings. */
  fromProject?: string[]
}

/** The project's merge defaults, each field optional: only what the config files set. */
export type ProjectMerge = Partial<Pick<FlowMerge, 'branch' | 'method' | 'auto'>>
/** The project's deploy defaults, each field optional. */
export type ProjectDeploy = Partial<Pick<FlowDeploy, 'ci' | 'commands' | 'auto'>>
/** The project's defaults for the merge and deploy steps of every workflow. */
export type ProjectSettings = { merge?: ProjectMerge; deploy?: ProjectDeploy }

/** How far a deploy step got: the CI's deploy confirmed, and the routines seen passing, in order. */
export type FlowDeployProgress = { ci: boolean; commands: string[] }

/**
 * Commands whose success answers a step, and the outcome they give it; logged with actor "detect".
 * routines: the deploy's routines the mod joined into production's commands, not the step's own.
 */
export type FlowDetect = { commands: string[]; outcome: string; routines?: string[] }

/** base: the flow a derived project flow was resolved from. */
export type FlowDef = {
  id: string
  title: string
  description: string
  titles?: Translations
  descriptions?: Translations
  steps: FlowStep[]
  base?: string
}

/** A step added to a derived flow: a library id, `{ use: <library id>, ...changes }`, or a whole step. */
export type FlowAdd = { after: string; step: string | Record<string, unknown> }

/** A project flow written as changes to another: `.orquestrador/flows/<id>.json` with `base` instead of `steps`. */
export type FlowDerived = {
  id: string
  title?: string
  description?: string
  base: string
  remove?: string[]
  add?: FlowAdd[]
  override?: Record<string, Record<string, unknown>>
  order?: string[]
}

/** mod: the mod closing a loop; detect: the mod seeing a step's detect command succeed. */
export type FlowActor = 'session' | 'automatic' | 'owner' | 'mod' | 'detect'

export type FlowStatus = 'running' | 'escalated' | 'done' | 'aborted'

/** A step hit its attempt ceiling: only the owner says whether it goes again. */
export type FlowEscalation = { step: string; from: string; outcome: string; attempts: number }

/** The last outcome a step finished with, until the flow comes back to it. */
export type FlowStepRecord = { outcome: string; by: FlowActor; at: number; note?: string }

/** One change's run through a flow, saved by the mod in its home folder (flows/<change>.json). */
export type FlowState = {
  change: string
  coordinatorCwd: string
  changePath?: string
  /** The flow as it stood when the run started, so editing the file later never strands a run. */
  flow: FlowDef
  traits: { visual: boolean }
  current: string
  status: FlowStatus
  attempts: Record<string, number>
  records: Record<string, FlowStepRecord>
  escalation?: FlowEscalation
  /** loop: the phases the mod closed, by phase id; kept when the flow comes back to the loop. */
  closed?: Record<string, PhaseClosure>
  /** Why the flow came back to an earlier step (e.g. QA asked for changes), until it reaches that step again. */
  reopened?: FlowReopen
  /** A note a session left for the owner step that waits; it joins the owner's answer when pressed. */
  pendingNote?: string
  /** deploy: what each deploy step already saw done, by step id; kept while the step retries itself. */
  progress?: Record<string, FlowDeployProgress>
  seq: number
  startedAt: number
  updatedAt: number
}

/** One phase of the loop, closed by the mod once its gates passed and its tasks were ticked. */
export type PhaseClosure = { at: number; tasks: string[]; session?: string; archived: boolean }

export type FlowReopen = { step: string; outcome: string; label: string; by: FlowActor; at: number; note?: string }

export type FlowEvent = {
  seq: number
  at: number
  kind:
    | 'started'
    | 'outcome'
    | 'entered'
    | 'skipped'
    | 'escalated'
    | 'retried'
    | 'aborted'
    | 'done'
    | 'refused'
    /** A grill round recorded, a mockup attached, the execution plan refused in plan mode. */
    | 'round'
    | 'attached'
    | 'plan-rejected'
    | 'phase-closed'
    | 'session-archived'
    | 'noted'
    | 'cleanup'
    /** A deploy step saw the CI's deploy confirmed or one of its routines pass. */
    | 'progress'
    /** The owner moved a Jira issue from the panel. */
    | 'jira-moved'
  step: string
  by: FlowActor | 'mod'
  outcome?: string
  note?: string
}

export type FlowStepView = {
  id: string
  title: string
  description: string | undefined
  kind: FlowStepKind
  state: 'done' | 'current' | 'pending' | 'skipped'
  attempts: number
  maxAttempts: number
  outcome: string | undefined
  outcomeLabel: string | undefined
}

/** One button the owner may press now. */
export type FlowChoice = { outcome: string; label: string }

/** What the panel needs of one change's flow. */
export type FlowView = {
  change: string
  flowId: string
  flowTitle: string
  status: FlowStatus
  current: FlowStepView | undefined
  /** Who moves the flow now: nobody once it is done or aborted. */
  waitingOn: FlowActor | undefined
  /** The buttons the owner may press now (an owner step's outcomes, or an escalation's choices). */
  ownerChoices: FlowChoice[]
  escalation: FlowEscalation | undefined
  steps: FlowStepView[]
}

/** One grill question; answered, it becomes an acceptance criterion (its own wording, else the answer). */
export type GrillItem = { question: string; answer?: string; criterion?: string }

/** One answer the owner typed in the panel for an open grill question, by its number in the round. */
export type GrillAnswer = { n: number; question: string; answer: string }

export type GrillRound = { n: number; at: number; items: GrillItem[] }

/** The owner's "Pedir ajuste" on a mockup: the note and the mockup it was about. */
export type MockupAdjustment = { note: string; at: number; artifact?: string }

/** What the owner steps before execution gathered, saved by the mod (prep/<change>.json). */
export type PrepState = {
  change: string
  rounds: GrillRound[]
  /** The mockup awaiting the owner, an Artifact URL or a file path. */
  mockup?: { artifact: string; at: number }
  adjustments: MockupAdjustment[]
  /** The owner's refusals of the execution plan in plan mode, with their words. */
  planRejections: { feedback: string; at: number }[]
  /** The execution plan the owner approved in plan mode. */
  release?: { at: number; plan?: string; filePath?: string }
}

/** What the panel shows of the pre-execution steps. */
export type PrepView = {
  change: string
  rounds: number
  /** The latest round's questions still without an answer. */
  openQuestions: string[]
  /** The same questions with their number in the round (1-based), for the panel's answer fields. */
  openItems: { n: number; question: string }[]
  criteria: string[]
  mockup?: string
  mockupIsUrl?: boolean
  lastAdjustment?: string
  lastPlanFeedback?: string
  released: boolean
}

/** When a step was last entered and, once answered, when it finished (epoch ms). */
export type StepTime = { from: number; to?: number }

/** One row of the app's session list, as far as the panel needs it. */
export type SessionRow = {
  sessionId: string
  title: string
  cwd: string
  branch: string | undefined
  isRunning: boolean
  isArchived: boolean
  prNumber: number | undefined
  prState: string | undefined
  lastActivityAt: string | undefined
  name: string | undefined
  startedBy: string | undefined
  link: string | undefined
  groupId: string | undefined
  groupName: string | undefined
}

export type SessionCard = SessionRow & {
  plan: PlanItem[]
  lastTool: string | undefined
  waiting: Waiting | undefined
  hasActivity: boolean
  gates: GateCheck
}

export type PhaseStatus = 'pending' | 'running' | 'blocked' | 'done'

export type Phase = {
  id: string
  title: string
  status: PhaseStatus
  icon: string | undefined
  tasks: string | undefined
  session: string | undefined
  dependsOn: string[] | undefined
  note: string | undefined
  summary: string | undefined
  jira: string | undefined
  /** Gate ids the phase must pass before it closes. */
  gates: string[] | undefined
}

/** Jira's own status category: "new" (to do), "indeterminate" (in progress) or "done". */
export type JiraCategory = 'new' | 'indeterminate' | 'done' | 'unknown'

/** The state an issue should be in: any of these status names (case-insensitive), else a status category. */
export type JiraTarget = { status: string[]; category?: 'new' | 'indeterminate' | 'done' }

/** One transition the connector offers for an issue. */
export type JiraTransition = { id: string; name: string; to?: string; category: JiraCategory }

/** An issue that should change state, and whether the panel can offer the move. */
export type JiraMove = {
  key: string
  title?: string
  /** The status now, when the connector read it. */
  from?: string
  /** The target as the owner reads it ("Em QA"). */
  toLabel: string
  step: string
  state: 'ready' | 'no-transition' | 'no-connector'
  transitionId?: string
  transitionName?: string
  /** What the issue can move to now, to say plainly why nothing matched. */
  available: string[]
  /** no-connector: why. */
  note?: string
}

export type JiraIssue = {
  key: string
  title: string | undefined
  status: string | undefined
  category: JiraCategory
  url: string | undefined
}

export type TaskSection = { title: string; done: number; total: number }

/** One numbered checkbox of tasks.md: `- [x] 4.1 Wire the checkout`. */
export type TaskItem = { id: string; text: string; done: boolean }

export type EvidenceState = 'missing' | 'stub' | 'recorded' | 'green' | 'failing'

/** What the panel reads of the change folder: tasks.md, proposal.md and evidence.md. */
export type OpenSpecView = {
  sections: TaskSection[]
  done: number
  total: number
  proposalTitle: string | undefined
  proposalSummary: string | undefined
  evidence: EvidenceState
  evidenceSummary: string | undefined
  /** The numbered tasks, so a phase can list the ones it delivers. */
  items: TaskItem[]
}

export type PhaseView = Phase & { card: SessionCard | undefined }

/** A decision the coordinator needs from the owner, and where it lives. */
export type OwnerQuestion = {
  question: string
  recommendation: string | undefined
  session: string | undefined
  pr: number | undefined
  /** A question about skipping a gate: the panel offers that skip, which only the owner's press makes. */
  gate?: { phase: string; gate: string }
}

export type OrchestrationRun = {
  change: string
  changePath: string | undefined
  coordinatorCwd: string
  /** The change's own issue (an epic, usually), beside each wave's and phase's. */
  jira: string | undefined
  /** The Jira site, e.g. acme.atlassian.net; absent, the connector's first site. */
  jiraSite: string | undefined
  waves: { title: string | undefined; summary: string | undefined; jira: string | undefined; phases: Phase[] }[]
  ownerQuestions: OwnerQuestion[]
  /** Gates the whole change passes once, at the end. */
  finalGates: string[] | undefined
  updatedAt: number
}

/** One row of "Precisa de você": a decision, a waiting session or an open PR. */
export type Attention = {
  id: string
  kind: 'decision' | 'permission' | 'question' | 'pr' | 'flow' | 'jira'
  title: string
  detail: string | undefined
  recommendation: string | undefined
  card: SessionCard | undefined
  prUrl: string | undefined
  /** kind 'flow': the step the owner answers, pressed only in the panel. */
  flow?: { change: string; step: string; choices: FlowChoice[] }
  /** kind 'jira': the move only the owner's press makes. */
  jira?: { change: string; key: string; transitionId: string; toLabel: string }
  /** kind 'decision' about a gate: the skip the owner's two presses make; "Aceitar" cannot skip. */
  skip?: GateView
}

export type PanelView = {
  self: SessionCard | undefined
  children: SessionCard[]
  run: OrchestrationRun | undefined
  updatedAt: number
  warning: string | undefined
  repoUrl: string | undefined
  openspec: OpenSpecView | undefined
  /** Issues by key; a key the connector could not fetch carries only its link. */
  jira: Record<string, JiraIssue>
  /** Why the Jira status is missing, when it is. */
  jiraNote: string | undefined
  /** Issues that should change state with the flow's step; moved only by the owner's press. */
  jiraMoves?: JiraMove[]
  /** Gates the owner skipped, by skip key. */
  skips: Record<string, GateSkip>
  /** The flow of the change this coordinator runs, when one was started. */
  flow?: FlowView
  /** Grill rounds, mockup and plan release of that flow's change. */
  prep?: PrepView
  /** Per step id, from the flow's log: the elapsed time the Gates list shows. */
  flowTimes?: Record<string, StepTime>
  /** The project's languages from .orquestrador/config.json; absent, pt-BR for both. */
  languages?: Languages
}

/** One step of a workflow the owner edits in the Workflows panel. */
export type WorkflowDraftStep = {
  /** The step as it will be written; its forward outcomes lead to "$seguinte", the step after it in the list. */
  step: Record<string, unknown>
  /** base: a step of the base workflow (orig is it as the base has it); added: one the owner added. */
  from: 'base' | 'added'
  orig?: Record<string, unknown>
  /** The library step an added one was built from. */
  use?: string
  on: boolean
}

/** A workflow being edited: kept in the mod's state until "Salvar" or "Descartar". */
export type WorkflowDraft = {
  id: string
  title: string
  description: string
  /** The workflow this one derives from; absent, the file is written with its whole `steps`. */
  base?: string
  /** The base's step ids, so a step left out is written as removed. */
  baseIds: string[]
  /** The workflow edited is a default of the mod: the project's file of the same id replaces it. */
  replacesDefault: boolean
  steps: WorkflowDraftStep[]
  /** The project file the draft was opened from, the only one "Salvar" may write over. */
  source?: string
  /** Why the last "Salvar" wrote nothing. */
  error?: string
  /** The draft as it was opened (title, description and each step), for the summary of what changed. */
  initial?: { title: string; description: string; steps: { id: string; step: Record<string, unknown>; on: boolean }[] }
}

/** The project settings being edited: kept in the mod's state until "Salvar" or "Descartar". */
export type ConfigDraft = {
  languages: Languages
  merge: ProjectMerge
  deploy: ProjectDeploy
  /** What the file held when the edit opened: the settings are compared with it. */
  initial: { languages: Languages; merge: ProjectMerge; deploy: ProjectDeploy }
  error?: string
}

/** An action on a workflow from "Nos workflows", waiting for the owner's confirmation. */
export type ConfigAsk = { what: 'add' | 'use'; id: string }

/** The "Novo workflow" and "Acrescentar passo" fields, as the owner fills them. */
export type WorkflowForms = {
  newId: string
  newBase: string
  stepTitle: string
  stepKind: 'session' | 'owner' | 'automatic'
  stepAgent: string
  stepCommand: string
  /** "+ passo aqui": the library step chosen ("" for a new one). */
  libraryUse: string
  /** The deploy step whose "+ rotina" field is open. */
  routineFor: string
}

declare module 'claude-code' {
  interface PluginState {
    orquestrador: {
      view: PanelView
      plan: PlanItem[]
      collapsed: Record<string, boolean>
      waiting: Waiting | null
      answered: string[]
      gates: Record<string, GateRecord>
      editedAt: number | null
      /** This session's latest commands that looked like a gate run but did not count. */
      tried: GateAttempt[]
      /** This session's id in the app's session list, once asked; its activity file is keyed by it. */
      selfId: string
      /** Whether the pane is up, so the band's button says "Abrir" or "Fechar". */
      paneOpen: boolean
      /** What the owner has typed so far in the grill's answer fields, by question text. */
      grillDrafts: Record<string, string>
      /** Workflows panel: the workflow open in the panel, by id. */
      wfSelected: string | null
      /** Workflows panel: the step whose details are open (an added step goes after it). */
      wfFocus: string | null
      /** Workflows panel: where "+ passo aqui" is open: a step id (add after it) or ":fim" (add at the end). */
      wfInsert: string | null
      /** Workflows panel: the edit in progress, until saved or discarded. */
      wfDraft: WorkflowDraft | null
      wfForms: WorkflowForms
      /** Workflows panel: what the last save did, for the owner to read. */
      wfNotice: string | null
      /** Workflows panel: the project settings edit in progress. */
      wfCfgDraft: ConfigDraft | null
      /** Workflows panel: the "Nos workflows" action awaiting confirmation. */
      wfCfgAsk: ConfigAsk | null
    }
  }
}
