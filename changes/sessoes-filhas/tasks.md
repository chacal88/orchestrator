## 1. Sessões filhas

Uma fase só, porque as tarefas mexem em arquivos diferentes e o executor as faz em sequência. Os portões da fase são
`claude plugin test orquestrador` (testes) e `tsc` (tipos), os mesmos do flow `rapido`.

- [x] 1.1 `describeStepBody` (`orquestrador/hooks/flow.ts`), passo `session`: o texto manda abrir uma sessão para o passo
      (`start_session`, `initiation "user_asked"`) com o agente, o modelo e o esforço dele, diz para não fazer o passo
      nesta sessão e manda reportar o resultado com `report` quando a sessão responder, listando os resultados do passo.
      No passo `loop`, a frase passa a incluir "one session per phase". Em inglês, no estilo do arquivo. Verificação:
      `grep -n "Do the step" orquestrador/hooks/flow.ts` não acha nada — cx: simple
- [x] 1.2 Testes em `orquestrador/tests/flow.test.ts`, usando `describeFlow` num flow parado num passo `session` e num
      `loop`. O primeiro verifica que o texto tem `start_session`, `"user_asked"` e a proibição de fazer o passo nesta
      sessão, e que não tem mais "Do the step". O segundo verifica "one session per phase". Os testes que já casam
      `describeFlow` e "Neste passo"/"Cada fase deste passo usa" continuam passando. Verificação:
      `claude plugin test orquestrador` sai com 0 — cx: simple
- [x] 1.3 Skill `orquestrador/skills/change-orchestrator/SKILL.md`:
      - no § 2, "Sessão" passa a dizer "abra uma sessão filha com o agente do passo", sem o "faça ou despache";
      - um parágrafo novo diz que "orquestrar" é o pedido explícito do dono por uma sessão para cada passo de sessão e
        para cada fase, aberta com `start_session` e `initiation: "user_asked"`, nunca `own_initiative` e nunca
        subagente; diz que o corpo do agente vai no prompt e que a sessão usa o modelo e o esforço do passo;
      - a lista do que fica com a coordenadora: escolha do flow, grill, mockup, liberação no plan mode,
        `flow report`/`close`/`round`/`note` e os comandos dos passos automáticos;
      - onde trabalha cada filha: as fases em worktree própria; os passos únicos com `use_worktree: false` quando só
        escrevem arquivos que a coordenação não mexe, para o PR sair de uma branch só; os outros em worktree própria;
      - os §§ 3.3, 3.5, 6.1 e 6.2 passam a dizer que a sessão filha faz o passo e que a coordenadora reporta.

      Verificação: `grep -n "faça ou despache" orquestrador/skills/change-orchestrator/SKILL.md` não acha nada e
      `grep -n "user_asked"` acha o parágrafo novo — cx: simple
- [x] 1.4 Versão 0.12.3 em `orquestrador/.claude-plugin/plugin.json`, que é o único lugar onde a versão aparece (conferido
      no `618e7cd`). `evidence.md` da change com o resultado dos portões. Verificação: `tsc` sai com 0 e
      `claude plugin test orquestrador` sai com 0 — cx: simple
- [x] 1.5 Aviso por fim de turno (descoberta ao rodar esta change: o app recusa `start_session` `user_asked` num turno
      disparado por mensagem de outra sessão ou por evento automático). Skill: as filhas avisam terminando o turno com
      `FASE <id>: pronta — …`/`bloqueada — …` como mensagem final e só usam `SendMessage` para pedir resposta no meio do
      trabalho; a coordenação abre a filha com `wake_when_done: true`; se o start for recusado, propõe cartão
      (`own_initiative`, mesmo prompt), avisa o dono numa linha e espera, sem fazer o passo; o tick do `ScheduleWakeup`
      também é evento automático (só confere e propõe cartão). Mod: o texto do passo `session` diz isso de forma curta,
      com teste. Verificação: `claude plugin test orquestrador` sai com 0 — cx: simple
