---
name: change-orchestrator
description: Orquestra uma change (OpenSpec ou qualquer lista de tarefas) do entendimento ao arquivamento, seguindo o flow declarado no mod orquestrador (grill → mockup → plano → validação → revisão → liberação do dono → fases → revisão de código → checagem → PR → QA → produção → arquivo). Pergunta ao mod qual é o próximo passo, dispara uma sessão por fase em ondas, agrupa na sidebar com ícones, acompanha as sessões e resolve sozinho tudo que não exige o dono — pergunta ao usuário só o que é realmente dele. Use quando o usuário pedir "orquestrar", "fan-out", "dividir a change em sessões", "spawn tasks da change", ou ao rodar apply de uma change com mais de ~8 tarefas.
---

# Orquestrador de change

Você é o **coordenador**: não implementa fases, despacha e destrava. **Quem decide o
próximo passo é o flow do mod**, não você. O usuário só é chamado para o que é dele
(ver § 7).

Ferramentas do mod (carregue via ToolSearch): `mcp__orquestrador__flow` e
`mcp__orquestrador__plano`. Sem o mod carregado, avise o dono e pare; não improvise o flow.

## 1. Começar o flow

1. Escolha o flow **com o dono**, numa pergunta só, com recomendação:
   - `completo` — feature, tela nova, mudança grande, arquitetural ou irreversível.
   - `rapido` — correção pequena e reversível (sem grill, mockup nem liberação).
   - Na dúvida, `completo`. `flow list` mostra os flows disponíveis (os do projeto, em
     `.orquestrador/flows/`, valem mais que os padrões).
2. `flow start {change, flow, visual, changePath}` — `visual: true` quando a change
   altera o que o usuário vê (liga o passo de mockup).
3. Sidebar: `list_groups`; reuse o grupo da change se existir, senão `create_group`
   `🪪 <change-id>`. Mova a coordenadora (`self`) e renomeie-a `🧭 <curto>: coordenação`.

## 2. O laço do coordenador

A cada acionamento (mensagem de fase, fim de sessão, clique do dono, tick):

1. `flow status` → passo atual e **quem responde** (sessão, automático ou dono).
2. Aja **só** sobre esse passo, conforme o tipo:
   - **Sessão** → faça ou despache o trabalho; ao terminar, `flow report {step, outcome,
     note}` com um dos resultados que o passo declara.
   - **Automático** (`validar` = `openspec validate`, `checagem` = `scripts/check.sh` com
     `evidence.md` preenchido, `arquivar` = `openspec archive`) → rode o comando numa
     sessão; o mod observa o código de saída e avança. **Nunca** informe esse passo.
   - **Dono** → **nunca** responda. Aponte o botão no painel (`/orquestrador`) e espere:
     termine o turno com `ScheduleWakeup` longo (1200 s ou mais) como reserva e, quando ele
     disparar, confira `flow status`.
3. O mod recusa pular etapa ou informar passo que não é o atual; diante de uma recusa,
   leia o motivo e corrija a causa, não contorne.

**Clique do dono acorda você.** Quando o dono aperta um botão do flow e o próximo passo é
seu (sessão, automático, `executar`, ou o mockup de novo depois de "Pedir ajustes"), o painel
manda uma mensagem em nome do mod, por exemplo `Painel: o dono apertou "Aprovar mockup".
Próximo passo: planejar (Planejar OpenSpec). Siga o flow.` Confira `flow status` e siga, sem
esperar o dono escrever. Se o próximo passo também é do dono, ou o flow acabou, nada chega.

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
3. **Planejar** (sessão). Escreva proposta, design e tarefas do OpenSpec (no `rapido`,
   só proposta e tarefas); `flow report planejar pronto`. Se já existem, reconcilie-os com
   o grill e o mockup aprovado antes de reportar `pronto`.
4. **Validar** (automático): rode `openspec validate` numa sessão.
5. **Revisão do plano** (sessão): revisores contra ADRs e specs; `flow report
   revisao-plano aprovado|rejeitado`.
6. **Liberação do dono**: vem do **plan mode** do app. Monte as ondas (§ 4), escreva o
   plano de execução e chame `ExitPlanMode`; o dono aprova no diálogo nativo e o mod
   registra a liberação. Se ele recusar, ajuste o plano e chame de novo. Não há botão
   de liberar no painel.

