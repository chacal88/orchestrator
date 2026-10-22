# Design — configurações do projeto

## config.json

```json
{
  "language": { "ui": "pt-BR", "content": "pt-BR" },
  "merge": { "auto": false, "branch": "main", "method": "squash" },
  "deploy": { "auto": false, "ci": true, "commands": ["npm run migrate:prod"] }
}
```

- `parseConfig` (em `hooks/i18n.ts`, ou um `hooks/project-config.ts` que ele use) passa a devolver também
  `merge` e `deploy`, cada campo opcional, validados; valor inválido vira problema nomeado, nunca adivinhado.
- Herança: ao resolver um workflow, um passo `merge`/`deploy` recebe do projeto cada campo que o arquivo do
  workflow (ou o `use` da biblioteca) não escreveu. Para saber o que foi escrito, a resolução guarda os campos
  explícitos antes de aplicar os padrões da biblioteca. `auto` herdado muda o kind do passo como hoje
  (`auto` → automatic, senão owner). O passo resolvido marca a origem de cada campo (`fromProject`), que
  `flow status` e o painel mostram.
- Uma change em andamento continua com o snapshot do flow (já é assim).

## Painel

- `hooks/workflows-pane.tsx`: cartão "Este projeto" antes da lista; "Configurar" abre a edição (estado próprio
  `cfgDraft`), com a barra de rascunho, os quatro blocos do mockup e "Nos workflows".
- "Nos workflows": para cada workflow, "usa o do projeto", "tem valor próprio … (Passar a usar o do projeto)" ou
  "não tem passo de merge/deploy (Acrescentar merge e deploy)". As duas ações editam o workflow pelo mesmo caminho
  do editor de workflows (rascunho do workflow + salvar com as validações de 7.4–7.6), depois de confirmar.
- Salvar: lê o arquivo de novo, troca só `language`/`merge`/`deploy`, valida com `parseConfig`, grava; erro mostra
  e não grava.

## Arquivo local (rodada 2 do entendimento)

- Leitura: `.orquestrador/config.json` (compartilhado, se existir) e depois `.orquestrador/config.local.json`
  (local), campo a campo; o local vence. Vale para `language`, `merge` e `deploy`.
- Gravação pelo painel: sempre em `config.local.json`. Antes de gravar, se o arquivo não estiver ignorado pelo git,
  o mod acrescenta `.orquestrador/*.local.json` ao `.git/info/exclude` do clone (local, nunca commitado); sem `.git`,
  só grava.
- O painel diz "Só nesta máquina (config.local.json, fora do git)" no cartão e na barra de edição; um valor que vem
  do `config.json` compartilhado aparece como "do repositório".
