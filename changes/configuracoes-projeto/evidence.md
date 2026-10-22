# Evidência — configurações do projeto

## Fase 1 — config.json: merge e deploy, herança, flow status/list

Testes novos em `orquestrador/tests/project-config.test.ts` (15 testes):
- 1.1: bloco válido, campos opcionais, valor errado ou chave desconhecida nomeados e deixados de fora.
- 1.2: sem config nada muda; campo não escrito vem do projeto e fica marcado em `fromProject`; `auto` do projeto
  decide o kind (automatic/owner) nos passos da biblioteca; valor escrito vence; passo escrito à mão mantém o kind;
  workflow derivado herda pela base; change em andamento mantém o snapshot do flow.
- 1.3: `describeFlow` ("From the project's settings (not the workflow): ...") e `describeWorkflow`
  ("merge automático — do projeto: auto"); `flow list`/`flow start` lendo o `config.json` do checkout.
- Editor: salvar não grava valores do projeto nem `fromProject`; alterar um campo o torna do passo;
  `useProjectValues` ("Passar a usar o do projeto") devolve ao projeto.
Ajuste de expectativa pedido pela tarefa: `parseConfig(undefined)` em `language.test.ts` agora inclui `project`.
Os demais testes existentes passam sem alteração.

Limite conhecido: os padrões da própria biblioteca (branch main, squash...) que o projeto não define continuam
gravados no arquivo do workflow, como antes; só o que o projeto define deixa de ser gravado.
