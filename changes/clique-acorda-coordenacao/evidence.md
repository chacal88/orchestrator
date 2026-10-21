# Evidência — clique acorda a coordenação

## Testes

Gate testes: `claude plugin test orquestrador` (binário 2.1.304 do app) na raiz do repo, saída 0. Os testes novos e o
do mockup estendido, e o resumo:

```
(pass) an owner press that lands on a step the coordinator drives wakes it with one message in the mod's name [63.81ms]
(pass) a press that lands on another owner step or ends the flow sends no message [68.86ms]
(pass) an escalation retried on a session step wakes the coordinator; ended, it sends nothing [84.41ms]
(pass) a press the flow refuses sends no message and still says why [57.54ms]
(pass) the mockup: attached, adjusted with the owner's note typed in the panel, then approved [145.57ms]
(pass) asking for plan adjustments in the panel wakes the coordinator; the plan-mode release sends nothing [106.55ms]
...
 156 pass
 0 fail
Ran 156 tests across 16 files. [1.15s]
```

## Tipos

Gate lint/tipos: `tsc` 5.6.3 sobre hooks, types e tests com os tipos do engine 2.1.304
(`claude-code.d.ts` da skill plugin-authoring), num tsconfig fora do repo com as opções do cabeçalho dos tipos.

```
$ npx -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json; echo "exit=$?"
exit=0
```

## Validação

```
$ claude plugin validate orquestrador
✔ Validation passed
```

## Decisão do dono

- 2026-10-21: o dono pediu que uma aprovação no painel faça a coordenação seguir sozinha. Substitui o "Só o toast" do
  `aviso-clique`. Incidente: o dono escreveu "ja aprovei e voce nao deu sequencia" depois de apertar
  "Aprovar mockup" na change `checkout-company-customer-cnpj` do `representante-digital`.
