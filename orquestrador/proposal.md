# Painel do orquestrador

## Por quê

Numa orquestração com várias sessões, o dono perdia de vista em que fase o trabalho estava, o que cada sessão fazia, o que viria depois e o que dependia dele. O painel lateral junta isso num lugar só, em linguagem simples, e passa a impor as regras de qualidade antes de uma fase ser dada por terminada.

## O que muda

- Painel lateral (`/orquestrador`) com o plano publicado pela coordenação: quanto falta, o que precisa do dono, o que está rodando agora, o que vem depois e o que já terminou.
- Pendências do dono com ação direta: aceitar recomendação, abrir a sessão ao lado, abrir o PR.
- Sessões da change agrupadas sozinhas na barra lateral.
- Andamento do OpenSpec e das issues do Jira ligadas às fases.
- Portões de qualidade por fase e teto de 3 sessões de fase vivas.
