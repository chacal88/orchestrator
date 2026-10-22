import { expect, test } from 'claude-code/testing'

import { parseFlow } from '../hooks/flow'

/** A copy of this repository's .orquestrador/flows/rapido.json (the harness cannot read outside the plugin's folder): keep the two in step. */
const raw: unknown = 
{
  "id": "rapido",
  "title": "Rápido (plugin)",
  "description": "Flow rápido deste repositório de plugin: plano curto, validação, fases, revisão de código, testes e tipos, publicação no GitHub, merge e deploy automáticos e lançamento da versão, sem conferência do dono.",
  "steps": [
    {
      "id": "planejar",
      "title": "Planejar",
      "description": "Uma sessão escreve a proposta e as tarefas da change em changes/<change>/.",
      "kind": "session",
      "agent": "planejador",
      "outcomes": { "pronto": { "label": "Plano escrito", "next": "validar" } }
    },
    {
      "id": "validar",
      "title": "Validar o plugin",
      "description": "O mod vê o `claude plugin validate` rodar; o código de saída decide.",
      "kind": "automatic",
      "command": "plugin validate",
      "outcomes": {
        "passou": { "label": "Validou", "next": "executar" },
        "falhou": { "label": "Falhou", "next": "planejar" }
      }
    },
    {
      "id": "executar",
      "title": "Executar fases",
      "description": "As fases do tasks.md da change: cada uma fecha com os gates passando, as tarefas marcadas e o trabalho commitado.",
      "kind": "loop",
      "agent": "executor",
      "over": "tasks",
      "outcomes": { "concluidas": { "label": "Fases concluídas", "next": "revisao-codigo" } }
    },
    {
      "id": "revisao-codigo",
      "title": "Revisão",
      "description": "Revisão de qualidade do que vai ficar público. Quem aprova o merge neste flow.",
      "kind": "session",
      "agent": "revisor-codigo",
      "outcomes": {
        "aprovado": { "label": "Aprovado", "next": "checagem" },
        "rejeitado": { "label": "Rejeitado", "next": "executar" }
      }
    },
    {
      "id": "checagem",
      "title": "Checagem final",
      "description": "O mod vê o `claude plugin test` passar, com o evidence.md da change preenchido.",
      "kind": "automatic",
      "command": "plugin test",
      "requiresEvidence": true,
      "outcomes": {
        "passou": { "label": "Passou", "next": "tipos" },
        "falhou": { "label": "Falhou", "next": "executar" }
      }
    },
    {
      "id": "tipos",
      "title": "Tipos",
      "description": "O mod vê o `tsc` passar sobre o código do plugin; o código de saída decide.",
      "kind": "automatic",
      "command": "tsc",
      "outcomes": {
        "passou": { "label": "Passou", "next": "publicar" },
        "falhou": { "label": "Falhou", "next": "executar" }
      }
    },
    {
      "id": "publicar",
      "title": "Publicar no GitHub",
      "description": "Uma sessão envia a branch ao GitHub e abre o PR da change, que o merge seguinte usa.",
      "kind": "session",
      "agent": "publicador",
      "jira": false,
      "outcomes": { "publicado": { "label": "PR publicado", "next": "merge" } }
    },
    {
      "id": "merge",
      "title": "Merge em main",
      "description": "O PR da change entra em main quando o workflow aprovou: revisão de código aprovada, portões finais passados e CI verde se houver.",
      "kind": "automatic",
      "command": "gh pr merge",
      "agent": "merge-pelo-workflow",
      "merge": { "branch": "main" },
      "outcomes": {
        "passou": { "label": "Mergeado", "next": "deploy" },
        "falhou": { "label": "Falhou", "next": "merge" }
      }
    },
    {
      "id": "deploy",
      "title": "Deploy",
      "description": "Atualiza o plugin instalado pelas rotinas do projeto, logo depois do merge.",
      "kind": "automatic",
      "command": "claude plugin marketplace update orquestrador",
      "agent": "deploy",
      "deploy": {},
      "outcomes": {
        "passou": { "label": "Publicado", "next": "lancar" },
        "falhou": { "label": "Falhou", "next": "deploy" }
      }
    },
    {
      "id": "lancar",
      "title": "Lançar a versão",
      "description": "Uma sessão cria o release no GitHub; quando passa, o mod arquiva as sessões restantes e remove o grupo da barra lateral.",
      "kind": "automatic",
      "command": "gh release create",
      "cleanup": true,
      "jira": false,
      "outcomes": {
        "passou": { "label": "Versão lançada", "next": "fim" },
        "falhou": { "label": "Falhou", "next": "lancar" }
      }
    }
  ]
};

/** What this repository's config.json sets for merge and deploy. */
const PROJECT = {
  merge: { auto: true },
  deploy: { auto: true, ci: false, commands: ['claude plugin marketplace update orquestrador', 'claude plugin update orquestrador@orquestrador'] },
}

test("this repository's rapido.json resolves, in the order of the change, with merge and deploy following config.json", () => {
  const flow = parseFlow(raw, '.orquestrador/flows/rapido.json', PROJECT)
  if ('error' in flow) throw new Error(flow.error)
  expect(flow.steps.map(s => s.id)).toEqual([
    'planejar', 'validar', 'executar', 'revisao-codigo', 'checagem', 'tipos', 'publicar', 'merge', 'deploy', 'lancar',
  ])
  const step = (id: string) => flow.steps.find(s => s.id === id)!
  expect(step('tipos')).toMatchObject({ kind: 'automatic', command: 'tsc' })
  expect(step('tipos').outcomes.falhou!.next).toBe('executar')
  expect(step('merge')).toMatchObject({ kind: 'automatic', agent: 'merge-pelo-workflow', merge: { branch: 'main', method: 'squash', auto: true } })
  expect(step('merge').merge?.fromProject).toEqual(['auto'])
  expect(step('deploy')).toMatchObject({
    kind: 'automatic',
    deploy: { ci: false, auto: true, commands: PROJECT.deploy.commands },
  })
  expect(step('lancar').outcomes.passou!.next).toBe('fim')
  expect(flow.steps.some(s => s.id === 'qa')).toBe(false)
})
