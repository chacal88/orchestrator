# Evidência — fases e passos como subagentes (0.16.0)

## Causa, lida no app e no motor instalados

- App (`/Applications/Claude.app`, `app.asar`): o classificador de turno só aceita como do dono a
  mensagem com `origin.kind === "human"` e `promptSource` digitado; o resto é "automated".
- Motor 2.1.317: a recusa do botão é a do modo automático, "the request that produced this action
  did not ask for one", que sai quando a chamada não vem de um pedido do modelo.

## Portões

```
$ claude plugin test orchestrator        # motor 2.1.317 do app
 539 pass
 0 fail
Ran 539 tests across 40 files.

$ claude plugin validate orchestrator
✔ Validation passed                      # só o aviso antigo de ícone

$ npx -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do motor 2.1.317
exit=0
```

## Testes novos

- `tests/agents-harness.test.ts`: uma fase em subagente fecha com `node --test` rodado nele e o
  veredito do revisor `revisao-fase-1`, sem sessão aberta nem arquivada e sem pendência; o teste
  de outro subagente não conta para a fase; o revisor sai em primeiro plano; o teto de 3 fases.
- `tests/agents.test.ts`: nomes `fase-<id>`/`passo-<id>`/`revisao-fase-<id>`, o registro do
  subagente, o teto, e os executores de teste que contam e os que não contam.
- `tests/flow.test.ts`: a resposta do `flow` manda usar o `Agent` e nunca `start_session`.

## Não verificado aqui

O comportamento no app real (o `agent.spawn` do modelo chegando ao hook com o `name`, e o
`agentId` nas chamadas do subagente) segue os tipos do motor 2.1.317, mas só se confirma com o
plugin atualizado numa change de verdade.
