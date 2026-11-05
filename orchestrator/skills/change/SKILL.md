---
name: change
description: Orquestra uma change (OpenSpec ou qualquer lista de tarefas) do entendimento ao arquivamento, seguindo o flow declarado no mod orchestrator (grill → mockup → plano → validação → revisão → liberação do dono → fases → revisão de código → checagem → PR → QA → produção → arquivo). Pergunta ao mod qual é o próximo passo, dispara uma sessão por fase em ondas, agrupa na sidebar com ícones, acompanha as sessões e resolve sozinho tudo que não exige o dono — pergunta ao usuário só o que é realmente dele. Use quando o usuário pedir "orquestrar", "fan-out", "dividir a change em sessões", "spawn tasks da change", ou ao rodar apply de uma change com mais de ~8 tarefas.
---

# Orquestrador de change

Você é o **coordenador**: não implementa fases, despacha e destrava. **Quem decide o
próximo passo é o flow do mod**, não você. O usuário só é chamado para o que é dele
(ver § 7).

Ferramentas do mod (carregue via ToolSearch): `mcp__orchestrator__flow` e
`mcp__orchestrator__plan`. Sem o mod carregado, avise o dono e pare; não improvise o flow.

## 1. Começar o flow

0. **Clone inativo.** O mod só trabalha num clone que o dono ativou (ou onde já há um flow em
   andamento). Se o painel ⚙️ mostra "inativo neste clone" (ou o mod parece quieto: sem
   faixa, sem regras do flow no início da sessão), **peça ao dono para ativar no painel ⚙️**
   ("Este projeto" → "Ativar neste clone", nível "barrar" ou "lembrar") **antes de
   orquestrar**, e espere. Nunca grave o `.claude/settings.local.json` você mesma.

1. **Antes do `flow start`, mostre sempre ao dono os workflows de `flow list`**: de cada um,
   título, descrição e passos, numa pergunta só, com a sua recomendação. Nunca escolha
   sozinha, nem quando só há um. Os do projeto (`.orchestrator/flows/`) valem mais que os
   padrões. Para a recomendação:
   - `completo` — feature, tela nova, mudança grande, arquitetural ou irreversível.
   - `rapido` — correção pequena e reversível (sem grill, mockup nem liberação).
   - Na dúvida, recomende `completo`.
2. `flow start {change, flow, visual, changePath}` — `visual: true` quando a change
   altera o que o usuário vê (liga o passo de mockup).
3. Sidebar: `list_groups`; reuse o grupo da change se existir, senão `create_group`
   `🪪 <change-id>`. Mova a coordenadora (`self`) e renomeie-a `🧭 <curto>: coordenação`.

## 2. O laço do coordenador

A cada acionamento (mensagem de fase, fim de sessão, clique do dono, tick):

1. `flow status` → passo atual e **quem responde** (sessão, automático ou dono).
2. Aja **só** sobre esse passo, conforme o tipo:
   - **Sessão** → rode o passo num **subagente** com o agente do passo (ver abaixo); quando
     ele responder, `flow report {step, outcome, note}` com um dos resultados que o passo declara.
     Você não faz o passo.
   - **Automático** (`validar` = `openspec validate`, `checagem` = `scripts/check.sh` com
     `evidence.md` preenchido, `arquivar` = `openspec archive`) → rode o comando você mesma,
     nesta sessão; o mod observa o código de saída e avança. **Nunca** informe esse passo.
   - **Dono** → **nunca** responda. Aponte o botão no painel (`/orchestrator:panel`) e espere:
     termine o turno com `ScheduleWakeup` longo (1200 s ou mais) como reserva e, quando ele
     disparar, confira `flow status`.
3. O mod recusa pular etapa ou informar passo que não é o atual; diante de uma recusa,
   leia o motivo e corrija a causa, não contorne.

**Agente do passo.** Cada passo de sessão (e o laço `executar`) nomeia um agente, com
`model` e `effort`. A resposta do `flow status` diz a chamada exata. O agente do plugin é o
`subagent_type` `orchestrator:<nome>`; o agente do projeto em `.orchestrator/agents/<nome>.md`
**vence**: o corpo dele vai no começo do prompt. O modelo e o esforço do passo valem (`model`
com o apelido `opus`/`sonnet`/`haiku`, `effort`), no lugar da tabela do § 4.

**Um subagente por passo de sessão e por fase, nunca uma sessão do app.** O app só abre sessão
num turno que o dono digitou: no clique do painel, num aviso de outra sessão, num tick ou pelo
celular, ele recusa. Por isso cada passo e cada fase roda como subagente desta coordenação, com
a ferramenta `Agent`, que abre em qualquer turno e sem nada do dono. Nunca use `start_session`
para um passo ou fase, nunca peça ao dono para abrir sessão, e nunca faça o passo você mesma.

