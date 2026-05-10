# Strategist Agent Memory — Scrumban-Backend-V2

**Versão:** 1.2
**Última atualização:** 2026-05-09 (F5 Task #1 — plan-domain-structural-f5-task1.md)
**Atualizar:** ao concluir cada task. Limite ~200 linhas; acima disso, mover histórico antigo para `agent-memory/strategist/<topic>.md`.

---

## INSTRUÇÕES DE USO

- Consultar **ANTES** de criar qualquer plan
- Registrar decisões novas ao concluir cada task
- Manter atualizado (remover obsoleto)
- Memory é **injetada automaticamente** no system prompt via `memory: project` no frontmatter

---

## CONTEXTO DO PROJETO

**Scrumban-Backend-V2** é a refundação canônica do Scrumban legado, sob o template Devari-Core.
**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Estado:** F5 (Domínio Estrutural — Organizations/Teams/Projects/Tasks) — plan entregue, aguardando CEO responder Q1/Q2/Q3 antes de Implementer iniciar Bloco B.
**Cronograma:** 24 semanas (otimista 20, pessimista 29) com 1 implementer dedicado + strategist e reviewer parciais.
**Família depende.** Corda justa. Sem afrouxar.

---

## REGRAS CRÍTICAS V2 (NÃO-NEGOCIÁVEIS)

1. **ZERO tabela nova.** Apenas as 17 canônicas Devari-Core. Hook `enforce-canonical-tables.sh` bloqueia mecanicamente.
2. **Engine APENAS em DPedido idClasse=-300** (executions). Cadastros estruturais (DEntidade/DTask/DProject/DTabela) usam Service + Prisma direto.
3. **Seed PRIMEIRO** (Pilar 3 antes de qualquer linha de código). Sem seed, sistema NÃO INICIA.
4. **Endpoints genéricos reusados.** `/entidades`, `/tabelas`, `/classes` antes de qualquer controller próprio. Exceções autorizadas: `/projects`, `/tasks`, `/executions`, `/auth`, `/sprints` (wrapper thin), `/workflow-statuses` (wrapper thin).
5. **DClasses sequestradas voltam ao canônico.** Legado usou -47=Usuário, -49=Platform, -50=Org. V2 renumera para -150 (USER), -151 (PLATFORM_SCRUMBAN), -152 (ORGANIZATION).
6. **Score gate APPROVED ≥ 7.0** (Reviewer). Hook `validate-review-score.sh` bloqueia mecanicamente.
7. **Escopo = Scrumban-hoje** (`Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md`), não o `scrumban-spec.yaml` antigo. 128 endpoints, V3 Intentions, MCP, Telegram+Groq, Webhooks HMAC, Automation Claude Code com Risk Gate.
8. **Cronograma 24 semanas — não é corrida, é maratona.** Velocidade é consequência de disciplina.

---

## OS 3 PILARES (CONHECIMENTO ESTRUTURAL CRÍTICO)

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
- Total V2: ~120 DClasses
- Chave NEGATIVA = seed (definidas pelo desenvolvedor); chave POSITIVA = runtime (criadas pela aplicação)
- NUNCA sequestrar -1..-110, -40, -45, -47, -49, -50 (fixas canônicas)

---

## AS 17 TABELAS CANÔNICAS DEVARI-CORE

**Estruturais (10 — Prisma direto via Service):**
- DClasse — taxonomia (sistema de tipos polimórfico)
- DEntidade — pessoas, orgs, sellers, agents, etc.
- DTabela — lookups, configs, tokens
- DVincula — relações genéricas (RBAC, vínculos)
- DEvento — audit trail (notifications, webhook attempts, etc.)
- DRecurso — produtos/recursos (reservada V2, sem uso direto)
- DUserGroup — credenciais de login
- DPermissao — permissões granulares
- DTask — tarefas (V3 Intentions com colunas tipadas)
- DProject — projetos

**Transacionais (6 — Engine para INSERT):**
- DPedido — execuções Claude (idClasse=-300, F6)
- DTitulo — reservada V2
- DMovDispo — reservada V2
- DMovDepos — reservada V2
- DSolicita — reservada V2
- DRequisic — reservada V2

**Infraestrutura (1):**
- DVFS — scripts de Engine (chaves 3-7)

---

## MAPA DAS 17 FASES V2

| # | Fase | Pilar dominante | Estrategista | Output canônico |
|---|------|-----------------|--------------|-----------------|
| **0** | Verificação canônica + setup repo + multi-agent infra | — | A | esqueleto + hooks + `.claude/` populado |
| **1** | Schema 17 tabelas + Seed DClasses | **Pilar 3** | A | `prisma/schema.prisma` + `prisma/seeds/classes.seed.ts` (~120 classes) |
| **2** | Endpoints Genéricos `/entidades` `/tabelas` `/classes` | **Pilar 2** | A | 3 controllers + Services + DTOs |
| **3** | Auth + RBAC duplo via DUserGroup + DVincula | — | A | JWT + Guards + AuthCompositeGuard |
| **4** | Email module + Common Services | — | A | TimezoneService + Pipes + Email provider |
| **5** | Domínio estrutural (Org/Team/Project/Sprint/Status/Task) | Pilar 2 | B | DEntidade/DTabela/DProject/DTask |
| **6** | **Engine + OperacaoExecucaoClaude** | **Pilar 1** | B | `src/engine/` + DVFS scripts |
| **7** | Eventos canônicos (DEvento + EventProducerService) | — | B | Producer + Router + Notifications |
| **8** | Flow Metrics + Forecast + Search | — | B | Analytics derivado, sem persistência |
| **9** | Reports + Dashboards + Analytics | — | B | Read-only com cache TTL |
| **10** | Channels (Telegram + voz Groq Whisper) | — | C | DTabela pairing + DVincula + DEvento |
| **11** | MCP Server (5 tools) | — | C | DTabela MCP_KEY + DEvento MCP_CALL |
| **12** | Webhooks outbound (HMAC + retry) | — | C | DTabela WEBHOOK + DEvento WEBHOOK_ATTEMPT |
| **13** | **Automation Claude Code** (Risk Gate + 58 testes adversariais) | **Pilares 1+2** | C | DEntidade AGENT + DPedido EXECUTION |
| **14** | Hardening (tests + security + observabilidade) | — | D | ≥80% coverage + load test |
| **15** | Migration de dados do legado | — | D | ETL + cutover 4h + rollback |
| **16** | Documentação + Handoff | — | D | Swagger 100% + ADRs + Runbook |
| **17** | Launch + pós-launch | — | D | Janela 4h + monitoramento |

---

## OS 14 ADRs PROPOSTOS V2

| ADR | Título | Fase | Status |
|-----|--------|------|--------|
| ADR-V2-001 | 17 tabelas canônicas — zero tabela nova | F0 | Proposto |
| ADR-V2-002 | Renumeração de DClasses sequestradas | F1 | Proposto |
| ADR-V2-003 | RBAC duplo via DVincula + idClasse | F3 | Proposto |
| ADR-V2-004 | API Keys e MCP Keys via DTabela | F3 | Proposto |
| ADR-V2-005 | OperacaoExecucaoClaude extends OperacaoPedido | F6 | Proposto |
| ADR-V2-006 | Risk LOW/MED/HIGH via idClasse específico | F6 | Proposto |
| ADR-V2-007 | DVFS scripts como mecanismo de portabilidade | F6 | Proposto |
| ADR-V2-008 | DEvento substitui DNotification e DWebhook | F7 | Proposto |
| ADR-V2-009 | Sprints e Workflow Statuses como wrappers thin | F5 | Proposto |
| ADR-V2-010 | Channels como módulo opcional | F10 | Proposto |
| ADR-V2-011 | MCP Keys com rate limit Redis | F11 | Proposto |
| ADR-V2-012 | Webhooks: HMAC-SHA256 + retry 3x + auto-disable | F12 | Proposto |
| ADR-V2-013 | Agent como DEntidade idClasse=-156 | F13 | Proposto |
| ADR-V2-014 | Migration ETL + cutover 4h + rollback <15min | F15 | Proposto |

ADRs adicionais (V2-015+):
- ADR-V2-015 Score gate APPROVED ≥ 7.0 (a ratificar com hook)
- ADR-V2-016 Convenção `?classe=NOME` (string) prevalece sobre `?idClasse=N` (numérico)
- ADR-V2-200 Submissão ao template Devari-Core (declarativo no CLAUDE.md raiz)

---

## CONFLITOS RESOLVIDOS NO §3.3 DO PLANO-MESTRE

| Conflito original | Resolução |
|-------------------|-----------|
| -152 AGENT vs ORGANIZATION | AGENT virou -156; ORGANIZATION fica -152 |
| -491 EXECUCAO_CLAUDE vs WEBHOOK_ATTEMPT vs AGENT_STATUS_OFFLINE | Execution sai p/ -300..-303; -491 = WEBHOOK_ATTEMPT; AGENT_STATUS p/ -510..-513 |
| -493 TELEGRAM_MSG_IN vs AGENT_STATUS_NEVER_CONNECTED | TELEGRAM_MSG_IN fica -493; AGENT_STATUS deslocado p/ -510..-513 |
| -497 PROJECT_DELETED vs EXEC_STATUS_APPROVED vs MCP_CALL | TASK_CREATED = -497; PROJECT_LIFECYCLE = -499 (renomeado por ADR-V2-027); MCP_CALL = -495; EXEC_STATUS p/ -514..-522. F7 Task#1 adiciona AUDIT_GENERIC = -489 (ADR-V2-026). Total seed: 131 DClasses. |
| -301..-303 EXEC_LOW/MED/HIGH vs EXECUTION_REFACTOR/FIX/FEATURE | Risk via idClasse prevalece (DVFS diferentes); categoria operacional vai em `dados.category` |
| -460 WEBHOOK_CONFIG vs -470 WEBHOOK | -470..-479 reservada para configs/tokens consolidada |

---

## SEED CANÔNICO V2 (RESUMO — DETALHE EM §3.2 DO PLANO-MESTRE)

**Faixas reservadas:**
- `-1..-110`: classes fixas (`templates/classes-base-template.ts`) — INTOCADAS
- `-150..-159`: sub-tipos de Pessoa Scrumban (USER, PLATFORM_SCRUMBAN, ORGANIZATION, AGENT, TEAM)
- `-160..-179`: vínculos Org/Project (cargos via idClasse)
- `-180..-199`: outras DEntidade especiais (TEAM, TEAM_MEMBERSHIP, PROJECT_AGENT, TELEGRAM_LINK)
- `-200..-299`: DTask especializações (reservado, livre)
- `-300..-319`: Execuções (DPedido) — **PILAR 1 ATIVADO**
- `-400..-419`: Sprints (DTabela)
- `-420..-429`: Priorities
- `-430..-439`: Task Types
- `-440..-449`: Status Intentions V3 (INBOX..VALIDATED)
- `-450..-469`: Channels
- `-470..-489`: Configs/Tokens (WEBHOOK, API_KEY, MCP_KEY, INSTALL_TOKEN, PAIRING_TOKEN, ISSUE_COUNTER)
- `-490..-509`: DEvento (NOTIFICATION, WEBHOOK_ATTEMPT, AGENT_HEARTBEAT, etc.)
- `-510..-529`: status lookups secundários (AGENT_STATUS, EXEC_STATUS, RISK_LEVEL)
- `-530+`: reservado futuro

**Total esperado:** ~120 DClasses (50 fixas + ~70 V2-específicas).

---

## STACK TÉCNICO V2

- NestJS + TypeScript (strict mode)
- PostgreSQL 15 + Prisma ORM
- BullMQ + Redis (filas)
- Docker (postgres + redis local)
- `make build` (Webpack via NestJS)
- ESLint + Prettier (no-console error, max-warnings 0)
- Husky + lint-staged + commitlint (Conventional Commits)

---

## DOCUMENTAÇÃO CHAVE V2

| Necessita | Abrir |
|-----------|-------|
| Visão geral, decisões, gates | `docs/plano/00-PLANO-MESTRE.md` |
| Detalhe schema, seed, endpoints, auth | `docs/plano/01-FUNDACAO.md` |
| Detalhe Engine, OperacaoExecucaoClaude, eventos, flow metrics | `docs/plano/02-DOMINIO-ENGINE.md` |
| Detalhe Telegram, MCP, Webhooks, Automation | `docs/plano/03-INTEGRACOES.md` |
| Detalhe testes, security, migration, runbook, launch | `docs/plano/04-HARDENING-HANDOFF.md` |
| Diagnóstico do que foi corrigido | `docs/auditoria/00-AUDITORIA-CONSOLIDADA.md` |
| Regras canônicas (auto-injetadas) | `.claude/rules/devari-*.md` |
| Schema das 17 tabelas | `Devari-Core/RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` |
| Capacidades a replicar | `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` |
| Contrato HTTP a manter (128 endpoints) | `Scrumbam-Backend/docs/API-CONTRACT.md` |

---

## RISCOS V2 — TOP 5 (do §5 do plano-mestre)

1. **Command injection RCE em F13** — TDD com 58 testes adversariais ANTES do código; whitelist + AST + regex em camadas
2. **Risk Gate classifica HIGH como LOW** — fail-safe MEDIUM em dúvida; `STRICT_RISK_GATE=true` em prod
3. **Cutover ultrapassa 4h em F15** — 3 ensaios cronometrados em staging; abort 04:00; buffer 50min
4. **Engine vazado para domínios estruturais** (DTask/DProject) — Reviewer rejeita imediatamente; ADR-V2-005 + ADR-V2-013 explicitam
5. **Pressão para criar coluna `role` em DUserGroup** — ADR + hook bloqueador `enforce-canonical-tables.sh`

---

## NOTAS

- V2 é REFUNDAÇÃO, não migração in-place. Repositório novo, paralelo. Migration de dados em F15.
- Aposta arquitetural: tudo que o Scrumban legado faz CABE nas 17 tabelas via DClasse + DVincula + DEvento + DPedido + Json aditivo. Cada fase tem que manter essa aposta intacta.
- Conventional Commits scope V2 difere do template (sem `pagamento`; com `channels`, `mcp`, `webhooks`, `automation`, `executions`, `flow-metrics`, `reports`, `email`, `permissoes`).
- ESCOPO INDEFINIDO ≠ ESCOPO REDUZIDO. V2 mantém os 128 endpoints do legado; muda apenas COMO faz.

---

## HISTÓRICO DE PLANS PRODUZIDOS

| Task | Plan | Data | Decisões-chave |
|------|------|------|----------------|
| F2-Task1 | `workspace/plans/plan-endpoints-genericos-f2-task1.md` | 2026-05-08 | Pilar 2 ativo: 3 controllers genéricos (entidades/tabelas/classes). ZERO controller específico (sem UserController, SprintController). ADR-V2-015 compat wrapper `?classe=NOME` com LRU cache 5min + Logger.warn + header Deprecation/Sunset. ClasseController READ-ONLY. F2.1→F2.6 sequência com Infraestrutura Comum PRIMEIRO. Eventos inline em DEvento até F7 criar EventProducerService. ADR-V2-025 proposto para BigInt serialization strategy. `createSeller` helper canônico incluído mesmo sem uso no Scrumban V2. |
| F3-Task1 | `workspace/plans/plan-auth-rbac-f3-task1.md` | 2026-05-08 | AuthCompositeGuard ordem: MCP→API Key→JWT (mais específico primeiro). RoleResolverService: LRU in-memory TTL 5min (Redis não ativo em F3). Refresh token: rotação estrita (reuse detection). MCP Key: DTabela(-472) + hash duplicado em DUserGroup.dados.mcpKeyHash. API Key: DTabela(-471). Dívidas F2 resolvidas na Fase 1 do plano (antes de qualquer guard). @SkipGuard() tombstone após remoção. Pergunta aberta Q1 para CEO sobre OrgTenantGuard e PATH_PARAM strategy em F5. |
| F6-Task1 | `workspace/plans/plan-engine-operacao-execucao-claude-task1.md` | 2026-05-09 | Pilar 1 ATIVO: Engine base Operacao.ts + OperacaoPedido.ts (FULL) + OperacaoExecucaoClaude.ts (V2). Migration chcriacao_seq START WITH 1000000 (separação de range vs BIGSERIAL). DVFS usa `chaveScript INTEGER` (campo correto no schema V2) — NUNCA `s.id` (ADR-V2-016). dvfs-loader carrega por idClasse com fallback ao pai (Q1 para CEO). Scripts seeded em idClasse=-300 (compartilhados por -301/-302/-303). 2 testes regressivos BLOQUEANTES R-CHAVE-5 e R-CHAVE-7. Task 1 = G+H+I (Engine puro); Task 2 = J+K+L (Controller/Service/testes integration). agentTunnelService e eventProducer são STUBS em F6. |
| F6-Task2 | `workspace/plans/plan-f6-executions-task2.md` | 2026-05-09 | Correção M1: `matchedPatterns: string[]` → `Array<{pattern,level}>` em IExecucaoData. ExecutionsService.execute() instancia Engine fresh (nova→calcula→[aprova/gravarComoAwaitingApproval]→grava). ApprovalFlowService.approve() usa $executeRaw race-safe (UPDATE com WHERE status='awaiting_approval' — 0 linhas = ConflictException 409). Sweeper @Cron findMany+filter+$executeRaw (Prisma ORM não suporta WHERE JSON em updateMany). rollback() cria nova execution que passa pelo Risk Gate (será HIGH). ExecutionThrottlerGuard: hash SHA-256 de projectId como tracker key (30 req/min). ExecutionAccessGuard: verifica DVincula -170..-173; ADMIN = idClasse=-171 PROJECT_MANAGER para approve/reject/rollback. Questão aberta Q1 para Implementer: reconstituição do Engine em approve() — Opção A (gravarAposAprovacaoManual) recomendada para preservar DVFS 6-7 e _executarClaude() intactos. 50 patterns adversariais: 25 HIGH + 15 MEDIUM + 10 LOW (spec verificável). |

## PADRÕES ESTABELECIDOS EM F2

- **Serialização BigInt:** `format-entidade-response.ts` + `format-tabela-response.ts` por módulo (ou interceptor global — registrar como ADR-V2-025)
- **LRU cache compartilhado:** `src/common/helpers/lru-cache.ts` (max 200, TTL 5min) — reutilizado por EntidadeService e TabelaService para alias `?classe=NOME`
- **Validação DClasse:** sempre `prisma.dClasse.findFirst({ where: { chave, excluido: false } })` antes de qualquer query principal — 404 se não existe
- **Placeholder de auth:** `@SkipGuard()` em todos os controllers F2 — F3 substitui por guards reais
- **Tree builder:** 1 `findMany` + Map em memória — NUNCA recursão de queries (N+1 proibido)
- **`?idClasse` obrigatório em GET /entidades e GET /tabelas** — listagem sem filtro de tipo proibida em F2
