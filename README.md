# Orquestrador

Plugin para o Claude Code que orquestra uma change com várias sessões em paralelo e mostra tudo num painel lateral: em que passo o trabalho está, o que cada sessão está fazendo, quais gates de qualidade passaram e o que espera uma decisão sua.

*A Claude Code plugin (mod) that orchestrates a change across parallel sessions through a declared flow, with a live side panel and owner decisions as panel buttons. The UI speaks Brazilian Portuguese or English, set per project (see "Idioma").*

## O que ele faz

- **Flow declarado.** O trabalho segue um flow escrito em arquivo, passo a passo. Cada passo diz quem responde:
  - **sessão:** uma sessão faz o trabalho e informa o resultado;
  - **automático:** o mod observa um comando rodar, e o código de saída decide;
  - **dono:** só um clique seu no painel responde, e nenhuma sessão responde por você.
- **Dois flows prontos:**
  - `completo`: grill → mockup → plano OpenSpec → validação → revisão do plano → liberação do dono pelo plan mode → fases → revisão de código → checagem final → PR → QA → produção → arquivamento;
  - `rapido`, para correções pequenas.
  - Um projeto pode ter flows próprios em `.orquestrador/flows/*.json`.
- **Gates de qualidade por fase.** São checagens como testes, lint, `check.sh`, `openspec validate`, print da tela e revisão de regras:
  - **comprovação:** o mod só aceita um gate quando vê o comando rodar e passar;
  - **validade:** editar arquivos depois da comprovação desatualiza o gate;
  - **pulo:** só você pula um gate, com dois cliques.
- **Painel lateral (`/orquestrador`).** Mostra o andamento da change, o OpenSpec (proposta, tarefas e evidência), os gates do flow, o que precisa de você e as tarefas de cada fase com a sessão que as executa. Uma faixa acima do campo de mensagem resume o estado.
- **Grill com respostas no painel.** As rodadas de perguntas viram critérios de aceite, e você responde cada pergunta num campo do próprio painel.
- **Sessões em paralelo.** Cada fase roda numa sessão própria, com teto de 3 sessões vivas. As sessões entram sozinhas no grupo da change na barra lateral e são arquivadas quando a fase fecha.
- **Jira com o seu ok.** O painel avisa quando uma issue deve mudar de estado e só a move depois do seu clique.

A skill `change-orchestrator`, que vem junto, ensina a sessão coordenadora a seguir o flow: ela pergunta ao mod qual é o próximo passo em vez de decidir sozinha.

## Requisitos

- Claude Code com suporte a mods (plugins de function hooks).
- O app desktop do Claude Code para a experiência completa: painel lateral, plan mode e gestão de sessões e da barra lateral. No terminal, o painel e o flow funcionam, mas as ações sobre outras sessões dependem das ferramentas do app.
- Opcional: OpenSpec no projeto e o conector Atlassian para o Jira.

## Instalação

Dentro do Claude Code:

```
/plugin marketplace add chacal88/orquestrador
```

```
/plugin install orquestrador@orquestrador
```

Ou pelo terminal:

```bash
claude plugin marketplace add chacal88/orquestrador
```

```bash
claude plugin install orquestrador@orquestrador
```

Depois de instalar, reinicie o app ou rode `/reload-plugins`.

## Uso

1. Peça à sessão para orquestrar uma change, ou use a skill `change-orchestrator`.
2. Escolha o flow (`completo` ou `rapido`) e abra o painel com `/orquestrador`.
3. Acompanhe pelo painel e responda os seus passos pelos botões.

### Flows próprios

Crie `.orquestrador/flows/<id>.json` no repositório. Um flow do projeto com o mesmo `id` de um flow padrão substitui o padrão. Formato:

```json
{
  "id": "investigacao",
  "title": "Investigação",
  "description": "Descobrir a causa de um problema.",
  "steps": [
    { "id": "grill", "title": "Entendimento", "kind": "owner",
      "outcomes": { "fechado": { "label": "Entendimento fechado", "next": "investigar" } } },
    { "id": "investigar", "title": "Investigar", "kind": "session",
      "outcomes": { "concluido": { "label": "Fatos levantados", "next": "revisao" } } },
    { "id": "revisao", "title": "Revisão do dono", "kind": "owner",
      "outcomes": { "aprovado": { "label": "Aprovar", "next": "fim" },
                    "aprofundar": { "label": "Aprofundar", "next": "investigar" } } }
  ]
}
```

Tipos de passo: `session`, `automatic` (com `command`), `owner` e `loop` (sobre as fases do `tasks.md`). Campos opcionais: `maxAttempts` (padrão 3, depois escala para o dono), `when: "visual"`, `detect`, `cleanup` e `jira`.

`title`, `description` e `label` aceitam texto simples ou um texto por idioma, como `{ "pt-BR": "Investigar", "en": "Investigate" }`. Quando falta o idioma pedido, o painel usa o outro.

### Idioma

Cada projeto escolhe o idioma em `.orquestrador/config.json`, em dois eixos independentes:

```json
{ "language": { "ui": "en", "content": "pt-BR" } }
```

- **`ui`, caixas e títulos:** cabeçalhos das caixas, botões, status, a faixa acima do prompt, os avisos, os títulos dos passos do flow e os rótulos das respostas.
- **`content`, descrições e textos da change:** a descrição do flow e de cada passo. Também o idioma em que a sessão coordenadora escreve proposta, tarefas, perguntas do grill, títulos e notas das fases e perguntas ao dono. O mod informa esse idioma nas respostas das ferramentas `flow` e `plano`.

Idiomas: `pt-BR` e `en`. `"language": "en"` vale para os dois eixos. Sem o arquivo, fica `pt-BR` nos dois. Um valor desconhecido também fica em `pt-BR`, e o painel avisa. O exemplo acima mostra as fases em inglês e os textos dos itens em português.

## Desenvolvimento

O código fica em `orquestrador/hooks/`, os tipos em `orquestrador/types/` e os testes em `orquestrador/tests/`.

```bash
claude plugin test orquestrador
```

```bash
claude plugin validate orquestrador
```

O plano e o histórico de decisões estão em `orquestrador/proposal.md`, `orquestrador/tasks.md` e `orquestrador/evidence.md`.

## Licença

MIT. Veja [LICENSE](LICENSE).
