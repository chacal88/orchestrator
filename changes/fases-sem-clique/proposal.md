# Fases sem clique, sem loop de aprovação e com comandos pelo chat

## Por quê

A coordenação da change anterior encontrou três problemas no uso real do flow `completo`.

1. **Loop de pedidos de aprovação do `get_session`.** `selfId` (`hooks/register.tsx` ~297) chama
   `mcp__ccd_session_mgmt__get_session {session_id: 'self'}` e só guarda o id quando a chamada volta. Enquanto isso,
   a chamada abre o diálogo de permissão do app. O hook `on('tool.check')` (~2106) recebe `decision: 'ask'` e chama
   `setWaiting` → `publishActivity` → `selfId`. Como o id ainda não está guardado, sai outro `get_session`, que também
   recebe "ask", e assim por diante. O dono vê dezenas de "Procurando sessão — Requer aprovação". Quando ele aprova
   uma, o ciclo para, mas os pedidos pendentes continuam na tela. Outras chamadas também não guardam o resultado:
   `loadSessions` (~365, a cada 15 s no refresh), `groupFamily` (~799) e `cleanupChange` (~1643).
2. **O dono abre as sessões filhas uma a uma.** O app recusa `start_session` com `user_asked` quando o turno foi
   aberto por mensagem de plugin, por mensagem de outra sessão ou por evento automático. Nesses casos a coordenação
   propõe um card por fase, e o dono clica em cada um. Pelo Remote Control (celular), o app só abre sessão a partir de
   mensagem digitada no desktop, nem como card. O aviso "Seguir o flow sem clique" (`wakeOnce` →
   `$.prompt.submit(stopPrompt)`, ~769) e o `wakePrompt` do clique (`pressFlow`, ~1755) são mensagens de plugin, e por
   isso quebram a corrente que o app aceita: o turno do dono seguido dos `<side-sessions-event>` que o app manda quando
   filhas abertas com `wake_when_done` terminam.
3. **Sem o painel, o dono não responde pelo chat.** O `/orquestrador` (~1979) só abre e fecha o painel. Pelo celular,
   sem o painel, o dono não tem como aprovar um passo, ver onde a change está ou abrir as sessões pendentes.

## O que muda

### 1. Um `get_session` por vez, e só quando o dono já permitiu

- **Uma chamada por vez, com o resultado guardado.** `selfId` passa a usar uma promessa do módulo: quem pede o id
  enquanto a primeira chamada está pendente espera essa mesma promessa, sem abrir outra. A linha de `self` que
  `loadSessions`, `groupFamily` e `cleanupChange` leem vem da mesma fonte, com validade curta, em vez de três
  chamadas próprias.
- **Perguntar antes de chamar.** Antes de chamar `get_session` ou `list_sessions` fora de uma ação do dono (refresh,
  `publishActivity`, agrupamento, aviso), o mod pergunta a `$.tool.check`. Se a resposta é "ask", ele não chama e
  guarda que falta permissão. O painel e a faixa acima do prompt mostram: "permita get_session e list_sessions para o
  painel ver as sessões". O mod não grava regra de permissão.
- **A checagem do próprio mod não marca espera.** O hook `tool.check` ignora a checagem que o próprio mod levantou
  (`next.origin.plugin === 'orquestrador'`): ela não chama `setWaiting` e não marca a sessão como "esperando
  permissão".

### 2. Abrir as fases sem um clique por card

- **Sem aviso duplicado.** Quando um `start_session` com `wake_when_done: true` dá certo, o mod guarda o id da filha
  no flow (`tracked`). O aviso "Seguir o flow sem clique" ignora essas filhas, porque o app já acorda a coordenação
  com o `<side-sessions-event>` e a corrente do `user_asked` continua. A opção continua valendo para as filhas que o
  app não acompanha, como as abertas por card ou pelo dono.
- **As sessões pendentes.** Quando o app recusa o `start_session` com `user_asked`, a coordenação registra a sessão
  com uma ação nova do `flow`, `pending`, com título, prompt, fase ou passo, modelo, esforço e `use_worktree`. Ela não
  propõe mais um card por fase. O flow guarda a lista (`pendingStarts`), e uma sessão que abre por qualquer caminho
  sai da lista.
- **Um botão para todas.** Com sessões pendentes, o painel mostra **"Abrir as N sessões pendentes"**. Um clique abre
  todas com `$.tool.call({ tool: 'mcp__ccd_session__start_session', …, initiation: 'user_asked', wake_when_done: true,
  consent })`. O `consent` leva as palavras do clique do dono. O mod usa o `consent` só em ações reais do dono (o
  clique ou o slash command), nunca num aviso automático. Os portões que já existem (`refuseStart`, teto de 3 sessões
  vivas) continuam valendo: o que passar do teto fica na lista, e o painel diz quantas faltam.
- **Remote Control.** Se o app não aceitar o `consent` vindo do celular, isso fica registrado como limitação. O
  painel e o comando dizem ao dono: "pelo celular o app não abre sessões; digite no desktop
  `/orquestrador abrir`".
- O `STOP_AS_USER` (`hooks/wake.ts` ~85) continua desligado.

### 3. `/orquestrador` com subcomandos

