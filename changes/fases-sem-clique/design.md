# Design: fases sem clique, sem loop de aprovação e com comandos pelo chat

Os tipos citados são os do engine 2.1.309 (`plugin-authoring/types/claude-code.d.ts`): `$.tool.check`, `$.tool.call`,
`ToolCallReserved` (campo `consent`), `CommandRunInput` (campo `origin`), `PromptOrigin` e `Origin` (`next.origin`).

## 1. O loop do `get_session`

### Como o loop acontece

```
publishActivity → selfId → $.tool.call(get_session)        (pendente no diálogo)
        ↑                         │
        │                  tool.check hook: decision 'ask'
        │                         │
        └──── setWaiting ←────────┘
```

O `$.tool.call` passa por todos os hooks do mod, menos o que fez a chamada, e também pela checagem de permissão
(doc de `$.tool.call`). Por isso o hook `tool.check` do próprio mod vê o "ask" da chamada que o mod fez e chama
`setWaiting`. O `setWaiting` publica a atividade, a publicação pede o id, o id ainda não está guardado, e sai outra
chamada. Cada volta deixa mais um pedido de aprovação na tela.

### Três cortes, cada um suficiente para parar o loop

1. **A checagem do próprio mod não marca espera.** O `next.origin` de `tool.check` diz quem levantou a checagem:
   `{ plugin: 'engine', tier: 'core' }` quando a chamada é do modelo, e o nome do plugin quando é um `$.tool.call` ou
   um `$.tool.check` dele (doc de `ToolCheckInput.tool_use_id`). O hook passa a começar assim:
   `if (next.origin.plugin === 'orquestrador') return next(e)`. Ele não chama `setWaiting` e não muda o veredito. A
   sessão só fica "esperando permissão" quando o pedido é do modelo.
2. **Um `get_session` por vez.** `selfId` passa a ter uma promessa do módulo (`selfAsk`). A primeira chamada cria a
   promessa, e as que vierem enquanto ela está pendente esperam a mesma promessa. Quando o id chega, ele vai para o
   `$.state` (`SELF_ID`, como hoje) e a promessa é solta. Se a chamada falha ou volta sem linha, a promessa é solta
   sem guardar nada, e uma chamada futura pode tentar de novo, mas só depois de passar pelo corte 3.
   `loadSessions`, `groupFamily` e `cleanupChange` param de chamar `get_session` por conta própria e usam
   `selfRowNow($, why)`. Essa função também junta as chamadas simultâneas numa só, mas não guarda a linha entre uma
   volta e outra, porque `isRunning` e `groupId` mudam e o aviso precisa deles frescos.
3. **Perguntar antes de chamar.** Antes de qualquer `get_session` ou `list_sessions` que não vem de uma ação do dono
   (refresh do relógio, `publishActivity`, `restoreActivity`, agrupamento, aviso, `refuseStart`, `folderIsOwn`), o mod
   chama `mayList($, tool, input)`:
   - `$.tool.check({ tool, input })` com o mesmo input da chamada. A consulta não abre diálogo (doc de
     `$.tool.check`);
   - `allow` → chama a ferramenta e apaga o registro de permissão que falta;
   - `ask` ou `deny` → não chama. Grava em `$.state` (chave nova `permission-needed`) a lista das ferramentas e
     desde quando, e a função que pediu recebe "não sei", como já acontece hoje com `canCall` falso.
   Uma ação do dono (clique, slash command) pode chamar mesmo com "ask": o dono está presente, e o diálogo aparece uma
   vez só, por causa do corte 2.

### O aviso

O registro `permission-needed` aparece em dois lugares:

- no painel, junto dos outros avisos (`warnings` do `ui.render` do Pane);
- na faixa acima do prompt (`AbovePrompt`/`renderBand`), mesmo sem plano carregado.

O engine não tem um lugar de status line para mods (não há componente `StatusLine` nos tipos), então a faixa faz esse
papel. O texto vai no `i18n.ts`, nos dois idiomas. Em pt-BR: `Permita get_session e list_sessions para o painel ver
as sessões.` O mod nunca escreve em `settings*.json`, e o `touchesSettings` continua recusando isso para o modelo.

