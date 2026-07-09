---
name: v2-canonical-knowledge
description: Núcleo canônico V2 — regras inegociáveis, 3 Pilares, 17 tabelas, mapa das 17 fases, ADRs propostos, conflitos §3.3, ranges de seed, stack, docs-chave, top-5 riscos.
metadata:
  type: project
---

# Núcleo Canônico V2 (semente do Strategist)

Estado atual do projeto vive no índice MEMORY.md / workspace/STATUS.md — aqui é conhecimento estável.

## REGRAS CRÍTICAS V2 (NÃO-NEGOCIÁVEIS)
1. ZERO tabela nova — só as 17 canônicas. Hook `enforce-canonical-tables.sh` bloqueia.
2. Engine APENAS em DPedido idClasse=-300 (executions). Estruturais (DEntidade/DTask/DProject/DTabela) usam Service + Prisma direto.
3. Seed PRIMEIRO (Pilar 3). Sem seed, sistema não inicia.
4. Endpoints genéricos reusados (`/entidades`,`/tabelas`,`/classes`) antes de controller próprio. Exceções: `/projects`,`/tasks`,`/executions`,`/auth`,`/sprints`(wrapper, REVOGADO por ADR-V2-060),`/workflow-statuses`(wrapper).
5. DClasses sequestradas voltam ao canônico: -150 USER, -151 PLATFORM_SCRUMBAN, -152 ORGANIZATION (legado usava -47/-49/-50).
6. Score gate APPROVED ≥ 7.0. Hook `validate-review-score.sh` bloqueia.
7. Escopo = Scrumban-hoje (SYSTEM-OVERVIEW.md): 128 endpoints, V3 Intentions, MCP, Telegram+Groq, Webhooks HMAC, Automation Risk Gate.
8. Cronograma 24 semanas — maratona, disciplina > velocidade.

## OS 3 PILARES
- **Pilar 1 Engine:** `nova()→setDados()→calcula()→aprova()→grava()`. F6 ativa via OperacaoExecucaoClaude extends OperacaoPedido (ADR-V2-005). DPedido -300 (agrupador), -301/-302/-303 (LOW/MED/HIGH). DVFS chaves 3-7 (ADR-V2-007). F13 reusa.
- **Pilar 2 Endpoints:** `/entidades?idClasse=X`, `/tabelas?classe=X` (string, ADR-V2-015/016), `/classes`. F2 ativou (3 controllers). Wrappers thin: `/workflow-statuses` (ADR-V2-009).
- **Pilar 3 Seed:** ~50 fixas (-1..-110) + ~70 V2 (-150..-529). F1. Chave NEGATIVA=seed, POSITIVA=runtime. NUNCA sequestrar -1..-110,-40,-45,-47,-49,-50.

## 17 TABELAS CANÔNICAS
Estruturais (10, Prisma direto): DClasse, DEntidade, DTabela, DVincula, DEvento, DRecurso(reservada), DUserGroup, DPermissao, DTask, DProject.
Transacionais (6, Engine p/ INSERT): DPedido(-300 F6), DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic (5 últimas reservadas V2).
Infra (1): DVFS (scripts Engine, chaves 3-7).

## MAPA DAS 17 FASES (#, fase, pilar dominante)
0 setup/multi-agent · 1 schema+seed (P3) · 2 endpoints genéricos (P2) · 3 auth+RBAC duplo · 4 email+common · 5 domínio estrutural (Org/Team/Project/Status/Task) · 6 Engine+OperacaoExecucaoClaude (P1) · 7 eventos (DEvento+Producer) · 8 Flow Metrics+Forecast+Search · 9 Reports/Dashboards · 10 Channels (Telegram+Groq) · 11 MCP Server · 12 Webhooks HMAC · 13 Automation Claude Code (P1+P2, Risk Gate+58 testes) · 14 Hardening · 15 Migration ETL+cutover 4h · 16 Docs+Handoff · 17 Launch.

