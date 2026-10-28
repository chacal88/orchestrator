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

### Regras

Revisão do diff `d8aaeb2..deb467a` pelo agente `aidakit:reviewer-quality`, contra o portão `regras` do `tasks.md`:
**aprovado**, com 0 bloqueantes, 0 importantes e 3 nits.

- Nenhum `[x]` sem evidência: as tarefas 1.1 a 1.5 têm seção aqui. O revisor rodou de novo os greps de 1.2, 1.3 e 1.4,
  e nenhum achou nada. Passou.
- Estilo do arquivo onde o código entra: passou. A posição de `PLUGIN_NAME` em `activation.ts` e as referências
  literais estão justificadas pelo limite do engine e documentadas.
- Nenhum texto ao dono exige palavra: o diff não acrescenta nenhum. Passou.

Os nits:
1. O texto da 1.3 no `tasks.md` ainda dizia `PLUGIN_NAME` em `register.tsx`. Ganhou uma nota com o desvio.
2. As skills ainda chamam `mcp__orquestrador__flow` e `…__plano`. Isso é da fase 2 (2.4), e não sai release entre as
   fases 1 e 2.
3. `PANE = PLUGIN_NAME` amarra o id do painel ao nome do plugin. É o comportamento de antes (§5), e o código ficou
   como estava.

## Fase 2 — agentes, skills e `.orchestrator/`

### Testes

Antes, no commit `d9df200` (fim da fase 1): 480 testes em 37 arquivos, todos `(pass)` (seção da fase 1).

Primeira rodada depois do código, antes de mexer nos testes: 456 pass, 24 fail. Todas as falhas eram asserts com os
nomes antigos: agentes, marcador do hook e `.orquestrador/` num projeto sem pasta, que agora grava em `.orchestrator/`.
Os testes passaram aos nomes novos, e nenhum foi removido. O `tests/rapido-repo-flow.ts`, cópia do
`.orquestrador/flows/rapido.json` real deste repo, ficou com os nomes antigos de propósito: é a entrada dos testes da 2.2.

Depois:

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orchestrator
 498 pass
 0 fail
Ran 498 tests across 37 files.
exit=0
```

480 → 498: 18 testes novos, todos `(pass)`.

- 2.2, em `rapido-repo.test.ts`, com o `rapido.json` real:
  - `the old agent names of the repository flow load as the new ones`;
  - `with the old names, the merge stays automatic on the workflow approval, never "The owner merges"`;
  - `with the old names, the step that opens the PR still cites its number`: o `changePrs` acha o `#812` da nota do
    `publicar`, cujo agente é `abre-pr`;
  - `a flow state saved with "revisor-codigo" reads as code-reviewer, and the review still waits on aprovado`. Sem
    normalizar, um passo de revisão reconhecido só pelo agente não é esperado. Normalizado, é esperado até o `aprovado`;
  - `normalizeAgents leaves a new name and an unknown name as they are`. Inclui `constructor`, que não cai no protótipo.
- 2.2, nota da revisão do plano, em `flow-agent-harness.test.ts`: `a flow going since 0.14.1, with "revisor-codigo" in
  its saved state, reads as code-reviewer by change and in the list`. O teste muda o arquivo de estado em disco para o
  nome antigo. O `flow status` com `change` passa pelo `loadFlowState`, e sem `change` pelo `allFlowStates`. Os dois
  dizem `Agente: "code-reviewer" (do plugin)`, e nenhum cita `revisor-codigo`.
- 2.3, em `flow-agent-harness.test.ts`:
  - `a project agent under the old name (.orquestrador/agents/planejador.md) is the one a flow asking for planner gets`;
  - `with planner.md and planejador.md in the project, planner.md wins`;
  - `with neither in the project, the plugin's agent comes`.

  O `10.7 listAgents` de `workflows-pane.test.ts` passou a conferir que o `revisor-codigo.md` do projeto aparece como
  `code-reviewer`, uma vez só.
- 2.5, em `project-config.test.ts`:
  - `only .orquestrador/: config and flows are read from it, marked legacy`;
  - `only .orchestrator/: config and flows are read from it`;
  - `both folders: the new one wins, and nothing of the old is mixed in`;
  - `a project with no folder reads none, and its folder is the new one`;
  - `a save of the settings in a legacy project goes to .orquestrador/; with no folder, to .orchestrator/`.