| Comando | O que faz |
| --- | --- |
| `/orquestrador` | Abre e fecha o painel, como hoje |
| `/orquestrador status` | Change, passo atual, quem responde, saídas do passo do dono, sessões pendentes e portões abertos, em texto simples |
| `/orquestrador aprovar <saída> [nota]` | Responde o passo do dono atual com o mesmo `pressFlow` do botão e as mesmas validações |
| `/orquestrador abrir` | Faz o mesmo que o botão "Abrir as N sessões pendentes" |
| `/orquestrador pular-portão <fase> <portão>` | Pula o portão como o botão do painel, com confirmação no próprio comando |
| `/orquestrador encerrar [motivo]` | Encerra o flow da change a qualquer momento, com confirmação no próprio comando |
| `/orquestrador ajuda` | Lista os subcomandos |

- Os subcomandos valem só como slash command, nunca como texto livre. O mod confere `e.origin` e aceita só
  `composer` (o Enter do dono) e `bridge` (o Remote Control). `kind: 'plugin'` e as demais origens são recusadas.
- Não existe `/orquestrador liberar`. A liberação continua só no plan mode.
- **Encerrar o flow a qualquer momento** (pedido do dono em 2026-10-28). Hoje "Encerrar o flow" só existe na
  escalada. O painel ganha um botão "Encerrar o flow", sempre visível enquanto o flow está `running` ou `escalated`.
  São dois cliques, como no pulo de portão. O `/orquestrador encerrar` faz o mesmo, com `confirmar` no fim. O flow
  vai para `aborted`, com o mesmo evento da escalada. As sessões e o grupo da sidebar ficam como estão. Só o dono
  encerra: o `FLOW_SCHEMA` não ganha ação de encerrar para o modelo.

### 4. Skill, README e versão

- A skill `change-orchestrator` (§ 2 e § 5) troca "proponha um card por fase" por "registre com `flow pending` e
  aponte o botão ou `/orquestrador abrir`". Ela também explica que filhas com `wake_when_done` não recebem o aviso do
  painel.
- O README descreve os subcomandos, os botões ("Abrir as N sessões pendentes" e "Encerrar o flow") e o aviso de
  permissão.
- Versão 0.14.0 no `plugin.json`.

## Fora do escopo

- OpenSpec: este repositório não tem `openspec/`. O flow do projeto (`.orquestrador/flows/completo.json`) valida com
  `claude plugin validate`, checa com `claude plugin test` e com o `tsc`, e termina com o lançamento da versão.
- Arquivar sessões ou remover o grupo ao encerrar o flow: isso continua só no passo `arquivar`.
- Gravar regras de permissão no `settings` do dono.
- Ligar o `STOP_AS_USER` ou mandar qualquer aviso automático como palavras do dono.
- `/orquestrador liberar` ou outra forma de liberar fora do plan mode.
- Responder às rodadas do grill pelo chat (já existe a resposta digitada no painel). Fica como ideia.

## Critérios de aceite

1. (C1) Com sessões pendentes, o painel mostra um botão só. Um clique, ou `/orquestrador abrir`, abre todas, até o
   teto de sessões vivas, sem card por fase. As que abrem saem da lista.
2. (C2, C8) Um harness prova que o mod não manda aviso de parada sobre uma filha aberta com `wake_when_done: true`, e
   que uma filha sem `wake_when_done` continua sendo avisada com a opção ligada.
3. (C3, C9) `status`, `aprovar`, `abrir`, `pular-portão` e `ajuda` funcionam. Um harness prova que `/orquestrador
   aprovar <saída>` anda o flow como o clique (mesmo estado, mesmo log, mesmo `wakePrompt`), que uma saída que o passo
   não declara é recusada, e que o comando é recusado quando `origin.kind === 'plugin'`.
4. (C4) Não existe subcomando de liberação, e `aprovar` no passo da liberação é recusado com o aviso do plan mode.
5. (C5) O mod não grava regra de permissão. Com "ask", o painel e a faixa mostram o aviso de permissão, e o mod não
   chama `get_session` nem `list_sessions` fora de uma ação do dono.
6. (C6) As respostas do comando são texto simples e funcionam com `origin.kind === 'bridge'`. Se o app não aceitar
   abrir sessões pelo Remote Control, a resposta diz isso e diz o que fazer no desktop.
7. (C7) Um harness prova que, com um `get_session` pendente no diálogo de permissão, o mod faz no máximo 1 chamada, e
   que os refreshes do relógio não fazem nenhuma enquanto a permissão está em "ask".
8. A checagem que o próprio mod levanta não marca a sessão como esperando permissão.
9. (C10) `plugin.json` na versão 0.14.0. O README e a skill estão atualizados. `claude plugin test orquestrador`,
   o `tsc` e `claude plugin validate orquestrador` saem com 0.
10. (C11) O dono encerra o flow a qualquer momento pelo botão "Encerrar o flow" (dois cliques) ou por `/orquestrador
    encerrar … confirmar`. Um harness prova que o comando deixa o flow `aborted` igual ao clique, que sem `confirmar`
    nada muda, que nenhum aviso sai para a coordenação e que uma `origin` de plugin é recusada.
