# Design — ativar o orquestrador neste projeto

## Onde fica

`<raiz do repositório>/.claude/settings.local.json`. O Claude Code põe esse arquivo no exclude global do git ao
criá-lo; o mod, se criar o arquivo, também garante que `**/.claude/settings.local.json` esteja ignorado (confere com
`git check-ignore`; se não estiver, acrescenta ao `.git/info/exclude` do clone, nunca ao `.gitignore`). Em worktrees
o arquivo é o do checkout principal (é o que o Claude Code lê): a raiz é a do repositório principal
(`git rev-parse --git-common-dir`), não a da worktree.

O que o "Ativar" grava (e só isso; o resto do arquivo fica como está):

```json
{
  "env": { "ORQUESTRADOR": "barrar" },
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "<lembrete do flow>", "orquestrador": true } ] }
    ]
  }
}
```

- A marca é `env.ORQUESTRADOR` (`barrar` | `lembrar`). O mod a lê do próprio arquivo (via `$.fs`), não do ambiente
  do processo, para valer na hora, sem reiniciar.
- O hook `SessionStart` é um comando que imprime um lembrete curto do flow e das regras (stdout entra como contexto).
  Ele é marcado para o "Desativar" achar e tirar só ele (campo próprio ou comando reconhecível; o executor confirma
  o que o Claude Code aceita sem reclamar).
- JSON inválido no arquivo: o mod não grava e diz por quê.

## Quieto sem ativação

`isActive($)`: marca presente, OU um flow em andamento neste checkout (change não concluída). Sem isso:
- não abre o painel 🧭 sozinho, não desenha a faixa acima do prompt, não injeta contexto na conversa;
- não recusa `gh pr merge` (a recusa de merge/portões só vale ativo em "barrar" ou com flow em andamento);
- `/orquestrador` e `/orquestrador-workflows` continuam; o painel ⚙️ mostra o cartão inativo.
Em "lembrar": tudo como ativo, menos as recusas (merge, portões, `--admin`), que viram só aviso.

## Painel

Cartão "Este projeto" com os três estados do mockup (inativo, confirmação do ativar com o nível e o quadro
"O que é gravado", ativo com "Trocar para…" e "Desativar neste clone").
