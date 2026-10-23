# Freio do aviso e fila de gravação do flow

## Por quê

A revisão de código da 0.13.0 (`acorda-coordenacao`, "Seguir o flow sem clique") aprovou a change e deixou dois pontos
não bloqueantes. Os dois são de robustez do aviso e da gravação do flow e ficaram para uma versão de correção.

1. **Laço que abre filhas novas.** O freio contra laço (`wakeOnce` em `hooks/register.tsx`, `AUTOWAKE_MAX_SAME_CHILD`)
   mede o andamento com `flowProgress` (`hooks/wake.ts`), cuja chave junta o `seq`, as fases fechadas, o número de
   sessões adotadas (`flow.sessions.length`) e as fases `done` do plano. Se a coordenação, a cada aviso, abre uma filha
   nova sem o flow andar, essa filha nova é adotada, a chave muda e o freio zera. A filha nova termina, avisa, a
   coordenação abre outra, e assim sem fim. O freio por filha não pega, porque cada filha é avisada uma vez só.
2. **Janela entre ler e gravar o flow.** O `saveFlow` relê o flow do disco, junta `sessions` e `groupId` e grava. O
   `keepGrouping` faz o mesmo. Entre a releitura e a gravação de um, o outro pode gravar, e o que gravou por último
   apaga o do outro: um agrupamento que caia nessa janela perde uma adoção. A mesma janela vale para o log `.ndjson`
   (`writeFlow` e `logFlowRefusal` leem o log inteiro e o regravam), onde um evento pode sumir.

## O que muda

- **Chave de andamento sem as sessões adotadas.** `flowProgress` passa a juntar só o `seq`, as fases fechadas e as
  fases `done` do plano. As ondas continuam cobertas: o freio por filha (3 avisos da mesma filha sem andamento) não
  muda, e fases que terminam uma a uma no `executar` mudam a chave pelas fases fechadas ou pelo plano.
- **Teto geral de avisos sem andamento.** Além do freio por filha, o mod conta os avisos (`$.prompt.submit`) mandados
  com a mesma chave de andamento. No 10º aviso sem o flow andar (`AUTOWAKE_MAX_SAME_PROGRESS = 10`), o mod para de
  avisar a coordenação, sobre qualquer filha, até a chave mudar, e mostra ao dono um toast, uma vez, por exemplo:
  `Orquestrador: o flow de <change> parece parado: 10 avisos à coordenação sem o flow andar. Parei de avisar até o flow
  andar.` Conta o aviso, não a filha: as paradas juntas num aviso só (coordenação ocupada) contam uma vez, então uma
  onda grande de fases paralelas não estoura o teto à toa. Quando a chave muda, as duas contagens zeram.
- **Fila única de gravação do flow.** Toda gravação do estado e do log do flow passa por uma fila do módulo, uma de
  cada vez: o `saveFlow` (reler o disco, juntar e gravar), o `keepGrouping` (reler, juntar e gravar), o `writeFlow` e o
  `logFlowRefusal` (o log `.ndjson`). Releitura e gravação ficam dentro da mesma vez da fila, então nenhuma outra
  gravação cai entre elas. A fila não é reentrante: o que roda dentro dela não chama a fila de novo. Um erro numa vez
  volta a quem chamou e não trava as próximas.
- **Versão 0.13.1** no manifesto do plugin. O README ganha, no item "Seguir o flow sem clique", que o painel para de
  avisar e avisa o dono quando o flow não anda.

## Fora do escopo

- O número 3 do freio por filha e o texto do aviso à coordenação (`stopPrompt`) ficam como estão.
- O comando de um flow (`report`, `close`, clique do dono) continua lendo o estado no começo e juntando no fim; a fila
  cobre a janela entre a releitura e a gravação, não o comando inteiro.

## Critérios de aceite

1. Com a opção ligada, uma coordenação que abre uma filha nova a cada aviso sem o flow andar recebe 10 avisos, e
   depois nenhum; o dono vê um toast só. Um `report` que anda o flow faz o próximo aviso sair de novo.
2. As 4 fases que terminam uma a uma no `executar` (testes da 0.13.0) e as 4 filhas diferentes de uma onda continuam
   dando 4 avisos e nenhum toast.
3. Um agrupamento que adota uma sessão entre a releitura e a gravação do `saveFlow` não perde a adoção, e o `report`
   também não perde o seu registro.
4. Dois eventos gravados ao mesmo tempo no log `.ndjson` do flow ficam os dois.
5. `claude plugin test orquestrador` e `tsc` saem com 0; `plugin.json` diz 0.13.1.
