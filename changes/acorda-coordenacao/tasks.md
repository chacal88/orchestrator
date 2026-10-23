## 1. Filhas no grupo da change certa

Acréscimo do dono, pedido durante o planejamento: as filhas estão abrindo no grupo da change anterior (ver
`proposal.md`, "Grupo da sidebar", e `design.md`). Vem antes da fase 2 e é serializada com ela, porque as duas mexem em
`register.tsx` e em `types/index.d.ts`. Portões: `claude plugin test orquestrador` (testes) e `tsc` (tipos). Arquivos:
`register.tsx`, `model.ts`, `flow.ts`, `types/index.d.ts` e os testes.

- [x] 1.1 `FlowState` ganha `coordinatorSession?: string`, `groupId?: string` e `sessions?: string[]` em
      `types/index.d.ts`. O `flow start` grava `coordinatorSession` com o id da sessão que chamou (`get_session self`),
      e o `flow report` preenche o campo quando ele falta (flows de antes da 0.13.0). Verificação: teste em
      `flow-harness.test.ts` mostra o campo gravado no start e preenchido no report de um flow antigo — cx: simple
- [x] 1.2 Qual change agrupar: uma função `currentChange($, root)` devolve a change do flow `running` desta coordenação
      (`ownsFlow`, `status === 'running'`, e `coordinatorSession` igual a `self` quando o campo existe). Só sem flow
      `running` ela cai no plano publicado mais recente (`loadRun`). O gancho do `start_session` (~linha 1829) passa a
      usar essa função no lugar de `loadRun`. Verificação: tarefa 1.6 — cx: simple
- [x] 1.3 Quais filhas são da change: depois de cada `start_session` aceito, o mod lê as filhas da coordenação
      (`startedBy === self`, não arquivadas). As que ainda não estão no `sessions` de nenhum flow desta coordenação
      entram no `sessions` do flow corrente (pegar também o id do resultado do `start_session`, se ele vier). O
      `groupFamily` move para o grupo da change só essas sessões e as que casam com uma fase do plano dela, nunca todas
      as filhas da coordenação. Verificação: tarefa 1.6 — cx: medium
- [x] 1.4 O grupo da change pelo id: o `groupFamily` usa o `groupId` gravado no flow, quando ele existe e ainda aparece
      no `list_groups`. Senão procura pelo nome e grava o id que achou ou criou. O `list_groups` que volta com erro
      (`isError`, ou "nenhuma janela reportou os grupos") é "não sei": o mod **não cria** grupo nesse caso, loga e
      tenta no próximo gancho. O `create_group` só roda quando a lista veio legível e sem o nome. Verificação: teste
      em `model.test.ts` para `findGroupId` com texto de erro e teste de harness com `list_groups` falhando, sem
      `create_group` chamado — cx: simple
- [x] 1.5 A coordenação arrasta as filhas antigas: o app move as filhas aninhadas junto com a mãe. Depois de mover
      `self`, o `groupFamily` devolve ao grupo da própria change (o `groupId` gravado no flow dela) as filhas não
      arquivadas que estão no `sessions` de outro flow desta coordenação. Filha antiga sem grupo conhecido fica onde
      o app a deixou. O `flow start` diz, no texto da resposta, quantas filhas não arquivadas de outra change a
      coordenação ainda tem e manda arquivá-las antes, se os portões delas passaram. Verificação: tarefa 1.6 — cx: medium
- [x] 1.6 Testes de harness num arquivo novo, `orquestrador/tests/grupos-harness.test.ts`, no molde de
      `flow-harness.test.ts`, com `list_sessions`, `list_groups`, `create_group` e `move_sessions` falsos que gravam as
      chamadas:
      - com um plano publicado da change A e o flow da change B `running`, a filha nova vai para "🪪 B";
      - as filhas da change A não entram no `move_sessions` para "🪪 B";
      - depois de mover `self`, as filhas de A voltam ao grupo de A;
      - `list_groups` com erro não cria grupo;
      - o grupo já existente com o nome da change é reaproveitado, sem `create_group`.

      Verificação: `claude plugin test orquestrador` sai com 0 — cx: medium

## 2. O mod acorda a coordenação

Fase de código do mod. Vem depois da fase 1, porque mexe nos mesmos `register.tsx` e `types/index.d.ts` e usa o
`coordinatorSession` que a fase 1 grava. Os portões são `claude plugin test orquestrador` (testes) e `tsc` (tipos),
os mesmos do flow `rapido`. Arquivos: `orquestrador/hooks/wake.ts` (novo), `register.tsx`, `activation.ts`,
`workflows-pane.tsx`, `i18n-workflows.ts` e os testes. Não mexe nos arquivos da fase 3.

