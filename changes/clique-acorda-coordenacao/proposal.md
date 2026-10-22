# Clique acorda a coordenação

## Por quê

Em 2026-10-21, no `representante-digital` (change `checkout-company-customer-cnpj`, flow `completo`, mod
0.7.5), a sessão coordenadora anexou o mockup, pediu ao dono para apertar "Aprovar mockup" e terminou o turno
sem `ScheduleWakeup`: a skill só exige o agendamento com fase em voo. O dono apertou o botão, o flow andou
para `planejar`, e nada chegou à sessão. Ela ficou parada até o dono escrever "ja aprovei e voce nao deu
sequencia".

No código, o `pressFlow` registra o clique, salva o flow, atualiza o painel e mostra o toast, e só. Isso foi
decidido no `aviso-clique` ("Só o toast"). O `answerGrill`, ao contrário, termina com `$.prompt.submit`, e por
isso as respostas do grill digitadas no painel acordam a sessão.

## Decisão do dono

Em 2026-10-21 o dono pediu que uma aprovação no painel faça a coordenação seguir sozinha. Esta change
**substitui** a decisão "Só o toast" do `aviso-clique`.

## O que muda

- Depois de um clique registrado, o toast continua. Se o novo passo atual é da coordenação, o painel também
  manda uma mensagem à sessão, por exemplo:
  `Painel: o dono apertou "Aprovar mockup". Próximo passo: planejar (Planejar OpenSpec). Siga o flow.`
  Com nota, entra `com a nota "<nota>"` depois do rótulo.
- É da coordenação: passo de sessão, passo automático (a sessão roda `openspec validate`, `scripts/check.sh`,
  `openspec archive`), o laço `executar`, e o `mockup` (depois de "Entendimento fechado" ou de "Pedir
  ajustes", a coordenação anexa um mockup novo).
- Não manda nada: próximo passo de novo do dono (`qa`, `producao`, `liberacao`), flow concluído, flow
  encerrado ("Encerrar o flow"), flow escalado, ou clique recusado (que continua só com o toast do erro).
- Liberação: "Liberar execução" segue no plan mode. A aprovação no diálogo volta para a própria sessão que
  chamou `ExitPlanMode`, então não há mensagem. "Pedir ajustes no plano" no painel leva a `planejar` e acorda a
  coordenação.
- Escalada: "Tentar de novo" volta ao passo escalado e acorda a coordenação quando o passo é dela;
  "Encerrar o flow" não manda nada.
- A skill passa a dizer que o painel acorda a coordenação no clique; como reserva, esperando um passo do dono,
  a coordenação termina o turno com `ScheduleWakeup` longo (1200 s ou mais) e confere `flow status` quando ele
  dispara. No mockup: depois de "Aprovar mockup" o próximo passo é sempre `planejar`; se os artefatos já
  existem, a coordenação os reconcilia com o grill e o mockup e reporta `pronto`.
- Versão 0.7.6.

## Por que a mensagem vai em nome do mod (sem `asUser`)

O `answerGrill` usa `asUser: true` porque o texto são as palavras do próprio dono. Aqui o texto é o mod
contando um clique, não algo que o dono escreveu. Sem `asUser`, o modelo lê "The orquestrador plugin sent a
message: …", e a origem fica clara: a coordenação sabe que é o registro do painel, que pode conferir com
`flow status`, e não confunde com uma instrução digitada pelo dono. A nota do dono vai entre aspas, como
citação.
