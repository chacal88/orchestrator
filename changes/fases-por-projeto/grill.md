# Entendimento — fases por projeto

Rodadas feitas no chat em 2026-10-22: o flow `rapido` deste repositório não tem passo de grill. Cada resposta
vira um critério de aceite.

## Rodada 1

1. **O que é "fase".** São os passos do workflow (entendimento, mockup, plano, revisão, PR, QA, merge, deploy…),
   não as fases do `tasks.md`. *Aceita.*
   → C1: tudo o que esta change configura é por passo do workflow.
2. **Agente especialista por passo.** Cada passo de sessão tem um agente do plugin, com papel, entradas, critério
   de pronto, modelo e esforço; o projeto pode substituí-lo em `.orquestrador/agents/`. *Aceita.*
   → C2: todo passo `session` dos workflows padrão nomeia um agente que existe no plugin; um agente do projeto
   com o mesmo nome vale mais; `flow status` diz qual agente, modelo e esforço usar.
3. **Descrição a fundo.** Cada passo diz entrada, saída, quem responde e o que bloqueia. *Aceita.*
   → C3: os passos padrão trazem esses campos e o painel de workflows os mostra.
4. **Passos por projeto.** O projeto parte de um workflow base e liga/desliga passos, ou acrescenta passos novos;
   o mod religa a ordem. *Aceita ("feature" = passo).*
   → C4: um workflow do projeto pode ser escrito do zero ou como `base` + remoções + acréscimos + ajustes; o mod
   resolve num flow completo e recusa o que deixaria passo órfão.
5. **Passos fixos.** `executar` não sai; passo do dono só se desliga pelo workflow do projeto. *Aceita.*
   → C5: remover o laço `executar` é recusado; nenhuma sessão desliga passo.
9. **Listagem.** Num painel próprio, separado do 🧭 Orquestrador.
   → C6: um comando abre o painel ⚙️ Workflows, com os workflows disponíveis e, por passo, quem responde, agente,
   modelo, esforço, portões, comando, automático ou não, e os erros dos arquivos.
10. **Escolha do workflow.** Ao iniciar uma change, sempre mostrar as opções; dá para criar um workflow do
    projeto, do zero ou a partir dos dois padrões, removendo ou acrescentando passos.
    → C7: a coordenação sempre oferece ao dono os workflows de `flow list` (com título e descrição) antes do
    `flow start`; não há workflow padrão implícito.

## Rodada 2

11. **Edição.** Pelo próprio painel de workflows.
    → C8: no painel ⚙️ o dono cria um workflow (do zero ou a partir de outro), liga/desliga passos, acrescenta
    passos da biblioteca ou novos, reordena, e ajusta agente, modelo, esforço, merge e deploy; salvar grava
    `.orquestrador/flows/<id>.json` e mostra o erro de validação sem gravar arquivo inválido. Uma change em
    andamento continua com o workflow com que começou.
12. **Merge.** Varia por projeto: trunk-based (PR → main → produção) ou dev/master (dev → QA, master →
    produção). A revisão do PR é um passo; depois vêm QA e/ou produção, que são o merge em si.
    → C9: existe o passo **Revisão do PR**; existe o passo **Merge** com a branch de destino; um projeto
    dev/master tem merge em `dev` (antes do QA) e merge em `master`/`main` (produção); um trunk-based tem um
    merge só.
13. **Aprovação no GitHub.** O dono abre o PR, revisa e aprova; depois vem QA ou produção.
    → C10: o merge automático só acontece com o PR aprovado no GitHub, o CI verde e os portões finais passados;
    nunca com `--admin`; método padrão `squash`, configurável. Sem auto-merge, o merge é do dono (botão, ou o
    mod vê o `gh pr merge` dele).
14. **Deploy.** Por projeto: (a) o deploy acontece pelo CI no merge; (b) além do CI, rotinas fora do CI. Os
    dois juntos têm de ser possíveis.
    → C11: o passo **Deploy** declara `ci` (espera a confirmação do deploy do CI) e/ou `commands` (rotinas que a
    coordenação roda depois do merge, cada uma com código de saída próprio); com `auto`, roda sozinho depois do
    merge; sem, espera o dono.
