# Evidência — ativar no projeto

## Fase 1 — Ativação local (1.1, 1.2)

**1.1 Ler e gravar a ativação.** `orquestrador/hooks/activation.ts` lê e grava `<raiz do repositório principal>/.claude/settings.local.json`
(a raiz vem de `git rev-parse --path-format=absolute --git-common-dir`; fora do git, a pasta da sessão).
O que o "Ativar" grava, e só isso:

```json
{
  "env": { "ORQUESTRADOR": "barrar" },
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "printf '%s\\n' \"Orquestrador ativo neste clone (nivel: ${ORQUESTRADOR:-barrar}). Siga o flow da change em andamento; passos do dono so o dono responde no painel (/orquestrador); sem merge --admin e sem pular portoes.\" # orquestrador:ativar" } ] }
    ]
  }
}
```

O hook não leva campo extra (evita o risco de o Claude Code recusar um campo que não conhece): ele é marcado pelo
próprio texto do comando (`# orquestrador:ativar`), e o "Desativar" tira só o hook que traz essa marca. Rodado em `sh`, o comando imprime a linha
com o nível de `$ORQUESTRADOR`. Testes (`tests/activation.test.ts`): ativar preserva `permissions`, outras chaves de `env`,
outros hooks de `SessionStart` e `Stop`; ativar de novo troca o nível sem segundo hook; desativar devolve o arquivo
como era e não deixa `env`/`hooks` vazios; JSON inválido (`{ "env": `) não é gravado e fica como estava;
numa worktree (`root=/main/.claude/worktrees/x`, `common=/main/.git`) grava e lê o arquivo de `/main`;
arquivo criado pelo mod e não ignorado vai para `.git/info/exclude` (nunca `.gitignore`); já ignorado, nada é acrescentado.

**1.2 `isActive`.** `activeMode` em `register.tsx`: a marca lida do arquivo na hora (`$.fs`), ou um flow em andamento
neste checkout (status diferente de `done`/`aborted`, `ownsFlow`), vira "barrar"; sem nenhum dos dois, o mod fica quieto: não abre o painel
sozinho no `session.start`, não desenha a faixa, não rastreia `tool.call`/`tool.check`/`prompt.submit`, não recusa merge nem portões.
"Lembrar" deixa tudo igual, mas cada recusa (merge, `--admin`, portões, arquivos de gate, Jira) vira registro em log e um toast, e a chamada segue.
Os comandos `/orquestrador` e `/orquestrador-workflows` e as ferramentas `plano` e `flow` seguem disponíveis.
Testes de harness (`tests/activation.test.ts`): inativo (sem faixa, `--admin` passa), "barrar" (recusa), "lembrar" (aviso, passa), palavra desconhecida (sem marca),
inativo com flow em andamento (recusa) e com flow concluído (passa), faixa em clone ativado.

**Testes antigos ajustados:** 10 testes em 4 arquivos assumiam o mod sempre ativo e agora ativam o clone com a marca no
`settings.local.json` do mundo de teste, sem mudar o que provam: `harness.test.ts` (6), `flow-harness.test.ts` (1),
`merge-scope-harness.test.ts` (1), `pane.test.ts` (2).
