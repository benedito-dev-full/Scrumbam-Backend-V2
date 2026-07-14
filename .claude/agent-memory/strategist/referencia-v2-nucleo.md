---
name: referencia-v2-nucleo
description: Referência estável do núcleo V2 — 3 Pilares, 17 tabelas canônicas, mapa das 17 fases, 14+ ADRs propostos, conflitos resolvidos no seed, faixas do seed canônico, stack técnico, documentação-chave, top 5 riscos e notas gerais. Consultar quando faltar contexto estrutural do projeto.
metadata:
  type: project
---

## CONTEXTO DO PROJETO

**Scrumban-Backend-V2** é a refundação canônica do Scrumban legado, sob o template Devari-Core.
**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Cronograma:** 24 semanas (otimista 20, pessimista 29) com 1 implementer dedicado + strategist e reviewer parciais.
**Família depende.** Corda justa. Sem afrouxar.

## REGRAS CRÍTICAS V2 (NÃO-NEGOCIÁVEIS)

1. **ZERO tabela nova.** Apenas as 17 canônicas Devari-Core. Hook `enforce-canonical-tables.sh` bloqueia mecanicamente.
2. **Engine APENAS em DPedido idClasse=-300** (executions). Cadastros estruturais (DEntidade/DTask/DProject/DTabela) usam Service + Prisma direto.
3. **Seed PRIMEIRO** (Pilar 3 antes de qualquer linha de código). Sem seed, sistema NÃO INICIA.
4. **Endpoints genéricos reusados.** `/entidades`, `/tabelas`, `/classes` antes de qualquer controller próprio. Exceções autorizadas: `/projects`, `/tasks`, `/executions`, `/auth`, `/sprints` (wrapper thin), `/workflow-statuses` (wrapper thin).
5. **DClasses sequestradas voltam ao canônico.** Legado usou -47=Usuário, -49=Platform, -50=Org. V2 renumera para -150 (USER), -151 (PLATFORM_SCRUMBAN), -152 (ORGANIZATION).
6. **Score gate APPROVED ≥ 7.0** (Reviewer). Hook `validate-review-score.sh` bloqueia mecanicamente.
7. **Escopo = Scrumban-hoje** (`Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md`), não o `scrumban-spec.yaml` antigo. 128 endpoints, V3 Intentions, MCP, Telegram+Groq, Webhooks HMAC, Automation Claude Code com Risk Gate.
8. **Cronograma 24 semanas — não é corrida, é maratona.** Velocidade é consequência de disciplina.

## OS 3 PILARES

### Pilar 1 — Engine/Operação (CORAÇÃO)
- Workflow obrigatório: `nova() → setDados() → calcula() → aprova() → grava()`
- F6 ativa o Pilar 1 via `OperacaoExecucaoClaude extends OperacaoPedido` (ADR-V2-005)
- DPedido idClasse=-300 (EXECUTION agrupador), -301/-302/-303 (LOW/MED/HIGH)
- DVFS scripts (chaves 3-7): pre-calc, calc, pos-calc, pre-grav, pos-grav (ADR-V2-007)
- F13 (Automation Claude Code) usa o Engine de F6

### Pilar 2 — Endpoints Genéricos (DRY)
- `/entidades?idClasse=X` (DEntidade)
- `/tabelas?classe=X` (DTabela — convenção `?classe=NOME` string, ADR-V2-015 a ratificar)
- `/classes` (DClasse)
- F2 ativa o Pilar 2 (3 controllers genéricos)
- Wrappers thin autorizados: `/sprints` → `/tabelas?classe=SPRINT`; `/workflow-statuses` → `/tabelas?classe=STATUS_INTENTION_V3` (ADR-V2-009)

### Pilar 3 — Seed de Classes (CÉREBRO POLIMÓRFICO)
- ~50 classes fixas (`templates/classes-base-template.ts`, range -1..-110) + ~70 classes V2-específicas (range -150..-529)
- F1 ativa o Pilar 3 (seed completo)
- Total V2: ~120-130 DClasses
- Chave NEGATIVA = seed (definidas pelo desenvolvedor); chave POSITIVA = runtime (criadas pela aplicação)
- NUNCA sequestrar -1..-110, -40, -45, -47, -49, -50 (fixas canônicas)

## AS 17 TABELAS CANÔNICAS DEVARI-CORE

**Estruturais (10 — Prisma direto via Service):** DClasse (taxonomia), DEntidade (pessoas/orgs/sellers/agents), DTabela (lookups/configs/tokens), DVincula (relações genéricas/RBAC), DEvento (audit trail), DRecurso (reservada V2), DUserGroup (credenciais login), DPermissao (permissões), DTask (tarefas V3 Intentions), DProject (projetos).

