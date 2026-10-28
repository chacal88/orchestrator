# Tarefas — fases sem clique (0.14.0)

Quatro fases, em série, uma onda cada. As fases 1, 2 e 3 mexem em `orquestrador/hooks/register.tsx`,
`orquestrador/hooks/i18n.ts` e `orquestrador/hooks/pane.tsx`, e as fases 2 e 3 mexem em `orquestrador/hooks/flow.ts`
e `orquestrador/tests/flow.test.ts`. Por isso nenhuma corre em
paralelo com outra: cada fase começa da branch com a anterior já commitada. A fase 3 usa o `openPending` (fase 2) e o
`mayList` (fase 1). A fase 4 descreve o que as três entregaram. A tabela de arquivos por fase está no fim do
`design.md`.

Portões de toda fase:

- `testes`: `claude plugin test orquestrador` na raiz do repo, saída 0. Usar o binário do app, como nos
  `evidence.md` anteriores; o `claude` do shell pode ser um alias antigo.
- `tipos`: `npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json`, com hooks, types e tests e os tipos do
  engine (`plugin-authoring/types`), como em `changes/freio-aviso/evidence.md`, saída 0.

Os portões `testes` e `validate` rodam com o binário do app, nunca com o `claude` do PATH (o do nvm, 2.1.227, não
entende mods): `export PATH="/Users/kauesantos/Library/Application Support/Claude/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orquestrador`
(e `… && command claude plugin validate orquestrador`).

A fase 4 tem também o portão `validate` (`claude plugin validate orquestrador`, saída 0).

Depois das fases, o flow do projeto (`.orquestrador/flows/completo.json`, base `completo`) roda os passos automáticos
dele: `validar` = `claude plugin validate`, `checagem` = `claude plugin test` com o `evidence.md` preenchido, `tipos`
= `tsc`, e `arquivar` = lançamento da versão (`gh release create`). Este repositório não usa OpenSpec, e nenhuma
tarefa cria `openspec/` nem roda `openspec`. O release não é tarefa de fase: é o passo `arquivar`, depois de produção.

## 1. Um `get_session` por vez, e só com permissão

Arquivos: `orquestrador/hooks/register.tsx`, `orquestrador/hooks/i18n.ts`, `orquestrador/hooks/pane.tsx`,
`orquestrador/types/index.d.ts`, `orquestrador/tests/permissao-harness.test.ts` (novo), `changes/fases-sem-clique/evidence.md`. Portões: `testes`,
`tipos`.

- [x] 1.1 O hook `tool.check` começa com `if (next.origin.plugin === 'orquestrador') return next(e)`. Uma checagem
      levantada pelo próprio mod não chama `setWaiting` e não muda o veredito. Verificação: o caso "a checagem do mod
      não marca espera", da 1.6, passa — cx: simple
- [x] 1.2 `selfId` com promessa compartilhada (`selfAsk`, no módulo). Chamadas simultâneas esperam a mesma promessa.
      O id vai para o `SELF_ID` quando chega. Uma falha, ou uma resposta sem linha, solta a promessa sem guardar
      nada. Verificação: `grep -n "selfAsk" orquestrador/hooks/register.tsx` acha a definição e o uso só dentro de
      `selfId`; a 1.6 passa — cx: moderate
- [x] 1.3 `selfRowNow($)`: junta numa só as chamadas simultâneas de `get_session self` e não guarda a linha entre uma
      volta e outra. `loadSessions` (~365), `groupFamily` (~799) e `cleanupChange` (~1643) passam a usar essa função.
      Verificação: `grep -n "GET_SESSION" orquestrador/hooks/register.tsx` acha a constante e só as chamadas dentro
      de `selfId` e `selfRowNow` — cx: moderate
- [x] 1.4 `mayList($, tool, input)`: consulta `$.tool.check` com o input da chamada. Com `allow`, chama e apaga o
      `permission-needed`. Com `ask`/`deny`, não chama, grava `permission-needed` (`{ tools, since }`) no `$.state` e
      devolve "não sei". A chave `permission-needed` é declarada em `orquestrador/types/index.d.ts`, junto das outras. Passam por ela o `get_session`/`list_sessions` do refresh, de `publishActivity`,
      `restoreActivity`, do agrupamento, do aviso, de `refuseStart`, `folderIsOwn`, `loadFamily` e de
      `openChildren` (~1455). Uma ação do dono chama direto. Sem permissão, a mensagem do `refuseStart` diz que
      falta permitir. Verificação: `grep -n "LIST_SESSIONS" orquestrador/hooks/register.tsx` mostra cada chamada
      dentro de `mayList` ou de um caminho do dono (comentado); a 1.6 passa — cx: complex
