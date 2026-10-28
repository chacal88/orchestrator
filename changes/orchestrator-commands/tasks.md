# Tarefas — comandos do orchestrator (0.15.0)

## Visão geral

São sete fases, todas em série, uma onda cada.

- **Fases 1 a 5 (código).** Todas mexem em `orchestrator/hooks/register.tsx`, `orchestrator/hooks/i18n.ts` e
  `orchestrator/tests/`. As fases 1, 2 e 5 também mexem em `orchestrator/hooks/flow.ts`. Nenhuma corre em paralelo com
  outra: cada fase começa da branch com a anterior já commitada.
- **Fase 1 primeiro.** Ela move a pasta do plugin (`orquestrador/` → `orchestrator/`). Fazer isso antes deixa os
  caminhos das fases seguintes estáveis.
- **Fase 6.** Descreve o que as fases anteriores entregaram.
- **Fase 7.** Fica com o dono.

A tabela de arquivos por fase está no `design.md`, §11.

## Portões de toda fase de código (1 a 6)

- `testes`: `claude plugin test orchestrator` na raiz do repo, saída 0. Na fase 1, antes do `git mv`, o nome ainda é
  `orquestrador`.
- `tipos`: `npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json`, com hooks, types e tests e os tipos do
  engine (`plugin-authoring/types`), saída 0. É o mesmo comando de `changes/freio-aviso/evidence.md`.
- `regras`: nenhum checkbox marcado sem a seção correspondente no `evidence.md`. O código novo segue o estilo do
  arquivo onde entra, em comentários, nomes e inglês nos identificadores, e nenhum texto ao dono exige palavra-chave.

`testes` e `validate` rodam com o binário do app, nunca com o `claude` do PATH, que é um alias antigo e não entende
mods:

```
export PATH="/Users/kauesantos/Library/Application Support/Claude/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orchestrator
```

O `validate` é o mesmo comando, com `claude plugin validate orchestrator`.

As fases 1, 3 e 6 também têm o portão `lint` do plugin: `claude plugin validate orchestrator`, saída 0. São as fases
que mexem no manifesto, nos comandos e nas skills.

## Depois das fases

O flow do projeto (`.orquestrador/flows/completo.json`, base `completo`) roda os passos automáticos dele:

- `validar` = `claude plugin validate`;
- `checagem` = `claude plugin test` com o `evidence.md` preenchido;
- `tipos` = `tsc`;
- `arquivar` = `gh release create`.

Os matchers são `plugin validate` e `plugin test`, sem o nome da pasta, então continuam valendo depois do `git mv`.
Este repositório não usa OpenSpec.

## 1. Pacote em inglês

Arquivos: os listados no `design.md`, §11. Portões: `testes`, `tipos`, `lint`.

- [x] 1.1 `git mv orquestrador orchestrator` e ajuste dos caminhos que citam a pasta: o `.gitignore`
      (`orchestrator/.claude-plugin/types/`), os `tsconfig` e os imports relativos dos testes, se houver.
      Verificação: `git status` mostra o rename (R), e `claude plugin test orchestrator` roda — cx: simple
- [x] 1.2 Manifestos. `orchestrator/.claude-plugin/plugin.json` passa a ter `name` `orchestrator`, e `homepage` e
      `repository` apontam para `https://github.com/chacal88/orchestrator`. Em `.claude-plugin/marketplace.json`, o
      `name` passa a `orchestrator`, e `plugins[0].name` e `source` passam a `orchestrator` e `./orchestrator`.
      As descrições ficam em inglês ou pt-BR, como hoje. Verificação: `grep -rn "orquestrador"
      .claude-plugin orchestrator/.claude-plugin` não acha nada, e `claude plugin validate orchestrator` sai com 0 —
      cx: simple
