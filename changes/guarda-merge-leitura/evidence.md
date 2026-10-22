# Evidência — guarda de merge sem falso positivo

`opaqueMerge` (`hooks/gates.ts`) passa a julgar cada comando pelo que ele faz. Um comando é tratado como merge escondido quando:

- o executável vem de uma variável;
- o próprio comando cita `gh` e `merge`;
- é um shell ou interpretador (python, node, ruby, perl…) lendo do stdin;
- é um shell ou interpretador rodando um script, e a linha não tem merge legível;
- é um `git` que roda comandos.

Teste novo em `tests/merge-safe.test.ts`:

- **Passam:** `for` e `while` com leitura de PR e um `gh pr list` canalizado para `jq`.
- **Continuam recusados:** um script gravado e rodado na mesma linha (bash e python) e um `for` que faz merge.
- **Contornos anteriores:** seguem cobertos.

Resultados:

- `claude plugin test orquestrador` (2.1.308): 367 pass, 0 fail.
- Versão 0.12.2.
