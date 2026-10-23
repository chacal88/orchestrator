# Evidência — sessões filhas

## Fase 1 (tarefas 1.1 a 1.5)

- 1.1 `describeStepBody` (`orquestrador/hooks/flow.ts`): o passo `session` manda abrir a sessão com `start_session`
  (`user_asked`), proíbe fazer o passo ali, manda propor cartão se o start for recusado e reportar quando a sessão
  responder; o `loop` diz "one session per phase". `grep -n "Do the step" orquestrador/hooks/flow.ts` não acha nada.
- 1.2 Dois testes novos em `orquestrador/tests/flow.test.ts` (passo `session` e `loop`).
- 1.3 e 1.5 Skill `change-orchestrator`: § 2 sem "faça ou despache", parágrafo novo com `user_asked`, o que fica com a
  coordenação, onde trabalha cada filha e o start recusado; §§ 3, 4.3, 5.1, 5.2 e 6 ajustados. O corpo do
  `agents/executor.md` passa a dizer que o aviso é a mensagem final do turno.
  `grep -n "faça ou despache"` não acha nada; `grep -n user_asked` acha o parágrafo novo.
- 1.4 Versão 0.12.3 em `orquestrador/.claude-plugin/plugin.json`.

## Portões

- Testes: `"/Users/kauesantos/Library/Application Support/Claude/claude-code/2.1.308/a93ded4b1b47/claude.app/Contents/MacOS/claude" plugin test orquestrador` — 369 pass, 0 fail, saída 0.
- Tipos: `npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json`, com os tipos do engine 2.1.308
  (`claude-code.d.ts` da skill plugin-authoring, mais `claude-code-tools` e `claude-code-mcp` do repo) num tsconfig fora
  do repo, como nas changes anteriores — saída 0.
  Obs.: `npx -y -p typescript@5.6.3 tsc --noEmit -p orquestrador` usa os tipos antigos do repo e já falha, antes desta
  change, só em `hooks/workflows-pane.tsx` (`size`/`weight` em `Text`); nenhum erro nos arquivos tocados aqui.

## Portão de testes rodado de novo

A pedido da coordenação, rodado de novo numa forma que o mod reconhece:
`export PATH="…/claude-code/2.1.308/…/MacOS:$PATH" && command claude plugin test orquestrador` — 369 pass, 0 fail, saída 0.

## Fase 2 (tarefas 2.1 a 2.5)

- 2.1 Skill § 2 (start recusado: corrente do `user_asked`), § 5.2 (reserva `ScheduleWakeup` de 1200 s ou mais; frase
  "não é confiável" removida: `grep -n "não é confiável"` não acha nada) e checklist final ajustado.
- 2.2 `flow.ts` passo `session`: "user_asked" com `wake_when_done`; o cartão vai sem `wake_when_done`. Skill diz o mesmo.
  Teste atualizado.
- 2.3 O teste do passo `session` confere também `agent, model and effort`.
- 2.4 Skill § 2: "nunca de primeira com `own_initiative`; só quando o start é recusado".
- 2.5 Skill § 4.4: portão pelo nome do comando, com PATH, sem caminho entre aspas.
- Testes: `export PATH="…/2.1.308/…/MacOS:$PATH" && command claude plugin test orquestrador` — 369 pass, 0 fail, saída 0.
- Tipos: `npx -y -p typescript@5.6.3 tsc -p <tsconfig fora do repo>` como na fase 1 — saída 0.
