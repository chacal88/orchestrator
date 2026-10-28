/** The mod's default "completo" flow, in both languages, written as the JSON a project's `.orchestrator/flows/completo.json` would hold. */
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
      "details": { "inputs": { "pt-BR": "O pedido do dono e o que o repositório já tem sobre o assunto.", "en": "The owner's request and what the repository already has on the subject." }, "produces": { "pt-BR": "O grill.md com as rodadas e os critérios de aceite.", "en": "grill.md with the rounds and the acceptance criteria." }, "blocks": { "pt-BR": "Nada se planeja antes de o dono fechar o entendimento.", "en": "Nothing is planned before the owner settles the understanding." } },
      "outcomes": { "fechado": { "label": { "pt-BR": "Entendimento fechado", "en": "Understanding settled" }, "next": "mockup" } }
    },
    {
      "id": "mockup",
      "title": { "pt-BR": "Mockup", "en": "Mockup" },
      "description": { "pt-BR": "Só quando a change é visual: o dono aprova o mockup ou pede ajustes.", "en": "Only when the change is visual: the owner approves the mockup or asks for adjustments." },
      "kind": "owner",
      "details": { "inputs": { "pt-BR": "O entendimento fechado de uma change visual.", "en": "The settled understanding of a visual change." }, "produces": { "pt-BR": "O mockup aprovado pelo dono.", "en": "The mockup approved by the owner." }, "blocks": { "pt-BR": "Pedir ajustes refaz o mockup; o plano espera a aprovação.", "en": "Asking for adjustments redoes the mockup; the plan waits for the approval." } },
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
      "agent": "planner",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": { "inputs": { "pt-BR": "O entendimento (grill.md) e, se houver, o mockup aprovado.", "en": "The understanding (grill.md) and, if any, the approved mockup." }, "produces": { "pt-BR": "proposal.md, design.md e tasks.md da change.", "en": "The change's proposal.md, design.md and tasks.md." }, "blocks": { "pt-BR": "Sem plano escrito, não há validação.", "en": "Without a written plan, there is no validation." } },
      "outcomes": { "pronto": { "label": { "pt-BR": "Plano escrito", "en": "Plan written" }, "next": "validar" } }
    },
    {
      "id": "validar",
      "title": { "pt-BR": "Validar OpenSpec", "en": "Validate OpenSpec" },
      "description": { "pt-BR": "O mod vê o `openspec validate` rodar; o código de saída decide.", "en": "The mod watches `openspec validate` run; its exit code decides." },
      "kind": "automatic",
      "details": { "inputs": { "pt-BR": "Os arquivos OpenSpec da change.", "en": "The change's OpenSpec files." }, "produces": { "pt-BR": "O `openspec validate` com saída 0.", "en": "`openspec validate` exiting 0." }, "blocks": { "pt-BR": "Falhou volta ao planejar.", "en": "Failed goes back to planning." } },
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
      "agent": "plan-reviewer",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": { "inputs": { "pt-BR": "O plano validado, as regras do repositório e as specs.", "en": "The validated plan, the repository's rules and the specs." }, "produces": { "pt-BR": "Veredito aprovado/rejeitado com os achados.", "en": "An approved/rejected verdict with the findings." }, "blocks": { "pt-BR": "Rejeitado volta ao planejar.", "en": "Rejected goes back to planning." } },
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
      "details": { "inputs": { "pt-BR": "O plano revisado.", "en": "The reviewed plan." }, "produces": { "pt-BR": "A liberação do dono para executar.", "en": "The owner's release to execute." }, "blocks": { "pt-BR": "Nenhuma fase começa sem a liberação.", "en": "No phase starts without the release." } },
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
      "agent": "executor",
      "details": { "inputs": { "pt-BR": "O tasks.md liberado.", "en": "The released tasks.md." }, "produces": { "pt-BR": "Cada fase com os portões passados, as tarefas marcadas e o trabalho commitado.", "en": "Each phase with its gates passed, its tasks ticked and its work committed." }, "blocks": { "pt-BR": "A revisão de código só começa com todas as fases fechadas.", "en": "The code review starts only once every phase is closed." } },
      "over": "tasks",
      "outcomes": { "concluidas": { "label": { "pt-BR": "Fases concluídas", "en": "Phases done" }, "next": "revisao-codigo" } }
    },
    {
      "id": "revisao-codigo",
      "title": { "pt-BR": "Revisão de código", "en": "Code review" },
      "description": { "pt-BR": "Revisores conferem o código entregue.", "en": "Reviewers check the delivered code." },
      "kind": "session",
      "agent": "code-reviewer",
      "model": "claude-opus-5-5",
      "effort": "high",
      "details": { "inputs": { "pt-BR": "O diff da change e o tasks.md marcado.", "en": "The change's diff and the ticked tasks.md." }, "produces": { "pt-BR": "Veredito aprovado/rejeitado com achados por arquivo:linha.", "en": "An approved/rejected verdict with findings by file:line." }, "blocks": { "pt-BR": "Rejeitado volta ao executar.", "en": "Rejected goes back to execution." } },
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
      "details": { "inputs": { "pt-BR": "O código aprovado e o evidence.md preenchido.", "en": "The approved code and evidence.md filled in." }, "produces": { "pt-BR": "O `scripts/check.sh` com saída 0.", "en": "`scripts/check.sh` exiting 0." }, "blocks": { "pt-BR": "Falhou volta ao executar; sem evidence.md não passa.", "en": "Failed goes back to execution; without evidence.md it does not pass." } },
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
      "agent": "pr-opener",
      "model": "claude-sonnet-5-5",
      "effort": "medium",
      "details": { "inputs": { "pt-BR": "A branch da change com a checagem passada.", "en": "The change's branch with the check passed." }, "produces": { "pt-BR": "O PR aberto, com o resumo e a evidência.", "en": "The open PR, with the summary and the evidence." }, "blocks": { "pt-BR": "QA e produção esperam o PR.", "en": "QA and production wait on the PR." } },
      "outcomes": { "aberto": { "label": { "pt-BR": "PR aberto", "en": "PR open" }, "next": "qa" } }
    },
    {
      "id": "qa",
      "title": { "pt-BR": "Em QA", "en": "In QA" },
      "description": { "pt-BR": "A change espera o QA; o dono diz se passou ou se pediu ajustes.", "en": "The change waits on QA; the owner says whether it passed or asked for adjustments." },
      "kind": "owner",
      "details": { "inputs": { "pt-BR": "O PR aberto e o ambiente de QA.", "en": "The open PR and the QA environment." }, "produces": { "pt-BR": "O veredito do QA, dado pelo dono.", "en": "QA's verdict, given by the owner." }, "blocks": { "pt-BR": "Ajustes pedidos voltam ao executar.", "en": "Adjustments asked go back to execution." } },
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
      "details": { "inputs": { "pt-BR": "A change aprovada no QA.", "en": "The change approved in QA." }, "produces": { "pt-BR": "A change em produção, pelo botão do dono ou pelo deploy visto.", "en": "The change in production, by the owner's button or the deploy seen." }, "blocks": { "pt-BR": "A change só se arquiva depois de publicada.", "en": "The change is archived only once published." } },
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
      "details": { "inputs": { "pt-BR": "A change publicada.", "en": "The change published." }, "produces": { "pt-BR": "O `openspec archive` com saída 0, as sessões arquivadas e o grupo removido.", "en": "`openspec archive` exiting 0, the sessions archived and the group removed." }, "blocks": { "pt-BR": "Falhou tenta de novo.", "en": "Failed tries again." } },
      "command": "openspec archive",
      "cleanup": true,
      "outcomes": {
        "passou": { "label": { "pt-BR": "Arquivada", "en": "Archived" }, "next": "fim" },
        "falhou": { "label": { "pt-BR": "Falhou", "en": "Failed" }, "next": "arquivar" }
      }
    }
  ]
}
