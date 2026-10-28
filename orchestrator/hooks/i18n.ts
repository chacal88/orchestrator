import type { EvidenceState, GateState, Lang, Languages, Localized, PhaseStatus, ProjectSettings } from '../types'
import { parseProjectBlocks } from './project-config'

export const LANGS: readonly Lang[] = ['pt-BR', 'en']
export const DEFAULT_LANG: Lang = 'pt-BR'
export const DEFAULT_LANGUAGES: Languages = { ui: DEFAULT_LANG, content: DEFAULT_LANG }

/** Where a project sets its languages, under its repository root. */
export const CONFIG_PATH = '.orquestrador/config.json'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v)

/** `"en"` sets both; `{ ui, content }` sets each, a missing one stays pt-BR. An unknown value is named, never guessed. */
export const parseLanguages = (raw: unknown): { languages: Languages; problems: string[] } => {
  if (raw === undefined) return { languages: DEFAULT_LANGUAGES, problems: [] }
  if (isLang(raw)) return { languages: { ui: raw, content: raw }, problems: [] }
  if (!isRecord(raw)) {
    return { languages: DEFAULT_LANGUAGES, problems: [`language must be ${LANGS.join(' or ')}, or { ui, content }.`] }
  }
  const problems: string[] = []
  const pick = (axis: keyof Languages): Lang => {
    const v = raw[axis]
    if (v === undefined) return DEFAULT_LANG
    if (isLang(v)) return v
    problems.push(`language.${axis} "${String(v)}" is not ${LANGS.join(' or ')}.`)
    return DEFAULT_LANG
  }
  return { languages: { ui: pick('ui'), content: pick('content') }, problems }
}

/** What a config file sets for the languages: only the axes it names. */
const languagePartial = (raw: unknown): { ui?: Lang; content?: Lang; problems: string[] } => {
  if (raw === undefined) return { problems: [] }
  if (isLang(raw)) return { ui: raw, content: raw, problems: [] }
  if (!isRecord(raw)) return { problems: [`language must be ${LANGS.join(' or ')}, or { ui, content }.`] }
  const out: { ui?: Lang; content?: Lang; problems: string[] } = { problems: [] }
  for (const axis of ['ui', 'content'] as const) {
    const v = raw[axis]
    if (v === undefined) continue
    if (isLang(v)) out[axis] = v
    else out.problems.push(`language.${axis} "${String(v)}" is not ${LANGS.join(' or ')}.`)
  }
  return out
}

type ConfigRead = {
  ui?: Lang
  content?: Lang
  settings: Required<ProjectSettings>
  problems: string[]
}

const readConfig = (text: string | undefined, path: string): ConfigRead => {
  const none: ConfigRead = { settings: { merge: {}, deploy: {} }, problems: [] }
  if (text === undefined) return none
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ...none, problems: [`${path}: not valid JSON.`] }
  }
  if (!isRecord(raw)) return { ...none, problems: [`${path}: a JSON object is expected.`] }
  const lang = languagePartial(raw.language)
  const blocks = parseProjectBlocks(raw)
  return {
    ...(lang.ui === undefined ? {} : { ui: lang.ui }),
    ...(lang.content === undefined ? {} : { content: lang.content }),
    settings: blocks.settings,
    problems: [...lang.problems, ...blocks.problems].map(p => `${path}: ${p}`),
  }
}

/**
 * The project's `.orquestrador/config.json`, already read: its languages and its merge and deploy
 * defaults. A file that is not JSON, or a value that is wrong, is named in `problems` and left out.
 */
export const parseConfig = (text: string | undefined): { languages: Languages; project: ProjectSettings; problems: string[] } => {
  const read = readConfig(text, CONFIG_PATH)
  return {
    languages: { ui: read.ui ?? DEFAULT_LANG, content: read.content ?? DEFAULT_LANG },
    project: read.settings,
    problems: read.problems,
  }
}

