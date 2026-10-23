# Guarda de merge sem falso positivo em leitura

## Por quê

Em 2026-10-22 o guarda de merge recusou um laço `for` que só lia o estado de alguns PRs (`gh pr view … --json
mergeable`). A regra do guarda diz que, quando a linha cita `gh` e `merge` sem um merge legível, qualquer comando que
executa algo conta como merge escondido. Nesse laço, quem "executava algo" era a própria palavra `for`.

## O que muda

A regra do guarda continua a mesma, porque ela pega os scripts escondidos (`. m.sh`, `source`, `./m.sh`, `timeout`,
`env -i`, `sudo -u`, `xargs sh -c`…). A mudança é que as palavras de laço e de condição do próprio shell (`for`,
`select`, `case`, `esac`, `done`, `fi`, `read`, `break`, `continue`, `[[`, `]]` e `}`) passam a contar como inertes.
Elas não executam nada sozinhas, e o que elas envolvem continua sendo julgado como um comando à parte.

Uma primeira tentativa, que julgava cada comando só pelo que ele mesmo faz, foi reprovada na revisão de segurança e
desfeita (ver evidence.md).

Versão 0.12.2.
