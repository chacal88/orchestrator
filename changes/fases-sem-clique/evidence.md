# Evidência — fases sem clique (0.14.0)

Esqueleto do passo `planejar` (só `changes/fases-sem-clique/` mudou; nenhum código de produção). Cada fase preenche a sua seção com a saída real dos portões. Nenhuma tarefa é marcada
no `tasks.md` sem a evidência aqui.

## Plano

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin validate orquestrador
  ❯ ./register.tsx hooks: session.start, command.run{command=orquestrador}, …, tool.call, tool.check, prompt.submit, …
⚠ Found 1 plugin directory warning: ICON_MISSING (já existia; não muda o resultado)
✔ Validation passed
exit=0
```

## Fase 1 — um `get_session` por vez, e só com permissão

### Testes

Gate testes: `claude plugin test orquestrador` na raiz do repo (binário do app 2.1.309).

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orquestrador
tests/permissao-harness.test.ts:
(pass) with a get_session pending, publishing, waiting and three turns of the clock make at most one get_session
(pass) with "ask" on the session tools the clock makes no call to them, and the panel and the band say what to allow
(pass) the mod's own check marks no wait; a model tool with "ask" still does
(pass) once the owner allows, the next turn calls and the notice goes away
(pass) a phase session is refused with the reason "allow the session tools" while they are on "ask"
 417 pass
 0 fail
Ran 417 tests across 34 files.
exit=0
```

Antes: 412 testes em 33 arquivos. Entram 5 (arquivo novo). `harness`, `grupos-harness`, `autowake-harness`,
`lifecycle-harness`, `merge-scope-harness`, `pane` e `activation` ganharam uma linha no mundo falso,
`on('tool.check', … allow)`: sem ela o `$.tool.check` do `mayList` volta "ask" (o padrão do engine para uma
ferramenta MCP sem regra) e as chamadas de sessão deixam de sair. Nenhuma expectativa deles mudou.

### Tipos

Gate tipos: `tsc` sobre hooks, types e tests com os tipos do engine.

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.309 (plugin-authoring), hooks + types + tests
exit=0
```

### Notas

- 1.6: o primeiro caso (um `get_session` pendente) rodado com o `register.tsx` do commit anterior, sem as tarefas 1.1
  a 1.4, falha: `expect(count).toBeLessThanOrEqual(1)` recebe 3 (um por volta do relógio e por publicação, enquanto o
  primeiro ainda pende). Com as tarefas, passa.
- Verificações das tarefas: `grep -n selfAsk` acha a definição e o uso só em `selfId`; `GET_SESSION` aparece na
  constante, no `canCall` e na chamada de `selfRowNow` (única); toda chamada a `LIST_SESSIONS` passa por `listCall`
  (que consulta `mayList`), fora o `canCall`; nenhuma linha nova escreve em `settings*.json`.
- Decisões que a revisão do plano pediu:
  - `cleanupChange` (passo automático de lançar a versão) **passa** pelo `mayList`. Sem `get_session` o `self` fica
    indefinido e `phaseSessions` poderia contar a própria coordenação como fase para arquivar; por isso, sem `self`
    ou sem a lista, o passo registra "sessions not read" e deixa as sessões e o grupo como estão.
  - `selfId` e `selfRowNow` **passam** pelo `mayList`: são o primeiro elo do loop (`publishActivity` → `selfId`).
    `selfId` pede uma vez por vez (`selfAsk`), e `selfRowNow` junta as chamadas simultâneas e não guarda a linha.
  - O `mayList` vale para chamadas em segundo plano (refresh, `publishActivity`, `restoreActivity`, agrupamento,
    aviso, `refuseStart`, `folderIsOwn`, `loadFamily`, `openChildren`). Uma ação do dono (botão) pode chamar direto
    com "ask"; esse caminho é da fase 2 (o `openPending` passa a chamar sem recusar por falta de permissão).
  - Sem permissão, `refuseStart` recusa dizendo que falta permitir `get_session` e `list_sessions`.
  - O hook `tool.check` do mod sai cedo quando `next.origin.plugin === 'orquestrador'`.

## Fase 2 — abrir as fases sem um clique por card

### Testes

```
a preencher
```

### Tipos

```
a preencher
```

### No app

Uma linha por risco do `design.md` (§ 2, "Riscos a conferir no app"): o que foi feito, o que o app respondeu, e a
consequência.

1. `consent` no desktop: a preencher
2. `consent` pelo Remote Control: a preencher
3. `wake_when_done` de uma filha aberta pelo mod: a preencher
4. A corrente depois do clique: a preencher

## Fase 3 — `/orquestrador` com subcomandos

### Testes

```
a preencher
```

### Tipos

```
a preencher
```

## Fase 4 — skill, README e versão

### Testes

```
a preencher
```

### Tipos

```
a preencher
```

### Validação

```
a preencher
```

## Critérios de aceite

| Critério (`proposal.md`) | Evidência |
| --- | --- |
| 1. Um botão / `/orquestrador abrir` abre todas as pendentes | a preencher |
| 2. Sem aviso do mod para filha com `wake_when_done` | a preencher |
| 3. Subcomandos; `aprovar` igual ao clique; recusa com `origin` de plugin | a preencher |
| 4. Sem `liberar`; `aprovar` na liberação recusado | a preencher |
| 5. Sem gravar permissão; aviso no painel e na faixa | a preencher |
| 6. Texto simples e Remote Control | a preencher |
| 7. No máximo 1 `get_session` pendente; nenhum do refresh | a preencher |
| 8. Checagem do mod não marca espera | a preencher |
| 9. Versão 0.14.0, README, skill e portões | a preencher |
| 10. Encerrar o flow a qualquer momento, só pelo dono | a preencher |
