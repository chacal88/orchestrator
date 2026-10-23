## 1. O mod acorda a coordenação

Fase de código do mod. Os portões são `claude plugin test orquestrador` (testes) e `tsc` (tipos), os mesmos do flow
`rapido`. Arquivos: `orquestrador/hooks/wake.ts` (novo), `register.tsx`, `flow.ts`, `activation.ts`,
`workflows-pane.tsx`, `i18n-workflows.ts`, `orquestrador/types/index.d.ts` e os testes. Não mexe nos arquivos da fase 2.

- [ ] 1.1 `FlowState.coordinatorSession?: string` em `types/index.d.ts`. O `flow start` grava o id da sessão que chamou
      (`get_session self`) e o `flow report` preenche o campo quando ele falta. Verificação: teste em
      `flow-harness.test.ts` mostra o campo gravado no start e preenchido no report de um flow antigo — cx: simple
- [ ] 1.2 Registro da opção em `activation.ts` (ou num `autowake.ts` vizinho, se ficar mais limpo):
      `readAutowake($)` e `writeAutowake($, on)` em `~/.claude/orquestrador/autowake.json`, por `projectRoot`, no
      padrão de `recordLevel`/`recordedLevel`. Arquivo ausente ou ilegível vale como desligado. Verificação: testes em
      `activation.test.ts` para ausente, ligado, desligado e JSON quebrado (desligado) — cx: simple
- [ ] 1.3 `hooks/wake.ts`, puro: `eligibleChildren(run, self, children)` (não arquivada, `startedBy` da coordenação ou
      fase do plano via `phaseViews`, não é a própria coordenação), `childStops(seen, rows, now)` (primeira vista só
      grava a linha; parada = `isRunning` era `true` ou `lastActivityAt` mudou, e agora `false`; `told` evita repetir) e
      `stopPrompt(titles)` com os dois textos do `design.md`. Verificação: `wake.test.ts` cobre primeira vista,
      running→parada, turno curto por `lastActivityAt`, a mesma parada duas vezes, arquivada, fora do plano e os
      textos de uma e de várias sessões — cx: medium
- [ ] 1.4 `register.tsx`: no `refresh`, depois de `loadSessions`, com o clone ativo, a opção ligada, o flow
      `running` e `self.sessionId === state.coordinatorSession`, roda `childStops` com `seen` do `$.state`
      (`autowake-seen`). Se a coordenação está trabalhando (`self.isRunning`), junta os títulos em `autowake-pending`;
      parada, manda um `$.prompt.submit({ text: stopPrompt(...) })` só, sem `asUser`, e limpa o pendente. Opção
      desligada não lê nem grava `seen`. Falha aqui vai para `$.ui.log`, nunca derruba o refresh. Verificação: tarefa
      1.6 — cx: medium
- [ ] 1.5 Painel ⚙️ (`workflows-pane.tsx`), cartão "Este projeto", só com o clone ativo: linha "Seguir o flow sem
      clique" com o estado e um botão "Ligar"/"Desligar", e o texto de ajuda, por exemplo: "Ligada, o painel avisa a
      coordenação cada vez que uma sessão do flow termina. Assim ela abre as próximas sessões em seu nome, sem cartão
      para clicar. Fica só nesta máquina." Textos em pt-BR e en em `i18n-workflows.ts`. Verificação: teste em
      `project-pane.test.ts` (ou `activation-pane.test.ts`) mostra a opção desligada por padrão, escondida sem
      ativação, e que o botão grava `autowake.json` — cx: simple
- [ ] 1.6 Testes de harness num arquivo novo, `orquestrador/tests/autowake-harness.test.ts`, no molde de
      `flow-harness.test.ts` (mundo em memória, `prompts` capturados), avançando o relógio entre dois refreshes e
      trocando a resposta de `list_sessions`:
      - filha termina com a opção ligada → um aviso com o título;
      - opção desligada → nenhum;
      - a mesma parada vista duas vezes → um aviso só;
      - sessão fora do plano → nenhum; sessão arquivada → nenhum;
      - o mod numa filha da mesma pasta (`self` ≠ `coordinatorSession`) → nenhum;
      - coordenação trabalhando → nenhum; no refresh seguinte, parada → um aviso com as duas filhas que pararam.

      Verificação: `claude plugin test orquestrador` sai com 0 — cx: medium
- [ ] 1.7 Evidência no app real (`changes/acorda-coordenacao/evidence.md`): com a opção ligada, uma filha termina, o
      aviso chega à coordenação e ela abre a sessão seguinte com `user_asked` sem cartão. Registrar também o que o
      `$.prompt.submit` faz com a sessão ocupada, se der para ver. Se o app recusar o `user_asked` depois do aviso, trocar a
      mensagem para `asUser: true` com o texto do `design.md` e repetir. Verificação: o trecho na evidência com o que
      foi visto — cx: simple

## 2. Skill, README e versão

Pode correr em paralelo com a fase 1, porque mexe só em `orquestrador/skills/change-orchestrator/SKILL.md`,
`README.md` e `orquestrador/.claude-plugin/plugin.json`. Portões: `claude plugin test orquestrador` e `tsc`.

- [ ] 2.1 Skill: no bloco do start recusado e da corrente do `user_asked` (§ "Start recusado", perto da linha 73) e no
      § 5.2 "Puxar", um parágrafo "Com 'Seguir o flow sem clique' ligada": a mensagem `Painel: a sessão "…" terminou o
      turno. Siga o flow.` é turno do dono, então nele vale o `user_asked`; a coordenação confere `flow status` e abre o
      próximo passo ou fase; pode terminar o turno com `ScheduleWakeup` para esperar CI, sabendo que o tick não abre
      sessão (propõe cartão, como hoje) e que o próximo aviso do painel refaz a corrente; o aviso pode vir junto com o
      `<side-sessions-event>`, e o segundo termina sem trabalho. Com a opção desligada, o texto atual fica como está.
      Verificação: `grep -n "Seguir o flow sem clique" orquestrador/skills/change-orchestrator/SKILL.md` acha o
      parágrafo — cx: simple
- [ ] 2.2 README: uma linha na lista de recursos sobre a opção "Seguir o flow sem clique" do cartão "Este projeto"
      (desligada por padrão, só nesta máquina, abre as sessões em nome do dono). Verificação: `grep -n "Seguir o flow sem
      clique" README.md` — cx: simple
- [ ] 2.3 Versão 0.13.0 em `orquestrador/.claude-plugin/plugin.json`. Verificação: `claude plugin test orquestrador`
      e `tsc` saem com 0 — cx: simple
