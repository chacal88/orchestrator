/** The mod's default "rapido" flow, written as the JSON a project's `.orquestrador/flows/rapido.json` would hold. */
export const rapido: unknown = {
  "id": "rapido",
  "title": "Rápido",
  "description": "Para changes pequenas: plano curto (proposta e tarefas), fases, revisão de qualidade, checagem, PR, QA e produção.",
  "steps": [
    {
      "id": "planejar",
      "title": "Planejar OpenSpec",
      "description": "Uma sessão escreve só a proposta e as tarefas da change.",
      "kind": "session",
      "outcomes": {
        "pronto": {
          "label": "Plano escrito",
          "next": "validar"
        }
      }
    },
    {
      "id": "validar",
      "title": "Validar OpenSpec",
      "description": "O mod vê o `openspec validate` rodar; o código de saída decide.",
      "kind": "automatic",
      "command": "openspec validate",
      "outcomes": {
        "passou": {
          "label": "Validou",
          "next": "executar"
        },
        "falhou": {
          "label": "Falhou",
          "next": "planejar"
        }
      }
    },
    {
      "id": "executar",
      "title": "Executar fases",
      "description": "As fases do tasks.md, uma a uma; cada fase passa pelos seus portões.",
      "kind": "loop",
      "over": "tasks",
      "outcomes": {
        "concluidas": {
          "label": "Fases concluídas",
          "next": "revisao-codigo"
        }
      }
    },
    {
      "id": "revisao-codigo",
      "title": "Revisão de código",
      "description": "Revisão de qualidade do código entregue.",
      "kind": "session",
      "outcomes": {
        "aprovado": {
          "label": "Código aprovado",
          "next": "checagem"
        },
        "rejeitado": {
          "label": "Código rejeitado",
          "next": "executar"
        }
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
        "passou": {
          "label": "Passou",
          "next": "pr"
        },
        "falhou": {
          "label": "Falhou",
          "next": "executar"
        }
      }
    },
    {
      "id": "pr",
      "title": "PR",
      "description": "Uma sessão abre o PR da change.",
      "kind": "session",
      "outcomes": {
        "aberto": {
          "label": "PR aberto",
          "next": "qa"
        }
      }
    },
    {
      "id": "qa",
      "title": "Em QA",
      "description": "A change espera o QA; o dono diz se passou ou se pediu ajustes.",
      "kind": "owner",
      "outcomes": {
        "aprovado": {
          "label": "QA aprovou",
          "next": "producao"
        },
        "ajustes": {
          "label": "QA pediu ajustes",
          "next": "executar"
        }
      }
    },
    {
      "id": "producao",
      "title": "Em produção",
      "description": "A change chegou em produção: pelo botão do dono ou quando o mod vê o deploy.",
      "kind": "owner",
      "outcomes": {
        "publicado": {
          "label": "Está em produção",
          "next": "arquivar"
        }
      }
    },
    {
      "id": "arquivar",
      "title": "Arquivar change",
      "description": "Uma sessão roda o `openspec archive`; o mod vê o código de saída.",
      "kind": "automatic",
      "command": "openspec archive",
      "outcomes": {
        "passou": {
          "label": "Arquivada",
          "next": "fim"
        },
        "falhou": {
          "label": "Falhou",
          "next": "arquivar"
        }
      }
    }
  ]
}
