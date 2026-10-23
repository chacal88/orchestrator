# Evidência — freio do aviso e fila de gravação

Fase 1 (tarefas 1.1 a 1.8), na branch `claude/keen-einstein-89e489`, a partir do plano (f89eefb). Binário do app
2.1.308 (o `claude` do shell é um alias antigo).

## Testes

Gate testes: `claude plugin test orquestrador` na raiz do repo.

```
$ export PATH="…/claude-code/2.1.308/a93ded4b1b47/claude.app/Contents/MacOS:$PATH" && command claude plugin test orquestrador
(pass) 4 phases that end one by one in the executar loop, with the seq standing still, are 4 stops told and no toast
(pass) 4 phases that end one by one, with the plan republished between them and the seq standing still, are 4 stops told
(pass) 4 different children that end while nothing moves in the flow are still 4 stops told: the brake counts per child
(pass) a coordination that opens a new child on each stop while the flow stands still is told 10 times, then not at all, with one toast
(pass) after the cap, a report that moves the flow makes the next stop be told again
(pass) a flow report written while the grouping waits on the sidebar is kept
(pass) two start_session at once create the group once
(pass) a new flow of a change takes nothing from the flow of the same change that ended
(pass) a session adopted while the report waits between its reread and its write is kept, and so is the report
(pass) two refusals logged at once both stay in the flow log
(pass) a flow write that fails goes back to its caller and does not stop the next write
(pass) the flow moves for the brake when its seq, its closed phases or its plan phases done move, not when a session is adopted or the plan is only republished
 412 pass
 0 fail
Ran 412 tests across 33 files. [9.15s]
exit=0
```

Antes da change: 407 pass em 33 arquivos. Entraram 5 testes (2 do teto, 3 da fila); o de `flowProgress` em
`wake.test.ts` mudou de nome e de expectativa (1.1). O tempo continua na casa dos segundos (7,9 s a 9,2 s nas rodadas
desta fase), nenhum teste pendurado.

## Tipos

Gate tipos: `tsc` sobre hooks, types e tests com os tipos do engine.

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json   # tipos do engine 2.1.308 (plugin-authoring), hooks + types + tests
exit=0
```

A primeira rodada pegou um erro no teste: `flowProgress({ ...flow, sessions: [...] }, run)` é um objeto literal com uma
propriedade que o tipo não tem mais. O teste passou a montar o flow numa variável (`adopted`), porque o ponto dele é
que um flow com sessões a mais dá a mesma chave. Depois disso, saída 0.

## Validação

```
$ export PATH="…/2.1.308/…/MacOS:$PATH" && command claude plugin validate orquestrador
  ❯ ./register.tsx hooks: session.start, command.run{command=orquestrador}, …
⚠ Found 1 plugin directory warning: ICON_MISSING (já existia; não muda o resultado)
✔ Validation passed
exit=0
```

## Tarefas

- 1.1: `flowProgress` (`hooks/wake.ts`) junta só `seq`, fases no `closed` e fases `done` do plano; o comentário diz que
  uma filha nova não é andamento. O parâmetro perdeu `sessions`. `grep -n "sessions" orquestrador/hooks/wake.ts` acha
  o `eligibleChildren` (linhas 9-18) e, no `flowProgress`, só o comentário (linha 28); nada no tipo nem no corpo. Em `wake.test.ts` o caso com `sessions: ['local_a', 'local_b']` espera `toBe(base)` e
  `flowProgress({ seq: 4 }, undefined)` é `'4|0|0'`.
- 1.2: `AUTOWAKE_MAX_SAME_PROGRESS = 10` ao lado de `AUTOWAKE_MAX_SAME_CHILD`. O `autowake-brake` ganhou `sent`
  (opcional no tipo; um valor de antes vale 0). Com `sent` no teto, nenhuma filha é avisada até a `key` mudar. Um aviso
  que sai soma 1 em `sent`, quantas filhas ele nomear. O toast do teto (`Orquestrador: o flow de <change> parece parado:
  10 avisos à coordenação sem o flow andar. Parei de avisar até o flow andar.`) usa o mesmo `warned` do freio por filha:
  um toast só por `key`. `key` nova começa com `told` e `sent` vazios.
- 1.3: `autowake-harness.test.ts`, 2 testes novos (pass): 12 filhas abertas uma a uma, cada uma adotada no `sessions` e
  parada, dão 10 avisos e 1 toast com o texto acima; depois do teto, um `flow report` faz a parada seguinte sair como o
  11º aviso, sem segundo toast. Os 3 testes da 0.13.0 (4 fases com `closed`, 4 fases com o plano republicado, 4 filhas
  diferentes) passam sem mudar.
- 1.4: `flowWrites` (promessa do módulo) e `inFlowQueue(fn)` em `register.tsx`: encadeia `fn`, devolve o resultado ou o
  erro e guarda `turn.catch(() => undefined)`, então a cadeia segue depois de um erro. Passam pela fila: `saveFlow`
  (releitura, junção e gravação), `keepGrouping` (releitura, junção e gravação) e `logFlowRefusal` (leitura e
  regravação do log). O corpo antigo do `writeFlow` virou `writeFlowNow`, sem fila, chamado só de dentro de `saveFlow` e
  `keepGrouping`. `grep -n "inFlowQueue" orquestrador/hooks/register.tsx` acha a definição e as três portas; nenhuma
  função que roda na fila chama `inFlowQueue` de novo. Ver "Escolhas" sobre o `writeFlow` público.
- 1.5: `grupos-harness.test.ts`: o mundo falso ganhou `holdRead(w, path, skip)` (a leitura pega o texto do disco e só
  responde quando o teste solta), `settle()` e `failWrite`. 3 testes novos (pass): o `report` pausado na releitura do
  `saveFlow` (2ª leitura do `b.json`) com um `start_session` correndo no meio; dois `report` recusados ao mesmo tempo;
  uma gravação do `b.json` que lança uma vez, seguida de um `report` que grava.
- 1.6: os testes de agrupamento ("two start_session at once create the group once", "a flow report written while the
  grouping waits on the sidebar is kept", "a new flow of a change takes nothing…", "a session adopted while a flow report
  works is kept by the report") passam sem mudar; a suíte roda em ~9 s, sem teste pendurado.
- 1.7: `plugin.json` em 0.13.1; o item "Seguir o flow sem clique" do `README.md` ganhou "Se o flow não anda depois de
  vários avisos, o painel para de avisar e mostra um aviso ao dono." `claude plugin validate orquestrador` passa.

## A fila fecha a janela

Rodado com a fila desligada (`const turn = fn()` no lugar de `flowWrites.then(fn)` em `inFlowQueue`), mesmos testes:

```
(fail) a session adopted while the report waits between its reread and its write is kept, and so is the report
       → o flow final tem o registro do planejar, mas `sessions: []`: a adoção do local_b1 foi apagada
