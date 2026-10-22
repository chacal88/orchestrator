---
name: instalar
description: Instalação inicial do orquestrador num projeto (`/orquestrador:instalar`). Analisa o projeto sozinha (CI, testes, cobertura, lint, tipos, build, formatação, OpenSpec, branch padrão e proteção), roda cada comando candidato uma vez para confirmar que funciona, pergunta ao dono bloco a bloco (workflow base, portões, merge, deploy, idioma) sempre com a recomendação, mostra o que vai gravar e, com o ok dele, grava `.orquestrador/config.json` e `.orquestrador/flows/<id>.json`, valida como o mod carrega e commita numa branch. A ativação no clone fica com o dono, no painel ⚙️. Use quando o usuário pedir "instalar o orquestrador", "configurar o orquestrador neste projeto", "setup inicial do orquestrador" ou rodar `/orquestrador:instalar`.
---

# Instalar o orquestrador num projeto

Você prepara o projeto para o orquestrador: descobre os portões que o projeto já tem, confirma
que funcionam, pergunta ao dono o que é dele e grava dois arquivos versionados. Você **não
ativa** o orquestrador: isso é um clique do dono no painel ⚙️ (§ 6).

Ferramentas: Read, Glob, Grep e Bash para a análise; `AskUserQuestion` para as perguntas
(sem seletor na sessão, pergunte no chat, numerado, com a recomendação marcada); a ferramenta
`mcp__orquestrador__flow` do mod (carregue via ToolSearch) para validar no fim.

**Nunca**:
- escreva, leia por shell ou cite em comando de shell o `.claude/settings.local.json` (o mod
  recusa; a ativação é do dono);
- rode comando que publique, faça deploy, migre banco, mexa em remoto ou apague dados para
  "testar" um portão;
- commite na branch padrão, faça push ou abra PR sem o dono pedir;
- grave algo antes do ok do dono ao resumo do § 4.

## 0. Antes de começar

1. Confirme que está num repositório git (`git rev-parse --show-toplevel`) e trabalhe na raiz
   dele. Numa worktree, a raiz é a da worktree.
2. Se já existe `.orquestrador/`, leia `config.json` e `flows/*.json` e mostre ao dono o que
   há. Pergunte se quer **completar** (recomendado: preserva as chaves que você não for mudar)
   ou **refazer**. Nunca sobrescreva sem essa resposta.

## 1. Analisar o projeto (só leitura)

Leia, sem rodar nada ainda:

| Onde | O que procurar |
|---|---|
| `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`, `.buildkite/` | os comandos que o CI roda (testes, lint, tipos, build), em que branch, e se há job de deploy |
| `package.json` (`scripts`, `workspaces`, `packageManager`), `turbo.json`, `nx.json`, `pnpm-workspace.yaml`, lockfile | o gerenciador (`npm`/`pnpm`/`yarn`/`bun`, pelo lockfile) e os scripts `test`, `test:*`, `coverage`, `lint`, `format:check`, `typecheck`/`tsc`, `build`, `check` |
| `tsconfig.json` sem script de tipos | `npx tsc --noEmit` como candidato |
| `Makefile`, `justfile`, `Taskfile.yml` | alvos `test`, `lint`, `check`, `build`, `fmt` |
| `pyproject.toml`, `setup.cfg`, `tox.ini`, `noxfile.py` | `pytest` (e `--cov`), `ruff check`, `ruff format --check`/`black --check`, `mypy`/`pyright` |
| `go.mod` | `go test ./...`, `go vet ./...`, `gofmt -l .`, `golangci-lint run` |
| `Cargo.toml` | `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`, `cargo build` |
| `scripts/check.sh` | o portão `check` do orquestrador (o `checagem` dos workflows padrão) |
| `openspec/` ou `openspec --version` | OpenSpec presente (os passos `validar` e `arquivar` dos padrões dependem dele) |
| `git symbolic-ref refs/remotes/origin/HEAD` ou `gh repo view --json defaultBranchRef` | a branch padrão |
| `gh api repos/{owner}/{repo}/branches/<padrão>/protection` | se há proteção de branch e revisão obrigatória (um 404 é "sem proteção"; sem `gh` ou sem acesso, diga que não deu para saber) |

Prefira o comando que o CI roda ao que você deduz: é o que o projeto já confia. Monte a lista
de **portões candidatos**, cada um com o comando exato, na forma em que o projeto o roda
(`pnpm -r test`, `npm run lint`, `make check`), e a origem (arquivo:linha).