- [x] 1.3 Ferramentas e identidade do mod em `register.tsx`:
      - `PLUGIN_NAME = 'orchestrator'`;
      - `PLAN_TOOL = 'mcp__orchestrator__plan'` e `FLOW_TOOL = 'mcp__orchestrator__flow'`;
      - `$.tool.register({ name: 'plan' })`;
      - os ids de painel (`PANE`, `WORKFLOWS_PANE`) e o título `🧭 Orchestrator`;
      - as chaves de `$.state` com `plugin: 'orquestrador'`, que passam a `PLUGIN_NAME`, também em `activation.ts:229`;
      - a seção de estado em `types/index.d.ts:596`.

      Verificação: `grep -rn "mcp__orquestrador\|name: 'plano'\|plugin: 'orquestrador'" orchestrator/hooks
      orchestrator/types` não acha nada — cx: moderate

      Feito com um desvio, registrado no `evidence.md`: `PLUGIN_NAME` fica em `activation.ts`, e as chaves de
      `$.state` usam o literal `plugin: 'orchestrator'`, porque o engine só aceita literal nessas referências.
- [x] 1.4 Textos que citam a ferramenta, o painel ou o plugin pelo nome, em `flow.ts` (prompts de aviso e de sessões
      pendentes, `:1158`), `i18n.ts`, `i18n-workflows.ts` e `workflows-pane.tsx`. A tabela está no `design.md`, §5. Os
      textos de `/orquestrador <sub>` só mudam na fase 3. Verificação: `grep -rn "mcp__orquestrador\|painel do
      orquestrador\|orquestrador panel" orchestrator/hooks` não acha nada — cx: moderate
- [x] 1.5 Testes. Os asserts com nome de ferramenta, painel ou chave de estado passam aos nomes novos, e nenhum teste é
      removido. Verificação: `claude plugin test orchestrator` sai com 0, com o mesmo número de testes de antes (anotar
      os dois números no `evidence.md`) — cx: moderate

## 2. Agentes, skills e a pasta `.orchestrator/`

Portões: `testes`, `tipos`, `lint` (a fase mexe nas skills e no frontmatter dos agentes).

- [x] 2.1 Agentes. `git mv` de `planejador`→`planner`, `revisor-plano`→`plan-reviewer`, `revisor-codigo`→
      `code-reviewer`, `abre-pr`→`pr-opener`, `publicador`→`publisher` e `merge-pelo-workflow`→`workflow-merge`, com o
      `name:` do frontmatter acompanhando. Os flows padrão (`hooks/flows/*.ts`), `WORKFLOW_MERGE_AGENT`,
      `CODE_REVIEW_AGENT` (`flow.ts:829-832`), `model.ts:219-221` e as comparações em `i18n-workflows.ts` passam aos
      nomes novos. Verificação: `grep -rn "planejador\|revisor-plano\|revisor-codigo\|abre-pr\|publicador\|merge-pelo-workflow"
      orchestrator/hooks orchestrator/agents` só acha o mapa `LEGACY_AGENTS` (2.2) — cx: moderate
- [x] 2.2 Nome antigo vira o novo na carga do flow (`design.md`, §6). `LEGACY_AGENTS` em `flow.ts` e a função pura
      `normalizeAgents(def)`, aplicada no fim do `resolveFlow` (`flow.ts:379`) e no `loadFlowState` (`register.tsx`),
      sobre o `state.flow` de um flow já em andamento. Depois disso, `CODE_REVIEW_AGENT` (`flow.ts:110`, `:852`),
      `WORKFLOW_MERGE_AGENT` (`flow.ts:1165`, `:1216`) e `model.ts:221` só comparam com o nome novo. O editor de
      workflows grava o nome novo. Testes:
      - em `rapido-repo.test.ts`, com o `.orquestrador/flows/rapido.json` real deste repo (`merge-pelo-workflow` em
        `:122`, `abre-pr` em `:107`): o passo de merge continua automático pelo workflow, e não "The owner merges", e o
        passo que abre o PR continua citando o número do PR;
      - um `FlowState` gravado com `"agent": "revisor-codigo"` no `state.flow` é lido com `code-reviewer`, e a revisão
        de código continua exigindo a saída `aprovado`;
      - `normalizeAgents` deixa intactos um nome novo e um nome desconhecido.

      Verificação: os testes como `(pass)` e `grep -n "LEGACY_AGENTS" orchestrator/hooks/*.ts*` acha só a definição,
      o `normalizeAgents` e o `findAgent` — cx: complex