- **Passo de sessão** (planejar, revisões, PR, publicar): `Agent` com `subagent_type` do passo,
  `name: "passo-<id do passo>"`, o modelo e o esforço do passo e um prompt autocontido. Pode ser
  em primeiro plano; em segundo plano (`run_in_background: true`) quando houver outra coisa a
  fazer. Quando ele responde, `flow report`.
- **Fase do `executar`**: `Agent` com `subagent_type` do passo (`orchestrator:executor`),
  `name: "fase-<id da fase>"` (o id do plano, ex. `fase-4.6`), `isolation: "worktree"`,
  `run_in_background: true`. O mod liga o subagente à fase pelo nome: os portões que ele roda
  contam para a fase, não para a coordenação.
- **Fica com a coordenação:** a escolha do flow, as rodadas do grill, o mockup, a liberação no
  plan mode, `flow report`/`close`/`round`/`note`, os comandos dos passos automáticos e o merge
  da branch de cada fase.
- O subagente em segundo plano avisa sozinho quando termina: o motor acorda a coordenação com o
  resultado. Não precisa de `wake_when_done`, de `SendMessage`, de `flow pending` nem de botão.

**Passos do dono por texto.** Além dos botões, o dono segue em frente com
`/orchestrator:approve [nota]` (igual ao clique), pede ajustes com `/orchestrator:reject [nota]`
e encerra o flow com `/orchestrator:end [motivo]`. Não existe `liberar`: a liberação segue pelo plan mode. Só o dono digitando vale;
sessão nenhuma usa esses comandos no lugar dele.

**Clique do dono acorda você.** Quando o dono aperta um botão do flow e o próximo passo é
seu (sessão, automático, `executar`, ou o mockup de novo depois de "Pedir ajustes"), o painel
manda uma mensagem em nome do mod, por exemplo `Painel: o dono apertou "Aprovar mockup".
Próximo passo: planejar (Planejar OpenSpec). Siga o flow.` Confira `flow status` e siga, sem
esperar o dono escrever. Se o próximo passo também é do dono, ou o flow acabou, nada chega.

**Com "Seguir o flow sem clique" ligada** (opção do cartão "Este projeto", painel ⚙️). Vale só
para sessões filhas de flows antigos, que ainda rodam como sessões do app. Um subagente não
precisa dela: o motor já acorda a coordenação quando ele termina.

**Começando uma change nova numa coordenação que já conduziu outra.** Antes do `flow start`,
arquive as filhas não arquivadas da change encerrada (com os portões passados). O app arrasta
as filhas aninhadas quando a coordenação muda de grupo, e elas voltariam misturadas. O
`flow start` avisa quantas sobraram.

**Escalada:** depois de 3 tentativas num passo, o mod passa a decisão ao dono
("tentar de novo" ou "encerrar"). Não tente de novo por conta própria; leve o
diagnóstico pronto ao dono.

## 3. Antes da execução (flow completo)

1. **Grill** (dono). Rodadas de perguntas sobre escopo, efeito final, bordas e regras.
   Pergunte ao dono, e registre cada rodada com `flow round {questions:[{question,
   answer, criterion}]}` (`amend: true` completa as respostas da última rodada). As
   respostas viram critérios de aceite (`grill.md`). Quem fecha é o dono, no botão
   **"Entendimento fechado"**. Pergunta aberta vai **no chat, numerada e sem botão de
   resposta**: um botão do wrap_up envia a mensagem no clique e o dono não consegue
   escrever. Botão só para escolha fechada (sim/não, A/B).
2. **Mockup** (dono, só se `visual`). Produza o mockup e anexe com `flow mockup
   {artifact}`. O dono clica **"Aprovar mockup"** ou **"Pedir ajustes"** (com nota): no
   ajuste, refaça e anexe de novo. Depois do "Aprovar mockup" o próximo passo é **sempre**
   `planejar`, mesmo que os artefatos de planejamento já existam.
3. **Planejar** (sessão). O subagente `passo-planejar` escreve proposta, design e tarefas do OpenSpec (no
   `rapido`, só proposta e tarefas); a coordenação reporta `flow report planejar pronto`. Se já
   existem, o subagente os reconcilia com o grill e o mockup aprovado antes do `pronto`.
4. **Validar** (automático): rode `openspec validate` nesta sessão.
5. **Revisão do plano** (sessão): o subagente `passo-revisao-plano` com os revisores contra ADRs e specs; a
   coordenação reporta `flow report revisao-plano aprovado|rejeitado`.
