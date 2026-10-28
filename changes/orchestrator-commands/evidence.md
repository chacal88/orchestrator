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

Antes do `git mv`, no commit `d8aaeb2`:

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orquestrador
 480 pass
 0 fail
Ran 480 tests across 37 files.
exit=0
```

Depois:

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orchestrator
 480 pass
 0 fail
Ran 480 tests across 37 files.
exit=0
```

480 antes e 480 depois. A lista de nomes `(pass)` das duas rodadas, sem os tempos, é idêntica (`diff` vazio): nenhum
teste saiu nem mudou de nome.

A primeira rodada depois da troca deu 222 falhas, todas com o mesmo erro do engine: `$.state.get takes a reference
whose plugin and key are string literals`. As referências de estado tinham passado a `plugin: PLUGIN_NAME`. Voltaram a
um literal, `plugin: 'orchestrator'`. `PLUGIN_NAME` (em `activation.ts`, módulo folha que `register.tsx` e
`workflows-pane.tsx` já importam) ficou só onde é valor comum: `PANE` e a comparação `next.origin.plugin` do
`tool.check`.

### Tipos

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.309 (plugin-authoring), hooks + types + tests de orchestrator/
(sem saída)
exit=0
```

### Validação

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin validate orchestrator
  ❯ types ./types/index.d.ts declares state: orchestrator.view, orchestrator.plan, …, orchestrator.wfActivate
  ❯ ./register.tsx hooks: session.start, command.run{command=orquestrador}, command.run{command=orquestrador-workflows}, …
  ❯ ./register.tsx state writes: orchestrator.answered, …   state reads: orchestrator.answered, …
⚠ Found 1 plugin directory warning: ICON_MISSING (já existia; não muda o resultado)
✔ Validation passed
exit=0
```

Os comandos `orquestrador` e `orquestrador-workflows` continuam registrados: eles só mudam na fase 3.

### Tarefas

- 1.1: `git mv orquestrador orchestrator`. O `git status` mostra 82 entradas `R`/`RM`, nenhuma `D`+`A`. O `.gitignore`
  passou a `orchestrator/.claude-plugin/types/`. O `orchestrator/tsconfig.json` só estende `./.claude-plugin/types`,
  e os testes não importam a pasta por caminho: nada mais a ajustar. `claude plugin test orchestrator` roda (acima).
- 1.2: `plugin.json` com `name` `orchestrator` e `homepage`/`repository` em `https://github.com/chacal88/orchestrator`.
  `marketplace.json` com `name`, `plugins[0].name` `orchestrator` e `source` `./orchestrator`; a descrição do
  marketplace começa por "Orchestrator:", e as outras ficam como estavam. `grep -rn "orquestrador" .claude-plugin
  orchestrator/.claude-plugin` não acha nada, e o `validate` sai 0.
- 1.3: `PLUGIN_NAME = 'orchestrator'` (em `activation.ts`, pelo motivo acima), `PLAN_TOOL = 'mcp__orchestrator__plan'`,
  `FLOW_TOOL = 'mcp__orchestrator__flow'`, `$.tool.register({ name: 'plan' })`, `PANE = PLUGIN_NAME`,
  `WORKFLOWS_PANE = 'orchestrator-workflows'`, título `🧭 Orchestrator`, as chaves de `$.state` de `register.tsx`,
  `workflows-pane.tsx` e `activation.ts:231` em `plugin: 'orchestrator'`, e a seção `orchestrator: {…}` em
  `types/index.d.ts:596`. `grep -rn "mcp__orquestrador\|name: 'plano'\|plugin: 'orquestrador'" orchestrator/hooks
  orchestrator/types` não acha nada.
- 1.4: "orquestrador panel" → "orchestrator panel" em `flow.ts:1158` e `register.tsx` (o prompt de sessões pendentes e
  o consentimento do clique). `i18n.ts`: "Painel do Orchestrator aberto/fechado". Os toasts `Orquestrador: …` e os logs
  `orquestrador: …` de `register.tsx` passaram a `Orchestrator:`/`orchestrator:`. Ficaram para as fases 2 e 3: os
  textos com `/orquestrador …`, `.orquestrador/`, o `HOOK_MARK` e o hook da ativação, e as frases do card de ativação
  em `i18n-workflows.ts` ("O orquestrador está quieto aqui…"), que citam o produto e não a ferramenta nem o painel.
  `~/.claude/orquestrador/` não muda nesta versão (proposta). `grep -rni "mcp__orquestrador\|painel do
  orquestrador\|orquestrador panel" orchestrator/hooks` não acha nada.
- 1.5: os testes passaram a `plugin: 'orchestrator'`, `requestId: 'orchestrator'`/`'orchestrator-workflows'`,
  `mcp__orchestrator__plan`/`flow`, título `Orchestrator` nos `props` e no painel aberto, ids de painel e os textos do
  painel e do toast do freio. `command: 'orquestrador'` e os caminhos `.orquestrador/` e `~/.claude/orquestrador/`
  ficam. 480 → 480 (acima).

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
