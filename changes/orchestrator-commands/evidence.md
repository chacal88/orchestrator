# Evidência — comandos do orchestrator (0.15.0)

Esqueleto do passo `planejar`: só `changes/orchestrator-commands/` mudou, nenhum código de produção. Cada fase
preenche a sua seção com a saída real dos portões, e nenhuma tarefa é marcada no `tasks.md` sem a evidência aqui.

## Plano

Branch `claude/orchestrator-command-reorganize-117386`, binário do app 2.1.309.

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin validate orquestrador
  ❯ ./register.tsx hooks: session.start, command.run{command=orquestrador}, command.run{command=orquestrador-workflows}, …
  ❯ ./register.tsx answers its own command: command.run{command=orquestrador}
  ❯ ./register.tsx answers its own command: command.run{command=orquestrador-workflows}
⚠ Found 1 plugin directory warning: ICON_MISSING (já existia; não muda o resultado)
✔ Validation passed
exit=0
```

Resposta à pergunta do planejamento: `$.command.register` não aceita `:`. `CommandSpec.name` só aceita letras,
dígitos, `_` e `-`. Os comandos com prefixo vêm de `commands/*.md` e de skills, e um hook `command.run` responde cada
um. Detalhes e plano B no `design.md`, §1.

## Fase 1 — pacote em inglês

### Testes

Antes do `git mv`: _a preencher_ (número de testes). Depois: _a preencher_.

### Tipos

_a preencher_

### Validação

_a preencher_

## Fase 2 — agentes, skills e `.orchestrator/`

### Testes

_a preencher_

### Tipos

_a preencher_

## Fase 3 — comandos com prefixo

### Prova do prefixo

_a preencher_: o que aparece ao digitar `/orchestrator:status`, o que o `validate` lista para o hook e o caminho
escolhido (hook ou plano B).

### Testes

_a preencher_

### Tipos

_a preencher_

### Validação

_a preencher_

## Fase 4 — nenhum comando exige palavra

### Testes

_a preencher_

### Tipos

_a preencher_

## Fase 5 — painel da sessão e sessões pendentes

### O teste falha sem a correção

_a preencher_: a 5.3 e a 5.5 rodadas com o código de antes.

### Testes

_a preencher_

### Tipos

_a preencher_

## Fase 6 — README, versão e conferência

### Testes

_a preencher_

### Tipos

_a preencher_

### Validação

_a preencher_

### Produção

_a preencher_: a produção desta change é a reinstalação do dono (`design.md`, §10).

### Conferência no app

_a preencher_: o menu ao digitar `/orchestrator` e o `/orchestrator:status` no desktop e pelo Remote Control.

## Fase 7 — com o dono

_a preencher_: o ok do dono, o `gh repo view` e a migração da pasta deste repo.
