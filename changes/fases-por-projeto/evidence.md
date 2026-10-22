# Evidência — fases por projeto

Resultado da change inteira, na branch da coordenação (`claude/orchestrator-phases-automation-f69f0d`), com as
fases 1 a 9 juntadas e a `main` 0.7.7 (checagem final do flow). Binário do app 2.1.308 (o `claude` do PATH é o 2.1.227).

## Testes

```
$ PATH=".../2.1.308/a93ded4b1b47/claude.app/Contents/MacOS:$PATH" \claude plugin test orquestrador
 248 pass
 0 fail
Ran 248 tests across 22 files.
```

## Tipos

```
$ npx -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.308, hooks + types + tests
exit=0
```

## Validação

```
$ PATH=".../2.1.308/a93ded4b1b47/claude.app/Contents/MacOS:$PATH" \claude plugin validate orquestrador
  ❯ ./register.tsx hooks: …, command.run{command=orquestrador-workflows}, …
✔ Validation passed
```

## Portões pulados pelo dono

- Fase 1, `lint`: o mod não reconhece o `tsc` (a checagem de tipos deste repo) como lint; o `tsc` passou com saída 0.
- Fase 3a, `regras`: o `aidakit:reviewer-quality` aprovou na 2ª rodada (0 bloqueante/importante), mas o mod leu o
  veredito como reprovado por o texto conter "rejected".

## Fase 5 — Documentação e versão (5.1, 5.2)

- 5.1 README: "Workflows do projeto" (painel ⚙️, derivado com exemplo trunk-based, dev/master, biblioteca com
  `revisao-pr`/`merge`/`deploy`, agentes) e os itens novos em "O que ele faz".
- 5.2 `plugin.json` 0.8.0; este arquivo com o resultado da change inteira.

## Fase 1 — Formato do workflow

Branch `claude/fpp-formato-24fee1`. Tarefas 1.1–1.5.

- 1.1 `types/index.d.ts`: `details`, `agent`, `model`, `effort`, `merge`, `deploy` (opcionais) em `FlowStep`;
  `FlowStepDetails`, `FlowEffort`, `FlowMerge`, `FlowDeploy`, `FlowAdd`, `FlowDerived`; `FlowDef.base`.
- 1.2 `parseFlow` → `parseExtras`/`parseMerge`/`parseDeploy` em `hooks/flow.ts`. Testes em
  `tests/flow-resolve.test.ts` § "parseFlow: describing a step"; os testes antigos de `parseFlow` seguem passando.
- 1.3 `resolveFlow` e `resolveProjectFlows` em `hooks/flow.ts`. Um teste por erro (base inexistente, ciclo de
  base, remover o laço, `remove`/`after`/`override` inexistente, id duplicado, `override` de id/kind, `order`
  incompleto) e pelos casos de sucesso (o trunk do design, remoção encadeada, merge manual, passo novo sem
  outcomes, `order`, derivado de derivado).
- 1.4 `hooks/flows/library.ts` (`LIBRARY`, `libraryStep`, `NEXT_STEP`): `revisao-pr`, `merge`, `deploy` e os
  passos dos padrões por id. `details` em todos os passos de `completo` e `rapido`; agentes: `planejar` →
  planejador, `revisao-plano` → revisor-plano, `executar` → publicador, `revisao-codigo` → revisor-codigo,
  `pr` → abre-pr. Ids, ordem, kinds e outcomes inalterados (`tests/flow.test.ts` § default flows).
- 1.5 `loadFlows` em `hooks/register.tsx` lê os arquivos crus e chama `resolveProjectFlows`; erros de JSON e de
  resolução juntos em `problems`. Teste de harness em `tests/flow-harness.test.ts` (último teste).

Decisões tomadas na fase (revisáveis nas fases seguintes):

- `agent` vale em `session`/`loop` **e** em passo com `merge`/`deploy` (a biblioteca dá a eles os agentes
  `merge` e `deploy`, e esses passos são `owner`/`automatic`).
