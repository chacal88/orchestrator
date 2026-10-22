## 1. Configurações do projeto no config.json

- [x] 1.1 `merge` e `deploy` no `config.json`: parse e validação, problemas nomeados, tipos — cx: moderate
- [x] 1.2 Herança nos passos `merge`/`deploy`: campo não escrito no workflow vem do projeto; marca a origem; `auto` herdado decide o kind; testes (sem config, com config, valor próprio vence, change em andamento intacta) — cx: complex
- [x] 1.3 `flow status` e `flow list` dizem quando merge/deploy vêm do projeto — cx: simple

## 2. Seção "Este projeto" no painel ⚙️

- [x] 2.1 Cartão "Este projeto" no topo com o resumo (idioma, merge, deploy) e "Configurar"; etiqueta "sem passo de merge" nos cartões de workflow — cx: moderate
- [x] 2.2 Edição em rascunho: barra Salvar/Descartar/resumo; blocos Idioma, Merge, Deploy (botões que dizem o estado, seletores com explicação, rotinas com "+ rotina"/"tirar") — cx: complex
- [x] 2.3 "Nos workflows": estado de cada workflow e as ações "Acrescentar merge e deploy" e "Passar a usar o do projeto" pelo caminho do editor de workflows — cx: complex
- [x] 2.4 Salvar: só `language`/`merge`/`deploy` mudam, as outras chaves ficam; inválido não grava — cx: moderate
- [x] 2.5 Testes de harness das telas (desktop, terminal, estreito, mobile) comparando com o mockup — cx: moderate

## 3. Documentação e versão

- [ ] 3.1 README: configurações do projeto; versão 0.9.0; evidence.md — cx: simple