## 2. Confirmar que cada comando funciona

Rode cada candidato **uma vez**, cada um como comando próprio do Bash: **sem** `| tail`,
`| head`, `|| true`, `; echo`, `&&` com outro comando, nem redirecionamento que esconda o
código de saída. Comando longo (build, suíte grande) vai em segundo plano e você espera o fim.

- Saiu com 0 → entra como **recomendado**.
- Falhou → fica de fora da recomendação e aparece para o dono com o **motivo** em uma linha
  (o erro principal: dependência não instalada, variável de ambiente ausente, teste vermelho,
  comando inexistente). Não conserte o projeto nem instale dependências por conta própria; se
  o motivo for dependência ausente, pergunte se o dono quer que você instale e rode de novo.

Regras do mod que valem para o comando escolhido de cada portão:
- **Passo automático:** o mod reconhece o passo quando as palavras do `command` aparecem no que
  o shell rodou, e o código de saída decide. Por isso o `command` gravado **não leva aspas**
  (texto entre aspas não conta como executado) e a coordenação o roda sem nada depois.
- **Portão de fase/final** (`testes`, `lint`, `check`, `openspec`, `visual`, `regras`): só conta
  um comando que o mod reconhece como aquele portão (`npm test`, `pnpm -r test`, `vitest`,
  `pytest`, `go test`, `cargo test`; `eslint`, `npm run lint`, `ruff`, `biome check`,
  `prettier --check`; `scripts/check.sh`; `openspec validate`). Um comando que não casa (por
  exemplo `make test` ou `tsc`) só serve como **passo automático**: diga isso ao dono.

## 3. Perguntar ao dono, um bloco por vez

Uma pergunta (ou um `AskUserQuestion` com até 4 perguntas do mesmo bloco) por vez, sempre com a
sua recomendação como primeira opção, marcada "(Recomendado)". Espere a resposta antes do bloco
seguinte. Pergunta aberta (um comando, um nome de branch) vai no chat, numerada.

1. **Workflow base.**
   - `rapido` (recomendado para a maioria: plano curto, fases, revisão de código, checagem, PR);
   - `completo` (mudanças grandes, com grill, mockup, revisão do plano e liberação do dono);
   - do zero (veja "Workflow do zero" no README; só se o dono pedir algo que nenhum dos dois
     cobre).
   Mostre os passos do base e pergunte quais saem (`remove`; o laço `executar` não sai). Sem
   OpenSpec no projeto, recomende tirar `validar` e `arquivar`. O `id` recomendado é o do base
   (o do projeto passa a valer no lugar do padrão); um id próprio deixa os dois na lista.
2. **Portões.** Liste os candidatos: os que passaram (recomendados) e os que falharam (com o
   motivo). Para cada um que entra, onde:
   - **passo automático** com o comando exato (recomendado para o portão final e para o que o
     mod não reconhece como portão de fase), inserido depois de `revisao-codigo`;
   - **portão de fase** (cada fase do `executar` passa por ele) ou **portão final** (a change
     passa uma vez antes do merge), com o id do portão.
   O teste que o CI roda é o melhor candidato para a `checagem` (troque o `command` dela por
   override); a `checagem` exige o `evidence.md` da change preenchido.
3. **Merge.** Recomendação conforme o que o § 1 achou:
   - automático ou não (`merge.auto`); branch (a padrão); método (`squash`, `merge` ou `rebase`;
     recomende o que o histórico usa, ou `squash`);
   - agente: `merge` (exige o PR aprovado no GitHub e o CI verde; recomendado com proteção de
     branch e revisão obrigatória, junto do passo `revisao-pr` antes dele) ou
     `merge-pelo-workflow` (o workflow aprova: revisão de código do flow aprovada, portões
     finais passados, CI verde se houver; recomendado sem revisão obrigatória no GitHub);
   - ou nenhum passo de merge (o dono mergeia fora do flow).
4. **Deploy.** CI (se o § 1 achou um job de deploy), rotinas (comandos fora do CI, cada um
   próprio, na ordem; pergunte quais, no chat), os dois, ou nenhum; automático ou não. Deploy
   sem CI e sem rotina não existe: nesse caso, nenhum.
5. **Idioma.** `ui` (caixas, botões, títulos) e `content` (descrições e textos da change), cada
   um `pt-BR` ou `en`. Recomende o idioma da conversa e do README do projeto.

## 4. Mostrar, gravar e validar

Mostre ao dono o conteúdo **completo** dos dois arquivos e pergunte se pode gravar. Só com o ok:

