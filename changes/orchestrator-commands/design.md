# Design: comandos do orchestrator, um por ação, em inglês

Os tipos citados são os do engine 2.1.309, em `plugin-authoring/types/claude-code.d.ts` (cópia da skill em
`/private/tmp/claude-501/bundled-skills/2.1.309/…/plugin-authoring/`). Os números de linha são dessa cópia.

## 1. Como os comandos são registrados

### Pergunta: `$.command.register` aceita nomes com `:`?

**Não.** A evidência está em `CommandSpec.name`, linhas 1922 a 1927:

> The command's name without the slash (letters, digits, `_`, `-`; up to 64); the person runs it as `/<name>`.

O `:` fica fora do conjunto aceito. O `$.command.register` serve para um comando de sessão, `/<name>`, sem prefixo de
plugin. É o caso dos atuais `/orquestrador` e `/orquestrador-workflows`.

**Como o plugin expõe comandos com prefixo.** Duas evidências tiradas dos tipos:

- `CommandSource` (linhas 1910 a 1917): ``plugin` is a plugin's markdown command, skill or `$.command.register``. Os
  arquivos `commands/<nome>.md` e as skills `skills/<nome>/SKILL.md` de um plugin aparecem no menu como
  `/<plugin>:<nome>`. O repo já mostra isso hoje: `/orquestrador:change-orchestrator` e `/orquestrador:instalar`.
- `CommandRunInput.command` (linhas 1828 a 1833): ``Names the command without its slash (`compact`, `hello`), aliases
  and folds resolved; the key a matcher narrows on.`` O `CommandRunResult`, nas linhas 1865 a 1868, completa: ``A
  hook's own answer without `next` runs no command: its `text` is shown as the command's output``. Um hook
  `command.run` com o matcher `{ command: 'orchestrator:status' }` responde o comando de markdown sem rodar o prompt do
  arquivo.

### Decisão

- Cada ação de chat vira um arquivo `orchestrator/commands/<ação>.md`, com `description` no frontmatter. É o texto
  que o menu mostra, o mesmo do mockup. As ações são `status`, `approve`, `reject`, `open`, `skip-gate`, `end`,
  `panel`, `workflows` e `help`. O menu lista `/orchestrator:<ação>` ao digitar `/orchestrator` (C1).
- `change` e `install` são as skills renomeadas: `skills/change/` e `skills/install/`.
- O mod responde cada ação com um hook `command.run` que tem o nome literal (`orchestrator:status` etc.) e não chama
  `next`. A resposta é o `{ text }` do mod, sem passar pelo modelo. O Remote Control chega pelo mesmo evento, com
  `origin.kind === 'bridge'` (C8).
- O corpo de cada `.md` é o plano B do arquivo. Ele só é lido se nenhum hook responder, por exemplo com o mod
  desligado ou numa CLI sem mods. Diz ao modelo, em poucas linhas, que o comando é do mod `orchestrator` e que o mod
  não respondeu, e pede que ele diga ao dono para abrir o app ou reinstalar. O modelo não deve tentar fazer a ação.
- Os `$.command.register` de `orquestrador` e `orquestrador-workflows` saem, assim como os hooks deles (C6). Fica
  só um `PLUGIN_NAME = 'orchestrator'` em `register.tsx`, e os matchers são montados a partir dele.

### Prova antes de seguir (tarefa 3.1)

Nem os tipos nem o `reference.md` dizem com todas as letras que o nome de um comando de markdown chega ao
`command.run` como `orchestrator:status`. "Folds resolved" sugere que sim, mas é inferência. Por isso a fase 3 começa
com uma prova: um `commands/status.md` e o hook com o matcher literal. O resultado vai no `evidence.md`. A prova roda
no app, digitando `/orchestrator:status` numa sessão com o plugin carregado por `--plugin-dir`. A tarefa diz como
testar no harness, se o harness simular comandos de markdown.

