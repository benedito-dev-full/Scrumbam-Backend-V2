# Índice Mestre — Issues `evolution-from-v2` no Devari-Core

**Atualizado por:** Documenter (após cada PR fora-do-pipeline) + Strategist (consolidação por fase)
**Decisão:** ADR-V2-017 — V2 como piloto-vivo do Devari-Core
**Audiência:** Tech Lead + CEO + futuros mantenedores do Devari-Core

> Cada PR do V2 que implementa funcionalidade fora do escopo de `devari-saas-generator.md` gera 1 issue no Devari-Core com label `evolution-from-v2`. Este arquivo rastreia TODAS, ordenadas por data e categoria. Reviewer audita a cada fase. Em F17 (pós-launch), Strategist consolida em `EVOLUCAO-DEVARI-CORE-V3.md`.

---

## Sumário (atualizar a cada fase)

| Categoria | Issues abertas | Issues mergeadas no Devari-Core | Pendentes |
|-----------|----------------|----------------------------------|-----------|
| Channels (Telegram + Voz Groq) | 0 | 0 | 0 |
| MCP Server | 0 | 0 | 0 |
| Webhooks outbound HMAC | 0 | 0 | 0 |
| Automation (Agent + Risk Gate + Approval Flow + PR auto-open) | 0 | 0 | 0 |
| V3 Intentions (campos DTask) | 0 | 0 | 0 |
| Flow Metrics + Forecast (genéricos) | 0 | 0 | 0 |
| DVFS (DEntidade.dados Json, validação Risk Gate) | 0 | 0 | 0 |
| Score gate / Workflow Orchestrator (multi-agent) | 0 | 0 | 0 |
| Outros | 0 | 0 | 0 |
| **TOTAL** | **0** | **0** | **0** |

---

## Issues abertas (cronológico)

> Formato: `#NNN | YYYY-MM-DD | Fase | Categoria | Título | Status`

(Vazio. Primeira issue será aberta em F0 ou F1.)

---

## Como abrir uma issue

Documenter (no commit conforme Conventional Commits):

```
feat(channels): adiciona pareamento Telegram via DTabela TTL

- ...

- Generator-impact: Channels não existe no template-atual; Telegram cobre 6 SaaS conhecidos
- Evolution-issue: https://github.com/devaritec/devari-core/issues/NNN

Closes #SCR-V2-XX
```

Issue no Devari-Core (template):

```
Título: [V2] Channels — proposta de evolução do template
Labels: evolution-from-v2, area/channels

## Contexto
V2 (Scrumban-Backend-V2) implementou pareamento Telegram via DTabela idClasse=-474 PAIRING_TOKEN com TTL.

## O que cabe nas 17 tabelas + 3 Pilares
- Pairing token: DTabela (sem tabela própria) — Pilar 3 ✅
- Mensagens recebidas: DEvento idClasse=-493 TELEGRAM_MSG_IN — Pilar 3 ✅
- Link user-chat: DVincula idClasse=-186 — Pilar 3 ✅
- Endpoints reusam /tabelas e /entidades — Pilar 2 ✅

## Sugestão de evolução
Promover a `src/channels/` (camada genérica + Telegram adapter) como **módulo opt-in** do template Devari-Core, com:
- DClasses fixas: -450..-456 (CHANNEL + 6 folhas)
- Rule nova: `devari-channels.md` em `.claude/rules/`
- Template B2B-with-bot derivado de B2B

## Métricas
- LOC adaptadas no V2: NNNN (X% boilerplate canônico)
- Tempo: Y dias
- Aplicável a: 6+ SaaS conhecidos (gestão ágil, CRM, suporte, agendamento)
```

---

## Cadência de absorção pelo Devari-Core

- **Trimestral:** Tech Lead aloca 1 semana por trimestre para mergear PRs `evolution-from-v2` aprovados
- **Mês 1 pós-launch (F17):** sessão de 1 semana DEDICADA ao Devari-Core para absorver os aprendizados acumulados do V2 e gerar `EVOLUCAO-DEVARI-CORE-V3.md`

**DoD de F17:** ≥ 5 PRs reais merged + ≥ 5 PRs reais abertos (em revisão).