- `publicador` ficou no laço `executar` (único nome sem passo de sessão nos padrões).
- `merge`/`deploy` exigem o kind coerente com `auto` (`true` → automatic, `false` → owner).
- `deploy` da biblioteca: `ci: true` por padrão; com `auto: true` o comando do passo é o primeiro de `commands`
  (ou `gh run watch`) — forma provisória até os sub-estados da fase 2.
- Passo acrescentado: os outcomes com `next: "$seguinte"` (os da biblioteca, ou os padrões por kind quando o
  passo novo não declara outcomes) recebem o `next` antigo do outcome de avanço de `after`.
- Ciclo de `base` é detectado pelo arquivo; um workflow do projeto com o mesmo id da sua base deriva do padrão.

Portões (depois da última edição):

```
$ "$HOME/Library/Application Support/Claude/claude-code/2.1.308/a93ded4b1b47/claude.app/Contents/MacOS/claude" plugin test orquestrador
 180 pass
 0 fail
Ran 180 tests across 17 files.

$ npx -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.308, opções do cabeçalho
exit 0
```

## Fase 3a — Agentes e skill (3.1, 3.4)

- 8 agentes em `orquestrador/agents/` (planejador, revisor-plano, executor, revisor-codigo, abre-pr, publicador, merge, deploy), em português, com papel, leitura, entradas/entrega, critério de pronto, outcome e o que nunca fazem. `merge` confere `reviewDecision`/`statusCheckRollup` antes do `gh pr merge`; `deploy` confirma o CI (`gh run watch --exit-status`) e roda cada rotina de `commands` na ordem.
- Correção da fase 1: laço `executar` de `completo.ts` e `rapido.ts` passa a `agent: "executor"`; `.orquestrador/flows/rapido.json` ganha `executar`→`executor` e `publicar`→`publicador`. Só esses campos.
- Teste: `tests/flow-resolve.test.ts:97` esperava `executar: 'publicador'`; ajustado para `'executor'` (única mudança em testes, consequência da correção).
- Skill: § 1 mostra sempre os workflows de `flow list` antes do `flow start`; § 2 e § 4 despacham com o agente do passo (corpo no prompt, o do projeto vence, modelo/esforço do passo valem); § 6 trata `revisao-pr`, `merge` e `deploy` manuais/automáticos (nunca `--admin`).
- Portões: `claude plugin test orquestrador` → 189 pass, 0 fail, saída 0; `claude plugin validate orquestrador` → "Validation passed" (a saída não lista os agentes por nome; só avisa do ícone ausente).
- Revisão de regras (aidakit:reviewer-quality): bloqueante corrigido (merge/deploy automáticos não levam `flow report`); skill agora instrui em vez de afirmar recusa do mod que só chega na 2.2, aponta o caminho do plugin por `${CLAUDE_PLUGIN_ROOT}` e manda avisar o dono em falha; "nunca faz" específico em merge e deploy. Não feito de propósito: `planejador`/`revisor-codigo` no `rapido.json` (a tarefa limitou a mudança a `executar` e `publicar`); bloco comum de "nunca faz" repetido nos agentes é intencional, pois cada corpo vai sozinho no prompt da sessão.

## Fase 2 — Merge e deploy

Branch `claude/cool-ardinghelli-20969e` (sobre `claude/orchestrator-phases-automation-f69f0d` com a fase 1, mais a
`main` com o 0.7.7, cuja recusa de merge esta fase estende). Tarefas 2.1–2.4.

- 2.1 `merge` da biblioteca: `auto: false` → passo do dono com `detect: gh pr merge`; `auto: true` → automático com
  `gh pr merge`. A descrição do passo diz o método (`O PR da change entra em main por rebase.`) e o `describeFlow`
  também: no automático, conferir aprovação e CI com `gh pr view --json reviewDecision,statusCheckRollup`, rodar
  `gh pr merge <pr> --<method>` sozinho, nunca `--admin`. Testes em `tests/merge-deploy.test.ts` § merge.