**Plano B, se o hook não pegar o comando de markdown.** O corpo de cada `.md` passa a ser o caminho principal: uma
linha que manda o modelo chamar uma ferramenta nova do mod, `mcp__orchestrator__command`, com
`{ action: "<ação>", args: "$ARGUMENTS" }`. A ferramenta roda o mesmo `runCommand` e devolve o texto, que o modelo
repete sem mudar. O custo é um turno do modelo por comando, e o Remote Control continua funcionando. Se a prova
falhar, a fase 3 segue pelo plano B. Se der certo, o plano B não entra.

### Alternativas descartadas

- **`$.command.register` com nomes como `orchestrator-status`.** O nome não leva `:`, e o menu não junta os comandos
  sob `/orchestrator:`. Isso fere C1 e C2.
- **Manter `/orquestrador <sub>` com aliases em inglês.** O grill pede um comando por ação e o corte de `/orquestrador`
  (rodada 1).
- **Só arquivos de markdown, com o modelo fazendo tudo.** Cada comando gastaria um turno, e o `status` pelo celular
  dependeria do modelo. Fica apenas como plano B.

## 2. Como `approve` e `reject` escolhem a saída

O passo declara as saídas em `outcomes: Record<string, { label, next }>` (`types/index.d.ts:74-85`). A escolha usa a
posição do `next` na lista de passos do flow do estado (`state.flow.steps`), sem nenhuma palavra:

- **Seguir em frente:** a saída cujo `next` é um passo depois do atual na lista, ou o fim (`FLOW_END`), ou
  `$seguinte`.
- **Ajustes:** a saída cujo `next` é o próprio passo ou um passo antes dele.
- Se houver mais de uma em cada grupo, vale a primeira declarada, porque a ordem do JSON é a ordem dos botões no
  painel. Se não houver nenhuma, a resposta diz isso, por exemplo:
  `O passo atual (Está em produção) não tem opção de ajustes. Para seguir: /orchestrator:approve`.

| Passo do `completo` | `approve` | `reject` |
| --- | --- | --- |
| `grill` | `fechado` → mockup | não há ajustes |
| `mockup` | `aprovado` → planejar | `ajustes` → mockup |
| `liberacao` | `liberado` → executar | `ajustes` → planejar |
| `qa` | `aprovado` → producao | `ajustes` → executar |
| `producao` | `publicado` → arquivar | não há ajustes |

**Escalada** (`state.status === 'escalated'`):

- `approve` é `tentar-de-novo`, que é `escalationChoices()[0]` em `flow.ts:39-41`.
- `reject` responde que uma escalada não tem ajustes e aponta `/orchestrator:end`. Encerrar continua sendo o `end`.

**Passo atual que não é do dono**, sem escalada: a resposta diz qual é o passo e quem o responde, como o `pressFlow`
já recusa hoje.

O texto depois do comando vira a `note` do `pressFlow`, a mesma chamada do botão do painel. Por isso o `approve` "fecha
o entendimento igual ao botão" (C10).

A função pura fica em `command.ts`: `pickOutcome(state, 'forward' | 'adjust')` devolve
`{ outcome } | { none: true }`. Ela tem teste próprio em `command.test.ts`, com os passos dos dois flows padrão e um
flow de projeto que tem duas saídas para frente.

**Alternativa descartada: um campo novo `role: 'forward' | 'adjust'` em cada saída.** Ele obrigaria a editar todos os
flows de projeto e os do editor de workflows, e um flow antigo sem o campo ficaria sem `approve`. A posição do `next`
já diz a mesma coisa nos flows que existem. Se um projeto declarar algo fora desse padrão, o campo pode vir depois.

## 3. O estado de 2 minutos do `skip-gate`