- [x] 2.3 A personalização do projeto com o nome antigo continua valendo (`design.md`, §6, e README `:187`). O
      `findAgent(name)` procura `<projectDir>/agents/<name>.md`, depois `<projectDir>/agents/<antigo>.md` para cada
      nome antigo que o mapa leva a `name`, e por fim `agents/<name>.md` do plugin. O `listAgents` mostra o arquivo
      antigo do projeto sob o nome novo. Testes:
      - um projeto com `.orquestrador/agents/planejador.md`, num flow que pede `planner`, recebe o arquivo do projeto;
      - com `planner.md` e `planejador.md` no projeto, ganha `planner.md`;
      - sem nenhum no projeto, vem o do plugin.

      Verificação: os três testes como `(pass)` — cx: moderate
- [x] 2.4 Skills. `git mv skills/change-orchestrator skills/change` e `git mv skills/instalar skills/install`, com o
      `name:` acompanhando. As chamadas a `mcp__orchestrator__flow`/`plan`, os nomes de agente e os comandos citados
      (`/orchestrator:panel`, `:approve`, `:open` etc.) ficam atualizados. A skill `install` grava em
      `.orchestrator/`. Verificação: `grep -rn "orquestrador\|change-orchestrator\|instalar" orchestrator/skills` só acha a
      menção à pasta antiga lida por compatibilidade — cx: moderate
- [x] 2.5 `.orchestrator/` com leitura da antiga. `projectDir($, root)` em `project-config.ts` devolve
      `{ dir, legacy }` (`design.md`, §4). `CONFIG_PATH`, `readFlowDir`, os agentes do projeto, o `loadProjectConfig`
      e o editor de workflows passam por ela. O painel ⚙️ mostra o aviso de `legacy`. Testes:
      - só `.orquestrador/` lê config e flows;
      - só `.orchestrator/` lê;
      - as duas pastas: ganha a nova;
      - uma gravação num projeto `legacy` vai para `.orquestrador/`;
      - um projeto sem pasta grava em `.orchestrator/`.

      Verificação: os cinco testes como `(pass)` em `project-config.test.ts` ou `flow-resolve.test.ts` — cx: complex
- [x] 2.6 Ativação. `HOOK_MARK = 'orchestrator:activate'`, e "Desativar" acha o hook pelo marcador novo e pelo antigo.
      O `HOOK_COMMAND` lê `${ORCHESTRATOR:-${ORQUESTRADOR:-barrar}}` e cita `/orchestrator:panel`. Testes: um
      `settings.local.json` com o hook da 0.14.1 é lido como ativo e removido pelo "Desativar". Verificação: os testes
      de `activation.test.ts` passam, e os novos aparecem como `(pass)` — cx: moderate
- [x] 2.7 Frontmatter em YAML estrito. Nos agentes (`orchestrator/agents/*.md`, os nove, já com os nomes novos), nas
      skills (`skills/change`, `skills/install`) e, na fase 3, nos `commands/*.md`, o `description` vai entre aspas
      duplas sempre que o texto tem `: `, com as aspas internas escapadas. Hoje `planejador`, `revisor-codigo` e
      `deploy` têm `: ` sem aspas. O 2.1.309 aceita, mas o 2.1.227 recusa com erro de YAML. O `hooks.json` com
      `modules` é recusado pelo 2.1.227, que não conhece mods; isso não muda, e os portões continuam com o binário do
      app. Verificação: `grep -nE '^description: [^"].*: ' orchestrator/agents/*.md orchestrator/skills/*/SKILL.md`
      não acha nada, e `claude plugin validate orchestrator` com o 2.1.309 sai 0 — cx: simple
