# Portão de merge só da change, teto só com trabalho vivo

## Por quê

Em 2026-10-22, no `representante-digital` (change `checkout-company-customer-cnpj`, mod 0.7.6), o plano publicado
tinha `finalGates: ["check", "openspec"]`. O flow chegou a `arquivar`, o `openspec archive` rodou e `flow status`
passou a dizer `finished`. Mesmo assim:

- A sessão coordenadora rodou `gh pr merge 805`, um PR só de documentação em `openspec/specs/product-feed/spec.md`,
  sem relação com a change. O mod recusou com `final gates of checkout-company-customer-cnpj not passed: check
  (stale), openspec (stale)`.
- A sessão que a coordenadora abriu para fazer esse PR levou a mesma recusa e ficou esperando o dono.
- A coordenadora teve de rodar `check.sh` e `openspec validate` de novo para satisfazer os portões de uma change que
  já não existia.
- O PR do próprio arquivamento (#801) foi barrado uma vez por portões `stale` logo depois do `openspec archive`,
  porque arquivar move a pasta da change.
- O `start_session` foi recusado com "3 phase sessions are alive (…); the ceiling is 3". Duas das três sessões já
  tinham terminado, com os PRs mergeados (chacal88/orquestrador#3 e um PR do catálogo). O dono teve de
  arquivá-las à mão antes de abrir outra.

No código: o `refuseMerge` olhava só se havia um plano para a pasta da sessão; não lia o flow nem qual PR era
mergeado. O `liveSessions` contava toda sessão iniciada pela coordenação e não arquivada.

## Decisão do dono

Pedido do dono em 2026-10-22: uma change cujo flow terminou não segura mais `gh pr merge`, nem de PRs sem relação,
nem na coordenadora nem nas sessões que ela abre; e o teto de sessões de fase não conta trabalho terminado.

## O que muda

### Portão de merge

Os `finalGates` de uma change seguram um `gh pr merge` só quando as duas condições valem:

1. **Janela do flow.** O flow da change roda (`running` ou `escalated`) e o passo atual vem antes do passo de
   arquivamento (o que tem `cleanup` ou roda `openspec archive`). Flow `done` ou `aborted` não segura nada. Sem
   flow iniciado (só plano publicado), a janela fica aberta, como antes.
2. **PR da change.** O PR mergeado é o da própria change:
   - o número dele está ligado a uma sessão de fase do plano (`prNumber` da sessão), está no `pr` de uma
     `ownerQuestion` do plano, ou é citado (`#N` ou `/pull/N`) na nota do passo `pr`/`merge` do flow; ou
   - a branch de origem (`headRefName`) é a de uma sessão de fase, ou contém o id da change.

   A branch vem do próprio comando quando ele nomeia uma branch; de `git branch --show-current` quando não nomeia
   PR nenhum (o `gh` mergeia o PR da branch atual); e de `gh pr view <n> --json headRefName` quando nomeia número
   ou URL. Se a branch não pode ser lida (gh fora do ar, PR inexistente), o merge conta como da change: o portão
   falha fechado.

### Por que essa regra

- **Por que a janela termina antes de `arquivar`, e não no passo `pr`.** O PR da change é aberto no passo `pr`, mas
  mergeado depois: o QA testa o PR e a produção sobe o merge. Fechar a janela em `pr` deixaria o merge da própria
  change sem portão. A partir de `arquivar`, o único PR que resta é o do arquivamento, que só move a pasta da
  change e aplica os deltas de spec.
- **Por que número e branch, e não só um deles.** O número cobre o caso comum (`gh pr merge 801`) sem rede quando a
  sessão de fase ou o plano já o conhece. A branch cobre o PR que a coordenação abriu ela mesma e o `gh pr merge`
  sem argumento. O id da change no nome da branch é a convenção das sessões da skill (`claude/<slug>`) e de quem
  cria branch à mão.
- **Por que não contar a família inteira.** A sessão que fez o PR #805 era filha da coordenadora. Contar todo PR da
  família como da change repetiria o incidente; só as sessões ligadas a uma fase do plano contam.
- **Por que falhar fechado.** Um merge que o mod não consegue situar pode ser o da change; o custo de segurar é uma
  mensagem, e o de soltar é um merge sem portão. Sem rede o `gh pr merge` também falharia.

### Arquivamento não desatualiza portão

O `openspec archive` não marca edição de código, e arquivos dentro de `openspec/changes/` (o `.openspec.yaml` ao
lado da proposta) também não. Com flow, a janela já fecha em `arquivar`; sem flow, isso evita o `stale` do PR de
arquivamento.

### Teto de sessões de fase

"Viva", para o teto, é a sessão iniciada pela coordenação, fora da pasta dela, não arquivada, **com trabalho**:
rodando agora, esperando o dono (pergunta ou permissão) ou com tarefa aberta na lista que ela publica. Não conta:

- a sessão de uma fase fechada pelo loop ou marcada `done` no plano;
- toda sessão de fase de uma change cujo flow está `done` ou `aborted`;
- a sessão cujo PR está `MERGED` ou `CLOSED`;
- a sessão parada sem tarefa aberta.

A recusa diz por que cada sessão contada conta, por exemplo
`3 phase sessions are alive: fase-a (running now), perguntando (waiting on the owner (question)), pendente (2 open
tasks in its list); the ceiling is 3.` O painel usa a mesma regra no "Sessões trabalhando agora".

### Também

- Skill: descreve a janela e a regra do PR dos `finalGates`, pede a nota do `report pr` citando `#N`, e define
  "viva" para o teto.
- Versão 0.7.7.

## Fora do escopo

- Os portões de fase (fechar fase, arquivar sessão) não mudam.
- Só o dono pula portão, pelo painel; a pasta de dados do mod continua escrita só pelo mod.
