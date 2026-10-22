/** The mod's default "rapido" flow, in both languages, written as the JSON a project's `.orquestrador/flows/rapido.json` would hold. */
export const rapido: unknown = {
  "id": "rapido",
  "title": { "pt-BR": "Rápido", "en": "Fast" },
  "description": { "pt-BR": "Para changes pequenas: plano curto (proposta e tarefas), fases, revisão de qualidade, checagem, PR, QA e produção.", "en": "For small changes: a short plan (proposal and tasks), phases, quality review, final check, PR, QA and production." },
  "steps": [
    {
      "id": "planejar",
      "title": { "pt-BR": "Planejar OpenSpec", "en": "Plan OpenSpec" },
      "description": { "pt-BR": "Uma sessão escreve só a proposta e as tarefas da change.", "en": "A session writes only the change's proposal and tasks." },
      "kind": "session",
      "agent": "planejador",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": {"inputs": "O pedido do dono para uma change pequena.", "produces": "proposal.md e tasks.md da change.", "blocks": "Sem plano escrito, não há validação."},
      "outcomes": {
        "pronto": {
          "label": { "pt-BR": "Plano escrito", "en": "Plan written" },
          "next": "validar"
        }
      }
    },
    {
      "id": "validar",
      "title": { "pt-BR": "Validar OpenSpec", "en": "Validate OpenSpec" },
      "description": { "pt-BR": "O mod vê o `openspec validate` rodar; o código de saída decide.", "en": "The mod watches `openspec validate` run; its exit code decides." },
      "kind": "automatic",
      "details": {"inputs": "Os arquivos OpenSpec da change.", "produces": "O `openspec validate` com saída 0.", "blocks": "Falhou volta ao planejar."},
      "command": "openspec validate",
      "outcomes": {
        "passou": {
          "label": { "pt-BR": "Validou", "en": "Validated" },
          "next": "executar"
        },
        "falhou": {
          "label": { "pt-BR": "Falhou", "en": "Failed" },
          "next": "planejar"
        }
      }
    },
    {
      "id": "executar",
      "title": { "pt-BR": "Executar fases", "en": "Run phases" },
      "description": { "pt-BR": "As fases do tasks.md, uma a uma: o mod fecha cada fase quando os portões passaram, as tarefas estão marcadas e o trabalho foi commitado.", "en": "The phases of tasks.md, one by one: the mod closes each phase once its gates passed, its tasks are ticked and its work is committed." },
      "kind": "loop",
      "agent": "executor",
      "details": {"inputs": "O tasks.md liberado.", "produces": "Cada fase com os portões passados, as tarefas marcadas e o trabalho commitado.", "blocks": "A revisão de código só começa com todas as fases fechadas."},
      "over": "tasks",
      "outcomes": {
        "concluidas": {
          "label": { "pt-BR": "Fases concluídas", "en": "Phases done" },
          "next": "revisao-codigo"
        }
      }
    },
    {
      "id": "revisao-codigo",
      "title": { "pt-BR": "Revisão de código", "en": "Code review" },
      "description": { "pt-BR": "Revisão de qualidade do código entregue.", "en": "Quality review of the delivered code." },
      "kind": "session",
      "agent": "revisor-codigo",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": {"inputs": "O diff da change e o tasks.md marcado.", "produces": "Veredito aprovado/rejeitado com achados por arquivo:linha.", "blocks": "Rejeitado volta ao executar."},
      "outcomes": {
        "aprovado": {
          "label": { "pt-BR": "Código aprovado", "en": "Code approved" },
          "next": "checagem"
        },
        "rejeitado": {
          "label": { "pt-BR": "Código rejeitado", "en": "Code rejected" },
          "next": "executar"
        }
      }
    },
    {
      "id": "checagem",
      "title": { "pt-BR": "Checagem final", "en": "Final check" },
      "description": { "pt-BR": "O mod vê o `scripts/check.sh` passar, com o evidence.md preenchido.", "en": "The mod watches `scripts/check.sh` pass, with evidence.md filled in." },
      "kind": "automatic",
      "details": {"inputs": "O código aprovado e o evidence.md preenchido.", "produces": "O `scripts/check.sh` com saída 0.", "blocks": "Falhou volta ao executar; sem evidence.md não passa."},
      "command": "scripts/check.sh",
      "requiresEvidence": true,
      "outcomes": {
        "passou": {
          "label": { "pt-BR": "Passou", "en": "Passed" },
          "next": "pr"
        },
        "falhou": {
          "label": { "pt-BR": "Falhou", "en": "Failed" },
          "next": "executar"
        }
      }
    },
    {
      "id": "pr",
      "title": { "pt-BR": "PR", "en": "PR" },
      "description": { "pt-BR": "Uma sessão abre o PR da change.", "en": "A session opens the change's PR." },
      "kind": "session",
      "agent": "abre-pr",
      "model": "claude-sonnet-5-5",
      "effort": "medium",
      "details": {"inputs": "A branch da change com a checagem passada.", "produces": "O PR aberto, com o resumo e a evidência.", "blocks": "QA e produção esperam o PR."},
      "outcomes": {
        "aberto": {
          "label": { "pt-BR": "PR aberto", "en": "PR open" },
          "next": "qa"
        }
      }
    },
    {
      "id": "qa",
      "title": { "pt-BR": "Em QA", "en": "In QA" },
      "description": { "pt-BR": "A change espera o QA; o dono diz se passou ou se pediu ajustes.", "en": "The change waits on QA; the owner says whether it passed or asked for adjustments." },
      "kind": "owner",
      "details": {"inputs": "O PR aberto e o ambiente de QA.", "produces": "O veredito do QA, dado pelo dono.", "blocks": "Ajustes pedidos voltam ao executar."},
      "outcomes": {
        "aprovado": {
          "label": { "pt-BR": "QA aprovou", "en": "QA approved" },
          "next": "producao"
        },
        "ajustes": {
          "label": { "pt-BR": "QA pediu ajustes", "en": "QA asked for adjustments" },
          "next": "executar"
        }
      }
    },
    {
      "id": "producao",
      "title": { "pt-BR": "Em produção", "en": "In production" },
      "description": { "pt-BR": "A change chegou em produção: pelo botão do dono ou quando o mod vê o deploy.", "en": "The change reached production: by the owner's button or when the mod sees the deploy." },
      "kind": "owner",
      "details": {"inputs": "A change aprovada no QA.", "produces": "A change em produção, pelo botão do dono ou pelo deploy visto.", "blocks": "A change só se arquiva depois de publicada."},
      "detect": {
        "commands": ["npm run deploy", "pnpm run deploy", "yarn deploy", "bun run deploy", "vercel --prod", "vercel deploy --prod", "netlify deploy --prod", "fly deploy", "flyctl deploy", "firebase deploy", "gcloud app deploy", "railway up"],
        "outcome": "publicado"
      },
      "outcomes": {
        "publicado": {
          "label": { "pt-BR": "Está em produção", "en": "It is in production" },
          "next": "arquivar"
        }
      }
    },
    {
      "id": "arquivar",
      "title": { "pt-BR": "Arquivar change", "en": "Archive change" },
      "description": { "pt-BR": "Uma sessão roda o `openspec archive`; quando passa, o mod arquiva as sessões restantes e remove o grupo da barra lateral.", "en": "A session runs `openspec archive`; when it passes, the mod archives the remaining sessions and removes the sidebar group." },
      "kind": "automatic",
      "details": {"inputs": "A change publicada.", "produces": "O `openspec archive` com saída 0, as sessões arquivadas e o grupo removido.", "blocks": "Falhou tenta de novo."},
      "command": "openspec archive",
      "cleanup": true,
      "outcomes": {
        "passou": {
          "label": { "pt-BR": "Arquivada", "en": "Archived" },
          "next": "fim"
        },
        "falhou": {
          "label": { "pt-BR": "Falhou", "en": "Failed" },
          "next": "arquivar"
        }
      }
    }
  ]
}
