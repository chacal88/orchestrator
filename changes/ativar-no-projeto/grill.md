# Entendimento — ativar o orquestrador neste projeto

Rodadas no chat em 2026-10-22. O dono aceitou as recomendações e aprovou o mockup
(https://claude.ai/artifact/Kw3TMAVuw8dVWbfK2GemvW, prancheta "3 · Ativar e desativar neste clone").

1. **O que é local.** As configurações do plugin ficam commitadas em `.orquestrador/config.json`; o que ativa o
   plugin é local, deste clone, e nunca vai para o git. → C1: ativar grava só em `.claude/settings.local.json`.
2. **Sem ativação o plugin fica quieto.** → C2: sem a marca, nada de painel abrindo sozinho, faixa, regras na
   conversa ou recusa de merge; `/orquestrador` e `/orquestrador-workflows` seguem disponíveis. Uma change com flow
   em andamento no clone continua funcionando sem ativação, para nada parar no meio.
3. **Ligar e desligar fácil.** → C3: cartão "Este projeto" com "Ativar neste clone" / "Desativar neste clone";
   desativar tira só o que o ativar pôs, preservando o resto do arquivo; vale sem reiniciar.
4. **Nível.** → C4: "barrar" (padrão: segue o flow e recusa merge/deploy fora dele) ou "lembrar" (só o flow e as
   regras na conversa, sem bloquear); "Trocar para lembrar/barrar" no cartão ativo.
5. **Sistema do Claude.** → C5: a ativação inclui um hook `SessionStart` do Claude Code que dá ao Claude o flow e
   as regras em cada sessão. Hooks do git ficam de fora. `CLAUDE.local.md` não é usado (faria o Claude ignorar o
   `AGENTS.md` do repositório).
