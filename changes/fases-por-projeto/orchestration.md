# Orquestração — fases-por-projeto

Coordenação: sessão `🧭 fases-por-projeto: coordenação`, branch `claude/orchestrator-phases-automation-f69f0d`.
Flow `rapido` (plugin). Estado: `qa` (conferência do dono). PR https://github.com/chacal88/orquestrador/pull/5 aberto; depois: lançar a versão (gh release create).

| Onda | Fase | Ícone | Tarefas | Sessão | Branch | Estado | Próximo passo |
| ---- | ---- | ----- | ------- | ------ | ------ | ------ | ------------- |
| 1 | 1 Formato do workflow | 🛠️ | 1.1–1.5 | fpp-formato (`local_a7fcf568`) | claude/fpp-formato-24fee1 | fechada | — |
| 2 | 2 Merge e deploy | 🛠️ | 2.1–2.4 | fases-por-projeto-merge (`local_acda78c8`) | claude/cool-ardinghelli-20969e | fechada, juntada | — |
| 2 | 3a Agentes e skill | 🏷️ | 3.1, 3.4 | fpp-agentes (`local_e6a8496d`) | claude/fpp-agentes-4d2c94 | fechada | — |
| 3 | 3b Agente no status e flow list | 🛠️ | 3.2, 3.3 | fpp-status (`local_af87f5b1`) | claude/fpp-status-a1712a | fechada | — |
| 4 | 4 Painel ⚙️ Workflows | 🛠️ | 4.1–4.4 | fpp-painel (`local_cf513282`) | claude/fpp-painel-a13e98 | fechada | — |
| 5 | 5 Docs e versão | 📖 | 5.1–5.2 | coordenação | esta branch (12d22d3) | fechada | — |
| 6 | 6 Merge seguro | 🛠️ | 6.1–6.4 | fpp-merge-seguro (`local_33be0dd7`) | claude/fpp-merge-seguro-e21dc5 | fechada | — |
| 6 | 7 Deploy e painel | 🛠️ | 7.1–7.6 | fpp-deploy-painel (`local_93970253`) | claude/fpp-deploy-painel-837674 | fechada | — |
| 8 | 9 Merge escondido e git | 🛠️ | 9.1–9.2 | coordenação | esta branch (d1952c3) | fechada | — |

## Encerramento (2026-10-22)

Flow concluído: release v0.8.2 (https://github.com/chacal88/orquestrador/releases/tag/v0.8.2), PRs #5, #6 e #7 na `main`.
- Fases 1–5: formato, merge/deploy, agentes e skill, agente no status, painel ⚙️, docs (0.8.0).
- Fases 6–9: três rodadas de correção da revisão de segurança e qualidade (merge seguro, deploy e painel).
- Fases 10–11: painel ⚙️ refeito pelo mockup aprovado e ajustado na 2ª conferência (0.8.1, 0.8.2).
- Portões pulados pelo dono: lint da fase 1, regras da 3a. Risco residual aceito: ver evidence.md.
- Pendente fora desta change: PR #2 (idioma por projeto) e uma seção "Projeto" no painel ⚙️.
