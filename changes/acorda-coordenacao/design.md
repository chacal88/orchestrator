# Design: o mod acorda a coordenação

## O sinal de fim de turno

O engine não tem evento de fim de turno de outra sessão. O que o mod já lê é a linha de `list_sessions`/`get_session`
(`parseSessionRows` em `orquestrador/hooks/model.ts`): `isRunning`, `lastActivityAt`, `isArchived` e `startedBy`. O
refresh periódico (`$.clock.every(REFRESH_MS)`, 15 s, em `register.tsx`) já chama `loadSessions` a cada volta.

**Recomendação:** usar essas linhas, num módulo puro novo, `orquestrador/hooks/wake.ts`, com uma função
`childStops(seen, rows, now)` que devolve `{ seen, stopped }` e é testável sem o engine.

- `seen` fica no `$.state` (chave `autowake-seen`), por `sessionId`: `{ running: boolean; activity?: string; told?: string }`.
- Uma filha conta como "terminou o turno" quando agora `isRunning` é `false` e:
  - no refresh anterior estava `isRunning: true`; ou
  - o `lastActivityAt` mudou desde o refresh anterior. Isso cobre o turno curto que começa e termina entre dois
    refreshes.
- A **primeira vez** que o mod vê uma sessão só grava a linha, sem avisar. Por isso ligar a opção ou reiniciar o app
  não avisa paradas antigas.
- **Uma vez só:** `told` guarda o `lastActivityAt` (ou, sem ele, o horário do refresh) da parada já avisada. A mesma
  parada vista de novo tem o mesmo `told` e não gera aviso.
- Com a opção desligada, o mod não lê nem grava `seen`. Ao ligar, a primeira volta é só de linha de base.

## Quais filhas contam

`wake.ts` recebe as linhas já filtradas por `eligibleChildren(run, flow, self, children)`:

- o flow desta coordenação está `running` (`ownsFlow` e `status === 'running'`);
- a linha não está arquivada;
- `startedBy === self.sessionId`, **ou** a sessão casa com uma fase do plano publicado (`phaseViews`, o mesmo casamento
  do painel);
- não é a própria coordenação.

As sessões do grupo da sidebar que o dono abriu à mão, sem `startedBy` da coordenação e fora do plano, ficam de fora.

## Só a coordenação manda

`ownsFlow` aceita qualquer sessão cuja pasta esteja na pasta da coordenação ou abaixo dela, e isso inclui as filhas com
`use_worktree: false` e as worktrees em `.claude/worktrees/`. Por isso o `FlowState` ganha `coordinatorSession?: string`:

- o `flow start` grava o id da sessão que chamou (`get_session self`);
- o `flow report`, chamado só pela coordenação, preenche o campo quando ele falta, para os flows que já estavam em
  andamento antes da 0.13.0;
- o aviso só sai quando `self.sessionId === state.coordinatorSession`. Flow sem o campo não avisa.

O arquivo do flow fica no registro do mod (`~/.claude/orquestrador/flows/`), que o modelo não escreve.

## Coordenação ocupada

Não dá para confiar no que o `$.prompt.submit` faz com a sessão no meio de um turno. A documentação de tipos não diz se
ele enfileira, e o executor confere e registra na evidência. **Recomendação:** não depender disso.

- Quando `self.isRunning` é `true`, as paradas vistas vão para `pending` no `$.state` (chave `autowake-pending`, lista
  de títulos sem repetição) e nada é enviado.
- No primeiro refresh com a coordenação parada, sai **uma** mensagem com tudo o que estava pendente e o `pending` é
  limpo.

Texto, em pt-BR fixo, no estilo do `wakePrompt`:

- uma sessão: `Painel: a sessão "<título>" terminou o turno. Siga o flow.`
- várias: `Painel: as sessões "<a>", "<b>" terminaram o turno. Siga o flow.`

O título usa `name ?? title`, como o resto do painel.

