# Fases por projeto

## Por quê

Hoje o orquestrador tem dois workflows fixos (`completo`, `rapido`) e um projeto só muda isso escrevendo um flow
inteiro em JSON. Cada passo é um título e uma linha de descrição: quem faz o trabalho de um passo de sessão
improvisa. E os projetos do dono fecham de jeitos diferentes: uns são trunk-based e vão do PR aprovado direto ao
merge e ao deploy; outros têm `dev` (QA) e `master` (produção); uns fazem deploy só pelo CI, outros precisam de
rotinas fora dele. Nada disso é declarável hoje, e o merge nem é um passo do flow.

## O que muda

1. **Passos descritos a fundo, com agente especialista.** Cada passo ganha entrada, saída, o que bloqueia, e,
   quando é de sessão, o agente que o executa (com modelo e esforço). O plugin traz um agente por passo de
   sessão; o projeto pode trocar qualquer um em `.orquestrador/agents/`.
2. **Workflow por projeto.** Um workflow do projeto pode ser escrito do zero ou partir de outro (`base`),
   removendo, acrescentando, reordenando e ajustando passos. O mod resolve num flow completo e recusa o inválido.
3. **Revisão do PR, merge e deploy como passos.** Uma biblioteca de passos traz Revisão do PR, Merge (com a
   branch de destino: `dev` para QA, `main`/`master` para produção) e Deploy (CI e/ou rotinas). Merge e deploy
   têm a opção **automático**: o merge só com PR aprovado no GitHub, CI verde e portões finais; o deploy roda
   sozinho depois do merge.
4. **Painel ⚙️ Workflows.** Um segundo painel, separado do 🧭 Orquestrador, aberto por `/orquestrador-workflows`:
   mostra os workflows disponíveis e cada passo com sua configuração, e permite criar e editar workflows do
   projeto ali mesmo.
5. **Escolha sempre explícita.** Ao iniciar uma change, a coordenação mostra os workflows disponíveis ao dono.

Os workflows padrão `completo` e `rapido` mantêm os mesmos passos (as changes em andamento não mudam); ganham as
descrições e os agentes. Os passos novos entram pela biblioteca, no painel ou no arquivo do projeto.

## Fora do escopo

- Escrever no GitHub além do `gh pr merge` (abrir release, mexer em proteção de branch).
- Mover Jira em merge/deploy além do que o passo já declara.
- Deploy por API de provedor (Vercel etc.): as rotinas são comandos que a coordenação roda.

## Versão

0.8.0.
