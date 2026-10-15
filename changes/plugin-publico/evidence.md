# Evidência — plugin público

## Empacotamento

Commit d001b22: plugin com a skill, README, LICENSE e manifestos; `claude plugin validate` sem avisos; 137 testes passando.

## Instalação local

- 2.1: `marketplace remove mods-local` (desinstalou orquestrador@mods-local), `marketplace add ~/.claude/mods-local` (nome "orquestrador") e `install orquestrador@orquestrador --scope user`; `plugin list` mostra orquestrador@orquestrador 0.7.0, scope user, ✔ enabled, lido de ~/.claude/mods-local/orquestrador, e nenhum "mods-local".
- 2.2: cópia em ~/.claude/skills-backup/change-orchestrator-2026-10-15 (`diff -r` sem diferenças, só SKILL.md); ~/.claude/skills/change-orchestrator removida; a skill segue em orquestrador:change-orchestrator.
- Gate testes: `claude plugin test orquestrador` na raiz do repo, 137 pass, 0 fail, saída 0.