6. **Liberação do dono**: vem do **plan mode** do app. Monte as ondas (§ 4), escreva o
   plano de execução e chame `ExitPlanMode`; o dono aprova no diálogo nativo e o mod
   registra a liberação. Se ele recusar, ajuste o plano e chame de novo. Não há botão
   de liberar no painel.

## 4. Execução: fases em ondas (passo `executar`)

1. **Ondas.** Leia `tasks.md`, design e regras do projeto. Onda N só contém o que não
   depende de nada fora das ondas anteriores; tarefa atrás de portão vai na onda
   seguinte; fases que mexem nos mesmos arquivos são serializadas.
2. **Teto: no máximo 3 subagentes de fase rodando ao mesmo tempo.** O mod recusa o 4º em
   "barrar" (avisa em "lembrar"). Fase pesada (bancada, suíte inteira, `turbo --force`) conta
   como 2: abra menos. A vaga abre quando um deles termina, e o motor avisa.
3. **Disparar.** Um subagente por fase da onda corrente, no mesmo turno em que a onda fica
   livre, seja qual for o turno: `Agent` com `name: "fase-<id>"`, `isolation: "worktree"`,
   `run_in_background: true`, `subagent_type` do passo. Cada um trabalha na própria worktree,
   então duas fases nunca escrevem nos mesmos arquivos. O `description` leva o ícone e o nome
   curto da fase (`🛠️ API de eventos`).

   | Ícone | Natureza                          |
   | ----- | --------------------------------- |
   | 🔬    | bancada / medição em equipamento  |
   | 📖    | transcrição / documentação nova   |
   | 🧹    | registro vencido / limpeza de doc |
   | 🛠️    | código de produção                |
   | 🧪    | teste / homologação               |
   | 🏷️    | declaração / catálogo / config    |
   | ⚖️    | banca adversarial / validação     |
   | 🧭    | coordenação                       |

   **Agente, modelo e esforço por fase.** Cada subagente de fase usa o agente do passo
   `executar` (`orchestrator:executor`, ou o do projeto no começo do prompt). Modelo e esforço
   do passo valem quando declarados; a tabela abaixo é o padrão quando o passo não os traz
   (`model` e `effort` da chamada `Agent`). O que decide o resto usa o mais forte; o custo cai com a complexidade (`cx:` do
   `tasks.md`).

   | Natureza                                                  | Modelo                                    | Esforço |
   | --------------------------------------------------------- | ----------------------------------------- | ------- |
   | Planejamento, design, portão, banca adversarial ⚖️          | `claude-opus-5-5`                         | high    |
   | Código complexo 🛠️, teste com mutação 🧪 (`cx: complex`)     | `claude-opus-5-5`                         | high    |
   | Código/teste moderado, declaração 🏷️ (`cx: moderate`)       | `claude-sonnet-5-5`                       | medium  |
   | Bancada 🔬 (rito mecânico, evidência literal)              | `claude-sonnet-5-5`                       | medium  |
   | Docs 📖 🧹, tarefas `cx: simple`                            | `claude-sonnet-5-5` ou `claude-haiku-5-5` | low     |

   O prompt do subagente é **autocontido**: change e caminho, o que ler antes, SOMENTE as
   tarefas N.N, regras/ADRs aplicáveis, o que NÃO fazer (fases futuras), portões que ele
   roda, critério de pronto (checkbox só com evidência real, trabalho commitado na branch da
   worktree) e a mensagem final (§ 5).
4. **Portões.** Declare no plano os `gates` de cada fase (`testes`, `lint`, `openspec`,
   `visual`, `regras`) e os `finalGates` da change (normalmente `check`). O mod observa
   as sessões rodarem e impõe os portões (publicar `done`, arquivar, `gh pr merge`); só o
   dono pula um portão, pelo painel. No prompt da fase, peça cada portão como comando
   próprio, que o código de saída decida: nada de `| tail`, `; echo $?` ou `|| true`
   depois dele (junte com `&&`). Rode o portão pelo nome do
   comando, com o binário no PATH (ex. `export PATH=… && command claude plugin test …`), nunca
   por caminho entre aspas: o mod reconhece o portão pelo nome. Para pedir ao dono que libere um portão, use
   `ownerQuestions` com `gate: {phase, gate}` (`phase: "final"` para os `finalGates`): o
   painel oferece o pulo na própria pergunta, e "Aceitar" nunca pula portão.
   **Não peça pulo de portão porque o mod não viu o portão.** Faça o portão de um jeito que ele
   vê: testes com o executor do projeto (`node --test`, `pnpm test`, `vitest`… o mod conhece os
   comuns), e o `regras` com o revisor rodado por você em primeiro plano, `name:
   "revisao-fase-<id>"` (o mod força primeiro plano no revisor, para o veredito ser a resposta).
   Pulo é só para o portão que de fato não se aplica à fase, e é decisão do dono.
   Os `finalGates` seguram só o `gh pr merge` do PR da própria change, e só enquanto o
   flow dela roda até o passo antes de `arquivar`. É da change o PR ligado a uma sessão de
   fase, citado no `pr?` de uma `ownerQuestion` ou na nota do `report` do passo `pr` (cite
   `#N` ali), ou cuja branch é de uma sessão de fase ou leva o id da change; PR cuja branch o
   `gh` não consegue ler conta como da change. PR de outro assunto, o PR do arquivamento e
   qualquer merge depois do flow concluído ou encerrado não passam pelos portões finais.
   O `openspec archive` não desatualiza portão: mover a pasta da change não é editar código.