/** A flow field as a file writes it: plain text, or one text per language. */
export const parseLocalized = (v: unknown): Localized | undefined => {
  const text = (s: unknown) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined)
  if (typeof v === 'string') return text(v)
  if (!isRecord(v)) return undefined
  const out: Partial<Record<Lang, string>> = {}
  for (const lang of LANGS) {
    const t = text(v[lang])
    if (t !== undefined) out[lang] = t
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** The text in `lang`, else in the other language: a flow that wrote only one still reads. */
export const localize = (v: Localized | undefined, lang: Lang): string | undefined => {
  if (v === undefined || typeof v === 'string') return v
  return v[lang] ?? LANGS.map(l => v[l]).find(t => t !== undefined)
}

/** The plain text a field falls back to where no language is known: pt-BR first, the mod's own. */
export const baseText = (v: Localized | undefined): string | undefined => localize(v, DEFAULT_LANG)

/** The language as the coordinator is told it. */
export const LANG_NAME: Record<Lang, string> = { 'pt-BR': 'Brazilian Portuguese (pt-BR)', en: 'English' }

/** What the coordinator is told to write the change's own texts in. */
export const contentRule = (languages: Languages): string =>
  `Write the change's texts (proposal, design, tasks, grill questions, plan phase titles and notes, owner ` +
  `questions and recommendations) in ${LANG_NAME[languages.content]}; the panel shows them as written.`

const pt = {
  locale: 'pt-BR',
  status: {
    legend: { done: 'fechadas', running: 'em voo', blocked: 'bloqueadas', pending: 'pendentes' } as Record<PhaseStatus, string>,
    word: { done: 'fechada', running: 'em voo', blocked: 'bloqueada', pending: 'pendente' } as Record<PhaseStatus, string>,
  },
  attentionKind: {
    decision: 'Decisão',
    permission: 'Permissão',
    question: 'Pergunta',
    pr: 'PR para revisar',
    flow: 'Passo do flow',
    jira: 'Jira',
  },
  evidence: {
    missing: 'não existe',
    stub: 'esqueleto',
    recorded: 'registrada',
    green: 'check.sh verde',
    failing: 'check.sh falhou',
  } as Record<EvidenceState, string>,
  gate: {
    passed: 'passou',
    failed: 'falhou',
    pending: 'não rodou',
    stale: 'desatualizado',
    skipped: 'pulado por você',
  } as Record<GateState, string>,
  open: 'Abrir',
  openSession: 'Abrir sessão',
  openPr: 'Abrir PR',
  cancel: 'Cancelar',
  skip: 'Pular',
  confirmSkip: (gate: string) => `Confirmar pulo de ${gate}`,
  skipGate: (gate: string) => `Pular portão ${gate}`,
  session: { waiting: 'esperando você', working: 'trabalhando', idle: 'ociosa', self: 'esta sessão' },
  jira: {
    status: (s: string) => `Status: ${s}`,
    noStatus: 'Sem status: o painel ainda não leu esta issue do Jira.',
    noLink:
      'Sem link: falta o site do Jira. Reconecte o conector Atlassian (claude.ai › Configurações › Conectores) ou informe jiraSite no plano.',
    openIn: (key: string) => `Abrir ${key} no Jira ↗`,
    changeIssue: 'Issue da change',
    move: 'Mover no Jira',
    closedButOpen: (key: string, status: string | undefined) => `Fase fechada, mas ${key} segue "${status ?? 'aberta'}" no Jira`,
    doneButOpen: (key: string, status: string | undefined) =>
      `${key} já está "${status ?? 'concluída'}" no Jira, mas a fase não fechou`,
    canMove: (key: string, to: string) => `A issue ${key} pode ir para ${to}`,
    today: (from: string) => ` Hoje: "${from}".`,
    onlyOnPress: 'O Jira só muda quando você apertar o botão.',
    noTransition: (key: string, to: string) => `A issue ${key} deveria ir para ${to}, mas o Jira não oferece essa transição`,
    noneAvailable: 'nenhuma transição disponível',
    available: (options: string) => `Disponíveis: ${options}. Ajuste o campo jira do passo no flow, ou mova na mão.`,
    noConnector: (key: string, to: string) => `A issue ${key} deveria ir para ${to}, mas não consigo mexer no Jira`,
    unavailable: 'Jira: conector Atlassian indisponível nesta sessão; mostrando só as chaves.',
    noSite:
      'Jira: o conector Atlassian está logado, mas a autorização não inclui nenhum site do Jira. Reconecte-o em claude.ai › Configurações › Conectores e marque o site na tela da Atlassian.',
    couldNotRead: (keys: string) => `Jira: não consegui ler ${keys}.`,
    notAuthenticated: 'o conector Atlassian não está autenticado nesta sessão (claude.ai › Configurações › Conectores).',
    noSiteShort: 'a autorização do conector Atlassian não inclui nenhum site do Jira.',
    notMoved: (key: string, why: string) => `Não movi ${key}: ${why}`,
    noTransitionTool: 'o conector não oferece transitionJiraIssue.',
    goneTransition: 'essa transição não está mais disponível. O painel vai se atualizar.',
    moved: (key: string, to: string) => `${key} movida para ${to}.`,
    moveFailed: (key: string) => `Não consegui mover ${key} no Jira.`,
    refused: (key: string, why: string | undefined) => `O Jira recusou mover ${key}${why === undefined ? '.' : `: ${why}`}`,
  },
  openspec: {
    proposal: 'Proposta ',
    noCheckboxes: 'tasks.md sem caixas de seleção',
    percentTasks: (p: number) => `${p}% das tarefas`,
    tickedOf: (done: number, total: number) => `${done} de ${total} tarefas marcadas`,
    sections: 'Seções do tasks.md',
    sectionsSummary: (full: number, partial: number) => `${full} seções completas, ${partial} em andamento.`,
    evidence: 'Evidência',
    evidenceMissing: 'evidence.md ainda não existe.',
    evidenceFailing: (n: number, names: string, ok: number) => `Último check.sh: ${n} falha(s) — ${names}; ${ok} ok.`,
    evidenceGreen: (n: number) => `Último check.sh verde: ${n} verificações passaram.`,
    evidenceStub: 'Esqueleto: nada verificado ainda, sem resultado do check.sh.',
    evidenceRecorded: (n: number) => `${n} seção(ões) registradas, sem resumo do check.sh.`,
  },
  attention: {
    title: 'Precisa de você',
    recommendation: 'Recomendação: ',
    accept: 'Aceitar recomendação',
    onlyYourSkip: 'Só o seu pulo libera um portão: use Pular ao lado dele, no card da fase.',
    permission: (what: string) => `Permissão pendente: ${what}`,
    prOpen: (n: number) => `PR #${n} aberto`,
    escalated: (step: string, attempts: number) => `${step}: ${attempts} tentativas sem sucesso`,
    escalatedDetail: (flow: string, change: string) => `Flow ${flow} de ${change}: tentar de novo ou encerrar?`,
    flowOf: (flow: string, change: string) => `Flow ${flow} de ${change}`,
    accepted: (title: string, recommendation: string | undefined) =>
      `Decisão do dono — "${title}": aceito a recomendação (${recommendation ?? 'a sua'}). Pode seguir.`,
  },
  run: {
    phasesClosed: (done: number, total: number) => `${done} de ${total} fases fechadas`,
    wave: (n: number) => ` · onda ${n}`,
    working: 'Sessões trabalhando agora',
    liveOf: (live: number, max: number) => `${live} de no máximo ${max}`,
    atCeiling:
      'No limite: uma nova fase só começa quando uma sessão terminar o trabalho ou for arquivada, para não pesar o computador.',
    updated: (at: string) => `atualizado ${at}`,
    phasesOf: (done: number, total: number) => `${done} de ${total} fases`,
  },
  tasks: {
    title: 'Tarefas',
    waveName: (n: number) => `Onda ${n}`,
    now: 'Agora: ',
    steps: (done: number, total: number) => `passos ${done} de ${total}`,
    of: (done: number, total: number) => `${done} de ${total}`,
    after: (ids: string) => `após ${ids}`,
    closed: (n: number) => `✓ ${n} concluídas`,
    noPlan: 'Sem plano publicado: as fases aparecem aqui quando a coordenação publicar o plano.',
  },
  steps: {
    done: 'concluída',
    skipped: 'pulada',
    pending: 'pendente',
    escalated: 'no limite: você decide',
    waiting: 'esperando você',
    running: 'em andamento',
    attempt: (n: number, max: number) => ` · tentativa ${n} de ${max}`,
    finalGates: 'Checagens antes de juntar o código',
    finalGatesSummary:
      'Rodam uma vez, com o código de todas as fases já junto; enquanto não passam, o código não é juntado na branch principal.',
    ceiling: (max: number) => `Chegou ao limite de ${max} tentativas: escolha em "Precisa de você" se tenta de novo.`,
    flowDone: 'Flow concluído.',
    flowAborted: 'Flow encerrado por você.',
    legend: '⚙ automático (um script decide) · 🤖 sessão faz · ✋ você decide no painel',
  },
  self: {
    title: 'Esta sessão',
    noList: 'Sem lista de tarefas ainda',
    percentDone: (p: number) => `${p}% concluído`,
    stepsOf: (done: number, total: number) => `${done} / ${total} passos`,
    stepsOfLong: (done: number, total: number) => `${done} de ${total} passos`,
  },
  children: { title: 'Sessões filhas', others: 'Outras sessões', active: (n: number) => `${n} ativas` },
  band: {
    step: (s: string) => `passo: ${s}`,
    inFlight: (n: number) => `${n} ${n === 1 ? 'fase em voo' : 'fases em voo'}`,
    waiting: (n: number) => `${n} ${n === 1 ? 'pendência sua' : 'pendências suas'}`,
    flowDone: 'flow concluído',
    flowAborted: 'flow encerrado',
    close: 'Fechar painel',
    open: 'Abrir painel',
  },
  grill: {
    noRounds: 'Nenhuma rodada de perguntas registrada ainda.',
    rounds: (rounds: number, criteria: number) =>
      `${rounds} ${rounds === 1 ? 'rodada' : 'rodadas'} · ${criteria} ${criteria === 1 ? 'critério de aceite' : 'critérios de aceite'}`,
    open: 'Perguntas em aberto',
    answerInChat: 'Responda no chat.',
    placeholder: 'Escreva sua resposta e tecle Enter',
    send: 'Enviar',
    sendAll: (n: number) => `Enviar todas (${n})`,
    awaitingMockup: 'Aguardando a coordenação anexar o mockup.',
    mockup: 'Mockup:',
    openMockup: 'Abrir mockup',
    mockupAt: (where: string) => `Mockup: ${where}`,
    lastAdjustment: (note: string) => `Último ajuste pedido: ${note}`,
    adjustLabel: 'Pedir ajuste:',
    adjustPlaceholder: 'o que mudar no mockup',
    adjustSubmit: 'pedir ajuste',
    releaseHint: 'Aprove o plano de execução no diálogo do plan mode do app; a liberação vem só de lá.',
    refused: (feedback: string) => `Você recusou o último plano: ${feedback}`,
  },
  escalation: { retry: 'Tentar de novo', end: 'Encerrar o flow' },
  deployCi: 'Deploy do CI concluído',
  toast: {
    registered: (label: string, next: string) => `Registrado: ${label}. ${next}`,
    flowDone: 'Flow concluído.',
    flowEnded: 'Flow encerrado.',
    nextStep: (step: string) => `Próximo passo: ${step}.`,
    evidenceMissing: (change: string, step: string) => `Flow ${change}: ${step} passou, mas o evidence.md ainda não foi preenchido.`,
    deploySeen: (change: string, label: string) => `Flow ${change}: vi o deploy — ${label}.`,
    deployRefused: (change: string, step: string, why: string) => `Flow ${change}: ${step} não contou o comando — ${why}`,
    deployProgress: (change: string, step: string, word: 'failed' | 'part' | 'done') =>
      `Flow ${change}: ${step} — ${{ failed: 'falhou', part: 'parte do deploy vista', done: 'deploy concluído' }[word]}.`,
    releaseFromPlanMode: 'A liberação vem do plan mode: aprove o plano de execução no diálogo do app.',
    notRecorded: (why: string) => `Não consegui registrar: ${why}`,
    severalReleases: 'Vários flows esperam a liberação; aprovação do plano não registrada.',
    cannotOpen: (title: string) => `Não consegui abrir; procure "${title}" na barra lateral.`,
    paneFailed: 'Não consegui abrir ou fechar o painel.',
    skipNotLoaded: 'Não consegui registrar o pulo: o painel ainda não carregou a change. Tente de novo em alguns segundos.',
    skipped: (gate: string) => `Portão ${gate} pulado por decisão sua.`,
    skipFailed: 'Não consegui registrar o pulo do portão.',
    flowFailed: 'Não consegui registrar sua resposta ao flow.',
    adjustEmpty: 'Escreva o que ajustar antes de enviar.',
    answerEmpty: 'Escreva a resposta antes de enviar.',
    grillFailed: 'Não consegui registrar sua resposta ao grill.',
  },
  pending: {
    button: (n: number) => (n === 1 ? 'Abrir a sessão pendente' : `Abrir as ${n} sessões pendentes`),
    hint: (titles: readonly string[]) => `O app não abriu no turno da coordenação: ${titles.join(' · ')}.`,
    result: (opened: number, left: number, why: string | undefined) =>
      (opened === 0 ? 'Nenhuma sessão pendente abriu.' : `${opened === 1 ? 'Abriu 1 sessão pendente' : `Abriram ${opened} sessões pendentes`}.`) +
      (left === 0 ? '' : ` ${left === 1 ? 'Ficou 1' : `Ficaram ${left}`}${why === undefined ? '.' : `: ${why}`}`),
    appRefused: 'O app não aceitou abrir pelo painel; digite /orquestrador abrir no desktop.',
    appRefusedMobile: 'Pelo celular o app não abre sessões; digite /orquestrador abrir no desktop.',
    failed: 'Não consegui abrir as sessões pendentes.',
  },
  command: {
    description: 'Abre ou fecha o painel da orquestração. Subcomandos: status, aprovar, abrir, pular-portão, encerrar, ajuda',
    closed: 'Painel do Orchestrator fechado.',
    opened: 'Painel do Orchestrator aberto.',
    waiting: 'Painel pronto; amplie a janela para vê-lo.',
    workflowsDescription: 'Abre ou fecha o painel ⚙️ Workflows: ver e editar os workflows do projeto',
    workflowsClosed: 'Painel de workflows fechado.',
    workflowsOpened: 'Painel de workflows aberto.',
    workflowsWaiting: 'Painel de workflows pronto; amplie a janela para vê-lo.',
    notFromOwner: 'Esse subcomando só vale digitado por você, no prompt ou no Remote Control.',
    noFlow: 'Nenhum flow em andamento nesta sessão; use na sessão da coordenação.',
    help:
      'Subcomandos de /orquestrador:\n' +
      'status: onde o flow está\n' +
      'aprovar <saída> [nota]: responde o passo do dono (a liberação vem do plan mode)\n' +
      'abrir: abre as sessões pendentes\n' +
      'pular-portão <fase> <portão> confirmar: pula um portão\n' +
      'encerrar [motivo] confirmar: encerra o flow\n' +
      'ajuda: esta lista',
    unknown: (word: string) => `Não conheço "${word}".`,
    statusFlow: (change: string, title: string, status: string) => `Flow de ${change} (${title}): ${status}`,
    statusStep: (step: string) => `Passo: ${step}`,
    statusChoices: (outcomes: string) => `Você responde com: ${outcomes}`,
    statusGates: (gates: string) => `Portões abertos: ${gates}`,
    statusPending: (titles: string) => `Sessões pendentes: ${titles}`,
    noPending: 'Nenhuma sessão pendente para abrir.',
    skipUnknown: (phase: string, gate: string) => `Não achei o portão "${gate}" aberto na fase "${phase}".`,
    skipAsk: (phase: string, gate: string) => `Vou pular o portão ${gate} da fase ${phase}. Para confirmar, digite o mesmo comando com confirmar no fim.`,
    skipDone: (gate: string) => `Portão ${gate} pulado por você.`,
    endAsk: (change: string, step: string) =>
      `Vou encerrar o flow de ${change} no passo ${step}. Nada é arquivado. Para confirmar, digite o mesmo comando com confirmar no fim.`,
    endDone: (change: string) => `Flow de ${change} encerrado por você.`,
    approveEnd: 'Encerrar o flow pede confirmação: digite /orquestrador encerrar [motivo] confirmar.',
    endButton: 'Encerrar o flow',
    endConfirm: (change: string) => `Confirmar: encerrar o flow de ${change}`,
  },
  warning: {
    noSessions: 'Sessões filhas indisponíveis: o app não expõe a lista de sessões aqui.',
    permission: 'Permita get_session e list_sessions para o painel ver as sessões.',
    tampered: 'A ativação foi mudada fora do painel: vale "barrar" até você confirmar por aqui (Workflows, "Este projeto").',
    reminded: (count: number, last: string) => `Em "lembrar", ${count} recusa(s) viraram só aviso. Última: ${last}`,
  },
  question: 'Pergunta para você',
}

export type UiText = typeof pt

const en: UiText = {
  locale: 'en-US',
  status: {
    legend: { done: 'closed', running: 'in flight', blocked: 'blocked', pending: 'pending' },
    word: { done: 'closed', running: 'in flight', blocked: 'blocked', pending: 'pending' },
  },
  attentionKind: {
    decision: 'Decision',
    permission: 'Permission',
    question: 'Question',
    pr: 'PR to review',
    flow: 'Flow step',
    jira: 'Jira',
  },
  evidence: {
    missing: 'missing',
    stub: 'stub',
    recorded: 'recorded',
    green: 'check.sh green',
    failing: 'check.sh failed',
  },
  gate: {
    passed: 'passed',
    failed: 'failed',
    pending: 'not run',
    stale: 'stale',
    skipped: 'skipped by you',
  },
  open: 'Open',
  openSession: 'Open session',
  openPr: 'Open PR',
  cancel: 'Cancel',
  skip: 'Skip',
  confirmSkip: gate => `Confirm skipping ${gate}`,
  skipGate: gate => `Skip gate ${gate}`,
  session: { waiting: 'waiting on you', working: 'working', idle: 'idle', self: 'this session' },
  jira: {
    status: s => `Status: ${s}`,
    noStatus: 'No status: the panel has not read this Jira issue yet.',
    noLink:
      'No link: the Jira site is missing. Reconnect the Atlassian connector (claude.ai › Settings › Connectors) or set jiraSite in the plan.',
    openIn: key => `Open ${key} in Jira ↗`,
    changeIssue: 'Change issue',
    move: 'Move in Jira',
    closedButOpen: (key, status) => `Phase closed, but ${key} is still "${status ?? 'open'}" in Jira`,
    doneButOpen: (key, status) => `${key} is already "${status ?? 'done'}" in Jira, but the phase has not closed`,
    canMove: (key, to) => `Issue ${key} can move to ${to}`,
    today: from => ` Now: "${from}".`,
    onlyOnPress: 'Jira only changes when you press the button.',
    noTransition: (key, to) => `Issue ${key} should move to ${to}, but Jira offers no such transition`,
    noneAvailable: 'no transition available',
    available: options => `Available: ${options}. Adjust the step's jira field in the flow, or move it by hand.`,
    noConnector: (key, to) => `Issue ${key} should move to ${to}, but I cannot reach Jira`,
    unavailable: 'Jira: the Atlassian connector is unavailable in this session; showing the keys only.',
    noSite:
      'Jira: the Atlassian connector is signed in, but its authorization includes no Jira site. Reconnect it in claude.ai › Settings › Connectors and tick the site on the Atlassian screen.',
    couldNotRead: keys => `Jira: could not read ${keys}.`,
    notAuthenticated: 'the Atlassian connector is not authenticated in this session (claude.ai › Settings › Connectors).',
    noSiteShort: "the Atlassian connector's authorization includes no Jira site.",
    notMoved: (key, why) => `Did not move ${key}: ${why}`,
    noTransitionTool: 'the connector does not offer transitionJiraIssue.',
    goneTransition: 'that transition is no longer available. The panel will refresh.',
    moved: (key, to) => `${key} moved to ${to}.`,
    moveFailed: key => `Could not move ${key} in Jira.`,
    refused: (key, why) => `Jira refused to move ${key}${why === undefined ? '.' : `: ${why}`}`,
  },
  openspec: {
    proposal: 'Proposal ',
    noCheckboxes: 'tasks.md has no checkboxes',
    percentTasks: p => `${p}% of tasks`,
    tickedOf: (done, total) => `${done} of ${total} tasks ticked`,
    sections: 'tasks.md sections',
    sectionsSummary: (full, partial) => `${full} sections complete, ${partial} in progress.`,
    evidence: 'Evidence',
    evidenceMissing: 'evidence.md does not exist yet.',
    evidenceFailing: (n, names, ok) => `Last check.sh: ${n} failure(s) — ${names}; ${ok} ok.`,
    evidenceGreen: n => `Last check.sh green: ${n} checks passed.`,
    evidenceStub: 'Stub: nothing verified yet, no check.sh result.',
    evidenceRecorded: n => `${n} section(s) recorded, no check.sh summary.`,
  },
  attention: {
    title: 'Needs you',
    recommendation: 'Recommendation: ',
    accept: 'Accept recommendation',
    onlyYourSkip: "Only your skip releases a gate: use Skip beside it, in the phase's card.",
    permission: what => `Permission pending: ${what}`,
    prOpen: n => `PR #${n} open`,
    escalated: (step, attempts) => `${step}: ${attempts} attempts without success`,
    escalatedDetail: (flow, change) => `Flow ${flow} of ${change}: try again or end it?`,
    flowOf: (flow, change) => `Flow ${flow} of ${change}`,
    accepted: (title, recommendation) =>
      `Owner's decision — "${title}": I accept the recommendation (${recommendation ?? 'yours'}). Go ahead.`,
  },
  run: {
    phasesClosed: (done, total) => `${done} of ${total} phases closed`,
    wave: n => ` · wave ${n}`,
    working: 'Sessions working now',
    liveOf: (live, max) => `${live} of at most ${max}`,
    atCeiling: 'At the ceiling: a new phase starts only once a session finishes its work or is archived, to spare the computer.',
    updated: at => `updated ${at}`,
    phasesOf: (done, total) => `${done} of ${total} phases`,
  },
  tasks: {
    title: 'Tasks',
    waveName: n => `Wave ${n}`,
    now: 'Now: ',
    steps: (done, total) => `steps ${done} of ${total}`,
    of: (done, total) => `${done} of ${total}`,
    after: ids => `after ${ids}`,
    closed: n => `✓ ${n} done`,
    noPlan: 'No plan published: the phases show here once the coordinator publishes the plan.',
  },
  steps: {
    done: 'done',
    skipped: 'skipped',
    pending: 'pending',
    escalated: 'at the ceiling: you decide',
    waiting: 'waiting on you',
    running: 'in progress',
    attempt: (n, max) => ` · attempt ${n} of ${max}`,
    finalGates: 'Checks before merging the code',
    finalGatesSummary:
      'They run once, with the code of every phase already together; until they pass, the code is not merged into the main branch.',
    ceiling: max => `Reached the ceiling of ${max} attempts: choose in "Needs you" whether to try again.`,
    flowDone: 'Flow finished.',
    flowAborted: 'Flow ended by you.',
    legend: '⚙ automatic (a script decides) · 🤖 a session does it · ✋ you decide in the panel',
  },
  self: {
    title: 'This session',
    noList: 'No task list yet',
    percentDone: p => `${p}% done`,
    stepsOf: (done, total) => `${done} / ${total} steps`,
    stepsOfLong: (done, total) => `${done} of ${total} steps`,
  },
  children: { title: 'Child sessions', others: 'Other sessions', active: n => `${n} active` },
  band: {
    step: s => `step: ${s}`,
    inFlight: n => `${n} ${n === 1 ? 'phase in flight' : 'phases in flight'}`,
    waiting: n => `${n} ${n === 1 ? 'item for you' : 'items for you'}`,
    flowDone: 'flow finished',
    flowAborted: 'flow ended',
    close: 'Close panel',
    open: 'Open panel',
  },
  grill: {
    noRounds: 'No round of questions recorded yet.',
    rounds: (rounds, criteria) =>
      `${rounds} ${rounds === 1 ? 'round' : 'rounds'} · ${criteria} ${criteria === 1 ? 'acceptance criterion' : 'acceptance criteria'}`,
    open: 'Open questions',
    answerInChat: 'Answer in the chat.',
    placeholder: 'Write your answer and press Enter',
    send: 'Send',
    sendAll: n => `Send all (${n})`,
    awaitingMockup: 'Waiting for the coordinator to attach the mockup.',
    mockup: 'Mockup:',
    openMockup: 'Open mockup',
    mockupAt: where => `Mockup: ${where}`,
    lastAdjustment: note => `Last adjustment asked: ${note}`,
    adjustLabel: 'Ask for an adjustment:',
    adjustPlaceholder: 'what to change in the mockup',
    adjustSubmit: 'ask for adjustment',
    releaseHint: "Approve the execution plan in the app's plan mode dialog; the release comes from there only.",
    refused: feedback => `You refused the last plan: ${feedback}`,
  },
  escalation: { retry: 'Try again', end: 'End the flow' },
  deployCi: 'CI deploy finished',
  toast: {
    registered: (label, next) => `Recorded: ${label}. ${next}`,
    flowDone: 'Flow finished.',
    flowEnded: 'Flow ended.',
    nextStep: step => `Next step: ${step}.`,
    evidenceMissing: (change, step) => `Flow ${change}: ${step} passed, but evidence.md is not filled in yet.`,
    deploySeen: (change, label) => `Flow ${change}: saw the deploy — ${label}.`,
    deployRefused: (change, step, why) => `Flow ${change}: ${step} did not count the command — ${why}`,
    deployProgress: (change, step, word) =>
      `Flow ${change}: ${step} — ${{ failed: 'failed', part: 'part of the deploy seen', done: 'deploy finished' }[word]}.`,
    releaseFromPlanMode: "The release comes from plan mode: approve the execution plan in the app's dialog.",
    notRecorded: why => `Could not record: ${why}`,
    severalReleases: 'Several flows wait on the release; plan approval not recorded.',
    cannotOpen: title => `Could not open it; look for "${title}" in the sidebar.`,
    paneFailed: 'Could not open or close the panel.',
    skipNotLoaded: 'Could not record the skip: the panel has not loaded the change yet. Try again in a few seconds.',
    skipped: gate => `Gate ${gate} skipped by your decision.`,
    skipFailed: 'Could not record the gate skip.',
    flowFailed: 'Could not record your answer to the flow.',
    adjustEmpty: 'Write what to adjust before sending.',
    answerEmpty: 'Write the answer before sending.',
    grillFailed: 'Could not record your answer to the grill.',
  },
  pending: {
    button: n => (n === 1 ? 'Open the pending session' : `Open the ${n} pending sessions`),
    hint: titles => `The app did not open these in the coordination's turn: ${titles.join(' · ')}.`,
    result: (opened, left, why) =>
      (opened === 0 ? 'No pending session opened.' : `${opened === 1 ? 'Opened 1 pending session' : `Opened ${opened} pending sessions`}.`) +
      (left === 0 ? '' : ` ${left} left${why === undefined ? '.' : `: ${why}`}`),
    appRefused: 'The app did not let the panel open them; type /orquestrador abrir on the desktop.',
    appRefusedMobile: 'From the phone the app opens no sessions; type /orquestrador abrir on the desktop.',
    failed: 'Could not open the pending sessions.',
  },
  command: {
    description: 'Opens or closes the orchestration panel. Subcommands: status, aprovar, abrir, pular-portão, encerrar, ajuda',
    closed: 'Orchestrator panel closed.',
    opened: 'Orchestrator panel opened.',
    waiting: 'Panel ready; widen the window to see it.',
    workflowsDescription: "Opens or closes the ⚙️ Workflows panel: view and edit the project's workflows",
    workflowsClosed: 'Workflows panel closed.',
    workflowsOpened: 'Workflows panel opened.',
    workflowsWaiting: 'Workflows panel ready; widen the window to see it.',
    notFromOwner: 'This subcommand only counts when you type it, at the prompt or in Remote Control.',
    noFlow: 'No flow running in this session; use it in the coordination session.',
    help:
      'Subcommands of /orquestrador:\n' +
      'status: where the flow is\n' +
      "aprovar <outcome> [note]: answers the owner's step (the release comes from plan mode)\n" +
      'abrir: opens the pending sessions\n' +
      'pular-portão <phase> <gate> confirmar: skips a gate\n' +
      'encerrar [reason] confirmar: ends the flow\n' +
      'ajuda: this list',
    unknown: word => `I do not know "${word}".`,
    statusFlow: (change, title, status) => `Flow of ${change} (${title}): ${status}`,
    statusStep: step => `Step: ${step}`,
    statusChoices: outcomes => `You answer with: ${outcomes}`,
    statusGates: gates => `Open gates: ${gates}`,
    statusPending: titles => `Pending sessions: ${titles}`,
    noPending: 'No pending session to open.',
    skipUnknown: (phase, gate) => `Could not find the gate "${gate}" open in phase "${phase}".`,
    skipAsk: (phase, gate) => `I will skip gate ${gate} of phase ${phase}. To confirm, type the same command with confirmar at the end.`,
    skipDone: gate => `Gate ${gate} skipped by you.`,
    endAsk: (change, step) =>
      `I will end the flow of ${change} at step ${step}. Nothing is archived. To confirm, type the same command with confirmar at the end.`,
    endDone: change => `Flow of ${change} ended by you.`,
    approveEnd: 'Ending the flow asks for confirmation: type /orquestrador encerrar [reason] confirmar.',
    endButton: 'End the flow',
    endConfirm: change => `Confirm: end the flow of ${change}`,
  },
  warning: {
    noSessions: 'Child sessions unavailable: the app does not expose the session list here.',
    permission: 'Allow get_session and list_sessions so the panel can see the sessions.',
    tampered: 'The activation was changed outside the panel: "block" applies until you confirm it here (Workflows, "Este projeto").',
    reminded: (count: number, last: string) => `In "remind", ${count} refusal(s) became a warning only. Last: ${last}`,
  },
  question: 'A question for you',
}

const TEXT: Record<Lang, UiText> = { 'pt-BR': pt, en }

/** The panel's words in `lang`; no language, the mod's own pt-BR. */
export const uiText = (lang: Lang | undefined): UiText => TEXT[lang ?? DEFAULT_LANG]
