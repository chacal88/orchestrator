## 1. Freio do aviso, fila de gravação e versão

Uma fase só, numa sessão. Os dois pontos mexem em `orquestrador/hooks/register.tsx`, em trechos diferentes (o freio no
`wakeOnce`, ~linhas 700-760; a gravação no `keepGrouping`, ~841-851, e no `saveFlow`/`writeFlow`/`logFlowRefusal`,
~1325-1350). Duas fases teriam de ser serializadas de qualquer jeito (mesmo arquivo, sem paralelo), e cada uma pagaria
uma sessão e uma rodada de portões para poucas tarefas. Numa fase só, o executor faz o ponto 1 (tarefas 1.1 a 1.3), roda
os testes, e depois o ponto 2 (1.4 a 1.6), sem conflito entre trechos. A versão (1.7) vem por último.

Portões: `testes` (`claude plugin test orquestrador`, saída 0) e `tipos` (`tsc` sobre hooks, types e tests com os
tipos do engine, como no `evidence.md` das changes anteriores, saída 0). Arquivos: `orquestrador/hooks/wake.ts`,
`orquestrador/hooks/register.tsx`, `orquestrador/tests/wake.test.ts`, `orquestrador/tests/autowake-harness.test.ts`,
`orquestrador/tests/grupos-harness.test.ts` (ou `flow-harness.test.ts`), `orquestrador/.claude-plugin/plugin.json`,
`README.md` e `changes/freio-aviso/evidence.md`.

- [x] 1.1 `flowProgress` (`hooks/wake.ts`) sem as sessões adotadas: a chave junta só `seq`, fases fechadas e fases
      `done` do plano; o comentário diz por quê (uma filha nova não é andamento). Em `wake.test.ts`, o caso
      `sessions: ['local_a', 'local_b']` passa a esperar a mesma chave (`toBe(base)`) e `flowProgress({ seq: 4 },
      undefined)` passa a ser `'4|0|0'`. Verificação: `grep -n "sessions" orquestrador/hooks/wake.ts` não acha
      `sessions` dentro de `flowProgress`, e `wake.test.ts` passa — cx: simple
- [x] 1.2 Teto geral no `wakeOnce` (`register.tsx`): constante `AUTOWAKE_MAX_SAME_PROGRESS = 10` ao lado de
      `AUTOWAKE_MAX_SAME_CHILD`; o `AUTOWAKE_BRAKE` ganha a contagem de avisos mandados com a mesma `key` (por exemplo
      `sent`). Com `sent` no teto, nenhum aviso sai (nem de filha nova) até a `key` mudar; o toast "parece parado" com
      o teto sai uma vez por `key` (reaproveitar o `warned`, sem toast em dobro com o freio por filha). Um aviso que
      junta várias filhas conta 1. `key` nova zera `told` e `sent`. Verificação: tarefa 1.3 — cx: moderate
- [x] 1.3 Testes de harness em `autowake-harness.test.ts`:
      - laço: a cada parada a coordenação "abre" uma filha nova (linha nova em `list_sessions`, adotada no
        `sessions` do flow), sem `report` nem `close`; 12 filhas que param uma a uma dão 10 avisos e 1 toast com
        "parece parado";
      - depois do teto, um `report` que anda o flow faz a próxima parada sair como aviso;
      - os testes da 0.13.0 de 4 fases (fechadas, plano republicado) e de 4 filhas diferentes continuam com 4
        avisos e nenhum toast, sem mudar.
      Verificação: `claude plugin test orquestrador` sai com 0 e os nomes dos testes novos aparecem como `(pass)` —
      cx: moderate
- [x] 1.4 Fila única (`register.tsx`): uma promessa do módulo (no molde do `grouping`, por exemplo `flowWrites`) e
      uma função `inFlowQueue(fn)` que encadeia `fn`, devolve o resultado ou o erro a quem chamou e mantém a cadeia viva
      depois de um erro. Passam por ela: a releitura + junção + gravação do `saveFlow`, a releitura + junção +
      gravação do `keepGrouping`, e a leitura + regravação do log no `writeFlow` e no `logFlowRefusal`. Organizar para
      não haver reentrada (por exemplo, um `writeFlowNow` sem fila, chamado só de dentro da fila; o `writeFlow` público
      enfileira). Verificação: `grep -n "inFlowQueue" orquestrador/hooks/register.tsx` acha as quatro portas, e
      nenhuma chamada de `inFlowQueue` dentro de uma função que já roda na fila — cx: moderate
- [x] 1.5 Testes de harness (em `grupos-harness.test.ts`, no molde de "a session adopted while a flow report
      works…"): o mundo falso ganha um jeito de pausar uma leitura do arquivo do flow (por exemplo `w.holdRead(path)`
      devolvendo uma promessa que o teste solta). Casos:
      - o `report` pausado na releitura do `saveFlow`; um `start_session` corre ao mesmo tempo e adota `local_b1`;
        solto o `report`, o flow tem `sessions: ['local_b1']`, o `groupId` e o registro do `planejar`;
      - dois `logFlowRefusal` (por exemplo dois `report` recusados) ao mesmo tempo deixam os dois eventos no `.ndjson`;
      - uma gravação que falha (fs que lança uma vez) não impede a gravação seguinte.
      Conferir que o primeiro caso falha sem a fila (rodar uma vez com a fila desligada e anotar no `evidence.md`).
      Verificação: `claude plugin test orquestrador` sai com 0 — cx: moderate
- [x] 1.6 Sem regressão no agrupamento: os testes existentes de `grupos-harness.test.ts` ("two start_session at once
      create the group once", "a flow report written while the grouping waits on the sidebar is kept", "a new flow of
      a change takes nothing…") passam sem mudar, e nenhum teste do repo fica pendurado (a fila não trava com o
      `grouping`). Verificação: `claude plugin test orquestrador` sai com 0 no tempo de antes (ordem de segundos) —
      cx: simple
- [x] 1.7 Versão 0.13.1 em `orquestrador/.claude-plugin/plugin.json`; no `README.md`, o item "Seguir o flow sem
      clique" ganha uma frase: se o flow não anda depois de vários avisos, o painel para de avisar e mostra um aviso
      ao dono. Verificação: `grep -n '"version": "0.13.1"' orquestrador/.claude-plugin/plugin.json` e
      `grep -n "para de avisar" README.md` acham a linha; `claude plugin validate orquestrador` passa — cx: simple
- [x] 1.8 Evidência: `changes/freio-aviso/evidence.md` com a saída dos portões (`testes`, `tipos`, `validate`), os
      testes novos como `(pass)` e a nota da 1.5 (o caso falha sem a fila). Verificação: as seções do `evidence.md`
      preenchidas, sem "a preencher" — cx: simple
