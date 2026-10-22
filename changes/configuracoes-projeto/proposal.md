# Configurações do projeto

## Por quê

Na conferência da 0.8.2 o dono procurou "a parte que eu faço as configurações de projeto, como linguagem, auto
merge e etc." e ela não existe: o idioma só se muda editando `.orquestrador/config.json` (0.8.3), e o merge/deploy
automático só dentro do passo de cada workflow.

## O que muda

- `.orquestrador/config.json` ganha `merge` (`auto`, `branch`, `method`) e `deploy` (`auto`, `ci`, `commands`), ao
  lado do `language`. São o padrão dos passos de merge e deploy de todos os workflows do projeto; um passo com valor
  próprio no workflow vence.
- Painel ⚙️: cartão "Este projeto" no topo com o resumo e "Configurar"; edição em rascunho com idioma, merge,
  deploy e "Nos workflows" (como cada workflow fica, com "Acrescentar merge e deploy" e "Passar a usar o do
  projeto").
- `flow status` e o painel dizem quando um valor veio do projeto.

Mockup aprovado: https://claude.ai/artifact/Kw3TMAVuw8dVWbfK2GemvW. Versão 0.9.0.