- [x] 2.8 Textos com a pasta resolvida (`design.md`, §4, "Textos com a pasta"). Os textos que citam `.orquestrador/`
      fixo passam a receber o nome relativo devolvido por `projectDir`:
      - `i18n-workflows.ts:143`, `:174`, `:258`, `:285`, `:288`, `:289` e `:320`, e os equivalentes em en (`:528` a
        `:703`); as constantes viram funções de `dir`;
      - `workflows-pane.tsx:279`, `:1597`, `:1611` e `:1704`, com os caminhos relativos saídos do `dir` do `loadFlows`;
      - `flow.ts:1259`, no aviso de agente não encontrado.

      Testes: num projeto `legacy`, o aviso de salvar cita `.orquestrador/flows/<id>.json`; num projeto novo, cita
      `.orchestrator/flows/<id>.json`. Verificação: `grep -rn "\.orquestrador/" orchestrator/hooks` só acha o aviso de
      `legacy` e o `LEGACY_DIR` de `project-config.ts`, e os dois testes como `(pass)` — cx: moderate

Feito com dois desvios, registrados no `evidence.md`: o `grep "LEGACY_AGENTS"` também acha o `currentAgent` de `flow.ts`
(usado pelo `normalizeAgents` e pela checagem da revisão de código no `parseFlow`) e o `listAgents` (que a 2.3 pede);
e o `.orquestrador/` do `LEGACY_DIR` não tem barra, então o grep da 2.8 só acha as duas línguas do aviso de `legacy`.

## 3. Comandos com prefixo

Portões: `testes`, `tipos`, `lint`.

- [x] 3.1 Prova (`design.md`, §1). Criar `orchestrator/commands/status.md` e um hook `command.run` com o matcher
      `{ command: 'orchestrator:status' }` que responde `{ text }` sem `next`. Carregar com `--plugin-dir` numa
      sessão do app, digitar `/orchestrator:status` e anotar no `evidence.md` o que aparece: o texto do mod ou o prompt
      do arquivo. Anotar também o que o `claude plugin validate orchestrator` lista para esse hook. Se o hook não
      pegar o comando, seguir o plano B do design: a ferramenta `mcp__orchestrator__command` e o corpo do `.md`
      chamando essa ferramenta. Verificação: a seção "Prova do prefixo" do `evidence.md` preenchida, com o caminho
      escolhido — cx: complex
- [x] 3.2 Os nove arquivos `commands/<ação>.md`: `status`, `approve`, `reject`, `open`, `skip-gate`, `end`, `panel`,
      `workflows` e `help`. Cada um tem `description` com o texto do mockup e `argument-hint` quando aceita texto
      (`[nota]`, `[N]`, `[motivo]`). O corpo é o plano B (§1). Para cada um há um hook `command.run` com o nome
      literal (`${PLUGIN_NAME}:<ação>`), e todos chamam o mesmo `runCommand($, action, args, origin)`. Verificação:
      `claude plugin validate orchestrator` lista os nove hooks, e `ls orchestrator/commands` mostra nove arquivos —
      cx: moderate
- [x] 3.3 Corte. Saem `$.command.register` de `orquestrador` e `orquestrador-workflows`, os dois hooks
      `command.run` deles e o `parseCommand` por palavra. `panel` e `workflows` chamam o `togglePane` e o
      `toggleWorkflowsPane` de hoje. Os textos do `i18n` que citam `/orquestrador …` passam a citar
      `/orchestrator:<ação>`. Isso inclui `i18n.ts:331` e `:578` (a ajuda), `workflows-pane.tsx:1298`,
      `register.tsx:2186` e o comentário de `command.ts:4`. Verificação: `grep -rn "/orquestrador\b\|'orquestrador'\|orquestrador-workflows"
      orchestrator/hooks` não acha nada. O padrão pega `/orquestrador` seguido de espaço, `:`, aspas ou fim de linha —
      cx: moderate
