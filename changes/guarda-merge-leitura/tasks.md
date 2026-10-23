## 1. Guarda de merge

- [x] 1.1 `opaqueMerge` julga cada comando pelo que ele mesmo faz (executável de variável; o comando cita `gh` e `merge`; shell ou interpretador lendo do stdin; sem merge legível, shell ou interpretador com script; `git` que roda comandos); laços e comandos de leitura passam; testes (o `for … gh pr view … mergeable` passa; os contornos já cobertos continuam recusados); versão 0.12.2 — cx: simple
- [x] 1.2 Revisão: a regra da 1.1 abria brechas (`. m.sh`, `source`, `./m.sh`, `timeout`/`env -i`/`sudo -u`/`xargs sh`); volta à regra anterior, com as palavras de laço e condição do shell (`for`, `done`, `read`, `fi`…) como inertes; testes dessas formas — cx: simple