- 2.6, em `activation.test.ts`:
  - `the hook cites /orchestrator:panel and reads the new level variable before the old one`;
  - `the activation file written by 0.14.1 reads as active; "Desativar" takes its hook out, and reactivating leaves one
    hook`. O hook do teste é o texto exato da 0.14.1, com `# orquestrador:ativar`.
- 2.8:
  - em `workflows-pane.test.ts`, `a project still on .orquestrador/: the texts name it, the save goes there, and ⚙️ says
    to rename it`. O aviso de salvar cita `.orquestrador/flows/rapido.json`, o arquivo é gravado lá, e nada vai para
    `.orchestrator/`;
  - em `workflows-pane.test.ts`, `a new project: the save names .orchestrator/flows/<id>.json, and ⚙️ shows no rename
    warning`;
  - em `flow-agent-harness.test.ts`, `an agent no file holds is said so, without an error, naming the folder the project
    uses`. Num projeto novo, o aviso diz `nem .orchestrator/agents/planner.md`. Num projeto `legacy`, diz
    `nem .orquestrador/…`.

### Tipos

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.309 (plugin-authoring), hooks + types + tests de orchestrator/
(sem saída)
exit=0
```

### Validação

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin validate orchestrator
  ❯ ./register.tsx hooks: session.start, command.run{command=orquestrador}, command.run{command=orquestrador-workflows}, …
⚠ Found 1 plugin directory warning: ICON_MISSING (já existia; não muda o resultado)
✔ Validation passed
exit=0
```

### Tarefas

- 2.1: `git mv` dos seis agentes, com o `name:` acompanhando: `planner`, `plan-reviewer`, `code-reviewer`, `pr-opener`,
  `publisher` e `workflow-merge`. Passaram aos nomes novos:
  - os flows padrão;
  - `WORKFLOW_MERGE_AGENT` e `CODE_REVIEW_AGENT`;
  - `model.ts:221`;
  - as seis comparações de `i18n-workflows.ts`.

  `grep -rn "planejador\|revisor-plano\|revisor-codigo\|abre-pr\|publicador\|merge-pelo-workflow" orchestrator/hooks
  orchestrator/agents` só acha as seis linhas do mapa `LEGACY_AGENTS` (`flow.ts:851-856`).
- 2.2: `LEGACY_AGENTS` e `normalizeAgents` ficam em `flow.ts`.
  - O `resolveFlow` passou a envolver o corpo antigo, agora `resolveRaw`, e normaliza a saída.
  - O `parseFlow` compara o agente da revisão de código já pelo nome novo (`currentAgent`). Assim, um flow de projeto
    com `revisor-codigo` continua exigindo `aprovado`.
  - Em `register.tsx`, um `readFlowState` normaliza o `state.flow`. Ele serve ao `loadFlowState` e também ao
    `allFlowStates`, como pediu a nota da revisão do plano.

  Desvio: `grep -n "LEGACY_AGENTS" orchestrator/hooks/*.ts*` acha a definição, o `currentAgent` (o helper do
  `normalizeAgents`), o `findAgent` e o `listAgents`. O `listAgents` é o que a 2.3 pede.
- 2.3: o `findAgent` procura nesta ordem:
  1. `<pasta>/agents/<nome>.md`;
  2. o arquivo do projeto com cada nome antigo que o mapa leva ao nome pedido;
  3. o arquivo do plugin.

  O `listAgents` mostra o arquivo antigo do projeto sob o nome novo, e o novo ganha quando os dois existem. O leitor de
  frontmatter passou a tirar as aspas de um valor entre aspas duplas, por causa da 2.7.
- 2.4: `git mv skills/change-orchestrator skills/change` e `git mv skills/instalar skills/install`, com `name:`
  `change` e `install`. As skills agora:
  - chamam `mcp__orchestrator__flow` e `mcp__orchestrator__plan`;
  - citam `/orchestrator:panel`, `:open`, `:approve`, `:reject`, `:end`, `:workflows`, `:install` e `:change`;
  - usam os agentes novos (`workflow-merge`);
  - a `install` grava em `.orchestrator/`.

  `grep -rn "orquestrador\|change-orchestrator\|instalar" orchestrator/skills` só acha as duas menções à pasta antiga,
  lida por compatibilidade: `change/SKILL.md:252` e `install/SKILL.md:29`.
