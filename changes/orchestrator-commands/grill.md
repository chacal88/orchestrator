# Grill — orchestrator-commands

## Rodada 1

- **Pergunta:** Cada ação vira um comando próprio no formato /orchestrator:<ação>, para o menu listar todos ao digitar /orchestrator?
  **Resposta:** Sim.
- **Pergunta:** Nomes: status, approve, end, open, skip-gate, panel, workflows, change, install, help?
  **Resposta:** Sim.
- **Pergunta:** propose e change são comandos diferentes ou um só?
  **Resposta:** Um só: /orchestrator:change.
- **Pergunta:** A confirmação vira a palavra confirm e os resultados seguem como o workflow declara?
  **Resposta:** Não. Nenhum comando pode exigir palavra digitada; o dono não vai lembrar de palavras.
- **Pergunta:** O inglês vai até plugin, marketplace, ferramentas do mod, agentes e a pasta .orchestrator/ (lendo a antiga por uma versão)?
  **Resposta:** Sim.
- **Pergunta:** Cortar /orquestrador de vez, com passo a passo de reinstalação?
  **Resposta:** Sim.
- **Pergunta:** Renomear o repositório do GitHub (recomendação era deixar para depois)?
  **Resposta:** Sim (ambíguo; confirmar na rodada 2).
- **Pergunta:** Os testes de aceite usam os nomes novos, com palavras como fechado e confirm?
  **Resposta:** Não quero palavras nos comandos.
- **Pergunta:** Versão 0.15.0?
  **Resposta:** Sim.

## Rodada 2

- **Pergunta:** Como aprovar ou pedir ajustes num passo do dono sem digitar o resultado?
  **Resposta:** approve + reject: approve escolhe a saída de seguir em frente do passo atual (numa escalada, tentar de novo); reject escolhe a de ajustes. O texto depois do comando vira nota livre opcional.
- **Pergunta:** Como confirmar o encerramento do flow sem a palavra confirmar?
  **Resposta:** Não confirmar: um só /orchestrator:end já encerra.
- **Pergunta:** Como pular um portão pelo chat?
  **Resposta:** Lista numerada: skip-gate sem nada lista os portões abertos numerados; skip-gate N pede confirmação; repetir o mesmo comando em até 2 minutos pula.
- **Pergunta:** Renomear o repositório do GitHub nesta change?
  **Resposta:** Sim, nesta change.

## Rodada 3

- **Pergunta:** O painel mostrou a change anterior (freio-aviso, já concluída) em vez do flow em andamento desta sessão. Corrigir nesta change?
  **Resposta:** Sim. O painel não pode abrir o de outra sessão/change.

## Critérios de aceite

- [ ] Ao digitar /orchestrator no prompt, o menu lista todos os comandos do plugin, um por ação.
- [ ] Os comandos são /orchestrator:status, :approve, :end, :open, :skip-gate, :panel, :workflows, :change, :install e :help.
- [ ] Existe um único comando /orchestrator:change no lugar do antigo change-orchestrator; não há /orchestrator:propose.
- [ ] Nenhum comando do plugin exige digitar palavra-chave (confirmar, resultado, nome de portão) para funcionar.
- [ ] Plugin, marketplace, ferramentas do mod, agentes e pasta de configuração têm nomes em inglês; projeto com .orquestrador/ continua funcionando nesta versão.
- [ ] Sim.
- [ ] Sim (ambíguo; confirmar na rodada 2).
- [ ] /orchestrator:status responde em texto simples, inclusive pelo Remote Control.
- [ ] A entrega sai como versão 0.15.0.
- [ ] No grill, /orchestrator:approve sem argumentos fecha o entendimento igual ao botão; no mockup, /orchestrator:reject com texto livre pede ajustes com essa nota; passo sem saída de ajustes responde que não há o que rejeitar.
- [ ] /orchestrator:end encerra o flow de primeira, sem pedir confirmação; o texto depois vira o motivo opcional.
- [ ] /orchestrator:skip-gate lista os portões abertos numerados e /orchestrator:skip-gate N, repetido em até 2 minutos, pula aquele portão; nenhum nome de fase ou portão é digitado.
- [ ] O repositório passa a chacal88/orchestrator e o marketplace, o plugin e a documentação apontam para o endereço novo.
- [ ] Ao abrir o painel numa sessão de coordenação, ele mostra o flow em andamento dessa sessão (com o botão do passo do dono), nunca uma change concluída ou de outra sessão.
