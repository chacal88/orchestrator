
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

