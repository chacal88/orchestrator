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
