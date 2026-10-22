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

## Fase 2 — Painel (2.1)

**2.1 Cartão "Este projeto" nos três estados.** `workflows-pane.tsx` (`projectCard`, `setActivation`) e `i18n-workflows.ts` (`project.activation`, pt-BR e en).
O cartão lê a ativação do `settings.local.json` a cada desenho (vale na hora, sem reiniciar):
- inativo: pílula "inativo neste clone", a frase de que o orquestrador está quieto, as três linhas, e "Ativar neste clone" (primário) ao lado de "Configurar";
- confirmação (abaixo do cartão, borda azul): título "Ativar o orquestrador neste clone", "Quanto ele garante" com o nível (Select; dois botões no mobile, que não tem Select), a explicação, o quadro "O que é gravado" e "Ativar" / "Cancelar";
- ativo: pílula azul "ativo neste clone · barrar", "Configurar", "Trocar para lembrar", "Desativar neste clone" e a nota de que desativar tira só o que o "Ativar" pôs.
Ativar, trocar e desativar gravam via `writeActivation` (preserva o resto do arquivo); um arquivo que não é JSON válido não é gravado, o cartão avisa e esconde "Ativar".
Testes (`tests/activation-pane.test.ts`, 6, nas três superfícies onde cabe): inativo; confirmação e cancelar sem gravar; ativar grava marca e hook e mantém `permissions` e `Stop`;
trocar de nível sem segundo hook e desativar devolve o arquivo original; JSON inválido; cartão em inglês. Os testes de `project-pane.test.ts` seguem passando sem mudança.

**Onde o painel difere do mockup, e por quê**
- "Configurar" saiu do cabeçalho e foi para a fila de botões do fim, como no mockup; as linhas Merge e Deploy continuam com a pílula "você faz" / "automático" do cartão existente (o mockup as escreveu como texto com "·"), para não reabrir o que o dono já aprovou na fase de configurações.
- "Desativar neste clone" é um botão `plain`: o Button do motor não tem cor, então não fica vermelho como no mockup.
- Os rótulos "Quanto ele garante" e "O que é gravado" ficam em negrito, sem caixa alta, como no mockup (as legendas "Inativo", "Ativo" e "Ao apertar…" do mockup são anotações da prancheta, não entram no painel).
- O nível é um Select nas superfícies que têm campos e dois botões no mobile (que não tem Select); o mockup só desenhou o Select.
- Acréscimo: com `settings.local.json` inválido o cartão mostra o aviso em vermelho e esconde "Ativar" (o mockup não previu o caso).

## Fase 3 — Documentação e versão (3.1)

- `README.md`: seção "Ativar neste clone" (quieto sem ativação, ativar e desativar pelo painel ⚙️, os níveis barrar e lembrar, o JSON exato que é gravado, como o hook é reconhecido, o exclude local), e o passo 0 em "Uso".
- `orquestrador/skills/change-orchestrator/SKILL.md`: § 1, item 0: num clone inativo a coordenação pede ao dono para ativar no painel ⚙️ antes de orquestrar, e não grava o arquivo ela mesma.
- `orquestrador/.claude-plugin/plugin.json`: versão 0.9.0 → 0.10.0.
- Portões da fase rodados depois da última edição (tipos, validação, testes): saída 0 em cada um; 324 testes passando.
