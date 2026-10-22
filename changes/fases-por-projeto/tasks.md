## 1. Formato do workflow

- [x] 1.1 Tipos: `details`, `agent`, `model`, `effort` no passo; `merge` e `deploy`; workflow derivado (`base`, `remove`, `add`, `override`, `order`) — cx: moderate
- [x] 1.2 `parseFlow` aceita e valida os campos novos (agent só em session/loop; merge/deploy coerentes com o kind) — cx: moderate
- [x] 1.3 `resolveFlow`: base → remove (religando outcomes) → add (depois de `after`) → override → order → `parseFlow`; erros de ciclo, `executar` removido, `after` inexistente — com testes de cada caso — cx: complex
- [x] 1.4 Biblioteca de passos (`revisao-pr`, `merge`, `deploy` + os dos padrões) e `details`/agente nos passos de `completo` e `rapido`, sem mudar ids nem ordem — cx: moderate
- [x] 1.5 `loadFlows` resolve os derivados (projeto pode derivar de padrão ou de outro do projeto) e junta os erros — cx: moderate

## 2. Merge e deploy

- [x] 2.1 Merge `auto: false` vira passo do dono com detect `gh pr merge`; `auto: true` vira automático com `gh pr merge` — teste — cx: moderate
- [x] 2.2 Recusa de `gh pr merge` antes da `revisao-pr` respondida e com `--admin` (somada aos portões finais que já existem) — teste de harness — cx: complex
- [x] 2.3 Deploy: sub-estados `ci` e `commands` no registro do passo; avança só com todos; `auto` decide se a coordenação segue sozinha — testes — cx: complex
- [x] 2.4 Comandos de deploy entram no detect de `producao` quando o workflow tem os dois — teste — cx: simple

## 3. Agentes e coordenação

- [x] 3.1 Agentes do plugin em `orquestrador/agents/`: planejador, revisor-plano, executor, revisor-codigo, abre-pr, publicador, merge, deploy — cx: moderate
- [x] 3.2 Agente do projeto em `.orquestrador/agents/<nome>.md` vence o do plugin; `flow status` diz agente (com caminho), modelo, esforço e details do passo atual — teste — cx: moderate
- [x] 3.3 `flow list` com título, descrição, origem e sequência de passos — teste — cx: simple
- [x] 3.4 Skill: mostrar sempre as opções de workflow antes do `flow start`; despachar passo de sessão com o agente, modelo e esforço do passo; merge/deploy automáticos (conferir aprovação e CI, nunca `--admin`) — cx: simple

## 4. Painel ⚙️ Workflows

- [x] 4.1 Comando `/orquestrador-workflows` e pane `orquestrador-workflows` separado do 🧭, abrir/fechar — teste de harness — cx: moderate
- [x] 4.2 Visão: lista de workflows com origem e erros; passos de um workflow com toda a configuração — teste — cx: moderate
- [x] 4.3 Edição: novo (do zero / a partir de), ligar/desligar, acrescentar da biblioteca ou novo, reordenar, ajustar agente/modelo/esforço/merge/deploy — teste de harness — cx: complex
- [x] 4.4 Salvar: resolve antes de gravar; erro mostrado sem gravar; grava formato derivado; editar padrão cria o do projeto com aviso; change em andamento não muda — testes — cx: complex

## 5. Documentação e versão

- [x] 5.1 README: workflows do projeto (derivado, biblioteca, merge/deploy automáticos, agentes) e o painel ⚙️ — cx: simple
- [x] 5.2 Versão 0.8.0 e evidence.md — cx: simple

## 6. Correções da revisão — merge seguro

- [x] 6.1 `--admin` recusado sobre o texto bruto do comando: entre aspas, dentro de `bash -c`/`sh -c`/`eval`, depois de continuação de linha (`\` + quebra) e vindo de variável (`$`) num comando de merge; um teste por forma — cx: complex
- [x] 6.2 As outras formas de merge passam pela mesma recusa (revisão do PR pendente, portões finais, `--admin`): flags globais antes de `pr` (`gh -R o/r pr merge`), `gh api` com `pulls/<n>/merge` ou `mergePullRequest`; teste de cada uma. `git merge` + `git push` na branch protegida fica com a proteção do GitHub (registrar no evidence.md) — cx: complex
- [x] 6.3 Nome de agente validado (`^[a-z0-9]+(-[a-z0-9]+)*$`) no `parseFlow` e no `findAgent`; teste com `../x` — cx: simple
- [x] 6.4 Skill: as recusas de `--admin` e de merge sem revisão já existem (verbo no presente) — cx: simple

## 7. Correções da revisão — deploy e painel

- [x] 7.1 Workflow derivado recalcula o detect de `producao`: sem as rotinas de um deploy removido, e só as rotinas atuais quando `deploy.commands` muda; testes com `remove: ['deploy']` e com override de `commands` — cx: moderate
- [x] 7.2 Deploy do dono só com rotinas tem saída no painel (botão do dono "Deploy concluído"); teste de que o dono sai desse estado — cx: moderate
- [x] 7.3 Um `gh run watch|view --exit-status` que falha só derruba o deploy quando o passo espera o CI e ele ainda não foi confirmado; testes com `ci: false` e depois do CI confirmado — cx: moderate
- [x] 7.4 Painel ⚙️: criar ou salvar não sobrescreve um arquivo de `.orquestrador/flows/` com o mesmo id ou nome, válido ou quebrado; a recusa nomeia o arquivo; teste — cx: moderate
- [x] 7.5 Salvar resolve também os workflows do projeto que derivam do salvo; se algum deixar de resolver, recusa e lista quais; teste — cx: moderate
- [x] 7.6 Guarda final do `draftFile` compara também os campos editáveis (agente, modelo, esforço, merge, deploy, details); edição própria do detect de `producao` avisa em vez de sumir — cx: simple

## 8. Correções da 2ª revisão

- [x] 8.1 Guarda de merge falha fechada: quando o texto bruto tem `gh` e `merge` como palavras e o mod não extrai a chamada (wrapper como `xargs`, `find -exec`, `timeout`, `nice`, `env -u`, `sudo -u`, `command -p`; script por heredoc ou pipe para um shell; executável dinâmico `$G`/`"$(command -v gh)"`), recusa dizendo que não consegue ver o merge; `echo`/`printf`/`cat`/`git commit` citando o comando seguem livres; testes de cada forma — cx: moderate
- [x] 8.2 Deploy do dono com CI e rotinas: depois de "Deploy do CI concluído", restando só rotinas, o dono tem o botão "Deploy concluído"; teste — cx: simple

## 9. Correções da 3ª revisão

- [ ] 9.1 Merge escondido avaliado por comando: um comando que não é `gh` lido nem inerte e cita `gh` e `merge` é recusado mesmo com outro merge legível na mesma linha (`gh pr merge 6 --squash && xargs gh pr merge --admin`); teste — cx: simple
- [ ] 9.2 `git` sai dos inertes: `git -c alias.*=!…`, `git rebase --exec`/`-x`, `git filter-branch --*-filter`/`--exec` e `git bisect run` com `gh` e `merge` são recusados; `git commit/log/diff/status/add/push` seguem livres; teste — cx: simple
