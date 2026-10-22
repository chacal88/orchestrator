## 1. Formato do workflow

- [x] 1.1 Tipos: `details`, `agent`, `model`, `effort` no passo; `merge` e `deploy`; workflow derivado (`base`, `remove`, `add`, `override`, `order`) — cx: moderate
- [x] 1.2 `parseFlow` aceita e valida os campos novos (agent só em session/loop; merge/deploy coerentes com o kind) — cx: moderate
- [x] 1.3 `resolveFlow`: base → remove (religando outcomes) → add (depois de `after`) → override → order → `parseFlow`; erros de ciclo, `executar` removido, `after` inexistente — com testes de cada caso — cx: complex
- [x] 1.4 Biblioteca de passos (`revisao-pr`, `merge`, `deploy` + os dos padrões) e `details`/agente nos passos de `completo` e `rapido`, sem mudar ids nem ordem — cx: moderate
- [x] 1.5 `loadFlows` resolve os derivados (projeto pode derivar de padrão ou de outro do projeto) e junta os erros — cx: moderate

## 2. Merge e deploy

- [ ] 2.1 Merge `auto: false` vira passo do dono com detect `gh pr merge`; `auto: true` vira automático com `gh pr merge` — teste — cx: moderate
- [ ] 2.2 Recusa de `gh pr merge` antes da `revisao-pr` respondida e com `--admin` (somada aos portões finais que já existem) — teste de harness — cx: complex
- [ ] 2.3 Deploy: sub-estados `ci` e `commands` no registro do passo; avança só com todos; `auto` decide se a coordenação segue sozinha — testes — cx: complex
- [ ] 2.4 Comandos de deploy entram no detect de `producao` quando o workflow tem os dois — teste — cx: simple

## 3. Agentes e coordenação

- [ ] 3.1 Agentes do plugin em `orquestrador/agents/`: planejador, revisor-plano, revisor-codigo, abre-pr, publicador, merge, deploy — cx: moderate
- [ ] 3.2 Agente do projeto em `.orquestrador/agents/<nome>.md` vence o do plugin; `flow status` diz agente (com caminho), modelo, esforço e details do passo atual — teste — cx: moderate
- [ ] 3.3 `flow list` com título, descrição, origem e sequência de passos — teste — cx: simple
- [ ] 3.4 Skill: mostrar sempre as opções de workflow antes do `flow start`; despachar passo de sessão com o agente, modelo e esforço do passo; merge/deploy automáticos (conferir aprovação e CI, nunca `--admin`) — cx: simple

## 4. Painel ⚙️ Workflows

- [ ] 4.1 Comando `/orquestrador-workflows` e pane `orquestrador-workflows` separado do 🧭, abrir/fechar — teste de harness — cx: moderate
- [ ] 4.2 Visão: lista de workflows com origem e erros; passos de um workflow com toda a configuração — teste — cx: moderate
- [ ] 4.3 Edição: novo (do zero / a partir de), ligar/desligar, acrescentar da biblioteca ou novo, reordenar, ajustar agente/modelo/esforço/merge/deploy — teste de harness — cx: complex
- [ ] 4.4 Salvar: resolve antes de gravar; erro mostrado sem gravar; grava formato derivado; editar padrão cria o do projeto com aviso; change em andamento não muda — testes — cx: complex

## 5. Documentação e versão

- [ ] 5.1 README: workflows do projeto (derivado, biblioteca, merge/deploy automáticos, agentes) e o painel ⚙️ — cx: simple
- [ ] 5.2 Versão 0.8.0 e evidence.md — cx: simple
