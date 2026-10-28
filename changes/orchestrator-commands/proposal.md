# Comandos do orchestrator, um por ação, em inglês (0.15.0)

## Por quê

Hoje o dono fala com o mod por um comando só, `/orquestrador`, com subcomandos em português e palavras que precisa
lembrar: `aprovar fechado`, `pular-portão 2 testes confirmar`, `encerrar confirmar`. Ao digitar `/orq…`, o menu mostra
só `/orquestrador` e `/orquestrador-workflows`. O que cada um faz não aparece. Além disso:

- os nomes do plugin, do marketplace, das ferramentas do mod e dos agentes misturam português e inglês;
- o painel, aberto na sessão de coordenação, mostrou a change anterior (`freio-aviso`, já concluída) no lugar do flow
  em andamento;
- o botão "Abrir as N sessões pendentes" e o `/orquestrador abrir` falham com
  `context "fresh" needs a background of at least 80 characters`.

Fontes: `changes/orchestrator-commands/grill.md` (4 rodadas, 14 critérios) e o mockup aprovado
(https://claude.ai/artifact/51BmxUo4pnygtz6iALK586).

## O que muda

### Um comando por ação, sob `/orchestrator:`

| Comando | O que faz | Antes |
| --- | --- | --- |
| `/orchestrator:status` | Onde o flow está e o que espera do dono, em texto simples | `/orquestrador status` |
| `/orchestrator:approve [nota]` | Segue em frente no passo do dono, igual ao botão; numa escalada, tenta de novo | `/orquestrador aprovar <resultado> [nota]` |
| `/orchestrator:reject [nota]` | Pede ajustes no passo do dono | (não existia) |
| `/orchestrator:open` | Abre as sessões pendentes | `/orquestrador abrir` |
| `/orchestrator:skip-gate [N]` | Sem número, lista os portões abertos; com `N`, pula aquele portão | `/orquestrador pular-portão <fase> <portão> confirmar` |
| `/orchestrator:end [motivo]` | Encerra o flow de primeira | `/orquestrador encerrar [motivo] confirmar` |
| `/orchestrator:panel` | Abre ou fecha o painel da orquestração | `/orquestrador` |
| `/orchestrator:workflows` | Abre ou fecha o painel de workflows | `/orquestrador-workflows` |
| `/orchestrator:change` | Skill que orquestra uma change | `/orquestrador:change-orchestrator` |
| `/orchestrator:install` | Skill de instalação no projeto | `/orquestrador:instalar` |
| `/orchestrator:help` | A lista acima, em texto simples | `/orquestrador ajuda` |

- Nenhum comando exige palavra-chave. O texto depois de `approve`, `reject` e `end` é livre e opcional: vira a nota
  ou o motivo. O `skip-gate` só recebe um número.
- `approve` e `reject` escolhem sozinhos a saída do passo atual, a partir do que o passo declara (ver `design.md` §2).
  Se o passo não tem saída de ajustes, `reject` responde, por exemplo:
  `O passo atual (Está em produção) não tem opção de ajustes. Para seguir: /orchestrator:approve`.
- `skip-gate N` pede para repetir. O mesmo `skip-gate N`, repetido em até 2 minutos e com a lista inalterada,
  pula o portão.
- `/orquestrador` e `/orquestrador-workflows` deixam de existir.

### Nomes em inglês

- Plugin `orquestrador` → `orchestrator`; a pasta do plugin no repo vai de `orquestrador/` para `orchestrator/`.
- Marketplace `orquestrador` → `orchestrator`.
- Ferramentas do mod: `mcp__orquestrador__flow` → `mcp__orchestrator__flow` e `mcp__orquestrador__plano` →
  `mcp__orchestrator__plan`.
- Agentes renomeados:
  - `planejador` → `planner`
  - `revisor-plano` → `plan-reviewer`
  - `revisor-codigo` → `code-reviewer`
  - `abre-pr` → `pr-opener`
  - `publicador` → `publisher`
  - `merge-pelo-workflow` → `workflow-merge`
  - `executor`, `merge` e `deploy` mantêm o nome.

  Um flow de projeto que ainda cita o nome antigo continua achando o agente nesta versão.
- Pasta de configuração do projeto: `.orquestrador/` → `.orchestrator/`. Na 0.15.0, a pasta antiga ainda é lida
  quando a nova não existe.
- Repositório no GitHub: `chacal88/orquestrador` → `chacal88/orchestrator`. Marketplace, plugin e documentação apontam
  para o endereço novo.

### Correções

- **Painel.** Aberto numa sessão de coordenação, o painel mostra o flow em andamento dessa sessão, com o botão do passo
  do dono. Ele nunca mostra uma change concluída nem uma change de outra sessão.
- **Sessões pendentes.** O mod passa `context: "fresh"` e um `background` de pelo menos 80 caracteres ao
  `start_session`. Com isso, o botão "Abrir as N sessões pendentes" e o `/orchestrator:open` abrem as sessões.

### Versão e reinstalação

Versão **0.15.0**. O README ganha um passo a passo de reinstalação, porque o nome do plugin e o do marketplace mudam:
tirar o antigo, adicionar o novo, reativar no ⚙️ e atualizar as permissões `mcp__orquestrador__*`.

## Fora do escopo

- A pasta de registros do mod em `~/.claude/orquestrador/` (flows, runs, portões) fica onde está nesta versão. Ela não
  é configuração do projeto e guarda o flow desta própria change; ver `design.md` §4.
- A pasta local do clone (`~/Documents/orquestrador`) não muda. Os flows são do `coordinatorCwd`, e renomear a pasta
  órfã os flows em andamento.
- A pasta `.orquestrador/` deste repositório só passa a `.orchestrator/` depois que o dono reinstala a 0.15.0 (tarefa
  7.2, com o ok dele). A 0.14.1 instalada não lê a pasta nova.
- O dicionário de textos continua em pt-BR e en. Só os nomes de comando, ferramenta, agente, plugin e pasta mudam para
  inglês.

## Critérios de aceite

Os números C1 a C14 seguem a ordem do `grill.md`. Os critérios 6 e 7 do grill foram registrados como "Sim." e
"Sim (ambíguo; confirmar na rodada 2)". O texto deles foi reconstruído a partir da rodada 1 ("Cortar /orquestrador de
vez, com passo a passo de reinstalação?" e "Renomear o repositório do GitHub?"), e a rodada 2 confirmou o rename.

- **C1.** Ao digitar `/orchestrator` no prompt, o menu lista todos os comandos do plugin, um por ação. Tarefas: 3.1,
  3.2 e 6.4 (conferência no app).
- **C2.** Os comandos são `/orchestrator:status`, `:approve`, `:end`, `:open`, `:skip-gate`, `:panel`, `:workflows`,
  `:change`, `:install` e `:help`. O mockup aprovado acrescenta `:reject`. Tarefas: 2.3 e 3.2.
- **C3.** Existe um único `/orchestrator:change` no lugar do `change-orchestrator`, e não há `/orchestrator:propose`.
  Tarefa: 2.3.
- **C4.** Nenhum comando do plugin exige palavra-chave para funcionar: nem confirmar, nem resultado, nem nome de
  portão. Tarefas: 3.3 e 4.1 a 4.5.
- **C5.** Plugin, marketplace, ferramentas do mod, agentes e pasta de configuração têm nomes em inglês. Um projeto com
  `.orquestrador/` continua funcionando nesta versão. Tarefas: 1.1 a 1.5 e 2.1 a 2.5.
- **C6** (grill nº 6). `/orquestrador` sai de vez e o README traz o passo a passo de reinstalação. Tarefas: 3.3 e 6.2.
- **C7** (grill nº 7). O repositório é renomeado nesta change, como a rodada 2 confirmou. Tarefa: 7.1 (cumprida
  junto com C13).
- **C8.** `/orchestrator:status` responde em texto simples, também pelo Remote Control. Tarefas: 4.6 e 6.4.
- **C9.** A entrega sai como versão 0.15.0. Tarefa: 6.1.
- **C10.** Os três casos abaixo funcionam. Tarefas: 4.2 e 4.3.
  - No grill, `/orchestrator:approve` sem argumentos fecha o entendimento, igual ao botão.
  - No mockup, `/orchestrator:reject <texto>` pede ajustes com essa nota.
  - Num passo sem saída de ajustes, `reject` responde que não há o que rejeitar.
- **C11.** `/orchestrator:end` encerra o flow de primeira, sem pedir confirmação. O texto depois do comando vira o
  motivo opcional. Tarefa: 4.4.
- **C12.** `/orchestrator:skip-gate` lista os portões abertos numerados. `/orchestrator:skip-gate N`, repetido em até
  2 minutos, pula aquele portão. Nenhum nome de fase ou portão é digitado. Tarefa: 4.5.
- **C13.** O repositório passa a `chacal88/orchestrator`, e o marketplace, o plugin e a documentação apontam para o
  endereço novo. Tarefas: 1.2, 6.2 e 7.1.
- **C14.** Ao abrir o painel numa sessão de coordenação, ele mostra o flow em andamento dessa sessão, com o botão do
  passo do dono, e nunca uma change concluída ou de outra sessão. Tarefas: 5.1 a 5.3.
- **B1** (bug das sessões pendentes). O botão "Abrir as N sessões pendentes" e o `/orchestrator:open` abrem as
  sessões. O `start_session` sai com `context: "fresh"` e um `background` de pelo menos 80 caracteres. Tarefas: 5.4
  e 5.5.
- **Portões.** `claude plugin test orchestrator`, `tsc` e `claude plugin validate orchestrator` saem com 0.