- 2.5: `projectDir($, root)`, em `project-config.ts`, devolve `{ dir, name, legacy }`. O `name` é o nome relativo que
  os textos citam (§4). Passam por ela:
  - o `loadConfig`, com o campo novo `folder`;
  - o `loadFlows`, com o campo novo `name`;
  - o `findAgent` e o `listAgents`;
  - o "Salvar" das configurações e o do editor de workflows.

  `CONFIG_PATH` passou a `.orchestrator/config.json`, e o `parseConfig` recebe o caminho real para nomear os problemas.
  O cartão ⚙️ "Este projeto" mostra o aviso de `legacy`, em pt-BR e en.
- 2.6: `HOOK_MARK = 'orchestrator:activate'` e `LEGACY_HOOK_MARK = 'orquestrador:ativar'`. O "Desativar" e a
  reativação acham o hook pelos dois. O `HOOK_COMMAND` lê `${ORCHESTRATOR:-${ORQUESTRADOR:-barrar}}` e cita
  `/orchestrator:panel`. A marca no `env` continua `ORQUESTRADOR`, então um clone ativado na 0.14.1 segue ativo. Os
  testes de `activation.test.ts` passam, e os dois novos aparecem como `(pass)`.
- 2.7: o `description` foi para aspas duplas em `planner`, `code-reviewer` e `deploy`, os três com `: `. As skills não
  têm `: ` na descrição. `grep -nE '^description: [^"].*: ' orchestrator/agents/*.md orchestrator/skills/*/SKILL.md`
  não acha nada, e o `validate` com o 2.1.309 sai 0.
- 2.8:
  - As constantes de `i18n-workflows.ts` viraram funções de `dir`, nas duas línguas: `replacesDefault`,
    `problemsHelp`, `about`, `saved`, `notObject` e `notJson`.
  - `workflows-pane.tsx` tira os caminhos relativos do `name` do `loadFlows` e do `loadConfig`. O `problemParts` corta
    em `/flows/`.
  - O `configText` recebe a pasta.
  - O `describeStepAgent` recebe a pasta do `projectDir`.

  `grep -rn "\.orquestrador/" orchestrator/hooks` só acha o aviso de `legacy`, em pt-BR e en. O
  `LEGACY_DIR = '.orquestrador'` não tem barra.

Ficou fora do escopo, como pedido:
- os comandos `/orquestrador …` e os textos do `i18n` que os citam, que são da fase 3;
- a pasta de registros do mod (`registryDir`), que fica com o nome antigo nesta versão (§4);
- a config deste repo em `.orquestrador/`, que é da tarefa 7.2.

## Fase 3 — comandos com prefixo

### Prova do prefixo

Primeiro foram criados só o `orchestrator/commands/status.md` e um hook provisório,
`on('command.run', { command: 'orchestrator:status' }, …)`, que respondia `{ text: 'PROVA: o mod respondeu
/orchestrator:status' }` sem `next`. O plugin foi carregado por `--plugin-dir`, com o binário do app (2.1.309):

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude -p "/orchestrator:status" --plugin-dir orchestrator --max-turns 1
orchestrator: PROVA: o mod respondeu /orchestrator:status
exit=0
```

Apareceu o texto do mod, com o nome do plugin na frente, e não o prompt do arquivo. O modelo não foi chamado. O comando de
markdown chega ao `command.run` como `orchestrator:status`, então o matcher literal pega.

O `validate` listou o hook como `command.run{command=orchestrator:status}`, com a nota `gating hook without .catch`. Os
antigos apareciam como `answers its own command`, porque o comando era do próprio `$.command.register`. Na versão final,
os nove hooks têm o mesmo `.catch` dos outros hooks de portão do arquivo, e o `validate` os lista como
`gating hook with .catch`. Se um hook falhar, o comando segue para o texto do `.md`.

**Caminho escolhido: o hook.** O plano B (`mcp__orchestrator__command`) não entra. O corpo de cada `.md` é só o texto de
reserva do §1: diz ao modelo que o mod não respondeu, pede que ele não tente a ação e que avise o dono para abrir o
app ou reinstalar.

Desvio: a prova rodou numa sessão headless (`claude -p`) do binário do app, e não numa sessão interativa do desktop. O
engine é o mesmo, e o `CommandRunResult.exitCode` documenta o `command.run` no modo headless. A conferência no desktop,
com o menu `/orchestrator`, é a tarefa 6.4.

Com os hooks finais, a mesma chamada responde:

```
$ … command claude -p "/orchestrator:status" --plugin-dir orchestrator --max-turns 1
orchestrator: Esse comando só vale digitado por você, no prompt ou no Remote Control.
$ … command claude -p "/orchestrator:help" --plugin-dir orchestrator --max-turns 1
orchestrator: Esse comando só vale digitado por você, no prompt ou no Remote Control.
```

O `-p` chega com a origem `sdk`, que não é o dono. A recusa é o comportamento certo, e mostra que o hook pegou os dois
nomes, sem passar pelo modelo.

### Testes

Antes, no commit `e6b468a` (fim da fase 2): 498 testes em 37 arquivos, todos `(pass)`.

Depois:

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orchestrator
 500 pass
 0 fail
Ran 500 tests across 37 files.
exit=0
```