- 2.2 `refuseMerge` (`hooks/register.tsx`): numa checkout orquestrada, `gh pr merge … --admin` é recusado para
  qualquer PR (`MERGE_ADMIN` em `gates.ts`); para o PR da própria change, na janela de merge, soma-se ao portão final
  a revisão do PR ainda não respondida antes do próximo merge (`pendingReview` em `flow.ts`, que acerta o caso
  dev/master: a revisão antes do merge em dev não segura o merge em main). A mensagem diz cada motivo e o log de
  portões registra `gates: ["revisao-pr", "--admin", …]`. Harness em `tests/merge-scope-harness.test.ts` (revisão
  pendente, `--admin`, permitido com o flow andando para o deploy) e unitários em § pendingReview.
- 2.3 Deploy com sub-estados em `FlowState.progress[<passo>] = { ci, commands }` (ao lado de `records`, que guarda
  só o outcome final): `ci` confirmado pelo botão "Deploy do CI concluído" (`DEPLOY_CI_OUTCOME`, em
  `ownerChoices` enquanto falta) ou por `gh run watch|view … --exit-status` passando; cada rotina de `commands`
  conta só depois do CI e só como a próxima da ordem; saída mascarada não conta (`masksExitCode`). Com tudo
  cumprido o mod avança o passo (`passou` por `automatic`, ou o outcome do dono por `mod`); ninguém reporta o
  avanço antes disso. Rotina falhando: automático → `falhou` e tenta de novo guardando o que já passou; do dono →
  segura. Voltar de um passo posterior zera o progresso. `describeFlow`: `auto: true` → "Deploy by yourself right
  after the merge, without waiting on the owner"; `auto: false` → espera o dono. `observeFlows` encaminha o passo
  de deploy para `observeDeploy` e registra no log do flow o que não contou. Testes: só CI, só rotinas, os dois,
  rotina falhando, ordem errada, volta; harness do mod vendo o deploy pela Bash.
- 2.4 `parseFlow` junta os `commands` dos passos de deploy ao `detect` de `producao` quando os dois existem.
  Testes em § the deploy's routines answer production.

Decisões (revisáveis):

- Os sub-estados ficam em `FlowState.progress`, não dentro de `FlowStepRecord`: o registro só existe depois do
  outcome, e o `enter` já sabe descartar o que fica do passo em diante.
- `--admin` é recusado em qualquer `gh pr merge` de uma checkout com run, não só no PR da change.
- O comando do deploy automático da biblioteca virou `gh run watch` (ou a primeira rotina sem CI); ele só nomeia
  onde o passo começa — quem decide é `observeDeploy`.

Portões (depois da última edição):

```
$ PATH="$HOME/Library/Application Support/Claude/claude-code/2.1.308/a93ded4b1b47/claude.app/Contents/MacOS:$PATH" \claude plugin test orquestrador
 207 pass
 0 fail
Ran 207 tests across 19 files.

$ npx -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.308 (plugin-authoring), opções do cabeçalho
exit 0
```

## Fase 3b — Agente no status e lista de workflows (3.2, 3.3)

- 3.2: `flow status` de um flow em andamento acrescenta, no passo atual, agente (origem e caminho), modelo, esforço e `details`. `.orquestrador/agents/<nome>.md` vence `$.plugin.root/agents/<nome>.md`; sem nenhum dos dois, diz "nenhum arquivo encontrado", sem erro. No laço, o cabeçalho é "Cada fase deste passo usa:". Passo sem agente nem details não ganha bloco.
- 3.3: `flow list` mantém a primeira linha de cada workflow (`id — título: passos → fim`) e traz Descrição, Origem (padrão / do projeto / derivado de X) e Passos com quem responde (sessão, dono, mod), agente e merge/deploy manual ou automático; erros de arquivos seguem como `ignored: …`.
- Testes novos: `tests/flow-agent-harness.test.ts` (6: agente do plugin, do projeto vencendo, inexistente, passo sem agente, laço, lista).

Amostra de `flow status` (rapido, passo planejar, agente do plugin):

```
Flow rapido for demo: step "planejar" (Planejar OpenSpec), attempt 1 of 3. Do the step, then report one of its outcomes with action "report": pronto → validar.
Neste passo:
  Agente: "planejador" (do plugin). Instruções do agente: <plugin>/agents/planejador.md
  Modelo: claude-opus-5-5
  Esforço: high
  Entrada: O pedido do dono para uma change pequena.
  Saída: proposal.md e tasks.md da change.
  Bloqueia: Sem plano escrito, não há validação.
```

