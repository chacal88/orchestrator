/** The mod's default "completo" flow, in both languages, written as the JSON a project's `.orquestrador/flows/completo.json` would hold. */
export const completo: unknown = {
  "id": "completo",
  "title": { "pt-BR": "Completo", "en": "Full" },
  "description": { "pt-BR": "Do entendimento ao arquivamento: grill com o dono, mockup quando a change é visual, plano OpenSpec revisado e liberado pelo dono, fases com seus portões, revisão, PR, QA e produção.", "en": "From understanding to archive: grill with the owner, a mockup when the change is visual, an OpenSpec plan reviewed and released by the owner, phases with their gates, review, PR, QA and production." },
  "steps": [
    {
      "id": "grill",
      "title": { "pt-BR": "Entendimento", "en": "Understanding" },
      "description": { "pt-BR": "Rodadas de perguntas até o dono fechar o entendimento.", "en": "Rounds of questions until the owner settles the understanding." },
      "kind": "owner",
      "outcomes": { "fechado": { "label": { "pt-BR": "Entendimento fechado", "en": "Understanding settled" }, "next": "mockup" } }
    },
    {
      "id": "mockup",
      "title": { "pt-BR": "Mockup", "en": "Mockup" },
      "description": { "pt-BR": "Só quando a change é visual: o dono aprova o mockup ou pede ajustes.", "en": "Only when the change is visual: the owner approves the mockup or asks for adjustments." },
      "kind": "owner",
      "when": "visual",
      "outcomes": {
        "aprovado": { "label": { "pt-BR": "Aprovar mockup", "en": "Approve mockup" }, "next": "planejar" },
        "ajustes": { "label": { "pt-BR": "Pedir ajustes", "en": "Ask for adjustments" }, "next": "mockup" }
      }
    },
    {
      "id": "planejar",
      "title": { "pt-BR": "Planejar OpenSpec", "en": "Plan OpenSpec" },
      "description": { "pt-BR": "Uma sessão escreve proposta, design e tarefas da change.", "en": "A session writes the change's proposal, design and tasks." },
      "kind": "session",
      "outcomes": { "pronto": { "label": { "pt-BR": "Plano escrito", "en": "Plan written" }, "next": "validar" } }
    },
    {
      "id": "validar",
      "title": { "pt-BR": "Validar OpenSpec", "en": "Validate OpenSpec" },
      "description": { "pt-BR": "O mod vê o `openspec validate` rodar; o código de saída decide.", "en": "The mod watches `openspec validate` run; its exit code decides." },
      "kind": "automatic",
      "command": "openspec validate",
      "outcomes": {
        "passou": { "label": { "pt-BR": "Validou", "en": "Validated" }, "next": "revisao-plano" },
        "falhou": { "label": { "pt-BR": "Falhou", "en": "Failed" }, "next": "planejar" }
      }
    },
    {
      "id": "revisao-plano",
      "title": { "pt-BR": "Revisão do plano", "en": "Plan review" },
      "description": { "pt-BR": "Revisores conferem o plano contra as regras e as specs.", "en": "Reviewers check the plan against the rules and the specs." },
      "kind": "session",
      "outcomes": {
        "aprovado": { "label": { "pt-BR": "Plano aprovado", "en": "Plan approved" }, "next": "liberacao" },
        "rejeitado": { "label": { "pt-BR": "Plano rejeitado", "en": "Plan rejected" }, "next": "planejar" }
      }
    },
    {
      "id": "liberacao",
      "title": { "pt-BR": "Liberação do dono", "en": "Owner's release" },
      "description": { "pt-BR": "O dono libera a execução do plano.", "en": "The owner releases the plan for execution." },
      "kind": "owner",
      "outcomes": {
        "liberado": { "label": { "pt-BR": "Liberar execução", "en": "Release execution" }, "next": "executar" },
        "ajustes": { "label": { "pt-BR": "Pedir ajustes no plano", "en": "Ask for plan adjustments" }, "next": "planejar" }
      }
    },
    {
      "id": "executar",
      "title": { "pt-BR": "Executar fases", "en": "Run phases" },
      "description": { "pt-BR": "As fases do tasks.md, uma a uma: o mod fecha cada fase quando os portões passaram, as tarefas estão marcadas e o trabalho foi commitado.", "en": "The phases of tasks.md, one by one: the mod closes each phase once its gates passed, its tasks are ticked and its work is committed." },
      "kind": "loop",
      "over": "tasks",
      "outcomes": { "concluidas": { "label": { "pt-BR": "Fases concluídas", "en": "Phases done" }, "next": "revisao-codigo" } }
    },
    {
      "id": "revisao-codigo",
      "title": { "pt-BR": "Revisão de código", "en": "Code review" },
      "description": { "pt-BR": "Revisores conferem o código entregue.", "en": "Reviewers check the delivered code." },
      "kind": "session",
      "outcomes": {
        "aprovado": { "label": { "pt-BR": "Código aprovado", "en": "Code approved" }, "next": "checagem" },
        "rejeitado": { "label": { "pt-BR": "Código rejeitado", "en": "Code rejected" }, "next": "executar" }
      }
    },
    {
      "id": "checagem",
      "title": { "pt-BR": "Checagem final", "en": "Final check" },
      "description": { "pt-BR": "O mod vê o `scripts/check.sh` passar, com o evidence.md preenchido.", "en": "The mod watches `scripts/check.sh` pass, with evidence.md filled in." },
      "kind": "automatic",
      "command": "scripts/check.sh",
      "requiresEvidence": true,
      "outcomes": {
        "passou": { "label": { "pt-BR": "Passou", "en": "Passed" }, "next": "pr" },
        "falhou": { "label": { "pt-BR": "Falhou", "en": "Failed" }, "next": "executar" }
      }
    },
    {
      "id": "pr",
      "title": { "pt-BR": "PR", "en": "PR" },
      "description": { "pt-BR": "Uma sessão abre o PR da change.", "en": "A session opens the change's PR." },
      "kind": "session",
      "outcomes": { "aberto": { "label": { "pt-BR": "PR aberto", "en": "PR open" }, "next": "qa" } }
    },
    {
      "id": "qa",
      "title": { "pt-BR": "Em QA", "en": "In QA" },
      "description": { "pt-BR": "A change espera o QA; o dono diz se passou ou se pediu ajustes.", "en": "The change waits on QA; the owner says whether it passed or asked for adjustments." },
      "kind": "owner",
      "outcomes": {
        "aprovado": { "label": { "pt-BR": "QA aprovou", "en": "QA approved" }, "next": "producao" },
        "ajustes": { "label": { "pt-BR": "QA pediu ajustes", "en": "QA asked for adjustments" }, "next": "executar" }
      }
    },
    {
      "id": "producao",
      "title": { "pt-BR": "Em produção", "en": "In production" },
      "description": { "pt-BR": "A change chegou em produção: pelo botão do dono ou quando o mod vê o deploy.", "en": "The change reached production: by the owner's button or when the mod sees the deploy." },
      "kind": "owner",
      "detect": {
        "commands": ["npm run deploy", "pnpm run deploy", "yarn deploy", "bun run deploy", "vercel --prod", "vercel deploy --prod", "netlify deploy --prod", "fly deploy", "flyctl deploy", "firebase deploy", "gcloud app deploy", "railway up"],
        "outcome": "publicado"
      },
      "outcomes": { "publicado": { "label": { "pt-BR": "Está em produção", "en": "It is in production" }, "next": "arquivar" } }
    },
    {
      "id": "arquivar",
      "title": { "pt-BR": "Arquivar change", "en": "Archive change" },
      "description": { "pt-BR": "Uma sessão roda o `openspec archive`; quando passa, o mod arquiva as sessões restantes e remove o grupo da barra lateral.", "en": "A session runs `openspec archive`; when it passes, the mod archives the remaining sessions and removes the sidebar group." },
      "kind": "automatic",
      "command": "openspec archive",
      "cleanup": true,
      "outcomes": {
        "passou": { "label": { "pt-BR": "Arquivada", "en": "Archived" }, "next": "fim" },
        "falhou": { "label": { "pt-BR": "Falhou", "en": "Failed" }, "next": "arquivar" }
      }
    }
  ]
}
