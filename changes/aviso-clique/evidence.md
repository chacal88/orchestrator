# Evidência — aviso do clique

## Testes

- Gate testes: `claude plugin test orquestrador` (binário 2.1.295 do app) na raiz do repo, 143 pass, 0 fail, saída 0.
- Teste novo "an owner press shows a toast naming the answer recorded and the next step" (tests/flow-harness.test.ts):
  aperta `flow:qa:aprovado` e espera exatamente "Registrado: Instalei e funciona. Próximo passo: Lançar a versão.";
  depois aperta o último passo e espera "Registrado: Lancei. Flow concluído.". Antes da correção o caminho de
  sucesso do `pressFlow` não chamava `$.ui.toast`, então a lista de avisos ficaria vazia.

## Decisão do dono

- Avisar a sessão coordenadora com mensagem automática? Resposta: "Só o toast (Recomendado)".

## README

- `/plugin install orquestrador --marketplace chacal88/orquestrador` trocado por `/plugin marketplace add chacal88/orquestrador`
  e `/plugin install orquestrador@orquestrador`.