- [x] 1.5 O aviso: texto no `i18n.ts`, em pt-BR e inglês (pt-BR: `Permita get_session e list_sessions para o painel
      ver as sessões.`), mostrado nos `warnings` do Pane e na faixa (`AbovePrompt`/`renderBand`), também sem plano
      carregado. O mod não escreve em nenhum `settings*.json`. Verificação: a 1.6 confere o texto no painel e na
      faixa; `grep -n "settings" orquestrador/hooks/register.tsx` não acha escrita nova — cx: moderate
- [x] 1.6 Harness `tests/permissao-harness.test.ts`. O mundo falso responde "ask" no `tool.check` de
      `get_session`/`list_sessions` e segura um `get_session` pendente. Casos:
      - com um `get_session` pendente, `publishActivity`, `setWaiting` e 3 voltas do relógio fazem no máximo 1
        chamada de `get_session` (C7);
      - com a permissão em "ask", os refreshes do relógio não fazem nenhuma chamada de `get_session`/`list_sessions`,
        e o painel e a faixa mostram o aviso (C5, C7);
      - a checagem do mod não marca a sessão como esperando permissão. Uma ferramenta do modelo com "ask" continua
        marcando;
      - com "allow" depois, a volta seguinte chama, e o aviso some;
      - o resto do repo passa sem mudar (`harness.test.ts`, `grupos-harness.test.ts`, `autowake-harness.test.ts`).
      Rodar o primeiro caso uma vez sem as tarefas 1.1 a 1.4 e anotar no `evidence.md` que ele falha. Verificação:
      `claude plugin test orquestrador` sai com 0, e os casos novos aparecem como `(pass)` — cx: complex
- [x] 1.7 Evidência: seção "Fase 1" do `evidence.md` com a saída dos portões `testes` e `tipos`, os casos novos como
      `(pass)` e a nota da 1.6. Verificação: a seção preenchida, sem "a preencher" — cx: simple

## 2. Abrir as fases sem um clique por card

Arquivos: `orquestrador/hooks/flow.ts`, `orquestrador/hooks/wake.ts`, `orquestrador/hooks/register.tsx`,
`orquestrador/hooks/pane.tsx`, `orquestrador/hooks/i18n.ts`, `orquestrador/tests/flow.test.ts`,
`orquestrador/tests/wake.test.ts`, `orquestrador/tests/autowake-harness.test.ts`,
`orquestrador/tests/pendentes-harness.test.ts` (novo), `changes/fases-sem-clique/evidence.md`. Depende da fase 1.
Portões: `testes`, `tipos`.

- [x] 2.1 `FlowState.tracked?: string[]`. No `tool.call`, depois de um `START_SESSION` que deu certo com
      `wake_when_done: true`, o id da filha entra em `tracked`, gravado pelo `inFlowQueue` junto com o
      `keepGrouping` (sem fila reentrante). Verificação: o caso de `tracked` da 2.4 passa — cx: moderate
- [x] 2.2 `untracked(ids, tracked)` em `wake.ts`. O `wakeOnce` tira de `pending` as filhas em `tracked` antes do
      freio e mantém essas filhas no `seen`. Testes em `wake.test.ts`. `STOP_AS_USER` continua `false`. Verificação:
      `grep -n "STOP_AS_USER = false" orquestrador/hooks/wake.ts` acha a linha; `wake.test.ts` passa — cx: simple
- [x] 2.3 Ação `pending` do `flow` (`FLOW_SCHEMA` e função pura no `flow.ts`), como no design: `sessions: [{ key,
      title, prompt, model?, effort?, use_worktree? }]`, `key` repetida substitui a anterior, só no flow `running`
      desta coordenação e num passo de sessão ou `executar`, limites de tamanho (6 entradas, `title` com até 120 e
      `prompt` com até 20 000 caracteres), `FlowState.pendingStarts` e evento `pending` no log, sem o prompt. A
      entrada sai quando abre (pelo mod ou por um `START_SESSION` do modelo com o mesmo `title`), quando a fase
      fecha (`close`) ou quando o flow sai do passo. A resposta do passo de sessão e do `executar` (~1082-1091)
      troca o card por `pending` e pelo botão. Testes em `flow.test.ts`: registrar, substituir, recusar fora do
      passo, recusar acima dos limites, sair ao fechar, sair ao andar e o texto novo. Verificação: `flow.test.ts`
      passa, e `grep -n "own_initiative" orquestrador/hooks/flow.ts` não acha mais a instrução do card como caminho
      principal — cx: complex
