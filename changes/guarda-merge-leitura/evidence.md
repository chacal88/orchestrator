# Evidência — guarda de merge sem falso positivo

## Rodada 1 (reprovada na revisão)

A primeira tentativa (`b9c1618`) julgava cada comando pelo que ele mesmo faz. A revisão de segurança mostrou que isso
abria brechas que o guarda anterior fechava: um script gravado e rodado na mesma linha passava quando era rodado
por `. m.sh`, `source m.sh`, `./m.sh`, `fish m.sh`, ou atrás de `timeout`, `env -i`, `sudo -u` e `xargs sh -c`.

## Rodada 2 (tarefa 1.2)

- `opaqueMerge` volta à regra anterior: sem merge legível na linha, qualquer comando que executa algo numa linha
  que cita `gh` e `merge` conta como merge escondido.
- O conjunto `INERT` ganha as palavras de laço e de condição do próprio shell: `for`, `select`, `case`, `esac`,
  `done`, `fi`, `read`, `break`, `continue`, `[[`, `]]` e `}`. Essas palavras não executam nada sozinhas; o que
  elas envolvem continua sendo julgado como um comando à parte.
- Teste em `tests/merge-safe.test.ts`:
  - passam: `for` e `while … read` com `gh pr view … mergeable`, e `gh pr list | jq`;
  - continuam recusados: script gravado e rodado na mesma linha com bash, python, `. m.sh`, `source`, `./m.sh`,
    `timeout`, `env -i`, `sudo -u` e `fish`; `xargs -I{} sh -c {}`; `for` com merge.

Resultados:

- `claude plugin test orquestrador` (2.1.308): 367 pass, 0 fail.
- Versão 0.12.2.