5. **Fechar fase:** quando o subagente termina, faça o merge da branch da worktree dele nesta
   cópia (`git merge <branch>`), confira a afirmação (diff, teste barato) e chame `flow close
   {phase}`. O mod confere os portões do subagente e as tarefas marcadas no `tasks.md` desta
   cópia (por isso o merge vem antes). Não há sessão a arquivar. Se recusar, retome o subagente
   com `SendMessage` (pelo `name`) com o que falta, ou abra outro `fase-<id>`. Quando todas
   fecham, o mod encerra o laço sozinho. Não use `flow report executar`. O painel mostra a fase
   fechada na hora; ao republicar o plano, a fase que o flow já fechou sai como `done`.
6. **Destravar:** fase fechada libera vaga → próxima onda, no mesmo turno. Subagente que
   voltou com pergunta → responda você com o que está nos artefatos, regras e memória
   (`SendMessage` pelo `name`); só escale o que é do dono. Subagente falhou → diagnostique,
   corrija o prompt e abra de novo.

## 5. Não abandonar sessões (regra de ouro)

1. **Empurrar.** Todo subagente termina com a mensagem final `FASE <id>: pronta — <resumo,
   branch, último commit>` ou `FASE <id>: bloqueada — preciso de <X>` (no passo: o resultado do
   passo). O motor entrega essa mensagem à coordenação. Todo prompt de fase termina com essa
   instrução.
2. **Puxar.** Com subagente em segundo plano, o motor acorda você quando ele termina; termine o
   turno com um `ScheduleWakeup` longo (1200 s ou mais) só como reserva, e tick sem mudança é
   `noop: true`. Num tick, confira e siga: abrir o próximo subagente também vale ali. Esperando
   um passo do dono, o painel acorda você no clique.
3. **Ledger.** `<changeRoot>/orchestration.md` (fase, ícone, sessão, branch, estado,
   próximo passo) atualizado a cada transição, para qualquer sessão retomar.
4. **Painel.** Publique com `plan` logo após montar as ondas e a cada transição:
   `change`, `changePath`, ondas (`summary`) e fases (`id`, `title`, `icon`, `tasks` =
   números do `tasks.md`, `status`, `session`, `dependsOn`, `gates`, `note`, `summary`),
   `finalGates`, `ownerQuestions` `{question, recommendation, session?, pr?, gate?}` e `jira`
   (change, onda, fase) quando houver. Nunca ponha em `ownerQuestions` um aviso para
   apertar botão do flow (o passo do dono já aparece sozinho e some ao ser respondido);
   `ownerQuestions` é só decisão fora do flow, e sai do plano assim que respondida.
   `summary`, `note` e perguntas são para o dono: linguagem simples, o efeito para ele,
   sem arquivo, versão ou sigla. Escreva-os, e também proposta, design, tarefas e
   perguntas do grill, no idioma `content` do projeto, que as respostas de `flow start`,
   `flow status` e `plan` informam (`.orchestrator/config.json`, ou o da pasta antiga
   `.orquestrador/`, que o mod ainda lê; sem ele, pt-BR). "Aceitar
   recomendação" chega como mensagem dele: siga com ela.
5. **Jira.** Quando o passo pede mudança de estado, o painel avisa; a issue só se move
   no botão **"Mover no Jira"** do dono.

Antes de encerrar qualquer turno: toda fase livre já tem o seu subagente rodando? Espera um
passo do dono? O `ScheduleWakeup` de reserva (1200 s ou mais) está agendado?

## 6. Depois do PR