- [x] 2.4 `openPending($, words)` em `register.tsx`, como no design: relê o flow, abre cada entrada com
      `$.tool.call({ tool: START_SESSION, …, initiation: 'user_asked', wake_when_done: true, consent: words })`,
      aplica modelo e esforço, para na primeira recusa (o teto do `refuseStart` vale), tira da lista as que abriram e
      grava o evento `pending-opened`. O botão "Abrir as N sessões pendentes" fica no bloco do passo atual do
      `pane.tsx`, no desktop e no celular, com os textos no `i18n.ts`. O toast diz quantas abriram, quantas ficaram e
      por quê. Uma recusa do app ao `user_asked` mostra a mensagem de digitar no desktop. Verificação: `grep -n
      "consent" orquestrador/hooks/register.tsx` acha o `consent` só dentro de `openPending`; a 2.5 passa — cx:
      complex
- [x] 2.5 Harness:
      - em `autowake-harness.test.ts`: com a opção ligada, uma filha aberta com `wake_when_done: true` que termina o
        turno não gera nenhum `$.prompt.submit`, e uma filha sem `wake_when_done` (por exemplo, aberta por card)
        continua gerando o aviso (C2, C8). Os testes existentes do freio passam sem mudar;
      - em `pendentes-harness.test.ts`: `flow pending` com 3 entradas mostra o botão "Abrir as 3 sessões
        pendentes"; o clique faz 3 `start_session` com `initiation: 'user_asked'`, `wake_when_done: true` e o
        `consent` do clique (C1); a lista esvazia, e as 3 filhas entram em `sessions` e em `tracked`. Com 2 sessões vivas,
        só 1 abre, o resto fica e o toast diz por quê. Uma recusa do app deixa a lista como estava e mostra a
        mensagem de digitar no desktop. O `wakeOnce` e o `pressFlow` nunca passam `consent`.
      Verificação: `claude plugin test orquestrador` sai com 0, e os casos novos aparecem como `(pass)` — cx: complex
- 2.6 Saiu da fase: a conferência no app real só é possível com o mod novo instalado, depois do merge.
      Ela passa para o QA (ver "Conferência no QA" no fim).
- [x] 2.7 Evidência: seção "Fase 2" do `evidence.md` com a saída dos portões `testes` e `tipos` e os casos novos como
      `(pass)`. Verificação: a seção preenchida — cx: simple

## 3. `/orquestrador` com subcomandos

Arquivos: `orquestrador/hooks/command.ts` (novo), `orquestrador/hooks/flow.ts`, `orquestrador/hooks/register.tsx`,
`orquestrador/hooks/pane.tsx`, `orquestrador/hooks/i18n.ts`, `orquestrador/tests/flow.test.ts`,
`orquestrador/tests/command.test.ts` (novo), `orquestrador/tests/comando-harness.test.ts` (novo),
`changes/fases-sem-clique/evidence.md`. Depende das fases 1 e 2. Portões: `testes`, `tipos`.

- [x] 3.1 `hooks/command.ts`: `parseCommand(args)` (`toggle`, `status`, `help`, `open`, `approve { outcome, note? }`,
      `skip { phase, gate, confirmed }`, `end { reason?, confirmed }`, `unknown`), com `pular-portão` e `pular-portao`, e `fromOwner(origin)`
      (só `composer` e `bridge`). Testes em `tests/command.test.ts`, um por forma e um por origem do `PromptOrigin`.
      Verificação: `command.test.ts` passa — cx: simple
- [x] 3.2 O `pressFlow` passa a devolver `{ ok: true, text } | { error }`. O clique continua com o mesmo toast (os
      testes de painel existentes passam sem mudar), e o `wakePrompt` sai igual. Verificação: `panel-flow.test.ts` e
      `flow-harness.test.ts` passam sem mudar — cx: moderate
- [x] 3.3 O hook `command.run` lê `e.args` e `e.origin`. Sem argumentos, abre e fecha o painel como hoje, com
      qualquer origem. Os outros subcomandos são recusados sem `fromOwner`. Implementar `status` (texto simples, sem
      chamar sessão fora do `mayList`), `aprovar` (o mesmo `pressFlow`; liberação recusada com o aviso do plan mode),
      `abrir` (o `openPending` com `The user typed "/orquestrador abrir".` e a limitação do Remote Control quando
      `bridge` e o app recusou), `pular-portão` (pede `confirmar`; com ele, o mesmo `skipGate`) e `ajuda`. Sem flow
      desta coordenação, responde que é para usar na coordenação. Os textos ficam no `i18n.ts`, nos dois idiomas, e a
      descrição do comando lista os subcomandos. Não existe `liberar`. Verificação: a 3.6 passa — cx: complex
