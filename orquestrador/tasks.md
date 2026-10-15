## 1. Painel v1

- [x] 1.1 Painel lateral com ondas, fases e tarefas das sessões
- [x] 1.2 "Precisa de você" com aceitar recomendação, abrir sessão e abrir PR
- [x] 1.3 Agrupamento automático e instalação para todas as sessões

## 2. Evolução

- [x] 2.1 Andamento do OpenSpec e issues do Jira no painel
- [x] 2.2 Portões de qualidade por fase e teto de sessões vivas
- [x] 2.3 Painel organizado pelo foco: agora, depois, concluído

## 3. Validação

- [ ] 3.1 Reiniciar o app e conferir o painel com todas as sessões
- [ ] 3.2 Limpar o material de teste

## 4. Flows e gates

- [x] 4.1 Flow descrito em arquivo JSON (passos, tipo de cada passo, para onde vai em cada resultado, limite de tentativas); flows padrão "completo" e "rápido" no mod, e flows do projeto numa pasta do repositório valendo mais que os padrões
- [x] 4.2 Motor do flow: passo atual, transições, limite de 3 tentativas que escala para o dono, registro de eventos e estado salvo por change (sobrevive a reinício)
- [x] 4.3 Três tipos de passo: sessão (uma sessão faz e informa o resultado), automático (um script decide pelo código de saída) e dono (só um clique no painel responde; uma sessão nunca responde por ele)
- [x] 4.4 Ferramenta para a coordenação informar o resultado de um passo; o mod recusa pular etapas (por exemplo, executar fases sem a liberação do dono)
- [x] 4.5 Grill com rodadas até o dono clicar "Entendimento fechado"; respostas viram critérios de aceite. Mockup só quando a change é visual, com aprovar ou pedir ajuste. A "Liberação do dono" usa o plan mode do app: a coordenação escreve o plano de execução na caixa Plano, o dono aprova no botão nativo, e o mod registra essa resposta como o passo do dono
- [x] 4.6 Execução das fases do tasks.md como um laço do flow, usando os gates de fase existentes; ao fechar a fase, a sessão dela é arquivada (com o trabalho já commitado)
- [x] 4.7 Depois do PR: "Em QA" (QA aprovou / QA pediu ajustes, que volta para as fases), "Em produção" (detecção automática quando o agente faz o deploy, ou botão), e arquivamento da change (openspec archive, sessões restantes e grupo da barra lateral)
- [x] 4.8 Jira: o painel avisa quando a issue deve mudar de estado e só move depois do clique do dono
- [x] 4.9 Painel: caixa Gates como lista no estilo "Tarefas em segundo plano" (um passo por linha, concluídos recolhidos); caixa Tarefas com as fases do OpenSpec e suas tarefas; ordem OpenSpec, Gates, Precisa de você, Tarefas. `/orquestrador` passa a abrir e fechar o painel, e uma faixa fina acima do campo de mensagem (só quando há orquestração) mostra onda, fases em voo e pendências do dono, com um botão para abrir e fechar o painel
- [x] 4.10 Skill change-orchestrator passa a seguir o flow: a coordenação pergunta ao mod qual é o próximo passo em vez de decidir sozinha
- [ ] 4.11 Testes, validação do mod e conferência no app com uma change real

## 5. Depois

- [ ] 5.1 Mod separado "painel central de changes": todas as changes em execução, em QA, em produção e aguardando arquivamento
