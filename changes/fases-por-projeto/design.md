# Design — fases por projeto

## 1. Passo descrito a fundo

Campos novos, opcionais, em qualquer passo (padrão ou do projeto):

```json
{
  "id": "revisao-codigo", "title": "Revisão de código", "kind": "session",
  "details": {
    "inputs": "O diff da change e o tasks.md marcado.",
    "produces": "Veredito aprovado/rejeitado com achados por arquivo:linha.",
    "blocks": "Rejeitado volta ao executar."
  },
  "agent": "revisor-codigo", "model": "claude-opus-5-5", "effort": "high"
}
```

- `agent` só em passo `session` ou `loop`; `model`/`effort` são a sugestão para a sessão que o executa (a
  coordenação aplica com `set_session_model` / `set_session_effort`).
- `flow status` passa a dizer, no passo atual: agente (e de onde veio: plugin ou projeto), modelo, esforço e o
  `details`.

## 2. Agentes especialistas

- `orquestrador/agents/<nome>.md`, agentes do plugin (frontmatter `name`, `description`, `model`, `tools`).
  Um por passo de sessão dos padrões: `planejador`, `revisor-plano`, `revisor-codigo`, `abre-pr`, `publicador`,
  e para a biblioteca: `merge`, `deploy`. Cada um diz papel, o que ler, o que entregar, critério de pronto e o
  que nunca fazer (ex.: nunca responder passo do dono, nunca `--admin`).
- Projeto: `.orquestrador/agents/<nome>.md` com o mesmo nome substitui o do plugin para aquele projeto.
- A coordenação despacha o passo com o agente: no prompt da sessão vai o corpo do agente resolvido (do projeto
  ou do plugin), e o mod o devolve pronto em `flow status` (campo "Instruções do agente: <caminho>").

## 3. Workflow do projeto: do zero ou derivado

`.orquestrador/flows/<id>.json` aceita, além do formato atual (`steps` completo), o derivado:

```json
{
  "id": "trunk", "title": "Trunk-based", "base": "completo",
  "remove": ["mockup", "qa"],
  "add": [
    { "after": "pr", "step": "revisao-pr" },
    { "after": "revisao-pr", "step": { "use": "merge", "merge": { "branch": "main", "auto": true } } },
    { "after": "merge", "step": { "use": "deploy", "deploy": { "ci": true, "commands": ["npm run migrate:prod"], "auto": true } } }
  ],
  "override": { "revisao-codigo": { "model": "claude-sonnet-5-5" } },
  "order": ["…opcional: ids na ordem final…"]
}
```

Resolução (pura, em `flow.ts`, testada):

1. Carrega a `base` (padrão ou outro do projeto; ciclo de `base` é erro).
2. `remove`: cada outcome que apontava para um passo removido passa a apontar para o `next` do primeiro outcome
   do removido (encadeado até um passo que fica, ou `fim`). Remover `executar` (o laço) é erro.
3. `add`: o passo novo entra depois de `after`; o outcome "de avanço" de `after` (o primeiro cujo `next` não volta
   para trás) passa a apontar para o novo, e o novo herda esse `next` antigo como `next` do seu primeiro outcome
   quando ele não declara outcomes. `step` é um id da biblioteca, `{ "use": "<id da biblioteca>", …ajustes }` ou
   um passo completo.
4. `override`: mescla campos por passo (não muda `id` nem `kind`).
5. O resultado passa pelo `parseFlow` de sempre; o erro cita o arquivo e o passo.

A change em andamento continua com o snapshot do flow em `FlowState.flow` (já existe); editar não a afeta.

## 4. Biblioteca de passos

`orquestrador/hooks/flows/library.ts`: passos prontos para `add` e para o painel, cada um com `details` e agente:

| id           | kind                     | o que faz |
| ------------ | ------------------------ | --------- |
| `revisao-pr` | owner                    | O dono revisa e aprova o PR no GitHub; botão "PR aprovado". |
| `merge`      | owner, ou automatic se `auto` | Merge do PR na `branch`. |
| `deploy`     | owner, ou automatic se `auto` | Deploy após o merge: CI e/ou rotinas. |
| `qa`, `producao`, `mockup`, `grill`, … | os dos padrões | reaproveitáveis. |

### Merge

`"merge": { "branch": "main", "method": "squash", "auto": false }`

- `auto: false` → passo do dono com `detect: gh pr merge` (o dono aperta "Merge feito" ou o mod vê o comando
  dele passar).
- `auto: true` → passo automático com `command: gh pr merge`: a coordenação roda
  `gh pr merge <pr> --<method>` (o agente `merge` diz como conferir antes). O mod recusa o `gh pr merge` enquanto
  (a) o passo `revisao-pr` do flow não foi respondido, (b) os portões finais não passaram (já existe), ou (c) o
  comando traz `--admin`. Aprovação no GitHub e CI verde são conferidos pela sessão com
  `gh pr view --json reviewDecision,statusCheckRollup` antes do merge; se faltar algo, ela reporta e o passo
  escala para o dono (nunca merge silencioso).
- `branch` aparece no título e no painel; um workflow dev/master tem dois merges (`merge-dev` → QA,
  `merge-main` → produção), um trunk-based tem um.

### Deploy

`"deploy": { "ci": true, "commands": ["npm run migrate:prod"], "auto": true }`

- `ci: true` → o deploy acontece pelo CI no merge; o passo espera a confirmação: o dono aperta "Deploy do CI
  concluído", ou o mod vê `gh run watch …` / `gh run view … --exit-status` passar.
- `commands` → rotinas fora do CI, rodadas pela coordenação depois do merge (e depois do CI, se `ci`), cada uma
  como comando próprio; o passo só passa quando todas passaram, na ordem.
- `auto: true` → a coordenação faz isso sozinha assim que o merge passa; `auto: false` → espera o dono liberar.
- Os comandos de deploy entram também no `detect` do passo `producao`, quando ele existe.

Para caber no modelo de passo atual (um comando por passo automático), o mod resolve `deploy` em sub-estados
guardados no `FlowStepRecord`: `ci` confirmado? quais `commands` passaram? O passo só avança com tudo.

## 5. Painel ⚙️ Workflows

- Pane `orquestrador-workflows`, título `⚙️ Workflows`, comando `/orquestrador-workflows` (registrado ao lado de
  `/orquestrador`); arquivo próprio `hooks/workflows-pane.tsx`.
- **Ver:** lista os workflows (padrão / do projeto / derivado de X), os erros de arquivo, e ao abrir um, os
  passos em ordem com: quem responde, `details`, agente (e origem), modelo, esforço, comando, portões
  (`requiresEvidence`), merge (branch, método, auto) e deploy (CI, rotinas, auto).
- **Editar:** "Novo workflow" (do zero ou a partir de…), ligar/desligar passo, acrescentar passo (da biblioteca
  ou novo, com título, quem responde e agente), subir/descer, ajustar campos, "Salvar". Salvar resolve o
  workflow como o mod resolveria; com erro, mostra e não grava. Grava sempre no formato derivado quando houver
  `base`, para o arquivo seguir legível. Editar um padrão cria um workflow do projeto com o mesmo id (que vence o
  padrão), com aviso.
- Só o dono edita: as ações vêm de clique no painel; nenhuma ferramenta do mod grava workflow.

## 6. Escolha do workflow ao iniciar

- `flow list` passa a trazer, por workflow: título, descrição, origem e a sequência de passos.
- A skill: antes do `flow start`, sempre mostrar ao dono as opções de `flow list`, com recomendação; nunca
  escolher sozinha.
