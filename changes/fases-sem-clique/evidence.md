# Evidência — fases sem clique (0.14.0)

Esqueleto do passo `planejar` (só `changes/fases-sem-clique/` mudou; nenhum código de produção). Cada fase preenche a sua seção com a saída real dos portões. Nenhuma tarefa é marcada
no `tasks.md` sem a evidência aqui.

## Plano

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin validate orquestrador
  ❯ ./register.tsx hooks: session.start, command.run{command=orquestrador}, …, tool.call, tool.check, prompt.submit, …
⚠ Found 1 plugin directory warning: ICON_MISSING (já existia; não muda o resultado)
✔ Validation passed
exit=0
```

## Fase 1 — um `get_session` por vez, e só com permissão

### Testes

Gate testes: `claude plugin test orquestrador` na raiz do repo (binário do app 2.1.309).

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orquestrador
tests/permissao-harness.test.ts:
(pass) with a get_session pending, publishing, waiting and three turns of the clock make at most one get_session
(pass) with "ask" on the session tools the clock makes no call to them, and the panel and the band say what to allow
(pass) the mod's own check marks no wait; a model tool with "ask" still does
(pass) once the owner allows, the next turn calls and the notice goes away
(pass) a phase session is refused with the reason "allow the session tools" while they are on "ask"
 417 pass
 0 fail
Ran 417 tests across 34 files.
exit=0
```

Antes: 412 testes em 33 arquivos. Entram 5 (arquivo novo). `harness`, `grupos-harness`, `autowake-harness`,
`lifecycle-harness`, `merge-scope-harness`, `pane` e `activation` ganharam uma linha no mundo falso,
`on('tool.check', … allow)`: sem ela o `$.tool.check` do `mayList` volta "ask" (o padrão do engine para uma
ferramenta MCP sem regra) e as chamadas de sessão deixam de sair. Nenhuma expectativa deles mudou.

### Tipos

Gate tipos: `tsc` sobre hooks, types e tests com os tipos do engine.

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.309 (plugin-authoring), hooks + types + tests
exit=0
```

### Notas

- 1.6: o primeiro caso (um `get_session` pendente) rodado com o `register.tsx` do commit anterior, sem as tarefas 1.1
  a 1.4, falha: `expect(count).toBeLessThanOrEqual(1)` recebe 3 (um por volta do relógio e por publicação, enquanto o
  primeiro ainda pende). Com as tarefas, passa.
- Verificações das tarefas: `grep -n selfAsk` acha a definição e o uso só em `selfId`; `GET_SESSION` aparece na
  constante, no `canCall` e na chamada de `selfRowNow` (única); toda chamada a `LIST_SESSIONS` passa por `listCall`
  (que consulta `mayList`), fora o `canCall`; nenhuma linha nova escreve em `settings*.json`.
- Decisões que a revisão do plano pediu:
  - `cleanupChange` (passo automático de lançar a versão) **passa** pelo `mayList`. Sem `get_session` o `self` fica
    indefinido e `phaseSessions` poderia contar a própria coordenação como fase para arquivar; por isso, sem `self`
    ou sem a lista, o passo registra "sessions not read" e deixa as sessões e o grupo como estão.
  - `selfId` e `selfRowNow` **passam** pelo `mayList`: são o primeiro elo do loop (`publishActivity` → `selfId`).
    `selfId` pede uma vez por vez (`selfAsk`), e `selfRowNow` junta as chamadas simultâneas e não guarda a linha.
  - O `mayList` vale para chamadas em segundo plano (refresh, `publishActivity`, `restoreActivity`, agrupamento,
    aviso, `refuseStart`, `folderIsOwn`, `loadFamily`, `openChildren`). Uma ação do dono (botão) pode chamar direto
    com "ask"; esse caminho é da fase 2 (o `openPending` passa a chamar sem recusar por falta de permissão).
  - Sem permissão, `refuseStart` recusa dizendo que falta permitir `get_session` e `list_sessions`.
  - O hook `tool.check` do mod sai cedo quando `next.origin.plugin === 'orquestrador'`.

## Fase 2 — abrir as fases sem um clique por card

### Testes

Gate testes: `claude plugin test orquestrador` na raiz do repo (binário do app 2.1.309).

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orquestrador
tests/autowake-harness.test.ts:
(pass) a child opened with wake_when_done wakes nothing from the mod (the app wakes for it); one opened without it still does
tests/flow.test.ts:
(pass) the engine > a session step tells the coordination to open a session for it, never to do it there
(pass) the engine > the loop step says one session per phase
(pass) flow pending > registers the sessions on the loop, logs the keys without the prompt, and shows them in the view
(pass) flow pending > a repeated key replaces the entry before it
(pass) flow pending > a session step takes it too; an automatic or owner step, or a flow not running, refuses it
(pass) flow pending > refuses past the limits: 6 entries, a title of 120 and a prompt of 20 000 characters
(pass) flow pending > a phase closed drops its entry; the others stay
(pass) flow pending > leaving the step drops every entry of it
(pass) flow pending > dropPending takes the matching entries out, and the field goes once the list is empty
tests/pendentes-harness.test.ts:
(pass) the panel shows one button for the pending sessions; one press opens all three as the owner asked, and they leave the list
(pass) with two live phase sessions only one opens; the rest stays and the toast says why
(pass) the app refusing the start leaves the list as it was and says to type it on the desktop (or that the phone cannot)
(pass) with the session tools on "ask" the press is refused with the permission notice; once allowed, it opens
(pass) a start the model makes with the same title takes the entry out, and a later `flow pending` does not bring it back
(pass) outside a session step or the loop, or from another session than the coordination, nothing is kept
(pass) only the pending press hands a start the owner's words: an owner step press and the wake never do
tests/wake.test.ts:
(pass) untracked leaves out the children the app follows (opened with wake_when_done), in order
(pass) the stop is still the mod telling a fact, never the owner speaking
 434 pass
 0 fail
Ran 434 tests across 35 files. [11.27s]
exit=0
```

