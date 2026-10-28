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

Gate testes: `claude plugin test orquestrador` na raiz do repo.

```
a preencher
```

### Tipos

Gate tipos: `tsc` sobre hooks, types e tests com os tipos do engine.

```
a preencher
```

### Notas

- 1.6: o primeiro caso rodado sem as tarefas 1.1 a 1.4 falha: a preencher.

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
