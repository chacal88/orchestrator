# Evidência — plugin público

## Empacotamento

Commit d001b22: plugin com a skill, README, LICENSE e manifestos; `claude plugin validate` sem avisos; 137 testes passando.

## Instalação local

- 2.1: `marketplace remove mods-local` (desinstalou orquestrador@mods-local), `marketplace add ~/.claude/mods-local` (nome "orquestrador") e `install orquestrador@orquestrador --scope user`; `plugin list` mostra orquestrador@orquestrador 0.7.0, scope user, ✔ enabled, lido de ~/.claude/mods-local/orquestrador, e nenhum "mods-local".
- 2.2: cópia em ~/.claude/skills-backup/change-orchestrator-2026-10-15 (`diff -r` sem diferenças, só SKILL.md); ~/.claude/skills/change-orchestrator removida; a skill segue em orquestrador:change-orchestrator.
- Gate testes: `claude plugin test orquestrador` na raiz do repo, 137 pass, 0 fail, saída 0. A fase só fechou depois que a sessão da fase, recarregada com o mod 0.7.2, rodou o gate de novo (141 pass).

## Defeitos achados na rodada (tarefas 4.18 e 4.19 do mod)

- 4.18 (0.7.1, commit 672442a): uma fase na mesma pasta da coordenação não conseguia provar o gate. Testes "a phase sharing the coordinator's folder proves its gate by its own session id" e "each session publishes its activity under its own id" falham antes da correção e passam depois; 140 pass.
- 4.19 (0.7.2, commit ca8e792): o pulo do dono pelo painel não chegava ao arquivo de gates. O teste "the owner skips a phase gate from the Gates card while the loop runs" passou já antes da correção, então o mecanismo funcionava; as causas corrigidas são o botão de confirmar cortado no painel estreito (agora numa linha própria) e o retorno silencioso quando o painel ainda não tinha a change (agora um aviso); 141 pass.

## Correções da revisão (fase 3)

- 3.1: os arquivos de atividade por sessão não são apagados (o `$.fs` do mod não apaga), então o painel deixa de ler os que estão parados há mais de 7 dias, pela data da listagem. Teste "an activity file untouched for a week is no longer read": falha com o prazo desligado (141 pass, 1 fail) e passa com ele (142 pass).
- 3.2: esta evidência atualizada; versão 0.7.3.
- 3.3: ajustes menores: ordem dos comentários de `restoreActivity`, comentário no limite de 50 da família, nome `ownId` no lugar do `selfId` que escondia a função. O aviso de "painel ainda não carregou" não tem teste: o painel só mostra o botão de pular quando já tem a change, então o ramo é só defensivo.
