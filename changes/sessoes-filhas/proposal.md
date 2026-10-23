# Uma sessão filha por passo de sessão

## Por quê

O dono pediu "orquestrar" e a coordenadora fez o trabalho dos passos na própria sessão, sem abrir sessões filhas.
Três coisas a empurram para isso:

- O `flow status` e o `flow start` dizem, para passo `session`, "Do the step, then report…" (`describeStepBody` em
  `orquestrador/hooks/flow.ts`). A coordenadora relê esse texto a cada volta do laço. O bloco "Neste passo:"
  (`describeStepAgent`) mostra o agente, mas não manda abrir uma sessão para ele.
- A skill `change-orchestrator` diz "faça **ou** despache" no § 2, e os §§ 3.3 e 6 falam no imperativo com a própria
  coordenadora ("Escreva proposta…").
- No app Claude desktop, uma sessão só abre sem clique com `initiation: "user_asked"`, e só quando o usuário pediu
  isso com palavras. Com `own_initiative` ela vira um cartão que fica parado. A skill nunca diz que pedir "orquestrar"
  já é esse pedido, então o modelo volta ao padrão: faz o trabalho ali mesmo ou num subagente.

## O que muda

- **Skill.** Pedir "orquestrar" conta como pedido explícito do dono por **uma sessão para cada passo de sessão e para
  cada fase**. A coordenadora abre cada uma com `start_session` e `initiation: "user_asked"`, nunca com
  `own_initiative` e nunca com um subagente no lugar dela. O prompt leva o corpo do agente do passo, e a sessão usa o
  modelo e o esforço do passo. Um passo `session` nunca é feito na coordenadora.
- **O que fica com a coordenadora:** a escolha do flow, as rodadas do grill com o dono, o mockup (quando há), a
  liberação no plan mode, `flow report`/`close`/`round`/`note` e os comandos dos passos automáticos (o mod lê o código
  de saída na sessão que roda o comando).
- **Onde trabalha cada filha:**
  - as fases do `executar` ficam em worktree própria (`use_worktree: true`), como já é a regra;
  - os passos de sessão únicos (planejar, revisões, PR, publicar) compartilham a pasta da coordenação
    (`use_worktree: false`) quando só escrevem arquivos que a coordenação não mexe. Assim o PR sai de uma branch só.
    Quando a escrita pode cruzar com a de outra sessão, o passo vai para worktree própria.
- **Mod.** Para passo `session`, o texto de `describeStepBody` passa a mandar abrir uma sessão (`start_session`,
  `initiation "user_asked"`) com o agente, o modelo e o esforço do passo, proíbe fazer o passo na coordenadora e manda
  reportar o resultado com `report` quando a sessão responder. O texto do passo `loop` lembra que é uma sessão por fase.
  As mensagens continuam em inglês, no estilo do arquivo.
- **Por que o aviso é o fim do turno.** O app só aceita `user_asked` no turno que vem do próprio dono (ou no
  `<side-sessions-event>` logo depois dele). O "FASE …: pronta" por `SendMessage` acordava a coordenação num turno de
  mensagem, onde ela não consegue abrir a próxima sessão e acabava fazendo o trabalho sozinha. Com `wake_when_done`
  o app a acorda quando a filha termina o turno.
- **Testes.** Novos testes travam as frases de passo `session` e de `loop`. Nenhum teste atual casa "Do the step".
- **Versão.** 0.12.3, em `orquestrador/.claude-plugin/plugin.json`, que é o único lugar onde a versão aparece.

## Critérios de aceite

1. O `flow status` de um passo `session` diz para abrir uma sessão com `start_session` e `initiation "user_asked"`,
   com o agente, o modelo e o esforço do passo, e diz para não fazer o passo na coordenadora. Um teste trava isso.
2. O `flow status` do `loop` diz que é uma sessão por fase. Um teste trava isso.
3. A skill diz que "orquestrar" é o pedido explícito do dono e manda usar `user_asked`, nunca `own_initiative` nem
   subagente. Diz também o que fica com a coordenadora e onde trabalha cada filha.
4. Os §§ 2, 3 e 6 da skill não mandam mais a coordenadora fazer o trabalho de um passo de sessão.
5. A versão é 0.12.3, `claude plugin test orquestrador` passa e o `tsc` passa.
6. As filhas avisam terminando o turno (`FASE <id>: pronta/bloqueada — …`), sem `SendMessage`, e a coordenação as abre com
   `wake_when_done: true`. Se o `start_session` for recusado (turno de mensagem de outra sessão ou de evento
   automático, inclusive o tick do `ScheduleWakeup`), a coordenação propõe um cartão `own_initiative`, avisa o dono
   numa linha e espera; nunca faz o passo no lugar da filha. O `flow status` do passo `session` diz isso, e um teste
   trava a frase.

Fora do escopo: o mod não recusa a coordenadora que fizer o passo sozinha. Esta change só corrige o texto.
