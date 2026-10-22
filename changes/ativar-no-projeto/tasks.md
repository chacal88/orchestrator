## 1. Ativação local

- [x] 1.1 Ler e gravar a ativação em `.claude/settings.local.json` da raiz do repositório principal: marca `env.ORQUESTRADOR` (barrar/lembrar) e hook `SessionStart` marcado; desativar tira só isso; JSON inválido não é gravado; garantir que o arquivo esteja ignorado pelo git (exclude local); testes — cx: complex
- [x] 1.2 `isActive`: marca ou flow em andamento; sem isso, sem painel automático, faixa, contexto nem recusa de merge; "lembrar" troca recusa por aviso; testes de harness (inativo, ativo barrar, ativo lembrar, inativo com flow em andamento) — cx: complex

## 2. Painel

- [x] 2.1 Cartão "Este projeto" nos três estados do mockup (inativo, confirmação com nível e "O que é gravado", ativo com "Trocar para…" e "Desativar"); testes de harness nas superfícies — cx: moderate

## 3. Documentação e versão

- [ ] 3.1 README (ativar e desativar, o que é gravado, níveis), skill da coordenação (ativar antes de orquestrar), versão 0.10.0, evidence.md — cx: simple
