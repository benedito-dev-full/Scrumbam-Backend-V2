# Scrumban Backend V2

> Refundação canônica do Scrumban Backend sob o template **Devari-Core**.
> 17 tabelas canônicas, 3 Pilares ativos, ZERO tabela nova.

[![Status](https://img.shields.io/badge/status-F0_in_progress-yellow)]()
[![Template](https://img.shields.io/badge/template-Devari--Core_canonical-blue)]()
[![Stack](https://img.shields.io/badge/stack-NestJS_+_Prisma_+_BullMQ-red)]()

## O que é

V2 mantém **100% do escopo do Scrumban-hoje** (128 endpoints, V3 intentions, flow metrics, forecast, MCP, Telegram com voz Groq, Webhooks HMAC, Automation Claude Code) refeito sob disciplina canônica:

- **17 tabelas** Devari-Core (DClasse, DEntidade, DTabela, DVincula, DEvento, DRecurso, DUserGroup, DPermissao, DTask, DProject, DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS)
- **3 Pilares** sempre ativos (Engine + Endpoints Genéricos + Seed)
- **Pilar 1 ATIVADO** via `OperacaoExecucaoClaude` (estende `OperacaoPedido` — coração técnico do V2)
- **DClasses polimórficas** representam tudo que o legado fazia com 5 tabelas próprias

## Documentação

| Quando você precisar de... | abra... |
|---|---|
| Visão geral, decisões, gates, workflow | [`docs/plano/00-PLANO-MESTRE.md`](docs/plano/00-PLANO-MESTRE.md) |
| Sub-planos detalhados (17 fases) | `docs/plano/01-FUNDACAO.md` ... `04-HARDENING-HANDOFF.md` |
| Auditorias (PARTE-1/2/3 vs plano) | `docs/auditoria/` |
| ADRs | `docs/decisions/` |
| Fontes primárias do escopo + arquitetura | `docs/spec/README.md` |
| Workflow multi-agent (4 agents + hooks) | `.claude/agents/README.md` + `CLAUDE.md` |
| Regras canônicas Devari-Core | `.claude/rules/devari-*.md` |

## Setup local (F0 — em andamento)

```bash
# 1. Subir Postgres + Redis
make db-up

# 2. Instalar dependências
make install

# 3. Rodar migrations + seed (F1)
make migrate
make seed

# 4. Iniciar dev
make dev
```

## Comandos make

| comando | descrição |
|---------|-----------|
| `make install` | npm install + prisma generate |
| `make dev` | inicia em watch mode |
| `make build` | build de produção |
| `make test` | unit + integration |
| `make lint` | ESLint + auto-fix |
| `make typecheck` | TS strict check |
| `make seed` | seed de classes + dados base |
| `make migrate` | prisma migrate dev |
| `make db-up` / `make db-down` | docker-compose Postgres+Redis |
| `make db-reset` | reset completo |

## Stack

- **NestJS 10** + **TypeScript 5** strict mode
- **Prisma 5** + Postgres 16
- **BullMQ** + Redis 7 (filas + cache)
- **JWT** + Passport (auth)
- **Swagger** automático
- **class-validator** + **class-transformer** (DTOs)
- **Decimal.js** (valores monetários)
- **Luxon** (timezone America/Sao_Paulo)

## Regras de ouro V2 (não-negociáveis)

1. **ZERO tabela nova.** Hook `enforce-canonical-tables.sh` bloqueia.
2. **3 Pilares sempre ativos** — Engine, Endpoints Genéricos, Seed.
3. **Engine APENAS em DPedido idClasse=-300** (Reviewer rejeita se vazar).
4. **Score gate APPROVED ≥ 7.0** (hook `validate-review-score.sh` bloqueia).
5. **Sem `--no-verify`. Sem skip de Reviewer/Documenter. Nem uma vez.**
6. **Conventional Commits scope V2** (validado por hook).

## Workflow Multi-Agent

Toda task substantiva passa por:

```
Usuário → Conversa Principal → Strategist → Implementer → Reviewer → Documenter → Conversa Principal
                              (gate plan)  (gate impl)  (gate review)  (gate docs)
```

Detalhes completos: [`docs/plano/00-PLANO-MESTRE.md` §6](docs/plano/00-PLANO-MESTRE.md).

## Status atual

| Fase | Estado |
|------|--------|
| **F0** Setup canônico + Multi-agent infra | 🟡 em andamento |
| F1 Schema + Seed | ⏳ aguardando F0 |
| F2 Endpoints Genéricos | ⏳ |
| F3 Auth + RBAC duplo | ⏳ |
| F4 Email + Common | ⏳ |
| F5 Domínio estrutural | ⏳ |
| **F6** Engine + OperacaoExecucaoClaude (coração técnico) | ⏳ |
| F7 Eventos | ⏳ |
| F8 Flow Metrics + Forecast + Search | ⏳ |
| F9 Reports + Dashboards + Analytics | ⏳ |
| F10 Channels (Telegram + voz Groq) | ⏳ |
| F11 MCP Server | ⏳ |
| F12 Webhooks outbound | ⏳ |
| **F13** Automation Claude Code | ⏳ |
| F14 Hardening | ⏳ |
| F15 Migration de dados | ⏳ |
| F16 Documentação + Handoff | ⏳ |
| F17 Launch + pós-launch | ⏳ |

**Cronograma:** ~24 semanas (~6 meses) com 1 implementer dedicado + Strategist apoio + Reviewer parcial.

---

**Maintained by:** Devari Tecnologia
**Template:** Devari-Core
**Last updated:** 2026-05-08