## Sem `asUser`, com uma reserva

Como a mensagem do clique, esta vai em nome do mod (`$.prompt.submit({ text })`). É o mod contando um fato que a
coordenação confere com `flow status`, não palavras do dono. A proposta assume, como no clique, que o app trata esse
turno como turno do dono para o `user_asked`. O critério 11 confere isso no app real. Se o app recusar, a mensagem passa
a `asUser: true` com o texto deixando claro que é o painel, por exemplo
`Painel (opção "Seguir o flow sem clique" ligada por mim): …`. A troca fica numa constante só.

## Onde a opção se grava

| Opção | Prós | Contras |
| --- | --- | --- |
| `.orquestrador/config.json` (versionado) | Fica junto do resto da configuração | Liga para todo mundo que clonar; abrir sessões em nome de alguém é consentimento pessoal, não do projeto |
| `.claude/settings.local.json` (como a marca da ativação) | Local ao clone | O modelo pode editar o arquivo; a ativação precisou de um registro à parte (`activation.json`) e do aviso "mudada fora do painel" só para isso |
| `~/.claude/orquestrador/autowake.json`, por raiz do repositório | Local à máquina; o modelo não escreve ali (`touchesGateFiles`); vale na hora, sem reiniciar | Não aparece no repositório (é o desejado) |

**Recomendação:** o registro do mod, `autowake.json`, com `{ "<raiz>": { "on": true, "at": <ms> } }`, raiz igual à da
ativação (`projectRoot`, o checkout principal). É o mesmo padrão do `activation.json` (`recordLevel`/`recordedLevel` em
`activation.ts`): arquivo ausente é desligado, e arquivo ilegível é desligado também. Na dúvida, a opção fica desligada,
que é o lado seguro aqui, ao contrário da ativação, onde o lado seguro é "barrar". Desativar o orquestrador no clone não
apaga a opção, mas sem ativação ela não vale.

## Grupo da sidebar (fase 1)

**Qual change.** `currentChange($, root)`: a change do flow `running` que esta sessão coordena (`ownsFlow`, e
`coordinatorSession === self` quando o campo existe). Sem flow `running`, cai no `loadRun`, como hoje, para quem
publica plano sem flow. O `plano` publicado continua agrupando pela própria change dele.

**Quais filhas.** A linha de `list_sessions` não traz a data de criação, então "iniciada depois do `flow start`" não é
um critério que o mod consiga ler. **Recomendação:** registrar no próprio flow. Depois de cada `start_session` aceito, as
filhas da coordenação (`startedBy === self`, não arquivadas) que não estão no `sessions` de nenhum flow desta
coordenação entram no `sessions` do flow corrente. O executor confere se o resultado do `start_session` traz o id da
sessão nova e, se trouxer, usa esse id. As filhas que já existiam antes da 0.13.0 não entram em flow nenhum e não são
movidas. O `groupFamily` move `self` (se preciso) mais as filhas do `sessions` do flow e as que casam com uma fase do
plano dessa change.

**O arrasto do app.** Mover `self` leva junto as filhas aninhadas. Por isso, depois do `move_sessions`, o mod devolve ao
`groupId` de cada flow antigo as filhas não arquivadas do `sessions` dele que vieram junto. Como prevenção, a skill
manda arquivar as filhas da change encerrada antes do `flow start` seguinte, e a resposta do `flow start` conta as que
sobraram. O mod não arquiva nada sozinho: arquivar passa pela recusa de portões que já existe (`refuseArchive`).

**O grupo pelo id.** Procurar só pelo nome falha quando o dono renomeia o grupo ou quando o `list_groups` falha. O
`groupId` gravado no flow é a referência. O nome serve só para achar ou criar o grupo na primeira vez. Antes de criar,
o mod exige uma lista legível: com `isError`, ou com um texto que não é um array JSON, ele loga e não cria.
