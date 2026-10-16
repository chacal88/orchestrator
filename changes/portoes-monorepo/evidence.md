# Evidência

- Diagnóstico: os arquivos de atividade das três sessões da change `manual-homologation-fixes-wave-1` têm cada
  um o próprio `sessionId` e o próprio `cwd`; o da fase 2 tem `gates: {}`. A transcrição da fase 2 mostra os
  comandos das três rodadas: `pnpm turbo lint --filter=…` e `pnpm --filter <pkg> test` (sem casar), depois
  `pnpm --filter … exec vitest run >log 2>&1; echo ui=$?; … | head` (mascarado pelo pipe).
- Gate testes: `claude plugin test orquestrador` (binário 2.1.299 do app) na raiz do repo, 151 pass, 0 fail, saída 0.
- Gate lint/tipos: `tsc` 5.6.3 sobre hooks, types e tests com os tipos do engine 2.1.299, sem erros.
- `claude plugin validate orquestrador`: passou; `orquestrador.tried` aparece nas leituras e escritas de estado.
