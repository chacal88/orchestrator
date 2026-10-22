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

## Fase 2 — painel ⚙️: "Este projeto", edição em rascunho, "Nos workflows"

Testes novos em `orquestrador/tests/project-pane.test.ts` (13 testes, harness do painel):
- 2.1: cartão no topo (Idioma / Merge / Deploy, pílulas "você faz", "você confirma", "automático"), nota de rodapé,
  "Configurar", sem colchetes, em desktop, terminal e mobile; resumo segue o `config.json`; valor errado nomeado;
  pílula âmbar "sem passo de merge" nos cartões de workflow.
- 2.2: rascunho com barra Descartar/Salvar, "1 mudança: merge automático ligado.", blocos IDIOMA / MERGE / DEPLOY /
  NOS WORKFLOWS em caixa alta, botões que dizem o estado, explicação sob cada campo, rotinas com "+ rotina" e
  "tirar"; nada gravado até Salvar; o rascunho sobrevive a um novo desenho; Descartar o joga fora.
- 2.3: estado de cada workflow (sem passo / usa o do projeto / valor próprio); "Acrescentar merge e deploy" e
  "Passar a usar o do projeto" pedem confirmação e gravam por `draftFile` + `takenBy` + `brokenDependents` (o mesmo
  `writeDraft` do "Salvar" do editor); arquivo que já tem o id, e workflows derivados que deixariam de resolver,
  recusam sem gravar; os valores do projeto não são copiados para o workflow.
- 2.4: Salvar muda só `language`/`merge`/`deploy`, preserva as outras chaves (inclusive chaves desconhecidas dentro
  de `merge`); arquivo inexistente é criado só com o que mudou; sem mudança nada é gravado; JSON inválido, não
  objeto, ou valor que o `parseConfig` nomearia como errado não são gravados.
- 2.5: desktop, terminal (60 e 30 colunas) e mobile (sem campos: avisa e lista as rotinas em texto).
- Lógica pura do rascunho (`configChanges`, `configText`).

Onde o painel difere do mockup, e por quê:
- Botões de estado ("Fazer o merge sozinho: sim") usam `variant="primary"` quando ligados e `secondary` quando
  desligados: o engine desenha o botão nativo, não aceita fundo azul claro próprio como no mockup.
- Separadores entre blocos são uma linha `─` (Text), não `border-top`; `Box` não tem borda só de um lado.
- Rótulos dos campos (`Input`/`Select`) são desenhados pelo próprio componente; o espaçamento e a fonte são do engine.
- A lista de métodos usa o texto já existente do editor de workflows ("Rebase: commits em linha, sem commit de
  merge"), um pouco mais longo que o do mockup, para não duplicar o dicionário.
- No mockup o Completo "usa o merge e o deploy daqui"; os workflows padrão deste plugin não têm passo de merge
  nem de deploy, então o painel mostra o Completo como "não tem passo", com "Acrescentar merge e deploy".
- "Acrescentar"/"Passar" usam os valores já salvos no `config.json`, não os do rascunho ainda aberto.

## Fase 3 — documentação e versão

- README: seção "Configurações do projeto" (config.json com exemplo, herança, painel).
- `orquestrador/.claude-plugin/plugin.json`: versão 0.9.0.
- Portões da change inteira (tipos, validação e 304 testes em 26 arquivos) rodaram depois da última edição.

## Fase 4 — Correções da revisão (coordenação)

- 4.1 `parseProjectBlocks` nomeia `deploy.ci` falso sem rotinas ("a deploy needs the CI, routines, or both") e o
  deixa de fora; o painel não salva esse rascunho. Testes em `project-config.test.ts` e `project-pane.test.ts`.
- 4.2 `isBranchName` (letras, dígitos, `. _ / -`, sem espaço, quebra de linha, `-` inicial nem `..`) no
  `config.json` e no `parseMerge`. Testes nos dois.
- Suíte: 308 pass, 0 fail.