Antes: 417 testes em 34 arquivos. Entram 17 (7 no arquivo novo `pendentes-harness`, 7 em `flow.test.ts`, 2 em
`wake.test.ts`, 1 em `autowake-harness`). O caso de `flow.test.ts` sobre o passo de sessão mudou de expectativa: o
texto não manda mais propor card (`own_initiative`), manda registrar com `pending` e falar do botão. Os testes do
freio em `autowake-harness` não mudaram; o mundo falso dele só ganhou uma resposta para `start_session`.

### Tipos

Gate tipos: `tsc` sobre hooks, types e tests com os tipos do engine.

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.309 (plugin-authoring), hooks + types + tests
exit=0
```

### Verificações das tarefas

```
$ grep -n "consent" orquestrador/hooks/*.ts orquestrador/hooks/*.tsx
orquestrador/hooks/register.tsx:1776:      consent: words,          # dentro de openPending (1749-1802)
$ grep -n "STOP_AS_USER = false" orquestrador/hooks/wake.ts
94:export const STOP_AS_USER = false
$ grep -n "own_initiative" orquestrador/hooks/flow.ts
(nada; exit 1)
```

O runtime dos testes não lê arquivos do repo (um `import('node:fs')` num teste é recusado ao carregar: "a dynamic
import()"), então o grep do `consent` fica aqui como verificação. O harness confere o mesmo pelo comportamento: no
clique, só os três `start_session` levam `consent`; num clique de passo do dono (`pressFlow`) com a opção ligada,
nenhuma chamada leva.

### Notas

- **A chamada do mod não passa pelo `tool.call` do próprio mod.** O design supunha que o `start_session` do
  `openPending` passaria pelo hook (e com ele `refuseStart`, agrupamento e `tracked`). No harness, um start disparado
  pelo clique chegou ao app sem nenhum `get_session`/`list_sessions` antes: com duas sessões vivas, as três abriram;
  com "ask", as três abriram. Por isso o `openPending` aplica ele mesmo o `refuseStart` (rígido em "barrar", aviso em
  "lembrar") e o `groupQuietly` com a filha em `tracked`. Está no `design.md` (§ 2, "O botão e o `consent`").
- **Fila não reentrante.** O `openPending` lê o flow dentro do `inFlowQueue` e sai da fila antes das aberturas; o
  agrupamento de cada abertura entra na fila por conta própria (`keepGrouping`), e as que abriram saem da lista numa
  volta nova, relendo o disco. O caso "one press opens all three" prova que o clique não trava: as três abrem, ficam em
  `sessions` e `tracked`, e a lista esvazia.
- **Permissão em "ask".** O `refuseStart` do `openPending` conta as sessões pelo `mayList`; com "ask" recusa com o
  motivo da fase 1, nenhuma sessão chega ao app e o painel mostra o aviso. Com "allow", o mesmo clique abre.
- **`tracked`.** Gravado pelo `keepGrouping` (a mesma escrita do agrupamento), também quando a sidebar não está
  disponível. O `saveFlow` soma o `tracked` do disco, e só mantém uma entrada pendente que o disco também tem.
- O `wakeOnce` tira de `pending` as filhas em `tracked` antes do freio; elas continuam no `seen`.
- A conferência "B" do design (descartar ao abrir uma entrada cuja fase já tem sessão viva) não entrou; está escrito
  no `design.md`.
- `/orquestrador abrir` é da fase 3. Os textos de recusa do app já citam o comando, porque saem na mesma versão.

### No app

Uma linha por risco do `design.md` (§ 2, "Riscos a conferir no app"): o que foi feito, o que o app respondeu, e a
consequência. **Pendente para o passo de QA**: o mod que o app carrega é o do checkout principal, não o desta
branch, e as quatro conferências precisam do dono clicando no painel (desktop e celular). Nenhuma foi feita nesta
sessão; a 2.6 fica desmarcada.

1. `consent` no desktop: pendente (QA). Fazer: com uma fase pendente, clicar "Abrir as N sessões pendentes" no
   desktop e ver se o app abre com `user_asked` ou devolve erro. Se recusar, o toast diz "O app não aceitou abrir pelo
   painel; digite /orquestrador abrir no desktop", e a lista fica.
2. `consent` pelo Remote Control: pendente (QA). Fazer: o mesmo clique no painel do celular. Se recusar, o toast diz
   "Pelo celular o app não abre sessões; digite /orquestrador abrir no desktop", e isso vira limitação no README.
3. `wake_when_done` de uma filha aberta pelo mod: pendente (QA). Fazer: deixar a filha aberta pelo clique terminar o
   turno e ver se a coordenação acorda sem aviso do mod. Se não acordar, o plano B (não gravar em `tracked`) é outra
   mudança de código, depois desta conferência.
4. A corrente depois do clique: pendente (QA). Fazer: ver se o `<side-sessions-event>` da filha deixa a coordenação
   abrir a onda seguinte com `user_asked`; se não, a próxima onda volta para `pending` (um clique por onda).

## Fase 3 — `/orquestrador` com subcomandos

### Testes

Gate testes: `claude plugin test orquestrador` na raiz do repo (app 2.1.309), rodado sozinho, saída 0.

```
$ export PATH="…/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS:$PATH" && command claude plugin test orquestrador
exit=0
tests/comando-harness.test.ts:
(pass) aprovar from the composer leaves the flow, the log and the wake as a click on the same button does
(pass) aprovar with a note records it like the "Pedir ajuste" press, and an outcome the step does not declare is refused
(pass) only composer and bridge are the owner: plugin, peer and the rest are refused and the flow does not change
(pass) through the bridge it works, and the answer is plain text: no table, no heading, no bold
(pass) status does not list sessions beyond what the permission lets, and says so
(pass) the release step is refused with the plan-mode notice, and liberar is only the help
(pass) abrir opens the pending sessions as the owner typed it, and the phone is told when the app refuses
(pass) abrir through the bridge, with the app refusing, says the phone cannot open sessions
(pass) pular-portão asks for confirmar; with it, it records the skip the panel records
(pass) with no argument the command opens and closes the pane as before, for any origin
(pass) encerrar without confirmar changes nothing; with it, the flow is aborted like the second press of the button, and nothing is sent
(pass) encerrar with a reason keeps it on the event; a plugin origin is refused and the flow runs on
(pass) an escalated flow ends by the command and by the button; a flow already ended answers the reason
(pass) no tool of the model ends the flow, and endFlow is reached only by the button, the command and the escalation
tests/command.test.ts:
(pass) parseCommand > no argument toggles the panel, whatever the spaces
(pass) parseCommand > status, ajuda and abrir
(pass) parseCommand > aprovar takes the outcome and keeps the rest of the line as the note
(pass) parseCommand > pular-portão, with or without the accent, asks for the phase and the gate; confirmar is the last word
(pass) parseCommand > encerrar takes an optional reason; confirmar at the end confirms
(pass) parseCommand > there is no liberar: it is an unknown word, like any other
(pass) fromOwner > composer is the owner typing
(pass) fromOwner > bridge is the owner typing
(pass) fromOwner > sdk is not
(pass) fromOwner > task-notification is not
(pass) fromOwner > scheduled-trigger is not
(pass) fromOwner > peer is not
(pass) fromOwner > peer-send-message is not
(pass) fromOwner > projects-relay is not
(pass) fromOwner > channel is not
(pass) fromOwner > coordinator is not
(pass) fromOwner > observer is not
(pass) fromOwner > observer-activity is not
(pass) fromOwner > auto-continuation is not
(pass) fromOwner > unclassified is not
(pass) fromOwner > slack-ping is not
(pass) fromOwner > plugin is not
(pass) statusText > short plain lines: no table, no heading, no bold
(pass) statusText > without a flow it says to use the coordination session
tests/flow.test.ts:
(pass) endFlow > a running flow becomes aborted, with the owner and the note on the event, and its pending starts go
(pass) endFlow > an escalated flow ends too, on the step that escalated
(pass) endFlow > a flow already done or aborted is refused with the reason
(pass) endFlow > the escalation answered with encerrar is the same state and event as endFlow
…
 476 pass
 0 fail
Ran 476 tests across 37 files. [9.81s]
```

Antes da fase: 434 testes em 35 arquivos (a fase 2 deixou 434). Entraram 42: `command.test.ts` (parse de cada forma, `statusText` e
`fromOwner` para as 16 origens do `PromptOrigin`, incluindo `plugin`), 4 de `endFlow` no `flow.test.ts` e 14 em
`comando-harness.test.ts`. Os testes de painel e de flow existentes passam sem mudar (3.2).

Fatos do código que o harness fixou:

- `prompt.submit` chamado de dentro de um `command.run` é recusado pelo engine ("it would wait on the turn this hook is
  holding"). O `aprovar` digitado por isso manda o `wakePrompt` por `$.clock.after(50, …)`; o clique segue esperando o
  envio, como antes. O teste C9 compara os prompts do clique e do comando e eles saem iguais.
- `grep -n "endFlow" orquestrador/hooks/register.tsx` acha o import, o `endByOwner` (único chamador: o clique do botão e
  `/orquestrador encerrar confirmar` passam por ele) e a prop `endFlow` do painel; a escalada usa o `endFlow` de
  `flow.ts` (`resolveEscalation`). O `FLOW_SCHEMA` não mudou, e o teste "no tool of the model ends the flow" confere.
- `grep -n "consent"` segue achando só o `openPending` (1780).

### Tipos

Gate tipos: `tsc` sobre hooks, types e tests com os tipos do engine 2.1.309.

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json
exit=0
```

## Fase 4 — skill, README e versão

### Testes

Gate testes: `claude plugin test orquestrador` (app 2.1.309), rodado sozinho.

```
exit=0
 476 pass
 0 fail
Ran 476 tests across 37 files.
```

### Tipos

Esta fase não mudou código de `hooks/` (só SKILL.md, README.md e plugin.json); os tipos da fase 3 seguem valendo.

### Validação

```
$ command claude plugin validate orquestrador
exit=0
✔ Validation passed
```

Verificações das tarefas: `grep -n "flow pending\|/orquestrador abrir" orquestrador/skills/change-orchestrator/SKILL.md` acha as §§ 2 e 5; `grep -n "/orquestrador aprovar\|sessões pendentes\|get_session" README.md` acha as linhas 31 a 34; `"version": "0.14.0"` em `plugin.json`.

## Critérios de aceite

| Critério (`proposal.md`) | Evidência |
| --- | --- |
| 1. Um botão / `/orquestrador abrir` abre todas as pendentes | Fase 2: `openPending`, botão e `abrir`; README e skill (fase 4) |
| 2. Sem aviso do mod para filha com `wake_when_done` | Fase 2 (`tracked` no `wakeOnce`); skill § 2 e § 5; README |
| 3. Subcomandos; `aprovar` igual ao clique; recusa com `origin` de plugin | Fase 3: testes de `comando-harness.test.ts` (aprovar, origens, plugin recusado) |
| 4. Sem `liberar`; `aprovar` na liberação recusado | Fase 3: teste do `liberar` desconhecido e da liberação recusada |
| 5. Sem gravar permissão; aviso no painel e na faixa | Fase 1: `PERMISSION_NEEDED`; README, 'Aviso de permissão' |
| 6. Texto simples e Remote Control | Fase 3: testes de texto simples e da ponte (Remote Control) |
| 7. No máximo 1 `get_session` pendente; nenhum do refresh | Fase 1: um `get_session` por vez, sem o refresh |
| 8. Checagem do mod não marca espera | Fase 2: `tracked` no `wakeOnce`; testes de checagem do mod |
| 9. Versão 0.14.0, README, skill e portões | Fase 4: Validação acima (476 pass, validate exit 0), plugin.json 0.14.0, README e skill. A conferência no app fica em 'Conferência no QA' do tasks.md |
| 10. Encerrar o flow a qualquer momento, só pelo dono | Fase 3: testes de `endFlow` e `encerrar`; README |
