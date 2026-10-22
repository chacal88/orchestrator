## 1. Merge pelo workflow no plugin

- [x] 1.1 Agente `orquestrador/agents/merge-pelo-workflow.md`: faz o merge quando a revisão de código do flow foi aprovada, os portões finais passaram e o CI (se houver checagens) está verde; não exige aprovação no GitHub; confere o PR mergeável; nunca `--admin`; se faltar algo, não faz o merge e avisa a coordenação — cx: simple
- [x] 1.2 O mod recusa `gh pr merge` do PR da change enquanto um passo de revisão de código (agente `revisor-codigo` ou id `revisao-codigo`) antes do merge não tem "aprovado" registrado desde a última volta do flow; vale junto com a revisão do PR e os portões finais; testes (recusado sem revisão, liberado depois do aprovado, reprovado volta a recusar) — cx: moderate
- [x] 1.3 `flow status`/`describeFlow` e o painel dizem qual aprovação o merge exige conforme o agente (`merge`: aprovação no GitHub e CI; `merge-pelo-workflow`: aprovação do workflow); a descrição dos dois agentes aparece no seletor do passo Merge; testes — cx: simple

## 2. Este repositório e versão

- [x] 2.1 `.orquestrador/flows/rapido.json`: planejar → validar → executar → revisao-codigo → checagem → tipos (automático, `tsc`) → publicar → merge (automático, agente `merge-pelo-workflow`, herdando do projeto) → deploy (automático, herdando do projeto) → lancar → fim; sem `qa`; o arquivo resolve sem erro (`flow list`); commitar junto com `.orquestrador/config.json` (não o `completo.json`) — cx: simple
- [x] 2.2 README (os dois agentes de merge e a publicação automática), versão 0.11.0, evidence.md — cx: simple

## 3. Correções da revisão

- [x] 3.1 O PR da change é reconhecido também pela nota do passo que o abre (agente `abre-pr` ou `publicador`, além dos ids `pr`/`merge`); teste de harness com o `rapido.json` deste repositório parado no merge, PR citado no `publicar`, sem revisão aprovada: recusa; com revisão aprovada: passa — cx: moderate
- [x] 3.2 Variantes de `pendingCodeReview` testadas: flow sem passo de revisão; revisão com `when: visual` numa change não visual; passo reconhecido só pelo agente `revisor-codigo`; flow depois do merge. `parseFlow` recusa um passo de revisão de código (agente `revisor-codigo` ou id `revisao-codigo`) que não declare o outcome `aprovado`; README cita a exigência — cx: moderate
- [x] 3.3 Textos: a ajuda do merge automático diz a aprovação conforme o agente (GitHub ou workflow); `approval(agent)` não promete "aprovação no GitHub" para um agente do projeto desconhecido; o painel e o `describeFlow` dizem que a aprovação da revisão é declarada pela coordenação — cx: simple