Amostra de `flow list` (um workflow derivado):

```
trunk — Trunk: planejar → validar → … → pr → merge → qa → producao → arquivar → fim
  Descrição: Para changes pequenas: plano curto (proposta e tarefas), fases, revisão de qualidade, checagem, PR, QA e produção.
  Origem: derivado de rapido
  Passos: planejar (sessão, agente planejador) → validar (mod) → executar (mod, agente executor) → … → merge (dono, merge manual, agente merge) → qa (dono) → …
```

- Portão testes: `claude plugin test orquestrador` → 213 pass, 0 fail, saída 0.
- Portão tipos: `npx -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json` (mesmo tsconfig do § Tipos acima) → saída 0, sem mensagens.

## Fase 4 — Painel ⚙️ Workflows (4.1–4.4)

- 4.1 `/orquestrador-workflows` abre/fecha o pane `orquestrador-workflows` (`⚙️ Workflows`), sem tocar no 🧭. O painel está em `hooks/workflows-pane.tsx` (desenho, ações e o "Salvar"); a lógica pura de edição e gravação em `hooks/workflow-edit.ts`; `register.tsx` só registra o comando, o `command.run` e o `ui.render`. `readFlowDir`/`loadFlows`/`findAgent` saíram do `register.tsx` para `hooks/flow-files.ts` como `function` (o engine só segue o `$` passado a uma função importada quando ela é declarada assim) e servem aos dois painéis e ao `flow`, sem mudança de comportamento.
- 4.2 Visão. Lista: cada workflow como link com o título, uma linha `id · origem · N passos` (padrão / do projeto / derivado de X) e a descrição; abaixo, "Arquivos com erro em .orquestrador/flows/" com cada erro em vermelho; no fim, "Novo workflow". Ao abrir: "← Workflows", título, `id · origem`, descrição, botão "Editar" e os passos numerados; cada passo tem uma linha `🤖 sessão · agente planejador (do plugin) · modelo · esforço` e, ao ser aberto (▸/▾), Entrada/Saída/Bloqueia, Agente com a origem (do projeto, do plugin, sem arquivo), Modelo e Esforço, Comando, "Exige evidência", e para merge `branch · método · automático` e para deploy `CI · rotinas · automático`. Tudo em coluna com quebra de linha; abaixo de 44 colunas os botões empilham. No mobile a visão é a mesma e os campos de texto dão lugar a um aviso.
- 4.3 Edição ("Editar" ou "Novo workflow" com id e "do zero" / "a partir de X"): título e descrição; por passo aberto, "Desligar/Ligar passo", "↑ Subir", "↓ Descer", Agente (campo), Modelo e Esforço (escolhas), e em merge Branch, Método e "Merge automático: sim/não"; em deploy "Deploy pelo CI", Rotinas (uma por linha) e "Deploy automático". "Acrescentar passo" entra depois do passo aberto (ou no fim): da biblioteca (escolha) ou novo (título, quem responde — sessão, dono, mod — agente e, se automático, comando). Merge/deploy que vira automático (ou volta) é reconstruído pela biblioteca, mudando quem responde. Tudo fica em `wfDraft` no estado do mod até "Salvar" ou "Descartar"; o aviso "Rascunho: nada é gravado até Salvar" fica no topo.
- 4.4 "Salvar" (`draftFile` + `resolveCandidate`): monta o arquivo e o resolve como o mod carregaria (com os outros arquivos do projeto); com erro, mostra "Não salvei: <erro>" e não grava. Com base grava o derivado: `remove` (passos desligados), `add` (`{ use, …só o que difere }` da biblioteca, ou o passo inteiro), `override` (campos mudados e os outcomes religados quando um passo sobe/desce) e `order` só quando a ordem mudou; confere que o resolvido sai igual ao rascunho. Do zero grava `steps` completos. Editar um padrão mostra "⚠ rapido é um workflow padrão. Salvar cria .orquestrador/flows/rapido.json, que passa a valer no lugar do padrão" e, salvo, "O workflow padrão rapido segue no mod, mas este projeto passa a usar o seu no lugar dele." Só o clique grava: nenhuma ferramenta do mod escreve workflow.

