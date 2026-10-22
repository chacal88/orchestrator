# Idioma por projeto

## Por quê

O mod falava só pt-BR: o painel, a faixa, os avisos e os flows padrão. Um projeto em inglês, ou um dono
que prefere o painel em inglês e os textos da change em português, não tinha como escolher.

## O que muda

- `<repo>/.orquestrador/config.json` com `language`, em dois eixos independentes:
  - `ui`: caixas e títulos. Cabeçalhos das caixas, botões, status, faixa acima do prompt, avisos, títulos
    dos passos do flow e rótulos das respostas;
  - `content`: descrições e textos da change. Descrição do flow e de cada passo, e o idioma em que a
    coordenação escreve proposta, tarefas, perguntas do grill, itens do plano e perguntas ao dono (o mod
    diz isso nas respostas das ferramentas `flow` e `plano`).
- `"language": "en"` vale para os dois eixos. Sem arquivo, ou com um valor que o mod não conhece, fica
  `pt-BR` nos dois, como antes, e o painel avisa do valor inválido.
- Idiomas: `pt-BR` e `en`.
- Os flows padrão trazem título, descrição e rótulos nos dois idiomas. Um flow do projeto pode escrever
  `title`, `description` e `label` como texto simples ou como `{ "pt-BR": "…", "en": "…" }`. Falta de um
  idioma cai no outro.
- Um flow que já está rodando guarda a cópia de quando começou: uma cópia de antes desta versão mostra
  os textos que tinha.
- Não muda: as mensagens para o modelo continuam em inglês, e os ids de passos e de respostas
  (`passou`, `falhou`, `concluidas`) não se traduzem.
- Versão 0.8.3 (da 0.8.0 à 0.8.2 ficaram as fases por projeto, que chegaram antes na main).
