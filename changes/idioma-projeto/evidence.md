# Evidência: idioma por projeto

- Gate testes: `claude plugin test orquestrador` (binário 2.1.304 do app) na raiz do repo, 175 pass, 0 fail, saída 0 (após juntar a main com o 0.7.7).
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