- **De onde vêm os portões.** Hoje o `openGatesNow` (`register.tsx:2070-2088`) lê a última vista do painel
  (`$.state` `VIEW`). A reinstalação zera essa chave (§5): sem um refresh, o `skip-gate` e o `status` diriam "nenhum
  portão aberto". A função passa a `openGatesFor($, flow)` e lê direto do disco:
  - o plano (`run`) da change do `sessionFlow` (§7);
  - os pulos do dono (`loadSkips`);
  - os registros de portão da sessão e das filhas, nos arquivos de atividade que o refresh já lê.

  Ela monta a lista com o mesmo `phaseViews`/`gateViews`/`familyCheck` de hoje, então a ordem é a mesma do painel. O
  `refresh` passa a usar essa mesma função, e o painel e o comando nunca divergem.
- `skip-gate` sem argumento lista os portões abertos nessa ordem: fases primeiro, depois os portões finais. Cada linha vem numerada, por exemplo `1. fase 2: testes`, e no fim aparece
  `Para pular: /orchestrator:skip-gate N`.
- `skip-gate N` grava em `$.state` a chave nova `skip-ask`, com `{ change, phase, gate, n, at }`, e pede a repetição.
  O `gate` é o id do portão, não o número. O texto é:
  `Pular "<rótulo>"? Rode /orchestrator:skip-gate N de novo em até 2 minutos.`
- Um segundo `skip-gate N` pula o portão só se valerem estas três condições. Antes de pular, a chave é apagada.
  - O `skip-ask` existe, com o mesmo `change` e o mesmo `n`.
  - Passaram no máximo 120 s (`SKIP_CONFIRM_MS = 120_000`, medido com `$.clock.now()`).
  - O portão número `N` da lista de agora é o mesmo `phase`/`gate`.

  Se alguma falhar, o pedido volta a ser o primeiro: grava de novo e pergunta de novo. Assim um portão que fechou, ou
  uma lista que mudou de ordem, nunca faz pular o portão errado.
- `N` fora da lista, ou que não é número, responde a lista de novo, sem gravar.
- O `skip-ask` é por sessão, porque o `$.state` é da sessão. O Remote Control fala com a mesma sessão, então repetir
  pelo celular vale.

**Alternativas descartadas:**

- **Palavra de confirmação.** O grill proíbe (C4).
- **Confirmar num botão do painel.** Pelo Remote Control não há painel, e o grill pediu repetir o comando.
- **Continuar lendo a vista e forçar um refresh antes.** O refresh chama a lista de sessões, que pode esperar
  permissão (`mayList`). Pelo Remote Control, a resposta ficaria sem portões ou atrasada.
- **Gravar o pedido em disco.** Ele só vale por 2 minutos e na sessão. O `$.state` some no restart, e isso é o
  certo: um restart cancela a confirmação.

## 4. A pasta `.orquestrador/` → `.orchestrator/`, lendo a antiga

Uma função em `project-config.ts` resolve a pasta do projeto: `projectDir($, root)`. Ela devolve
`<root>/.orchestrator` quando essa pasta existe. Se não existir mas `<root>/.orquestrador` existir, devolve a antiga,
com `legacy: true`. Se nenhuma existir, devolve a nova. Todas as leituras passam por ela:

- `CONFIG_PATH` (`i18n.ts:9`);
- `readFlowDir` (`flow-files.ts:66`);
- os agentes do projeto (`flow-files.ts:86` e `:113`);
- o `loadProjectConfig`;
- o editor de workflows (`workflow-edit.ts` e `workflows-pane.tsx`).

**Gravações.** O mod grava na pasta que achou. Se o projeto ainda usa `.orquestrador/`, a gravação vai para lá, e o
projeto nunca fica com metade da configuração em cada pasta. Um projeto novo, pela skill `install`, nasce em
`.orchestrator/`.

**Textos com a pasta.** Os textos que hoje citam `.orquestrador/` fixo passam a receber a pasta resolvida, o nome
relativo devolvido por `projectDir` (`.orchestrator` ou `.orquestrador`). Os pontos são:

- `i18n-workflows.ts:143`, `:174`, `:258`, `:285`, `:288`, `:289` e `:320`, e os equivalentes em en (`:528` a `:703`).
  As funções de texto ganham um parâmetro `dir`, e as constantes viram funções de `dir`.
- `workflows-pane.tsx:279`, `:1597`, `:1611` e `:1704`. Os caminhos relativos saem do `dir` do `loadFlows`, que já
  vem resolvido, e não da string fixa.
- `flow.ts:1259`, no aviso de agente não encontrado, que recebe a pasta do `describeStepAgent`.

O único texto que pode citar `.orquestrador/` literal é o aviso de `legacy`. Verificação:
`grep -rn "\.orquestrador/" orchestrator/hooks` só acha esse aviso e o `LEGACY_DIR` de `project-config.ts`.

**Aviso.** Com `legacy: true`, o painel ⚙️ mostra uma linha: "Este projeto usa `.orquestrador/`; renomeie para
`.orchestrator/` (a pasta antiga deixa de ser lida na próxima versão)." Os textos do `i18n` dizem o mesmo em en.

**O que fica com o nome antigo nesta versão:**

- **A pasta de registros `~/.claude/orquestrador/`** (`registryDir`, `activation.ts:108-110`, e `PROTECTED_DIR`,
  `gates.ts:370`). Ela guarda os flows em andamento, inclusive o desta change, os portões passados e as ativações.
  Mover essa pasta junto com a troca de nome do plugin faria uma sessão ainda na 0.14.1 e outra já na 0.15.0 gravarem
  em pastas diferentes durante a reinstalação. Ela não é "pasta de configuração" do projeto, e o dono não a edita.
  Fica para uma change própria.
- **A pasta `.orquestrador/` deste repositório.** Ela só muda depois da reinstalação (tarefa 7.2). Até lá, a 0.14.1
  instalada precisa dela para conduzir o próprio flow desta change.

**Ativação.** O `HOOK_MARK` passa a `orchestrator:activate`, mas o "Desativar" acha o hook pelos dois marcadores. O
`HOOK_COMMAND` lê `${ORCHESTRATOR:-${ORQUESTRADOR:-barrar}}` e cita `/orchestrator:panel`. Um clone ativado na 0.14.1
continua ativo. O texto antigo do hook só é trocado quando o dono reativa no ⚙️, e o README diz isso (§9).

**Alternativas descartadas:**

- **Mover a pasta sozinho na primeira leitura.** O mod mexeria nos arquivos do projeto sem o dono pedir, e a mudança
  apareceria no `git status` de todo mundo.
- **Ler as duas pastas e juntar.** Haveria duas fontes de verdade e conflitos de id de flow.

## 5. `mcp__orquestrador__*` → `mcp__orchestrator__*`

O prefixo da ferramenta sai do nome do plugin. Mudar `plugin.json` para `orchestrator` troca `mcp__orquestrador__flow`
por `mcp__orchestrator__flow` sem nenhuma outra mudança. A ferramenta `plano` passa a `plan` (C5). A `flow` mantém o
nome. Os lugares que citam os nomes:

| Onde | O que muda |
| --- | --- |
| `hooks/register.tsx:139-140` | `PLAN_TOOL`, `FLOW_TOOL`; o `$.tool.register({ name: 'plano' })` passa a `'plan'` |
| `hooks/flow.ts` (prompts `stopPrompt`, `describeFlow`, avisos de sessão pendente, `:1158`) | cita a ferramenta e o painel pelo nome novo |
| `hooks/i18n.ts`, `hooks/i18n-workflows.ts` | textos com `/orquestrador …`, nome do painel |
| `skills/change/SKILL.md`, `skills/install/SKILL.md` | chamadas a `mcp__orchestrator__flow` e `…__plan` |
| `agents/*.md` | quando citam a ferramenta `flow` ou o painel |
| `types/index.d.ts:596` | a seção de estado `orquestrador: {…}` passa a `orchestrator: {…}` |
| `tests/*` | asserts de nome de ferramenta, de comando e de painel |
| `README.md` | os nomes e o passo de permissões |
| `~/.claude/settings.json` do dono | allow-list com `mcp__orquestrador__*`; fica com o dono, no passo a passo (§9) |