- [x] 3.4 `endFlow(state, at, note?)` em `flow.ts` (função pura): um flow `running` ou `escalated` passa a `aborted`,
      com o evento `aborted` `by: 'owner'` e a nota; `pendingStarts` esvazia; um flow `done` ou `aborted` é recusado
      com o motivo. O `resolveEscalation` com `encerrar` passa a usar a mesma função (mesmo estado e mesmo evento de
      hoje). Nada é arquivado e o grupo da sidebar fica: o `cleanupChange` continua só no passo `arquivar`. Testes em
      `flow.test.ts`: encerrar de `running`, de `escalated`, recusa de `done`/`aborted` e a escalada sem mudança.
      Verificação: `flow.test.ts` passa — cx: moderate
- [x] 3.5 Encerrar pelo dono a qualquer momento:
      - botão **"Encerrar o flow"** sempre visível no painel enquanto o flow está `running` ou `escalated`, com dois
        cliques, como o pulo de portão (o primeiro pede a confirmação, o segundo encerra), no desktop e no celular;
      - `/orquestrador encerrar [motivo]`: sem `confirmar` no fim, responde o que vai ser encerrado e pede o mesmo
        comando com `confirmar`; com ele, encerra. Só com `fromOwner(e.origin)`;
      - os dois chamam `endFlow` pela fila (`saveFlow`), atualizam o painel e mostram ou respondem o texto do
        `i18n.ts`. Nenhum aviso à coordenação (`$.prompt.submit`) sai: com o flow `aborted`, o aviso da opção também
        para. Nenhuma chamada de ferramenta do modelo encerra o flow (o `FLOW_SCHEMA` não ganha ação nova).
      Verificação: a 3.6 passa; `grep -n "endFlow" orquestrador/hooks/register.tsx` acha só o clique, o comando e a
      escalada — cx: moderate
- [x] 3.6 Harness `tests/comando-harness.test.ts` (C3):
      - `/orquestrador aprovar <saída>` com `origin: { kind: 'composer' }` deixa o flow, o log e o `wakePrompt`
        iguais aos de um clique no mesmo botão (comparar com um segundo mundo que clica) (C9);
      - com `origin: { kind: 'plugin', name: 'x' }` é recusado e o flow não muda; com `peer` também (C9);
      - com `bridge` funciona, e a resposta não tem tabela (C6);
      - uma saída que o passo não declara é recusada com o motivo do `ownerPress`; o passo da liberação é recusado
        com o aviso do plan mode; `liberar` cai em `ajuda` (C4);
      - `abrir` faz o mesmo que o clique da 2.5;
      - `pular-portão 2 testes` sem `confirmar` não pula, e com `confirmar` grava o mesmo pulo do painel;
      - sem argumentos, abre e fecha o painel como antes;
      - `/orquestrador encerrar` sem `confirmar` não muda o flow; com `confirmar` e `origin` `composer`, o flow fica
        `aborted`, com o evento `aborted` `by: 'owner'`, igual ao segundo clique de "Encerrar o flow" num segundo
        mundo; nenhum `$.prompt.submit` sai; com `origin` `plugin` é recusado e o flow segue `running`; num flow já
        encerrado, responde o motivo (C11).
      Verificação: `claude plugin test orquestrador` sai com 0, e os casos novos aparecem como `(pass)` — cx: complex
- [x] 3.7 Evidência: seção "Fase 3" do `evidence.md` com a saída dos portões `testes` e `tipos` e os casos novos como
      `(pass)`. Verificação: a seção preenchida — cx: simple

## 4. Skill, README e versão

Arquivos: `orquestrador/skills/change-orchestrator/SKILL.md`, `README.md`, `orquestrador/.claude-plugin/plugin.json`,
`changes/fases-sem-clique/evidence.md`. Depende das fases 1 a 3. Portões: `testes`, `tipos`, `validate`.

- [x] 4.1 Skill § 2 ("Start recusado" e "Com 'Seguir o flow sem clique' ligada") e § 5 (itens 1 e 2, e a pergunta
      antes de encerrar o turno): a recusa do `user_asked` vira `flow pending` e o botão "Abrir as N sessões
      pendentes" ou `/orquestrador abrir`, sem um card por fase; o card fica só quando o mod não está disponível;
      filhas com `wake_when_done` não recebem o aviso do painel; o "três avisos" passa a dizer o que o mod faz hoje
      (freio por filha e teto de 10). Verificação: `grep -n "flow pending\|/orquestrador abrir" orquestrador/skills/change-orchestrator/SKILL.md`
      acha as duas seções — cx: moderate