- [x] 2.1 Registro da opção em `activation.ts` (ou num `autowake.ts` vizinho, se ficar mais limpo):
      `readAutowake($)` e `writeAutowake($, on)` em `~/.claude/orquestrador/autowake.json`, por `projectRoot`, no
      padrão de `recordLevel`/`recordedLevel`. Arquivo ausente ou ilegível vale como desligado. Verificação: testes em
      `activation.test.ts` para ausente, ligado, desligado e JSON quebrado (desligado) — cx: simple
- [x] 2.2 `hooks/wake.ts`, puro: `eligibleChildren(run, self, children)` (não arquivada, `startedBy` da coordenação ou
      fase do plano via `phaseViews`, não é a própria coordenação), `childStops(seen, rows, now)` (primeira vista só
      grava a linha; parada = `isRunning` era `true` ou `lastActivityAt` mudou, e agora `false`; `told` evita repetir) e
      `stopPrompt(titles)` com os dois textos do `design.md`. Verificação: `wake.test.ts` cobre primeira vista,
      running→parada, turno curto por `lastActivityAt`, a mesma parada duas vezes, arquivada, fora do plano e os
      textos de uma e de várias sessões — cx: medium
- [x] 2.3 `register.tsx`: no `refresh`, depois de `loadSessions`, com o clone ativo, a opção ligada, o flow
      `running` e `self.sessionId === state.coordinatorSession`, roda `childStops` com `seen` do `$.state`
      (`autowake-seen`). Se a coordenação está trabalhando (`self.isRunning`), junta os títulos em `autowake-pending`;
      parada, manda um `$.prompt.submit({ text: stopPrompt(...) })` só, sem `asUser`, e limpa o pendente. Opção
      desligada não lê nem grava `seen`. Falha aqui vai para `$.ui.log`, nunca derruba o refresh. Verificação: tarefa
      2.5 — cx: medium
- [x] 2.4 Painel ⚙️ (`workflows-pane.tsx`), cartão "Este projeto", só com o clone ativo: linha "Seguir o flow sem
      clique" com o estado e um botão "Ligar"/"Desligar", e o texto de ajuda, por exemplo: "Ligada, o painel avisa a
      coordenação cada vez que uma sessão do flow termina. Assim ela abre as próximas sessões em seu nome, sem cartão
      para clicar. Fica só nesta máquina." Textos em pt-BR e en em `i18n-workflows.ts`. Verificação: teste em
      `project-pane.test.ts` (ou `activation-pane.test.ts`) mostra a opção desligada por padrão, escondida sem
      ativação, e que o botão grava `autowake.json` — cx: simple
- [x] 2.5 Testes de harness num arquivo novo, `orquestrador/tests/autowake-harness.test.ts`, no molde de
      `flow-harness.test.ts` (mundo em memória, `prompts` capturados), avançando o relógio entre dois refreshes e
      trocando a resposta de `list_sessions`:
      - filha termina com a opção ligada → um aviso com o título;
      - opção desligada → nenhum;
      - a mesma parada vista duas vezes → um aviso só;
      - sessão fora do plano → nenhum; sessão arquivada → nenhum;
      - o mod numa filha da mesma pasta (`self` ≠ `coordinatorSession`) → nenhum;
      - coordenação trabalhando → nenhum; no refresh seguinte, parada → um aviso com as duas filhas que pararam.

      Verificação: `claude plugin test orquestrador` sai com 0 — cx: medium
- [x] 2.6 Roteiro de verificação no app real, a rodar depois do deploy da 0.13.0. O app roda o mod instalado pelo
      marketplace (0.12.3), não esta branch, e a instalação do dono não é mexida; por isso o aviso não pode ser visto ao
      vivo antes do lançamento. O roteiro fica no `evidence.md` (fase 2): ligar a opção, uma filha termina, o aviso
      chega, a coordenação abre a próxima com `user_asked` sem cartão; o que observar com a coordenação ocupada; e o
      plano B com `asUser: true` (`STOP_AS_USER` em `hooks/wake.ts`). Verificação: a seção "Roteiro no app real" no
      `evidence.md` — cx: simple

## 3. Skill, README e versão

Pode correr em paralelo com as fases 1 e 2, porque mexe só em `orquestrador/skills/change-orchestrator/SKILL.md`,
`README.md` e `orquestrador/.claude-plugin/plugin.json`. Portões: `claude plugin test orquestrador` e `tsc`.

