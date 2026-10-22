# Evidência — fases por projeto

## Testes

(a preencher: `claude plugin test orquestrador`, saída 0, com os testes novos)

## Tipos

(a preencher)

## Validação

(a preencher: `claude plugin validate orquestrador`)

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