## ADRs PROPOSTOS (resumo)
001 17 tabelas · 002 renumeração DClasses · 003 RBAC duplo DVincula+idClasse · 004 API/MCP keys via DTabela · 005 OperacaoExecucaoClaude · 006 Risk via idClasse · 007 DVFS portabilidade · 008 DEvento substitui DNotification/DWebhook · 009 Sprints/Status wrappers (Sprint revogado por 060) · 010 Channels opcional · 011 MCP rate limit Redis · 012 Webhooks HMAC+retry · 013 Agent=DEntidade -156 · 014 Migration ETL · 015 score gate 7.0 · 016 `?classe=NOME` string · 026 AUDIT_GENERIC -489 · 027 PROJECT_LIFECYCLE -499 · 029 Project↔Team DVincula -182 · 036 monorepo agent · 042 tenant isolation · 047 hierarquia idPai DTask · 051 Space/Folder/List + §8 Camada A público · 058 DVincula FK exige DEntidade-espelho · 060 hard-delete Sprint · 061 templates catálogo · 068 scope catalog MCP · 200 submissão ao template.

## CONFLITOS RESOLVIDOS (§3.3 plano-mestre)
- -152 AGENT vs ORG → AGENT=-156, ORG=-152.
- -491 → WEBHOOK_ATTEMPT; AGENT_STATUS p/ -510..-513; EXECUTION p/ -300..-303.
- -493 TELEGRAM_MSG_IN mantém; AGENT_STATUS deslocado.
- -497 → TASK_CREATED; PROJECT_LIFECYCLE=-499; MCP_CALL=-495; EXEC_STATUS -514..-522; AUDIT_GENERIC=-489. Total seed: 131 (130 após remoção Sprint -400).
- -301..-303 risk via idClasse prevalece; categoria operacional em `dados.category`.
- -470..-479 reservada configs/tokens consolidada.

## RANGES DE SEED
-1..-110 fixas (INTOCADAS) · -150..-159 sub-tipos Pessoa · -160..-179 vínculos Org/Project (cargos) · -180..-199 DEntidade especiais (TEAM/MEMBERSHIP/PROJECT_AGENT/TELEGRAM) · -200..-299 DTask · -300..-319 Execuções (P1) · -350..-353 Space/Folder/List/Doc · -400..-419 (Sprint removido, livre) · -420..-429 Priorities · -430..-439 Task Types · -440..-449 Status V3 · -450..-469 Channels · -470..-489 Configs/Tokens(-472 MCP_KEY) · -490..-509 DEvento · -510..-529 status secundários · -530+ futuro.

## STACK
NestJS + TS strict · PostgreSQL 15 + Prisma · BullMQ + Redis · Docker · `make build` · ESLint/Prettier (no-console, max-warnings 0) · Husky+lint-staged+commitlint (Conventional Commits, scope V2 sem `pagamento`).

## DOCS-CHAVE
Visão/gates: `docs/plano/00-PLANO-MESTRE.md` · Schema/seed/auth: `01-FUNDACAO.md` · Engine/eventos/metrics: `02-DOMINIO-ENGINE.md` · Telegram/MCP/Webhooks/Automation: `03-INTEGRACOES.md` · Testes/migration/launch: `04-HARDENING-HANDOFF.md` · Auditoria: `docs/auditoria/00-AUDITORIA-CONSOLIDADA.md` · Regras: `.claude/rules/devari-*.md` · 17 tabelas: `Devari-Core/RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` · Capacidades: `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` · Contrato HTTP: `API-CONTRACT.md`.

## TOP-5 RISCOS (§5 plano-mestre)
1. Command injection RCE F13 → TDD 58 testes adversariais antes do código.
2. Risk Gate classifica HIGH como LOW → fail-safe MEDIUM; `STRICT_RISK_GATE=true` prod.
3. Cutover >4h F15 → 3 ensaios staging; abort 04:00.
4. Engine vazado p/ estruturais → Reviewer rejeita; ADR-005/013.
5. Pressão p/ coluna `role` em DUserGroup → ADR + hook bloqueador.

## NOTAS
- V2 é REFUNDAÇÃO (repo novo, paralelo); migration de dados em F15.
- Aposta: tudo do legado CABE nas 17 tabelas via DClasse+DVincula+DEvento+DPedido+Json aditivo.
- ESCOPO INDEFINIDO ≠ REDUZIDO. Mantém 128 endpoints; muda só COMO faz.
