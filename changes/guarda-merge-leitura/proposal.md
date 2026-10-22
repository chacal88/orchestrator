# Guarda de merge sem falso positivo em leitura

## Por quê

Em 2026-10-22 o guarda de merge recusou `for n in 12 13 14; do gh pr view $n --json mergeable,…; done`, um
comando que só lê PRs: sem merge legível na linha, qualquer comando "que executa algo" (aqui o `for`) numa linha que
cita `gh` e `merge` era tratado como merge escondido.

## O que muda

O guarda passa a julgar cada comando pelo que ele mesmo faz, também sem merge legível: é merge escondido quando o
executável vem de variável, quando o próprio comando cita `gh` e `merge` (xargs, timeout, find -exec, sudo, awk…),
quando é um shell ou interpretador lendo do stdin, ou — sem merge legível na linha — um shell ou interpretador
rodando um script, e o `git` que roda comandos. Laços, `cd`, `jq` e afins deixam de ser recusados.

Versão 0.12.2.
