# Orquestrador

Plugin para o Claude Code que orquestra uma change com várias sessões em paralelo e mostra tudo num painel lateral: em que passo o trabalho está, o que cada sessão está fazendo, quais gates de qualidade passaram e o que espera uma decisão sua.

*A Claude Code plugin (mod) that orchestrates a change across parallel sessions through a declared flow, with a live side panel and owner decisions as panel buttons. The UI speaks Brazilian Portuguese or English, set per project (see "Idioma").*

## O que ele faz

- **Flow declarado.** O trabalho segue um flow escrito em arquivo, passo a passo. Cada passo diz quem responde:
  - **sessão:** uma sessão faz o trabalho e informa o resultado;
  - **automático:** o mod observa um comando rodar, e o código de saída decide;
  - **dono:** só um clique seu no painel responde, e nenhuma sessão responde por você.
- **Dois flows prontos:**
  - `completo`: grill → mockup → plano OpenSpec → validação → revisão do plano → liberação do dono pelo plan mode → fases → revisão de código → checagem final → PR → QA → produção → arquivamento;
  - `rapido`, para correções pequenas.
  - Um projeto pode ter flows próprios em `.orquestrador/flows/*.json`, escritos do zero ou derivados de outro (veja [Workflows do projeto](#workflows-do-projeto)).
  - Ao iniciar uma change, a coordenação sempre mostra os workflows disponíveis para você escolher.
- **Passos descritos a fundo, com agente especialista.** Cada passo diz o que recebe, o que produz e o que bloqueia. Cada passo de sessão nomeia o agente que o executa, com modelo e esforço. O plugin traz oito agentes em `orquestrador/agents/`: planejador, revisor-plano, executor, revisor-codigo, abre-pr, publicador, merge e deploy. Um projeto troca qualquer um deles com um arquivo de mesmo nome em `.orquestrador/agents/`.
- **Revisão do PR, merge e deploy como passos.** Servem para projetos trunk-based (um merge na `main`) e para projetos dev/master (merge em `dev` para o QA, em `master` para a produção).
  - **Merge automático:** só acontece com o PR aprovado no GitHub, o CI verde e os portões finais passados. O mod recusa `gh pr merge` antes da revisão do PR e recusa `--admin` sempre.
  - **Deploy:** espera o deploy do CI, roda rotinas fora do CI, ou faz os dois; pode ser automático, logo depois do merge.
- **Painel ⚙️ Workflows (`/orquestrador-workflows`).** Fica separado do painel 🧭 e mostra os workflows disponíveis com a configuração de cada passo. Ali você também cria e edita os workflows do projeto.
- **Gates de qualidade por fase.** São checagens como testes, lint, `check.sh`, `openspec validate`, print da tela e revisão de regras:
  - **comprovação:** o mod só aceita um gate quando vê o comando rodar e passar;
  - **validade:** editar arquivos depois da comprovação desatualiza o gate;
  - **pulo:** só você pula um gate, com dois cliques.
- **Painel lateral (`/orquestrador`).** Mostra o andamento da change, o OpenSpec (proposta, tarefas e evidência), os gates do flow, o que precisa de você e as tarefas de cada fase com a sessão que as executa. Uma faixa acima do campo de mensagem resume o estado.
- **Grill com respostas no painel.** As rodadas de perguntas viram critérios de aceite, e você responde cada pergunta num campo do próprio painel.
- **Sessões em paralelo.** Cada fase roda numa sessão própria, com teto de 3 sessões vivas. As sessões entram sozinhas no grupo da change na barra lateral e são arquivadas quando a fase fecha.
- **Jira com o seu ok.** O painel avisa quando uma issue deve mudar de estado e só a move depois do seu clique.

A skill `change-orchestrator`, que vem junto, ensina a sessão coordenadora a seguir o flow: ela pergunta ao mod qual é o próximo passo em vez de decidir sozinha.

## Requisitos

- Claude Code com suporte a mods (plugins de function hooks).
- O app desktop do Claude Code para a experiência completa: painel lateral, plan mode e gestão de sessões e da barra lateral. No terminal, o painel e o flow funcionam, mas as ações sobre outras sessões dependem das ferramentas do app.
- Opcional: OpenSpec no projeto e o conector Atlassian para o Jira.

## Instalação

Dentro do Claude Code:

```
/plugin marketplace add chacal88/orquestrador
```

```
/plugin install orquestrador@orquestrador
```

Ou pelo terminal:

```bash
claude plugin marketplace add chacal88/orquestrador
```

```bash
claude plugin install orquestrador@orquestrador
```

Depois de instalar, reinicie o app ou rode `/reload-plugins`.

## Uso

0. Instalado, o plugin fica quieto até você ativá-lo no clone (veja [Ativar neste clone](#ativar-neste-clone)).
1. Peça à sessão para orquestrar uma change, ou use a skill `change-orchestrator`.
2. Escolha um dos workflows que a coordenação mostra e abra o painel com `/orquestrador`.
3. Acompanhe pelo painel e responda os seus passos pelos botões.

Para ver ou editar os workflows do projeto, abra `/orquestrador-workflows`.

## Ativar neste clone

As configurações do projeto ficam em `.orquestrador/config.json` e vão para o git. O que **liga** o orquestrador é local, deste clone, e nunca vai para o repositório: quem clona o projeto não é afetado.

- **Quieto sem ativação.** Num clone que não foi ativado, o plugin não abre o painel 🧭 sozinho, não desenha a faixa acima do prompt, não põe regras do flow na conversa e não recusa merge nem portões. `/orquestrador` e `/orquestrador-workflows` continuam disponíveis, e o cartão "Este projeto" do painel ⚙️ mostra o estado "inativo neste clone". Uma change com flow em andamento no clone continua funcionando mesmo sem ativação, para nada parar no meio.
- **Ativar.** No painel ⚙️ Workflows, "Este projeto" → "Ativar neste clone": escolha o nível e confirme.
  - **Barrar** (padrão): segue o flow e recusa merge e deploy fora dele, `--admin` e portões abertos.
  - **Lembrar**: o flow e as regras entram na conversa, mas nada é bloqueado; cada recusa do "barrar" vira só um aviso.
  Com o clone ativo, o cartão oferece "Trocar para lembrar/barrar" e "Desativar neste clone".
- **O que é gravado**, e só isso, em `.claude/settings.local.json` do repositório principal (as worktrees usam o dele; o Claude Code recarrega o arquivo sem reiniciar):

  ```json
  {
    "env": { "ORQUESTRADOR": "barrar" },
    "hooks": {
      "SessionStart": [
        { "hooks": [ { "type": "command", "command": "printf '%s\\n' \"Orquestrador ativo neste clone (nivel: ${ORQUESTRADOR:-barrar}). …\" # orquestrador:ativar" } ] }
      ]
    }
  }
  ```

  `env.ORQUESTRADOR` é a marca (`barrar` ou `lembrar`); o hook `SessionStart` imprime um lembrete do flow e das regras, que entra como contexto de cada sessão. O hook se reconhece pelo `# orquestrador:ativar` no fim do comando.
- **Desativar** tira só a marca e esse hook, preserva todo o resto do arquivo e remove as chaves `env` e `hooks` que ficarem vazias. Um `settings.local.json` que não seja um JSON válido não é gravado: o painel diz por quê e o arquivo fica como está.
- **Fora do git.** O Claude Code põe `.claude/settings.local.json` no exclude global do git ao criá-lo; se o plugin criar o arquivo e ele não estiver ignorado, acrescenta a linha ao `.git/info/exclude` do clone, nunca ao `.gitignore`. Hooks do git e `CLAUDE.local.md` não são usados.

## Workflows do projeto

Um projeto tem os workflows padrão (`completo`, `rapido`) e os seus, em `.orquestrador/flows/<id>.json`. Um workflow do projeto com o mesmo `id` de um padrão passa a valer no lugar dele. Uma change em andamento continua com o workflow com que começou, mesmo que o arquivo mude depois.

### Pelo painel ⚙️ Workflows

`/orquestrador-workflows` abre e fecha o painel. Ele pode ficar aberto ao lado do 🧭.

- **Visão:** a lista de workflows, com a origem de cada um (padrão, do projeto ou derivado de outro) e os arquivos com erro. Ao abrir um workflow, você vê os passos em ordem. Cada passo mostra:
  - quem responde e o que entra, sai e bloqueia;
  - o agente, de onde ele vem, o modelo e o esforço;
  - o comando, quando há;
  - no merge, a branch, o método e se é automático;
  - no deploy, o CI, as rotinas e se é automático.
- **Edição:** "Novo workflow", do zero ou a partir de outro, ou "Editar" num existente. Num passo aberto você pode:
  - ligá-lo ou desligá-lo, e subi-lo ou descê-lo;
  - trocar o agente, o modelo e o esforço;
  - configurar merge e deploy;
  - acrescentar um passo depois dele, da biblioteca ou novo.

  Tudo fica em rascunho até você clicar em "Salvar" ou "Descartar".
- **Salvar:** o mod confere o workflow como se fosse carregá-lo. Se algo estiver inválido, mostra o erro e não grava nada. Com base, grava no formato derivado; do zero, grava os passos completos. Editar um padrão cria o workflow do projeto de mesmo id, com aviso.

### Workflow derivado

Parte de outro (padrão ou do projeto) e diz só o que muda. Exemplo de um projeto trunk-based, com revisão do PR, merge automático na `main` e deploy pelo CI com uma rotina a mais:

```json
{
  "id": "trunk",
  "title": "Trunk-based",
  "base": "completo",
  "remove": ["mockup", "qa"],
  "add": [
    { "after": "pr", "step": "revisao-pr" },
    { "after": "revisao-pr", "step": { "use": "merge", "merge": { "branch": "main", "auto": true } } },
    { "after": "merge", "step": { "use": "deploy", "deploy": { "ci": true, "commands": ["npm run migrate:prod"], "auto": true } } }
  ],
  "override": { "revisao-codigo": { "model": "claude-sonnet-5-5" } }
}
```

- `remove`: os passos que saem. O mod liga o passo anterior ao seguinte. O laço `executar` não pode sair.
- `add`: `{ "after": "<id>", "step": ... }`. O `step` pode ser:
  - um id da biblioteca;
  - `{ "use": "<id da biblioteca>", ...ajustes }`, com `id` próprio quando há mais de um, como `merge-dev` e `merge-main`;
  - um passo completo.
- `override`: campos por passo, sem mudar `id` nem `kind`.
- `order`: os ids na ordem final, opcional.

Num projeto dev/master, use dois merges: `merge-dev` (com `"branch": "dev"`), seguido do QA, e `merge-main` (com `"branch": "master"`), seguido da produção.

### Biblioteca de passos

- `revisao-pr`: passo do dono. Você revisa e aprova o PR no GitHub e aperta "PR aprovado". Enquanto ele não for respondido, o mod recusa o `gh pr merge` da change.
- `merge`, com `{ "branch", "method", "auto" }`. O método padrão é `squash`.
  - Com `auto: false`, o passo é seu: o botão, ou o mod vê o seu `gh pr merge` passar.
  - Com `auto: true`, o passo é automático. A coordenação confere a aprovação e o CI e roda `gh pr merge --<method>` sozinha. O `--admin` é sempre recusado.
- `deploy`, com `{ "ci", "commands", "auto" }`.
  - `ci`: espera o deploy do CI. O botão "Deploy do CI concluído" confirma, ou o mod vê `gh run watch … --exit-status` passar.
  - `commands`: as rotinas fora do CI, rodadas na ordem, cada uma como comando próprio.
  - O passo só avança com tudo cumprido. As rotinas também contam como sinal do passo `producao`.
- Também estão na biblioteca os passos dos workflows padrão, como `qa`, `producao` e `mockup`, para reaproveitar.

### Agentes

Cada passo pode ter `agent`, `model`, `effort` e `details` (`inputs`, `produces`, `blocks`). `flow status` diz à coordenação qual agente usar no passo atual, com o caminho do arquivo. Para trocar um agente num projeto, crie `.orquestrador/agents/<nome>.md` com o mesmo nome do agente do plugin.

### Workflow do zero

Formato:

```json
{
  "id": "investigacao",
  "title": "Investigação",
  "description": "Descobrir a causa de um problema.",
  "steps": [
    { "id": "grill", "title": "Entendimento", "kind": "owner",
      "outcomes": { "fechado": { "label": "Entendimento fechado", "next": "investigar" } } },
    { "id": "investigar", "title": "Investigar", "kind": "session",
      "outcomes": { "concluido": { "label": "Fatos levantados", "next": "revisao" } } },
    { "id": "revisao", "title": "Revisão do dono", "kind": "owner",
      "outcomes": { "aprovado": { "label": "Aprovar", "next": "fim" },
                    "aprofundar": { "label": "Aprofundar", "next": "investigar" } } }
  ]
}
```

Tipos de passo: `session`, `automatic` (com `command`), `owner` e `loop` (sobre as fases do `tasks.md`). Campos opcionais: `maxAttempts` (padrão 3, depois escala para o dono), `when: "visual"`, `detect`, `cleanup`, `jira`, `details`, `agent`, `model`, `effort`, `merge` e `deploy`.

`title`, `description` e `label` aceitam texto simples ou um texto por idioma, como `{ "pt-BR": "Investigar", "en": "Investigate" }`. Quando falta o idioma pedido, o painel usa o outro.

### Idioma

Cada projeto escolhe o idioma em `.orquestrador/config.json`, em dois eixos independentes:

```json
{ "language": { "ui": "en", "content": "pt-BR" } }
```

- **`ui`, caixas e títulos:** cabeçalhos das caixas, botões, status, a faixa acima do prompt, os avisos, os títulos dos passos do flow e os rótulos das respostas.
- **`content`, descrições e textos da change:** a descrição do flow e de cada passo. Também o idioma em que a sessão coordenadora escreve proposta, tarefas, perguntas do grill, títulos e notas das fases e perguntas ao dono. O mod informa esse idioma nas respostas das ferramentas `flow` e `plano`.

Idiomas: `pt-BR` e `en`. `"language": "en"` vale para os dois eixos. Sem o arquivo, fica `pt-BR` nos dois. Um valor desconhecido também fica em `pt-BR`, e o painel avisa. O exemplo acima mostra as fases em inglês e os textos dos itens em português.

### Configurações do projeto

O mesmo `.orquestrador/config.json` guarda o padrão dos passos de merge e deploy de todos os workflows do projeto, ao lado do `language`:

```json
{
  "language": { "ui": "pt-BR", "content": "pt-BR" },
  "merge": { "auto": false, "branch": "main", "method": "squash" },
  "deploy": { "auto": false, "ci": true, "commands": ["npm run migrate:prod"] }
}
```

- **Herança:** um passo `merge` ou `deploy` recebe do projeto cada campo que o workflow não escreveu. Um campo escrito no workflow vence. `auto` do projeto decide se um passo da biblioteca (`use: "merge"` / `use: "deploy"`) é do dono ou automático; um passo escrito à mão mantém o tipo que declarou. Uma change em andamento segue com o flow com que começou.
- **Valor errado:** vira um aviso com o nome do campo e é ignorado, nunca adivinhado.
- **Onde ver:** `flow status` e `flow list` dizem quais campos vieram do projeto.
- **Painel ⚙️ Workflows:** o cartão "Este projeto", no topo, resume idioma, merge e deploy; "Configurar" abre a edição em rascunho (nada é gravado até "Salvar", que só muda as chaves alteradas e preserva as outras do arquivo). O bloco "Nos workflows" mostra se cada workflow usa o do projeto, tem valor próprio ("Passar a usar o do projeto") ou não tem passo de merge/deploy ("Acrescentar merge e deploy"); as duas ações pedem confirmação e gravam pelo mesmo caminho do editor de workflows.

## Desenvolvimento

O código fica em `orquestrador/hooks/`, os tipos em `orquestrador/types/` e os testes em `orquestrador/tests/`.

```bash
claude plugin test orquestrador
```

```bash
claude plugin validate orquestrador
```

O plano e o histórico de decisões estão em `orquestrador/proposal.md`, `orquestrador/tasks.md` e `orquestrador/evidence.md`.

## Licença

MIT. Veja [LICENSE](LICENSE).
