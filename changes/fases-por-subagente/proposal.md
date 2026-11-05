# Fases e passos como subagentes, sem sessão do app (0.16.0)

## Por quê

O dono não conseguia usar o flow. Cada fase e cada passo de sessão abria uma sessão do app, e o
app só abre sessão num turno que o dono digitou. Três coisas confirmam isso no código do app e do
motor 2.1.317:

- O app classifica o turno pela origem. Só `origin.kind === "human"` com `promptSource` digitado
  conta como pedido do dono. Uma mensagem do mod, mesmo com `asUser`, conta como "automated".
- O botão "Abrir as N sessões pendentes" chama `start_session` pelo `$.tool.call` do mod. No modo
  automático o classificador recusa com "the request that produced this action did not ask for
  one", porque nenhum pedido do modelo originou a chamada. O `consent` não muda isso.
- Pelo Remote Control o app só abre sessão a partir de mensagem digitada no desktop.

Resultado: o flow parava em cada fase, o botão falhava, e a coordenação pedia ao dono para abrir
sessões e mandar mensagens. Além disso, dois portões não eram vistos e viravam pedidos de pulo:

- `testes` não reconhecia `node --test` (nem `bun test`, `deno test`, `make test`, gradle…).
- `regras` com o revisor em segundo plano lia só o aviso de início, nunca o veredito.

## O que muda

1. Cada passo de sessão roda num subagente da coordenação (`Agent`, `name: "passo-<id>"`), e cada
   fase num subagente em segundo plano e em worktree própria (`name: "fase-<id>"`,
   `isolation: "worktree"`, `run_in_background: true`). Subagente abre em qualquer turno, sem o
   dono, e o motor acorda a coordenação quando ele termina.
2. O mod liga o subagente à fase no `agent.spawn` (pelo `name`) e guarda os portões que as
   chamadas dele (`agentId`) provam, à parte dos da coordenação. O painel mostra a fase com os
   portões do subagente, e o `flow close` usa esses portões.
3. O revisor (`*-reviewer`) roda sempre em primeiro plano: o mod reescreve `background` no
   `agent.spawn`, e o veredito vira a resposta do `Agent`. Um revisor com
   `name: "revisao-fase-<id>"` prova o `regras` daquela fase.
4. O portão `testes` reconhece os executores comuns (`node --test`, `bun test`, `deno test`,
   `make test`, gradle, maven, dotnet, rspec…). O `regras` reconhece também `plan-reviewer`,
   `code-reviewer` e `reviewer-security`.
5. Teto de 3 subagentes de fase rodando ao mesmo tempo, no `agent.spawn` ("barrar" recusa,
   "lembrar" avisa).
6. A resposta do `flow` nos passos de sessão e no `executar` manda usar o subagente. Nada mais
   manda usar `start_session`, `flow pending` ou o botão. A skill e o README dizem o mesmo.

## O que fica

- `flow pending`, o botão e `/orchestrator:open` continuam para flows de antes da 0.16.0.
- Fases de flows antigos, em sessões do app, continuam fechando como antes; elas também ganham
  o revisor em primeiro plano e os novos executores de teste.

## Critérios de aceite

1. Nenhum passo nem fase pede ao dono para abrir sessão, mandar mensagem ou apertar botão.
2. Uma fase em subagente fecha com os portões que o próprio subagente rodou, sem sessão arquivada.
3. Os testes de um subagente não contam para outra fase nem para a coordenação.
4. `node --test` prova `testes`; o veredito de um revisor rodado para a fase prova `regras`.
5. No máximo 3 subagentes de fase ao mesmo tempo em "barrar".