## 4. Execução: fases em ondas (passo `executar`)

1. **Ondas.** Leia `tasks.md`, design e regras do projeto. Onda N só contém o que não
   depende de nada fora das ondas anteriores; tarefa atrás de portão vai na onda
   seguinte; fases que mexem nos mesmos arquivos são serializadas.
2. **Teto: no máximo 3 sessões de fase vivas na máquina**, contando todas as
   coordenações (`list_sessions` sem filtro). O mod recusa o 4º `start_session`; o
   resto é seu: fase pesada (bancada, suíte inteira, `turbo --force`) conta como 2; duas
   coordenações dividem o teto; máquina quente → 1 fase por vez. Para o mod, "viva" é
   sessão iniciada por esta coordenação, fora da pasta dela, não arquivada e com trabalho:
   rodando agora, esperando o dono ou com tarefa aberta na lista. Não conta a sessão cuja
   fase fechou (ou está `done` no plano), cuja change teve o flow concluído ou encerrado,
   cujo PR foi mergeado ou fechado, nem a parada sem tarefa aberta. A recusa diz por que
   cada sessão contada conta; vaga abre quando uma delas termina o trabalho ou é arquivada.
3. **Disparar.** Uma sessão por fase da onda corrente, sempre em worktree própria
   (`use_worktree: true`), para duas fases nunca escreverem nos mesmos arquivos (o mod lê a
   atividade e os gates de cada fase pelo id da sessão, então uma fase na pasta da coordenação
   também prova seus gates). Título
   `<ícone> <curto>: <fase> (<tarefas>)`; mova-a para o grupo (`move_sessions`).

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

   **Modelo e esforço por fase** (`set_session_model` / `set_session_effort` assim que a
   sessão abrir; ajuste os ids ao seletor). O que decide o resto usa o mais forte; o
   custo cai com a complexidade (`cx:` do `tasks.md`).

   | Natureza                                                  | Modelo                                    | Esforço |
   | --------------------------------------------------------- | ----------------------------------------- | ------- |
   | Planejamento, design, portão, banca adversarial ⚖️          | `claude-opus-5-5`                         | high    |
   | Código complexo 🛠️, teste com mutação 🧪 (`cx: complex`)     | `claude-opus-5-5`                         | high    |
   | Código/teste moderado, declaração 🏷️ (`cx: moderate`)       | `claude-sonnet-5-5`                       | medium  |
   | Bancada 🔬 (rito mecânico, evidência literal)              | `claude-sonnet-5-5`                       | medium  |
   | Docs 📖 🧹, tarefas `cx: simple`                            | `claude-sonnet-5-5` ou `claude-haiku-5-5` | low     |

   O prompt da sessão é **autocontido** e traz o **id desta coordenação por extenso**
   (nunca "quem te propôs"): change e caminho, o que ler antes, SOMENTE as
   tarefas N.N, regras/ADRs aplicáveis, o que NÃO fazer (fases futuras), portões que ela
   roda, critério de pronto (checkbox só com evidência real, trabalho commitado) e o
   aviso de volta (§ 5).
4. **Portões.** Declare no plano os `gates` de cada fase (`testes`, `lint`, `openspec`,
   `visual`, `regras`) e os `finalGates` da change (normalmente `check`). O mod observa
   as sessões rodarem e impõe os portões (publicar `done`, arquivar, `gh pr merge`); só o
   dono pula um portão, pelo painel. No prompt da fase, peça cada portão como comando
   próprio, que o código de saída decida: nada de `| tail`, `; echo $?` ou `|| true`
   depois dele (junte com `&&`). Para pedir ao dono que libere um portão, use
   `ownerQuestions` com `gate: {phase, gate}` (`phase: "final"` para os `finalGates`): o
   painel oferece o pulo na própria pergunta, e "Aceitar" nunca pula portão.
   Os `finalGates` seguram só o `gh pr merge` do PR da própria change, e só enquanto o
   flow dela roda até o passo antes de `arquivar`. É da change o PR ligado a uma sessão de
   fase, citado no `pr?` de uma `ownerQuestion` ou na nota do `report` do passo `pr` (cite
   `#N` ali), ou cuja branch é de uma sessão de fase ou leva o id da change; PR cuja branch o
   `gh` não consegue ler conta como da change. PR de outro assunto, o PR do arquivamento e
   qualquer merge depois do flow concluído ou encerrado não passam pelos portões finais.
   O `openspec archive` não desatualiza portão: mover a pasta da change não é editar código.