- [x] 3.4 Testes de harness em `comando-harness.test.ts`. Os testes de `/orquestrador <sub>` passam a disparar
      `command.run` com `orchestrator:<ação>`:
      - `panel` abre e fecha;
      - `help` devolve a lista dos onze comandos;
      - uma origem `plugin` recebe `notFromOwner`;
      - `/orquestrador` não é mais registrado.

      Verificação: `claude plugin test orchestrator` sai com 0, com os testes novos como `(pass)` — cx: moderate

Feito com três desvios, registrados no `evidence.md`:
- a prova da 3.1 rodou em `claude -p` com o binário do app, e não numa sessão interativa; a 6.4 confere no desktop;
- os nove hooks são literais escritos um a um, porque o engine recusa um hook que não é função literal;
- o grep da 3.3 com `\b` ainda acha a pasta de registros `~/.claude/orquestrador`, que fica com o nome antigo (§4); com o
  padrão que a tarefa descreve, não acha nada.

## 4. Nenhum comando exige palavra

Portões: `testes`, `tipos`.

- [x] 4.1 `pickOutcome(state, 'forward' | 'adjust')` em `command.ts` (`design.md`, §2). Testes em `command.test.ts`:
      - os cinco passos do dono do `completo`, conforme a tabela do design;
      - os passos do dono do `rapido`;
      - um flow de projeto com duas saídas para frente (vale a primeira declarada);
      - um passo sem ajustes (`none`).

      Verificação: os testes como `(pass)` — cx: moderate
- [x] 4.2 `approve [nota]` chama o `pressFlow`, a mesma chamada do botão do painel, com a saída "forward" e a nota.
      Numa escalada, usa `tentar-de-novo`. Num passo que não é do dono, responde qual é o passo e quem o responde.
      Teste de harness (C10): no `grill`, `orchestrator:approve` sem argumentos registra `fechado`, e o flow vai para
      `mockup`. O log do flow fica igual ao do clique do botão (mesmo `kind`, `by: owner`). Verificação: o teste como
      `(pass)` — cx: moderate
- [x] 4.3 `reject [nota]` usa a saída "adjust" com a nota. Sem saída de ajustes, responde
      `O passo atual (<título>) não tem opção de ajustes. Para seguir: /orchestrator:approve`. Numa escalada, aponta
      `/orchestrator:end`. Testes de harness (C10):
      - no `mockup`, `orchestrator:reject trocar skip-gate por skip` registra `ajustes` com essa nota;
      - no `producao`, responde o texto acima, e o flow não anda.

      Verificação: os testes como `(pass)` — cx: moderate
- [x] 4.4 `end [motivo]` chama o `endByOwner` direto, sem confirmação e sem `confirmar` (C11). Sai o `endAsk` do
      `i18n`. Teste: `orchestrator:end mudou o escopo` deixa o flow `aborted`, com a nota `mudou o escopo`, numa chamada
      só. Verificação: o teste como `(pass)`, e `grep -n "confirmar\|endAsk" orchestrator/hooks/command.ts
      orchestrator/hooks/i18n.ts` não acha nada — cx: simple
- [x] 4.5 `skip-gate [N]` com o estado de 2 minutos (`design.md`, §3): a chave `skip-ask` em `types/index.d.ts` e
      `SKIP_CONFIRM_MS = 120_000`. Testes com o relógio falso:
      - sem argumento, lista numerada;
      - `skip-gate 2` pergunta;
      - `skip-gate 2` de novo em 60 s pula;
      - de novo em 121 s só pergunta outra vez;
      - `skip-gate 2` e depois `skip-gate 1` não pula nenhum;
      - com a lista mudada entre os dois, não pula o portão errado;
      - `skip-gate x` e `skip-gate 9` devolvem a lista.

      Os portões vêm de `openGatesFor($, flow)` (`design.md`, §3), que lê o plano, os pulos e os registros de portão
      do disco, e não da vista do painel (`VIEW`), que a reinstalação zera. Na fase 4, `flow` é o do `commandFlow`; a
      fase 5 o troca pelo `sessionFlow`. O `refresh` e o `status` usam a mesma função. Teste extra: com o `$.state`
      vazio (sem `VIEW`, como depois da reinstalação), `skip-gate` ainda lista os portões abertos do disco.

      Verificação: os testes como `(pass)`, e `grep -n "openGatesNow" orchestrator/hooks/register.tsx` não acha nada —
      cx: complex
