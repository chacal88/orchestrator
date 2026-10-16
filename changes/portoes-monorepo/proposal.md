# Portões em monorepo

## Por quê

Na change `manual-homologation-fixes-wave-1` (psim-kernel, 0.7.4), a fase 2 rodou os portões três vezes com
saída 0, e o `flow close` recusou as três vezes com "testes not run; lint not run". Os arquivos de atividade
mostram cada sessão publicando no próprio id e no próprio cwd. A hipótese de `$.state` compartilhado entre
sessões não se confirmou: o arquivo da fase 2 tem `gates: {}`. As causas reais:

- Rodadas 1 e 2: `pnpm turbo lint --filter=…` e `pnpm --filter <pkg> test` não casavam os padrões, que exigiam
  o script logo depois do gerenciador.
- Rodada 3: `vitest` e `prettier --check` casavam, mas o comando terminava em `grep … | head`, e o pipe mascara
  o código de saída.
- As três rodadas usavam `cmd >log 2>&1; echo x=$?`. Com `;`, o código de saída é o do `echo`. O 0.7.4 ignorava
  isso e daria o portão por passado se o padrão tivesse casado.
- A fase 3 e os portões finais mostravam o mesmo `prettier --check`. Isso é o `familyCheck`: os portões
  finais valem pela última execução de qualquer sessão da família, e uma edição em qualquer sessão os
  desatualiza.
- O dono aceitou pelo painel "liberar os portões da fase 2". "Aceitar" só manda mensagem ao coordenador e não
  pula nada.

## O que muda

- `testes` e `lint` aceitam flags entre o gerenciador e o script (`pnpm --filter X test`, `pnpm -F X lint`,
  `pnpm -r test`, `yarn workspace X test`) e tarefas do turbo (`turbo test`, `turbo run build lint`).
- O código de saída só prova o portão quando é dele: `;`, `&` ou um pipe depois do passo do portão e qualquer
  `||` na mesma lista o mascaram; `&&` depois dele, `set -e` e `pipefail` não. O flow automático segue a
  mesma regra.
- A sessão guarda os últimos 5 comandos que pareciam portão e não contaram, com o motivo. A recusa de fechar
  fase os cita, e diz para rodar o portão como comando próprio.
- `ownerQuestions` aceita `gate: {phase, gate}` (`phase: "final"` para os finais). O painel oferece o pulo na
  própria pergunta, com dois toques, e a pergunta sai da lista quando o portão passa ou é pulado. Uma pergunta
  de pulo sem `gate` não oferece "Aceitar"; ela aponta o Pular ao lado do portão.
- Não muda: só o dono pula portão, e a pasta de dados do mod continua escrita só pelo mod.
- Versão 0.7.5.