498 → 500: 2 testes novos, e nenhum foi removido.

- Novos, em `comando-harness.test.ts`:
  - `help lists the eleven commands, one per line, in plain text`;
  - `/orquestrador and /orquestrador-workflows are no longer registered, and no command is: the plugin's come from
    commands/`. Ele roda o `session.start`, confere que as ferramentas `plan` e `flow` foram registradas e que nenhum
    `$.command.register` aconteceu.
- Mudados em `comando-harness.test.ts`: o `run` passou a disparar `command.run` com `orchestrator:<ação>`, e todos os
  testes de `/orquestrador <sub>` foram portados:
  - `panel opens and closes the pane as /orquestrador with no argument did, for any origin`: abre com o `composer` e
    fecha com uma origem `plugin`;
  - `only composer and bridge are the owner…`: cada ação que decide algo (`approve`, `reject`, `open`, `status`,
    `help`, `skip-gate`, `end`) recebe `notFromOwner` de uma origem `plugin`, `peer` etc. `panel` e `workflows` abrem
    para qualquer origem;
  - `the release step is refused…, and approve with nothing after it is only the help`: substitui o caso do
    `liberar`, que não existe mais como palavra;
  - os textos esperados citam `/orchestrator:open` e `/orchestrator:end`, e o `consent` do `start_session` passou a
    `The user typed "/orchestrator:open".`.
- `command.test.ts`: os 6 testes de `parseCommand` viraram 6 de `parseAction(action, args)`.
- `workflows-pane.test.ts` e `panel-flow.test.ts` disparam `orchestrator:panel` e `orchestrator:workflows`.
  `pendentes-harness.test.ts` espera `/orchestrator:open` no toast.

### Tipos

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.309 (plugin-authoring), hooks + types + tests de orchestrator/
(sem saída)
exit=0
```

### Validação

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin validate orchestrator
  ❯ ./register.tsx hooks: session.start, command.run{command=orchestrator:status}, command.run{command=orchestrator:approve},
    command.run{command=orchestrator:reject}, command.run{command=orchestrator:open}, command.run{command=orchestrator:skip-gate},
    command.run{command=orchestrator:end}, command.run{command=orchestrator:panel}, command.run{command=orchestrator:workflows},
    command.run{command=orchestrator:help}, ui.render{component=Pane, requestId=?}, …
  ❯ ./register.tsx gating hook with .catch: command.run{command=orchestrator:status} (e os outros oito)
⚠ Found 1 plugin directory warning: ICON_MISSING (já existia; não muda o resultado)
✔ Validation passed
exit=0
```

### Tarefas

- 3.1: a prova está acima. O caminho é o hook.
- 3.2: há nove arquivos em `orchestrator/commands/` (`ls | wc -l` = 9): `status`, `approve`, `reject`, `open`,
  `skip-gate`, `end`, `panel`, `workflows` e `help`. Cada um tem o `description` do mockup, entre aspas duplas (2.7).
  `approve`, `reject`, `skip-gate` e `end` têm `argument-hint` (`[nota]`, `[nota]`, `[N]` e `[motivo]`). O corpo é o
  texto de reserva do §1. Em `register.tsx`, cada arquivo tem um hook `command.run` com o nome literal
  (`orchestrator:<ação>`), e todos chamam o mesmo `runCommand($, action, args, origin)`, por meio de
  `answerCommand`. O `validate` lista os nove.

  Desvio: o matcher e o hook são literais escritos nove vezes, sem laço e sem `${PLUGIN_NAME}`. Com uma função de
  fábrica (`answer('status')`), o engine recusou o módulo: `the hook is not a function literal or the name of one`.
  Com um nome montado, o `validate` mostraria `command=?`, como no `requestId=?` do painel de workflows.

  Para a fase 4, `command.ts` ganhou `ACTIONS`, o tipo `Action` e o `parseAction(action, args)`. `approve`,
  `skip-gate` e `end` mantêm a forma de hoje (`<saída> [nota]`, `<fase> <portão> confirmar`, `[motivo] confirmar`).
  `reject` é o esboço: guarda a nota e responde `Por enquanto, peça ajustes pelo botão do painel.`. A fase 4 troca
  isso pelo `pickOutcome`.
