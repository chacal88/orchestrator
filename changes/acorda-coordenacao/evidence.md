
## Fase 3 — skill, README e versão

- 3.1: `grep -n "Seguir o flow sem clique" orquestrador/skills/change-orchestrator/SKILL.md` acha o parágrafo (§ 2) e a menção no § 5.2; `grep -n "arrasta"` acha a regra do início de change.
- 3.2: `grep -n "Seguir o flow sem clique" README.md` acha a linha na lista de recursos.
- 3.3: `plugin.json` em 0.13.0.
- Portões: `claude plugin test orquestrador` saiu com 0; `tsc` saiu com 0.

## Fase 1 — filhas no grupo da change certa

- 1.1: `FlowState` ganhou `coordinatorSession`, `groupId`, `sessions` e `earlier` (`types/index.d.ts`). `flow start` grava o id da coordenação; `flow report` preenche quando falta. Teste `grupos-harness.test.ts` > "the flow records its coordinator…" (pass).
- 1.2: `currentFlow`/`currentChange` em `register.tsx`; o gancho do `start_session` usa `currentChange` (flow `running` desta coordenação, senão `loadRun`). Teste "with the plan of change A published and the flow of B running…" (pass): a filha vai para "🪪 b".
- 1.3: `groupFamily` adota no `sessions` do flow as filhas ainda não reclamadas por flow nenhum (mais o id do resultado do `start_session`, lido por `startedSessionId`) e move só as do `sessions` ou de fase do plano da change. As filhas que já existiam no `flow start` ficam em `earlier` e não entram. Mesmo teste: `move_sessions` para o grupo B leva `["self","local_b1"]`, sem `local_a1`.
- 1.4: o grupo vem do `groupId` do flow quando ainda aparece no `list_groups`; senão pelo nome. `list_groups` com erro ou sem array não cria grupo (`groupsLegible`). Testes: `model.test.ts` (`findGroupId` com texto de erro, `groupsLegible`, `groupIds`) e "a list_groups that fails creates no group; the next hook does" / "a group that already carries the change name is reused…" (pass, inclusive grupo renomeado).
- 1.5: depois de mover `self`, as filhas do `sessions` de outro flow que o app arrastou voltam ao `groupId` dele (teste: `local_a1` volta a `cg-A`). `flow start` responde "1 unarchived child session(s) of earlier changes remain…". Observação: o `list_sessions` não dá data de criação, por isso o campo extra `earlier` (filhas existentes no start).
- 1.6: `orquestrador/tests/grupos-harness.test.ts`, 4 testes.
- Portões: `claude plugin test orquestrador` saiu com 0 (375 pass, 0 fail, 31 arquivos); `tsc` (typescript 5.6.3, tipos do engine 2.1.308) saiu com 0.


- Portão de testes rodado de novo, sozinho, depois do fim da fase 3: `claude plugin test orquestrador` saiu com 0 (375 pass, 0 fail, 31 arquivos).

## Fase 2 — o mod acorda a coordenação

