/** The mod's default "rapido" flow, in both languages, written as the JSON a project's `.orchestrator/flows/rapido.json` would hold. */
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
      "agent": "planner",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": { "inputs": { "pt-BR": "O pedido do dono para uma change pequena.", "en": "The owner's request for a small change." }, "produces": { "pt-BR": "proposal.md e tasks.md da change.", "en": "The change's proposal.md and tasks.md." }, "blocks": { "pt-BR": "Sem plano escrito, não há validação.", "en": "Without a written plan, there is no validation." } },
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
      "details": { "inputs": { "pt-BR": "Os arquivos OpenSpec da change.", "en": "The change's OpenSpec files." }, "produces": { "pt-BR": "O `openspec validate` com saída 0.", "en": "`openspec validate` exiting 0." }, "blocks": { "pt-BR": "Falhou volta ao planejar.", "en": "Failed goes back to planning." } },
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
      "details": { "inputs": { "pt-BR": "O tasks.md liberado.", "en": "The released tasks.md." }, "produces": { "pt-BR": "Cada fase com os portões passados, as tarefas marcadas e o trabalho commitado.", "en": "Each phase with its gates passed, its tasks ticked and its work committed." }, "blocks": { "pt-BR": "A revisão de código só começa com todas as fases fechadas.", "en": "The code review starts only once every phase is closed." } },
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
      "agent": "code-reviewer",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": { "inputs": { "pt-BR": "O diff da change e o tasks.md marcado.", "en": "The change's diff and the ticked tasks.md." }, "produces": { "pt-BR": "Veredito aprovado/rejeitado com achados por arquivo:linha.", "en": "An approved/rejected verdict with findings by file:line." }, "blocks": { "pt-BR": "Rejeitado volta ao executar.", "en": "Rejected goes back to execution." } },
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
      "details": { "inputs": { "pt-BR": "O código aprovado e o evidence.md preenchido.", "en": "The approved code and evidence.md filled in." }, "produces": { "pt-BR": "O `scripts/check.sh` com saída 0.", "en": "`scripts/check.sh` exiting 0." }, "blocks": { "pt-BR": "Falhou volta ao executar; sem evidence.md não passa.", "en": "Failed goes back to execution; without evidence.md it does not pass." } },
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
      "agent": "pr-opener",
      "model": "claude-sonnet-5-5",
      "effort": "medium",
      "details": { "inputs": { "pt-BR": "A branch da change com a checagem passada.", "en": "The change's branch with the check passed." }, "produces": { "pt-BR": "O PR aberto, com o resumo e a evidência.", "en": "The open PR, with the summary and the evidence." }, "blocks": { "pt-BR": "QA e produção esperam o PR.", "en": "QA and production wait on the PR." } },
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
      "details": { "inputs": { "pt-BR": "O PR aberto e o ambiente de QA.", "en": "The open PR and the QA environment." }, "produces": { "pt-BR": "O veredito do QA, dado pelo dono.", "en": "QA's verdict, given by the owner." }, "blocks": { "pt-BR": "Ajustes pedidos voltam ao executar.", "en": "Adjustments asked go back to execution." } },
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
      "details": { "inputs": { "pt-BR": "A change aprovada no QA.", "en": "The change approved in QA." }, "produces": { "pt-BR": "A change em produção, pelo botão do dono ou pelo deploy visto.", "en": "The change in production, by the owner's button or the deploy seen." }, "blocks": { "pt-BR": "A change só se arquiva depois de publicada.", "en": "The change is archived only once published." } },
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
      "details": { "inputs": { "pt-BR": "A change publicada.", "en": "The change published." }, "produces": { "pt-BR": "O `openspec archive` com saída 0, as sessões arquivadas e o grupo removido.", "en": "`openspec archive` exiting 0, the sessions archived and the group removed." }, "blocks": { "pt-BR": "Falhou tenta de novo.", "en": "Failed tries again." } },
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