- [x] 4.6 `status` em texto simples, no molde do mockup: flow, passo, `Para seguir: /orchestrator:approve` e
      `Para pedir ajustes: /orchestrator:reject <o que mudar>`, este só quando o passo tem ajustes. Também mostra os
      portões abertos e as sessões pendentes. Teste: com `origin: { kind: 'bridge' }`, a resposta não tem tabela nem
      markdown além das palavras (C8). Verificação: o teste como `(pass)` — cx: simple

Feito com dois desvios, registrados no `evidence.md`:
- a resposta sem ajustes usa o título do passo (`Em produção`), e não o rótulo da saída que o mockup mostra;
- o `refresh` não monta lista de portões, então só o `status` e o `skip-gate` passam a usar o `openGatesFor`.

## 5. Painel da sessão e sessões pendentes

Portões: `testes`, `tipos`.

- [x] 5.1 `sessionFlow($, root)` em `register.tsx` (`design.md`, §7). O `commandFlow`, o `currentFlow` e o
      `loadFlowView` passam a usá-la. O `run` só entra no painel se for da change do `sessionFlow` ou, sem flow, se for
      desta sessão. Verificação: `grep -n "coordinatorCwd === cwd" orchestrator/hooks/register.tsx` só acha a linha do
      `loadRun` (hoje `register.tsx:421`), que continua legítima, e nenhuma dentro do `loadFlowView` — cx: moderate
- [x] 5.2 O `publishPlan` grava `coordinatorSession` no `run`; o campo é novo em `OrchestrationRun`
      (`types/index.d.ts:469`). Um `run` sem o campo segue as regras do design. Verificação: o teste da 5.3 que usa um
      `run` antigo — cx: simple
- [x] 5.3 Testes em `panel-flow.test.ts` ou em harness novo (C14):
      - com um `run` publicado de uma change cujo flow está `done` e um flow `running` de outra change desta sessão, o
        painel mostra o flow `running` com o botão do passo do dono;
      - um flow `running` de outra sessão no mesmo clone não aparece;
      - sem flow desta sessão e com o `run` de um flow concluído, o painel não mostra esse flow;
      - um flow `escalated` desta sessão aparece com os botões da escalada.

      Conferir que o primeiro caso falha com o `loadFlowView` de antes e anotar isso no `evidence.md`. Verificação: os
      testes como `(pass)` — cx: moderate
- [x] 5.4 `background` das sessões pendentes (`design.md`, §8):
      - `background` opcional no schema `pending`;
      - `pendingBackground(state, entry)` em `flow.ts`;
      - o `openPending` passa `context: 'fresh'` e o `background`;
      - a skill `change` manda `background` em cada sessão do `pending`.

      Verificação: `grep -n "background" orchestrator/hooks/register.tsx` acha o schema e a chamada — cx: moderate
- [x] 5.5 Teste de harness (B1). O `start_session` falso de `pendentes-harness.test.ts` recusa como o app quando o
      `background` tem menos de 80 caracteres ou falta o `context`. Casos:
      - o clique "Abrir as N sessões pendentes" abre as N;
      - `orchestrator:open` abre as N;
      - uma entrada com `background` próprio usa esse texto;
      - `pendingBackground` com `change` e `title` de uma letra passa de 80 caracteres.

      Conferir que os dois primeiros casos falham com o `openPending` de antes, com a mesma mensagem do bug, e anotar
      isso no `evidence.md`. Verificação: os testes como `(pass)` — cx: moderate

