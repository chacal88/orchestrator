## 1. Portão de merge e teto

- [x] 1.1 `mergeWindow` em gates.ts: flow `done`/`aborted` não segura; a janela fecha no passo de arquivamento
- [x] 1.2 `mergeSelector`/`mergeTarget`/`isChangeBranch` em gates.ts e `changePrs` em model.ts: o PR é da change
      por sessão de fase, plano, nota do passo `pr` ou branch; branch ilegível falha fechado
- [x] 1.3 `refuseMerge` em register.tsx usa a janela e o PR; o `openspec archive` e `openspec/changes/` não
      desatualizam portão
- [x] 1.4 `aliveReason`/`liveSessions` em gates.ts e `finishedSessionIds` em model.ts: o teto conta só sessão com
      trabalho; a recusa diz por que cada uma conta; o painel usa a mesma regra
- [x] 1.5 Testes de harness: merge depois do flow concluído passa; PR sem relação passa com o flow rodando (na
      coordenadora e numa sessão aberta por ela); o merge da change continua barrado com portões pendentes (plano,
      PR ligado, nota, branch, gh fora do ar, branch atual); o PR do arquivamento não fica `stale`; o teto ignora
      sessões terminadas e diz por que conta cada uma
- [x] 1.6 Skill: janela e regra do PR dos `finalGates`, nota do `report pr` com `#N`, definição de "viva"
- [x] 1.7 Versão 0.7.7