**Verificação da fase:** `grep -rn "mcp__orquestrador\|'plano'" orchestrator/` não acha nada além do comentário
que explica o nome antigo de agente (§6).

**Efeito colateral aceito.** O `$.state` é por plugin: as chaves passam de `orquestrador.view` para
`orchestrator.view`. Na primeira sessão depois da reinstalação, o painel começa fechado e os rascunhos do editor de
workflows se perdem. Os flows ficam, porque estão em disco (§4).

**Alternativa descartada: manter o nome `orquestrador` no plugin e trocar só os comandos.** O grill pede plugin,
marketplace e ferramentas em inglês (C5).

## 6. Agentes renomeados, com o nome antigo ainda aceito

- `git mv` dos seis arquivos de `agents/`, com o `name:` do frontmatter acompanhando.
- Os flows padrão (`hooks/flows/completo.ts` e `rapido.ts`) e as constantes `WORKFLOW_MERGE_AGENT` e
  `CODE_REVIEW_AGENT` (`flow.ts:829-832`) passam aos nomes novos. O mesmo vale para `model.ts:219-221` (`pr-opener`,
  `publisher`) e para os testes de `i18n-workflows.ts`.
### O nome antigo vira o novo na carga do flow

Achar o arquivo não basta. Há código que compara o nome literal do agente:

- `flow.ts:110` e `:852` (`CODE_REVIEW_AGENT`);
- `flow.ts:1165` e `:1216` (`WORKFLOW_MERGE_AGENT`);
- `model.ts:221` (`abre-pr`/`publicador`).

O `.orquestrador/flows/rapido.json` deste repo usa `merge-pelo-workflow` (`:122`) e `abre-pr` (`:107`). Se só o
`findAgent` conhecesse o nome antigo, o merge desse flow viraria "The owner merges" e o `publicar` perderia o número
do PR.

**Decisão.** `LEGACY_AGENTS` (em `flow.ts`, ao lado das constantes) é um mapa de nome antigo para nome novo. A função
pura `normalizeAgents(def: FlowDef): FlowDef` troca `step.agent` pelo nome novo quando ele está no mapa. Ela roda em
dois pontos de entrada:

- **No fim do `resolveFlow`** (`flow.ts:379`). Todo flow de projeto e todo flow padrão passa por ele antes de qualquer
  comparação. O editor de workflows também lê por aí.
- **No `loadFlowState`** (`register.tsx`), sobre o `state.flow`. Um flow já em andamento guarda a definição que tinha
  quando começou, e o flow desta própria change é um deles. Ele passa a ver os nomes novos sem regravar o arquivo.

Com isso, `CODE_REVIEW_AGENT`, `WORKFLOW_MERGE_AGENT` e `model.ts:221` comparam só com o nome novo, e nenhum outro
ponto precisa conhecer o mapa. O editor de workflows grava sempre o nome novo.

### A personalização do projeto com o nome antigo continua valendo

O README (`:187`) diz que um projeto troca um agente criando `.orquestrador/agents/<nome>.md` com o nome do agente do
plugin. Um projeto que tem `.orquestrador/agents/planejador.md` não pode perder essa troca quando o flow passa a pedir
`planner`. O `findAgent(name)` procura nesta ordem:

1. `<projectDir>/agents/<name>.md` (o nome novo no projeto);
2. `<projectDir>/agents/<antigo>.md`, para cada nome antigo que o mapa leva a `name` (o nome antigo no projeto);
3. `agents/<name>.md` do plugin.