- 3.3: saíram os dois `$.command.register` (`orquestrador` e `orquestrador-workflows`), os hooks deles, o
  `parseCommand` por palavra e os textos `description` e `workflowsDescription` do `i18n`, que só o registro usava.
  `panel` e `workflows` chamam o `togglePane` e o `toggleWorkflowsPane` de hoje. Os textos citam `/orchestrator:<ação>`:
  - a ajuda (`i18n.ts`, pt-BR e en), agora com os onze comandos e as descrições do mockup;
  - o `appRefused`, o `appRefusedMobile` e o `approveEnd`;
  - o `consent` do `openPending`;
  - os comentários de `register.tsx`, `command.ts` e `workflows-pane.tsx`.

  Desvio na verificação: `grep -rn "/orquestrador\b\|'orquestrador'\|orquestrador-workflows" orchestrator/hooks` ainda
  acha quatro linhas, todas da pasta de registros `~/.claude/orquestrador`: `activation.ts:114` (`registryDir`),
  `register.tsx:1111-1112` (`MENTIONS_PROTECTED_DIR`) e `gates.ts:370` (`PROTECTED_DIR`). O `\b` do grep também casa
  `/` e crase, além do que a tarefa descreve. Essa pasta fica com o nome antigo nesta versão (§4 e fase 2). Com o padrão
  que a tarefa descreve (espaço, `:`, aspas ou fim de linha), `grep -rnE "/orquestrador([ :'\"]|$)|'orquestrador'|orquestrador-workflows"
  orchestrator/hooks` não acha nada (exit 1).
- 3.4: os testes de harness estão listados acima: `panel` abre e fecha, `help` lista os onze comandos, uma origem
  `plugin` recebe `notFromOwner` e `/orquestrador` não é mais registrado. Todos aparecem como `(pass)`.

Ficou fora do escopo, como pedido:
- o comportamento sem palavra-chave (`approve` e `reject` automáticos, `end` sem `confirmar`, `skip-gate` por número),
  que é da fase 4;
- a pasta `~/.claude/orquestrador` dos registros do mod;
- a config deste repo em `.orquestrador/`.

## Fase 4 — nenhum comando exige palavra

### Testes

Antes, no commit `ec82af8` (fim da fase 3), numa cópia do `orchestrator/` desse commit (`git archive`): 500 testes em
37 arquivos, todos `(pass)`.

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orchestrator
…
(pass) C10: approve with nothing after it, at the grill, records fechado and goes to the mockup, as the click does
(pass) approve and reject on a step that is not the owner's say the step and who answers it, and change nothing
(pass) C8: status through the bridge, at the mockup, is the mockup's four plain lines
(pass) C10: reject with free text at the mockup records ajustes with that note, as "Pedir ajuste" does
(pass) C10: reject at production, which has no adjustments, says so and points to approve; the flow does not move
(pass) C12: skip-gate lists the open gates numbered; a number the list does not have, or no number, answers the list
(pass) C12: skip-gate 2 asks; the same again within 60 s skips the gate the panel skips
(pass) C12: the repetition after 121 s only asks again, and the one right after that skips
(pass) C12: skip-gate 2 then skip-gate 1 skips neither; 1 again then skips only that one, and the ask is gone
(pass) C12: when the list changes between the two, the gate now numbered N is never skipped on the old ask
(pass) skip-gate and status read the open gates from disk: with the mod's state emptied, as a reinstall leaves it, they are still listed
(pass) C11: end ends the flow at once, as the second press of the button does, and nothing is sent
(pass) C11: end mudou o escopo leaves the flow aborted with that note, in one call; a plugin origin is refused and the flow runs on
(pass) on an escalation approve tries again, as its first button, and reject points to end; nothing asks for a word
(pass) pickOutcome > completo: the owner's five steps, as the design's table
(pass) pickOutcome > rapido: the owner's steps
(pass) pickOutcome > a project flow with two outcomes forward takes the first declared, and one back to an earlier step is the adjustment
(pass) pickOutcome > a step without adjustments is none; an outcome to an unknown step counts for neither
(pass) pickOutcome > an escalation goes forward by trying again and has no adjustments
(pass) statusText > the mockup's answer: the flow, the step and both commands spelled out whole
(pass) gateList > numbered, phases first, with how to skip one, as the mockup
…
 517 pass
 0 fail