**Transacionais (6 — Engine para INSERT):** DPedido (execuções Claude, idClasse=-300, F6), DTitulo/DMovDispo/DMovDepos/DSolicita/DRequisic (todas reservadas V2, sem uso ainda).

**Infraestrutura (1):** DVFS — scripts de Engine (chaves 3-7).

## MAPA DAS 17 FASES V2

| # | Fase | Pilar dominante | Estrategista | Output canônico |
|---|------|-----------------|--------------|-----------------|
| 0 | Verificação canônica + setup repo + multi-agent infra | — | A | esqueleto + hooks + `.claude/` populado |
| 1 | Schema 17 tabelas + Seed DClasses | Pilar 3 | A | `prisma/schema.prisma` + `prisma/seeds/classes.seed.ts` |
| 2 | Endpoints Genéricos `/entidades` `/tabelas` `/classes` | Pilar 2 | A | 3 controllers + Services + DTOs |
| 3 | Auth + RBAC duplo via DUserGroup + DVincula | — | A | JWT + Guards + AuthCompositeGuard |
| 4 | Email module + Common Services | — | A | TimezoneService + Pipes + Email provider |
| 5 | Domínio estrutural (Org/Team/Project/Sprint/Status/Task) | Pilar 2 | B | DEntidade/DTabela/DProject/DTask |
| 6 | Engine + OperacaoExecucaoClaude | Pilar 1 | B | `src/engine/` + DVFS scripts |
| 7 | Eventos canônicos (DEvento + EventProducerService) | — | B | Producer + Router + Notifications |
| 8 | Flow Metrics + Forecast + Search | — | B | Analytics derivado, sem persistência |
| 9 | Reports + Dashboards + Analytics | — | B | Read-only com cache TTL |
| 10 | Channels (Telegram + voz Groq Whisper) | — | C | DTabela pairing + DVincula + DEvento |
| 11 | MCP Server (5 tools) | — | C | DTabela MCP_KEY + DEvento MCP_CALL |
| 12 | Webhooks outbound (HMAC + retry) | — | C | DTabela WEBHOOK + DEvento WEBHOOK_ATTEMPT |
| 13 | Automation Claude Code (Risk Gate + 58 testes adversariais) | Pilares 1+2 | C | DEntidade AGENT + DPedido EXECUTION |
| 14 | Hardening (tests + security + observabilidade) | — | D | ≥80% coverage + load test |
| 15 | Migration de dados do legado | — | D | ETL + cutover 4h + rollback |
| 16 | Documentação + Handoff | — | D | Swagger 100% + ADRs + Runbook |
| 17 | Launch + pós-launch | — | D | Janela 4h + monitoramento |

## OS 14+ ADRs PROPOSTOS V2

ADR-V2-001 (17 tabelas canônicas, F0) · 002 (renumeração DClasses sequestradas, F1) · 003 (RBAC duplo via DVincula+idClasse, F3) · 004 (API/MCP keys via DTabela, F3) · 005 (OperacaoExecucaoClaude extends OperacaoPedido, F6) · 006 (Risk LOW/MED/HIGH via idClasse, F6) · 007 (DVFS scripts portabilidade, F6) · 008 (DEvento substitui DNotification/DWebhook, F7) · 009 (Sprints/Workflow Statuses wrappers thin, F5 — Sprint REVOGADO por ADR-V2-060) · 010 (Channels módulo opcional, F10) · 011 (MCP Keys rate limit Redis, F11) · 012 (Webhooks HMAC-SHA256+retry3x+auto-disable, F12) · 013 (Agent como DEntidade idClasse=-156, F13) · 014 (Migration ETL+cutover4h+rollback<15min, F15) · 015 (Score gate APPROVED≥7.0) · 016 (convenção `?classe=NOME` string prevalece sobre `?idClasse=N`) · 060 (Hard delete Sprint, revoga 009) · 200 (Submissão ao template Devari-Core).

## CONFLITOS RESOLVIDOS NO SEED (§3.3 plano-mestre)