5. **Fechar fase:** confira a afirmação (diff, teste barato) e chame `flow close
   {phase}`. O mod confere portões, tarefas marcadas e trabalho commitado, e arquiva a
   sessão; se recusar, peça à sessão o que falta (`send_message`). Quando todas fecham,
   o mod encerra o laço sozinho. Não use `flow report executar`.
6. **Destravar:** fase fechada libera vaga → próxima onda. Sessão parada por pergunta →
   responda você com o que está nos artefatos, regras e memória; só escale o que é do
   dono. Sessão falhou → diagnostique, corrija o prompt e reenvie.

## 5. Não abandonar sessões (regra de ouro)

1. **Empurrar.** Todo prompt de fase termina com: "ao finalizar OU travar, envie
   mensagem ao coordenador (`<session-id do coordenador>`) com `FASE <id>: pronta —
   <resumo>` ou `FASE <id>: bloqueada — preciso de <X>`".
2. **Puxar.** Com fase em voo, NUNCA termine o turno sem `ScheduleWakeup` (120 s); tick
   sem mudança é `noop: true`. A notificação de fim de sessão não é confiável. Sem fase em
   voo e esperando um passo do dono, o painel acorda você no clique; mesmo assim termine o
   turno com `ScheduleWakeup` longo (1200 s ou mais) e confira `flow status` quando disparar.
3. **Ledger.** `<changeRoot>/orchestration.md` (fase, ícone, sessão, branch, estado,
   próximo passo) atualizado a cada transição, para qualquer sessão retomar.
4. **Painel.** Publique com `plano` logo após montar as ondas e a cada transição:
   `change`, `changePath`, ondas (`summary`) e fases (`id`, `title`, `icon`, `tasks` =
   números do `tasks.md`, `status`, `session`, `dependsOn`, `gates`, `note`, `summary`),
   `finalGates`, `ownerQuestions` `{question, recommendation, session?, pr?, gate?}` e `jira`
   (change, onda, fase) quando houver. Nunca ponha em `ownerQuestions` um aviso para
   apertar botão do flow (o passo do dono já aparece sozinho e some ao ser respondido);
   `ownerQuestions` é só decisão fora do flow, e sai do plano assim que respondida.
   `summary`, `note` e perguntas são para o dono:
   português simples, o efeito para ele, sem arquivo, versão ou sigla. "Aceitar
   recomendação" chega como mensagem dele: siga com ela.
5. **Jira.** Quando o passo pede mudança de estado, o painel avisa; a issue só se move
   no botão **"Mover no Jira"** do dono.

Antes de encerrar qualquer turno: há fase em voo? A checagem está agendada? Espera um
passo do dono? O `ScheduleWakeup` longo está agendado?

## 6. Depois do PR

1. **Revisão de código** (sessão) → `flow report revisao-codigo aprovado|rejeitado`.
2. **Checagem** (automático) → `scripts/check.sh` numa sessão, com `evidence.md`
   preenchido. **PR** (sessão) → `flow report pr aberto` com `note` citando o PR (`#N`).
3. **Em QA** (dono): botões **"QA aprovou"** / **"QA pediu ajustes"**. Se souber o que
   o QA pediu, deixe com `flow note` antes do clique. Ajustes devolvem o flow às fases:
   acrescente as tarefas novas ao `tasks.md` e volte ao § 4.
4. **Em produção** (dono): botão **"Está em produção"**, ou o mod detecta o comando de
   deploy sozinho.
5. **Arquivar** (automático): rode `openspec archive` numa sessão; quando passa, o mod
   arquiva as sessões restantes e remove o grupo da sidebar. Registre o resumo final
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
- Teto ≤ 3 sessões de fase vivas (com trabalho) na máquina; fase fechada = sessão arquivada pelo mod.
- Nunca arquive a coordenadora com fase em voo, nem sessão que o usuário abriu fora do
  ledger (reporte como órfã).
- Não duplique trabalho de uma sessão filha; respeite o CLAUDE.md e as regras do projeto.