O `listAgents` mostra o arquivo antigo do projeto sob o nome novo, para não aparecer um agente "sem par" no editor.

**Alternativas descartadas:**

- **Manter cópias dos arquivos antigos no plugin.** Seriam duas listas de agentes no Agent tool, e o texto de um
  ficaria velho.
- **Mapear só no `findAgent` e no `i18n-workflows`.** As comparações literais do `flow.ts` e do `model.ts` ficariam
  com o nome antigo, como a revisão do plano mostrou.
- **Trocar os nomes no `rapido.json` deste repo agora.** Isso não cobre outros projetos, e a 0.14.1 instalada, que
  conduz esta change, não conhece os nomes novos.

## 7. A correção do painel

**Causa.** O `loadFlowView` (`register.tsx:2199`) escolhe o flow assim:

- com um plano publicado (`run`), o flow da change desse plano. O `run` é o último de `runs/` com o mesmo
  `coordinatorCwd` (`loadRun`, `:415-423`), seja qual for o status do flow dessa change;
- sem plano, o flow mais recente com o mesmo `coordinatorCwd`, sem olhar `status` nem `coordinatorSession`.

A sessão desta change não tinha plano publicado, mas `runs/` tinha o plano de `freio-aviso`. O painel mostrou um flow
concluído. Duas sessões de coordenação no mesmo clone também se veem uma à outra.

**Decisão.** Uma função só, `sessionFlow($, root)`, decide "o flow desta sessão" para o painel, para os comandos e
para o aviso. É o filtro do `commandFlow` (`:2057-2066`):

- `status` `running` ou `escalated`;
- `ownsFlow(s, root)`;
- `coordinatorSession` igual ao id desta sessão, ou ausente;
- o mais recente por `startedAt`.

O `commandFlow` e o `currentFlow` passam a usar essa função; o `currentFlow` pede só `running`.

- O painel mostra o `sessionFlow`.
- O plano (`run`: ondas, OpenSpec, Jira) só aparece se for da mesma change que o `sessionFlow`.
- Sem `sessionFlow`, o plano só aparece se o `run` tiver `coordinatorSession` igual ao desta sessão. O campo é novo,
  gravado pelo `publishPlan`. Isso serve para as orquestrações sem flow.
- Um `run` antigo, sem o campo, não aparece numa sessão que tem outro flow. Sem flow, aparece só se for de até 24 h
  atrás, para não esconder a orquestração sem flow de quem atualizou o plugin no meio dela.
- Um flow `done` ou `aborted` nunca entra no painel. O fim de um flow continua visível pelo toast e pelo `status`.

O botão do passo do dono vem do `flowView` do `sessionFlow`, então aparece junto (C14).

**Alternativa descartada: só filtrar `status === 'running'` no `loadFlowView` de hoje.** Isso tira a change concluída,
mas não o flow de outra sessão no mesmo clone, o segundo pedido da rodada 3.

## 8. O `background` das sessões pendentes

**Causa.** O `openPending` (`register.tsx:1795-1802`) chama o `start_session` sem `context` e sem `background`. O
app supõe `fresh` e exige pelo menos 80 caracteres de contexto, e recusa a chamada com
`context "fresh" needs a background of at least 80 characters`. O mod lê essa recusa como `byApp` e manda o dono
digitar o comando no desktop, que falha do mesmo jeito.

**Decisão.**

- O schema `pending` da ferramenta `flow` (`register.tsx:1425-1440`) ganha `background` opcional em cada sessão, com
  `maxLength` 4000. A skill `change` passa a mandar um `background` por sessão, com o objetivo da change e o que a
  fase entrega.
