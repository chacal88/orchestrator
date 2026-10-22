# Merge pelo workflow

## Por quê

O dono não quer revisar PR no GitHub: quer que o workflow revise, teste, valide, faça o merge, gere a versão e
atualize o plugin. O agente `merge` só faz o merge com aprovação no GitHub e CI verde, então trava num repositório
sem revisão nem CI.

## O que muda

- Novo agente do plugin, `merge-pelo-workflow`: faz o merge quando o workflow aprovou (revisão de código do flow
  aprovada, portões finais passados, CI verde se houver), sem aprovação no GitHub, nunca com `--admin`.
- O mod recusa o merge do PR da change enquanto a revisão de código do flow antes do merge não estiver aprovada.
- O painel explica os dois agentes no passo Merge.
- Este repositório: Rápido (plugin) com a ordem acima, lint (tsc) como passo automático, merge e deploy automáticos
  herdados do `config.json`, sem a conferência do dono; `config.json` e `rapido.json` commitados.

Versão 0.11.0.