`.orquestrador/config.json` (só as chaves decididas; ao completar, preserve as outras):

```json
{
  "language": { "ui": "pt-BR", "content": "pt-BR" },
  "merge": { "auto": true, "branch": "main", "method": "squash" },
  "deploy": { "auto": true, "ci": true, "commands": [] }
}
```

`.orquestrador/flows/<id>.json`, derivado do base. Exemplo de um projeto Node sem OpenSpec,
base `rapido`, lint e tipos como passos automáticos, os testes na checagem, merge automático
pelo workflow e deploy pelo CI:

```json
{
  "id": "rapido",
  "title": "Rápido (projeto)",
  "base": "rapido",
  "remove": ["validar", "arquivar"],
  "add": [
    { "after": "revisao-codigo", "step": {
      "id": "lint", "title": "Lint", "kind": "automatic", "command": "npm run lint",
      "description": "O mod vê o `npm run lint` passar; o código de saída decide.",
      "outcomes": { "passou": { "label": "Passou", "next": "$seguinte" },
                    "falhou": { "label": "Falhou", "next": "executar" } } } },
    { "after": "lint", "step": {
      "id": "tipos", "title": "Tipos", "kind": "automatic", "command": "npm run typecheck",
      "description": "O mod vê o `npm run typecheck` passar; o código de saída decide.",
      "outcomes": { "passou": { "label": "Passou", "next": "$seguinte" },
                    "falhou": { "label": "Falhou", "next": "executar" } } } },
    { "after": "pr", "step": { "use": "merge", "agent": "merge-pelo-workflow" } },
    { "after": "merge", "step": { "use": "deploy" } }
  ],
  "override": {
    "checagem": { "command": "npm test",
                  "description": "O mod vê o `npm test` passar, com o evidence.md preenchido." }
  }
}
```

- `"$seguinte"` liga o passo ao que vinha depois do `after`; `falhou` volta ao `executar`.
- Os passos `merge` e `deploy` da biblioteca herdam branch, método, `auto`, CI e rotinas do
  `config.json`: não repita esses campos no workflow. Com o agente `merge`, acrescente antes
  dele `{ "after": "pr", "step": "revisao-pr" }` e ponha o merge depois de `revisao-pr`.
- Portões de fase e finais não ficam nos arquivos: são escolhidos por change, no plano da
  coordenação (`plano`, `gates` e `finalGates`). Registre a escolha do dono na `description`
  do `executar` (override), por exemplo "Portões de fase: testes (`npm test`), lint
  (`npm run lint`).", para a coordenação usar em cada change.
- Textos em um idioma só (o `content` escolhido) ou `{ "pt-BR": "…", "en": "…" }`.

Grave com as ferramentas de edição (Write/Edit), não por shell. Depois **valide como o mod
carrega**: chame `mcp__orquestrador__flow` com a ação `list`; o workflow gravado tem de
aparecer, com os passos na ordem esperada, e sem erro de arquivo nem aviso do `config.json`.
Sem a ferramenta (mod não carregado), confira o JSON (`node -e` ou `python3 -m json.tool`
sobre cada arquivo) e diga ao dono que a validação do mod fica para o painel ⚙️, que mostra os
arquivos com erro. Erro → corrija, mostre a diferença ao dono e valide de novo.

## 5. Commitar

1. Se a branch atual é a padrão, crie uma: `git switch -c chore/instalar-orquestrador`. Se já
   está em outra, pergunte se commita nela ou numa nova (recomende nova).
2. Adicione só os arquivos gravados: `git add .orquestrador/config.json .orquestrador/flows/<id>.json`.
3. Commit convencional, por exemplo `chore(orquestrador): instala o workflow e as
   configurações do projeto`, com os portões e as escolhas de merge/deploy no corpo.
4. **Sem push**, a menos que o dono peça; com o pedido, `git push -u origin <branch>` e, se ele
   quiser, o PR.

## 6. Terminar

Resuma o que ficou gravado (workflow, portões com comando, merge, deploy, idioma, branch e
commit) e o que ficou de fora (os portões que falharam, com o motivo). Termine dizendo ao dono:

> Para ligar o orquestrador neste clone, abra `/orquestrador-workflows` e, no cartão
> **"Este projeto"**, aperte **"Ativar neste clone"** (nível "barrar" ou "lembrar"). Depois,
> peça uma change à sessão ou use a skill `change-orchestrator`.

A ativação é local e só do dono: você nunca escreve no `.claude/settings.local.json`.