Testes novos — `tests/workflows-pane.test.ts` (7):
- 4.1 abre e fecha o próprio pane ao lado do 🧭;
- 4.2 lista com origem e erros (desktop, terminal, mobile, 30 colunas) e um workflow passo a passo, com merge, deploy e agente;
- 4.3 edição completa só no rascunho, que sobrevive a redesenho e some no "Descartar", sem arquivo em disco;
- 4.4 salvar derivado (o JSON exato gravado e o `flow list` resolvendo igual);
- 4.4 inválido sem gravar (desligar `executar`; do zero sem passos);
- 4.4 do zero com `steps` completos;
- 4.4 editar o padrão `rapido` com aviso; a change `demo` iniciada antes segue com o snapshot (arquivo de estado byte a byte igual, `qa` presente); editar de novo parte do arquivo do projeto.

Decisões (revisáveis):
- "Subir/descer" muda o caminho, não só a lista: os outcomes de avanço de cada passo seguem o próximo passo ligado (num derivado, via `override` dos outcomes + `order`).
- Num passo vindo da base dá para trocar agente/modelo/esforço, não apagar (o `override` só sobrepõe); o "Salvar" diz isso em vez de gravar.
- Os nomes dos campos do estado são `wfSelected`, `wfFocus`, `wfDraft`, `wfForms`, `wfNotice` (contrato em `types/index.d.ts`).

Portões (depois da última edição):

```
$ npx -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.308, opções do cabeçalho, hooks + types + tests
exit 0

$ PATH=".../2.1.308/a93ded4b1b47/claude.app/Contents/MacOS:$PATH" \claude plugin validate orquestrador
  ❯ ./register.tsx hooks: …, command.run{command=orquestrador-workflows}, …
✔ Validation passed

$ PATH=".../2.1.308/a93ded4b1b47/claude.app/Contents/MacOS:$PATH" \claude plugin test orquestrador
 220 pass
 0 fail
Ran 220 tests across 21 files.
```

## Fase 6 — Merge seguro (6.1–6.4)

Branch `claude/fpp-merge-seguro-e21dc5`. Testes novos em `tests/merge-safe.test.ts` (um por forma).

- 6.1 O guarda lê o comando como o shell o roda (`commandsRun` em `gates.ts`): palavra por palavra, tirando as
  aspas, juntando `\` + quebra de linha e entrando nos scripts de `bash -c`/`sh -c`/`eval` e de `$(…)`/`` `…` ``;
  corpo de heredoc segue texto. `mergeCalls` acha cada merge e diz o PR, se tem `--admin` e se algum argumento
  carrega `$`. Recusados: `"--admin"`, `'--admin'`, `bash -c "… --admin"`, `sh -c '…'`, `eval "…"`, `\` + quebra
  + `--admin`, e `$VAR`/`$(…)`/`` `…` `` nos argumentos ("the mod cannot see what it carries"). Seguem livres:
  `gh pr merge 805 --squash`, `echo "gh pr merge … --admin"`, um commit cuja mensagem cita o comando, um heredoc.
- 6.2 As mesmas recusas valem para `gh -R o/r pr merge`, `gh --repo[=]o/r pr merge`, `gh api …/pulls/<n>/merge`
  (qualquer método; o alvo é `<n>`) e `gh api graphql` com `mergePullRequest` (o PR vem por node id, que o mod não
  lê: tomado como o da change, falha fechada), também dentro de `bash -c`/`sh -c`/`eval`. `gh api` que não faz
  merge (`pulls/<n>`, `pulls/<n>/files`, graphql de leitura, proteção de branch) segue livre. O teste rápido que
  manda ao guarda (`GH_MERGE`) passou a ser `gh` … `merge` no texto bruto, também no `isGuarded` (o guarda que
  recusa quando o mod falha).
- Fora do alcance do mod, registrado: um `git merge` local seguido de `git push` direto na branch protegida não é
  um merge de PR; quem o barra é a proteção de branch do GitHub (push direto exige PR aprovado e CI verde), não o
  mod. Também ficam fora: `gh` chamado por alias do usuário, um script em arquivo (`bash merge.sh`), e
  `bash -c "$X"`/`eval "$X"` cujo conteúdo inteiro vem de variável.
- 6.3 `isAgentName` (`^[a-z0-9]+(-[a-z0-9]+)*$`, em `gates.ts`): o `parseFlow` recusa o nome como erro de parse
  citando o passo (`x.json: step "a": \`agent\` "../x" must be lowercase words joined by hyphens…`) — uma linha no
  `parseExtras` e o import em `flow.ts`; o `findAgent` devolve "sem agente" sem montar caminho. Teste com `../x`.
