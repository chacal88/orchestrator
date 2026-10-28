# Grill — fases-sem-clique

## Rodada 1

- **Pergunta:** Quando a corrente do user_asked quebra e sobram sessões para abrir, o painel mostra um botão só ("Abrir as N sessões pendentes") e /orquestrador abrir faz o mesmo?
  **Resposta:** Sem resposta do dono na 1ª rodada; vale a recomendação: sim.
- **Pergunta:** "Seguir o flow sem clique" continua existindo?
  **Resposta:** Vale a recomendação: manter, só para filhas que o app não acompanha.
- **Pergunta:** Quais subcomandos o /orquestrador ganha?
  **Resposta:** Vale a recomendação: status, aprovar <saída> [nota], abrir, pular-portão <fase> <portão>, ajuda; só slash.
- **Pergunta:** Entra um /orquestrador liberar?
  **Resposta:** Vale a recomendação: não; a liberação fica no plan mode.
- **Pergunta:** Com "ask" no get_session/list_sessions, o mod grava a regra de permissão?
  **Resposta:** Vale a recomendação: não; só avisa.
- **Pergunta:** Onde o dono usa sem o painel?
  **Resposta:** Remote Control (celular).
- **Pergunta:** Encerrar o flow a qualquer momento?
  **Resposta:** Pedido do dono em 2026-10-28: botão sempre visível e /orquestrador encerrar.

## Critérios de aceite

- [ ] C1: com sessões pendentes, um clique ou /orquestrador abrir abre todas, sem um card por fase.
- [ ] C2: nenhum aviso do mod sobre filha aberta com wake_when_done; as outras seguem como hoje.
- [ ] C3: os subcomandos funcionam; origin que não é do dono é recusada; aprovar tem as validações do clique.
- [ ] C4: aprovar na liberação é recusado com o aviso do botão.
- [ ] C5: o painel e a faixa pedem ao dono que permita get_session e list_sessions.
- [ ] C6: os subcomandos respondem em texto simples e dizem o que fazer no desktop quando o Remote Control não permite.
- [ ] C11: o dono encerra o flow (running ou escalated) pelo botão ou pelo comando, com confirmação; nenhuma ferramenta do modelo encerra.

## Critérios da coordenação

- C7: um harness prova que um `get_session` pendente gera no máximo 1 pedido de aprovação e que o refresh não gera
  nenhum.
- C8: um harness prova que o mod não manda aviso nenhum quando a filha foi aberta com `wake_when_done`.
- C9: um harness prova que `/orquestrador aprovar` anda o flow como o clique e que é recusado quando a `origin` é
  de plugin.
- C10: `plugin.json` na versão 0.14.0, e o README atualizado.