Ran 517 tests across 37 files.
exit=0
```

500 → 517: 17 testes a mais, nenhum removido sem substituto. O que mudou:

- `command.test.ts`:
  - os testes de `parseAction` de `approve`, `skip-gate` e `end` passaram à forma sem palavra. O texto depois de
    `approve` é nota, até `fechado`. `skip-gate` aceita só um número positivo, e `x`, `0`, `2.5` e `2 testes confirmar`
    são a lista. `confirmar` depois de `end` é só uma palavra do motivo;
  - entraram 5 testes de `pickOutcome`, 3 de `statusText` e 1 de `gateList`.
- `comando-harness.test.ts`:
  - o mundo ganhou `advance(ms)`, o relógio que o teste move;
  - ganhou também `ownState`, que guarda o `$.state` do mod no mundo para o teste esvaziar como a reinstalação. Só os
    testes sem painel usam, porque com esse estado o painel não desenha os botões;
  - os testes de `aprovar <saída>`, `pular-portão … confirmar`, `encerrar confirmar` e `aprovar encerrar` viraram os
    testes C10, C11 e C12 acima;
  - o teste de "saída que o passo não declara" virou o de "passo que não é do dono".

### Tipos

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.309 (plugin-authoring), hooks + types + tests de orchestrator/
(sem saída)
exit=0
```

### Validação

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin validate orchestrator
  ❯ types ./types/index.d.ts declares state: …, orchestrator.skip-ask, …
  ❯ ./register.tsx state writes: …, orchestrator.skip-ask, …   state reads: …, orchestrator.skip-ask, …
