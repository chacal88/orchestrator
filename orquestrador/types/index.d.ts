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
  cwd: string
  plan: PlanItem[]
  lastTool: string | undefined
  waiting: Waiting | undefined
  updatedAt: number
  /** What the gates saw this session run; absent in a record from before the gates. */
  gates?: Record<string, GateRecord>
  /** When this session last edited a file: a pass older than that is stale. */
  editedAt?: number
}

/** One finished run of a gate's command or tool, as the session's own mod saw it. */
export type GateRecord = {
  gate: string
  result: 'passed' | 'failed'
  /** The command (cut short) or the tool that proved it. */
  evidence: string
  at: number
}

/** What a session proved: its latest record per gate and its last edit. */
export type GateCheck = { records: Record<string, GateRecord>; editedAt: number | undefined }

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

/** Where one outcome of a step leads; `label` is what the owner reads (pt-BR). */
export type FlowOutcome = { label: string; next: string }

export type FlowStep = {
  id: string
  /** Plain words for the owner (pt-BR). */
  title: string
  description: string | undefined
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
}

/** Commands whose success answers a step, and the outcome they give it; logged with actor "detect". */
export type FlowDetect = { commands: string[]; outcome: string }

export type FlowDef = { id: string; title: string; description: string; steps: FlowStep[] }

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
  criteria: string[]
  mockup?: string
  mockupIsUrl?: boolean
  lastAdjustment?: string
  lastPlanFeedback?: string
  released: boolean
}

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
  kind: 'decision' | 'permission' | 'question' | 'pr' | 'flow'
  title: string
  detail: string | undefined
  recommendation: string | undefined
  card: SessionCard | undefined
  prUrl: string | undefined
  /** kind 'flow': the step the owner answers, pressed only in the panel. */
  flow?: { change: string; step: string; choices: FlowChoice[] }
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
  /** Gates the owner skipped, by skip key. */
  skips: Record<string, GateSkip>
  /** The flow of the change this coordinator runs, when one was started. */
  flow?: FlowView
  /** Grill rounds, mockup and plan release of that flow's change. */
  prep?: PrepView
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
    }
  }
}