- 6.4 Skill `change-orchestrator` § 4: "o mod recusa", no presente, com as formas cobertas.

## Fase 7 — Deploy e painel (7.1–7.6)

- 7.1 `watchRoutines` guarda à parte, em `detect.routines`, as rotinas do deploy que juntou aos comandos de `producao`. `resolveFlow` devolve o `detect` de cada passo copiado da base ao que é dele (`ownDetect`) antes de `remove`/`add`/`override`, e o `parseFlow` final junta só as rotinas do deploy que ficou. `remove: ['deploy']` tira as rotinas; o override de `deploy.commands` deixa só as novas; os comandos próprios de `producao` (e um override deles) continuam.
- 7.2 Um deploy do dono sem CI (`ci: false`, `auto: false`) mostra o botão "Deploy concluído" (o primeiro outcome do passo), em `flowView().ownerChoices`, também no meio das rotinas. `applyOutcome` aceita esse outcome só do dono (`ownerConfirms`), e o `describeFlow` diz que o botão existe. Um deploy que espera o CI segue só com "Deploy do CI concluído".
- 7.3 `observeDeploy`: `gh run watch|view … --exit-status`, passando ou falhando, só é lido quando o passo espera o CI e ele não foi confirmado. Nos outros casos devolve `undefined` e o comando é ignorado.
- 7.4 O rascunho guarda `source`, o arquivo do projeto de onde foi aberto. "Novo workflow" e "Salvar" de um rascunho sem `source` recusam quando algum arquivo de `.orquestrador/flows/` já tem o id (válido ou que não resolve) ou o nome `<id>.json` (até JSON quebrado). A recusa nomeia o arquivo, e só o arquivo de origem pode ser regravado.
- 7.5 `brokenDependents`: antes de gravar, resolve os workflows do projeto com o arquivo novo no lugar. Os que resolviam e deixariam de resolver (filhos e netos do salvo) fazem o "Salvar" recusar, listando cada um com o arquivo e o erro.
- 7.6 A guarda final do `draftFile` também compara (com chaves em ordem) agente, modelo, esforço, merge, deploy e details de cada passo do rascunho com o resolvido. Se diferir, recusa nomeando o passo e o campo. Os comandos próprios do `detect` de `producao`, quando diferem da base, vão para o `override` e o painel avisa ("O passo producao tem detect próprio (…), gravado no override…"); antes eles sumiam. Um workflow inteiro grava só os comandos próprios de `producao`, nunca as rotinas juntadas.

Testes novos:
- `tests/merge-deploy.test.ts`: 7.1 (×2), 7.2 e 7.3. O teste da fase 2 "only routines, owner's" deixou de exigir `ownerChoices` vazio.
- `tests/workflows-pane.test.ts`: 7.4 (×2), 7.5 e 7.6 (×2).

Portões de cada fase, depois da última edição dela (a 6 e a 7 rodaram em branches separadas; o resultado das duas
juntas está no § Testes do topo):

```
# fase 6 (claude/fpp-merge-seguro-e21dc5)
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json
exit 0
$ PATH=".../2.1.308/a93ded4b1b47/claude.app/Contents/MacOS:$PATH" \claude plugin test orquestrador
 233 pass
 0 fail
Ran 233 tests across 22 files.

# fase 7 (claude/fpp-deploy-painel-837674)
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json
exit 0
$ PATH=".../2.1.308/a93ded4b1b47/claude.app/Contents/MacOS:$PATH" \claude plugin test orquestrador
 229 pass
 0 fail
Ran 229 tests across 21 files.
```

