# Evidência — merge pelo workflow

## Fase 1 — Merge pelo workflow no plugin (1.1–1.3)

**1.1** `orquestrador/agents/merge-pelo-workflow.md`: modelo do `merge.md`, com a condição trocada: revisão de código do flow aprovada nesta volta, portões finais passados, PR mergeável e CI verde se houver checagens; não exige aprovação no GitHub; nunca `--admin`; faltando algo, não mergeia e avisa a coordenação. `plugin validate` e os testes do painel o listam (o seletor de agente lê a pasta `agents/`).

**1.2** `hooks/flow.ts` (`pendingCodeReview`) e `hooks/register.tsx` (`refuseMerge`): o `gh pr merge` do PR da change, dentro da janela do flow, é recusado enquanto um passo de revisão de código (agente `revisor-codigo` ou id `revisao-codigo`) antes do merge não tem outcome `aprovado`. "Desde a última volta" vem da própria regra do flow: entrar num passo esquece o registro dele e dos seguintes, então uma volta para executar zera a revisão. A recusa soma-se à da revisão do PR e à dos portões finais, e vai para o log de portões. Testes:
- `tests/merge-scope-harness.test.ts`: recusado sem revisão, PR alheio livre, liberado depois do `aprovado`, recusado de novo com `rejeitado`, flow encerrado não segura nada; o `flowAt` dos testes antigos passou a trazer a revisão aprovada.
- `tests/merge-deploy.test.ts` (`pendingCodeReview`): pendente sem registro ou com `rejeitado`; um `rejeitado` volta para `executar` e o registro some.

**1.3** `describeFlow`/`describeStep` dizem a aprovação do merge por agente (`merge`: aprovação no GitHub e CI; `merge-pelo-workflow`: aprovação do workflow, sem GitHub); o painel (aba Workflows) mostra a linha "Aprovação do merge" no passo aberto e a mesma ajuda sob o seletor de agente quando se edita, em pt-BR e en; as descrições dos dois agentes aparecem no seletor. Testes: `merge-deploy.test.ts` (describeFlow dos dois agentes, automático e do dono) e `workflows-pane.test.ts` (as duas ajudas).

Portões rodados depois da última edição: tipos (saída 0), validação (`Validation passed`), testes (saída 0; 352 passando).

## Fase 2 — Este repositório e versão (2.1, 2.2)

**2.1** `.orquestrador/flows/rapido.json` reescrito: planejar → validar → executar → revisao-codigo → checagem → tipos (automático, `tsc`; `falhou` volta a executar) → publicar → merge (automático, agente `merge-pelo-workflow`, só `branch: main`) → deploy (automático, `deploy: {}`) → lancar → fim; sem `qa`. Merge e deploy não escrevem `auto`, `ci` nem `commands`: herdam do `.orquestrador/config.json`, commitado junto (o `completo.json` não). O harness não lê fora da pasta do plugin, então `orquestrador/tests/rapido-repo.test.ts` traz uma cópia do JSON (manter as duas em dia) e roda `parseFlow` com as configurações do `config.json`: resolve sem erro, na ordem acima, `merge` com `auto` vindo do projeto (`fromProject: ["auto"]`), `deploy` com `ci: false`, `auto: true` e as duas rotinas de update do plugin, `lancar` terminando em `fim`, sem `qa`.
**2.2** `README.md`: os dois agentes de merge (seção do merge, biblioteca de passos e lista de agentes) e a seção "Publicação automática (este repositório)"; versão 0.10.0 → 0.11.0 em `orquestrador/.claude-plugin/plugin.json`.

Portões rodados depois da última edição: tipos (saída 0), validação (`Validation passed`), testes (saída 0; 352 passando).