(fail) two refusals logged at once both stay in the flow log
       Expected: ["executar", "validar"]
       Received: ["validar"]
 410 pass
 2 fail
exit=1
```

Rodado com a cadeia morrendo depois de um erro (`flowWrites = turn` no lugar de `turn.catch(() => undefined)`):

```
(fail) a flow write that fails goes back to its caller and does not stop the next write
 411 pass
 1 fail
exit=1
```

Com o código desta fase, os três passam (seção Testes). O `register.tsx` foi restaurado da cópia depois de cada prova
(`grep` dos marcadores dá 0).

## Escolhas

- **O teto conta avisos, não filhas.** `sent` sobe 1 por `$.prompt.submit`, mesmo que o aviso junte várias filhas
  (coordenação ocupada). Assim uma onda grande de fases paralelas não estoura o teto à toa. O toast do teto sai na
  primeira parada segurada depois do 10º aviso, que é quando "parei de avisar" passa a ser verdade.
- **Um toast por chave.** O teto e o freio por filha dividem o `warned`. Se o freio por filha já avisou o dono nessa
  chave, o teto não avisa de novo.
- **Sem `writeFlow` público.** Hoje só `saveFlow` e `keepGrouping` gravavam o estado; os dois já rodam na fila e chamam
  `writeFlowNow`. Um `writeFlow` público que enfileira ficaria sem ninguém para chamá-lo, então não ficou. Quem precisar
  gravar o flow de fora da fila chama `saveFlow`.
- **O `logFlowRefusal` lê o relógio antes de entrar na fila.** Só a leitura e a regravação do log ficam na mesma vez
  da fila; o evento já está montado quando a vez chega.

# Fase 2 — tipos do teste e as duas gravações restantes do log

Tarefas 2.1 a 2.3, na branch `claude/nostalgic-curran-5304fc`, a partir de ec318ca.

- 2.1: `settle` em `tests/grupos-harness.test.ts` usa o `setTimeout` pela `globalThis` com cast, no molde de
  `tests/activation.test.ts:316`; o `tsc` não acha mais o nome.
- 2.2: o evento `jira-moved` (`register.tsx` ~579) e a gravação do log no `savePrep` (~1837) leem e regravam o
  `.ndjson` dentro de `inFlowQueue`; o evento é montado (relógio) antes de entrar na fila. Nenhum dos dois roda dentro
  da fila, então não há reentrada. `grep -n "inFlowQueue" orquestrador/hooks/register.tsx` acha agora seis linhas:
  579, 858, 1356, 1376, 1837 e a definição (1344).

## Testes

```
$ export PATH="…/2.1.308/…/MacOS:$PATH" && command claude plugin test orquestrador
 412 pass
 0 fail
Ran 412 tests across 33 files. [7.74s]
exit=0
```

## Tipos

```
$ npx -y -p typescript@5.6.3 tsc -p <scratchpad>/tc/tsconfig.json
(sem saída)
exit=0
```
