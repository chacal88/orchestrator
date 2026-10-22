# Evidência: idioma por projeto

- Gate testes: `claude plugin test orquestrador` (binário 2.1.304 do app) na raiz do repo, 259 pass, 0 fail, saída 0 (após juntar a main com as fases por projeto, 0.8.0).
  Os 10 testes novos ficam em `orquestrador/tests/language.test.ts`.
- Gate lint/tipos: `tsc` 5.6.3 sobre hooks, types e tests com os tipos do engine, sem erros.
- `claude plugin validate orquestrador`: Validation passed.
- O teste de harness monta o painel com `{ "language": { "ui": "en", "content": "pt-BR" } }`:
  - caixas em inglês: "Needs you", "Tasks", "This session";
  - passos e botões em inglês: "▶ ✋ Understanding", "Understanding settled";
  - a descrição do passo em português;
  - o texto da fase como a coordenação escreveu;
  - a faixa: "step: Understanding · 1 phase in flight".
- Sem o arquivo, o painel continua em português. Com `"language": "fr"`, ele avisa
  `config.json: language must be pt-BR or en` e fica em português.
- Não verificado: o painel no app desktop real (só no harness de testes).
- Depois de juntar com as fases por projeto, um flow derivado (`base` + `override`) mantém as traduções
  do flow base, e o `override` de um título vale por cima delas (teste em `language.test.ts`).
- O painel ⚙️ Workflows segue `ui` (cerca de 195 textos em `hooks/i18n-workflows.ts`). Os títulos de flows e
  passos seguem `ui`; descrições e `details` seguem `content`. Os passos da biblioteca e as `details` dos flows
  padrão vêm nos dois idiomas, e um rascunho salvo mantém as traduções dos passos
  (testes em `workflows-language.test.ts` e `language.test.ts`).
- Gate testes depois disso: 273 pass, 0 fail. `tsc`: só os erros de `size`/`weight` em `workflows-pane.tsx`,
  que já existiam na main, porque os tipos locais são anteriores ao engine.
- Ainda só em um idioma: o título do próprio rascunho no editor (é gravado como texto simples) e os erros que
  o resolvedor de flows e a biblioteca devolvem, em inglês.