- O `openPending` sempre passa `context: 'fresh'` e um `background`. Se a entrada trouxer um com pelo menos 80
  caracteres, usa esse. Se não, monta um com uma função pura `pendingBackground(state, entry)` em `flow.ts`, por
  exemplo: `Sessão do flow <flowTitle> da change <change>, passo <step>, chave <key> ("<title>"). Plano em
  <changePath>. O pedido completo está no prompt.` O texto sempre passa de 80 caracteres, porque a parte fixa já tem
  mais do que isso. Um teste prova o mínimo com `change` e `title` de uma letra.
- O teste de harness `pendentes-harness.test.ts` passa a exigir `context` e `background` no input do `start_session`
  falso. Ele recusa, como o app, quando o `background` tem menos de 80 caracteres. Hoje o falso aceita qualquer coisa,
  e foi assim que o bug passou.

**Alternativa descartada: `context: 'fork'`.** A sessão herdaria a conversa da coordenação inteira, o que é caro e
vaza contexto para uma fase que só precisa do plano. Também mudaria o comportamento do `start_session` que a skill já
usa.

## 9. Ordem segura do rename do repositório e do marketplace

O marketplace do dono foi adicionado de `chacal88/orquestrador`, com o nome `orquestrador`. O plugin instalado é
`orquestrador@orquestrador`. O GitHub mantém um redirecionamento do nome antigo para o novo depois do rename, desde que
nenhum repositório novo seja criado com o nome antigo.

1. **Antes do merge, com o ok do dono (7.1):** `gh repo rename orchestrator --repo chacal88/orquestrador`. O PR
   aberto continua no mesmo repositório. Os clones e o marketplace seguem funcionando pelo redirecionamento.
2. `git remote set-url origin https://github.com/chacal88/orchestrator.git` no clone do dono. É conveniência, já que o
   redirecionamento cobre esse passo.
3. **Merge do PR.** `plugin.json` (`homepage`, `repository`), `marketplace.json` e o README já apontam para
   `chacal88/orchestrator`. Depois do passo 1, esses endereços existem.
4. **Reinstalação pelo dono, logo depois do merge**, no passo `producao` e antes de qualquer
   `claude plugin marketplace update`. O motivo: depois do merge, o marketplace antigo, que chega ao repo novo pelo
   redirecionamento, passa a ler um `marketplace.json` sem nenhum plugin `orquestrador`. Uma atualização do
   marketplace, à mão ou automática do app, pode tirar a 0.14.1, que é quem conduz os passos `producao` e `arquivar`
   desta change. Reinstalada a 0.15.0, ela retoma o flow, que fica em `~/.claude/orquestrador/` (§4), com os nomes
   de agente normalizados (§6). Além disso, o nome do marketplace muda, então
   `claude plugin marketplace update orquestrador` não serve: o manifesto novo se chama `orchestrator`. O passo
   automático `deploy`, que roda os comandos de `.orquestrador/config.json`, não roda nesta change. Ver a tarefa 6.3.
5. Depois da reinstalação, a tarefa 7.2 migra o `.orquestrador/` deste repo, e o `deploy.commands` passa a
   `claude plugin marketplace update orchestrator` e `claude plugin update orchestrator@orchestrator`.
6. O release (`gh release create v0.15.0`) roda no repositório novo.

**Alternativa descartada: renomear o repositório depois do merge.** O manifesto publicado apontaria para um endereço
que ainda não existe. Quem instalasse no intervalo teria links quebrados.

**Nunca:** criar um repositório `chacal88/orquestrador` depois do rename, porque isso quebra o redirecionamento.

## 10. Passo a passo de reinstalação (vai para o README)

Faça logo depois do merge do PR, antes de qualquer `claude plugin marketplace update` (§9, passo 4).

```bash
claude plugin uninstall orquestrador@orquestrador
claude plugin marketplace remove orquestrador
claude plugin marketplace add chacal88/orchestrator
claude plugin install orchestrator@orchestrator
```

Depois:

1. Reinicie o app ou abra uma sessão nova. O plugin carrega com o nome novo.
2. Em cada projeto ativado, abra `/orchestrator:panel` → ⚙️ e reative. O hook de início passa a citar
   `/orchestrator:panel`.
3. Nas permissões (`~/.claude/settings.json` e `.claude/settings*.json` dos projetos), troque `mcp__orquestrador__flow`
   e `mcp__orquestrador__plano` por `mcp__orchestrator__flow` e `mcp__orchestrator__plan`.
4. Se o projeto tem `.orquestrador/`, renomeie para `.orchestrator/` (`git mv .orquestrador .orchestrator`) quando
   quiser. A 0.15.0 ainda lê a pasta antiga.
5. Um flow em andamento continua. Ele vive em `~/.claude/orquestrador/`, que não muda nesta versão.

## 11. Arquivos por fase

| Fase | Arquivos |
| --- | --- |
| 1. Pacote em inglês | `git mv orquestrador orchestrator`; `orchestrator/.claude-plugin/plugin.json`; `.claude-plugin/marketplace.json`; `orchestrator/hooks/register.tsx`; `orchestrator/hooks/flow.ts`; `orchestrator/hooks/i18n.ts`; `orchestrator/hooks/i18n-workflows.ts`; `orchestrator/hooks/workflows-pane.tsx`; `orchestrator/types/index.d.ts`; `orchestrator/tests/*`; `.gitignore` |
| 2. Agentes, skills e `.orchestrator/` | `orchestrator/agents/*`; `orchestrator/skills/*`; `orchestrator/hooks/flow-files.ts`; `orchestrator/hooks/project-config.ts`; `orchestrator/hooks/i18n.ts`; `orchestrator/hooks/activation.ts`; `orchestrator/hooks/flows/*.ts`; `orchestrator/hooks/flow.ts`; `orchestrator/hooks/model.ts`; `orchestrator/hooks/i18n-workflows.ts`; `orchestrator/hooks/workflow-edit.ts`; `orchestrator/hooks/workflows-pane.tsx`; `orchestrator/hooks/pane.tsx`; `orchestrator/hooks/register.tsx` (`loadFlowState`); `orchestrator/tests/*` |
| 3. Comandos com prefixo | `orchestrator/commands/*.md` (novos); `orchestrator/hooks/register.tsx`; `orchestrator/hooks/command.ts`; `orchestrator/hooks/i18n.ts`; `orchestrator/hooks/workflows-pane.tsx`; `orchestrator/tests/comando-harness.test.ts`; `orchestrator/tests/command.test.ts` |
| 4. Sem palavras | `orchestrator/hooks/command.ts`; `orchestrator/hooks/register.tsx`; `orchestrator/hooks/i18n.ts`; `orchestrator/types/index.d.ts`; `orchestrator/tests/command.test.ts`; `orchestrator/tests/comando-harness.test.ts` |
| 5. Painel e sessões pendentes | `orchestrator/hooks/register.tsx`; `orchestrator/hooks/flow.ts`; `orchestrator/types/index.d.ts`; `orchestrator/skills/change/SKILL.md`; `orchestrator/tests/panel-flow.test.ts`; `orchestrator/tests/pendentes-harness.test.ts`; `orchestrator/tests/flow.test.ts` |
| 6. README, versão e conferência | `README.md`; `orchestrator/.claude-plugin/plugin.json`; `orchestrator/proposal.md`, `tasks.md`, `orchestration.md`, `evidence.md` (os nomes); `changes/orchestrator-commands/evidence.md` |
| 7. Dono | GitHub (rename); `.orquestrador/` → `.orchestrator/` deste repo; `config.json` (`deploy.commands`) |

`register.tsx`, `i18n.ts` e `tests/` aparecem em todas as fases de código (1 a 5), `flow.ts` em 1, 2 e 5, e `workflows-pane.tsx` em 1, 2 e 3. Nenhuma
fase corre em paralelo com outra; ver `tasks.md`.