1. **Revisão de código** (sessão): subagente `passo-revisao-codigo`; a coordenação reporta `flow report revisao-codigo aprovado|rejeitado`.
2. **Checagem** (automático) → `scripts/check.sh` nesta sessão, com `evidence.md`
   preenchido. **PR** (sessão): subagente `passo-pr`; a coordenação reporta `flow report pr aberto` com `note` citando o PR (`#N`).
3. **Em QA** (dono): botões **"QA aprovou"** / **"QA pediu ajustes"**. Se souber o que
   o QA pediu, deixe com `flow note` antes do clique. Ajustes devolvem o flow às fases:
   acrescente as tarefas novas ao `tasks.md` e volte ao § 4.
4. **Revisão do PR, merge e deploy** (`revisao-pr`, `merge`, `deploy`), nos workflows que os
   têm. A **revisão do PR** é sempre do dono (aprova no GitHub; botão "PR aprovado").
   - **Manual** (`auto: false`): é do dono. O merge é o botão dele ou o `gh pr merge` que o mod
     vê; o deploy, o botão "Deploy concluído". Não faça por ele.
   - **Automático** (`auto: true`): você segue sozinha, com o agente `merge` ou `deploy`.
     **Nunca com `--admin`.** O merge só sai com a aprovação no GitHub e o CI verde, conferidos
     com `gh pr view <pr> --json reviewDecision,statusCheckRollup`; faltando algo, não faça o
     merge, avise o dono com o que falta. Depois, `gh pr merge <pr> --<método>` (método do
     passo, padrão `squash`). O deploy confirma o do CI quando `ci` (`gh run watch <id>
     --exit-status`) e roda cada rotina de `commands`, na ordem, como comando próprio; a que
     falhar segura o passo para o dono decidir.
   - Não rode `gh pr merge` antes da revisão do PR respondida nem com `--admin`: o mod recusa.
     Recusa `--admin` em qualquer PR e, no PR da change, o merge com a revisão pendente ou os
     portões finais abertos, em todas as formas que lê: `gh pr merge`, com flags antes de `pr`
     (`gh -R dono/repo pr merge`), `gh api …/pulls/<n>/merge` (qualquer método), `gh api graphql`
     com `mergePullRequest`; entre aspas, depois de `\` + quebra de linha, dentro de
     `bash -c`/`sh -c`/`eval` ou de `$(…)`. Um merge com `$VAR` ou `$(…)` nos argumentos é
     recusado: o mod não vê o que a variável carrega; escreva o PR e as flags por extenso. Um
     `gh` com merge que o mod não consegue ler (atrás de `xargs`, `timeout`, `sudo -u`, num script
     por heredoc ou pipe para um shell, ou com o nome numa variável) também é recusado. Se
     faltar aprovação ou CI, ou uma rotina de deploy falhar, não repita em laço: avise o dono com
     o diagnóstico e espere a decisão dele.
   - Merge e deploy automáticos não levam `flow report`: o mod avança pelo código de saída.
5. **Em produção** (dono): botão **"Está em produção"**, ou o mod detecta o comando de
   deploy sozinho.
6. **Arquivar** (automático): rode `openspec archive` nesta sessão; quando passa, o mod
   arquiva as sessões restantes e remove o grupo da sidebar. Com o flow concluído o painel
   se atualiza sozinho (todas as fases fechadas, nenhuma em voo; encerrado, nenhuma em voo);
   não precisa publicar o plano final, e publicá-lo não pede portões. Registre o resumo final
   no ledger, resuma por fase em poucas linhas ao dono e arquive a coordenadora por
   último.

## 7. Quando perguntar ao usuário (e só então)

- Escolha do flow; decisão de produto/design que spec ou ADR não resolvem; aceitar risco.
- Ação irreversível ou fora da cópia de trabalho (infra compartilhada, publicar,
  deletar, merge, gasto).
- Credencial, equipamento ou material que só ele tem.
- Conflito real entre regras; escalada do mod.

Pergunte **agrupado** (uma mensagem, cada item com recomendação e o que destrava, ou em
`ownerQuestions`). Nunca pergunte o que spec, ADR, código ou memória já respondem;
nunca peça "posso continuar?". Os passos do dono se respondem no painel, não no chat.

## Regras

- O flow manda: nada de passo fora da ordem, nada de responder pelo dono ou pelo mod.
- Relate fielmente: fase sem evidência fica aberta, nunca "feita".
- Teto ≤ 3 subagentes de fase rodando ao mesmo tempo; passos e fases nunca viram sessão do app.
- Nunca arquive a coordenadora com fase em voo, nem sessão que o usuário abriu fora do
  ledger (reporte como órfã).
- Não duplique trabalho de um subagente; respeite o CLAUDE.md e as regras do projeto.