- [x] 3.1 Skill: no bloco do start recusado e da corrente do `user_asked` (§ "Start recusado", perto da linha 73) e no
      § 5.2 "Puxar", um parágrafo "Com 'Seguir o flow sem clique' ligada": a mensagem `Painel: a sessão "…" terminou o
      turno. Siga o flow.` é turno do dono, então nele vale o `user_asked`; a coordenação confere `flow status` e abre o
      próximo passo ou fase; pode terminar o turno com `ScheduleWakeup` para esperar CI, sabendo que o tick não abre
      sessão (propõe cartão, como hoje) e que o próximo aviso do painel refaz a corrente; o aviso pode vir junto com o
      `<side-sessions-event>`, e o segundo termina sem trabalho. Com a opção desligada, o texto atual fica como está.
      No início de uma change nova numa coordenação que já conduziu outra: arquivar antes do `flow start` as filhas
      não arquivadas da change encerrada (com os portões passados), porque o app arrasta as filhas aninhadas quando
      a coordenação muda de grupo; o `flow start` avisa quantas sobraram.
      Verificação: `grep -n "Seguir o flow sem clique" orquestrador/skills/change-orchestrator/SKILL.md` acha o
      parágrafo e `grep -n "arrasta"` acha a regra do início de change — cx: simple
- [x] 3.2 README: uma linha na lista de recursos sobre a opção "Seguir o flow sem clique" do cartão "Este projeto"
      (desligada por padrão, só nesta máquina, abre as sessões em nome do dono). Verificação: `grep -n "Seguir o flow sem
      clique" README.md` — cx: simple
- [x] 3.3 Versão 0.13.0 em `orquestrador/.claude-plugin/plugin.json`. Verificação: `claude plugin test orquestrador`
      e `tsc` saem com 0 — cx: simple

## 4. Achados da revisão

A revisão de código rejeitou a change com 3 achados bloqueantes, 3 importantes e 2 detalhes. Esta fase os corrige
antes de uma nova revisão. Portões: `claude plugin test orquestrador` (testes) e `tsc` (tipos). Arquivos:
`hooks/wake.ts`, `hooks/register.tsx`, a skill, o `design.md`, o `evidence.md` e os testes. A versão fica em 0.13.0.

- [x] 4.1 Bloqueante, injeção no turno do dono (`wake.ts`, `stopPrompt`): o título da sessão não entra mais cru no
      aviso, que o app trata como turno do dono. O aviso leva o id `local_…` da filha (só os caracteres de um id) e a
      coordenação confere o resto no `flow status`. Escolha justificada no `evidence.md`; `design.md` e skill com o
      texto novo. Verificação: teste em `wake.test.ts` com um título com aspas, `\n` e texto longo, que não aparece
      no aviso — cx: simple
- [x] 4.2 Bloqueante, gravação velha do flow (`register.tsx`, `groupFamily`): o agrupamento relê o flow logo antes de
      gravar e junta só `sessions` e `groupId`. Verificação: teste de harness em que um `report` grava o flow entre a
      leitura e a gravação do agrupamento e não se perde — cx: medium
- [x] 4.3 Bloqueante, grupo duplicado por corrida (`groupQuietly`): o agrupamento corre numa promessa do módulo, uma
      chamada por vez. Verificação: teste de harness com dois `start_session` simultâneos e um `create_group` só — cx: simple
- [x] 4.4 Filhas de outro flow avisam (`wake.ts`, `eligibleChildren`, e `wakeCoordination`): contam só as sessões do
      `sessions` do flow corrente e as fases do plano dele, nunca as `earlier` nem as `sessions` de outro flow.
      Verificação: teste em `wake.test.ts` e de harness em que uma filha `earlier` que para não gera aviso — cx: simple
- [x] 4.5 Aviso em dobro com refreshes sobrepostos (`wakeCoordination`): trava em memória no módulo. Verificação:
      teste de harness com dois refreshes simultâneos e um aviso só — cx: simple
- [x] 4.6 Freio contra laço (`wakeCoordination`): o mod guarda o `seq` do flow no último aviso; depois de 3 avisos sem
      o `seq` mudar, para de avisar e mostra ao dono um toast dizendo que o flow parece parado. Roteiro 2.6 do
      `evidence.md` ganha "conferir se mover uma filha de grupo muda o `lastActivityAt`". Verificação: teste de
      harness com 4 paradas no mesmo `seq` (3 avisos e o toast) e um aviso de novo depois de um `report` — cx: medium
- [x] 4.7 Detalhe (`openChildren`): um `list_sessions` com erro é "não sei"; o `flow start` não grava `earlier` e o
      agrupamento adota no flow só o id que o `start_session` devolveu. Verificação: teste de harness — cx: simple
- [x] 4.8 Detalhe (`wakeCoordination`): com o clone inativo, o mod limpa também o `autowake-seen` (e o pendente).
      Verificação: teste de harness em que uma parada de quando o clone estava inativo não é avisada ao reativar — cx: simple
