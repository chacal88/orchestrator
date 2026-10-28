# Orquestração — fases-sem-clique (0.14.0)

Flow `completo` do projeto (`.orquestrador/flows/completo.json`). Coordenação: esta sessão (grupo da change na sidebar).

| Fase | Ícone | Sessão | Branch | Estado | Próximo passo |
| ---- | ----- | ------ | ------ | ------ | ------------- |
| 1. Um `get_session` por vez, e só com permissão | 🛠️ | local_5a30d4d8 | claude/fases-sem-clique-f1-8909d3 (552c6b2, trazida por fast-forward) | fechada | — |
| 2. Abrir as fases sem um clique por card | 🛠️ | local_bf72e235 | fases-sem-clique-f2 | fechada | — |
| 3. `/orquestrador` com subcomandos e encerrar | 🛠️ | local_b121c921 | claude/fases-sem-clique-f3-fa36fa (07f627e) | fechada | — |
| 4. Skill, README e versão | 📖 | local_c1dcb439 | claude/fases-sem-clique-f4-4dca8a (55465cc) | fechada | — |

As quatro fases são em série: mexem em `register.tsx`, `i18n.ts`, `pane.tsx` e `flow.ts`. Cada fase trabalha
na branch da anterior.

## Histórico

- 2026-10-28: o primeiro flow (`completo` padrão) escalou no `validar`, porque o repo não tem `openspec/`. O dono
  encerrou esse flow, e a change recomeçou no `completo` do projeto.
- `planejar` pronto; `validar` passou (`claude plugin validate`, binário do app 2.1.309; o `claude` do nvm, 2.1.227,
  não entende mods); `revisao-plano` aprovado.

## Achados da revisão do plano (para as fases)

Importantes:
1. **Fila não reentrante no `openPending`** (`design.md:113-120`, `tasks.md:95-97`; fase 2). O `$.tool.call(START_SESSION)`
   passa pelo hook `tool.call` → `groupQuietly` → `keepGrouping` → `inFlowQueue`. Por isso, o flow é lido dentro da
   fila e a fila é liberada. As sessões abrem fora dela, e as que abriram saem da lista numa volta nova da fila, com
   o disco relido.
2. **Botão com permissão em "ask"** (`design.md:45-46` contra `59-63`, `tasks.md:47-49`; fases 1 e 2). O
   `start_session` do `openPending` passa por `refuseStart` → `loadSessions` → `mayList` sem saber que veio do dono:
   com "ask", ele recusa e mostra o aviso de permissão. É preciso escrever isso no design. O harness 2.5 ganha um
   caso com "ask" (recusa com aviso) e um com "allow" (abre).
3. **`/orquestrador status` sem teste** (C3, `proposal.md:106`; fase 3). Entra o `statusText` na tarefa 3.1 e um caso
   de `status` no harness 3.6, com o texto sem tabela para `bridge` (C6).

Nits:
- `tasks.md:47-49`: o `cleanupChange` entra no `mayList` ou fica escrito por que não entra. Também fica dito se
  `selfId`/`selfRowNow` passam pelo `mayList`.
- `design.md:142-143`: o plano B do risco 3 só acontece depois da 2.6, com outra mudança. Deixar isso escrito.
- `design.md:219`: a tabela da fase 1 também lista `types/index.d.ts` e `evidence.md`.

## Revisão de código (aprovada, 476/476)

Importantes, não bloqueantes, para o QA ("QA pediu ajustes") ou uma correção logo depois:
1. `/orquestrador aprovar encerrar` num flow escalado encerra sem `confirmar` (`register.tsx:391` → `flow.ts:881`),
   o que contraria o C11. A sugestão é recusar e apontar para `/orquestrador encerrar … confirmar`.
2. Com "ask" e o próprio id ainda não guardado, o `keepPending` (`register.tsx:120`) e o `commandFlow`
   (`register.tsx:327`) tratam a coordenação como se fosse outra sessão. A mensagem deveria ser a de permissão.
3. No nível "lembrar", o "ask" não recusa a abertura (`register.tsx:169-177`): o `openPending` abre sem contar o teto.
   Falta decidir o comportamento e escrever o teste.

Nits:
- O `wakeOnce` compara o `sessionRef` (id limpo) com o `tracked` (id bruto).
- O `status` esconde o aviso de permissão quando ainda não há `VIEW`.

Checagem final: `claude plugin test orquestrador` (476 pass) e `tsc` com os tipos do engine 2.1.309, os dois com
saída 0.
