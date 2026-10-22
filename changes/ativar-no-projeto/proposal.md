# Ativar o orquestrador neste projeto

## Por quê

O dono não quer engessar os projetos com o plugin: as configurações podem ir para o repositório, mas só valem num
clone onde ele ativou o orquestrador, e ligar e desligar tem de ser fácil.

## O que muda

- **Ativação local.** "Ativar neste clone" grava em `.claude/settings.local.json` (fora do git, vale para o clone
  e as worktrees dele) a marca de ativação com o nível (`barrar` ou `lembrar`) e um hook `SessionStart` que dá ao
  Claude o flow e as regras. "Desativar" tira só isso.
- **Quieto sem ativação.** O mod não abre painel sozinho, não mostra faixa, não põe regras na conversa e não barra
  merge num clone não ativado, salvo uma change com flow em andamento. Os comandos seguem disponíveis.
- **Nível.** "barrar" mantém tudo o que o mod impõe hoje; "lembrar" só orienta.
- **Painel.** O cartão "Este projeto" mostra o estado e os botões, como no mockup aprovado.

Versão 0.10.0.