Feito com dois desvios, registrados no `evidence.md`:
- o plano de um flow concluído ainda lê o estado desse flow para mostrar as fases fechadas, só o cartão do flow sai;
- o texto do `pendingBackground` está em inglês, como os outros prompts que o mod manda às sessões em `flow.ts`.

## 6. README, versão e conferência

Portões: `testes`, `tipos`, `lint`.

- [x] 6.1 Versão `0.15.0` em `orchestrator/.claude-plugin/plugin.json` (C9). Verificação:
      `grep -n '"version": "0.15.0"' orchestrator/.claude-plugin/plugin.json` acha a linha — cx: simple
- [x] 6.2 README (C6, C13):
      - a seção de comandos vira a tabela dos onze, com a coluna "Antes";
      - entra a seção "Reinstalar a partir da 0.15.0", com o passo a passo do `design.md`, §10, começando por
        "faça logo depois do merge, antes de qualquer `claude plugin marketplace update`" (§9, passo 4);
      - os links apontam para `chacal88/orchestrator`;
      - os nomes de plugin, marketplace, agentes e pasta ficam atualizados;
      - entra uma frase sobre `.orquestrador/` ainda ser lida.

      Os `orchestrator/proposal.md`, `tasks.md`, `orchestration.md` e `evidence.md` da raiz do plugin ficam com os
      nomes novos. O README cita os três em `:256`.
      Verificação: `grep -n "orquestrador" README.md` só acha a seção de reinstalação e a frase da pasta antiga —
      cx: moderate
- [x] 6.3 Passo de produção desta change. O `deploy` automático de `.orquestrador/config.json` (`claude plugin
      marketplace update orquestrador`) não serve para a 0.15.0, porque o marketplace muda de nome. Registrar no
      `evidence.md` que a produção desta change é a reinstalação do dono (§10) e que o passo `producao` é dele.
      Nenhum arquivo de config muda nesta fase. Verificação: a seção "Produção" do `evidence.md` preenchida — cx: simple
A 6.4 virou a 7.3: a conferência no app só é possível com o plugin instalado e o comando digitado pelo dono
(o `-p` recusa o comando). Ver o `evidence.md`, "Conferência no app".

## 7. Com o dono (precisa do ok do dono)

Estas tarefas não são de uma sessão de fase: a coordenação pede o ok do dono e roda cada uma no momento indicado.

- [ ] 7.1 **Precisa do ok do dono.** Renomear o repositório no GitHub, antes do merge do PR (`design.md`, §9):
      `gh repo rename orchestrator --repo chacal88/orquestrador`, e depois
      `git remote set-url origin https://github.com/chacal88/orchestrator.git`. Nunca criar um repositório com o nome
      antigo depois disso. Verificação: `gh repo view chacal88/orchestrator --json name` devolve `orchestrator`, e
      `gh repo view chacal88/orquestrador --json name` também devolve `orchestrator` (redirecionamento) — cx: simple
- [ ] 7.2 **Precisa do ok do dono**, depois da reinstalação (passo `producao`):
      - `git mv .orquestrador .orchestrator` neste repo;
      - `deploy.commands` passa a `claude plugin marketplace update orchestrator` e
        `claude plugin update orchestrator@orchestrator`;
      - os `details` de `completo.json`/`rapido.json` passam a citar `claude plugin validate orchestrator` e
        `claude plugin test orchestrator`;
      - o `command` do passo de deploy do `rapido.json` (`claude plugin marketplace update orquestrador`, linha 142)
        passa a `orchestrator`.

      Num PR próprio ou junto do release, como o dono preferir. Verificação: o painel ⚙️ não mostra o aviso de
      `legacy` neste repo — cx: simple
- [ ] 7.3 **QA do dono**, depois da reinstalação (era a 6.4; C1, C8): digitar `/orchestrator` e ver o menu com os
      onze comandos; rodar `/orchestrator:status` no desktop e pelo Remote Control; num flow de teste no grill,
      `/orchestrator:approve` anda o flow e `/orchestrator:end` encerra de primeira. Verificação: o dono aprova no passo
      `qa` — cx: simple