- -152 AGENT vs ORGANIZATION → AGENT virou -156; ORGANIZATION fica -152.
- -491 EXECUCAO_CLAUDE vs WEBHOOK_ATTEMPT vs AGENT_STATUS_OFFLINE → Execution para -300..-303; -491=WEBHOOK_ATTEMPT; AGENT_STATUS para -510..-513.
- -493 TELEGRAM_MSG_IN vs AGENT_STATUS_NEVER_CONNECTED → TELEGRAM_MSG_IN fica -493; AGENT_STATUS em -510..-513.
- -497 PROJECT_DELETED vs EXEC_STATUS_APPROVED vs MCP_CALL → TASK_CREATED=-497; PROJECT_LIFECYCLE=-499 (ADR-V2-027); MCP_CALL=-495; EXEC_STATUS em -514..-522. F7 Task#1 adiciona AUDIT_GENERIC=-489 (ADR-V2-026).
- -301..-303 EXEC_LOW/MED/HIGH vs EXECUTION_REFACTOR/FIX/FEATURE → Risk via idClasse prevalece; categoria operacional em `dados.category`.
- -460 WEBHOOK_CONFIG vs -470 WEBHOOK → -470..-479 reservada para configs/tokens consolidada.
- Seed -400 (Sprint) removido após ADR-V2-060 (hard delete) — range -400..-419 liberado.

## SEED CANÔNICO V2 — FAIXAS RESERVADAS

`-1..-110` classes fixas (INTOCADAS) · `-150..-159` sub-tipos Pessoa Scrumban · `-160..-179` vínculos Org/Project (cargos) · `-180..-199` DEntidade especiais (TEAM, TELEGRAM_LINK) · `-200..-299` DTask especializações (Fases/Blocos, ADR-V2-047) · `-300..-319` Execuções DPedido (PILAR 1) · `-400..-419` liberado (Sprint removido) · `-420..-429` Priorities · `-430..-439` Task Types · `-440..-449` Status Intentions V3 · `-450..-469` Channels · `-470..-489` Configs/Tokens · `-490..-509` DEvento · `-510..-529` status lookups secundários · `-530+` reservado futuro.

## STACK TÉCNICO V2

NestJS + TypeScript (strict) · PostgreSQL 15 + Prisma ORM · BullMQ + Redis · Docker (postgres+redis local) · `make build` (Webpack via NestJS) · ESLint+Prettier (no-console error, max-warnings 0) · Husky+lint-staged+commitlint (Conventional Commits).

## DOCUMENTAÇÃO CHAVE V2

| Necessita | Abrir |
|-----------|-------|
| Visão geral, decisões, gates | `docs/plano/00-PLANO-MESTRE.md` |
| Detalhe schema, seed, endpoints, auth | `docs/plano/01-FUNDACAO.md` |
| Detalhe Engine, eventos, flow metrics | `docs/plano/02-DOMINIO-ENGINE.md` |
| Detalhe Telegram, MCP, Webhooks, Automation | `docs/plano/03-INTEGRACOES.md` |
| Detalhe testes, security, migration, runbook | `docs/plano/04-HARDENING-HANDOFF.md` |
| Diagnóstico do que foi corrigido | `docs/auditoria/00-AUDITORIA-CONSOLIDADA.md` |
| Regras canônicas (auto-injetadas) | `.claude/rules/devari-*.md` |
| Schema das 17 tabelas | `Devari-Core/RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` |
| Capacidades a replicar | `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` |
| Contrato HTTP a manter (128 endpoints) | `Scrumbam-Backend/docs/API-CONTRACT.md` |

## RISCOS V2 — TOP 5

1. Command injection RCE em F13 — TDD com 58 testes adversariais ANTES do código; whitelist+AST+regex em camadas.
2. Risk Gate classifica HIGH como LOW — fail-safe MEDIUM em dúvida; `STRICT_RISK_GATE=true` em prod.
3. Cutover ultrapassa 4h em F15 — 3 ensaios cronometrados em staging; abort 04:00; buffer 50min.
4. Engine vazado para domínios estruturais (DTask/DProject) — Reviewer rejeita imediatamente; ADR-V2-005+013 explicitam.
5. Pressão para criar coluna `role` em DUserGroup — ADR + hook bloqueador `enforce-canonical-tables.sh`.

## NOTAS

- V2 é REFUNDAÇÃO, não migração in-place. Repositório novo, paralelo. Migration de dados em F15.
- Aposta arquitetural: tudo que o Scrumban legado faz CABE nas 17 tabelas via DClasse + DVincula + DEvento + DPedido + Json aditivo.
- Conventional Commits scope V2 difere do template (sem `pagamento`; com `channels`, `mcp`, `webhooks`, `automation`, `executions`, `flow-metrics`, `reports`, `email`, `permissoes`).
- ESCOPO INDEFINIDO ≠ ESCOPO REDUZIDO. V2 mantém os 128 endpoints do legado; muda apenas COMO faz.