- 2.1: `readAutowake`/`writeAutowake` em `orquestrador/hooks/activation.ts`, no `autowake.json` da pasta de registros do mod, por `projectRoot` (o checkout principal; uma worktree lê a mesma entrada). Ausente, ilegível, JSON quebrado ou entrada sem `on: true` é desligado; gravar troca só a entrada desta raiz e substitui um arquivo quebrado. Teste `activation.test.ts` > "\"Seguir o flow sem clique\" is off when absent, on and off as written, and off when the record is broken" (pass).
- 2.2: `orquestrador/hooks/wake.ts`, puro: `eligibleChildren` (não arquivada, não a coordenação, `startedBy` da coordenação ou fase do plano via `inPlan`/`phaseViews`), `childStops` (primeira vista só grava; parada = estava rodando ou o `lastActivityAt` mudou, e agora parada; `told` evita repetir), `stopPrompt` com os dois textos do `design.md`, e `STOP_AS_USER` (constante do plano B, hoje `false`). `tests/wake.test.ts`, 8 testes (pass): primeira vista, rodando→parada, já parada na primeira vista, turno curto por `lastActivityAt`, a mesma parada duas vezes (com e sem `lastActivityAt`), arquivada, fora do plano, textos de uma e de várias sessões e o texto do plano B.
- 2.3: `wakeCoordination` em `register.tsx`, chamado no `refresh` logo depois de `loadSessions`; falha vai para `$.ui.log` e não derruba o refresh. Só age com o clone ativo (`readActivation`), a opção ligada, um flow `running` (`currentFlow`) e `coordinatorSession === self.sessionId`. O plano conta só se for da change do flow. Com a coordenação trabalhando, os títulos vão para `autowake-pending`; parada, sai um `$.prompt.submit` só, sem `asUser`, com o pendente limpo antes do envio. Opção desligada: não olha as filhas e apaga o `autowake-seen`/`autowake-pending` que houver, para que ligar depois não avise paradas antigas (o design dizia "não lê nem grava"; limpar é o que garante a linha de base nova).
- 2.4: cartão "Este projeto" (`workflows-pane.tsx`), só com o clone ativo: "Seguir o flow sem clique", pílula ligada/desligada, botão Ligar/Desligar e o texto de ajuda; textos pt-BR e en em `i18n-workflows.ts`. Testes `activation-pane.test.ts` > "2.4 \"Seguir o flow sem clique\": hidden in an inactive clone, off by default when active, and the button writes autowake.json" e "2.4 in English the option reads \"Follow the flow without clicking\"" (pass).
- 2.5: `orquestrador/tests/autowake-harness.test.ts`, 5 testes (pass), com `mock.clock`: o `session.start` real do mod registra o `$.clock.every` de 15 s e o teste avança o relógio entre os refreshes. Cobre: filha termina com a opção ligada → um aviso `Painel: a sessão "Fase local_b1" terminou o turno. Siga o flow.` (`asUser: false`), e nenhum outro nos refreshes seguintes; opção desligada → nenhum, e ligar depois não avisa a parada antiga; fora do plano e arquivada → nenhum; `coordinatorSession` de outra sessão → nenhum; coordenação trabalhando → nenhum, e ao parar um aviso só com as duas filhas.
- `$.prompt.submit` com a sessão ocupada: a documentação de tipos do engine 2.1.308 diz que o prompt é "a turn of its own, once the session is idle", ou seja, espera a sessão parar. O mod não depende disso: com `self.isRunning` ele segura o aviso no pendente.
- Portões: `claude plugin test orquestrador` saiu com 0 (391 pass, 0 fail, 33 arquivos); `tsc` (typescript 5.6.3, tipos do engine 2.1.308) saiu com 0.

### Roteiro no app real (2.6, a rodar depois do deploy da 0.13.0)

Não deu para ver ao vivo nesta fase: o app carrega o mod do marketplace (o mais novo no cache é 0.12.3) e a instalação do dono não foi mexida. Depois que a 0.13.0 estiver instalada:

1. **Ligar.** Numa coordenação com o clone ativo, abrir o painel ⚙️ (`/orquestrador-workflows`), cartão "Este projeto": a linha "Seguir o flow sem clique" aparece desligada. Apertar "Ligar"; conferir a pílula "ligada" e a entrada da raiz do repositório no `autowake.json` da pasta de registros do mod.
2. **Uma filha termina.** Com um flow `running` desta coordenação (`flow status`), deixar a coordenação parada e uma filha aberta por ela terminar o turno. Em até ~15 s a coordenação recebe, como turno novo, `Painel: a sessão "<título>" terminou o turno. Siga o flow.`
3. **A próxima sessão sem cartão.** Nesse turno a coordenação confere `flow status` e abre o passo ou a fase seguinte com `start_session` e `initiation: "user_asked"`. Esperado: a sessão começa direto, sem cartão "New task" para clicar. Anotar aqui o título da sessão aberta e a resposta do `start_session`.
4. **Coordenação ocupada.** Mandar uma mensagem à coordenação para ela ficar trabalhando e fazer duas filhas terminarem nesse meio-tempo. Esperado: nenhum aviso enquanto ela trabalha; ao parar, em até ~15 s, um aviso só, `Painel: as sessões "<a>", "<b>" terminaram o turno. Siga o flow.` Anotar se veio junto um `<side-sessions-event>` (aceitável: o segundo termina sem trabalho).
5. **Desligar.** Apertar "Desligar", deixar uma filha terminar: nenhum aviso. Ligar de novo: a parada de quando estava desligada não é avisada.
6. **Plano B, se o app recusar.** Se no passo 3 o `start_session` voltar como cartão (o app não tratou o aviso como turno do dono), trocar `STOP_AS_USER` para `true` em `orquestrador/hooks/wake.ts` (o texto passa a `Painel (opção "Seguir o flow sem clique" ligada por mim): …` e o envio leva `asUser: true`), ajustar o teste do texto em `tests/autowake-harness.test.ts`, lançar a versão de correção e repetir os passos 2 a 4.