⚠ Found 1 plugin directory warning: ICON_MISSING (já existia; não muda o resultado)
✔ Validation passed
exit=0
```

### Tarefas

- 4.1: `pickOutcome(state, 'forward' | 'adjust')` em `command.ts`. Ela devolve `{ outcome } | { none: true }` pela
  posição do `next` em `state.flow.steps`:
  - para frente é um passo depois do atual, `fim` ou `$seguinte`;
  - ajuste é o próprio passo ou um anterior;
  - um `next` desconhecido não conta para nenhum lado;
  - vale a primeira saída declarada;
  - numa escalada, para frente é `escalationChoices()[0]` (`tentar-de-novo`), e não há ajustes.

  Os testes cobrem os cinco passos do `completo` (a tabela do §2), `qa` e `producao` do `rapido`, um flow de projeto
  com duas saídas para frente e uma para trás, e o caso `none`.
- 4.2: `approve [nota]` chama o `pressFlow` com a saída "forward" e a nota, a mesma chamada do botão. Numa escalada, o
  passo é o da escalada e a saída é `tentar-de-novo`. Num passo que não é do dono, a resposta é
  `O passo atual (<título>) não é seu: quem responde é <quem>.`. Num passo em que o dono só confirma (o deploy à
  espera do CI), vale a única escolha que o painel mostra. O teste C10 compara o estado, o log (`kind: outcome`,
  `by: owner`) e o aviso à coordenação com os do clique em `flow:grill:fechado`, e a resposta é
  `Registrado: Entendimento fechado. Próximo passo: Mockup.`.
- 4.3: `reject [nota]` usa a saída "adjust" com a nota, e a resposta repete a nota, como no mockup:
  `Registrado: Pedir ajustes (nota: trocar skip-gate por skip). Próximo passo: Mockup.`. O toast do clique não muda: o
  `pressedToast` ganhou um `note` opcional, que só o comando passa. Sem saída de ajustes, a resposta é
  `O passo atual (<título>) não tem opção de ajustes. Para seguir: /orchestrator:approve`. Numa escalada, ela aponta
  `/orchestrator:end [motivo]`.

  Desvio do texto do mockup: o mockup diz `(Está em produção)`, que é o rótulo da saída. O código usa o título do
  passo, `(Em produção)`, como a tarefa pede (`<título>`).
- 4.4: `end [motivo]` chama o `endByOwner` direto, sem confirmação. Saíram o `endAsk`, o `approveEnd` e o
  `confirmation` de `command.ts`. A resposta é `Flow de b encerrado (motivo: mudou o escopo).`, ou
  `Flow de b encerrado.` sem motivo. O toast do botão "Encerrar o flow" usa o mesmo texto. O
  `grep -n "confirmar\|endAsk" orchestrator/hooks/command.ts orchestrator/hooks/i18n.ts` não acha nada (exit 1).

  Para isso, o aviso `tampered` do `i18n.ts`, da ativação mudada fora do painel, passou de "até você confirmar por aqui"
  para "até você escolher de novo por aqui". Ele fala de um botão do painel, não de uma palavra. O texto equivalente em
  `i18n-workflows.ts` fica como está, porque está fora do grep e da fase.
- 4.5: `skip-gate [N]`, com a chave `skip-ask` em `types/index.d.ts` e `SKIP_CONFIRM_MS = 120_000` em `command.ts`:
  - sem número, ou com um número fora da lista, a resposta é a lista numerada
    (`1. fase 2: testes` … `Para pular: /orchestrator:skip-gate N`), e nada é gravado;
  - `skip-gate N` grava `{ change, phase, gate, n, at }` e pergunta
    `Pular "<rótulo>"? Rode /orchestrator:skip-gate N de novo em até 2 minutos.`;
  - a repetição só pula se a chave tem a mesma change e o mesmo N, se passaram no máximo 120 s (`$.clock.now()`), e
    se o portão número N de agora é o mesmo `phase`/`gate`. Antes de pular, a chave vira `null`. Fora isso, grava de
    novo e pergunta de novo.

  O pulo usa o mesmo `skipGate` do painel, e o teste compara o `gates/b.json` com o do clique.

  `openGatesFor($, flow)` substitui o `openGatesNow`. Ela lê do disco o plano (`runs/<change>.json`), os pulos
  (`loadSkips`) e os arquivos de atividade das sessões (`freshActivity`, que o `loadSessions` também passou a usar).
  Os registros da própria sessão vêm do `ownCheck`, depois do `restoreActivity`. Ela monta a lista com o mesmo
  `phaseViews`/`gateViews`/`familyCheck`.

  Uma sessão de fase é achada pelo id no arquivo de atividade. Pelo nome ou pelo título, só pelas filhas que o painel
  listou por último. Uma sessão não achada deixa os portões abertos, como no painel. O `status` usa a mesma função.

  Desvio: o `refresh` não monta lista de portões. O painel desenha os portões do `PanelView`, então não há o que trocar
  lá. A ordem é a mesma porque as duas partem de `phaseViews` sobre o mesmo plano.

  O teste extra esvazia o `$.state` (`ownState` e `w.kept.clear()`), e o `skip-gate` e o `status` ainda listam os dois
  portões. O `grep -n "openGatesNow" orchestrator/hooks/register.tsx` não acha nada (exit 1).
- 4.6: o `status` responde no molde do mockup:

  ```
  Flow de <change> (<flow>): em andamento
  Passo: <título> (você)
  Para seguir: /orchestrator:approve
  Para pedir ajustes: /orchestrator:reject <o que mudar>
  ```

  - a linha do `reject` só aparece quando o `pickOutcome(…, 'adjust')` acha uma saída;
  - a palavra do estado vem do `i18n`, por exemplo `em andamento` ou `parado no limite de tentativas`;
  - um passo que não é do dono diz quem responde e não oferece comando;
  - numa escalada, o status oferece `Para tentar de novo: /orchestrator:approve` e
    `Para encerrar: /orchestrator:end [motivo]`;
  - depois vêm os portões abertos (`Portões abertos: fase 2: testes, final: check`), as sessões pendentes e o aviso de
    permissão.

  O teste C8, com `origin: { kind: 'bridge' }` no mockup, confere as quatro linhas exatas, sem `|`, `#`, `*`, crases
  nem marcador de lista.

Ficou fora do escopo, como pedido: o `sessionFlow` (o `openGatesFor` recebe o flow do `commandFlow`, e a fase 5 o troca),
o `background` das sessões pendentes, o README, a versão e a config deste repo em `.orquestrador/`.

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