- [x] 4.2 README: os subcomandos do `/orquestrador` (texto simples, só slash, pelo Remote Control), o botão "Abrir as
      N sessões pendentes" com a limitação que a 2.6 registrou, o botão e o `/orquestrador encerrar`, o aviso de
      permissão, e o item "Seguir o flow sem
      clique" valendo só para filhas que o app não acompanha. Verificação: `grep -n "/orquestrador aprovar\|sessões
      pendentes\|get_session" README.md` acha as linhas — cx: simple
- [x] 4.3 (C10) Versão 0.14.0 em `orquestrador/.claude-plugin/plugin.json`. Verificação: `grep -n '"version": "0.14.0"'
      orquestrador/.claude-plugin/plugin.json` acha a linha, e `claude plugin validate orquestrador` sai com 0 — cx:
      simple
- [x] 4.4 Evidência: seção "Fase 4" e a tabela "Critérios de aceite" do `evidence.md`, com um caminho de evidência
      para cada critério (1 a 10) da `proposal.md`. Verificação: nenhuma linha "a preencher" no `evidence.md` — cx:
      simple

## 5. Ajustes do QA: os achados da revisão de código

Pedido do dono em 2026-10-28, antes do QA ("QA pediu ajustes"). Os achados estão em `orchestration.md`, na seção
"Revisão de código". Uma sessão só, porque mexe em `register.tsx`, `flow.ts`, `command.ts` e nos harness das fases 1 a
3. Portões: `testes` e `tipos`, com o binário do app 2.1.309.

- [ ] 5.1 `/orquestrador aprovar encerrar` (e qualquer `aprovar` da escalada que encerra o flow) é recusado e aponta
      para `/orquestrador encerrar … confirmar`. Assim, encerrar sempre pede confirmação (C11). O clique
      "Encerrar o flow" da escalada no painel continua como está. Verificação: um caso no `comando-harness` mostra o
      flow escalado continuando `escalated` depois de `aprovar encerrar`, com a resposta apontando para o comando — cx:
      simple
- [ ] 5.2 Com "ask" e o próprio id ainda não guardado, o `keepPending` e o `commandFlow` respondem com o aviso de
      permissão da fase 1, e não "outra sessão" ou "sem flow". Verificação: um harness com um flow que já tem
      `coordinatorSession`, com o `SELF_ID` vazio e "ask", recebe o texto de permissão nos dois caminhos — cx: moderate
- [ ] 5.3 No nível "lembrar", com "ask", o `openPending` não abre nenhuma sessão sem conseguir contar o teto. Ele
      responde com o aviso de permissão, igual ao "barrar": sem a lista, o mod não sabe se passaria do teto.
      Atualize o `design.md` com essa decisão. Verificação: o harness do `pendentes` ganha o caso "lembrar" + "ask"
      (nenhum `start_session`, com o aviso) e o caso "lembrar" + "allow" (abre) — cx: moderate
- [ ] 5.4 Nits: o `wakeOnce` compara `tracked` e pendentes pelo mesmo id limpo (`sessionRef` dos dois lados). O
      `/orquestrador status` mostra o aviso de permissão mesmo sem `VIEW`. Verificação: um caso de teste para cada um —
      cx: simple
- [ ] 5.5 Evidência: seção "Fase 5" do `evidence.md`, com a saída dos portões e os casos novos como `(pass)`. Na
      seção de achados do `orchestration.md`, cada achado ganha a marca de resolvido e o commit — cx: simple

## Conferência no QA (fora das fases)

Vem da antiga tarefa 2.6. O mod instalado é o 0.13.1 até o merge, então o comportamento novo só se confere
no app depois do deploy. O dono confere no passo `qa`, e o resultado entra no `evidence.md` (seção "No app").

- [ ] QA.1 Conferência no app real, registrada no `evidence.md` (seção "No app"), para os quatro riscos do design:
      `consent` no desktop, `consent` pelo Remote Control (clique no painel do celular), `wake_when_done` de uma filha
      aberta pelo mod e a corrente depois do clique. Para cada um: o que foi feito, o que o app respondeu, e a
      consequência (por exemplo, a limitação do Remote Control no texto). Se algum risco depender do dono e não puder
      ser conferido nesta sessão, ele fica marcado como pendente para o passo de QA, sem marcar o checkbox.
      Verificação: a seção preenchida com uma linha por risco — cx: moderate