## Fase 8 — Correções da 2ª revisão (8.1, 8.2), feitas pela coordenação

- 8.1 `opaqueMerge` (`gates.ts`): quando o texto tem `gh` e `merge` e `mergeCalls` não acha a chamada, o guarda
  procura um comando que não seja `gh` nem um programa que só imprime ou lê (`echo`, `printf`, `cat`, `grep`, `git`,
  `cd`, `ls`…), ou cujo executável venha de variável; achando, `refuseMerge` recusa (falha fechada) dizendo que não
  consegue ver o merge. Cobre `xargs`, `find -exec`, `timeout`, `nice`, `env -u`, `sudo -u`, `command -p`, heredoc
  para `bash`, `echo … | sh`, `cat <<EOF | bash`, `$G pr merge` e `"$(command -v gh)" pr merge`. O `commandsRun`
  passou a manter o resto da linha que abre um heredoc (antes, `cat <<'EOF' | bash` perdia o `| bash`). Seguem
  livres `gh pr view … mergeable`, `cd && gh pr checks`, `grep "gh pr merge"` e um `git commit` com heredoc.
  Skill § 6 cita a recusa. Testes em `tests/merge-safe.test.ts` (3).
- 8.2 `ownerConfirms` aceita "Deploy concluído" do dono quando o deploy não espera mais o CI: sem CI desde o
  início, ou com o CI já confirmado e só rotinas restando. Teste em `tests/merge-deploy.test.ts`.
- Fora do alcance, como antes: alias do usuário, script em arquivo (`bash merge.sh`) e `bash -c "$X"` com o
  conteúdo inteiro numa variável; `git merge` + `git push` direto na branch protegida fica com a proteção de
  branch do GitHub, que precisa de "include administrators" ligado para valer também para admins.

## Fase 9 — Correções da 3ª revisão (9.1, 9.2), feitas pela coordenação, depois do "Tentar de novo" do dono

- 9.1 `opaqueMerge` julga cada comando da linha. Sem merge lido, vale a regra da fase 8 (qualquer comando que
  executa algo). Com um merge lido, cada outro comando é recusado quando ele mesmo cita `gh` e `merge`, quando é um
  shell lendo do stdin ou quando o executável vem de variável; `refuseMerge` passou a consultar `opaqueMerge` sempre.
  `gh pr merge 6 --squash && xargs gh pr merge --admin` e `…; timeout 5 gh pr merge 5 --admin` são recusados;
  `git pull && gh pr merge 805 --squash && npm test` e `… && bash scripts/after-merge-check.sh` seguem livres.
- 9.2 `git` saiu de `INERT`: `gitRuns` recusa `-c alias.*=!…`, `rebase --exec`/`-x`, `filter-branch` e `bisect run`
  quando a linha cita `gh` e `merge`; `git commit`/`log`/`add`/`push` seguem livres.
- Testes em `tests/merge-safe.test.ts` (2). Restos registrados na fase 8 seguem como estão.

## Revisão de código — resultado final

- Arquitetura: aprovado (1ª rodada). Qualidade: aprovado (3ª rodada; nits 7 e 8 abertos, não bloqueiam).
  Segurança: aprovado (4ª rodada, depois do "Tentar de novo" do dono).
- Risco residual que o revisor de segurança deixa para o dono aceitar ou mandar fechar:
  - Nome do `gh` e do verbo montados por variável depois de um merge legível na mesma linha
    (`G=gh; M=merge; gh pr merge 6 --squash; timeout 5 $G pr $M 5 --admin`). Exige ofuscação deliberada;
    sem o merge de isca, é recusado.
  - `git -c core.pager=…`/`core.sshCommand=…`/`core.fsmonitor=…` rodando um merge. Exótico.
  - Script gravado numa chamada e executado em outra; `git push` direto e `--admin` por API com token. A trava
    real é a proteção de branch do GitHub, que precisa incluir administradores.
