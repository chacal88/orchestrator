# O mod acorda a coordenação quando uma filha termina

## Por quê

A 0.12.3 (`sessoes-filhas`) fez a coordenação abrir uma sessão filha por passo e por fase, com `start_session`,
`initiation: "user_asked"` e `wake_when_done: true`. O app Claude desktop só aceita o `user_asked` no turno do dono e nos
`<side-sessions-event>` que vêm em sequência direta dele. Qualquer turno no meio, seja uma mensagem de outra sessão ou o
tick de um `ScheduleWakeup`, quebra essa corrente. Daí em diante toda sessão nova vira um cartão que o dono precisa clicar.

A quebra não é rara, é inevitável:

- o flow espera CI externo e a coordenação precisa conferir de tempos em tempos (`ScheduleWakeup`);
- depois de um passo do dono, quando o clique acorda a coordenação, a cadeia de `<side-sessions-event>` já não vem do
  turno dele;
- numa change longa, com várias ondas.

O dono quer que o flow corra sozinho em sessões filhas, sem clicar a cada passo.

## Decisão do dono

O mod acorda a coordenação quando uma filha dela termina o turno, **só com uma opção que o dono liga no painel**. O
mecanismo já existe: quando o dono aperta um botão do flow, o `pressFlow` manda à coordenação uma mensagem com
`$.prompt.submit` (`changes/clique-acorda-coordenacao/`), e essa mensagem entra como turno do dono, que o app aceita
para o `user_asked`.

## O que muda

- **Opção no painel ⚙️.** O cartão "Este projeto" ganha a opção "Seguir o flow sem clique", logo abaixo da ativação.
  Ela começa desligada. O texto diz ao dono, em linguagem simples, que, ligada, o painel avisa a coordenação cada vez
  que uma sessão do flow termina o turno, e que com isso a coordenação abre as próximas sessões em nome dele, sem
  cartão para clicar. A opção só aparece com o orquestrador ativo no clone.
- **Onde se grava.** No registro do próprio mod, `~/.claude/orquestrador/autowake.json`, por raiz do repositório,
  como o `activation.json` da ativação (detalhe e justificativa em `design.md`). Fica local à máquina, não é
  versionada, e o modelo não consegue ligá-la sozinho, porque `touchesGateFiles` já recusa escrita nessa pasta.
- **O aviso.** Com a opção ligada e um flow `running` desta coordenação, quando o refresh periódico do mod
  (`$.clock.every`, 15 s) vê uma filha passar de trabalhando a parada, o mod manda à coordenação:
  `Painel: a sessão "<título>" terminou o turno. Siga o flow.`. Com várias de uma vez, vai uma mensagem só, com os
  títulos juntos. A mensagem vai em nome do mod, sem `asUser`, como a do clique.
- **Quais filhas contam.** Só as sessões não arquivadas que a coordenação abriu (`startedBy` igual à coordenação) ou
  que estão ligadas a uma fase do plano publicado, e só enquanto um flow desta coordenação está `running`. Não contam
  as arquivadas, as que o dono abriu fora do plano nem as de outro flow.
- **Quem manda.** Só a instância do mod que roda na sessão coordenadora. As filhas também carregam o mod e podem
  estar na mesma pasta ou numa worktree abaixo dela, por isso o `FlowState` passa a guardar o id da sessão que
  coordena (`coordinatorSession`), gravado no `flow start` e no `flow report`.
- **Uma vez por fim de turno.** O mod guarda no `$.state`, por sessão, o último estado visto e o último fim de turno
  já avisado. A mesma parada vista em dois refreshes gera um aviso só, e ligar a opção não avisa paradas antigas.
- **Coordenação ocupada.** O mod não manda nada enquanto a própria coordenação está trabalhando. O aviso fica
  pendente e sai no primeiro refresh em que ela estiver parada, juntando o que acumulou.
- **Aviso duplicado.** Quando a corrente do app está inteira, a coordenação também recebe o `<side-sessions-event>`.
  Isso é aceitável: a coordenação só confere `flow status`, e o segundo aviso termina sem trabalho.
- **Skill.** Com a opção ligada, a mensagem "Painel: … terminou o turno" é turno do dono e permite o `user_asked`. A
  coordenação pode usar `ScheduleWakeup` para esperar CI, porque o próximo fim de turno de filha refaz a corrente. Se o
  tick do `ScheduleWakeup` encontra um passo para abrir, a coordenação ainda não pode abrir a sessão nesse turno e
  propõe o cartão, como hoje. Com a opção desligada, vale o que já está escrito.
- **README.** Uma linha sobre a opção.
- **i18n.** Os textos da opção ficam em pt-BR e en (`orquestrador/hooks/i18n-workflows.ts`). A mensagem à coordenação
  fica em pt-BR fixo, como a do clique (`wakePrompt`).
- **Versão.** 0.13.0 em `orquestrador/.claude-plugin/plugin.json`, porque é recurso novo.

## Critérios de aceite

1. O cartão "Este projeto" mostra a opção "Seguir o flow sem clique", desligada por padrão e só com o clone ativo, em
   pt-BR e en, com o texto que diz que ela abre as sessões em nome do dono. Ligar ou desligar grava em
   `~/.claude/orquestrador/autowake.json` para a raiz do repositório e vale sem reiniciar.
2. Com a opção ligada e um flow `running`, uma filha que passa de trabalhando a parada gera exatamente um
   `$.prompt.submit` na coordenação, com o título dela e "Siga o flow". Teste de harness.
3. Com a opção desligada, nenhum aviso. Teste de harness.
4. A mesma parada vista em dois refreshes gera um aviso só. Teste de harness.
5. Uma sessão fora do plano (nem `startedBy` da coordenação, nem fase do plano) ou arquivada não gera aviso. Teste de
   harness.
6. Só a sessão coordenadora avisa: o mod de uma filha na mesma pasta não manda nada. Teste de harness.
7. Com a coordenação trabalhando, o aviso espera e sai uma vez quando ela para. Teste de harness.
8. A skill diz o que muda com a opção ligada (`user_asked` depois do aviso, `ScheduleWakeup` para CI) e mantém o texto
   atual para a opção desligada. O README tem a linha da opção.
9. A versão é 0.13.0, `claude plugin test orquestrador` passa e o `tsc` passa.
10. Na evidência, um teste no app real mostra que, depois do aviso do painel, a coordenação abre a sessão seguinte com
    `user_asked` sem cartão. Se o app recusar, a fase registra isso e passa a mensagem para `asUser: true` (ver
    `design.md`).

Fora do escopo: acordar a coordenação por outros motivos (CI que terminou, PR aprovado). O mod só observa fim de
turno das filhas.
