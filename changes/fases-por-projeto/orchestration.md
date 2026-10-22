# Orquestração — fases-por-projeto

Coordenação: sessão `🧭 fases-por-projeto: coordenação`, branch `claude/orchestrator-phases-automation-f69f0d`.
Flow `rapido` (plugin). Estado: `executar`. Fases 1, 2 e 3a juntadas na coordenação (207 testes). Fase 2 fechada. Fase 1 espera o pulo do lint; fase 3a espera nova rodada do revisor de regras. Próxima: 3b.

| Onda | Fase | Ícone | Tarefas | Sessão | Branch | Estado | Próximo passo |
| ---- | ---- | ----- | ------- | ------ | ------ | ------ | ------------- |
| 1 | 1 Formato do workflow | 🛠️ | 1.1–1.5 | fpp-formato (`local_a7fcf568`) | claude/fpp-formato-24fee1 | entregue, juntada | fechar após pulo do lint |
| 2 | 2 Merge e deploy | 🛠️ | 2.1–2.4 | fases-por-projeto-merge (`local_acda78c8`) | claude/cool-ardinghelli-20969e | fechada, juntada | — |
| 2 | 3a Agentes e skill | 🏷️ | 3.1, 3.4 | fpp-agentes (`local_e6a8496d`) | claude/fpp-agentes-4d2c94 | entregue, juntada | fechar após revisor de regras aprovar |
| 3 | 3b Agente no status e flow list | 🛠️ | 3.2, 3.3 | — | — | pendente | depois da 2 |
| 4 | 4 Painel ⚙️ Workflows | 🛠️ | 4.1–4.4 | — | — | pendente | depois da 3 |
| 5 | 5 Docs e versão | 📖 | 5.1–5.2 | — | — | pendente | depois da 4 |
