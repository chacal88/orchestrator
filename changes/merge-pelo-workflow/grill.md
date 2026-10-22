# Entendimento — merge pelo workflow

Conversa no chat em 2026-10-22.

1. **Dois agentes de merge, escolhidos no passo.** `merge` (o atual: PR aprovado no GitHub e CI verde) e
   `merge-pelo-workflow` (o workflow aprovou: revisão de código do flow aprovada, portões finais passados, CI verde
   se houver; sem aprovação no GitHub; nunca `--admin`). → C1: o seletor "Agente" do passo Merge oferece os dois,
   com a explicação de cada um.
2. **O workflow revisa, não o dono.** → C2: o mod recusa o merge do PR da change enquanto a revisão de código do
   flow (passo com agente `revisor-codigo`, ou id `revisao-codigo`) antes do merge não estiver aprovada.
3. **Publicação automática neste repositório.** → C3: o Rápido (plugin) deste repositório vira planejar → validar →
   executar → revisão de código → checagem (plugin test) → tipos (tsc) → publicar → merge (automático,
   merge-pelo-workflow) → deploy (automático, rotinas de update do plugin) → lançar (release) → fim, sem a
   conferência do dono; `config.json` e `rapido.json` commitados.
4. **Limites aceitos.** `/reload-plugins` segue com o dono (nenhuma rotina o roda); este repositório não usa
   OpenSpec (a validação é `plugin validate`).
