/** The mod's default "completo" flow, written as the JSON a project's `.orquestrador/flows/completo.json` would hold. */
export const completo: unknown = {
  "id": "completo",
  "title": "Completo",
  "description": "Do entendimento ao arquivamento: grill com o dono, mockup quando a change é visual, plano OpenSpec revisado e liberado pelo dono, fases com seus portões, revisão, PR, QA e produção.",
  "steps": [
    {
      "id": "grill",
      "title": "Entendimento",
      "description": "Rodadas de perguntas até o dono fechar o entendimento.",
      "kind": "owner",
      "details": {"inputs": "O pedido do dono e o que o repositório já tem sobre o assunto.", "produces": "O grill.md com as rodadas e os critérios de aceite.", "blocks": "Nada se planeja antes de o dono fechar o entendimento."},
      "outcomes": { "fechado": { "label": "Entendimento fechado", "next": "mockup" } }
    },
    {
      "id": "mockup",
      "title": "Mockup",
      "description": "Só quando a change é visual: o dono aprova o mockup ou pede ajustes.",
      "kind": "owner",
      "details": {"inputs": "O entendimento fechado de uma change visual.", "produces": "O mockup aprovado pelo dono.", "blocks": "Pedir ajustes refaz o mockup; o plano espera a aprovação."},
      "when": "visual",
      "outcomes": {
        "aprovado": { "label": "Aprovar mockup", "next": "planejar" },
        "ajustes": { "label": "Pedir ajustes", "next": "mockup" }
      }
    },
    {
      "id": "planejar",
      "title": "Planejar OpenSpec",
      "description": "Uma sessão escreve proposta, design e tarefas da change.",
      "kind": "session",
      "agent": "planejador",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": {"inputs": "O entendimento (grill.md) e, se houver, o mockup aprovado.", "produces": "proposal.md, design.md e tasks.md da change.", "blocks": "Sem plano escrito, não há validação."},
      "outcomes": { "pronto": { "label": "Plano escrito", "next": "validar" } }
    },
    {
      "id": "validar",
      "title": "Validar OpenSpec",
      "description": "O mod vê o `openspec validate` rodar; o código de saída decide.",
      "kind": "automatic",
      "details": {"inputs": "Os arquivos OpenSpec da change.", "produces": "O `openspec validate` com saída 0.", "blocks": "Falhou volta ao planejar."},
      "command": "openspec validate",
      "outcomes": {
        "passou": { "label": "Validou", "next": "revisao-plano" },
        "falhou": { "label": "Falhou", "next": "planejar" }
      }
    },
    {
      "id": "revisao-plano",
      "title": "Revisão do plano",
      "description": "Revisores conferem o plano contra as regras e as specs.",
      "kind": "session",
      "agent": "revisor-plano",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": {"inputs": "O plano validado, as regras do repositório e as specs.", "produces": "Veredito aprovado/rejeitado com os achados.", "blocks": "Rejeitado volta ao planejar."},
      "outcomes": {
        "aprovado": { "label": "Plano aprovado", "next": "liberacao" },
        "rejeitado": { "label": "Plano rejeitado", "next": "planejar" }
      }
    },
    {
      "id": "liberacao",
      "title": "Liberação do dono",
      "description": "O dono libera a execução do plano.",
      "kind": "owner",
      "details": {"inputs": "O plano revisado.", "produces": "A liberação do dono para executar.", "blocks": "Nenhuma fase começa sem a liberação."},
      "outcomes": {
        "liberado": { "label": "Liberar execução", "next": "executar" },
        "ajustes": { "label": "Pedir ajustes no plano", "next": "planejar" }
      }
    },
    {
      "id": "executar",
      "title": "Executar fases",
      "description": "As fases do tasks.md, uma a uma: o mod fecha cada fase quando os portões passaram, as tarefas estão marcadas e o trabalho foi commitado.",
      "kind": "loop",
      "agent": "publicador",
      "details": {"inputs": "O tasks.md liberado.", "produces": "Cada fase com os portões passados, as tarefas marcadas e o trabalho commitado.", "blocks": "A revisão de código só começa com todas as fases fechadas."},
      "over": "tasks",
      "outcomes": { "concluidas": { "label": "Fases concluídas", "next": "revisao-codigo" } }
    },
    {
      "id": "revisao-codigo",
      "title": "Revisão de código",
      "description": "Revisores conferem o código entregue.",
      "kind": "session",
      "agent": "revisor-codigo",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": {"inputs": "O diff da change e o tasks.md marcado.", "produces": "Veredito aprovado/rejeitado com achados por arquivo:linha.", "blocks": "Rejeitado volta ao executar."},
      "outcomes": {
        "aprovado": { "label": "Código aprovado", "next": "checagem" },
        "rejeitado": { "label": "Código rejeitado", "next": "executar" }
      }
    },
    {
      "id": "checagem",
      "title": "Checagem final",
      "description": "O mod vê o `scripts/check.sh` passar, com o evidence.md preenchido.",
      "kind": "automatic",
      "details": {"inputs": "O código aprovado e o evidence.md preenchido.", "produces": "O `scripts/check.sh` com saída 0.", "blocks": "Falhou volta ao executar; sem evidence.md não passa."},
      "command": "scripts/check.sh",
      "requiresEvidence": true,
      "outcomes": {
        "passou": { "label": "Passou", "next": "pr" },
        "falhou": { "label": "Falhou", "next": "executar" }
      }
    },
    {
      "id": "pr",
      "title": "PR",
      "description": "Uma sessão abre o PR da change.",
      "kind": "session",
      "agent": "abre-pr",
      "model": "claude-sonnet-5-5",
      "effort": "medium",
      "details": {"inputs": "A branch da change com a checagem passada.", "produces": "O PR aberto, com o resumo e a evidência.", "blocks": "QA e produção esperam o PR."},
      "outcomes": { "aberto": { "label": "PR aberto", "next": "qa" } }
    },
    {
      "id": "qa",
      "title": "Em QA",
      "description": "A change espera o QA; o dono diz se passou ou se pediu ajustes.",
      "kind": "owner",
      "details": {"inputs": "O PR aberto e o ambiente de QA.", "produces": "O veredito do QA, dado pelo dono.", "blocks": "Ajustes pedidos voltam ao executar."},
      "outcomes": {
        "aprovado": { "label": "QA aprovou", "next": "producao" },
        "ajustes": { "label": "QA pediu ajustes", "next": "executar" }
      }
    },
    {
      "id": "producao",
      "title": "Em produção",
      "description": "A change chegou em produção: pelo botão do dono ou quando o mod vê o deploy.",
      "kind": "owner",
      "details": {"inputs": "A change aprovada no QA.", "produces": "A change em produção, pelo botão do dono ou pelo deploy visto.", "blocks": "A change só se arquiva depois de publicada."},
      "detect": {
        "commands": ["npm run deploy", "pnpm run deploy", "yarn deploy", "bun run deploy", "vercel --prod", "vercel deploy --prod", "netlify deploy --prod", "fly deploy", "flyctl deploy", "firebase deploy", "gcloud app deploy", "railway up"],
        "outcome": "publicado"
      },
      "outcomes": { "publicado": { "label": "Está em produção", "next": "arquivar" } }
    },
    {
      "id": "arquivar",
      "title": "Arquivar change",
      "description": "Uma sessão roda o `openspec archive`; quando passa, o mod arquiva as sessões restantes e remove o grupo da barra lateral.",
      "kind": "automatic",
      "details": {"inputs": "A change publicada.", "produces": "O `openspec archive` com saída 0, as sessões arquivadas e o grupo removido.", "blocks": "Falhou tenta de novo."},
      "command": "openspec archive",
      "cleanup": true,
      "outcomes": {
        "passou": { "label": "Arquivada", "next": "fim" },
        "falhou": { "label": "Falhou", "next": "arquivar" }
      }
    }
  ]
}
