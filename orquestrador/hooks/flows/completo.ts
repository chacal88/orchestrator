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
      "outcomes": { "fechado": { "label": "Entendimento fechado", "next": "mockup" } }
    },
    {
      "id": "mockup",
      "title": "Mockup",
      "description": "Só quando a change é visual: o dono aprova o mockup ou pede ajustes.",
      "kind": "owner",
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
      "outcomes": { "pronto": { "label": "Plano escrito", "next": "validar" } }
    },
    {
      "id": "validar",
      "title": "Validar OpenSpec",
      "description": "O mod vê o `openspec validate` rodar; o código de saída decide.",
      "kind": "automatic",
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
      "over": "tasks",
      "outcomes": { "concluidas": { "label": "Fases concluídas", "next": "revisao-codigo" } }
    },
    {
      "id": "revisao-codigo",
      "title": "Revisão de código",
      "description": "Revisores conferem o código entregue.",
      "kind": "session",
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
      "outcomes": { "aberto": { "label": "PR aberto", "next": "qa" } }
    },
    {
      "id": "qa",
      "title": "Em QA",
      "description": "A change espera o QA; o dono diz se passou ou se pediu ajustes.",
      "kind": "owner",
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
      "command": "openspec archive",
      "cleanup": true,
      "outcomes": {
        "passou": { "label": "Arquivada", "next": "fim" },
        "falhou": { "label": "Falhou", "next": "arquivar" }
      }
    }
  ]
}
