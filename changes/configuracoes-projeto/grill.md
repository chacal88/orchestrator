# Entendimento — configurações do projeto

Rodada no chat em 2026-10-22; o dono não discordou de nenhuma recomendação (1–6) e pediu mockup antes do código (7).

1. **Onde.** Seção no topo do painel ⚙️ Workflows: cartão "Este projeto" com o resumo e "Configurar".
   → C1: o painel ⚙️ abre com o cartão "Este projeto" (idioma, merge, deploy) antes da lista.
2. **O que entra.** Idioma (caixas e títulos; descrições e textos), merge (automático, branch, método), deploy
   (automático, esperar o CI, rotinas).
   → C2: a edição tem os quatro blocos do mockup, cada campo com explicação.
3. **Relação com os workflows.** Os valores do projeto são o padrão dos passos de merge e deploy de todos os
   workflows; um passo com valor próprio no workflow vence.
   → C3: um passo de merge/deploy sem valor próprio usa o do projeto; com valor próprio, o dele; `flow status` e o
   painel dizem de onde veio.
4. **Workflow sem merge.** Ligar o auto-merge não acrescenta o passo sozinho: o painel avisa e oferece
   "Acrescentar merge e deploy".
   → C4: o bloco "Nos workflows" lista cada workflow (usa o do projeto / valor próprio / sem passo) com a ação.
5. **Onde grava.** `.orquestrador/config.json`, junto do `language`.
   → C5: salvar grava só as chaves que mudaram e preserva as outras do arquivo.
6. **Como salva.** Rascunho com Salvar/Descartar e resumo das mudanças.
   → C6: nada é gravado até "Salvar"; arquivo inválido não é gravado.
7. **Mockup.** Aprovado: https://claude.ai/artifact/Kw3TMAVuw8dVWbfK2GemvW
   → C7: as duas telas seguem o mockup; diferenças só por limite do engine, registradas no evidence.md.

## Rodada 2 (2026-10-22)

8. **Configurações locais.** O dono quer que essas configurações fiquem `.local`, para não atrapalhar quem usa o
   repositório sem o plugin.
   → C8: o painel grava em `.orquestrador/config.local.json`, que não vai para o git (o mod acrescenta o padrão ao
   `.git/info/exclude` do clone, sem mexer no `.gitignore` do projeto). A leitura junta `config.json` (do
   repositório, se existir) e `config.local.json` (vence). O resumo e a edição dizem que o valor é só desta máquina.

## Rodada 3 (2026-10-22) — substitui a rodada 2

9. **O que é local.** As configurações do plugin podem ser commitadas normalmente em `.orquestrador/config.json`;
   o que fica local são os hooks que ativam o plugin neste clone. Sem a instalação (os hooks locais), as
   configurações commitadas não fazem efeito para ninguém.
   → C8 (revisado): o painel grava em `.orquestrador/config.json`, sem `config.local.json` e sem mexer em
   `.git/info/exclude`.
10. **Ativar e desativar.** Garantir o workflow com o sistema do próprio Claude (rules, hooks), instalado só neste
    clone, fácil de ligar e desligar, sem engessar o projeto. → fica para a próxima change, "Ativar o orquestrador
    neste projeto".
