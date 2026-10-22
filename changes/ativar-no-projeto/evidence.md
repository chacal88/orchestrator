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

## Fase 4 — Correções da revisão (4.1–4.5)

**4.1** `register.tsx` (`touchesSettings`, no `tool.call` antes de `activeMode`, e em `isGuarded`): Edit/Write/MultiEdit/NotebookEdit no `.claude/settings.local.json` (caminho absoluto ou relativo, inclusive o do checkout principal) e Bash que o cite sem ser só leitura são recusados em qualquer modo e sem marca. A escrita nos registros de portão agora é recusa dura também em "lembrar". Testes: Write, Edit, MultiEdit, `sed -i`, `echo >`, `tee`, a partir de worktree; `cat` segue livre; o painel (`writeActivation`) segue gravando.
**4.2** `noteReminded`: cada recusa que vira aviso em "lembrar" vai para o log do flow (`logFlowRefusal`, nota `lembrar: …`) e para o estado `reminded`, que o painel 🧭 mostra no aviso do rodapé ("Em "lembrar", N recusa(s) viraram só aviso. Última: …"). Texto do nível "lembrar" (opção e ajuda, pt-BR e en) diz que `--admin`, merge sem revisão e pulo de portões deixam de ser barrados; README ajustado. Testes: merge (log + painel), `start_session` (4ª sessão), registros de portão.
**4.3** `activeMode` guarda por 20 s se há flow em andamento neste checkout (estado `running`; `saveFlow` o derruba; `refreshQuietly` o mantém quente); o render da faixa só lê o estado (render não grava) e rescaneia sem guardar quando vencido. Com marca não varre nada. Erro da leitura vira "sem flow": nada negado, faixa de pé. Testes: 5 chamadas, 1 varredura; marca sem varredura; listagem falhando não nega em "lembrar" nem derruba sem marca.
**4.4** `activation.ts`: erro de leitura recusa gravar (`unreadable`); `hooks.SessionStart` que não é lista recusa (`badHooks`); `check-ignore` só acrescenta ao exclude com saída 1; o exclude é garantido antes de gravar e falha vira recusa (`notIgnored`) sem criar o arquivo; sem mudança, sem regravar; `fs.write` cria `.claude/`. O painel (⚙️) diz o motivo de cada recusa (pt-BR e en). Testes de cada caso.
**4.5** Testes: faixa só com a marca e uma run publicada, sem flow; `session.start` sem marca não abre painel (com marca abre); `tool.check` e `prompt.submit` inativos não rastreiam; texto do hook com acentos (agora "nível", "só o dono", "portões", gravado sem escapes).

Portões depois da última edição: tipos, validação e testes com saída 0 cada; 338 testes passando.

## Fase 5 — Correções da 2ª revisão (5.1–5.4)

**5.1** `activation.ts`: `writeActivation` grava, depois do arquivo, o nível no estado do mod (`orquestrador.activationRecord`, por raiz do repositório principal; `recordLevel`); `readActivation` só aceita "lembrar" se for o que o painel gravou, senão vale "barrar" com `tampered: true`; "barrar" vale sempre; marca apagada ou arquivo ilegível depois de o painel ter ativado vale "barrar". O painel avisa (cartão "Este projeto" com botão "Confirmar barrar", e aviso no painel principal). Testes: "lembrar" à mão com flow em andamento segue barrando; ativar/trocar/desativar pelo painel; marca que reaparece à mão após desativar vale "barrar"; marca apagada; aviso no cartão e no painel principal.
**5.2** `register.tsx`: `touchesSettings` só é consultado depois de `activeMode` (clone inativo: arquivo livre); regex com `/i` (também a da pasta de registros). Removido de `isGuarded`. Testes: Edit e `echo >` livres no inativo; recusados no ativo (marca ou flow), inclusive com caixa trocada.
**5.3** `activeMode` falha fechado: erro de leitura da marca (ou do estado) vale "barrar"; varredura de flows falha vale "barrar" se o flow já era conhecido (`running`), senão quieto. Testes: arquivo ilegível; listagem falhando com flow conhecido e sem.
**5.4** README e `i18n-workflows.ts` (pt-BR e en): "barrar" é um freio, não uma barreira; a trava de verdade é a proteção de branch do GitHub; hooks postos pelo modelo em outros arquivos de settings ficam fora do alcance. Aproveitados: `reminded` zera ao ativar/trocar/desativar; doc de `activeMode`/`RUNNING_TTL_MS` unida.

Onde fica o estado: no `$.state` do mod; nenhuma ferramenta do modelo o grava (ele não é um arquivo do projeto). Restos: o modelo ainda pode apagar/mudar a marca, mas isso só endurece (vale "barrar").

Portões depois da última edição: tipos, validação e testes com saída 0 cada; 345 testes passando.
