## 1. Clique acorda a coordenação

- [x] 1.1 `wakePrompt` em flow.ts: mensagem com rótulo, nota e próximo passo só quando o passo é da coordenação
- [x] 1.2 `pressFlow` envia a mensagem em nome do mod depois do toast; clique recusado não envia
- [x] 1.3 Testes de harness: passo de sessão envia uma mensagem; outro passo do dono, fim ou encerramento não
      enviam; clique recusado não envia e mostra o erro; mockup (fechado, ajustes com nota, aprovado);
      "Tentar de novo"; "Pedir ajustes no plano" envia e a liberação no plan mode não
- [x] 1.4 Skill: o clique acorda a coordenação, `ScheduleWakeup` longo como reserva, `planejar` depois do mockup
- [x] 1.5 Versão 0.7.6
