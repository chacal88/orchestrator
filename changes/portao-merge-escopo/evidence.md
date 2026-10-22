# Evidência — portão de merge só da change, teto só com trabalho vivo

## Testes

Gate testes: `claude plugin test orquestrador` (binário 2.1.308 do app) na raiz do repo, saída 0. Os testes novos
(unidade em `gates.test.ts`, harness em `merge-scope-harness.test.ts`), os dois de harness ajustados em
`harness.test.ts`, e o resumo:

```
(pass) live phase sessions are the ones this session started and did not archive [0.17ms]
(pass) a session counts against the ceiling only with live work, and says why [0.15ms]
(pass) the merge window closes at the archive step and when the flow ends [0.15ms]
(pass) the PR a gh pr merge names: number, URL, branch or the current branch [0.28ms]
(pass) the fourth live phase session is refused; archived ones do not count [81.97ms]
(pass) the model cannot write the gate files; gh pr merge waits for the final gates [94.18ms]
tests/merge-scope-harness.test.ts:
(pass) a merge after the flow finished passes, for the change PR and any other [191.15ms]
(pass) a merge of an unrelated PR passes while the flow runs, in the coordinator and in a session it started [143.91ms]
(pass) the change's own merge is still gated while its gates are pending, matched by plan, bound PR or branch [109.24ms]
(pass) the archive PR is not blocked on stale gates after a successful archive [73.82ms]
(pass) without a flow, the archive does not make the final gates stale [77.21ms]
(pass) the ceiling ignores finished sessions and names why each counted one counts [70.47ms]
...
 165 pass
 0 fail
Ran 165 tests across 17 files. [1.32s]
```

Os testes provam as regras: com cada uma desligada à mão no código (janela do flow, regra da branch, PR
mergeado/fechado, arquivamento sem edição), a suíte falhou nos testes correspondentes (5, 2 e 2 falhas nas três
rodadas), e voltou a 165/0 com o código restaurado.

## Tipos

Gate lint/tipos: `tsc` 5.6.3 sobre hooks, types e tests com os tipos do engine 2.1.308 (`claude-code.d.ts` da skill
plugin-authoring, mais `claude-code-tools` e `claude-code-mcp` da cópia instalada), num tsconfig fora do repo com
as opções do cabeçalho dos tipos.

```
$ npx -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json; echo "tsc exit=$?"
tsc exit=0
```

## Validação

```
$ claude plugin validate orquestrador
✔ Validation passed
```

O validador lista `$.process.run (via dirtyPaths, mergeHead, openSession)`: o `mergeHead` é a leitura nova da branch
do PR. Ele também avisa `ICON_MISSING` do diretório de plugins, aviso que já existia.

## Decisão do dono

- 2026-10-22: o dono pediu que uma change com o flow terminado deixe de segurar `gh pr merge`, inclusive de PRs sem
  relação, na coordenadora e nas sessões que ela abre, e que o teto de sessões de fase deixe de contar trabalho
  terminado. Incidente: change `checkout-company-customer-cnpj` do `representante-digital`, mod 0.7.6 (PR #805
  recusado depois do `finished`; teto recusando duas sessões com PR mergeado).
