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
  kind: 'decision' | 'permission' | 'question' | 'pr'
  title: string
  detail: string | undefined
  recommendation: string | undefined
  card: SessionCard | undefined
  prUrl: string | undefined
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
