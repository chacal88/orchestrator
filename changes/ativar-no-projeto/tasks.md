## 1. Ativação local

- [x] 1.1 Ler e gravar a ativação em `.claude/settings.local.json` da raiz do repositório principal: marca `env.ORQUESTRADOR` (barrar/lembrar) e hook `SessionStart` marcado; desativar tira só isso; JSON inválido não é gravado; garantir que o arquivo esteja ignorado pelo git (exclude local); testes — cx: complex
- [x] 1.2 `isActive`: marca ou flow em andamento; sem isso, sem painel automático, faixa, contexto nem recusa de merge; "lembrar" troca recusa por aviso; testes de harness (inativo, ativo barrar, ativo lembrar, inativo com flow em andamento) — cx: complex

## 2. Painel

- [x] 2.1 Cartão "Este projeto" nos três estados do mockup (inativo, confirmação com nível e "O que é gravado", ativo com "Trocar para…" e "Desativar"); testes de harness nas superfícies — cx: moderate

## 3. Documentação e versão

- [x] 3.1 README (ativar e desativar, o que é gravado, níveis), skill da coordenação (ativar antes de orquestrar), versão 0.10.0, evidence.md — cx: simple

## 4. Correções da revisão

- [ ] 4.1 `.claude/settings.local.json` protegido como a pasta de registros do mod: Edit/Write/NotebookEdit e Bash que o mencionem são recusados em qualquer modo e mesmo sem marca; só o painel grava (ativar, trocar, desativar). A escrita nos registros de portão do mod segue recusada também em "lembrar". Testes (Write, Edit, `sed -i`, `echo >`, a partir de worktree) — cx: moderate
- [ ] 4.2 "Lembrar" deixa rastro: cada recusa que vira aviso vai também para o log do flow (`logFlowRefusal`) e aparece no painel; o texto do nível "lembrar" diz que merge com `--admin`, merge sem revisão e pulo de portões deixam de ser barrados; testes de "lembrar" para merge, `start_session` e registros de portão — cx: moderate
- [ ] 4.3 `activeMode` barato: sem varrer o diretório global de flows a cada render/chamada (cache curto ou índice do checkout via `loadRun`); erros dessa leitura capturados, sem negar ferramentas em "lembrar" nem derrubar a faixa; teste — cx: moderate
- [ ] 4.4 Gravação robusta: erro de leitura ≠ arquivo ausente (recusa gravar); `SessionStart` que não é lista fica intocado (recusa com motivo); `git check-ignore` só acrescenta ao exclude com saída 1; exclude garantido antes de gravar (falha vira aviso); não regrava quando nada muda; cria `.claude/` quando falta; testes — cx: moderate
- [ ] 4.5 Testes da quietude: faixa com só a marca (sem flow); `session.start` sem marca não abre painel; `tool.check`/`prompt.submit` inativos não rastreiam; texto do hook com acentos — cx: simple