### O que o refuseStart faz sem permissão

`refuseStart` precisa contar as sessões vivas. Sem permissão, ele não consegue contar. Hoje a mesma situação, sem
`self`, já recusa ("could not read this session"). Isso continua igual: sem permissão, a sessão não abre, e a
mensagem passa a dizer que falta permitir `get_session`/`list_sessions`.

## 2. Abrir as fases sem clique

### Filhas que o app acompanha (`tracked`)

O `FlowState` ganha `tracked?: string[]`. No `tool.call` do mod, depois de um `START_SESSION` que deu certo, o id da
filha (`startedSessionId`) entra em `tracked` quando o input trazia `wake_when_done: true`. A gravação passa pelo
`inFlowQueue`, na mesma vez que o `keepGrouping`, sem uma gravação a mais.

`wakeOnce` tira de `pending` as filhas em `tracked` antes do freio. Elas continuam no `seen`, para que a linha de base
não se perca se o id sair de `tracked`. Uma filha aberta por card ou pelo dono não passa pelo `tool.call` do mod com
`wake_when_done`, fica fora de `tracked` e continua sendo avisada com a opção ligada. O teste fica em
`eligibleChildren`/`wake.ts` (função pura `untracked(ids, tracked)`) e no harness.

### Onde ficam as sessões pendentes

| Opção | Prós | Contras |
| --- | --- | --- |
| **A. Ação nova `flow pending`**: a coordenação registra as sessões que o app recusou, com título, prompt, modelo, esforço e `use_worktree` | O mod tem tudo o que precisa para abrir a sessão igual à coordenação abriria; a lista é explícita e aparece no `status` | A coordenação precisa chamar a ação (a skill e a resposta do `flow` dizem quando) |
| B. O mod deriva a lista do passo atual e das fases do plano sem sessão viva | Nada novo na skill | O mod não tem o prompt da sessão (o corpo do agente, o brief da fase, o id da coordenação para o `SendMessage`); abriria sessões com prompt montado por ele, diferente do da coordenação; erra quando uma fase está esperando de propósito (dependência, teto) |

**Escolha: A.** O prompt é da coordenação, e o mod não deve escrever um. B serve só como conferência: uma entrada cuja
fase já tem sessão viva no plano é descartada ao abrir.

`flow pending` (no `FLOW_SCHEMA` e no `flow.ts`, função pura):

- input `sessions: [{ key, title, prompt, model?, effort?, use_worktree? }]`. `key` é o id da fase (`"2"`, `"4.6"`) ou
  do passo (`"planejar"`). Uma `key` repetida substitui a anterior;
- só no flow `running` desta coordenação, e só quando o passo atual é de sessão ou `executar`. Fora disso, recusa
  com o motivo;
- `prompt` com até 20 000 caracteres, `title` com até 120, e no máximo 6 entradas. Acima disso, recusa;
- grava em `FlowState.pendingStarts` e um evento `pending` no log (com as `key`, sem o prompt).

Uma entrada sai da lista quando:

1. o mod a abre (abaixo);
2. um `START_SESSION` do modelo dá certo com o mesmo `title`;
3. a fase é fechada (`close`);
4. o flow sai do passo da entrada (para `key` de passo).

A resposta do `flow` no passo de sessão e no `executar` (`flow.ts` ~1082-1091) troca "proponha como card" por
"registre com action `pending` e diga ao dono que é um clique em 'Abrir as N sessões pendentes' ou
`/orquestrador abrir`".

### O botão e o `consent`

Com `pendingStarts` não vazio, o painel mostra, no bloco do passo atual, um botão só: **"Abrir as N sessões
pendentes"**. O clique chama `openPending($, words)`:

1. relê o flow dentro do `inFlowQueue` e **sai da fila** antes de abrir qualquer sessão. A fila não é reentrante: o
   agrupamento de cada abertura (`groupQuietly` → `keepGrouping`) grava o flow pela mesma fila, e esperaria por si
   mesmo se o `openPending` ainda estivesse dentro dela;
