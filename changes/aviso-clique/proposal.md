# Aviso do clique

## Por quê

Na conferência do 0.7.3 o dono apertou "Instalei e funciona" no painel e não viu nada: o flow andou, mas o
painel não confirmou o clique. E o comando de instalação do README usava um `--marketplace` que não existe.

## O que muda

- Um clique num botão de passo do dono que é registrado mostra um aviso (toast) com a resposta e o próximo
  passo, por exemplo "Registrado: Instalei e funciona. Próximo passo: Lançar a versão."; no fim do flow,
  "Flow concluído.".
- A sessão coordenadora não recebe mensagem automática: decisão do dono ("Só o toast"). Ela vê o novo passo
  pelo status do flow, como já fazia.
- O README passa a instalar com `/plugin marketplace add chacal88/orquestrador` e
  `/plugin install orquestrador@orquestrador`.
- Versão 0.7.4.
