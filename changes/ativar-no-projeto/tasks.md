## 1. Ativação local

- [x] 1.1 Ler e gravar a ativação em `.claude/settings.local.json` da raiz do repositório principal: marca `env.ORQUESTRADOR` (barrar/lembrar) e hook `SessionStart` marcado; desativar tira só isso; JSON inválido não é gravado; garantir que o arquivo esteja ignorado pelo git (exclude local); testes — cx: complex
- [x] 1.2 `isActive`: marca ou flow em andamento; sem isso, sem painel automático, faixa, contexto nem recusa de merge; "lembrar" troca recusa por aviso; testes de harness (inativo, ativo barrar, ativo lembrar, inativo com flow em andamento) — cx: complex

## 2. Painel

- [x] 2.1 Cartão "Este projeto" nos três estados do mockup (inativo, confirmação com nível e "O que é gravado", ativo com "Trocar para…" e "Desativar"); testes de harness nas superfícies — cx: moderate

## 3. Documentação e versão

- [x] 3.1 README (ativar e desativar, o que é gravado, níveis), skill da coordenação (ativar antes de orquestrar), versão 0.10.0, evidence.md — cx: simple

## 4. Correções da revisão

- [x] 4.1 `.claude/settings.local.json` protegido como a pasta de registros do mod: Edit/Write/NotebookEdit e Bash que o mencionem são recusados em qualquer modo e mesmo sem marca; só o painel grava (ativar, trocar, desativar). A escrita nos registros de portão do mod segue recusada também em "lembrar". Testes (Write, Edit, `sed -i`, `echo >`, a partir de worktree) — cx: moderate
- [x] 4.2 "Lembrar" deixa rastro: cada recusa que vira aviso vai também para o log do flow (`logFlowRefusal`) e aparece no painel; o texto do nível "lembrar" diz que merge com `--admin`, merge sem revisão e pulo de portões deixam de ser barrados; testes de "lembrar" para merge, `start_session` e registros de portão — cx: moderate
- [x] 4.3 `activeMode` barato: sem varrer o diretório global de flows a cada render/chamada (cache curto ou índice do checkout via `loadRun`); erros dessa leitura capturados, sem negar ferramentas em "lembrar" nem derrubar a faixa; teste — cx: moderate
- [x] 4.4 Gravação robusta: erro de leitura ≠ arquivo ausente (recusa gravar); `SessionStart` que não é lista fica intocado (recusa com motivo); `git check-ignore` só acrescenta ao exclude com saída 1; exclude garantido antes de gravar (falha vira aviso); não regrava quando nada muda; cria `.claude/` quando falta; testes — cx: moderate
- [x] 4.5 Testes da quietude: faixa com só a marca (sem flow); `session.start` sem marca não abre painel; `tool.check`/`prompt.submit` inativos não rastreiam; texto do hook com acentos — cx: simple

## 5. Correções da 2ª revisão

- [x] 5.1 O nível vale como o painel gravou, não como o arquivo diz: ao ativar/trocar/desativar, o painel guarda no estado do mod (que nenhuma ferramenta do modelo grava) o nível que escreveu para aquele repositório. Ao ler, uma marca que rebaixa ("lembrar") sem esse registro, ou diferente dele, vale como "barrar" e o painel avisa "a ativação foi mudada fora do painel — confirme por aqui"; uma marca "barrar" sem registro vale (é o mais rígido). Testes: marca "lembrar" escrita à mão com flow em andamento continua barrando; trocar pelo painel funciona; desativar pelo painel e a marca reaparecer escrita à mão vale como "barrar" — cx: complex
- [x] 5.2 A proteção por texto do `settings.local.json` só vale com o mod ativo (marca ou flow em andamento): num clone inativo o arquivo é livre, como antes; comparação sem diferenciar maiúsculas. Testes: Edit no clone inativo passa; no ativo é recusado — cx: simple
- [x] 5.3 `activeMode` falha fechado: erro ao ler a marca ou os flows com marca presente ou flow já conhecido vale "barrar"; só a ausência confirmada de marca e de flow deixa quieto. Teste — cx: simple
- [x] 5.4 README e texto do painel: "barrar" é um freio do mod, não uma barreira; a trava de verdade é a proteção de branch do GitHub; um hook posto pelo modelo em outro arquivo de settings fica fora do alcance do mod — cx: simple

## 6. Correção da 3ª revisão

- [ ] 6.1 O registro do nível gravado pelo painel sobrevive a reinício: fica num arquivo da pasta de registros do mod (a mesma que já é protegida), por raiz do repositório, e é lido de lá; o hook `SessionStart` e o comportamento dizem o mesmo nível. Testes: estado limpo + registro em disco + arquivo com "lembrar" vale "lembrar" sem aviso; marca apagada depois de um reinício vale "barrar" com aviso — cx: simple