2. para cada entrada, em ordem: o mesmo portão do hook (`refuseStart`, rígido em "barrar", só aviso em "lembrar",
   nada com o clone inativo); depois `$.tool.call({ tool: START_SESSION, title, prompt, initiation: 'user_asked',
   wake_when_done: true, use_worktree, consent: words })`; depois `set_session_model`/`set_session_effort` quando a
   entrada traz esses campos, como a skill faz hoje; e o `groupQuietly` com a filha a guardar em `tracked`;
3. **a chamada do mod não passa pelo `tool.call` do próprio mod.** O plano supunha que sim ("todo hook menos o que
   chamou"), mas o harness da fase 2 mostrou o contrário: um `start_session` disparado pelo clique chega ao app sem
   nenhum `get_session`/`list_sessions` antes, ou seja, sem `refuseStart` e sem agrupamento. Por isso o
   `openPending` aplica o portão e o agrupamento ele mesmo, fora da fila. Se no app real o hook também rodar, o
   portão e o agrupamento rodam duas vezes, e as duas são idempotentes (o `keepGrouping` não duplica `sessions` nem
   `tracked`). Uma recusa interrompe o laço: o que sobrou fica na lista, e o toast diz quantas abriram, quantas
   ficaram e por quê;
4. tira da lista as entradas que abriram numa **volta nova da fila**, relendo o disco, e grava o evento
   `pending-opened` no log (com as `key`, sem o prompt).

**Com a permissão das ferramentas de sessão em "ask".** O portão do passo 2 é o `refuseStart`, que conta as sessões
vivas com `loadSessions` → `selfRowNow`/`listCall` → `mayList`. Ele não sabe que o pedido veio de um clique do dono:
com "ask", o `mayList` não chama, o `self` fica indefinido, e a abertura é recusada com o motivo da fase 1 ("allow
get_session and list_sessions"). Nenhuma sessão abre, a lista fica como estava, o toast diz o motivo e o painel
mostra o aviso de permissão. Depois que o dono permite, o mesmo clique abre. O harness cobre os dois casos.

O `saveFlow` mantém uma entrada pendente só quando o estado gravado e o disco a têm: uma escrita lida antes de uma
abertura não traz de volta a entrada que a abertura tirou. A ação `pending` grava pela própria volta da fila, lendo o
disco. O `tracked` é somado com o do disco, como o `sessions`.

A conferência "B" (descartar ao abrir uma entrada cuja fase do plano já tem sessão viva) não entrou na fase 2: o teto
do `refuseStart` e a saída por título (um `START_SESSION` do modelo com o mesmo `title`) cobrem os casos vistos. Fica
como melhoria, se a 2.6 mostrar duplicata.

`words` é a frase do gesto real do dono, no formato que o `ToolCallReserved.consent` descreve:

- clique: `The user pressed "Abrir as 3 sessões pendentes" in the orquestrador panel.`
- comando: `The user typed "/orquestrador abrir".`

O mod só passa `consent` dentro de `openPending`, e `openPending` só é chamado pelo clique e pelo `command.run` com
`origin` do dono. O `wakeOnce` e o `pressFlow` não usam `consent`. Um teste confere com
`grep -n "consent" orquestrador/hooks/register.tsx`: ele só pode aparecer dentro de `openPending`.

### Riscos a conferir no app

O harness não reproduz as regras do app. O executor confere no app real e registra no `evidence.md`:

1. **O app aceita `user_asked` com `consent` vindo do mod?** O tipo diz que o permission path lê o `consent` como
   pedido do usuário. A regra do `user_asked` é do app (`ccd_session`). Se o app recusar, o mod não insiste, a lista fica, e o painel diz "o app não aceitou abrir pelo painel; digite
   `/orquestrador abrir` no desktop" (se o comando também for recusado, o texto pede que o dono escreva à
   coordenação).
2. **Pelo Remote Control.** O mesmo, com o clique no painel do celular (`e.surface === 'mobile'`) e o comando com
   `origin.kind === 'bridge'`. Se o app recusar, isso fica como limitação: o painel no celular e o comando dizem
   "pelo celular o app não abre sessões; digite `/orquestrador abrir` no desktop".
3. **O `wake_when_done` de uma filha aberta pelo mod acorda a coordenação?** O `$.tool.call` roda no laço da
   sessão. Se o app não acordar, o plano B é o mod não gravar essas filhas em `tracked`, e o aviso da opção cobre
   esses casos. **O plano B não está no código da fase 2**: o `openPending` grava em `tracked` toda filha que abre.
   Ele só acontece depois da conferência 2.6, se ela mostrar que o app não acorda, e com outra mudança de código
   (tirar o `track` do `groupQuietly` do `openPending`, com um teste que prove o aviso para essas filhas).
4. **A corrente depois do clique.** O `<side-sessions-event>` de uma filha aberta pelo mod pode não contar como
   corrente do dono. Nesse caso, a próxima onda volta para `pending`, e o pior caso é um clique por onda, não um por
   fase. Fica registrado.

### O que não muda

- `STOP_AS_USER` continua `false`. O aviso continua sendo do mod.
- O `wakePrompt` do clique continua sendo mensagem do mod. O passo seguinte a um clique do dono costuma ser um passo
  de sessão, e quando o app recusar o `start_session` nesse turno, a coordenação registra em `pending`, como acima.

## 3. `/orquestrador` com subcomandos

### Módulo puro `hooks/command.ts`

- `parseCommand(args: string)` devolve `toggle` (vazio), `status`, `help`, `open`,
  `approve { outcome, note? }`, `skip { phase, gate, confirmed }`, `end { reason?, confirmed }` ou
  `unknown { word }`. A nota de `aprovar` é o
  resto da linha depois da saída. `pular-portão` aceita também `pular-portao` (sem acento). A confirmação é a palavra
  final `confirmar`;
- `fromOwner(origin: PromptOrigin)` aceita só `composer` e `bridge`. Aceitar todas menos `plugin` deixaria entrar
  `peer`, `scheduled-trigger`, `task-notification` e `unclassified`, e nenhuma dessas é o dono digitando. A lista
  curta é o lado seguro;
- `statusText(state, view, t)` monta a resposta do `status` em linhas curtas, sem tabela.

### O hook

`on('command.run', { command: 'orquestrador' }, async ($, e) => …)` passa a ler `e.args` e `e.origin`:

- `toggle` faz o que faz hoje, com qualquer origem (abrir o painel não decide nada);
- os outros subcomandos com `!fromOwner(e.origin)` → `{ text: t.command.notFromOwner }`, e nada acontece;
- `status` lê o flow desta coordenação (`currentFlow`), o `pendingStarts`, os portões abertos (`loadSkips` e as
  views de portão que o painel já monta) e o aviso de permissão. Ele não chama `get_session`/`list_sessions` além do
  que o `mayList` permitir;
- `aprovar` chama o mesmo `pressFlow`. O `pressFlow` passa a devolver `{ ok, text } | { error }` em vez de só mostrar
  o toast. O clique continua com o toast, e o comando devolve o texto. As validações são as mesmas: passo atual do
  dono, saída declarada (`ownerPress`), liberação só no plan mode (`RELEASE_STEP`), mockup (`pressMockup`) e nota
  obrigatória onde o botão exige. O `wakePrompt` sai do mesmo jeito, depois do comando responder (`void`, para não
  segurar o comando);
- `abrir` chama `openPending($, 'The user typed "/orquestrador abrir".')` e responde com quantas abriram, quantas
  ficaram e por quê, e com a limitação do Remote Control quando `origin.kind === 'bridge'` e o app recusou;
- `pular-portão <fase> <portão>` sem `confirmar` responde o que vai ser pulado e pede o mesmo comando com
  `confirmar` no fim. É o equivalente dos dois cliques do painel. Com `confirmar`, chama o mesmo `skipGate`;
- `encerrar [motivo]` funciona como o `pular-portão`: sem `confirmar`, responde o que vai ser encerrado; com ele,
  chama `endFlow` (abaixo);
- `ajuda` e `unknown` listam os subcomandos.

### Encerrar o flow a qualquer momento

Hoje o `resolveEscalation` com `encerrar` (`flow.ts` ~857) é o único caminho para `aborted`. A função pura nova
`endFlow(state, at, note?)` faz o mesmo para um flow `running` ou `escalated`: `status: 'aborted'`, `seq + 1`, evento
`aborted` com `by: 'owner'` e a nota, e `pendingStarts` vazio. Um flow `done` ou `aborted` é recusado. O
`resolveEscalation` passa a chamar `endFlow`, por isso o estado e o evento da escalada não mudam.

- **Botão.** "Encerrar o flow" aparece no bloco do flow enquanto ele está `running` ou `escalated`, também no
  celular. São dois cliques, como no pulo de portão: o primeiro troca o botão por "Confirmar: encerrar o flow de
  <change>", e o segundo encerra.
- **O que não acontece.** Nada é arquivado, e o grupo da sidebar fica. O `cleanupChange` continua só no passo
  `arquivar`, porque encerrar no meio pode deixar trabalho não commitado nas filhas. Nenhum `$.prompt.submit` sai. A
  coordenação vê o `aborted` no próximo `flow status`, e o aviso da opção para sozinho, porque o `wakeOnce` exige o
  flow `running`.
- **Só o dono.** Só o clique e o comando com `fromOwner` encerram. O `FLOW_SCHEMA` não ganha ação de encerrar, então
  o modelo não encerra o flow.

Sem flow desta coordenação (por exemplo, numa sessão filha), os subcomandos respondem "nenhum flow em andamento
nesta sessão; use na sessão da coordenação".

### Texto simples

As respostas são linhas curtas, sem tabela e sem markdown além de crase, porque o Remote Control mostra o texto
estreito. Os textos ficam no `i18n.ts`, nos dois idiomas, no bloco `command`.

## Fases e arquivos

| Fase | Arquivos |
| --- | --- |
| 1 | `hooks/register.tsx`, `hooks/i18n.ts`, `hooks/pane.tsx` (faixa), `tests/permissao-harness.test.ts` (novo) |
| 2 | `hooks/flow.ts`, `hooks/wake.ts`, `hooks/register.tsx`, `hooks/pane.tsx`, `hooks/i18n.ts`, `tests/flow.test.ts`, `tests/wake.test.ts`, `tests/autowake-harness.test.ts`, `tests/pendentes-harness.test.ts` (novo) |
| 3 | `hooks/command.ts` (novo), `hooks/flow.ts`, `hooks/register.tsx`, `hooks/pane.tsx`, `hooks/i18n.ts`, `tests/flow.test.ts`, `tests/command.test.ts` (novo), `tests/comando-harness.test.ts` (novo) |
| 4 | `skills/change-orchestrator/SKILL.md`, `README.md`, `.claude-plugin/plugin.json` |

As fases 1, 2 e 3 mexem em `register.tsx`, `i18n.ts` e `pane.tsx`, e 2 e 3 mexem em `flow.ts` e `flow.test.ts`. Por isso ficam em série, uma onda
cada. Também há dependência de conteúdo: a fase 3 usa o `openPending` da fase 2 e o `mayList`/aviso da fase 1. A
fase 4 descreve o que as três entregaram, então vem por último. Juntar 1 a 3 numa fase só daria cerca de 25 tarefas
numa sessão e uma revisão difícil. Em série, cada fase tem seus portões e um diff que dá para revisar.

## Passos automáticos do flow do projeto

O repositório não usa OpenSpec. O `.orquestrador/flows/completo.json` (base `completo`) troca os passos automáticos:
`validar` = `claude plugin validate`, `checagem` = `claude plugin test` com o `evidence.md` preenchido, o passo novo
`tipos` = `tsc` depois da checagem, e `arquivar` = lançamento da versão (`gh release create`). O plano e as tarefas
não citam `openspec` como passo. O lançamento da 0.14.0 é o passo `arquivar`, não uma tarefa de fase.
