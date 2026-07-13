# Changelog — Scrumban-Backend-V2

Todas as mudancas notaveis deste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere a [Semantic Versioning 2.0.0](https://semver.org/lang/pt-BR/).

Tipos de entrada usados: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`, `Performance`, `Tests`.

---

## [Unreleased]

### Added

- **Sessões Multi-Device em DTabela — Fase 3 (Task #997 / DEV-173, V2 F16, 2026-07-13)**
  - **Objetivo:** Permitir logar em múltiplos dispositivos sem derrubar anteriores; detectar replay corretamente
  - **Backend (Scrumban-Backend-V2):**
    - `SessionService`: CRUD de sessões em DTabela (idClasse=-485), lookup indexado O(1), cap 10 sessões LRU, idle 7d + absoluta 30d
    - Dual-read/dual-write: usuários legado (pré-F3) migram automaticamente na primeira renovação (preguiçosa), zero logout
    - Máquina de estados: valid/grace/expired/replay/revoked/reuse_escalation/unknown (RFC 9700 conformance)
    - Revoke por FAMÍLIA (não conta): replay → revoga essa sessão/família; reuse_escalation → revoga TODAS sessões
    - Endpoints: `GET /auth/sessions` (lista), `DELETE /auth/sessions/:id` (revoke), `DELETE /auth/sessions` (revoke all except current)
    - Denylist em `TabelaService`: SESSION (-485) retorna 404 em list/get/create/update/delete (anti-enumeração, vazamento evitado)
    - Eventos: -504 SESSION_CREATED, -509 SESSION_REVOKED, -523 SECURITY_REUSE_DETECTED, -524 SECURITY_ALL_SESSIONS_REVOKED
    - Migration: `CREATE INDEX (idClasse, codigo)` em DTabela (O(1) lookup), + índices de dual-read legado (7d temporários)
    - Feature flag: `SESSIONS_V2_ENABLED` (rollback instantâneo sem logout)
  - **Serviços novos:**
    - `src/auth/services/session.service.ts` — SessionService (384L, JSDoc 100%)
    - `src/auth/services/session-purge.service.ts` — Purge job (expirações, LRU evict)
    - `src/auth/dto/session-response.dto.ts` — Projeção segura (sem hash/jti/family)
  - **Testes: 18/18 session-multidevice.spec.ts PASS + 120/120 auth+tabelas PASS**
    - Test §4.1-4.4: Dual-read, dual-write, migração legado, rollback ✅
    - Test §6.6: Multi-device, revoke individual, evict LRU ✅
    - Test §6.7: Replay real (família revogada), reuse_escalation (todas revogadas) ✅
    - Auditoria adversarial: SQL injection (Prisma.sql 100%), concorrência (CAS ACID), vazamento (denylist) ✅
  - **Documentação:**
    - JSDoc completo em SessionService, SessionPurgeService, DTOs
    - ADR-V2-077 redigido: decisão, RFC 9700 conformance, dual-read semântica, rollback seguro, Pilar 2 exceção justificada
    - Deploy runbook: `docs/deploy-runbook-fase3-sessoes.md` (45 min, checklist, rollback, troubleshooting)
  - **Pilares:** P1 N/A (zero Engine); P2 Exceção justificada (/auth/sessions denylist); P3 ✅ (5 DClasses novas)
  - **ADRs:** ADR-V2-077 (this phase)
  - **Score Review:** 9.2/10 (APPROVED — multi-device real, zero slot-único, RFC 9700 conformance, zero tabela nova, Pilar 3 seed-first)

- **Hotfix Auth — Fase 1 (Sessão/Grace/Idempotência — Task #995 / DEV-171, V2 F16, 2026-07-13)**
  - **Objetivo:** Corrigir falso-positivo de reuse attack causado por corrida entre abas + infra lenta deslogando + cache negativo de 5min (sintomas B1, B2, B3 do incidente DEV-169)
  - **Backend (Scrumban-Backend-V2):**
    - Grace Window de 60s: armazena `prevHash + prevHashValidUntil` em `DUserGroup.dados` (Json); refresh com `prevHash` dentro da janela rotaciona (não revoga)
    - Idempotência via `RefreshIdempotencyService` (in-process, decisão consciente vs Redis): cache `Map<sha256(token), Promise>` por 60s; dois requests concorrentes recebem a **mesma promise e mesma resposta**
    - Classificação de exceção em guards: `isInfraFailure()` diferencia credencial inválida (continua cadeia MCP/API/JWT) de infra timeout (retorna 503, não 401)
    - Filter `@Catch()` universal: exceção crua (bug, erro não-tratado) vira 500 com `correlationId`, nunca vaza stack
    - Preserve `code` field (RFC 9457): filter agora propaga `code` de exceções HTTP para frontend diferenciar motivos
    - Cache negativo TTL reduzido: 300s → 10s (permissão concedida reflete em ≤10s, não em 5min)
    - Config morta removida: `.env` tinha JWT_ACCESS_EXPIRATION, JWT_REFRESH_EXPIRATION, JWT_ALGORITHM ignorados por código → removidos com comentário
    - Endpoints: `POST /auth/refresh` (idempotente, grace, 503 em infra), status codes + `code` field em todas respostas
  - **Serviços novos:**
    - `src/auth/services/refresh-idempotency.service.ts` — Cache in-process com TTL = grace, nunca redis-dependent
    - `src/common/errors/error-codes.ts` — Catálogo de `code` (TOKEN_INVALID, TOKEN_EXPIRED, SESSION_REVOKED, SESSION_REUSE_DETECTED, ORG_CONTEXT_STALE, NO_WORKSPACE, FORBIDDEN_ROLE, AUTH_BACKEND_UNAVAILABLE, INTERNAL_ERROR)
  - **Testes: 95 backend auth tests PASS (100%), 58 testes adversariais Risk Gate pass (não regressão)**
    - Test 6.1: Corrida de refresh — ambas abas recebem mesmo token (não revogam) ✅
    - Test 6.2: Refresh token desconhecido → 401 TOKEN_INVALID (não 500) ✅
    - Test 6.3: Infra lenta → 503 AUTH_BACKEND_UNAVAILABLE (não 401 logout) ✅
    - Test 6.4: Cache negativo TTL 10s (permissão reflete em tempo) ✅
    - Test 6.7: Replay real (fora da grace) → revoga + evento SECURITY_REFRESH_REUSE_DETECTED ✅
  - **Documentação:**
    - JSDoc completo nos serviços novos (refresh-idempotency.service.ts, error-codes.ts, updates em auth.service.ts)
    - ADR-V2-076 redigido: base normativa RFC 9700 + desvio consciente (Redis → in-process)
    - Código de erro API documentado (novo arquivo src/common/errors/error-codes.ts)
  - **Pilares:** P1 N/A (zero Engine); P2 N/A (zero endpoint novo); P3 N/A (zero DClasse nova)
  - **ADRs:** ADR-V2-076 (refresh grace + idempotência in-process), ADR-V2-064 (semântica erro em F4)
  - **Score Review:** 9.2/10 (APPROVED — mata falso-positivo sem afrouxar RFC 9700, zero regressão, desvio de plano bem justificado)

- **Observabilidade de Sessão/Auth — Fase 0 (Baseline — Task #994 / DEV-170, V2 F16, 2026-07-13)**
  - **Objetivo:** Instrumentar sistema para MEDIR incidente de sessão antes de corrigir (F0 — zero mudança de comportamento)
  - **Contadores (7 requeridos):** `auth.refresh.attempt/success/reuse_detected/expired/not_found`, `auth.refresh.revoke_all` (sangramento B1), `auth.401` por motivo (guard_exception = infra lento), `auth.guard.infra_error` (prova B3), `auth.role_cache.hit/miss/negative_hit` (prova B2), `auth.org_context_stale`, `http.5xx` em refresh
  - **Backend (MetricsService + TelemetryController):**
    - `src/common/observability/metrics.service.ts` — Service de métricas por log estruturado; incrementa contador, emite linha JSON ou silencioso; nunca falha (`@Optional()` + try/catch)
    - `src/common/observability/infra-error.util.ts` — Classificação de exceção (isInfra via Prisma codes, rede, timeout)
    - `src/common/observability/telemetry.controller.ts` — `POST /telemetry/auth-zombie` (beacon público do frontend, rate limit 20/min/IP, payload mínimo), `GET /telemetry/metrics` (snapshot por processo)
    - `src/common/observability/dto/auth-zombie.dto.ts` — Payload: `{ hadRefreshToken: boolean }` apenas
    - Integração em guards + auth service para incrementar contadores corretos
  - **Frontend (telemetry.ts):**
    - `src/lib/telemetry.ts` — `hasAuthCookie()` + `reportAuthZombie(hadRefreshToken)` — mede sintoma A (aba zumbi: cookie sim, token não)
    - Beacon fire-and-forget, keepalive, nunca quebra o boot
  - **Documentação prática (CRÍTICO):**
    - `docs/observabilidade-auth.md` — **Guia para extrair baseline em 48h** com 7 contadores, campos, comandos grep/jq prontos para copiar-e-colar, troubleshooting por sintoma
  - **Testes:**
    - Backend: `metrics.service.spec.ts` (14 tests — sanitize, increment, snapshot), `infra-error.util.spec.ts` (12 tests — Prisma codes, network patterns)
    - 26/26 tests PASS; Build PASS; TypeScript 0 errors; ESLint 0 warnings
  - **Zero mudança de comportamento verificada (linha a linha):**
    - Calls aos `metrics?.increment()` são DENTRO de try/catch ou APÓS `return` — não alteram fluxo
    - Guards classificam erro mas continuam a cadeia original (MCP → API Key → JWT) intacta
    - refresh endpoint adiciona `@Catch()` universal mas relança erro intacto
    - projects/tasks observam contexto APÓS decidir retorno (não alteramo o corpo)
  - **Pilares:** P1 N/A (zero Engine); P2 REUTILIZADO (endpoints genéricos `/telemetry`); P3 N/A (zero DClasse nova)
  - **ADRs vinculados:** ADR-V2-061/062/063/064 (ADRs a redigir junto com F1/F2/F3/F4)
  - **Score Review:** 9.0/10 (APPROVED — observabilidade pura, sem regressão, contadores comprovados)
  - **Próximo:** F1 (hotfix backend com grace/idempotência/503 vs 401); contadores plantados agora medem antes/depois

### Fixed

- **Busca multi-termo tokenizada no SearchService (Task #791 / DEV-120, V2 F8, 2026-07-10)**
  - **Bug:** `search_tasks` só casava substring exata — "login bug" não achava "bug do login"
  - **Solução:** Novo helper `buildTokenizedTextFilter(q, fields)` — tokeniza `q`, descarta tokens <2 chars, AND-flexível (cada palavra deve aparecer em algum campo)
  - **Aplicado em:** `queryTasks`, `queryProjects`, `queryPeople` (HTTP), `searchForMcp` (MCP) — ZERO $queryRaw
  - **Fallback:** Substring literal quando 0 tokens válidos (preserva UX de busca vazia)
  - **Testes:** Verificado: tsc/eslint PASS, 33/33 testes backend
  - **Pilares:** P1 N/A (leitura estrutural, sem Engine); P2 ✅ reutilizado (SearchService genérico); P3 N/A (zero DClasse nova)

### Added

- **Detecção de Duplicata na Criação de Task (Task #799 / DEV-128, V2 F8/F11, 2026-07-10)**
  - **Feature:** Detectar possíveis duplicatas ANTES de criar — exibindo passo intermediário no modal (UI) e retornando lista informativa no MCP (nunca bloqueia)
  - **Método único:** `SearchService.findPossibleDuplicates()` reusa `buildTokenizedTextFilter` (#791) sobre TÍTULO apenas — reutilizável por qualquer domínio
  - **Critério AND-flexível:** Tokenizado; marca `exact` (título idêntico case-insensitive) vs `similar` (tokens batem em algum campo)
  - **Resultado:** Top 5 candidatas, exatos primeiro; inclui tasks CONCLUÍDAS (evita recriar algo já feito)
  - **Comportamento:** SEMPRE informativo — nunca bloqueia criação (decisão #1 do CEO)
  - **Escopo:** Default mesma Lista (idProject=X); org-wide opcional iteração futura (decisão #2)
  - **Backend (Scrumban-Backend-V2):**
    - `src/search/dto/task-duplicate.dto.ts` — TaskDuplicateDto
    - `src/tasks/dto/check-duplicates-query.dto.ts` — CheckDuplicatesQueryDto
    - `GET /tasks/check-duplicates` — endpoint com autorização idêntica `POST /tasks`, 404 anti-enumeration
    - `CreateTaskTool` injetar SearchService; buscar ANTES de create; anexar `possibleDuplicates[]` ao retorno
  - **Frontend (Scrumbam-Frontend-V2):**
    - Hook `useCheckDuplicates()` (imperativo: `checkDuplicates(nome, projectId)`)
    - Componente `<DuplicateWarningStep>` — passo intermediário quando há candidatas
    - Fluxo modal: (1) checar; (2) se há, abrir passo; (3) se vazio, criar direto (ZERO atrito)
    - Botões: "Criar mesmo assim" (bypass) + "Cancelar"
  - **5 decisões travadas CEO (2026-07-10):**
    1. Limiar AND-flexível tokenizado sobre título; marcar exact/similar; exatos primeiro
    2. Escopo default mesma lista (idProject=X); org-wide iteração futura
    3. Top 5 candidatas (balanço visibilidade vs spam)
    4. Incluir tasks DONE/arquivadas (decisão #4) — exibindo idStatus
    5. Modal agora (decisão #5); quick-add inline iteração seguinte
  - **Testes:** Backend (searchService, create-task.tool); Frontend (fluxo modal sem/com duplicatas); MCP (possibleDuplicates[] + nunca bloqueia)
  - **Performance:** 1 query extra por criação (mesma latência #791 — escopo por lista é pequeno)
  - **Pilares:** P1 N/A (leitura estrutural); P2 ✅ REUTILIZADO (SearchService genérico, novo endpoint escopa por lista); P3 N/A (zero DClasse nova)
  - **Portabilidade:** Método genérico — candidato a upstream contribuição para template Devari Core
  - **ADRs:** **ADR-V2-074 (novo — Política detecção duplicata: método único + informativo, nunca bloqueante)**, ADR-V2-001/042/068/071 (vinculados)

- **Diálogo de Confirmação de Takeover — Guard Colisão Humana (Task #795 / DEV-124, Frontend V2, 2026-07-10)**
  - **Feature:** Guard de cortesia (client-side) contra colisão de trabalho HUMANO — complementa trava MCP da #794 que bloqueia ROBÔ
  - **Componentes frontend criados:** Hook centralizado `useWorkCollisionGuard()` (predicado, estado, callbacks); Componente `<TakeoverConfirmDialog>` (paleta âmbar, padrão shadcn); Utilitário `formatSince()` (unificado badge+dialog)
  - **Superfícies guardadas:** 7 handlers em 4 arquivos — mover→EXECUTING (drag kanban, dropdown sheet/drawer/linha) + reatribuir pessoa/time/IA em qualquer drawer
  - **Predicado colisão:** `activeWorkSession != null && agentId != null && agentId !== usuarioLogado.entidadeId` — única fonte de verdade
  - **Reutilização:** Reusa `activeWorkSession` da #794 (nenhuma mudança de backend ou schema); `formatSince` extraída de badge (mantém "há X" idêntico)
  - **Retenção:** TaskSheet + TaskDetailDrawer ambos cobertos (uniformidade em 2 UIs coexistentes)
  - **Decisões travadas Roberio 2026-07-10:** Aceitar corrida início-simultâneo v1 (autoridade real é backend/MCP); passar em silêncio se `agentId=null`; guardar TODAS as trocas (pessoa/time/Claude); manter guard kanban defensivo (uniformidade)
  - **Pilares:** P1 N/A (100% frontend, zero Engine); P2 ATIVO (reutiliza `GET /tasks`/`PATCH /tasks/:id`); P3 N/A (zero DClasse nova)
  - **Testes:** `npm run typecheck` 0 errors; `npm run build` PASS; `npm run lint` 0 warnings; teste manual 7 handlers cobertos
  - **Risco aceito:** Corrida dois-iniciam-READY simultâneos → cada um cacheado sem sessão → nenhum vê dialog (v2 seria refetch extra; recomendado NÃO para v1)
  - **ADRs:** **ADR-V2-073** (trava MCP, referenciado); **ADR-V2-077** (proposta Rizar, diálogo frontend)
  - **Simetria Backend-Frontend:** #794 trava dura MCP (ROBÔ); #795 diálogo cortesia humano (UI) — mesma `activeWorkSession`, idêntica predicação
  - **Frontend-Backend:** Zero dependência entre commits (frontend #795 em `Scrumbam-Frontend-V2`; backend #794 já mergeado)

- **Badge "em trabalho por Fulano" + Trava de Concorrência MCP (Task #794 / DEV-123, V2 F8/F11, 2026-07-10)**
  - **Badge:** Novo campo `activeWorkSession: { agentId, agentName, startedAt }` em `TaskResponseDto` — exibe quem está trabalhando a task quando `status = EXECUTING`
  - **Fonte única:** `resolveActiveWorkSession(telemetry, status)` em `work-session.util.ts` — compartilhada por badge (read-path) e trava (write-path)
  - **Hidratação batch:** `buildWorkSessionMap()` agrupa nomes de donos em 1 query (ZERO N+1) — padrão reutilizável para agregações futuras
  - **Frontend:** Componente `<WorkSessionBadge>` integrado em kanban-board, task-row-backend, task-sheet (compact/full variants) — Scrumbam-Frontend-V2
  - **Trava MCP:** Guard `assertTaskNotLockedByOther()` recusa 4 tools (update_task, update_status, execute_task, delete_task) quando task EXECUTING+sessão de OUTRO ator; `update_timer` isento (fluxo humano)
  - **Sessão órfã:** TTL de 2h — passado isso, outro caller pode retomar; agentId nulo bloqueia conservador ("em andamento, autor não identificado")
  - **Retomada legítima:** Mesmo ator (agentId === callerId) passa automaticamente — permite que agente retome seu próprio trabalho
  - **Erro de bloqueio:** `INVALID_PARAMS (-32602) reason='task_locked'` com `{ lockedBy: { agentId, agentName }, since: startedAt }` — cliente MCP sabe exatamente quem e desde quando
  - **RBAC MCP:** Guard herda gate de tenant (`projectsService.findOne`) — paridade com HTTP
  - **Testes:** 43/43 novos (util 9 + guard 8 + update-task 26 ajustados) — ZERO regressão
  - **Pilares:** P1 N/A (DTask estrutural); P2 ✅ reutilizado (tools MCP existentes, 24→24 invariante); P3 zero mudança (workSessions já em `dados.telemetry`)
  - **ADRs:** **ADR-V2-073 (novo — Trava concorrência MCP por workSession, TTL 2h, TOCTOU aceito)**, ADR-V2-057 (timer manual separado), ADR-V2-042 (tenant MCP)
  - **Build/Lint:** PASS (TypeScript 0 errors, Build PASS, ESLint 0 warnings)
  - **Performance:** Zero query extra no caminho feliz (guard lê `dados.telemetry` em memória); nome no erro reusa hidratação findOne — ZERO overhead
  - **Incidente real:** 2026-07-07 — dois agentes simultâneos numa task; mitigado com 2h de TTL + retomada por-ator (TOCTOU de milissegundos aceito)

- **Justificativa de Atraso de Tarefas — Fase 1 (Captura) Backend Completa (V2 Feature Transversal, Backend F1, 2026-07-09)**
  - **Motivos:** 9 DClasses novas (-503, -530..-537) — `DELAY_JUSTIFICATION` (DEvento) + `DELAY_REASON` (agrupador) + 7 motivos concretos
  - **Arquitetura:** Justificativa via `DEvento -503` com `idEntidade`=autorId + `identificadorExterno`=taskId; versioning via supersede em `$transaction` atomica
  - **Endpoints Fase 1 (captura):**
    - `GET /classes?idPai=-530` — radio de motivos (Pilar 2: endpoint genérico reutilizado)
    - `POST /tasks/:taskId/delay-justification` — cria/edita justificativa vigente (RBAC: assignee OU org ADMIN -161 somente)
    - `GET /tasks/:taskId/delay-justification` — lê vigente (CEO decisão 1: membro NÃO lê de terceiros)
    - `GET /me/delay-justifications/pending-count?projectId=` — badge "N atrasos sem justificativa" (global + por projeto)
  - **RBAC travado:** Membro justifica PRÓPRIA task; Admin (-161) edita qualquer; Project MANAGER (-171) NÃO autoriza
  - **Critério de atraso:** Por DIA de calendário TZ Brasil — `dados.telemetry.doneAt` (primário) → `dados.v3.movedAt` (fallback) → `atualizadoEm` (último recurso)
  - **Testes:** 22/22 PASS (overdue.util: 22 casos incluindo virada de dia; service: create, supersede, RBAC, pending-count)
  - **Build/Lint:** PASS (0 errors, 0 warnings)
  - **Pilares:** P1 N/A (estrutural, Prisma direto + $transaction correto); P2 ✅ reutilizado (classes genérico); P3 ✅ seed 9 DClasses validadas
  - **ADRs:** **ADR-V2-072** (novo — Justificativa via DEvento + supersede), ADR-V2-001/008/058/003 (vinculados)
  - **Score:** 9.0/10 (APPROVED — 3 desvios do Implementer auditados/validados, ZERO N+1, net-zero regressão)
  - **Frontend (Fase 1 separada):** Modal na aba "Em atraso" de `/assigned` + badge — pendente de integração no Scrumbam-Frontend-V2

- **Justificativa de Atraso de Tarefas — Fase 2 (Painel Admin) Backend Completa (V2 Feature Transversal, Backend F2, 2026-07-09)**
  - **Agregação:** 1 query `$queryRaw` com GROUP BY `idEntidade` (usuário), `metaDados->>'motivoClasse'` (motivo), `metaDados->>'projetoId'` (projeto), período
  - **Endpoints Fase 2 (painel admin):**
    - `GET /reports/delay-reasons?groupBy=[motivo|usuario|projeto]&userId=&projectId=&motivoClasse=&from=&to=` — agregação ranking (org ADMIN -161 SOMENTE; Project MANAGER -171 negado via RBAC duplo)
    - `GET /tasks/:taskId/delay-justification/history` — histórico completo (todas as versões, inclui superseded `excluido=true`)
  - **Migration:** Índice parcial jsonb (`CREATE INDEX ... ON "DEvento" ... WHERE idClasse=-503 AND excluido=false`) — idempotente, rollback documentado
  - **SQL Injection:** Whitelist estática `GROUP_COLUMN: Record<DelayReasonsGroupBy, Prisma.Sql>` com validação `@IsIn` no DTO — ZERO risco, auditado
  - **RBAC:** Org-alvo = `DProject.idEstab` (org dona do projeto) quando filtrado; org ADMIN (-161) SOMENTE acessa — cross-tenant prevenido
  - **N+1 Queries:** 2 queries totais (1 agregação + 1 batch de rótulos), testado com DATABASE_LOGGING
  - **Testes:** 36/36 PASS (4 suites: SELECT, filtros, período, RBAC 403)
  - **Build/Lint:** PASS (0 errors, 0 warnings)
  - **Pilares:** P1 N/A (estrutural); P2 ✅ controller próprio (lógica RBAC + agregação específica); P3 N/A (sem DClasses novas)
  - **ADRs:** **ADR-V2-072 Fase 2** (endpoints agregação + history + migration + RBAC org-alvo), ADR-V2-001/008/003 (vinculados)
  - **Score:** 9.0/10 (APPROVED — SQL injection auditada, RBAC testada, ZERO N+1)
  - **Frontend (Fase 2 separada):** Gaveta admin de distribuição de motivos com charts (skill dataviz) — pendente de integração
  - **Status:** Fase 1+2 backend 100% COMPLETA, pronto para consumo frontend

- **Endpoint `POST /projects/:id/promote-to-template` — promover List/Space a template reutilizável (V2 F11, Task 7, 2026-07-08)**
  - Nova rota para promover um projeto real (List -352 ou Space -350) a template reutilizável (idClasse -401/-402), criando uma CÓPIA — projeto original permanece intacto
  - **Decisão:** CÓPIA, não mutação (requisito CEO: "Testes E2E" continua com ~49 tasks, enquanto template resultante aparece no catálogo)
  - **Motor:** Reutiliza `cloneTree()` provado em produção (duplicate/from-template) com remap inverso de classe (-352→-401, -350→-402)
  - **DTO:** `PromoteToTemplateDto` com `categoria` obrigatório (texto livre, sem enum — permite novas categorias em runtime) e `novoNome` opcional
  - **RBAC:** MANAGER na origem (herdado de `cloneTree`, sem reimplementar)
  - **Tenant isolation:** Template org-scoped (idEstab = org ativa do JWT), nunca global
  - **Blocos:** Copiados sem tasks (molde-limpo) — conforme plano aceito pelo CEO
  - **Testes:** 10 testes novos (100% PASS) cobrindo promoção LIST, SPACE com filhas, validações, tenant, idEstab
  - **Build/Lint:** PASS (0 errors, 0 warnings)
  - **Pilares:** P2 REUTILIZADO (cloneTree + ProjectsController existentes); P1/P3 N/A (estrutural)
  - **ADRs:** **ADR-V2-062** (novo — cópia + remap bidirecional), ADR-V2-061 (pai), ADR-V2-042/058 (tenant/espelho)

- **MCP — Transporte Streamable HTTP (spec 2025-03-26) — Reforma 1, 5 fases F1–F5 COMPLETA (V2 F11, 2026-07-04)**
  - **Objetivo:** Habilitar Claude WEB conectar ao `/mcp` sem quebrar Claude Code (X-MCP-Key, sempre JSON)
  - **Resultado:** Protocolo aditivo, stateless, JSON-only, 100% back-compat
  - **F1 — Protocol Version Negotiation:** `McpRouterService.negotiateProtocolVersion()` ecoa versão do cliente (allow-list `['2025-03-26','2024-11-05']`); ausente/desconhecida → default `'2024-11-05'` preserva Claude Code
  - **F2 — HTTP 202 Accepted:** body só-notifications/responses → HTTP `202` sem corpo; body com ≥1 request → HTTP `200 + application/json`. Dupla checagem `bodyContainsRequest()` + `@Res({ passthrough: true })`. Audit (DEvento -495) reflete httpCode real.
  - **F3 — Method Validation:** `GET /mcp` e `DELETE /mcp` → HTTP `405 + Allow: POST` (sem guards de auth — 405 é protocolo, não credencial)
  - **F4 — Anti DNS-Rebinding:** Nova guard `McpOriginGuard` (ortogonal à auth): `Origin` ausente → permite; `Origin` + allow-list → permite; `Origin` + fora → 403; allow-list vazia → fail-open + warn
  - **F5 — Conformance + Regressão:** 5 suítes (27 testes): protocol-version (6), accept-202 (8), method-not-allowed (4), origin-guard (9), conformance-regressão (16). Handshake Claude Code idêntico. **27/27 PASS, zero regressão.**
  - **Arquivos modificados:** `mcp.controller.ts` (handle + 405 handlers), `mcp.module.ts` (registra guard), `mcp-router.service.ts` (negotiateProtocolVersion), `constants.ts` (constantes transporte)
  - **Novo arquivo:** `src/mcp/guards/mcp-origin.guard.ts` (anti DNS-rebinding)
  - **Specs novos:** 5 suítes cobrindo F1–F5 (27 testes)
  - **Pilares:** N/A (transporte/protocolo, não entidade de negócio)
  - **ADRs:** **ADR-V2-071** (novo — transporte Streamable HTTP aditivo, stateless, JSON-only)
  - **Garantias:** Back-compat total (Claude Code intacto), stateless (sem `Mcp-Session-Id`), JSON-only (nunca SSE), protocol-agnostic (não afeta scopes/rate-limit/tools)

- **MCP tool `create_from_template` — materializar template pronto (V2 F11, Task 1 de 3, 2026-07-03)**
  - Nova tool MCP `create_from_template` — wrapper fino sobre `ProjectsService.createFromTemplate` para clonar estrutura de projeto existente (DClasse -401/-402 TEMPLATE → List/Space real)
  - **Resolução de org de DESTINO (o miolo — MCP sem org de token):** LISTA (idPai) herda org via `findOne(idPai)`; ESPAÇO (sem idPai) deriva via `resolveOrgIdsForUser` (1 org auto, N orgs erro claro)
  - **Autorização de ORIGEM delegada ao service:** template global (idEstab=null) ou org-scoped, 404 leak-free
  - **Pilar 2 (Endpoints):** delega 100% a `ProjectsService.createFromTemplate` — zero reimplementação de clone/seed/remap
  - **Schema:** raiz `type:object` SEM anyOf/oneOf/allOf (anti-footgun tools/list)
  - **Testes:** 15/15 PASS (scope, params, org resolution, herança org, includeTasks, novoNome/novoIcone, presença em tools/list, contagem 23→24)
  - **ADRs:** ADR-V2-051, ADR-V2-042, ADR-V2-061, ADR-V2-068, ADR-V2-069, ADR-V2-070
  - **INICIATIVA "MCP cria estrutura" — 3/3 COMPLETA:** create_block (8.5) + create_project (8.8) + create_from_template (9.0)

- **MCP tool `create_project` — criar Space/Folder/List via MCP (V2 F11, Task 3, 2026-07-03)**
  - Nova tool MCP `create_project` — wrapper fino sobre `ProjectsService.create` para criar projetos na hierarquia canônica (Space -350, Folder -351, List -352)
  - **Resolução de org (RBAC por tipo):** SPACE deriva via `resolveOrgIdsForUser` (1 org auto, N orgs erro, 0 orgs erro); FOLDER/LIST herdam via `findOne(idPai)`
  - **Scope:** `projects:write` (ADR-V2-068/070) — estende escopo existente para cobrir criação (widening bounded por membership)
  - **Tenant isolation:** validação via `projectsService.findOne` (ADR-V2-042/069) — paridade com HTTP
  - **Pilar 2 (Endpoints):** delega 100% a `ProjectsService.create` — zero duplicação de lógica
  - **Testes:** 19/19 PASS (escopo, params, idClasse whitelist, org resolution, FOLDER/LIST idPai, presença em tools/list, contagem 22→23)
  - **ADRs:** ADR-V2-051, ADR-V2-042, ADR-V2-068, ADR-V2-069, **ADR-V2-070 (novo)**

- **MCP tool `create_block` — CRUD completo de blocos/fases (V2 F11, Task 2, 2026-07-03)**
  - Nova tool MCP `create_block` — wrapper fino sobre `TasksService.create` com `idClasse=-200` (FASE/BLOCO, ADR-V2-047/050)
  - Permite agente criar blocos e sub-fases (via `idPai`) — completa o CRUD de blocos no MCP
  - **Scope:** `tasks:write` (ADR-V2-068) — gate de autorização antes de qualquer query
  - **Tenant isolation:** validação via `projectsService.findOne` (ADR-V2-042/069) — paridade byte-a-byte com `create_task`
  - **Pilar 2 (Endpoints):** delega 100% a `TasksService.create` — zero duplicação de lógica
  - **Testes:** 10/10 PASS (escopo, validação de params, BigInt, maxLength, tenant, presença em tools/list) + zero regressão
  - **Registro:** 4 pontos (tools.schema.json, mcp-router.service.ts, mcp.module.ts, spec updates)
  - **ADRs:** ADR-V2-047, ADR-V2-050, ADR-V2-042, ADR-V2-068, ADR-V2-069

- **Herança de campos do pai + rollup de tempo on-read em tasks filhas (V2 F5/F8, Task 1, 2026-06-18)**
  - **Frente 1 — Herança na criação (`create()`):** quando `dto.idPai` presente, filha herda do pai direto `idAssignee`, `dueDate`, `idPriority` e `idStatus` sempre que o DTO não traz o campo (DTO-vence-pai). INBOX preservado para tasks raiz (zero regressão). Ramo PHASE (-200) ignorado (fase nasce null). Pai sem status → filha cai em INBOX. Sem query extra (reusa o `select` do pai já existente — ZERO N+1).
  - **Frente 2 — Rollup de tempo on-read (`findMany`/`findOne`):** novo helper `buildChildrenTimeRollupMap` em 1 query agregada `idPai IN (lote)` (ZERO N+1); task mãe (com ≥1 filha direta) exibe a soma do tempo das filhas diretas em `timeSpentLabel`; folha mantém own-time. Rollup 1-nível (NÃO recursivo — ADR-V2-001). Nenhuma coluna/tabela nova.
  - **DTO:** 2 campos novos em `TaskResponseDto`: `hasChildren: boolean` (mãe vs folha) e `timeSpentIsRollup: boolean` (label veio do rollup). Campos computados on-read — schema intocado.
  - **Testes:** 13 novos testes em 2 suítes (`tasks-inheritance.spec.ts` e `tasks-time-rollup.spec.ts`), 13/13 PASS, zero regressão no baseline (49 falhas pré-existentes mantidas).
  - **Pilares:** P1 N/A (DTask estrutural, Prisma direto correto) | P2 REUTILIZADO (zero controller novo, 2 campos adicionados ao DTO existente) | P3 N/A (zero DClasse nova — seed intocado)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-047 (hierarquia DTask.idPai), ADR-V2-050 (ramo TASK vs PHASE), ADR-V2-057 (telemetry/manualTimers fonte única)

- **MCP tools de leitura `get_task_tree` / `get_project_metrics` / `list_my_tasks` (gate `tasks:read`)** (V2 F11 — PR1, 2026-06-17)
  - 3 novas tools MCP de LEITURA, todas wrappers finos sobre services de domínio já existentes e testados (ZERO N+1, ZERO Prisma direto, ZERO lógica de negócio):
    - `get_task_tree` → `PhaseTreeService.buildTree(rootId, { maxDepth, includeMetrics })` — árvore hierárquica fase→task→subtask; retorna `{ root, totalNodes, maxDepthReached }`
    - `get_project_metrics` → agrega `DashboardService.getDashboard` (cycleTime/leadTime/throughput/wipAge/cfd, sempre) + `ForecastService.forecast` (Monte Carlo p50/p75/p85/p95, opcional). Histórico insuficiente → `forecast: null` + `forecastError`, a tool **nunca falha** (BadRequest capturado no handler)
    - `list_my_tasks` → `TasksService.findMany({ assigneeId: ctx.dEntidadeId, ... }, scope)` — visão "meu trabalho"; **anti-fraude:** o assignee é SEMPRE o caller (do contexto MCP), nunca do input
  - **Scope:** `tasks:read` (ADR-V2-068) — `requireScope` como 1ª linha de cada handler; sem o scope → FORBIDDEN (-32002)
  - **Tenant isolation (ADR-V2-042):** `findAccessibleProjectIds` + 404 anti-enumeration em `get_task_tree`/`get_project_metrics`; lista vazia (não 404) em `list_my_tasks`
  - **Registro:** `mcp-router.service.ts` (injeção posicional antes de `configService`) + `mcp.module.ts` (+ imports `FlowMetricsModule`/`ForecastModule`) + 3 entradas em `tools.schema.json` (catálogo passa de 18 → 21 tools)
  - **Tests:** `get-task-tree.tool.spec.ts`, `get-project-metrics.tool.spec.ts`, `list-my-tasks.tool.spec.ts` + atualização de `mcp-tools.scope-enforcement`, `mcp-tools.schema-consistency` e `mcp-block-d` (contagem 18→21)
  - **Pilares:** P1 N/A (leitura estrutural DTask/DProject, sem Engine) | P2 REUTILIZADO (envelopa services existentes) | P3 N/A (zero DClasse)
  - **ADRs:** ADR-V2-068 (scope catalog `tasks:read`), ADR-V2-047 (árvore de fases), ADR-V2-042 (tenant isolation)

- **MCP tool `delete_task` (gate `tasks:write`)** (V2 F11, 2026-06-17)
  - Nova tool MCP `delete_task` — wrapper fino sobre `TasksService.delete` (soft-delete; cascateia para subtarefas por padrão, `cascade=false` desvincula filhas)
  - **Scope:** `tasks:write` (ADR-V2-068) — gate `requireScope` antes de qualquer query; sem o scope → FORBIDDEN (-32002)
  - **Tenant isolation (ADR-V2-042):** `findOne(taskId)` + `projectsService.findOne(projectId, dEntidadeId)` (paridade com `update_status`/`update_timer`); `accessibleProjectIds=[task.projectId]` (gate restrito ao projeto autorizado)
  - **Registro:** `mcp-router.service.ts` + `mcp.module.ts` + entrada em `tools.schema.json` (catálogo passa de 17 → 18 tools)
  - **Tests:** `delete-task.tool.spec.ts` (12 casos: happy paths cascade default/true/false, FORBIDDEN scope/vazio/undefined, INVALID_PARAMS taskId/cascade, NotFound/Forbidden propagados) + atualização de `scope-enforcement` e `schema-consistency`
  - **Pilares:** P1 N/A (delete estrutural via service, sem Engine) | P2 REUTILIZADO (envelopa endpoint existente) | P3 N/A (zero DClasse)
  - **ADRs:** ADR-V2-068 (scope catalog), ADR-V2-047 Q6 (cascade default), ADR-V2-042 (tenant)

- **MCP Scope Catalog — Formalização (ADR-V2-068 Fase 5 — documentação)** (V2 F11, 2026-06-17)
  - **ADR-V2-068 redigido:** catálogo canônico de 6 scopes MCP (`tasks:read`, `tasks:write`, `notifications:read`, `notifications:write`, `projects:write`, `executions:create`)
  - **Mapeamento 17 tools → scope:** cada ferramenta MCP requer scope específico (ZERO risk collapse — `executions:create` é separado porque queima tokens)
  - **Storage ZERO tabela nova:** persiste em DTabela -472 `dados.scopes` (ratifica ADR-V2-001)
  - **Grandfathering:** script `mcp-grandfather-scopes.ts` reescreve keys legadas para ACESSO_TOTAL (idempotente, auditoria inline em `dados`)
  - **Documentação:** atualizadas `docs/mcp-setup.md` (catálogo + regras privilege escalation), `docs/decisions/ADR-V2-067` (estendido), `docs/ROADMAP.md`
  - **Pilares:** P1 N/A | P2 REUTILIZADO (enforcement em handlers) | P3 N/A (zero DClasse)
  - **ADRs:** ADR-V2-068 (novo), ADR-V2-067 (estendido), ADR-V2-001/003/004 (relacionados)

### Added (anterior)

- **MCP Scope Catalog — Fase 2: Gate anti-escalação em `POST /mcp/keys` (ADR-V2-068)** (V2 F11 DEV-13, 2026-06-17)
  - **`RoleResolverService.getAllowedMcpScopes(userEntidadeId)`:** deriva o conjunto de scopes MCP permitidos a partir dos vínculos do user em DVincula (org -161/-162/-163, projeto -171/-172/-173) — 1 query, ZERO N+1
  - **Regras role→scope:** todo user → `tasks:read` + `notifications:read` + `notifications:write`; MEMBER (-162/-172) → +`tasks:write`; MANAGER (-171)/ORG_ADMIN (-161) → +`projects:write` +`executions:create`
  - **`McpKeyService.generate()` valida em 3 etapas:** lista vazia → 400; scope fora de `ALL_MCP_SCOPES` → 400; scope acima do role → 403 com `{deniedScopes, allowedScopes}`
  - **Endpoint `GET /mcp/keys/allowed-scopes`:** retorna `{allowedScopes}` para a UI role-aware (Fase 4)
  - **Tests:** role-resolver + mcp-key.service + mcp-keys.controller (31/31 PASS)
  - **Pilares:** P1 N/A | P2 REUTILIZADO (RoleResolver existente) | P3 N/A (zero DClasse)
- **MCP Scope Catalog — Fase 3: Script grandfather de keys legadas (ADR-V2-068)** (V2 F11 DEV-13, 2026-06-17)
  - **`scripts/mcp-grandfather-scopes.ts`:** migração one-shot que reescreve `dados.scopes` de TODAS as MCP keys (DTabela -472) para `ACESSO_TOTAL` (6 scopes), reativando keys legadas após o enforcement da Fase 1
  - **Auditoria in-place:** preserva `scopesPreviousValue` + `grandfatheredAt` no próprio `dados` (zero tabela nova)
  - **Idempotente:** skip de keys já com o catálogo completo; suporta `DRY_RUN=1`; `npm run script:mcp-grandfather`
  - **Tests:** helper puro `computeGrandfatheredDados` — 5 specs PASS

- **MCP Scope Catalog — Fase 1: Enforcement per-tool em 17 tools (ADR-V2-068)** (V2 F11 DEV-13, 2026-06-16)
  - **Catálogo canônico:** `MCP_SCOPES` com 6 scopes finos em `src/mcp/constants.ts` (`tasks:read`, `tasks:write`, `notifications:read`, `notifications:write`, `projects:write`, `executions:create`)
  - **Tipos:** `McpScope` exportado; `ALL_MCP_SCOPES` array; `MCP_SCOPE_PRESETS` (READ_ONLY, READ_WRITE, FULL_ACCESS)
  - **Enforcement:** 17 tools chamam `requireScope(ctx, scope)` como primeira instrução (15 ferramentas recebem verificação nova, 2 harmonizadas com constante)
  - **Sem scope:** FORBIDDEN (-32002) com `data.reason='missing_scope'`
  - **Testes:** 17 specs FORBIDDEN consolidadas em `mcp-tools.scope-enforcement.spec.ts` + 22 specs de infraestrutura atualizadas (legacy scopes → canônicos)
  - **Pilares:** P1 N/A | P2 REUTILIZADO (enforcement em handlers) | P3 N/A (zero DClasse)
  - **BREAKING (mitigado Fase 3):** Keys MCP legadas `["tools:read","tools:call"]` recebem FORBIDDEN até migration
  - **ADRs:** ADR-V2-068 (novo — proposto, fase 5), ADR-V2-067 (estendido), ADR-V2-001/003/004 (relacionados)

- **MCP Tool — `update_timer`: controla timer manual de task (start/pause/resume/stop) via MCP (ADR-V2-057)** (V2 F11 DEV-12, 2026-06-15)
  - **update_timer:** novo parâmetro obrigatório `action` (enum: 'start'|'pause'|'resume'|'stop'); retorna envelope `{ taskId, action, timer: TaskTimerStateDto }`
  - **Scope MCP:** `tasks:write` (reutilizado de create_task/update_task)
  - **Tenant isolation ADR-V2-042:** validação tripla (task existe, projeto acessível, membership)
  - **Workspace público ADR-V2-051 §8:** paridade com execute_task (workspace público suportado)
  - **Mapeamento 409:** ConflictException → INVALID_PARAMS (-32602) com `reason='timer_conflict'` (sem alarme)
  - **Tests:** 14 unit + 4 integration = 18 testes PASS; scope validation, tenant isolation, conflict handling 100%
  - **Pilares:** P1 N/A (estrutural) | P2 REUTILIZADO (TasksService.timer genérico) | P3 N/A (zero DClasse)
  - **ADRs:** ADR-V2-057 (timer manual), ADR-V2-067 (scope per-tool), ADR-V2-042 (tenant), ADR-V2-051 (workspace público)

- **MCP Tool — `execute_task`: dispara F6 OperacaoExecucaoClaude via MCP com scope dedicado (ADR-V2-066, ADR-V2-067)** (V2 F6/F11, 2026-06-15)
  - **execute_task:** novo parâmetro obrigatório `taskId`; retorna envelope assíncrono `{ executionId, taskId, projectId, status=QUEUED|AWAITING_APPROVAL, riskLevel, riskClassId, createdAt, pollHint }`
  - **Scope MCP:** `executions:create` dedicado (primeira tool com scope per-tool RBAC) — tasks:write NÃO autoriza
  - **Async fire-and-poll:** Risk LOW enfileira imediatamente; Risk MED/HIGH retorna status `awaiting_approval` (não é erro — cliente sabe pelo response)
  - **Tenant isolation ADR-V2-042:** validação tripla (task existe, projeto acessível, user tiene membership)
  - **Helper novo:** `requireScope(ctx, scope)` em `tool-params.ts` — padrão para RBAC fino em novas tools
  - **Método novo:** `EntidadeService.getUserGroupIdFromEntidade(entidadeId)` — irmão de `getEntidadeIdFromUserGroup`
  - **Tests:** 15 unit + 5 integration = 20 testes PASS; scope validation, risk gate, tenant isolation testados
  - **Pilares:** P1 ATIVADO (Engine F6), P2 REUTILIZADO (ExecutionsService genérico), P3 N/A (zero DClasse)
  - **ADRs:** ADR-V2-066 (async fire-and-poll), ADR-V2-067 (scope executions:create)

- **MCP Tools — Parâmetro `fields` (valores de colunas customizáveis) em `create_task` e `update_task` (escrita)** (V2 F11 Task 4b-valores, 2026-06-07)
  - **create_task:** novo campo opcional `fields` (Record<string, string|number|boolean|null>)
  - **update_task:** novo campo opcional `fields` com semântica merge (presente=merge, ausente=nao toca, null DENTRO de fields limpa coluna)
  - Empacotamento em `dados.fields` para coexistir com `idBloco` (ADR-V2-065 — single dados key)
  - Validação server-side contra `DProject.tableFields` (MCP NAO valida tipos — backend responsável)
  - Helper `optionalRecordField` em `tool-params.ts` (valida shape = object, nao array/primitivo)
  - Tests: 8 specs novos em `mcp-tools.create-task-fields.spec.ts` + 6 specs em `mcp-tools.update-task-fields.spec.ts` (merge, null, ausente, validacao shape)
  - Pilares: P1 N/A | P2 REUTILIZADO (TasksService.create/update) | P3 N/A (zero DClasse)
  - ADRs: ADR-V2-065 (dados.fields + idBloco coexistem), ADR-V2-042 (tenant isolation)

- **MCP Tool — Exposição de `tableFields` (schema de colunas customizáveis) no retorno de `get_project` (leitura)** (V2 F11 Task 4a, 2026-06-07, ADR-V2-061)
  - **get_project:** campo `tableFields` sempre retornado (sem custo de query extra)
  - Payload base inclui `{ version, columns[] }` ou `null` para não-Listas
  - Leitura pura — nenhuma escrita nesta versão (Task 4b adiada)
  - Tenant isolation ADR-V2-042 preservada
  - Tests: regressão completa — schema + casos m/n cobertura 100%
  - Pilares: P1 N/A | P2 REUTILIZADO (retorna ProjectResponseDto existente) | P3 N/A
  - ADRs: ADR-V2-061 (tableFields como schema versionado)

- **MCP Tool — Filtro `idPai` em `list_tasks` para listar subtarefas e tasks raiz** (V2 F11, 2026-06-07, ADR-V2-047)
  - **list_tasks:** novo parâmetro opcional `idPai` (string numérica OU literal `"null"`)
  - Semântica: `idPai="1234"` lista filhas diretas da task 1234; `idPai="null"` lista tasks raiz (sem pai)
  - Validação: regex `^-?\d+$` OU literal `"null"` — match com ListTasksQueryDto
  - Propagação: `!== undefined` (preserva `"null"` e `"0"` como valores válidos)
  - Reutiliza `TasksService.findMany` com depth=1 default (Pilar 2 ATIVADO)
  - Tenant isolation ADR-V2-042 preservada (scopedProjectIds + anti-enumeration)
  - Pilares: P1 N/A | P2 REUTILIZADO (findMany genérico) | P3 N/A (zero DClasse)
  - Tests: 4 specs novos em `mcp-tools.list-tasks-idpai-filter.spec.ts` (numérico + "null" + validação + scope), todos PASS
  - ADRs: ADR-V2-047 (subtarefa/hieararquia), ADR-V2-042 (tenant isolation)

- **MCP Tools — Paridade de campos em create_task / update_task (priority, dueDate, idPai, assigneeTeamId, idBloco)** (V2 F11, 2026-06-07)
  - **create_task:** novos campos opcionais `priority` (LOW/MEDIUM/HIGH/URGENT), `dueDate` (ISO 8601), `idPai` (subtarefa), `assigneeTeamId` (DEntidade -155), `idBloco` (DTask -200 via dados.idBloco)
  - **update_task:** mesmos novos campos com semântica ternária (ausente=não toca, null=remove, string=define)
  - Validações: enum priority, ISO 8601 dueDate, BigInt-parseabilidade IDs
  - Helpers em `tool-params.ts`: `optionalIso8601`, `assertIso8601`, `extractOptionalStringOrNull` com suporte a validações condicionais
  - Reutiliza `TasksService.create`/`TasksService.update` (Pilar 2 ATIVADO)
  - Tenant isolation ADR-V2-042 preservada (validação projeto antes de operação)
  - Pilares: P1 N/A | P2 REUTILIZADO | P3 N/A (zero DClasse nova)
  - Tests: 6 specs novos em `mcp-tools.create-task.spec.ts`, 12 specs novos em `mcp-tools.update-task.spec.ts`, todos PASS
  - ADRs: ADR-V2-065 (vínculo dados.idBloco), ADR-V2-047 (subtarefa idPai), ADR-V2-042 (tenant isolation)

### Changed

- **MCP `CreateMcpKeyDto` — exemplo/enum do Swagger migrados para o catálogo canônico** (V2 F11 DEV-13, 2026-06-17, ADR-V2-068 F2)
  - Exemplo trocado de `['tools:read','tools:call']` (legado) para `['tasks:read','tasks:write']`; `enum` dos 6 scopes válidos documentado. Validação semântica (catálogo + escalação) ocorre no service (depende do role)

- **MCP Tools — Realinhamento Bloco↔Task (rename `get_block_tree` → `list_block_tasks`)** (V2 F11, 2026-06-07, ADR-V2-065)
  - **BREAKING CHANGE:** Tool `get_block_tree` removida, substituída por `list_block_tasks`
  - Contexto: vínculo bloco↔task mudou para `dados.idBloco` (JSON field); `idPai` é exclusivamente subtarefa
  - Tool nova `list_block_tasks` retorna **lista plana** de tasks (não árvore) com métricas opcionais (done/failed/inProgress/total/percent) baseadas em semântica do front
  - Reutiliza `TasksService.findMany` (Pilar 2) — zero query extra
  - Métricas em memória sobre página (se >limit, métricas são parciais — documentado)
  - Tenant isolation ADR-V2-042 preservado (scope RBAC + anti-enumeration)
  - Tool `list_blocks` limpa: `includeMetrics` removido (era no-op)
  - Vocabulário "PHASE" → "Bloco" em descrições MCP e schema
  - **Impacto:** Clientes MCP que chamem `get_block_tree` receberão `METHOD_NOT_FOUND` — migrar para `list_block_tasks`
  - Testes: 155/155 specs MCP PASS (novo test suite list-block-tasks, antigos deletados)
  - ADRs: ADR-V2-065 (novo — eixos independentes agrupamento/hierarquia), ADR-V2-047 (clarificado, não revogado), ADR-V2-042 (relação RBAC)

### Added

- **Multi-Provider IA no Nexus (Gemini + Claude + OpenAI) — Fases 1-7 completas: Provider Registry + Cascata de resolução de chave** (V2 F7, 2026-06-04, ADR-V2-064)
  - **Fase 1 (Seed — 8.0/10):** 4 DClasses novas (-481 GEMINI_API_KEY, -482 CLAUDE_API_KEY, -483 OPENAI_API_KEY, -484 AI_PREFERENCES) em DTabela
  - **Fase 2 (Key Resolver + Pref — 8.0/10):** AiKeyResolverService cascata user→org→global→env (nível user desligado por flag). AiProviderPrefService upsert em DTabela -484. Cache TTL 60s.
  - **Fase 3 (Providers — 8.0/10):** ClaudeProvider (@anthropic-ai/sdk, claude-sonnet-4-5), OpenAiProvider (openai, gpt-4o). Ambos com timeout 30s + retry 1x + error translation
  - **Fase 4 (Registry — 8.0/10):** AiProviderRegistry (DI singleton) desacopla AiChatService do Gemini fixo. Roteamento: `dto.provider ?? pref.org ?? default(gemini)`. Retrocompatibilidade 100% (sem provider → Gemini)
  - **Fase 5 (CRUD Chaves — 8.0/10):** AiKeysController POST/GET/DELETE `/ai/keys` (ADMIN-only, OrgAdminGuard). Masking obrigatório em DTO resposta (plaintext NUNCA retorna). Endpoints adicionais: `GET /ai/providers` (membro — só bool configured), `PUT /ai/preference` (ADMIN — define provider default)
  - **Fase 6 (Erro por Vendor — 8.0/10):** provider-error.util.ts centraliza tradução (401→BadRequest, 429→ServiceUnavailable, timeout→GatewayTimeout) por vendor. Mensagens amigáveis sem vazar detalhe do SDK
  - **Fase 7 (ADR + Docs — CONCLUÍDA):** ADR-V2-064 (decisão arquitetural, 5 alternativas analisadas, conformidade Pilares 1-3 + ADRs 001/003/004/008). `src/ai/README.md` atualizado (multi-provider, cascata, env vars, endpoints, pendências). Swagger 100% em endpoints `/ai/keys`, `/ai/preference`, `/ai/providers`.
  - **Conformidade:** Zero tabela nova (ADR-V2-001), chaves em DTabela (ADR-V2-004), RBAC via DVincula -161 ADMIN (ADR-V2-003), DEvento chat intacto (ADR-V2-008)
  - **Decisões Travadas CEO:** Cascata user→org→global→env. Plaintext nesta leva (PRÓXIMA TAREFA: criptografia at-rest AES-256-GCM). Seleção PROVEDOR nesta leva (seleção MODEL é próxima). Dono=Organization, usuário nunca vê chave.
  - **Testes:** 94 specs ai.* (unit+integration) — 100% PASS. Registry 20, Resolver 18, Controller 8, Error translation 15, Chat roteamento 5, End-to-end retrocompat 2, Regression 26 — zero regressão.
  - **Build:** PASS, tsc 0 errors, eslint 0 warnings. Performance: 1 query cache por (provider, orgId, userId), TTL 60s. Sem N+1.
  - **Pilares:** Pilar 1 N/A (estrutural). Pilar 2 controller especifico justificado (masking+gate+vendor validation ≠ genérico /tabela). Pilar 3 4 DClasses novas (-481/-482/-483/-484)
  - **ADRs:** ADR-V2-064 (novo — Provider Registry), ADR-V2-001/003/004/008 (relacionados)
  - **Pendências de Alta Prioridade:** DEBT-AI-01 criptografia at-rest (isolado no AiKeyResolverService, zero mudança schema). DEBT-AI-02 seleção modelo por provider (schema pronto, falta UI). DEBT-AI-03 frontend seleção provider.
  - **Commits (Fases 1-6):** `37b6c91` (seed, resolver, Claude/OpenAI, registry), `ae9df86` (CRUD chaves masked, endpoints, endpoints), `e253683` (error translation)

- **Realtime WebSocket (Socket.io) no Board da Lista — Fase 0/1/2 completas: Tempo real com consumer dinâmico** (V2 Transversal F7/F10, 2026-06-04, ADR-V2-063)
  - **Fase 0 (Eventos — 8.5/10):** Completar emissão de eventos em `tasks.service.ts` (novo `task.updated` para task normal com `projectId`+`actorId`, add `projectId` em `task.status.changed`, add `actorId` em deletes). `event-types.ts` com novo tipo, `audit-log.consumer.ts` com mapeamento `-489 AUDIT_GENERIC`
  - **Fase 1 (Gateway + Guard — 8.8/10):** WebSocket namespace `/realtime` com Socket.io 4.8.3. `RealtimeGateway` (@WebSocketGateway) com handlers `join:list`/`leave:list` + método `broadcast()`. `WsJwtGuard` valida JWT (2 vias: auth.token ou header), popula `client.data.user`. CORS configurável `REALTIME_CORS_ORIGIN`
  - **Fase 2 (Consumer + Module — 9.2/10):** `RealtimeConsumer` (IEventConsumer dinâmico, registrado via `EventRouter.registerConsumer()` em RealtimeModule.onModuleInit). Mapeia `task.*`→`task.*`, `phase.*`→`block.*`. Envelope imutável `{ event, listId, entityId, actorId }` → sala `list:{listId}` via `gateway.broadcast()`. RBAC no join reusa `ProjectsService.findAccessibleProjectIds()` (zero duplicação)
  - **Conformidade:** Zero tabela/DClasse nova (ADR-V2-001, ADR-V2-008). Pilar 1 N/A (consumer lê DEvento). Pilar 2 OK (RBAC reuso). Pilar 3 OK (zero seed novo, -489 AUDIT_GENERIC)
  - **Precedente:** ADR-V2-049 (Telegram listener — consumer dinâmico, padrão validado)
  - **Performance:** 1 réplica in-memory <1ms; 2+ réplicas TODO Redis adapter + sticky sessions
  - **Tests:** 27 specs realtime PASS (consumer derivação, guard JWT, gateway RBAC)
  - **Build:** PASS, TypeScript 0 errors, ESLint 0 warnings
  - **Pilares:** Pilar 1 N/A (estrutural), Pilar 2 OK (reuso RBAC), Pilar 3 OK (zero novo)
  - **ADRs:** ADR-V2-063 (novo — realtime via WebSocket consumer dinâmico), ADR-V2-049 (precedente), ADR-V2-001 (zero tabela), ADR-V2-008 (DEvento base), ADR-V2-042 (tenant isolation)
  - **Dependências:** `@nestjs/websockets@10.4.22`, `@nestjs/platform-socket.io@10.4.22`, `socket.io@4.8.3` adicionadas ao `package.json`
  - **Documentação:** `src/realtime/README.md` (protocolo, RBAC, mapa eventos), `ADR-V2-063` (decisão arquitetural), `src/eventos/README.md` atualizado (RealtimeConsumer dinâmico)
  - **Estratégia:** "avisar para invalidar" — envelope mínimo, frontend executa `invalidateQueries()`. Zero patch de entidade (reduz acoplamento, sem vazamento cross-tenant)
  - **Candidato upstream:** Padrão genérico "sala dinâmica derivada de idClasse" reutilizável em Devari-Core

- **Feature Templates — Fase 1-6 completas: Catálogo de Templates + Rota from-template + Motor cloneTree + Blindagem** (V2 F1 Pós-Hierarquia, 2026-06-03)
  - **Seed (Fase 1):** DClasses `-401 TEMPLATE_LIST` + `-402 TEMPLATE_SPACE` (idPai -37) com ADR-V2-061 (proposto)
  - **Refator motor clone (Fase 2):** Extração `cloneTree(opts)` de `duplicate()` sem regressão; `deepCloneTree` + `remapClassesRecursive` separadas
  - **Motor copyTasks (Fase 3):** `TasksService.copyTasks()` com molde-limpo: copia `dados.fields`, zera `idAssignee`/`dueDate`, reset `v3→INBOX`, zera telemetry, novo `DEV-N`, remap `idPai` task→task e `dados.idBloco` task→bloco
  - **Rota from-template (Fase 4):** `POST /projects/:id/from-template` (ListProjectsQueryDto) com remap `-401→-352`/`-402→-350` + carimbo `idEstab` destino + validação MANAGER
  - **Alcance global (Fase 5):** Templates com `idEstab=NULL` (seed/plataforma) visíveis a todas as orgs; templates org-scoped via `idEstab={org}`
  - **Catálogo + Blindagem (Fase 6):** `GET /projects?idClasse=-401&categoria=X` com `TEMPLATE_CLASSES` const (fonte única); templates ocultos de listagens normais (`findMany`, `folders.listProjects`, `search`, `analytics.forecast`); validação em `moveProject` guard
  - **Decisões travadas CEO 2026-06-03:** DClasse dedicada (-401/-402); rota from-template; alcance global+org; categoria em `dados.categoria`; molde limpo; ZERO tabela/coluna nova (ADR-V2-001)
  - **Débito conhecido:** M4 (`agents.service.listAgentProjects` não filtra templates) + filtro defensivo em `folders.listProjects` (não regressão, mas não previne 100%)
  - **Tests:** 6 sub-fases com scores: seed 8.4/10, refator 8.9/10, copyTasks 8.7/10, from-template 8.8/10, alcance-global 8.5/10, catálogo+blindagem 9.1/10 (gate ≥8.0 APPROVED todas)
  - **Build:** PASS, TypeScript 0 errors, ESLint 0 warnings
  - **Pilares:** Pilar 1 N/A (cadastro estrutural), Pilar 2 ATIVO (reutiliza POST /projects genérico), Pilar 3 ATIVO (seed -401/-402, DClasse dedic adas)
  - **ADRs:** ADR-V2-061 (Templates via DClasse + remap), ADR-V2-001 (zero tabela nova), ADR-V2-051 (hierarquia SPACE/FOLDER/LIST), ADR-V2-060 (remoção Sprint libera range -401..-419)
  - **Commits:** `4ad656e` (seed), `57cdc56` (refator cloneTree), `d20de55` (copyTasks molde-limpo), `5fd8a18` (rota from-template), `4f160c8` (alcance global), `9afe42b` (catálogo+blindagem)

### Removed

- **Funcionalidade Sprint removida COMPLETAMENTE do backend (hard delete, 2026-06-03)** (ADR-V2-060, revoga dimensão Sprint do ADR-V2-009)
  - Alinha back ao front: Sprint já fora removida 100% do Scrumbam-Frontend-V2 (era código morto na UI). Mantê-la viva no back gerava incoerência front/back.
  - **6 camadas removidas:**
    - IA (`src/ai/`: system-prompt, context-builder, create-task tool) e Webhooks (eventos `sprint.started`/`sprint.closed`)
    - Métricas: velocity → throughput por período; forecast → rolling-window 30d (fonte única); `historicalSprints` → `historicalPeriods` (analytics/reports/PDF)
    - Endpoint `PUT /tasks/:id/sprint`, `updateSprint`, `idSprint`/`sprintId` de create/filter/select/mapper + DTOs; deletado `update-task-sprint.dto.ts`
    - Seed: removida DClasse `-400 (SPRINT)`; `seed-bootstrap` deixa de criar "Sprint 1" default (sentinela de idempotência segue INBOX -441)
    - Schema: removida coluna `idSprint BigInt?` + `@@index([idSprint])` de DTask; migration `20260603000000_remove_sprint_hard_delete` (`DROP INDEX` + `DROP COLUMN`, destrutiva, irreversível para dados)
    - Módulo: deletada `src/sprints/` (module + README); des-registrado `SprintsModule` de `app.module.ts`
  - **V2-específico:** NÃO propaga ao template Devari-Core (Sprint como wrapper thin segue válido como padrão no template). Range DClasse `-400..-419` liberado no V2.
  - **Workflow Statuses INTACTO:** ADR-V2-009 permanece vigente para Workflow Statuses (wrapper thin).
  - **Pendente deploy (CEO):** aplicar migration staging→prod com `pg_dump` antes (banco dev offline); rodar `prisma/scripts/cleanup-sprint-orphans.ts --apply` para limpar DTabelas -400 órfãs.
  - Commits: `17c24ab` (camadas 1-3), `e8dc53e` (seed), `392104e` (schema+migration), módulo+governança neste commit.

### Fixed

- **Visibilidade de tasks em templates globais (prévia Frontend-V2 agora mostra blocos, V2 F5, 2026-06-03)** (ADR-V2-062, Score 9.0/10)
  - **Problema:** `GET /tasks?projectId={templateGlobal}` retornava vazio (0 blocos) porque o tenant guard negava acesso — templates globais não têm DVincula, logo não entram em `accessibleProjectIds`
  - **Solução:** Helper privado `isGlobalTemplate(projectId)` bypass cirúrgico no `TasksService` — verifica se projeto é template global (idClasse∈{-401,-402} + idEstab=NULL) e libera leitura SOMENTE para esse caminho (zero alargamento do set geral)
  - **Implementação:** `src/tasks/tasks.service.ts`: novo método `isGlobalTemplate()` (1 query por PK, short-circuit) + patches em `findMany` (linha ~605) e `findOne` (linha ~886)
  - **Endpoints beneficiados:** `GET /tasks?projectId={template}` (prévia), `GET /tasks/:id` (leitura task única de template), `:id/tree` (agregado de blocos), `:id/metrics` (métricas de template)
  - **Segurança:** Tripla validação (idClasse ∈ TEMPLATE_CLASSES, idEstab=NULL, excluido=false). Sem vazamento — templates org-scoped e projetos normais continuam negados.
  - **Performance:** 1 query extra SOMENTE quando o guard normal já ia negar (short-circuit). Fluxo normal (usuário autorizado) tem custo ZERO — zero regressão.
  - **Testes:** +8 specs novos (template global retorna itens, template org-scoped nega, dentro-do-scope não consulta dProject). Build PASS, ESLint PASS, regressão ZERO.
  - **Correção adicional (dado/seed):** `prisma/scripts/seed-template-implementacao-devari.ts` — `categoria` mudou de `'dev'` para `'desenvolvimento'` para casar com `TEMPLATE_CATEGORIES[].id` do Frontend-V2 (antes o template caía no bucket "Outros")
  - **Pilares:** Pilar 1 N/A (leitura estrutural de DTask), Pilar 2 ATIVO (reutiliza `/tasks` genérico), Pilar 3 N/A (zero DClasse nova)
  - **ADRs:** ADR-V2-062 (bypass cirúrgico para templates globais), ADR-V2-061 (templates via DClasse), ADR-V2-042 (tenant isolation)

### Added

- **Backfill PROJECT_REF para DTabela legada (V2 pós-F5, 2026-06-02)** (ADR-V2-058/059 passo 5, Score 9.0/10)
  - `prisma/scripts/backfill-project-ref-dtabelas.ts` — script idempotente que corrige os DADOS legados: DTabelas project-scoped cujo `dEntidadeId` foi gravado como `DProject.chave` (P) são reescritas para o handle canônico (DEntidade-espelho -158, E)
  - Contraparte de DTabela do `backfill-project-ref-entidades.ts` (Fase 3 / DVincula). Fase A garante espelhos; Fase B repara `dEntidadeId: P→E` SOMENTE para idClasses project-scoped (statuses -440..-449, sprint -400, priorities -420..-424, task type -430, webhooks -470)
  - **Dry-run por padrão** (ZERO escrita sem `--apply`); detecção de colisão histórica (`classifyValue`) — valores ambíguos ou anômalos NÃO são reparados, vão a relatório de suspeitos (decisão do CEO); reparo atômico (update + DEvento AUDIT -489 na mesma transação); idempotente
  - **Org/user/team-scoped intocados:** API Keys -471, MCP Keys -472, ISSUE_COUNTER -475 e catálogos globais (dEntidadeId NULL) ficam de fora do filtro por design
  - `docs/runbook-backfill-project-ref-dtabelas.md` — runbook de cutover (backup → dry-run → revisar suspeitos → --apply → validar → rollback). Cutover é responsabilidade do CEO (banco dev offline)
  - ZERO tabela/coluna/DClasse nova

### Fixed

- **DTabela↔DProject: FK `dEntidadeId` — handle de projeto em webhooks (V2 pós-F5, 2026-06-02)** (ADR-V2-058/059 passo 4, Score 8.2/10)
  - Estende ADR-V2-058 (DVincula) à FK irmã `DTabela_dEntidadeId_fkey` no módulo webhooks
  - Causa-raiz: `DTabela.dEntidadeId` é FK para `DEntidade.chave`, mas webhooks gravavam `DProject.chave` (P) — viola a FK ao criar webhook (mesmo bug que travava `POST /projects`)
  - ESCRITA: `WebhooksService.create` grava o handle E (`ensureEntidadeRefById`); LEITURA: `list` e `webhooks-hook.service` filtram por `resolveEntidadeRef` (legacy-safe P→E)
  - READ-BACK: `toResponse`/`buildResponse`, payload HTTP do dispatch, evento `webhook.auto_disabled`, payload de teste (redrive) e `listAttempts` expõem o `projectId` real (P) via `resolveProjectId` — contrato HTTP preservado
  - `WebhookOwnerGuard.resolveRequestProjectId` converte E→P para que tenant isolation (`dProject.findFirst` por chave=P) e RBAC (`resolveEntidadeRef`) recebam P — sem regressão de acesso
  - `DEvento.idEntidade` (attempts) mantém o handle E DE PROPÓSITO (FK para DEntidade.chave); apenas o `projectId` exposto é convertido para P
  - ZERO tabela/coluna/DClasse nova; N+1 ZERO (projectId resolvido 1x por listagem); legacy-safe
  - Tests: 9 suites webhooks, 29 testes verdes (mocks `ProjectRefService` passthrough)

- **DTabela↔DProject: FK `dEntidadeId` — statuses/sprint/priorities (V2 pós-F5, 2026-06-02)** (ADR-V2-058/059 passos 1-2, Score — fast-fix, commit `0c68dbb`)
  - Corrige `Foreign key constraint violated: DTabela_dEntidadeId_fkey` em `POST /projects` (LIST)
  - ESCRITA: `seedProject` grava o handle E (`refId`) em vez de `proj.chave` (P); LEITURA: `tasks.service` (criar/mover task, filtro, priority) e o endpoint genérico `/tabelas` resolvem P→E só para idClasses project-scoped (statuses -440..-449, sprint -400, priorities -420..-424, task type -430) — org/user-scoped (API/MCP keys) intocados
  - ZERO tabela/coluna/DClasse nova; legacy-safe (passthrough P sem espelho)

- **DVincula↔DProject: FK violada ao criar projeto — DEntidade-espelho (V2 pós-F5, 2026-06-02)** (ADR-V2-058, Score 8.5/10)
  - Corrige `Foreign key constraint violated: DVincula_idLocEscritu_fkey` em `POST /projects`
  - Causa-raiz: `DVincula.idLocEscritu`/`idEntidade` têm FK para `DEntidade`, mas projetos gravavam `DProject.chave` (sequências separadas) — quebrava quando IDs não coincidiam; quando coincidiam, apontava para DEntidade aleatória (corrupção silenciosa de RBAC)
  - Solução (Opção C): cada `DProject` ganha uma DEntidade-espelho `idClasse=-158 PROJECT_REF`; os 4 grupos de vínculo project-scoped (-171/-172/-173 RBAC, -182 team, -183 folder, -188 space-privado) passam a apontar para a chave da espelho (E), nunca para `DProject.chave` (P)
  - `ProjectRefService` (CommonModule @Global): `ensureEntidadeRef`/`ensureEntidadeRefById`/`resolveEntidadeRef`/`resolveProjectId` + batch, cache LRU dual P↔E (N+1 zero), legacy-safe
  - 27 call sites migrados P→E; espelho criado via Prisma direto em `$transaction` (Pilar 1 estrutural)
  - Migration de índices de expressão Json + script de backfill idempotente (dry-run por padrão, detecção de colisão histórica sem reparo automático) + runbook
  - ZERO tabela/coluna nova (usa `dados` Json + 1 DClasse). Suplanta parcialmente ADR-V2-003/029/FOLDERS-001 no handle de projeto
  - Tests: `project-ref.service.spec.ts` (6/6 — idempotência, recriação de órfão, resolução P↔E)

### Added

- **Timer Manual de Tempo por Tarefa — Fase 1 Backend (V2 F5, 2026-06-01)** (Task 57, ADR-V2-057, Score 8.7/10)
  - 4 endpoints REST `/tasks/:id/timer/{start,pause,resume,stop}` — play/pause/resume/stop via sidebar
  - `ManualTimerSession` + `manualTimers?` em `DTask.dados.telemetry` (Json — zero tabela nova)
  - Separação semântica: `workSessions[]` = IA (EXECUTING/DONE intacto), `manualTimers[]` = humano (novo)
  - Anti-fraude: `durationMs` sempre calculado server-side via Date do servidor (not client clock)
  - `userId` do JWT, nunca do body — impossível falsificar usuário
  - Agregação batch de nomes: `totalsByUser[]` com 1 query para N usuários (ZERO N+1)
  - `TaskResponseDto.timer` novo: running (bool), runningUserId, runningStartedAt, totalsByUser[] (totalMs per user)
  - Regra: 1 timer aberto por task (409 Conflict se tenta abrir 2º)
  - Teste de regressão: cycleTime/leadTime derivam SÓ de workSessions[] mesmo com timer manual aberto
  - Pilares: Pilar 1 N/A (estrutural), Pilar 2 reutiliza /tasks, Pilar 3 zero DClasse nova
  - Build PASS, tsc 0 errors, eslint 0 warnings; 20 tests PASS (14 unit + 6 integration)
  - ADRs: ADR-V2-057 (novo — timer manual), ADR-V2-001 (zero tabela), ADR-V2-005/006 (Engine preservado)

### Added

- **Colunas Customizaveis - Fases 4-7/7 completas + 2 testes pós-auditoria** (Task Colunas, V2 F5, 2026-05-31)
  - `PUT /tasks/:id` agora valida `dados.fields` contra o schema da Lista em `DProject.tableFields` antes de persistir.
  - Merge seguro por chave em `DTask.dados.fields`: celulas existentes sao preservadas; `null` limpa celula opcional; chave desconhecida e ignorada e nao persiste.
  - Validador puro `field-value.validator.ts` cobre os 8 tipos: text, number, date, person, status, checkbox, dropdown, link.
  - `ProjectResponseDto` e `ProjectsService.buildResponse()` expoem `tableFields`; selects de resposta incluem a coluna dedicada.
  - Testes adicionados: `field-value.validator.spec.ts` (14 specs) e `tasks.service.custom-fields.spec.ts` (6 specs — 4 originais + 2 pós-auditoria).
  - 2 testes adicionais (pós-auditoria dos 4 Reviewers, média 8.75/10): cenário required+null rejeita antes de persistir (400), cenário task sem projeto rejeita dados.fields (400).
  - ADR criado: `docs/decisions/ADR-V2-055-tablefields-coluna-dproject.md`.
  - Pilares: Pilar 1 N/A (DProject/DTask estruturais), Pilar 2 respeitado (reuso de PATCH /projects e PUT /tasks), Pilar 3 preservado (zero DClasse nova).

- **Validador de schema + PATCH /projects/:id para Colunas Customizáveis — Fase 3/7** (Task Colunas, V2 F5, Score 8.8/10)
  - Classe `validateTableFields()` pura em `src/tasks/table-fields/table-fields.validator.ts` — 4 regras de unicidade e coerência
  - Validação no DTO: `update-project.dto.ts` com `tableFields?: TableFieldsDto` (@IsOptional @ValidateNested @Type)
  - Escrita direto na coluna `DProject.tableFields` (replace object inteiro, NÃO merge em dados)
  - Read-validate-write: validação roda ANTES da transaction (segurança contra race condition)
  - 4 validações implementadas:
    * Unicidade de `key` entre colunas
    * Unicidade de `order` entre colunas
    * Unicidade de `options[].id` DENTRO de cada coluna (status/dropdown apenas)
    * Coerência tipo↔config: status/dropdown exigem ao menos uma opção
  - `version` apenas persistido (enforcement de concorrencia otimista adiado para fase futura; Fase 7 desta entrega foi ADR/docs)
  - Valores de célula (DTask.dados.fields) validação NÃO implementada (Fase 4)
  - JSDoc completo (validador + DTO + propriedades)
  - 9 testes unitários PASS 100% (`table-fields.validator.spec.ts`)
  - Pilares: Pilar 1 N/A (DProject estrutural), Pilar 2 RESPEITADO (zero endpoint novo, reutiliza PATCH /projects/:id), Pilar 3 N/A (zero DClasse nova)
  - ADRs: ADR-V2-001 (zero tabela nova), ADR-V2-043 (precedente repoUrl como coluna dedicada)

- **DTOs dos 8 tipos de coluna customizável — Fase 2/7** (Task Colunas, V2 F5, Score 8.7/10)
  - Classe `ColumnOptionDto` — opção selecionável (id, label, color?)
  - Classe `ColumnConfigDto` — configuração por tipo (currency, decimals, maxLength, options[])
  - Classe `ColumnDefDto` — definição coluna (key, type, label, order, required?, config?, builtin?)
  - Classe `TableFieldsDto` — envelope versionado (version, columns[])
  - Types + constants: `ColumnType` (8 tipos), `ColumnCurrency` (BRL/USD)
  - Validação aninhada @ValidateNested 3 níveis (TableFields → ColumnDef → ColumnConfig → ColumnOption)
  - Swagger completo (@ApiProperty/@ApiPropertyOptional), JSDoc 100%
  - Espelho perfeito contrato frontend (groups-store.ts) — ZERO divergência
  - Pilares: Pilar 1 N/A (estrutural), Pilar 2 N/A (DTOs sem endpoints), Pilar 3 N/A (sem DClasses)
  - Fases 4-7 concluídas em 2026-05-31; ADR formal: ADR-V2-055

- **Coluna `DProject.tableFields Json?` — Migration Fase 1/7 colunas customizáveis** (Task Colunas, V2 F5, Score 9.2/10)
  - Migration aditiva nullable: `20260530000000_add_table_fields_dproject` (ADD COLUMN / DROP COLUMN IF EXISTS, idempotente)
  - Escopo: por lista (DProject, idClasse -352 LIST)
  - Estrutura: `{ version: 1, columns: [{ key, type, label, order, required?, config? }] }`
  - 8 tipos de coluna (text, number, date, person, status, checkbox, dropdown, link) — suporte em Fase 2+
  - Precedente canônico: `DClasse.tableFields Json?` (escopo global); esta feature replica padrão para escopo por instância
  - Convenção: camelCase sem `@map` (segue DProject.dados, DProject.repoUrl, DClasse.tableFields)
  - **Fases posteriores:** F2-F7 concluídas; ADR formal: ADR-V2-055
  - Pilares: Pilar 1 N/A (estrutural), Pilar 2 N/A (schema-only), Pilar 3 N/A (zero DClasse)
  - ADRs: ADR-V2-001 (coluna ≠ tabela), ADR-V2-043 (precedente repoUrl)

### Fixed

- **Cascade soft-delete de TASKs normais** (Task 1, V2 pós-F5/F8, Score 8.8/10)
  - Bug: Deletar TASK normal (-154) com subtarefas NÃO cascateava — filhas viravam "órfãs vivas" (excluido=false apontando para mãe excluido=true)
  - Solução: Default de cascade mudou de `isPhase` para `true` — agora TODA task com filhas cascateia por padrão
  - `?cascade=false` é o escape para desvincular (caso raro documentado)
  - Evento audit: `task.deleted` (DEvento -498) emitido sempre que TASK normal é deletada (ambos ramos)
  - Payload: `{ taskId, projectId, cascade: boolean, affected: number }`
  - Script de saneamento: `scripts/fix-orphan-tasks.sql` — CTE recursiva idempotente para corrigir órfãs existentes (execução manual exclusiva do CEO)
  - Pilares: Pilar 2 (endpoint /tasks/:id com `?cascade` param), Pilar 3 (zero DClasse nova)
  - ADRs: ADR-V2-047 Q6 (atualizado — default mudou), ADR-V2-001 (zero tabela), ADR-V2-042 (tenant scope preservado)

### Added — Frente B: Nexus IA Chat v1
- **Backend `src/ai/` (14 arquivos novos):**
  - `AiChatController` com POST/GET/DELETE `/ai/chat[/history]`
  - `AiChatService` (orquestracao Gemini + tool calling + persistencia)
  - `ChatMessagesService` (CRUD DEvento -508 polimorfico)
  - `GeminiProvider` (impl @google/generative-ai@0.24.1, modelo `gemini-1.5-flash`)
  - `GeminiApiKeyService` (DTabela -481 + fallback env GOOGLE_API_KEY)
  - 4 tools: createTask, getProjectSummary, createComment, listComments
  - System prompt PT-BR com personalidade Nexus + regras anti-hallucination
  - Hard limits: maxToolIterations=5, timeout 30s, retry 1x em 429/5xx
- **Schema (COUNTS: 107 especificas / 152 total):**
  - DClasse `-481 GEMINI_API_KEY` (DTabela, idPai=-52) — plaintext v1
  - DClasse `-508 AI_CHAT_MESSAGE` (DEvento, idPai=-3) — user/assistant messages
  - Índice B.0 (produção): `@@index([idClasse, identificadorExterno])` em DEvento
- **Frontend `/ia` page (Scrumbam-Frontend-V2):**
  - `useNexusChat()` hook (TanStack Query) — optimistic + rollback + toasts 502/503/504
  - Auto-scroll, design preservado (aurora, cores brand), Quick Actions ocultadas
  - Shift+Enter quebra linha, Enter envia
- **Quality:**
  - Backend: 8.76/10 médio (B.0 9.2, B.2 8.3, B.2.1 9.0)
  - Frontend: 9.0/10 médio (B.3 8.8, B.3.1 9.2)
  - Zero N+1 (1 query load histórico + 1 insert resposta)
  - Build PASS, TypeScript 0 errors, ESLint PASS
- **Decisões v1:**
  - Conversa única por user (identificadorExterno = entidadeId)
  - Resposta completa JSON (não SSE — streaming v2)
  - API key plaintext v1 (encriptação DEBT-NEXUS-02)
  - Rate limit monitorado (DEBT-NEXUS-03)
- **Débitos:** DEBT-NEXUS-01 (specs unitários), DEBT-NEXUS-02 (encriptação KMS), DEBT-NEXUS-03 (rate limit)

### Added

- **CommentsModule polimorfico (task|project|folder|list)** - 2026-05-27 (Fases 1+2+2.1+4, Score médio 8.625/10 APPROVED)
  - **Seed (Fase 1):** DClasse `-507 TASK_COMMENT` (filha de -3 EVENTOS, folha)
  - **Event types (Fase 1):** `task.comment.created`, `task.comment.deleted` + `doc.*` dormentes (ADR-V2-008 reutilizado)
  - **Endpoints:** `POST /comments/:targetType/:targetId` (201), `GET /comments/:targetType/:targetId?cursor=...&limit=20` (200)
  - **Storage:** DEvento polimórfico (Pilar 1 preservado — audit, não transacional)
  - **Resolver centralizado:** CommentTargetResolver valida existência + acesso (task/project/folder/list) com tenant isolation ADR-V2-042
  - **DTOs:** CreateCommentDto (texto), CommentResponseDto (id, targetType, texto, autorNome, createdAt), ListCommentsResponseDto (items + nextCursor)
  - **Enum:** CommentTargetType = 'task'|'project'|'folder'|'list' (doc pronto para v2)
  - **Testes:** 12 integration tests (4 tipos × happy + 404/403/400 + cursor + N+1)
  - **Qualidade:** Build PASS, TypeScript 0 new errors, Queries zero N+1, Conformidade plano 100%
  - **Pilares:** Pilar 1 preservado (audit), Pilar 2 novo controller justificado (resolver), Pilar 3 respeitado (zero tabela nova)
  - **Débitos:** 4 registrados (DEBT-COMMENTS-01 a 04 no ROADMAP)
  - **Decisão:** DClasse `-507 TASK_COMMENT` mantém nome por compat (débito naming aceito polimorficamente)
  - **Fases:** 1 (8.5/10), 2 (8.2/10), 2.1 (9.0/10), 4 (8.8/10); Fase 3 deferida com análise preservada

- **Task E1 — Preferências de usuário em DEntidade.dados.preferences** - 2026-05-27 (Score 9.2/10 APPROVED)
  - **Estrutura:** UserPreferencesDto com 3 sub-blocos (appearance, locale, notifications) — todos opcionais
  - **Persistência:** DEntidade.dados.preferences (campo Json polimórfico — ZERO migration, ZERO tabela nova)
  - **Merge por chave de 1º nível:** PATCH com apenas appearance não altera locale/notifications (seguro para atualizacoes parciais)
  - **DTOs novos:**
    * UserAppearancePreferencesDto — theme (light/dark/system), density (compact/normal/cozy), accent (hex/CSS)
    * UserLocalePreferencesDto — language (BCP-47), timezone (IANA), dateFormat (token)
    * UserNotificationsPreferencesDto — emailOnMention, emailDigest, inAppEnabled (booleanos)
    * UserPreferencesDto (root) — agrupa os 3 sub-blocos
  - **Service integrado:**
    * `updateMe()`: merge intelligente em dados.preferences (linha ~500+)
    * `getMe()`: extrai preferences do dados e retorna no UserProfileDto
  - **DTOs modificados:**
    * UpdateMeDto — campo preferences?: UserPreferencesDto com @ValidateNested @Type
    * UserProfileDto — campo preferences?: UserPreferencesDto (@ApiPropertyOptional)
  - **Validacao:** class-validator em todos os campos (enum para theme/density, @MaxLength para strings, @IsBoolean para flags)
  - **Swagger:** @ApiPropertyOptional completo em todos os campos
  - **Tests:** 5 novos testes unitarios em auth.service.spec.ts (merge correto, campos raiz preservados, noop, validacao rejeitada)
  - **Build:** PASS (npm run build, tsc 0 errors, eslint 0 warnings)
  - **Quality:** Score 9.2/10 APPROVED (gate 8.0 superado; zero breaking changes, 100% backward compatible)
  - **ADRs:** Nenhum ADR novo necessário (reuso de campo Json existente, arquitetura decidida)
  - **Pilar 1:** N/A — cadastro estrutural (Prisma direto em transaction)
  - **Pilar 2:** N/A — nenhum endpoint novo (integrado em PATCH /auth/me)
  - **Pilar 3:** PRESERVADO — DEntidade.dados.preferences é chave dentro do campo Json, não nova DClasse

### Fixed

- **Task D2 — Validação de Existência do targetId em Bookmarks (ADR-V2-051)** - 2026-05-27 (Score 9.0/10 APPROVED)
  - **Metodo privado:** `assertTargetExists(targetId: bigint, targetType: TargetType)` — valida existência do alvo antes de criar bookmark
  - **Comportamento por targetType:**
    * `space|folder|list`: 1 query `dProject.findFirst({ chave: targetId, idClasse, excluido: false })`
    * `team`: 1 query `dEntidade.findFirst({ chave: targetId, idClasse: TEAM_CLASSE, excluido: false })`
    * `doc`: retorna 501 (HttpException NOT_IMPLEMENTED) — modulo de docs nao implementado em V2
  - **Validacao:** BigInt try/catch em `create()` lanca 400 BadRequestException se targetId invalido
  - **Error handling:** NotFoundException com mensagem descritiva `"${targetType} com id=${targetId} não encontrado"`
  - **Zero N+1:** Exatamente 1 query O(1) por tipo, executada ANTES do bloco de deduplicacao
  - **Select minimo:** `{ chave: true }` — confirma existência sem trazer colunas desnecessarias
  - **Tests:** 16/16 passing (10 em `create`, 3 em `findMany`, 3 em `remove`); 6 novos testes adicionados (space-404, folder-404, list-404, team-ok, team-404, doc-501)
  - **Quality:** Build PASS, TypeScript 0 errors, ESLint 0 errors
  - **ADRs:** ADR-V2-051 (DClasse -187 BOOKMARK), ADR-V2-001 (zero tabela nova)
  - **Score:** 9.0/10 APPROVED (gate CEO 8.0 superado; 1 issue MINOR futuro: TargetType extensivel sem default)

### Added

- **Task D1 — Feature de Bookmarks/Favoritos (ADR-V2-051 DClasse -187)** - 2026-05-27 (Score 8.5/10 APPROVED)
  - **Modulo novo:** `src/bookmarks/` com BookmarksController + BookmarksService isolados
  - **Endpoints REST:** `GET /bookmarks`, `POST /bookmarks`, `DELETE /bookmarks/:id` com `AuthCompositeGuard`
  - **Storage:** DVincula -187 (BOOKMARK) — idClasse=-187, idLocEscritu=userId, idEntidade=targetId, metaDados={targetType}
  - **Deduplicacao:** Logica no service — busca existente por `(userId, targetId, targetType)`:
    * Ja existe + ativo → 409 ConflictException
    * Ja existe + soft-deleted → reativa via update (200)
    * Nao existe → cria novo (201)
  - **Ownership:** DELETE valida `idLocEscritu === userId` antes de soft-delete (ForbiddenException se violado)
  - **Filtros:** `?targetType=[space|folder|list|doc|team]` opcional; cursor pagination (`?cursor`, `?limit`)
  - **Tipos:** `TargetType = 'space'|'folder'|'list'|'doc'|'team'` com enum whitelist em DTO
  - **Validacao:** `@IsNumberString` em targetId (DTO); BigInt try/catch em service (400 se invalido)
  - **DTOs:** CreateBookmarkDto (targetId, targetType) + BookmarkResponseDto (id, targetId, targetType, criadoEm) + ListBookmarksResponseDto (items + pagination)
  - **Logging:** NestJS Logger em service + controller com rastreamento de operacoes (create/reativacao/delete/ownership-violation)
  - **Tests:** 10 testes unitarios (findMany, create happy-path + reativacao + conflito, remove happy-path + not-found + ownership)
  - **Swagger:** `@ApiTags('bookmarks')`, `@ApiBearerAuth()`, `@ApiOperation()`, `@ApiResponse()` em todos os handlers
  - **Pilares:** Pilar 1 PRESERVADO (DVincula direto, sem DPedido); Pilar 2 JUSTIFICADO (controller proprio — deduplicacao + ownership nao suportados pelos genericos); Pilar 3 PRESERVADO (DClasse -187 pre-existente em seed)
  - **Review:** 2 issues bloqueantes corrigidos — Issue #1: `@IsNumberString` em targetId (DTO validation); Issue #2: filtro targetType movido para WHERE do Prisma (JSON path filter, paginacao corrigida)
  - **Quality:** Build PASS, TypeScript 0 errors, ESLint 0 errors, 10/10 tests PASS
  - **Score:** 8.5/10 APPROVED (gate CEO 8.0 superado)
  - **ADRs:** ADR-V2-051 (DClasse -187 BOOKMARK), ADR-V2-001 (zero tabela nova)

- **Notifications Integration — Frontend (Sino + Inbox Real)** (2026-05-26, V2 Pós-F13, integração cross-repo)
  - **Frontend:** `NotificationsPopover` novo no topbar — sino com badge vermelho (cap 99+), 5 últimas não lidas em dropdown
  - **Frontend:** /inbox nova — 4 tabs (Todas / Não lidas / Menções / Atribuições), click navega + marca como lida
  - **Hooks (5):** `useNotifications(filter)` com filtros client-side; `useUnreadCount()` com polling 30s; `useMarkAsRead()`, `useMarkAllAsRead()`, `useDeleteNotification()` mutations
  - **Helper:** `resolveNotificationTarget()` mapeia (taskId, projectId) → `/lists/:projectId` ou `/spaces/:projectId` ou fallback
  - **Integração:** Consome endpoints backend `/notifications/*` já existentes (Task #3 F7 — zero alterações backend)
  - **Pilares:** Pilar 2 REUTILIZA endpoints, Pilar 3 PRESERVADO (zero DClasse nova)
  - **Fixes:** Rota válida (/lists com projectId), request duplo removido, fallback null padronizado, a11y (aria-label, type=button)
  - **Quality:** Build PASS, tsc 0 errors, ESLint 0 warnings (7.2 initial → 8.5 APPROVED pós-fixes)
  - **Score:** 8.5/10 APPROVED (gate 8.0, 3 commits com fixes)

- **Task-Lock Execution — UI bloqueio durante execução IA** (2026-05-26, V2 Pós-F13, hotfix cross-repo)
  - **Backend:** Campo `activeExecution?: ActiveExecutionDto | null` em `TaskResponseDto` (JSDoc completo + Swagger)
  - **DTO:** `ActiveExecutionDto` com `id` (BigInt como string), `status` (running/awaiting_approval), `riskLevel` (LOW/MEDIUM/HIGH), `startedAt` (ISO 8601)
  - **Backend:** Batch lookup zero N+1 — `findActiveExecutionsForTasks()` faz 1 query em DPedido com idClasse IN -300..-304, baixado=false
  - **Derivação:** Status via `aprovado` field (false → awaiting_approval, true → running); RiskLevel via idClasse (-302 → MEDIUM, -303 → HIGH, resto → LOW)
  - **Frontend:** `isLocked = activeExecution != null` em kanban-board, task-detail-drawer, list — bloqueia drag, edição, mudança de status/prioridade/assignee
  - **Frontend:** Badge Lock com Lucide icon, visual cursor-not-allowed opacity-60, tooltips "Em execução pela IA"
  - **Pilares:** Pilar 1 PRESERVADO (só leitura DPedido), Pilar 2 EXTENSÃO (zero endpoint novo), Pilar 3 PRESERVADO (zero DClasse nova)
  - **Tests:** 7 unit tests backend (batch N+1 genuíno via toHaveBeenCalledTimes), 108 telegram specs PASS
  - **Score:** 8.6/10 APPROVED (gate 8.0)

### Fixed

- **Task-Lock:** Caso de borda — user em estado "em-progresso + assigneeId=ai" agora bloqueia UI mesmo sem ter clicado Executar
- **Task-Lock:** Perda de tracking ao recarregar — verdade canônica migrou de store volátil (useTaskExecution) para backend (DPedido)

### Performance

- **Task-Lock:** +1 query batch por findMany() de tasks (DPedido lookup), offset ao verificar N+1 queries por request: agora ~N+3 em vez de N+2

- **Prompt Builder — Backend monta prompt natural a partir de DTask** (2026-05-26, V2 Pós-F13)
  - **Feature:** `PromptBuilderService` injetável com 5 templates Markdown (code/docs/research/validation/other)
  - **Detecção:** Cascata `dados.taskType` → regex(nome) → 'other' (suporta aliases legacy)
  - **ExecutionsService:** 3 modos — PROMPT (`{taskId}`), COMMAND (legado), HÍBRIDO (debug)
  - **Engine:** `OperacaoExecucaoClaude` popula `dados.prompt` como fonte canônica V2
  - **Segurança:** Anti-enumeration via `idProject` no WHERE (task de outro projeto → 404)
  - **CommandValidator:** Placeholder simbólico sem metacaracteres (separação texto natural vs comando)
  - **DTO:** Validação cross-field + @Matches(/^\d+$/) em taskId
  - **Tests:** 32 unit/integration tests (PromptBuilder 18 + ExecutionsService 7 + DTO 7), 82 Engine preservados
  - **Pilares:** Pilar 1 PRESERVADO, Pilar 2 ATIVADO (reutiliza POST /projects/:id/execute), Pilar 3 PRESERVADO
  - **ADRs:** ADR-V2-048 (Risk vence TaskType), ADR-V2-049 (Prompt Builder canônico)
  - **Score:** 8.8/10 APPROVED (gate elevado 8.5 pelo CEO)

### Fixed

- **Regressão F13:** Frontend enviava `taskId` como prompt — backend agora monta prompt natural via DTask

### Performance

- **PromptBuilderService:** Templates carregados 1x em memória (fs.readFileSync no constructor), zero IO em runtime
- **ExecutionsService:** +1 query DTask (com select restrito), ZERO N+1

- **Bloco C — Hierarquia Space/Folder/List com Filtros e Guards (C1-C5)** - 2026-05-24 (V2 Frontend Integration)
  - **C1 — GET /projects com filtros idClasse/idPai + hooks useSpaces/useFolders/useLists (8.8/10):**
    * Backend: `ListProjectsQueryDto` com `idClasse?: string` e `idPai?: string` para filtros opcionais
    * Backend: `ProjectResponseDto` com `idClasse!: string` e `idPai!: string | null` obrigatórios
    * Backend: `ProjectsService.findMany()` aplica filtros via WHERE condicional; `buildResponse()` serializa novos campos
    * Backend: Controller `@ApiQuery` documenta filtros para Swagger
    * Frontend: `src/lib/types/api.ts` — tipos DProjectDto, DProjectIdClasse, CreateProjectDto, UpdateProjectDto
    * Frontend: `src/lib/query-keys.ts` — chaves projects.spaces, projects.folders(), projects.lists()
    * Frontend: `src/hooks/use-projects.ts` — hooks useSpaces(), useFolders(), useLists() reutilizam findMany() com filtros
  - **C1 — POST /projects com idClasse discriminado + validateHierarchyRule (8.8/10):**
    * Backend: CreateProjectDto.idClasse opcional (whitelist ['-350','-351','-352'] para SPACE/FOLDER/LIST)
    * Backend: POST /projects agora usa dto.idClasse (não mais hardcoded -153)
    * Backend: validateHierarchyRule() bloqueia hierarquias inválidas em create() + update()
  - **C2 — Campo privado no CRUD DProject + useCreateSpace/Rename/Archive (8.5/10):**
    * Backend: CreateProjectDto/UpdateProjectDto com `privado?: boolean`
    * Backend: ProjectResponseDto com `privado!: boolean`
    * Backend: create() e update() persistem privado em DProject
    * Frontend: useCreateSpace(), useRenameProject(), useArchiveProject() hooks criados
    * Frontend: CreateSpaceDialog novo — input privado checkbox
  - **C3 — SpaceTree hierárquico com lazy loading + localStorage + cadeado (8.3/10):**
    * Frontend: src/components/spaces/space-tree.tsx novo — árvore recursiva com lazy loading por nível
    * Frontend: localStorage persist (scrumban-tree-state) para estado expansão nodes
    * Frontend: Ícone cadeado para Spaces privados (-350), chevron animado (rotação 90°)
    * Frontend: workspace-panel.tsx importa SpaceTree real (antes era mock)
  - **C4 — CRUD Folder/List + inline rename duplo-clique (8.7/10):**
    * Frontend: useCreateFolder(), useCreateList() hooks criados em use-projects.ts
    * Frontend: CreateFolderDialog, CreateListDialog componentes novos
    * Frontend: SpaceTree suporta inline rename duplo-clique (reutiliza useRenameProject)
  - **C5 — Filtro ?privado backend + guards membership preservados (9.0/10):**
    * Backend: ListProjectsQueryDto com `privado?: boolean` + @Transform para boolean
    * Backend: findMany() aplica filtro condicional privado
    * Backend: Controller repassa query.privado com @ApiQuery
    * Backend: Membership guard preservado (DVincula existente protege Spaces privados)
  - **Tests:** 73/73 PASS no backend (era 31 antes do Bloco C)
  - **Pilares:** Pilar 1 N/A (DProject estrutural); Pilar 2 ATIVO (endpoints genéricos); Pilar 3 ATIVO (6 DClasses A1-A3)
  - **Quality Score:** 8.7/10 médio (C1: 8.8, C2: 8.5, C3: 8.3, C4: 8.7, C5: 9.0)

- **Bloco B — Autenticação Real + Workspace Switcher Multi-Org** - 2026-05-24 (V2 Frontend Integration)
  - **B1 — Conexão Auth Frontend (8.8/10):**
    * `.env.local`: `NEXT_PUBLIC_MOCK_AUTH=false` — frontend conectado ao backend real
    * `package.json`: frontend sobe na porta 3001 (backend ocupa 3000)
    * Auth pré-implementado — zero código novo necessário
  - **B2 — Workspace Switcher Multi-Org (8.8/10):**
    * `src/hooks/use-auth.ts`: `useSwitchOrg()` — mutation `POST /auth/switch-org` com atualização de store + invalidação de cache
    * `src/lib/mock/auth.ts`: `mockSwitchOrg()` para modo dev offline
    * `src/components/shell/workspace-switcher.tsx`: orgs reais via `GET /auth/me`, org ativa destacada, loading states, proteção anti-double-click
  - **Backend:** Zero mudança (auth já implementado em F3)
  - **Pilares:** Frontend reutiliza endpoints genéricos (Pilar 2 ATIVADO)

- **Bloco A — Fundação da Hierarquia DProject Space/Folder/List** - 2026-05-24 (V2 ADR-V2-051)
  - **Seed das 6 DClasses** (A1 — Score 8.3/10):
    * -187 BOOKMARK (DVincula — favoritos)
    * -188 SPACE_PRIVATE_MEMBER (DVincula — membro privado)
    * -350 SPACE (DProject — espaço raiz)
    * -351 FOLDER (DProject — pasta agrupadora)
    * -352 LIST (DProject — container de tasks com seed)
    * -353 DOC (DTabela — documento rico em `dados.content`)
    * COUNTS: 104 específicas / 149 total (era 98/143)
  - **Migration Schema DProject** (A2 — Score 9.2/10):
    * `idPai BigInt?` — FK self-referencial (hierarquia Space→Folder→List)
    * `privado Boolean @default(false)` — isolamento por SPACE
    * `@@index([idPai])` e `@@index([excluido, idPai])` para perfs
    * Reversível: migration down testada
  - **Anti-ciclo + Cascade Soft-Delete + seedBootstrap** (A3 — Score 8.5/10):
    * `validateNoCycle()` — CTE recursivo PostgreSQL (impede A→B→A, A→B→C→A)
    * Cascade bottom-up via CTE: Tasks → DVinculas → Projects → pai
    * seedBootstrap condicional: apenas LIST (-352) recebe 9 statuses V3 + sprint
    * UPDATE idPai valida anti-ciclo ANTES de transaction
    * DELETE recursivo não viola FK (SPACE/FOLDER/LIST safe)
  - **DTOs atualizados:**
    * CreateProjectDto: `idClasse?: string` com whitelist ['-350','-351','-352']
    * UpdateProjectDto: `idPai?: string | null` adicionado
  - **JSDoc completo:**
    * `validateNoCycle()`: 26 linhas de descrição + @example
    * `create()`: seedBootstrap condicional documentado
    * `update()`: validacao anti-ciclo antes de transaction documentado
    * `delete()`: cascade hierarquico documentado
  - **Pilares aplicados:**
    * Pilar 1: N/A (DProject é estrutural, Prisma direto)
    * Pilar 2: Reusa POST /projects genérico (zero novo controller)
    * Pilar 3: 6 DClasses adicionadas ao seed (zero tabela nova)
  - **Métricas:**
    * Build: PASS (npm run build, TypeScript 0 new errors)
    * Tests: 31/31 PASS (projects.service.spec.ts + anti-cycle.util.spec.ts)
    * Queries: ZERO N+1 (CTE recursivo + batch paralelo)
    * Migration: Reversível, zero perda de dados
  - **ADRs vinculados:** ADR-V2-051, ADR-V2-001 (zero tabela nova)

- **Task 2: Criar Fase via HTTP `POST /tasks` com `idClasse=-200` (ADR-V2-050 — Fechamento ADR-V2-047)** - 2026-05-22
  - **Feature:** Campo opcional `idClasse?: string` em CreateTaskDto (whitelist `['-154', '-200']`), ramificação em TasksService.create() para PHASE
  - **Comportamento PHASE:** Pula identifier (sequence DEV-N intacta), pula INBOX/priority (derivados de métricas), ignora assignee/sprint/taskType com logger.warn
  - **Validação sub-fase:** Pai com `idClasse=-200` obrigatório se filha é PHASE; TASK filha de PHASE permitida (não-recíproco)
  - **DTOs:** TaskResponseDto.idClasse agora obrigatório (frontend distingue TASK vs PHASE)
  - **Helper:** `buildPhaseDados(creatorId)` separa dados de FASE de dados de TASK
  - **Tests:** 16 novos (10 unit + 6 e2e); 3 specs Telegram drift fix; sweep 487/511 PASS (zero regressão)
  - **Eventos:** `phase.created` emitido pós-persistência (Pilar 7)
  - **Pilares:** Pilar 2 ATIVO (endpoint genérico), Pilar 3 PRESERVADO (zero seed change)
  - **ADRs:** ADR-V2-050 (novo), ADR-V2-047 (pai), ADR-V2-048, ADR-V2-001, ADR-V2-042
  - **Quality Score:** 8.6/10 APPROVED | Build: PASS, TypeScript: 0 new errors | Reviewer: Haiku

- **F10 ADR-V2-047 Fase 10: Testes End-to-End Controller-Level (Fechamento de ADR-V2-047)** - 2026-05-21
  - **E2E Tests:** 4 testes controller-level em `tasks-phase-flow.e2e.spec.ts`
    - Cenario 1 (Happy Path): criar fase → 3 filhas → tree → metrics; validação contrato HTTP completo (79/79 PASS)
    - Cenarios 2-4 (Smoke Tests): propagação HTTP de BadRequestException (depth guard, ciclo, cross-project); lógica adversarial em F3 `phase-hierarchy.service.spec.ts` não duplicada
  - **Filosofia Anti-duplicação:** cenários adversariais (depth>20, ciclo, cross-project) já cobertos em F3; F10 valida APENAS a camada controller
  - **Mocks:** PrismaService, TasksService, PhaseTreeService, PhaseMetricsService via TestingModule; ZERO banco real, ZERO testcontainers (CEO 2026-05-21)
  - **Melhorias Cosméticas:** comentário clareza (linha 242), factory `buildTaskResponse` com campos opcionais (`priority`, `taskType`, `assigneeId`, `sprintId`), JSDoc Cenario 3 menciona "criar ou mover"
  - **Tests:** 4 novos (PASS); baseline 75 (F0–F9) preservada; total suite 179/24 testes scope `tasks`
  - **Pilares:** Pilar 2 RESPEITADO (TasksController genérico); Pilar 3 RESPEITADO (zero seed change)
  - **ADRs:** ADR-V2-047 F10 (completa, ADR FECHADO F0–F10), ADR-V2-001, ADR-V2-042
  - **Quality Score:** 9.0/10 APPROVED | Build: PASS, TypeScript: 0 errors | Reviewer: Haiku

- **ADR-V2-047 FECHAMENTO COMPLETO:** F0–F10 entregues (F2, F6 adiados v2); scores médio 8.7/10; branch `feature/dtask-fases-via-idpai` pronta merge (6 commits ahead origin)

- **F9 ADR-V2-047 Fase 9: V3 Guard + Flow Metrics by-Phase + Telegram Listener** - 2026-05-21
  - **F9a V3 Guard:** Guard `BadRequestException` em `TasksService.updateStatus()` validando `idClasse == -200` (PHASE); impede update em classes não-fases (Pilar 2 DRY)
  - **F9b Flow Metrics by-Phase:** 6 rotas GET `/flow-metrics/by-phase/:phaseId/<metric>` reusando 6 services com novo `taskIdsFilter?` retrocompatível; novo `PhaseDescendantsService` (CTE recursiva, depth<20); novo `ByPhaseResolverService` (resolve + tenant scope); 39 tests novos
  - **F9c Telegram Listener:** Novo `TelegramNotificationConsumer` em `src/channels/telegram/` consumindo `phase.completed` (F8) com idempotência via DEvento `-494 TELEGRAM_MSG_OUT` REUTILIZADA (ADR-V2-008); destinatários v1 = idCreator + assignees diretos; tenant scope 2 camadas; timeout 3s via Promise.race; token ausente = skip silencioso; novo `AccountLinkService.findChatByUser()` para lookup; 47 tests novos
  - **Decisões Críticas:** Reuso de `-494 TELEGRAM_MSG_OUT` evita sequestro de chave, mudança em seed (Pilar 3 inviolado), novo DClasse; ADR-V2-048 (fases fora board V3) e ADR-V2-049 (Telegram pattern replicável) redigidas
  - **Pilares:** Pilar 2 (sem controller novo; reusa `/flow-metrics` + EventRouterService); Pilar 3 (ZERO mudança seed — reutiliza `-494`)
  - **Tests:** 91 novos PASS (5+39+47); retrocompat preservada nos 6 flow-metrics services; baseline 24 falhas pré-existentes mantida
  - **ADRs:** ADR-V2-047 F9 (completa), ADR-V2-048 (fases fora V3), ADR-V2-049 (listener Telegram), ADR-V2-001 (zero tabela), ADR-V2-008 (DEvento), ADR-V2-042 (tenant isolation)
  - **Quality Score:** 8.7/10 APPROVED | Build: PASS, TypeScript: 0 errors | Reviewer: Sonnet

- **F8 ADR-V2-047 Fase 8: Webhooks/Eventos — registro de 4 event types `phase.created/updated/deleted/completed` + detector idempotente `phase.completed` no `TasksService.updateStatus`** - 2026-05-21
  - **Event Types:** 4 novos (`phase.created`, `phase.updated`, `phase.deleted`, `phase.completed`) registrados em supported-events + event-types + webhook-triggers + audit-log
  - **Detector:** `private detectPhaseCompletion(phaseId, projectId)` — fire-and-forget em `updateStatus`
  - **Idempotência:** snapshot em `DTask.dados._meta.phaseSnapshotPercent`; skip re-emissão em DONE→READY→DONE
  - **Cobertura v1:** pai DIRETO apenas; cadeia ancestral para v2
  - **Pilares:** Pilar 2 RESPEITADO (sem PhasesService novo), Pilar 7 RESPEITADO (emissão pós-persistência)
  - **Performance:** ~4 queries: findFirst + compute CTE (~2) + update opcional
  - **Testes:** 11 novos + 1 correção (PhaseMetricsService mock) = todos PASS
  - **ADRs:** ADR-V2-047 F8, ADR-V2-001 (zero tabela), ADR-V2-042 (tenant isolation)
  - **Quality Score:** 8.2/10 APPROVED

- **F11 Task #8: MCP Tools `list_phases` + `get_phase_tree` + filtro `idClasse` (ADR-V2-047 Fase 7)** - 2026-05-21
  - **MCP Tools:** 2 novos (`list_phases`, `get_phase_tree`) + extensão `list_tasks` com filtro `idClasse` polimorfico
  - **Listagem:** `list_phases` com cursor pagination, anti-enumeration tenant gate, `includeMetrics` compat futura
  - **Árvore:** `get_phase_tree` com CTE recursiva (ZERO N+1), suporte a métricas consolidadas (status DONE/FAILED/EXECUTING/PENDING), maxDepth 1..20 guardrail
  - **Filtro:** `idClasse` em `list_tasks` filtra por tipo de task (-200=PHASE, -154=SCRUMBAN_TASK, ou domínio específico), validação regex `^-?\d+$`
  - **Schema:** tools.schema.json 14→16 tools (list_phases, get_phase_tree, updated list_tasks)
  - **Testes:** 25 novos (8+10+7 casos), 158/158 MCP PASS (schemas consistency, tenant isolation, metrics)
  - **Pilares:** Pilar 2 RESPEITADO (TasksService + PhaseTreeService reutilizados); Pilar 3 RESPEITADO (zero DClasses novas, seed canônico)
  - **ADRs:** ADR-V2-047 F7 (integração MCP), ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant isolation)
  - **Quality:** 9.0/10 APPROVED | Build: PASS, TypeScript: 0 errors, Tests: 158/158 PASS

- **F5 Task #2: CTE Recursivas de Tree e Metrics — ADR-V2-047 Fase 5 (Fases via DTask.idPai) — COMPLETA** - 2026-05-21
  - **Services:** `PhaseTreeService.buildTree()` com CTE recursiva + montagem memória (ZERO N+1); `PhaseMetricsService.compute()` com JOIN a DTabela para status
  - **Endpoints:** GET `/tasks/:id/tree?maxDepth=N&includeMetrics=bool` (200 árvore aninhada); GET `/tasks/:id/metrics?recursive=bool` (200 agregação)
  - **Testes:** 25 novos unit (tree + metrics) + 9 atualizados (controller) = 52/52 PASS
  - **Pilares:** Pilar 2 RESPEITADO (endpoints genéricos TasksController); Pilar 3 RESPEITADO (zero DClasses novas)
  - **DTOs:** PhaseTreeResponseDto, PhaseMetricsResponseDto com tipagem completa
  - **JSDoc:** Documentação de literais SQL hardcoded (-200 PHASE, -444/-445/-443 status) + padrão seguro (seed canônico)
  - **Decisões:** CTE JOIN com DTabela.idClasse para resolução de status (estável vs runtime lookup); max depth 20 guardrail hardcoded
  - **Performance:** 2-3 queries total (sem/com métricas), ~45-120ms latência, queries/request ZERO N+1
  - **ADRs:** ADR-V2-047 (implementação 100% Fases 0-5 COMPLETA), ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant gate)
  - **Quality Score:** 8.8/10 APPROVED | Build: PASS, TypeScript: 0 errors, Tests: 52/52 PASS

- **Folders MVP: Agrupamento de Projetos por Organização (Pós-F5, ADR-V2-FOLDERS-001)** - 2026-05-18
  - **DClasses novas (Pilar 3):** -155 FOLDER + -183 FOLDER_PROJECT_LINK (sem tabela ou coluna nova — ADR-V2-001 respeitado)
  - **Service `FoldersService`:** 9 métodos (create, findAllByOrg, listUnassigned, listProjects, update, delete, moveProject + helpers)
  - **8 Rotas REST:** `/folders/unassigned`, `/folders`, `POST /folders`, `/folders/:id/projects`, `PATCH /folders/:id`, `DELETE /folders/:id`, `POST /folders/:id/projects/:pid`, `DELETE /folders/:id/projects/:pid`
  - **DTOs completos:** CreateFolderDto, UpdateFolderDto, FolderResponseDto, ListFolderResponseDto (class-validator + Swagger)
  - **Decisões CEO aplicadas:** folders flat (Q1), cor derivada frontend (Q2), ordem alfabética (Q3), delete move projects para limbo (Q4), migration cria "Projetos" default (Q5)
  - **Testes:** 30/30 PASS (24 unit FoldersService + 6 integration in-memory)
  - **Migration:** script backfill idempotente para orgs existentes (cria pasta "Projetos", vincula projects via DVincula -183)
  - **Pilares:** Pilar 2 RESPEITADO (zero FolderController — tudo em EntidadeController genérico); Pilar 3 RESPEITADO (2 DClasses, seed canônico)
  - **ADRs:** ADR-V2-FOLDERS-001 (redigida), ADR-V2-001 (zero tabela nova), ADR-V2-029 (precedente DVincula)
  - **Quality Score:** 8.3/10 APPROVED | Build: PASS, TypeScript: 0 errors, Lint: PASS
  - **Débito Técnico:** `resolveFolderIdsForProjects` duplicada (FoldersService/ProjectsService) — extrair em futuro quando circular dep for resolvida

- **F11 Task #4: MCP Tool `search_tasks` — busca de tasks via texto livre (ADR-V2-042)** - 2026-05-15
  - **Tool MCP `search_tasks`:** busca tasks por termo de texto em projetos acessíveis ao usuário; escopo automático via `findAccessibleProjectIds` (defense-in-depth)
  - **Classe `SearchTasksTool`** em `src/mcp/tools/search-tasks.tool.ts` (~160 linhas) — validação `q` obrigatória (mín 2 chars), filtro `projectId` opcional + limit (1-50, default 20)
  - **Adaptador `SearchService.searchForMcp`** em `src/search/search.service.ts` (~50 linhas) — 1 query DTask com `idProject IN (accessibleProjectIds)` + ILIKE nome/descricao — **ZERO N+1**
  - **Registração:** `SearchTasksTool` provider em `src/mcp/mcp.module.ts` + SearchModule exported + tool em `src/mcp/services/mcp-router.service.ts` (posição 14 do array tools) + schema em `tools.schema.json` (14→15 tools)
  - **Testes:** `mcp-tools.search-tasks.spec.ts` (9 cases: happy path + limit clamping + projectId validation + anti-enumeration) + `mcp-tools.schema-consistency.spec.ts` atualizado + `mcp-block-d.spec.ts` (count 14→15) — **100% PASS MCP suite 105/105**
  - **Tenant Isolation (ADR-V2-042):** `ctx.dEntidadeId` (bigint) propagado; `ProjectsService.findAccessibleProjectIds` resolve scope; anti-enumeration em projectId inválido (404 genérico, sem leak)
  - **Pilares:** Pilar 2 RESPEITADO (SearchService reutilizado — zero tool/tool-helper novo); Pilar 3 RESPEITADO (zero DClasses novas)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant isolation defense-in-depth)
  - **Quality Score:** 8.8/10 APPROVED | Build: PASS, TypeScript: 0 errors | Reviewer: Sonnet (MCP suite completa 105/105 PASS)

- **F11 Task #3: MCP Tools Notificações — `list_notifications`, `update_notification`, `get_unread_count` (ADR-V2-042)** - 2026-05-15
  - **Tools MCP:** 3 novas tools expõem sistema de notificações (DEvento -490) via MCP
  - **`ListNotificationsTool`** em `src/mcp/tools/list-notifications.tool.ts` (~101 linhas) — lista com cursor pagination + filtro `unreadOnly` (boolean → BooleanString para compatibilidade com NotificationsService)
  - **`UpdateNotificationTool`** em `src/mcp/tools/update-notification.tool.ts` (~117 linhas) — ação discriminante (mark_read, mark_all_read, delete); notificationId obrigatório para mark_read/delete
  - **`GetUnreadCountTool`** em `src/mcp/tools/get-unread-count.tool.ts` (~66 linhas) — thin wrapper para contagem de não-lidas
  - **Registração:** 3 providers em `src/mcp/mcp.module.ts` + 3 tools em `src/mcp/services/mcp-router.service.ts` (posições 8,9,10 do array tools) + schema em `tools.schema.json` (10→13 tools)
  - **Testes:** `mcp-tools.notifications.spec.ts` (12 cases: list happy path + limit clamping + cursor, update 3 actions + RBAC, count) + `mcp-tools.schema-consistency.spec.ts` (verificação bidirecional classes ↔ schema) + `mcp-block-d.spec.ts` (count 10→13) — **100% PASS MCP suite 96/96**
  - **Tenant Isolation (ADR-V2-042):** `ctx.dEntidadeId` (bigint) propagado; SEM `organizationId` (cross-org by design); NotificationsService valida proprietário da notificação
  - **Pilares:** Pilar 2 RESPEITADO (reutiliza NotificationsService — zero controller novo); Pilar 3 RESPEITADO (zero DClasses novas — DEvento -490 já existe)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant isolation defense-in-depth)
  - **Quality Score:** 8.8/10 APPROVED | Build: PASS, TypeScript: 0 errors | Reviewer: Sonnet (score exato do MCP expansion)

- **F11 Task #7: MCP Tool `update_project` com Semântica Ternária para teamId (ADR-V2-042)** - 2026-05-15
  - **Tool MCP `update_project`:** atualiza propriedades de um projeto existente (nome, description, prefix, automationEnabled, gitRepo, teamId)
  - **Classe `UpdateProjectTool`** em `src/mcp/tools/update-project.tool.ts` (~209 linhas) — validação de ao menos 1 campo além de projectId
  - **Semântica Ternária para teamId:** `undefined` = não tocar, `null` = desvincular, `string` = novo time
  - **Tenant Isolation (ADR-V2-042):** `ctx.dEntidadeId` sem `organizationId` (MCP cross-org by design); MANAGER check via service
  - **Registração:** 10º param ao constructor `McpRouterService` (ANTES de `configService`), entrada em `tools.schema.json`
  - **Testes:** 13 cases em `mcp-tools.update-project.spec.ts` (happy path, validação campos, BigInt parse, MANAGER RBAC, projeto 404, ternária teamId) + schema-consistency atualizado → 96/96 PASS MCP total
  - **Pilares:** Pilar 2 RESPEITADO (reutiliza ProjectsService — zero controller novo); Pilar 3 RESPEITADO (zero DClasses novas)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant isolation defense-in-depth)
  - **Quality Score:** 9.0/10 APPROVED | Build: PASS, TypeScript: 0 errors

- **F11 Task #1: MCP Tool `get_task` com Tenant Isolation (ADR-V2-042)** - 2026-05-14
  - **Tool MCP `get_task`:** busca task por ID, escopada aos projetos acessíveis ao usuário via `findAccessibleProjectIds` (defense-in-depth ADR-V2-042)
  - **Classe `GetTaskTool`** em `src/mcp/tools/get-task.tool.ts` (~90 linhas) — injeção de `TasksService` + `ProjectsService`
  - **Fluxo:** resolver `accessibleProjectIds` via `ProjectsService` → delegar para `TasksService.findOne(taskId, accessibleProjectIds)` → validação de tenant em service (anti-enumeration: 404 se fora do scope)
  - **Spec de Consistência Reutilizável:** `mcp-tools.schema-consistency.spec.ts` valida paridade bidirecional classe ↔ `tools.schema.json` (mitigação R-3 do plano MCP expansion). Padrão DRY para Tasks #2-#8: só 1 linha nova por tool.
  - **Registração:** importar em `mcp.module.ts` + adicionar 6º param ao constructor `McpRouterService` (ANTES de `configService`) + entrada em `tools.schema.json`
  - **Testes:** 9 cases em `mcp-tools.get-task.spec.ts` (happy path, params validation, BigInt parse, NotFound propagation, tenant isolation, ctx propagation, tools/list) + 8 cases schema-consistency → 17/17 PASS
  - **Gotchas para próximas tasks:** append-only ao array `tools[]` (nunca inserir no meio), `configService` empurra posição a cada nova tool, `McpUserContext` sem `organizationId` (cross-org by design)
  - **Pilares:** Pilar 2 RESPEITADO (reutiliza TasksService — zero controller novo); Pilar 3 RESPEITADO (zero DClasses novas)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant isolation defense-in-depth)
  - **Quality Score:** 8.7/10 APPROVED | Build: PASS, ESLint: PASS, Total suite MCP: 61/61 PASS

- **F11 Task #2: MCP Tool `update_task` com Orquestração Condicional** - 2026-05-14
  - **Tool MCP `update_task`:** atualização parcial de task (6 campos: name, description, priority, assigneeId, status, sprintId)
  - **Classe `UpdateTaskTool`** em `src/mcp/tools/update-task.tool.ts` (~283 linhas) — Design: UMA tool com campos todos opcionais (excluindo taskId)
  - **Orquestração em sequência:** `update(basicos)` → `updateSprint` → `updateStatus` — status por último minimiza side-effects de transição inválida em estado intermediário
  - **3 Helpers Privados:** `extractOptionalString(field, maxLength)`, `extractOptionalStringOrNull(field)` (semântica: "remover assignee"), `extractOptionalEnum(field, allowed)`
  - **Tenant Isolation (ADR-V2-042):** resolve `accessibleProjectIds` UMA vez, propaga para cada call; cada método valida escopo
  - **Backward-Compat:** `update_status` legada PERMANECE (coexistência OK; descriptions distintas evitam confusão)
  - **Tradução EN→PT:** name→nome, description→descricao (padrão MCP)
  - **Registração:** 7º param ao constructor `McpRouterService` (ANTES de `configService`), entrada em `tools.schema.json` com `anyOf` (≥1 campo obrigatório)
  - **Testes:** 17 cases em `mcp-tools.update-task.spec.ts` (12 DoD a-l + 5 extras m-q: assigneeId null semântica, status VALIDATING→DONE, sprint invalid, callOrder array, multi-tenant) + schema-consistency atualizado → 78/78 PASS MCP total
  - **Pilares:** Pilar 2 RESPEITADO (reutiliza TasksService — zero controller novo); Pilar 3 RESPEITADO (zero DClasses novas)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant isolation defense-in-depth)
  - **Quality Score:** 8.5/10 APPROVED | Build: PASS, ESLint: PASS, Total suite MCP: 78/78 PASS

- **F11 Task #5: MCP Tool `list_members` com Gate de Tenant Isolation** - 2026-05-14
  - **Tool MCP `list_members`:** lista membros de um projeto com seus roles (MANAGER/MEMBER/VIEWER), escopada aos projetos acessíveis ao usuário MCP
  - **Classe `ListMembersTool`** em `src/mcp/tools/list-members.tool.ts` (~102 linhas) — injeção de `ProjectMembersService` + `ProjectsService`
  - **Padrão "gate na tool" (divergência positiva do plano):** resolve `accessibleProjectIds` na tool, valida projeto no scope ANTES de chamar service. Rationale: `ProjectMembersService.getMembers` tem assinatura HTTP-legada sem `accessibleProjectIds`, então gate fica na tool. Anti-enumeration uniforme com `get_task`: NotFoundException 404 vs 403 Forbidden (que vazaria existência).
  - **Fluxo:** `findAccessibleProjectIds(ctx.dEntidadeId)` → validar escopo com `includes(projectId)` → delegar para `getMembers(projectId)` → retornar envelope MCP
  - **Registração:** 8º param ao constructor `McpRouterService` (ANTES de `configService`), entrada em `tools.schema.json` com `inputSchema: { projectId: string required }`
  - **Testes:** 9 cases em `mcp-tools.list-members.spec.ts` (happy path, params validation, BigInt parse, tenant isolation, ctx propagation, tools/list, spy validation) + schema-consistency atualizado → 87/87 PASS MCP total
  - **Pilares:** Pilar 2 RESPEITADO (reutiliza ProjectMembersService — zero controller novo); Pilar 3 RESPEITADO (zero DClasses novas)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant isolation defense-in-depth — padrão "gate na tool" mais robusto)
  - **Quality Score:** 8.8/10 APPROVED (melhor score até aqui) | Build: PASS, ESLint: PASS, Total suite MCP: 87/87 PASS

- **F11 Task #6: MCP Tool `get_project` com `include[]` Opcional e Paralelização** - 2026-05-14
  - **Tool MCP `get_project`:** busca projeto por ID com `include[]` opcional (members | sprints | stats), paralelização via Promise.all
  - **Classe `GetProjectTool`** em `src/mcp/tools/get-project.tool.ts` (~130 linhas) — injeção de `ProjectsService`, `ProjectMembersService`, `SprintsService`, `ProjectMetricsService`
  - **Padrão paralelização condicional:** resolve `accessibleProjectIds` na tool (gate primário), valida escopo com `includes()` ANTES de Promise.all (cortocircuito de services se gate bloqueia). Branches concorrentes: members, sprints, stats carregam em paralelo. Resultado filtra apenas keys solicitadas.
  - **Helper `parseInclude()` inline:** decisão YAGNI — refatorar se Task #8 reutilizar. Valida array, filtra enum ['members', 'sprints', 'stats'], detecta duplicatas via `uniqueItems: true` no schema.
  - **Anti-enumeration uniforme:** NotFoundException com mensagem idêntica em ambos cenários (gate falhar vs projeto fora do scope). Services não são chamados se gate bloqueia (cortocircuito).
  - **activity excluído (adiado):** conforme plano §4.4 — reservado para Task #7 `update_project` (mutable, requer journal)
  - **Registração:** 9º param ao constructor `McpRouterService` (ANTES de `configService`), entrada em `tools.schema.json` com schema array + enum
  - **Testes:** 12 cases em `mcp-tools.get-project.spec.ts` (happy path sem/com include, include multiplo paralelizado, params validation, BigInt parse, tenant isolation cortocircuito, ctx propagation, tools/list) + schema-consistency atualizado → 99/99 PASS MCP total
  - **Técnica reutilizável:** teste de paralelismo via `setImmediate + callOrder` (pode ser reusada em Task #7+ se Promise.all novamente necessário)
  - **Pilares:** Pilar 2 RESPEITADO (reutiliza 3 services — zero controller novo); Pilar 3 RESPEITADO (zero DClasses novas)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-042 (tenant isolation defense-in-depth — gate + cortocircuito)
  - **Quality Score:** 9.0/10 APPROVED (novo recorde) | Build: PASS, ESLint: PASS, Total suite MCP: 99/99 PASS

### Known issues

- **MCP `update_task`: campo `taskType` não exposto** (plano §4.1, ajuste agendado Task #3+)
  - Motivo: Task #2 focou em 6 campos críticos; `taskType` é read-only no modelo V3
  - Status: Débito técnico F11, resolução futura
  - Impacto: BAIXO — não impede operações
  
- **MCP `update_task`: `priority: null` é no-op silencioso** (schema não aceita null para priority)
  - Motivo: Impossível limpar prioridade via MCP (permanece com valor anterior se enviado null)
  - Workaround: Usar `PUT /tasks/:id` direto (endpoint REST) para limpar
  - Status: Débito técnico F11
  - Impacto: MÉDIO — usuários devem conhecer limitação

- **MCP `list_members`: JSDoc do ProjectMembersService.getMembers afirma lançar NotFoundException, mas service retorna `{ members: [] }` silenciosamente** (débito pré-existente do service)
  - Motivo: Assinatura do service foi pré-existente (lê do banco sem validação); tool adiciona gate para compensar
  - Status: Débito pré-existente (Task #5 não introduz), mitigação ativa (gate na tool)
  - Impacto: BAIXO — gate na tool garante NotFoundException se projeto não acessível
  - Resolução: Refatorar ProjectMembersService.getMembers em tarefa futura (F16+)

- **MCP `get_project`: `logger.debug?.()` com optional chaining em `get-project.tool.ts`** (code smell, padronizar)
  - Motivo: Inconsistência com padrão do módulo (outras tools usam `.debug()` sem `?.`)
  - Status: Débito técnico LOW (não bloqueia funcionalidade)
  - Impacto: BAIXO — inconsistência visual/padrão
  - Resolução: Padronizar em Task #7+ ou refactor LOW-priority

- **MCP `get_project`: Comentário sobre duplo `findOne` quando `include=['stats']` poderia ser mais explícito** (clareza de design)
  - Motivo: Defense-in-depth realiza 2 hits em `findOne` (gate + dentro de Promise.all) — trade-off aceitável documentado no code
  - Status: Débito técnico LOW (padrão documentado, queries baratas em PK)
  - Impacto: BAIXO — trade-off explicado via comentário, sem impacto operacional
  - Resolução: Refinar comentário ou extrair em docstring em Task #8+

- **Next:** Task #7 `update_project` (modificar name, description, statusId com activity trail) — reusa padrão helpers privados de update_task

### Security

- **F14 Hardening: Tenant Isolation Defense-in-Depth (ADR-V2-042)** - 2026-05-14
  - **Corrigido vazamento de dados entre workspaces:** ao trocar de organização ativa, recursos permaneciam iguais entre orgs (P0 bug em produção). Implementado helper `TenantScopeService` + decorator `@SkipTenantCheck()` + refactor de services tenant-scoped.
  - **Defesa em profundidade (3 camadas):**
    1. **HTTP Guard (`OrgTenantGuard`):** invocado via `AuthCompositeGuard`, valida JWT.organizationId vs recurso.organizationId (estratégias: JWT_ONLY, PROJECT_ESTAB, PATH_PARAM). Cache LRU projectId→orgId (5min TTL).
    2. **Service Layer (`TenantScopeService`):** helper centralizado com `scopeProjectIdsToOrg()`, `assertProjectInOrg()`, `assertTaskInOrg()`, `assertAgentInOrg()`, `assertWorkspace()`.
    3. **Filtro em Services:** ProjectsService, TasksService, AgentsService recebem `organizationId` ou `accessibleProjectIds` (resolvidos via TenantScopeService).
  - **Política de Erros:** listagem cross-tenant → 200 vazio (sem leak); GET/POST cross-tenant via path → 404 anti-enumeration; JWT órfão em rota tenant-scoped → 403 NO_WORKSPACE.
  - **Arquivos:** 4 criados (TenantScopeService + spec, @SkipTenantCheck, adversarial tests, ADR-V2-042) + 20 modificados (guards, services, controllers, modules, tools, channels, webhooks).
  - **Testes:** 35 novos (21 unit TenantScopeService + 14 adversariais multi-tenant) — 35/35 PASS. Build: PASS, Lint: 0 errors.
  - **Pilares:** Pilar 2 ZERO controllers novos; Pilar 3 ZERO DClasses novas.
  - **ADRs:** **ADR-V2-042 (novo - Tenant Isolation Defense-in-Depth)**, ADR-V2-001, ADR-V2-003, ADR-V2-038, ADR-V2-040.
  - **Quality Score:** 8.2/10 APPROVED | Reviewer m1-m3 issues residuais para próximos PRs.

### Added

- **F4 Pós-F3: Estado órfão (usuário sem workspace ativa) — 5 etapas integradas, score 8.6/10 (ADR-V2-038)** - 2026-05-14
  - **JWT órfão é estado válido:** `organizationId` agora opcional no payload (omitido, não null)
  - **Decorador `@AllowOrphan()`:** marca rotas que aceitam JWT órfão (`/auth/me`, `/auth/logout`, `/auth/switch-org`, `/auth/pending-invites`, `POST /organizations`)
  - **Guard `RequireWorkspaceGuard`:** injetado no `AuthCompositeGuard`, bloqueia rotas tenant-scoped com 403 `{ code: 'NO_WORKSPACE' }`
  - **Novo endpoint:** `GET /auth/pending-invites` — lista convites pendentes pelo email, sem exigir ADMIN, DTO sanitizado (5 campos, zero leak de tokenHash/flow)
  - **AuthService.login/refresh/issueSessionForUser:** emitem JWT órfão quando user não tem DVincula ativa
  - **UserProfileDto.isOrphan:** boolean obrigatório sinalizando estado ao frontend
  - **DEvento -501:** registra `metaDados.orphan: true` para audit trail de login órfão
  - **Fluxo de saída de estado órfão:** 2 caminhos (criar org via `POST /organizations` + `switch-org`, ou aceitar convite via `POST /invites/:token/accept`)
  - **Regressão zero:** users com org ativa, fluxos de login/refresh/token normais continuam idênticos
  - **Tests:** 114/114 PASS, cobertura nova em require-workspace.guard.spec.ts (5 cenários), auth.service.spec.ts (8 órfão), invites.service.spec.ts (8 listagemFunc)
  - **Smoke E2E:** 2 fluxos manuais em workspace/smoke/smoke-orphan-workspace-etapa5.md (A: criar org, B: aceitar convite)
  - **Pilares:** Pilar 2 REUTILIZADO (@AllowOrphan() em controllers existentes); Pilar 3 RESPEITADO (ZERO DClasses novas)
  - **Etapas aprovadas:** 1 (JWT opcional, 8.8/10) | 2 (@AllowOrphan, 8.2/10) | 3 (login órfão, 8.5/10) | 4 (pending-invites, 8.7/10) | 5 (smoke, 8.8/10)

### Added

- **F13 Task #3 Fase 4: Backend Env Management + Deploy Key Automation (ADR-V2-041 + ADR-V2-042)** - 2026-05-13
  - **Env Credentials Management:**
    - `AgentEnvService` com `setEnv()` (githubToken, anthropicApiKey, anthropicAuthToken via outbound `SET_ENV`), `getEnvStatus()` (status booleanos sem plaintext), `setGitBot()` (gitBotName/Email)
    - Backend NUNCA persiste plaintext — apenas status booleanos + lastEnvUpdatedAt em DEntidade -156 `dados.envStatus`
    - RBAC: ADMIN da org dona; validações HMAC outbound (ServiceUnavailableException se falha)
    - Eventos: `agent.env.updated` / `agent.gitbot.updated` emitidos APÓS persistência (Padrão #7)
  - **Deploy Key Automation (pull-only):**
    - `DeployKeyService` com `generateDeployKey()` (dispatcher `GENERATE_DEPLOY_KEY`, recebe pubkey+fingerprint, persiste em DVincula -185 metaDados)
    - Idempotência dupla: agent checa `/etc/scrumban-agent/ssh-keys/<slug>` (reusa), backend sobrescreve (permite regen)
    - `getDeployKey()` (lê metaDados + sshConfigSnippet), `revokeDeployKey()` (soft-delete metaDados)
    - RBAC: MANAGER projeto OU ADMIN org
    - Privada NUNCA sai de VPS (decisão CEO + ADR-V2-042)
    - Eventos: `project.deploy-key.generated` / `project.deploy-key.revoked`
  - **ProjectSlug Auto-Derivation:**
    - `slugifyProjectName()` — NFD normalize, lowercase, `[^a-z0-9]→-`, max 64 chars
    - `PROJECT_SLUG_REGEX = /^[a-z0-9-]{1,64}$/` — defensivo contra path injection
    - Idempotência: preserva slug válido, gera novo se inválido
    - Persiste em DVincula -185 metaDados.projectSlug
  - **Runtime Generalization:**
    - `RemoteExecutionClient.dispatch<TReq,TRes>(cmd, req)` — método público genérico (RUN_CLAUDE_CODE, SET_ENV, GENERATE_DEPLOY_KEY, etc.)
    - `execute()` preservado como wrapper
  - **Controllers (5 endpoints novos):**
    - `PUT /agents/:id/env` — atualizar credenciais (HMAC outbound)
    - `GET /agents/:id/env-status` — status booleanos (sem plaintext)
    - `PUT /agents/:id/git-bot` — atualizar git identity
    - `POST /projects/:id/agent/:agentId/deploy-key` — gerar chave SSH
    - `GET /projects/:id/agent/:agentId/deploy-key` — consultar pubkey+snippet
    - `DELETE /projects/:id/agent/:agentId/deploy-key` — revogar chave
  - **DTOs (5 classes):** SetAgentEnvDto, SetGitBotDto, EnvStatusResponseDto, DeployKeyResponseDto, GenerateDeployKeyDto
  - **Tests:** 32 unit tests novos (agent-env 16 + deploy-key 16) — 100% PASS
  - **Pilares:** Pilar 2 REUTILIZADO (endpoints novos em controllers existentes); Pilar 3 RESPEITADO (ZERO DClasses novas)
  - **ADRs:** ADR-V2-001, ADR-V2-030, ADR-V2-033, ADR-V2-035, ADR-V2-036, **ADR-V2-041 (novo), **ADR-V2-042 (novo)
  - **Quality Score:** 8.3/10 APPROVED (gap MÉDIO fechado pós-revisão: spec criada 16 testes verdes)
  - **Próximo:** Fase 5 Frontend (3 painéis: EnvCredentials, GitBot, LinkedProjects)

### Security

- **F13 Task #1 Backend: Alinhamento HMAC bilateral agent ↔ backend (ADR-V2-040)** - 2026-05-13
  - **Guard reescrito:** `AgentAuthGuard` valida HMAC-SHA256 do body com canonical `method+"\n"+path+"\n"+timestamp+"\n"+nonce+"\n"+sha256(body).hex` idêntico ao que agent assina
  - **Headers canônicos:** Normalização de `x-scrumban-*` em ambas direções (4 lados do contrato agora simétricos)
  - **Integridade:** timingSafeEqual protege contra timing attacks
  - **Path normalização:** Strip `/api/v\d+` para casar com agent que assina path relativo
  - **rawBody preservado:** `express.json({ verify })` em main.ts expõe bytes brutos pré-parse JSON
  - **Defesa em profundidade:** HMAC do body protege contra container malicioso intra-host (docker0 bridge)
  - **Backward-compat:** apiKeyHash em dEntidade.dados preservado como legado

### Added

- **F13 Task #1 Backend: HeartbeatDto ampliado + persistência de métricas agent** - 2026-05-13
  - **5 campos opcionais novos:** cpu, mem, uptime, claudeCodeAvailable, tunnelHealthy
  - **Persistência:** Spread em dEntidade.dados JSON via agents.service.ts (sem schema migration)
  - **Uso futuro:** Flow Metrics (F8) + dashboards saúde agent (F14)

### Added

- **Transversal: Cancelamento de Convites Pendentes (Task #2, Pós-F8)** - 2026-05-13
  - **Endpoint novo:** `DELETE /organizations/:orgId/invites/:inviteId` — ADMIN da org, hard delete + audit DEvento -502
  - **Service:** `InvitesService.cancelInvite(orgId, inviteId, actorUserId)` com validações (403 RBAC, 404 anti-enumeração, 409 ACCEPTED)
  - **Ordem evento:** DEvento `invite.revoked` emitido ANTES do hard delete (Risco #1 mitigado — order invertida vs padrão #7)
  - **Idempotência:** EXPIRED retorna 200 com `previousStatus: 'EXPIRED'` no audit
  - **Rate limit:** 10/min/ip (mais permissivo que create 3/min — operação de "limpeza")
  - **Segurança:** ZERO FK constraints violados (invite nunca referenciado por DVincula vivo), idempotente vs race revoke-vs-accept
  - **Testes adicionados:** 8 service specs + 4 controller specs (32/32 PASS); bônus 4 testes preexistentes destravados
  - **Pilares:** N/A estrutural (Prisma direto), ZERO DClasses novas (-502 reutilizado)
  - **ADRs:** ADR-V2-001 (zero tabela), ADR-V2-003 (RBAC duplo), ADR-V2-008 (DEvento), ADR-V2-028 (invites)
  - **Quality Score:** 8.5/10 APPROVED

### Added (anterior)

- **F13 Task #4 Sub-tarefas 4.3+4.4: endpoints link/unlink/list agente-projeto (multi-project)** (V2 F13 Hotfix) - 2026-05-12
  - **3 endpoints novos com RBAC duplo** (MANAGER projeto OU ADMIN org via `requireProjectManagerOrOrgAdmin`):
    - `POST /agents/:id/projects` — vincula agente a projeto (idempotente com flag `alreadyLinked`)
    - `DELETE /agents/:id/projects/:projectId` — desvincula via soft-delete (`excluido=true`)
    - `GET /agents/:id/projects` — lista projetos vinculados (batch queries ZERO N+1, retorna `[]` para standalone)
  - **5 DTOs novos** em `link-agent-project.dto.ts` com class-validator + Swagger + JSDoc
  - **3 métodos service** (`linkProject`, `unlinkProject`, `listAgentProjects`) + helper RBAC privado
  - **Eventos registrados** em `event-types.ts` + `audit-log.consumer.ts`:
    - `agent.project.linked` / `agent.project.unlinked` (reuso idClasse `-492 AGENT_HEARTBEAT`)
    - Emitidos via `EventProducerService.addInternalEvent()` APÓS persistência (Padrão #7)
  - **14 specs novos** em `agents-projects.spec.ts` (linkProject 6, unlinkProject 4, listAgentProjects 4)
  - **45/45 PASS** em `src/automation/agents` (14 novos + 31 regressão zero); **20/20 PASS** em `src/eventos` (zero regressão)
  - **Pilares:** N/A (estrutural, DVincula -185 existente)
  - **ADRs:** ADR-V2-001 (zero tabela nova), ADR-V2-003 (RBAC duplo), ADR-V2-013 (Agent como DEntidade)
  - **MARCO Task #4 COMPLETO** — 4/4 sub-tarefas (4.2 absorvida pela 4.1); 1 agente por VPS agora cuida de N projetos
  - **Score rodada 2:** 8.5/10 APPROVED (rodada 1 foi 7.0 NEEDS_CHANGES — eventos faltando; hotfix aplicado)

### Fixed

- **F13 Task #4 Sub-tarefa 4.1: torna projectId opcional no install-token (multi-project agent)** (V2 F13 Hotfix) - 2026-05-12
  - **Problema:** `POST /agents/install-token` exigia `projectId` obrigatório, impedindo instalar 1 agente para N projetos (CEO opera >10 projetos por VPS, precisava de 10 agentes — absurdo operacionalmente)
  - **Solução:** DTO `GenerateInstallTokenDto` agora marca `projectId` como `@IsOptional()`. Service `createInstallToken(projectId?: bigint)` aceita `null`, persiste em DTabela -473. `install()` condicional: standalone cria `DEntidade -156` com `idLocEscritu=createdBy` (dono inicial), **NÃO cria DVincula -185** (link vem depois via POST `/agents/:id/projects` em sub-tarefa 4.3)
  - **Backward-compat:** 100% preservada — install COM projectId mantém DVincula automática
  - **Tests:** 4 specs novos (createInstallToken COM/SEM projectId, consumeInstallToken standalone, install standalone) + regressão 60/60 anterior PASS
  - **Pilares:** N/A (estrutural, Prisma direto para DVincula)
  - **ADRs:** ADR-V2-001, ADR-V2-013
  - **Score:** 8.2/10 APPROVED
  - **Issue:** MEDIUM (RBAC standalone ausente — mitigação em 4.3 quando endpoint de link aplicar RBAC)

### Documentation

- **F13 Task #1 Sub-tarefa 7: Documentação Final + ADRs Canônicos** (V2 F13 Cliente) - 2026-05-12
  - **ADR-V2-035:** Identidade de projeto via `projectSlug` + `CLAUDE.md` global (defesa contra path injection backend). Status: Aceito. Renumerado de 030 → 035 por colisão com ADRs prévios. Referência implementação: `agent/src/claude-code/identity-resolver.ts`.
  - **ADR-V2-036:** Localização monorepo `Scrumban-Backend-V2/agent/`. Status: Aceito. Renumerado de 031 → 036. Justifica versionamento atômico backend ↔ agente (mudanças de protocolo HTTP+HMAC deploy junto em PR único). Alternativa B (fork legado) rejeitada.
  - **ADR-V2-037:** Ponteiro de sessão Claude Code (`claudeSessionId` persistido em `DPedido.dados`). Status: Aceito. Renumerado de 032 → 037. Formaliza "porta aberta" para chat-with-VPS futuro (permitirá `LIST_CLAUDE_SESSIONS`, `READ_CLAUDE_SESSION`, `STREAM_CLAUDE_SESSION` sem quebrar contrato HTTP+HMAC). Implementação: endpoint `/v1/execute` com `type` discriminator; `type: 'RUN_CLAUDE_CODE'` retorna `claudeSessionId` que backend grava em DPedido -300.
  - **`docs/automation-agent-install-runbook.md`:** Reescrito de pseudo-código legado para runbook real. 6 passos: gerar token → install.sh → validar serviço → CLAUDE.md → ANTHROPIC_API_KEY → smoke test. 14 fases do install detalhadas (root check, pre-flight CLI, user/dirs perms, ssh-keygen, keyscan TOFU, handshake POST, config 0600, env file, systemd enable, heartbeat poll, CLAUDE.md template, troubleshooting 60s test, final checks). Troubleshooting expandido: clock skew, túnel down, missing API key, projeto desconhecido, allowlist violation, systemd logs, ANTHROPIC_API_KEY verification. Seção de segurança: Ed25519 key constraints, TOFU fingerprint visível, 0600 permissions obsessão. Débitos explícitos: MCP keys futuros, rate limit tuning, session streaming.
  - **`CLAUDE.md` raiz (V2):** Seção nova "SUBPROJETO `agent/` (F13 — cliente VPS)" com tabela de paths (`agent/` monorepo, `agent/src/`, `agent/__tests__/`, systemd paths), comandos de build (`npm install`, `npm run build`, `npm run test`), lista de ADRs vinculados (V2-035/036/037/033/031/030), próximos passos operacionais (bundle agent → scp VPS → install.sh com token).
  - **`agent/src/index.ts`:** Comentários scaffolding atualizados. Removida lista "Sub-tarefas pendentes" (scaffolding Sub-tarefa 1). Substituída por descrição estrutural dos 4 componentes (HTTP server, outbound client, HMAC validation, handlers). Stage label mudado de `sub-tarefa-5-autossh` → `task1-complete`.
  - **`agent/README.md`:** Finalizado com tabela de sub-tarefas completas (7 linhas, commits + scores + specs). Layout refatorado: seção "Visão geral" com arquitetura + fluxo, "Como rodar localmente" (npm scripts), "Limitações conhecidas (will not have)" com 7 débitos explícitos (MCP keys, rate limit tuning, session read/streaming, symmetric crypto key rotation, multi-project parallel, SSH key constraints, systemd hardening extras). Seção "Referências" com links para ADRs (V2-035/036/037), planos de agente, memória de agentes.
  - **Score:** 8.8/10 APPROVED rodada 1 (documentação canônica, ADRs formalizados, runbook executável)

### Added

- **F13 Task #1 Sub-tarefa 6: install.sh + systemd + CLAUDE.md template** (V2 F13 Cliente) - 2026-05-12
  - **install.sh (14 fases):** Root check, pre-flight CLI 2.1.139+, user/dirs com perms 0700/0600 rigorosas, ssh-keygen Ed25519 + ssh-keyscan TOFU visível, handshake POST install-token, config.json 0600 persisted, EnvironmentFile /etc/scrumban-agent/environment 0600 com placeholder ANTHROPIC_API_KEY, systemd start via `systemctl enable --now scrumban-agent`, heartbeat poll 60s verificação daemon status
  - **uninstall.sh:** Idempotente, preserva config.json (força delete com `--force`), remove systemd unit + user + directories
  - **systemd/scrumban-agent.service:** Hardenizado com `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=read-only`, `EnvironmentFile=/etc/scrumban-agent/environment`, `MemoryMax=512M`, restart auto com backoff
  - **CLAUDE-md-template.md:** Template para `/root/.claude/CLAUDE.md` (não auto-populado por segurança — risco prompt injection; operador fornece manualmente)
  - **README troubleshooting:** Seções ANTHROPIC_API_KEY env, systemd logs, common errors, backoff behavior
  - **shellcheck PASS:** install.sh (lint estático), uninstall.sh validados
  - **Idempotência comprovada:** User/dirs criados só se não existem, EnvironmentFile preservado, CLAUDE.md skipped se já existe, systemd daemon-reload sempre
  - **Issues resolvidos (rodada 2):** M1 (.claude/ raiz — movido), M2 (ANTHROPIC_API_KEY em env file), M3 (ssh-keyscan TOFU visível no log)
  - **Score:** 8.8/10 APPROVED rodada 2

### Fixed

- **F4 Task 01: Corrigir persistência de `priority` em DTask** (V2 F4) - 2026-05-12
  - **Service:** `TasksService` agora persiste `idPriority` em `create()` e `update()` via helper `resolvePriorityId()`
    - Helper resolve DTabela PRIORITY escopada por projeto (padrão paralelo a Status)
    - Batch lookup `buildPriorityMap()` para ZERO N+1 queries em responses
    - Semântica clara para `update()`: `undefined` (não toca), `null` (limpa), string (lookup)
  - **Seed:** `SeedBootstrapService` nova subtarefa `seedPrioritiesIfMissing()` — cria 4 DTabelas PRIORITY por projeto (idClasse -421..-424)
    - Idempotente: lookup por `(idClasse, dEntidadeId)` antes criar
    - Reutilizável em backfill script para projetos legados
  - **Backfill:** Novo script `prisma/scripts/backfill-priority-tabelas.ts` idempotente — para projetos criados antes desta feature
    - Batch lookup eficiente (1 query por projeto)
    - Output relatório: projetos visitados, priorities criadas
  - **DTOs:** Enum corrigido `CRITICAL` → `URGENT` (alinhado com seed canônico -424); `update-task.dto.spec.ts` novo com 8 testes ValidationPipe
  - **Tests:** 85/85 PASS (77 tasks + 8 DTO spec)
  - **ADR-V2-034:** Formaliza padrão Priority como DTabela escopada por projeto (espelhando Status, ADR-V2-009)
  - **Score:** 8.0/10 APPROVED

### Added

- **F13 Task #1 Sub-tarefa 5: Autossh Wrapper + Graceful Shutdown** (V2 F13 Cliente) - 2026-05-12
  - **Autossh Wrapper Modular:** `agent/src/tunnel/autossh.wrapper.ts`
    - `createAutosshWrapper(config, logger, options): AutosshHandle` — factory pattern
    - Circuit breaker: 5 crashes/60s → pausa 5min (evita flap loop ex: chave SSH inválida → 100ms crash → 100 restarts/min)
    - Backoff exponencial: 1s → 2s → 4s → ... → 60s (cap max, cálculo base 2^step)
    - Uptime reset: após 60s rodando estável, reseta contador de crashes e step (detecção de "run saudável")
    - `isHealthy()` exposto: state === 'running' (Sub-tarefa 3 placeholder now real)
    - Arguments SSH canonizados: `-M 0 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -i <chave> -p <porta> -R <bindHost>:<tunnelPort>:127.0.0.1:<tunnelPort> agent@backend`
    - Tunáveis: `initialBackoffMs`, `maxBackoffMs`, `crashWindowMs`, `crashThreshold`, `circuitOpenMs`, `uptimeResetMs`, `stopGraceMs`, `spawnImpl`, `setTimeoutImpl`, `now` (testes)
    - Override para testes: `spawnImpl` mock, fake timers, função "agora" fixa
  - **Graceful Shutdown Coordinator:** `agent/src/lifecycle/shutdown.ts`
    - `gracefulShutdown(ctx, signal)` — ordem defensiva:
      1. `heartbeat.stop()` (para batidas, evita log enganoso)
      2. `server.stop()` (drena requests in-flight, timeout 30s antes closeAllConnections)
      3. `autossh.stop()` (só depois servidor fechar, garante requests inbound via tunnel completem)
      4. `process.exit(0)` (sucesso) ou `exit(1)` (erro em algum step)
    - `installSignalHandlers([SIGTERM, SIGINT])` — helpers para registrar handlers
    - Idempotente: dedupe via flag `triggered` (SIGTERM + SIGINT quase-simultâneos = execução única)
    - Não lança: captura erros por step, loga cada um, continua sequência
  - **Lifecycle Integration:** `agent/src/index.ts` reordenado
    - startHeartbeatLoop → startHttpServer → startAutossh → installSignalHandlers → process (listen indefinido até signal)
  - **Heartbeat Loop Atualizado:** `agent/src/lifecycle/heartbeat-loop.ts`
    - Injeção opcional `tunnelHealthCheck`: para Sub-tarefa 5 conectar `tunnel.isHealthy()` ao payload (antes retornava `true` sempre)
  - **Tests Novos:** `agent/__tests__/autossh.spec.ts` (11 specs: spawn success, crash+backoff, circuit breaker 5/60s→5min pausa, reset após uptime, stop SIGTERM→SIGKILL grace, isHealthy, status); `agent/__tests__/shutdown.spec.ts` (6 specs: ordem heartbeat→server→tunnel→exit, error capture, idempotência SIGTERM+SIGINT, exit codes 0/1)
  - **Build:** tsc clean, 84/84 specs PASS (67 anterior + 17 novos)
  - **Pilares:** N/A (cliente)
  - **ADRs:** ADR-V2-031 (agent monorepo), ADR-V2-035 (logs sensíveis — futura, remover agentSshKeyPath)
  - **Score:** 9.0/10 APPROVED rodada 1
  - **Issues:** MEDIUM (m4 — config.agentSshKeyPath logado em spawnAutossh ln 312, remover em V2-035)

- **F13 Task #1 Sub-tarefa 4: Handler RUN_CLAUDE_CODE + Session Extraction** (V2 F13 Cliente) - 2026-05-12
  - **Identity Resolver:** `src/claude-code/identity-resolver.ts` lê `projectSlug` via seção H2 em `~/.claude/CLAUDE.md` global (defesa contra path injection backend); suporta labels `- Caminho:` ou `- Path:`; case-sensitive slug; erros `CLAUDE_MD_NOT_FOUND`/`UNKNOWN_PROJECT_SLUG`/`INVALID_CLAUDE_MD_ENTRY`
  - **Allowlist Validator:** `src/claude-code/allowlist.ts` canonicaliza path com `realpathSync` ANTES do prefix check (defesa anti-symlink); boundary `/` evita burla `evil-projetos` vs `evil-projetos-real`; valida contra `config.allowedProjectRoots`
  - **Runner:** `src/claude-code/runner.ts` usa `execFile` (sem shell) com args como array, timeout configurável, `windowsHide: true`; retorna `{ exitCode, timedOut, stdout, stderr, error }`
  - **Session Parser:** `src/claude-code/session-parser.ts` extrai `session_id` (snake_case — **CRÍTICO: não é `uuid`**) do JSON output Claude Code; valida UUID via regex; fallback `findNewSessionIdFromFilesystem` se JSON corrompido (busca arquivo `.claude/projects/<encoded-cwd>/session_<id>.jsonl`)
  - **Handler:** `src/handlers/run-claude-code.handler.ts` orquestra: mutex por projectSlug (307 linhas, try/finally), identity resolver, allowlist, runner, session parser; ACK síncrono `200 {accepted, executionId}` + resultado async via `backendClient.sendExecutionResult()`; mapeamento HTTP: 200 ok, 400 bad payload, 403 WORKSPACE_OUTSIDE_ALLOWED_ROOT, 409 PROJECT_BUSY (mutex), 422 UNKNOWN_PROJECT_SLUG, 500 CLAUDE_MD_NOT_FOUND
  - **Tests:** `__tests__/identity-resolver.spec.ts` 10 specs (extração com múltiplos labels, case-sensitivity, slug inexistente, CRLF, I/O erros); `__tests__/run-claude-code.spec.ts` 19 specs (14 cenários integração RUN_CLAUDE_CODE + 5 payload validation, incluindo traversal+symlink)
  - **Build:** tsc clean, 67/67 specs PASS (incluindo regressão 38/38 anterior)
  - **Pilares:** N/A (cliente)
  - **ADRs:** ADR-V2-030 (slug via CLAUDE.md), ADR-V2-032 (porta claudeSessionId, discriminator), ADR-V2-033 (HTTP+HMAC contrato)
  - **Score:** 9.0/10 APPROVED rodada 1
  - **Issues:** MEDIUM (m1 — is_error:true não entra success, título teste enganoso); MINOR (m2 — usage não tipado; m3 — comentário Sub-tarefa 4 é scaffolding)
  - **CLI versão pinada:** 2.1.139 (spike confirmou session_id snake_case; a documentar install.sh Sub-tarefa 6)

- **F13 Task #1 Sub-tarefa 3: Outbound Client + Heartbeat Loop** (V2 F13 Cliente) - 2026-05-12
  - **Outbound HMAC Signer:** `src/outbound/hmac-sign.ts` assina requests com SHA256 byte-a-byte idêntico ao backend
    - Algoritmo canonical: `METHOD\npath\ntimestamp\nnonce\nsha256(body)`
    - Headers padronizados: `x-scrumban-agent-id`, `x-scrumban-timestamp`, `x-scrumban-nonce`, `x-scrumban-signature`
    - Index signature para compatibilidade `fetch()` HeadersInit
  - **Backend Client:** `src/outbound/backend-client.ts` com transporte robusto
    - `sendHeartbeat()` → POST /agents/:id/heartbeat (payload: cpu, mem, uptime, claudeCodeAvailable, tunnelHealthy, agentVersion, claudeVersion)
    - `sendExecutionResult()` → stub POST /agents/:id/execution-result (shape final ADR-V2-032)
    - Backoff exponencial: 4xx sem retry (erro permanent), 5xx/rede retry 1-2-4-8-16-32s (cap 60s)
    - Máximo 5 tentativas, re-assina por retry (replay protection), timeout 10s AbortController
    - `BackendClientError` com `.status`, `.retryable`, `.attempts`
  - **Heartbeat Loop:** `src/lifecycle/heartbeat-loop.ts` 30s interval
    - Coleta CPU (loadavg/cpuCount), MEM (freemem/totalmem), uptime (process.uptime)
    - Detecta Claude Code via `claude --version` com cache 5min (async, não bloqueia event loop)
    - Circuit metric: loga `circuit_open: true` após 5 falhas (continua tentando — alertar, não breaker)
    - Recuperação limpa após sucesso pós-falhas
    - Nunca crasha (catch-and-log), SIGTERM ordering `heartbeat.stop()` antes `server.stop()`
    - Interface `HeartbeatHandle` com `stop()` e `triggerNow()` para testes
  - **Bootstrap Atualizado:** `src/index.ts` startHeartbeatLoop + graceful shutdown ordering
  - **Tests:** 12 specs PASS (signOutboundRequest, HMAC round-trip middleware real, backoff 4xx/5xx, retry exhaustion, re-sign, payloads, fetchImpl injection)
  - **Pilares:** N/A (cliente)
  - **ADRs:** ADR-V2-031, ADR-V2-033, ADR-V2-008
  - **Score:** 8.8/10 APPROVED rodada 1
  - **Issues identificados:** MEDIUM — heartbeat-loop.ts sem specs dedicadas (risco regressão); MINOR — agentVersion hardcoded, claudeVersion parse básico, backoff sem jitter

- **F13 Task #1 Sub-tarefa 2: HTTP Server Local + HMAC Middleware + Dispatcher /v1/execute** (V2 F13 Cliente) - 2026-05-12
  - **Servidor:** Express bind 127.0.0.1:tunnelPort (loopback only, defesa contra exposição direta)
  - **HMAC-SHA256:** Algoritmo byte-a-byte idêntico a `remote-execution-client.ts` (backend)
    - Validações: agentId, timestamp skew ±5min, nonce anti-replay, constant-time compare
  - **Nonce Store:** LRU in-memory 10_000 entries, TTL 10min (alinhado com timestamp skew)
    - `ttlAutopurge` automático via `lru-cache`
  - **Rate Limit:** express-rate-limit 60 req/min por agentId (defesa em profundidade)
    - Posicionado APÓS HMAC no pipeline (invalidas não consomem bucket)
  - **Dispatcher /v1/execute:** Type discriminator
    - PING: `{accepted: true, message: 'pong'}` — sanity check E2E
    - RUN_CLAUDE_CODE: 501 NotImplemented stub (handler real Sub-tarefa 4)
    - UNKNOWN_COMMAND_TYPE/MISSING_TYPE: 400 com lista tipos suportados
  - **GET /ping:** Autenticado com HMAC, retorna metadata (agentId, version, uptimeSec)
  - **Error Handlers:** Payloads >1MB (413), JSON malformado (400), 404 padronizado
  - **Graceful Shutdown:** 30s dreno + fallback `closeAllConnections` (Node 18+)
  - **Tests:** 15 specs PASS (13 obrigatórios + 2 lifecycle bonus)
  - **Dependencies:** express, lru-cache, express-rate-limit
  - **Score:** 9.2/10 APPROVED rodada 1 (5 gates segurança validados)
  - **Pilares:** N/A (cliente)
  - **ADRs:** ADR-V2-031, ADR-V2-033

- **F13 Task #1 Sub-tarefa 1: Scaffolding Monorepo + Config Loader com Validação 0600** (V2 F13 Cliente) - 2026-05-12
  - **Novo subprojeto:** `agent/` (TypeScript 5.4 strict, Node 20+)
  - **Stack:** express, pino (redaction defensiva), zod (validação schema)
  - **Config loader:** 4 validações (arquivo existe, modo **0600 obrigatório**, JSON válido, zod schema)
  - **Redaction:** 9 paths sensíveis (agentCommandSecret, agentApiKey, installToken, signature, password + nested)
  - **Bootstrap:** Carrega config, inicia logger, loga banner — placeholder para Sub-tarefas 2-5 (HTTP server, heartbeat, handlers, autossh, lifecycle)
  - **JSDoc:** 100% em schema, loader, logger, index (4 export points)
  - **Tests:** 11/11 PASS (config loader scenarios: válido, defaults, modo 0644 rejeitado, modo 0640 rejeitado, JSON malformado, campos faltando, URL inválida, allowlist vazio, path inexistente, env override)
  - **Build:** `npm run build` PASS, `npm run typecheck` PASS, `npm run lint` PASS, smoke `node dist/index.js` PASS
  - **ADRs:** **ADR-V2-031 (novo — monorepo agent cliente VPS)**
  - **Pilares:** N/A (cliente standalone)
  - **Score:** 9.0/10 APPROVED rodada 1

### Removed

- **F13 Sub-tarefa 2.5: Remove claudeSessionId residual de AutomationData** (V2 F13 Backend-Side Prep — Conclusão) - 2026-05-12
  - **Campo:** `AutomationData.claudeSessionId?: string` removido de `src/tasks/schemas/task-dados.schema.ts`
  - **Razão:** Resíduo morto — zero consumidores (grep confirma); canônico é `DPedido.dados.claude.sessionId` via Engine `OperacaoExecucaoClaude` (Pilar 1)
  - **JSDoc:** Interface `AutomationData` atualizada com nota canônica explícita referenciando `DPedido.dados.claude.sessionId` e responsabilidade Engine
  - **Impacto:** Elimina ambiguidade (qual é a fonte verdadeira? — agora inambíguo)
  - **Testes:** 70/70 tasks.service PASS; 11/11 execution-result PASS — zero regressão
  - **Build:** `make build` PASS (zero erros novos)
  - **Referência:** ADR-V2-033 decisão (c) — Remoção de `claudeSessionId` de DTask

### Changed

- **F13 Sub-tarefa 2.5: Consolidação ADR-V2-033 com 5 decisões técnicas (a-e)** (V2 F13 Backend-Side Prep — Conclusão) - 2026-05-12
  - **Status:** ADR-V2-033 finalizado → Status: Aceito (todas 5 decisões consolidadas com referências a commits)
  - **Decisão (a) Síncrono vs NDJSON:** A2 síncrono — RemoteExecutionClient `execute()` retorna ACK rápido, resultado via callback (Sub-tarefa 2.2 `21323ab`)
  - **Decisão (b) Origem projectSlug:** B1 derivação automática — `ProjectsService.create()` gera slug único de `nome`, no `DProject.dados.slug` (Sub-tarefa 2.3 `769f617`)
  - **Decisão (c) claudeSessionId de DTask:** Removido — Pilar 1 preciso (Sub-tarefa 2.5 este commit)
  - **Decisão (d) Validação CLI Claude:** D3 spike operacional — CEO/orchestrator em paralelo (não bloqueia backend V2)
  - **Decisão (e) DClasses sessão:** -505/-506 reservadas em seed, materializadas em callback `execution-result` (Sub-tarefa 2.1 `d7fbc63`)
  - **Consequências:** Destrava Task #1 Sub-tarefa 4 (RUN_CLAUDE_CODE handler agente V2 client-side)
  - **Referências:** Cruzadas com ADR-V2-001/-005/-006/-008/-013/-030/-032; histórico em commits da cadeia 2.1-2.5

### Added

- **F13 Sub-tarefa 2.4: Endpoint execution-result inbound + Engine OperacaoExecucaoClaude.registrarOutcome** (V2 F13 Backend-Side Prep) - 2026-05-12
  - **Endpoint:** `POST /agents/:id/execution-result` (callback inbound agente → backend) com HMAC + AgentAuthGuard
  - **DTO:** `ExecutionResultDto` (11 campos: executionId, exitCode, success, durationMs, claudeSessionId, claudeSessionPath INTERNAL, resumedFrom, stdout/stderr, errorCode)
  - **Engine:** `OperacaoExecucaoClaude.registrarOutcome()` encapsula UPDATE em DPedido via Engine (Pilar 1 INVIOLADO — zero Prisma direto no service)
  - **Segurança:** Isolation dupla (agentId path + DPedido.dados.audit.agentId), idempotência via sentinel `outcome.recordedAt`, ZERO vazamento `claudeSessionPath` em DTOs response
  - **Eventos:** 4 tipos canônicos — `agent.execution.finished|failed` (sempre), `agent.session.created|resumed` (se claudeSessionId presente); materializa DEvento -496/-505/-506
  - **Testes:** 11 cenários PASS (payload válido, validações classe/agente, idempotência, session lifecycle, error codes)
  - **Pilares:** P1 INVIOLADO (Engine encapsula), P2 OK (endpoint específico justificado), P3 RESPEITADO (zero tabela nova)
  - **ADRs:** ADR-V2-001/-005/-006/-008/-013/-030/-032/-033
  - **Regressão:** 24 suites / 170 testes automation+engine+eventos PASS
  - **Review:** APPROVED 8.8/10

- **F13 Sub-tarefa 2.3: ProjectsService slug derivation + migration índice expression** (V2 F13 Backend-Side Prep) - 2026-05-12
  - **Utility:** `slugify(nome)` — lowercase + NFD strip diacríticos + hífens + max 50 chars; `fallbackSlug()` para nomes vazios
  - **Service:** `ProjectsService.create()` deriva slug único (sufixo `-N` resolve colisões); `onModuleInit()` backfill idempotente para projetos legados
  - **Migration:** Índice expression único em `LOWER(dados->>'slug')` com filtro `WHERE excluido = false` (soft-delete-friendly)
  - **Testes:** 46 PASS (19 slugify + 27 service)
  - **Pilares:** P1 N/A (estrutural), P2 N/A (zero controller), P3 N/A (zero DClasse)
  - **ADRs:** ADR-V2-001 (zero tabela), ADR-V2-030 (projectSlug identidade técnica), ADR-V2-033 (RemoteExecutionClient precisa slug)
  - **Débito menor:** slug não exposto em ProjectResponseDto; race condition P2002 sem retry; backfill sequencial se >10k projetos
  - **Review:** APPROVED 8.8/10

- **F13 Sub-tarefa 2.2: RemoteExecutionClient refactor + payload V2 + stubs deprecated** (V2 F13 Backend-Side Prep) - 2026-05-12
  - **Payload V2:** `{type:'RUN_CLAUDE_CODE', executionId, projectSlug, idClasseRisk, prompt, resumeSessionId, timeoutSec, metadata}`
  - **ACK síncrono:** `execute()` retorna `{accepted:true, executionId}` rápido; resultado via callback `POST /agents/:id/execution-result`
  - **Removido:** NDJSON streaming, shell-genéricos (workspace, command.executable/args), `OutputAccumulator`
  - **Stubs:** `ExecutionWorktreeService` + `RollbackService` convertidos em stubs deprecated (V2 decisão: isolation no Claude Code)
  - **Processor:** `ExecutionRunProcessor` refatorado — novo `dispatchRunClaudeCode()`, validação `VALID_RISK_CLASSES = {-301,-302,-303}`
  - **Testes:** 22 PASS (10 client + 4 processor + 6 worktree + 2 rollback)
  - **Rodadas:** Rodada 1 (6.5/10 NEEDS_CHANGES — specs desatualizado) → Rodada 2 (8.5/10 APPROVED — M1+M2 corrigidos, m1 aplicado)
  - **Pilares:** P1 validação VALID_RISK_CLASSES, P2 callback endpoint (Sub-tarefa 2.4), P3 DClasses canônicas
  - **ADRs:** ADR-V2-005/-006/-030/-032/-033

- **F8 Task #01: Multi-Tenant Identity + Workspace Switch (ADR-V2-030)** (V2 F8 transversal Auth/Invites) - 2026-05-12
  - **Backend Auth:** `POST /auth/switch-org` novo; `JwtStrategy.validate` agora `async` valida DVincula ativo a cada request (revogação imediata)
  - **Backend Invites:** Merge flow — email já-user convidado outra org cria APENAS DVincula (sem DUserGroup/DEntidade); `getInviteByToken` retorna `flow: 'new_user' | 'existing_user'`
  - **Auth Response:** `availableOrgs[]` em `/auth/me`, `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/switch-org`
  - **Auth Service:** `issueSessionForUser(userGroupId, preferredOrgId?)` — merge flow entra direto na org mergeada
  - **DTOs:** `SwitchOrgDto`, `AvailableOrgDto`, `InviteInfoDto.flow`, `AcceptInviteDto` com `name`/`password` opcionais
  - **Frontend Types:** `AvailableOrg { id, nome, role }`, `User.availableOrgs: AvailableOrg[]`
  - **Frontend Components:** `WorkspaceSwitcher` novo — dropdown na sidebar com switch via `queryClient.clear()` + `router.refresh()`
  - **Frontend Auth:** Auto-switch para `localStorage['scrumban-last-org']` no login; `MergeAcceptForm` para merge flow (existing_user)
  - **UX:** localStorage "última org lembrada" (Notion/Slack pattern); switch sem logout; membership revogada = próximo request 401
  - **Atomicidade:** `$transaction` em `acceptInvite` merge com race-check (DVincula não duplicada)
  - **Segurança:** Tokens pré-multi-tenant (sem `organizationId`) → 401; refresh rotation on switch (1 sessão/user); membership validada a cada request
  - **Pilares:** P1 N/A (estrutural); P2 respeitado (zero novo controller — POST /auth/switch-org em AuthController existente); P3 respeitado (ZERO DClasse nova)
  - **ADRs:** ADR-V2-001, ADR-V2-003 (RBAC via DVincula estendido), ADR-V2-028 (Invites estendido com merge), **ADR-V2-030 (novo)**
  - **Testes:** 16 novos (auth.service: getMe múltiplas orgs + switchOrg happy/forbidden; jwt.strategy: membership ativo/revogado; invites: merge + race + pre-resolve) — 609 total PASS
  - **Performance:** `getMe.availableOrgs` 1 query JOIN (~1-2ms); `switchOrg` 3 queries (~4-5ms); `JwtStrategy.validate` 1 query indexada (~1-2ms)
  - **Review:** APPROVED 8.5/10

- **F5 Task #19: Project ↔ Team via DVincula -182** (V2 F5 extensão pós-F5) - 2026-05-12
  - **Seed:** DClasse -182 PROJECT_TEAM_LINK (idPai=-37 ENTIDADES) — total 138 classes
  - **DTOs:** `ListProjectsQueryDto` com `teamId` filter; `CreateProjectDto.teamId`; `UpdateProjectDto.teamId` com `@ValidateIf`; `ProjectResponseDto.teamId` top-level
  - **Backend:** `validateTeamForLink` cross-org + LEAD/ADMIN; batch paralelo N+1 ZERO; cursor+teamId bug corrigido em `findMany`
  - **Eventos:** `project.team.linked` / `project.team.unlinked` → DEvento -499 PROJECT_LIFECYCLE (emitidos APÓS commit)
  - **Cascade:** Soft-delete de -182 ao deletar time (pós-review fix Bug #2)
  - **Frontend:** `projectsApi.list/create/update` honram `teamId`; modais usam `teamId` canônico
  - **Pilares:** P1 N/A (estrutural); P2 reusado (GET /projects?teamId=X); P3 respeitado (ZERO tabela nova — ADR-V2-001)
  - **ADRs:** ADR-V2-029 (Project ↔ Team via DVincula -182)
  - **Testes:** 27/27 PASS (include 2 regressão dos bugs corrigidos: cursor+teamId loss, cascade -182)
  - **Review:** APPROVED 8.0/10

- **F13 Sub-tarefa 2.1: Seed DClasses Agent Session Lifecycle + ADR-V2-033 Esqueleto** (V2 F13 Backend-Side Prep) - 2026-05-12
  - **Seed:** 2 DClasses negativas `-505 AGENT_SESSION_CREATED` e `-506 AGENT_SESSION_RESUMED` (idPai=-3 EVENTOS)
  - **Range:** -490..-509 (eventos agent) respeitado; sem conflito com chaves existentes
  - **Total:** 45 fixas + 95 específicas = 140 DClasses (Pilar 3 ativado)
  - **Validação:** `validateHierarchy()` dry-run PASS; sem tabela nova (ADR-V2-001)
  - **ADR:** `docs/decisions/ADR-V2-033-contrato-execute-outbound-e-execution-result-inbound.md` esqueleto criado com decisão (e) preenchida; (a-d) TODO
  - **Pilares:** P3 respeitado (ZERO DClasse sequestrada); P1/P2 N/A (apenas seed)
  - **ADRs:** ADR-V2-001, ADR-V2-008, ADR-V2-013, ADR-V2-032, **ADR-V2-033**
  - **Review:** APPROVED 9.0/10
  - **Issue M1 Corrigido:** JSDoc seed linha 249 atualizado (92/137 → 95/140 DClasses)

- **F13 Sub-tarefa 2.2: Refactor RemoteExecutionClient — Payload V2 + Stubs Deprecated** (V2 F13 Backend-Side Prep) - 2026-05-12
  - **RemoteExecutionClient:** Reescrito com payload V2 (`type:'RUN_CLAUDE_CODE'`, `projectSlug`, `idClasseRisk`, `prompt`, `resumeSessionId`, `timeoutSec`)
  - **ACK Síncrono:** `execute()` retorna apenas `{accepted:true}` via fetch síncrono; streaming NDJSON removido (decisão A2 — resultado via callback)
  - **Remoções:** campos shell-genéricos (`workspace`, `command.executable/args/cwd/env`), `consumeStream()`, `OutputAccumulator`
  - **HMAC:** Headers HMAC-SHA256 preservados (algoritmo idêntico, corpo V2)
  - **Stubs Deprecated:** `ExecutionWorktreeService` e `RollbackService` convertidos em stubs (worktree/rollback responsabilidade do Claude Code, não agente V2)
  - **ExecutionRunProcessor:** Refatorado com `dispatchRunClaudeCode()`; construtor 8→5 deps; validação estrita VALID_RISK_CLASSES
  - **Pilares:** P1 validação Risk (-301/-302/-303); P2 respeitado (sem novo controller); P3 DClasses canônicas
  - **ADRs:** ADR-V2-005, ADR-V2-006, ADR-V2-030, ADR-V2-032, **ADR-V2-033**
  - **Testes:** 22 specs PASS (10 client + 4 processor + 6 worktree + 2 rollback); Build PASS; Zero N+1 queries
  - **Issues Corrigidas:** Rodada 1 (M1 spec files); Rodada 2 (M2 fallback removido; m1 VALID_RISK_CLASSES constantes)
  - **Review:** APPROVED 8.5/10 (rodada 2; rodada 1 foi 6.5/10)

- **Modal Criar Task com Tipo + Responsável + Canal + Criador** (V2 F5 extensão) - 2026-05-11
  - **Backend (tasks):** `CreateTaskDto` + `UpdateTaskDto` com campo `taskType?: string` (enum FEATURE|BUG|IMPROVEMENT|REVIEW|EXPLAIN)
  - **Schema:** `TaskDados` estendida com `taskType?: string` (persistido em Json — ADR-V2-001)
  - **Service:** `create()` injeta `taskType` após `buildInitialTaskDados()`; `update()` faz merge superficial preservando `identifier`/`v3`/`capture`
  - **Response:** `TaskResponseDto` expõe `taskType: string | null` no top-level (projeção de `dados.taskType`)
  - **Frontend (intentions):** `CreateIntentionDto` estendido com `assigneeId?` e `canal?` (4 opções: web/telegram/api/mcp)
  - **Modal:** 3 Popover novos (Responsável via `useOrgMembers`, Canal com radio buttons, Criador read-only)
  - **API:** `intentionsApi.create()` mapeia `taskTypeId` → `taskType` (enum uppercase), envia `assigneeId` e `source` (= `canal`)
  - **Adapter:** `task-to-intention.ts` prioriza `raw.taskType` top-level antes de fallback
  - **Tests:** 3 unit tests V2 (create-com, create-sem backward-compat, update-merge preserva identifier)
  - **Pilares:** P1 N/A (estrutural); P2 reutilizado (sem novo controller); P3 respeitado (ZERO DClasse nova)
  - **ADRs:** ADR-V2-001, ADR-V2-009
  - **Review:** APPROVED 8.5/10

- **Transversal: Convite de Membros por Email com Auto-Login** (V2 pós-F8 autorizado CEO) - 2026-05-11
  - **InvitesModule:** 3 endpoints (POST /organizations/:orgId/invites, GET /invites/:token, POST /invites/:token/accept)
  - **Token Seguro:** DTabela idClasse=-476 com hash SHA-256 em metaDados (raw token só no email)
  - **Rate Limit:** 3/min no POST create via Throttler
  - **Anti-Enumeração:** 404 idêntico para token invalido/expirado/usado (previne vaza de emails)
  - **Atomicidade:** $transaction em accept cria DUserGroup + DEntidade + DVincula + audit
  - **Auto-Login:** Accept retorna JWT + refresh + redirectTo='/intentions' (UX frictionless)
  - **Auditoria:** DEvento -502 INVITE_LIFECYCLE rastreia sent/accepted/expired/revoked via metaDados._meta.action
  - **Frontend:** Cliente HTTP + página /invite/page.tsx + modal InviteWorkspaceModal atualizada
  - **Seed:** 6 DClasses novas (-476 INVITE_TOKEN, -477..480 INVITE_STATUS_*, -502 INVITE_LIFECYCLE), total 137
  - **Segurança:** Fire-and-forget email com log estruturado, race-condition handling, token bruto nunca logado
  - **Tests/Build:** npm run build PASS, tsc PASS, eslint PASS, 14 unit + 4 integration PASS, coverage 87%
  - **Pilares:** P2 justificado (workflow com side effects); P3 respeitado (ZERO tabela nova, reutiliza padrão V2)
  - **ADRs:** ADR-V2-001, ADR-V2-003, ADR-V2-004, ADR-V2-008, **ADR-V2-028**
  - **Review:** APPROVED 8.3/10

- **F12 Task#1: Webhooks Outbound (CRUD, Signing, BullMQ, Auto-disable, SSRF, Observabilidade)** (V2 F12) - 2026-05-10
  - **Webhooks Module:** CRUD completo de webhooks via `DTabela.idClasse=-470`
  - **EventRouter Integration:** Hook dinâmico em `EventRouterService` para captura de eventos e enfileiramento assíncrono
  - **BullMQ Processing:** Despacho assíncrono com retry exponencial (3x) e truncamento de payload (256KB)
  - **Segurança (SSRF):** `WebhooksSsrfService` com resolução DNS e bloqueio de IPs privados/locais/metadata
  - **Segurança (Signing):** Assinatura HMAC-SHA256 e criptografia AES-256-GCM dos secrets
  - **Resiliência:** Auto-disable após 10 falhas consecutivas; timeout de 10s por tentativa
  - **Observabilidade:** Métricas P95 de latência e contadores de sucesso/falha/timeout via `@Cron`
  - **Documentação:** Guia completo em `docs/webhooks-guide.md`
  - **Pilares:** P2 justificado (gestão específica + dispatcher); P3 respeitado (DClasses -470, -491)
  - **ADRs:** ADR-V2-012 (Webhooks outbound), ADR-V2-028, ADR-V2-031
  - **Tests/Build/Lint:** `npm run build` PASS; `tsc --noEmit` PASS; `eslint` PASS; coverage 100% serviços críticos
  - **Review:** APPROVED 8.8/10

- **F10 Task#6: Channels Bloco D - Rate Limit + Observabilidade** (V2 F10) - 2026-05-10
  - **Rate limit Telegram:** `TelegramRateLimitService` com Redis Lua atomico por `rate:telegram:{chatId}`, limite 30 mensagens/min/chat e fail-open controlado
  - **Observabilidade:** `TelegramMetricsService` com contadores text/voice/command/intent e P95 de latencia de transcricao
  - **Webhook:** `TelegramWebhookService` aplica rate limit antes de resolver usuario/processar mensagem e registra metricas por `correlationId`
  - **Seguranca de logs:** `TelegramSendService` mascara `bot<TOKEN>` em logs de webhook
  - **Debts resolvidos:** [DEBT-F10-C-01] `UserProjectService`, [DEBT-F10-C-02] backlog `INBOX+READY`, [DEBT-F10-C-03] `findByChat` com filtro JSONB por `chatId`
  - **Tests/Build/Lint:** `tsc --noEmit` PASS; jest recorte channels + UserProjectService PASS (16 suites / 130 tests); build PASS; eslint PASS
  - **Pilares:** P1 N/A (channels infra, zero Engine); P2 reutiliza services existentes; P3 respeitado (zero migration/seed/DClasse nova)
  - **F10 Completa (Blocos A-D)**

- **F10 Task#5: Channels Bloco C - Telegram Commands (create-task, tasks, status, pair)** (V2 F10) - 2026-05-10
  - **6 command handlers com JSDoc 100%:** StartHandler, PairHandler, TasksHandler, StatusHandler, CreateTaskHandler, CreateTaskFromTextIntent
  - **Intent parsing:** MessageRouterService resolve comandos via `/` e intents sem barra automaticamente
  - **Reutilizacao:** TasksService.findMany + TasksService.create (zero duplicacao logica negocio)
  - **Period resolver:** TasksHandler filtra today/week/backlog com TimezoneService (Brasil timezone)
  - **3 debts registrados e resolvidos no Bloco D:** [DEBT-F10-C-01] extrair `resolveDefaultProjectId`, [DEBT-F10-C-02] corrigir filtro backlog (READY), [DEBT-F10-C-03] corrigir findByChat JSONB
  - **Tests:** 6 handlers + intents, todos PASS
  - **Pilares:** P2 justificado (handlers decoram TasksService); P3 respeitado (zero DClasse nova)
  - **F10 Blocos A-C:** 30/30 + 32/32 + 10/10 = 72/72 testes PASS
  - **Review:** APPROVED 8.5/10

- **F10 Task#5: Channels Bloco B - Telegram Webhook + Groq Whisper** (V2 F10) - 2026-05-10
  - **TelegramSecretGuard:** crypto.timingSafeEqual (OWASP ASVS 2.9.2), fail-closed, zero token leak
  - **POST /webhooks/telegram:** @HttpCode(200) + setImmediate (resposta não-bloqueante)
  - **handleText:** prisma.$transaction (DEvento -493 + DVincula -483 lastSeenAt)
  - **handleVoice:** DEvento -494 gravado mesmo com falha Groq; error em metaDados
  - **Deduplicação update_id:** Redis SET NX PX 3600000 (1h TTL)
  - **TelegramSendService:** sendMessage + setWebhook (onModuleInit, idempotente)
  - **TelegramFileDownloadService:** download AbortController timeout 10s
  - **GroqWhisperService:** transcribe multipart/form-data, ServiceUnavailableException sem key
  - **Evento emitido APÓS commit:** Padrão #7 V2 verificado (callOrder)
  - **Tests:** 32/32 PASS (unit + integration)
  - **Review:** APPROVED 8.8/10

- **F10 Task#4: Channels Bloco A - Core Channels** (V2 F10) - 2026-05-10
  - **ChannelAdapter interface:** `send()`, `parseInbound()`, `verifySignature()` + `InboundMessage` type contrato genérico para múltiplos canais
  - **PairingService:** `generate()` (CSPRNG 32-byte + SHA-256 hash) com UPSERT em DTabela -474 (PAIRING_TOKENS); `consume()` com $transaction one-shot (lookup + mark used + create DVincula)
  - **AccountLinkService:** `findByChat()` query única (BigInt chatId) com índice em DTabela, sem N+1
  - **MessageRouterService:** `handleInbound()` com intent parsing a partir de `InboundMessage`, `registerIntentHandler()` para extensibilidade plugável
  - **CommandRegistryService:** `register()` para adicionar comandos, `resolve()` para lookup por nome
  - **PairingController:** POST `/channels/pairing/generate` (retorna token) + POST `/channels/pairing/link` (consome token + cria DVincula)
  - **ChannelsModule:** `onModuleInit` verifica CHANNELS_ENABLED feature flag (ADR-V2-010 compliance: módulo opcional)
  - **DTOs validados:** `LinkAccountDto` com @Matches(/^\d+$/) em chatId para validação numérica
  - **Pilares:** P1 N/A (infraestrutura), P2 controller proprio justificado (orquestração pairing + linking), P3 zero migration/seed/DClasse nova
  - **Tests:** 30/30 PASS (pairing, account linking, message routing, command registry)
  - **Review:** APPROVED 8.2/10; 3 issues corrigidos (chatId validation, consume filter otimizado, dead code removido)

### Added (histórico)

- **F9 Task#3: Reports PDF / Bloco X** (V2 F9) - 2026-05-10
  - **ReportsModule:** `GET /reports/projects/:projectId/pdf` com response `application/pdf` via PDFKit
  - **PdfGeneratorService:** 8 seções — header, resumo executivo, flow metrics, velocity, burndown, tasks-by-user, forecast, riscos
  - **Cache TTL:** 5 minutos via `TtlCacheService`
  - **Graceful degradation:** `Promise.allSettled` para forecast/analytics (failures → warnings em payload, nunca 500)
  - **Tenant isolation:** validacao explícita (403 org divergente); nenhum vazamento de dados cross-org
  - **Dependências:** `pdfkit`, `@types/pdfkit` adicionadas
  - **Pilares:** P1 read-only/zero Engine, P2 controller proprio justificado, P3 zero migration/seed/DClasse nova
  - **Tests:** 28/28 PASS (pdfkit generation, graceful degradation, caching, tenant isolation)
  - **F9 completa:** 58/58 testes (Blocos V + W + X)
  - **Review:** APPROVED 8.8/10

- **F8 Task#2: Search / Bloco U** (V2 F8) - 2026-05-10
  - **SearchModule:** `GET /search` com resultado categorizado `{ tasks, projects, people, cursors, meta }`
  - **Busca cross-entity:** DTask, DProject e DEntidade em uma request, com limites 50%/30%/20%
  - **Tenant isolation:** tasks via `project.idEstab`, projects via `idEstab`, people via `DVincula` membership de organizacao
  - **Pagination:** cursors independentes `taskCursor`, `projectCursor`, `peopleCursor`
  - **Performance:** 4 queries/request; branches principais em `Promise.all`; `queryPeople` usa `DVincula` + `DEntidade IN`, sem N+1
  - **Pilares:** P1 read-only/zero Engine, P2 controller proprio justificado, P3 zero migration/seed/DClasse nova
  - **Tests:** `npm run build` PASS, `npx tsc --noEmit` PASS, `npx eslint src/search/` PASS, `npx jest src/search --runInBand` PASS (15/15), service coverage 97.61%
  - **Review:** APPROVED 8.8/10

- **F8 Task#1: Flow Metrics + Forecast Monte Carlo** (V2 F8) - 2026-05-10
  - **FlowMetricsModule:** 6 endpoints read-only: `cycle-time`, `lead-time`, `throughput`, `wip-age`, `cfd`, `dashboard`
  - **ForecastModule:** `GET /forecast/:projectId` com Monte Carlo bootstrap resample e percentis p50/p75/p85/p95
  - **PeriodResolver:** filtros de periodo centralizados via `TimezoneService`
  - **Dashboard:** agregacao paralela via `Promise.all`
  - **Forecast historical:** throughput por sprints com fallback rolling-window
  - **Pilares:** P1 read-only/zero Engine, P2 endpoints proprios justificados por analytics derivados, P3 zero migration/seed/DClasse nova
  - **Tests:** `npm run build` PASS, `npx tsc --noEmit` PASS, `npx jest src/flow-metrics src/forecast --runInBand` PASS (59/59 no review)
  - **Review:** APPROVED 8.5/10

- **F7 Task#3: Notifications endpoints `/notifications/*`** (V2 F7) - 2026-05-10
  - **NotificationsModule:** controller proprio `/notifications` para leitura e mutacao de notificacoes in-app em `DEvento.idClasse=-490`
  - **Endpoints:** `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `DELETE /notifications/:id`
  - **Soft delete:** migration pontual adiciona `DEvento.excluido Boolean @default(false)`; delete seta `excluido=true`
  - **Read state:** `metaDados.read/readAt`; ausencia de `read` e tratada como nao lida
  - **Ownership:** todas as queries filtram `idEntidade=user.entidadeId` e `excluido=false`
  - **NotificationConsumer:** idempotencia passa a filtrar `excluido=false`
  - **Pilares:** P1 N/A estrutural, P2 controller proprio justificado, P3 zero seed/DClasse nova
  - **ADRs:** ADR-V2-032 formaliza excecao controlada sem precedente geral
  - **Tests:** `npx.cmd prisma generate` PASS, `npm.cmd run build` PASS, `npx.cmd tsc --noEmit` PASS, `npx.cmd jest src/notifications src/eventos/consumers --runInBand` PASS (4 suites / 30 tests)
  - **Review:** APPROVED 8.2/10

- **F7 Task#2: NotificationConsumer + WebhookConsumer + EventRouter Ativo** (V2 F7) - 2026-05-10
  - **NotificationConsumer:** cria notificacoes in-app em `DEvento.idClasse=-490` para `task.status.changed`, `task.assigned`, `execution.awaiting_approval`, `execution.completed` e `execution.failed`
  - **WebhookConsumer:** resolve `orgId` por payload, project ou task, le configs ativas `DTabela.idClasse=-470` por organizacao e chama dispatcher injetado
  - **WebhookDispatcherStub:** contrato outbound sem HTTP real; HMAC, retry de rede, auto-disable e `DEvento -491` ficam para F7 Task #4/F12
  - **EventRouterService:** audit continua catch-all; notification/webhook entram por trigger explicito
  - **Pilares:** P1 N/A estrutural, P2 zero endpoint novo, P3 zero seed/migration/DClasse nova
  - **ADRs:** ADR-V2-028, ADR-V2-029, ADR-V2-030, ADR-V2-031
  - **Tests:** `npm.cmd run build` PASS, `npx.cmd tsc --noEmit` PASS, `npx.cmd jest src/eventos --runInBand` PASS (3 suites / 19 tests)
  - **Review:** APPROVED 8.4/10; minor de idempotencia resolvido na F7 Task#3

- **F7 Task#1: Eventos Canônicos — Core de Eventos + Refactor F4/F6** (V2 F7) — 2026-05-09
  - **EventProducerService:** único entry point emissão, validação `type ∈ ALL_EVENT_TYPES_SET`, metadata enriquecida (source, timestamp, correlationId)
  - **EventRouterService:** roteamento catch-all em Task#1 (AuditLogConsumer), placeholders Task#2 (NotificationConsumer, WebhookConsumer)
  - **CircuitBreakerService:** Half-Open pattern (closed/open/half-open) com 5 falhas em 60s, timeout 30s para recuperação
  - **IntelligentRetryService:** backoff exponencial 1/2/4/8/16s (5 tentativas máximo), state machine com `@OnModuleDestroy`
  - **AuditLogConsumer:** único INSERT `DEvento`, mapping `type→idClasse` alinhado com seed (-489..-501), ADR-V2-026/027 aplicadas
  - **TelemetryService:** counters emitted/succeeded/failed, gauge pendingRetries
  - **EventHealthController:** `GET /events/health` (@Public) com status infra + métricas producer/router/circuitbreaker
  - **Refactor F4/F6:** AuditService DELETADO; 5 services migrados (Email, Orgs, Projects, Tasks, Engine F6) para EventProducerService; OperacaoExecucaoClaude agora usa IEventProducer typed
  - **CommonModule @Global:** centraliza PrismaService, CorrelationIdService, TimezoneService (elimina duplicate stores)
  - **Seed F1:** -489 AUDIT_GENERIC, -499 PROJECT_LIFECYCLE, -500 ORG_LIFECYCLE = 131 DClasses total
  - **Tests:** 292/292 PASS (26 suites), N+1 ZERO, JSDoc 100% em core eventos

### Changed

- **Estrutura de auditoria:** `prisma.dEvento.create` direto → `EventProducerService.addInternalEvent()` em 5 services (não inclui auth.service.ts, débito H1 para próxima task)
- **OperacaoExecucaoClaude (F6):** `eventProducer` typed via `IEventProducer` (era `any`), event emitido APÓS super.grava()
- **CommonModule:** novo módulo @Global exporta 3 singletons canônicos (resolve duplicate AsyncLocalStorage)

### Fixed

- **F8 Forecast:** N+1 em `ForecastService.getSprintThroughput` removido com `groupBy` batch + fallback unico em memoria.
- **F8 Flow Metrics:** filtro `criadoEm` removido de cycle-time e lead-time; periodo passa a ser aplicado pela telemetria `doneAt`.

### Performance

- **F8 Dashboard:** services de flow metrics agregados com `Promise.all`.
- **F8 Search:** 3 branches principais paralelas e 4 queries/request, sem query por resultado.
- **F8 Forecast:** contagem por sprint em lote, sem loop de queries por sprint.

### Tests

- **F8 Task#1:** build PASS, TypeScript 0 errors, 59/59 tests PASS no review.
- **F8 Task#2:** build PASS, TypeScript 0 errors, ESLint PASS, 15/15 tests PASS, `search.service.ts` com 97.61% statements coverage.

### Technical Debt

- **F8 CFD:** `DEvento` nao tem FK direta para `DProject`; filtro por projeto fica em memoria via taskId, monitorar para F9/F14.
- **F8 Search:** controller depende de e2e futuro; FTS/GIN index fica para F14 se volume alto.

### Removed

- `src/common/services/audit.service.ts` — substituído por EventProducerService (0 impacto em caller — adapter pattern mantido)

### Deprecated

- Direct `prisma.dEvento.create()` calls — use `EventProducerService.addInternalEvent()` (deprecated per padrão #14)
- Types `auth.login`, `auth.logout`, `auth.register`, `auth.failed` — não em EVENT_TYPES (débito H1)

---

- **F6 ExecutionsModule + ApprovalFlow + 58 Patterns Adversariais** (Task #2, V2 F6) — 2026-05-09
  - **gravarAposAprovacaoManual()** em `OperacaoExecucaoClaude`: restaura DPedido `awaiting_approval`, UPDATE (não INSERT), DVFS 6+7, `_executarClaude()` — Pilar 1 preservado
  - **risk-gate-validator.js:** 25 HIGH + 15 MEDIUM patterns (40 total, 58 testes adversariais PASS)
  - **IExecucaoData.risk.matchedPatterns** corrigido: `string[]` → `Array<{ pattern: string; level: string }>`
  - **ExecutionsModule:** `ExecutionsService` (LOW/MED auto, HIGH awaiting), `ApprovalFlowService` (approve race-safe, reject, rollback), `ApprovalFlowSweeperService` (@Cron expira vencidos), `ExecutionHistoryService` (cursor pagination), `ClaudeRunnerService` (STUB F6), `ExecutionsController` (8 endpoints Swagger), `ExecutionAccessGuard`, `ExecutionThrottlerGuard` (30 req/min)
  - **Race condition approve()**: `$executeRaw` com `WHERE dados->'approval'->>'status' = 'awaiting_approval'` — segundo admin recebe ConflictException 409
  - **riskLevel** derivado de `idClasse` (-301→LOW, -302→MED, -303→HIGH) via `RISK_CLASSE_MAP`

- **F6 Engine + OperacaoExecucaoClaude — Pilar 1 ATIVO** (Task #1, V2 F6) — 2026-05-09
  - **Operacao.ts** (~80L): classe abstrata base — `nova()` via `getNextSequenceKey()` (PostgreSQL sequence `chcriacao_seq`), `erro()` com InternalServerErrorException
  - **OperacaoPedido.ts** (~800L): FULL workflow polimórfico — `_carregaScriptsCalc()` (chaves 3,4,5) + `_carregaScriptsGrav()` (chaves 6,7); filtro `chaveScript` (ADR-V2-016, bug `s.id` CORRIGIDO); fallback idClasse concreto → -300 (decisão CEO)
  - **OperacaoExecucaoClaude.ts** (~260L): CORAÇÃO V2 — `extends OperacaoPedido` (ADR-V2-005); Risk Gate → Approval → Claude Runner (STUB) → PR auto-open; `calcula()` determina `idClasse` via risk.level (-301/-302/-303, ADR-V2-006)
  - **Auxiliares (VOs puros):** `PedidoCabecalho`, `PedidoItem`, `PedidoItens` — sem Prisma, `toJson()`, getters/setters encapsulados
  - **Interfaces:** `IOperacaoConstruct`, `IOperacaoPedidoConstruct`, `IOperacaoExecucaoClaudeConstruct`, `IExecucaoData` (command/risk/approval/claude/git/pullRequest/task/audit)
  - **Helpers:** `sequence.helper.ts` (BigInt), `dvfs-loader.helper.ts` (fallback 2 níveis + cache TTL 5min), `execution-context.helper.ts`
  - **Scripts DVFS** (`src/engine/dvfs/`): `risk-gate-validator.js` (chave=3, 5 HIGH + 3 MEDIUM patterns), `command-validator.js` (chave=4, path traversal + limites), `pr-auto-open.js` (chave=7, GitHub API + fallback URL), `notification-dispatcher.js` (chave=7, DEvento -490)
  - **dvfs.seed.ts:** 5 registros DVFS idempotentes (`upsert`) em `idClasse=-300`; chaves 5,6 no-op stubs; chave 7 combina pr-auto-open + notification
  - **Migration** `20260509000000_add_chcriacao_seq`: `CREATE SEQUENCE chcriacao_seq START WITH 1000000`
  - **24 testes unitários** (PASS): 3 BLOQUEANTES ADR-V2-016 (R-CHAVE-5, R-CHAVE-7, DVFS-NULL-WARN) + 21 unitários OperacaoExecucaoClaude

### Security
- Scripts DVFS executados via `eval()` em runtime — nenhum endpoint expõe `conteudo` de script via request (risco RCE mitigado: scripts são exclusivamente seed de desenvolvedor, chaves negativas, Pilar 3)

### Tests
- **R-CHAVE-5 (BLOQUEANTE ADR-V2-016):** `_funcPosCalculo` carrega DVFS `chaveScript=5` — falha automaticamente se bug `s.id` reintroduzido
- **R-CHAVE-7 (BLOQUEANTE ADR-V2-016):** `_funcPosGravacao` carrega DVFS `chaveScript=7` — idem para caminho de gravação
- **DVFS-NULL-WARN:** chave ausente retorna `undefined` e dispara `Logger.warn` (nunca null silencioso)

---

- **F5 Domínio Estrutural Scrumban** (Task #1, V2 F5) — 2026-05-09
  - **Organizations:** CRUD + membership RBAC duplo (DVincula -161/-162/-163) + cascade delete
  - **Teams:** CRUD + membership (DVincula -181/-182) + issue counter atomico (DTabela -475)
  - **Projects:** CRUD + seed bootstrap 9 statuses V3 (-441..-449) + Sprint (-400) + activity feed + members
  - **Tasks:** CRUD + state machine V3 (9 estados, ~12 transições) + identifier atômico DEV-N
  - **WorkflowStatuses + Sprints:** wrappers thin (ADR-V2-009) — CRUD via `/tabelas?idClasse=-44X/-400`
  - **TeamRolesGuard:** implementação real (substitui stub F3) + LRU cache
  - **getEntidadeIdFromUserGroup():** método centralizado + LRU cache em EntidadeService
  - **Seed:** +2 classes (-153 SCRUMBAN_PROJECT, -154 SCRUMBAN_TASK = 130 total)

### Performance
- N+1 ZERO: ProjectActivityService cursor pagination, ProjectMembersService batch, TasksService JOIN (25+ verificações)
- Identifier DEV-N: atomicidade verificada contra race conditions (10 concurrent POST test)
- LRU cache: TeamRolesGuard (2000 entries, 5min), RoleResolverService (1000, 5min), getEntidadeIdFromUserGroup (1000, 5min)

### Tests
- 189/189 PASS (87 F5-específicos + 102 anteriores)
  - Organizations: 24 unit tests (3 integrados)
  - Teams: 22 unit tests (2 integrados)
  - Projects: 31 unit tests (6 integrados seed bootstrap)
  - Tasks: 28 unit tests (5 integrados state machine)
  - Auth + Entidades: 2 unit tests (decorator, getEntidadeIdFromUserGroup)
  - Smoke: build, tsc, eslint, 12 transições state machine válidas + 15 inválidas rejeitadas

### Technical Debt Resolvida
- `@TeamRoles()` decorator stub → implementado com LRU cache
- RolesGuard F3 (organização) → complementado com TeamRolesGuard (time/projeto)

### Issues Registrados (F14)
- `parseInt()` em 4 controllers para parsing de `limit` query param — refatorar para BigInt-safe
- ProjectMembersService sem validação se usuário existe em org pai — adicionar F7+
- TasksStateMachineService cache de transições — considerar memoization se >500 tasks/sprint

### F4 Email Module + Common Services** (Task #1, V2 F4) — 2026-05-09
  - **Email Module:** abstração de provider com SMTP (nodemailer), SendGrid, Resend; `EMAIL_MOCK=true` para CI
    - 4 templates TypeScript puro: welcome, password-reset, invite, notification-digest
    - AuditService registra `email.sent` e `email.failed` em DEvento idClasse=-501 APÓS persistência (canônico)
    - `EmailService.sendTemplate()` com suporte a customização de headers/replyTo
  - **Common Services (Pilares 1 e 2 suporte):**
    - TimezoneService: America/Sao_Paulo canônico com 5 métodos (applyDateFilters, toStartOfDayBrazil, toEndOfDayBrazil, getPeriodDates, toStartOfMonthBrazil) — integrado em EntidadeService
    - CorrelationIdMiddleware: AsyncLocalStorage thread-safe com X-Correlation-Id (ecoado em response)
    - LoggingInterceptor: loga method, path, statusCode, durationMs, correlationId, userId em toda request
    - HttpExceptionFilter: padroniza respostas 4xx/5xx com { statusCode, message, correlationId, timestamp }
    - AuditService stub: INSERT em DEvento idClasse=-501 pós-persistência (substituído por EventProducerService em F7)
    - HealthModule: GET /health (@Public, sem autenticação) com checkDb + checkRedis + checkEmail; HTTP 503 se DB error
  - **Utils canônicos:** validateCpf, validateCnpj, cleanCpfCnpj, hashSha256, hashBcrypt, compareBcrypt — sem dependências externas
  - **Documentation:**
    - `src/email/README.md` — guia operacional do módulo email (configuração, templates, modo mock)
    - `src/common/health/README.md` — guia de health check (load balancer, Kubernetes, Prometheus)
    - `docs/email-providers.md` — guia completo de configuração (SMTP local MailHog, SendGrid, Resend, Mock)
  - **Fix (Reviewer MINOR m1):** HealthController adiciona `@Public()` explícito (seguro para APP_GUARD global futuro)

### Performance
- N+1 ZERO: HealthService usa `Promise.all()` sem loop; EmailService 0 queries (apenas provider.send)
- Timeout health check: 5s com fallback "degraded" para Redis opcional
- CorrelationIdMiddleware: AsyncLocalStorage garante isolamento por request (sem race conditions)

### Tests
- 102/102 PASS (78 anteriores + 24 novos em F4)
  - TimezoneService: 6 specs (edge cases DST, UTC/Brasília)
  - EmailService: 8 specs (providers, templates, mock, audit)
  - HealthService: 6 specs (checks db/redis/email, timeouts, status codes)
  - AuditService: 2 specs (insert, error handling)
  - Utils: 2 specs (crypto, validation)

### Security
- Bcrypt com saltRounds=12 em hashBcrypt (canônico)
- X-Correlation-Id sanitizado de XSS (alphanumeric + hífens)
- Sem logs de credenciais de email (SMTP_PASS, SENDGRID_API_KEY não logados)

### Technical Debt Registrado
- `nestjs-pino` não instalado (DoD não atendido) — dívida para F5 ou task dedicada (-0.75 score, não bloqueante)
- `email/queue/` stub ausente (opcional per plano, mas melhora completude) — será criado em F7 com BullMQ
- Dívida mínima mantida: "-0.5 @Public explícito em Health" resolvida neste commit

### Dívidas Técnicas Futuras (F7+)
- BullMQ queue para processamento assíncrono de emails
- Retry automático com exponential backoff
- Webhooks de delivery status (SendGrid, Resend)
- Template versioning com migrations

---

- **F3 Auth + RBAC Duplo** (Task #1, V2 F3) — 2026-05-09
  - `AuthModule` completo: 7 guards (JwtAuthGuard, ApiKeyGuard, McpKeyGuard, AuthCompositeGuard, OrgTenantGuard, ProjectScopeGuard, RolesGuard), 5 services (AuthService, ApiKeyService, McpKeyService, RefreshTokenService, RoleResolverService)
  - `AuthController`: 13 endpoints (register, login, refresh, logout, /me CRUD + api-key + mcp-key) — todas com Swagger 100%, JSDoc completo
  - `PermissoesModule`: 4 endpoints CRUD DPermissao com `@Roles('ADMIN')` guard
  - RBAC duplo via DVincula + idClasse (ADR-V2-003): Org roles (-161 ADMIN / -162 MEMBER / -163 VIEWER); Project roles (-171 MANAGER / -172 MEMBER / -173 VIEWER)
  - API Keys via DTabela(-471) + MCP Keys via DTabela(-472) com hash duplicado em DUserGroup.dados (ADR-V2-004)
  - `@Public()` decorator substitui `@SkipGuard()` placeholder de F2
  - Refresh token rotativo: cada refresh gera novo hash, token antigo invalidado (reuse detection)
  - RoleResolverService com LRU cache 1000 entries TTL 5min — N+1 ZERO em RBAC queries
  - OrgTenantGuard com LRU cache — isolamento multi-tenant via DProject.idEstab

### Fixed (Dívidas F2 resolvidas em F3)
- `PaginationMetaDto` movida de `src/entidades/dto/` para `src/common/dto/pagination-meta.dto.ts` (resolve cross-module dependency)
- `formatTabelaResponse` extraída de inline em `tabelas.service.ts` para `src/tabelas/helpers/format-tabela-response.ts`
- `validarClasse` extraída para `src/common/helpers/validar-classe.helper.ts` (elimina duplicação entre entidades e tabelas)
- `ParseBigIntPipe` aplicado em `@Param('id')` em todos os controllers F2 (EntidadeController, TabelaController, ClasseController)
- `POST /classes` registrado explicitamente com `@Post()` retornando `HttpStatus.FORBIDDEN` com mensagem clara

### Technical Debt (Registrado para F14)
- `findUserGroupByRefreshToken` em AuthController acessa `this.authService['prisma']` via bracket notation — refatorar para método público em AuthService
- `revokeApiKeys` usa loop sequencial com `await` em vez de `updateMany` — refatorar para batch update
- `ApiKeyService.validate` sem índice GIN em DTabela.dados Json — avaliar raw query ou criar índice se volume > 100 keys
- `findUserGroupByRefreshToken` faz scan O(n) em DUserGroup — adicionar campo indexado ou userGroupId no RefreshDto

### Performance
- N+1 ZERO em `/auth/me`: 2 queries (DUserGroup+DEntidade JOIN + DVincula findFirst)
- N+1 ZERO em RBAC queries: RoleResolverService com LRU cache TTL 5min
- `getMe` performance: ≤3 queries verificado com DATABASE_LOGGING=true

### Tests
- 78 unit tests PASS (12 suites: auth.service, api-key.service, role-resolver.service, refresh-token.service, auth-composite.guard, roles.guard + F2 carryover)
- Todos os bloqueadores DoD verificados: build clean, TypeScript 0 erros, ESLint 0 warnings, Swagger 100%, JSDoc completo
- Refresh token reuse detection testado: token antigo vira inválido após rotate
- Bcrypt rounds = 12 (constante explícita com comentário ADR)
- Senha NUNCA logada (grep confirmado)

### Security
- Bcrypt rounds ≥ 12 para hash de senha (ADR-V2-004)
- API Key plaintext retornado UMA VEZ ao criar (nunca reexibido)
- MCP Key hash duplicado em DUserGroup.dados com sync em transaction
- Refresh token rotativo com reuse detection (detecta e revoga ao ver token antigo)
- Sem `console.log` no código auth (grep confirmado)

---

### Added (F2 Pilar 2 — Endpoints Genéricos)
  - `EntidadeController` + `EntidadeService` — CRUD completo `/api/v1/entidades` (GET/POST/PATCH/DELETE) com cursor pagination, soft-delete, N+1 ZERO (include com JOIN), BigInt serializado, Swagger 100%, JSDoc completo
  - `TabelaController` + `TabelaService` — CRUD completo `/api/v1/tabelas` com filtro `dEntidadeId`, cursor pagination, soft-delete
  - `ClasseController` + `ClasseService` — Read-only `/api/v1/classes` + `GET /classes/tree` (1 query + Map em memória, ZERO N+1), bloqueio 403 explícito para POST (classes do seed — imutáveis via API)
  - Infraestrutura comum: `ParseBigIntPipe` + `ParseOptionalBigIntPipe` (conversão segura string → bigint), `@SkipGuard()` decorator placeholder (F3 substitui por JwtAuthGuard), LRU cache genérico (max 200 entradas, TTL 5min) para alias `?classe=NOME`
  - **ADR-V2-015 implementado:** `?idClasse=N` canônico V2; `?classe=NOME` aceito com headers `Deprecation: true` e `Sunset: 2026-06-05T00:00:00.000Z` por 2 sprints (sunset em 2026-06-05); ambos simultaneamente → 400 BadRequest
  - Audit inline via DEvento -497 em `criar()` para entidades (placeholder até F7 EventProducerService)
  - Método canônico `getEntidadeIdFromUserGroup(userGroupId)` — Pattern #5 Devari-Core, pré-requisito de F3
  - Helper canônico `createSeller(dto)` — template para criação de sellers com conta virtual em transaction, ready para uso futuro

### Performance

- N+1 ZERO: todas as listagens usam `include: { classe }` (JOIN no banco), `getTree` = 1 `findMany` + Map em memória (O(n) linear)
- Cursor pagination em todas as listagens (não usa offset ineficiente)

### Tests

- 43 unit tests novos passando (meta mínima: 26)
  - `src/entidades/entidades.service.spec.ts` — 8 specs
  - `src/tabelas/tabelas.service.spec.ts` — 6 specs
  - `src/classes/classes.service.spec.ts` — 4 specs
  - `src/common/pipes/parse-bigint.pipe.spec.ts` — 5 specs
  - `src/common/helpers/lru-cache.spec.ts` — 3 specs
  - `prisma/seeds/__tests__/validate-hierarchy.spec.ts` — 12 specs (carryover F1, incluso em contagem)

### Technical Debt

- `[TECH-DEBT/F3]` `PaginationMetaDto` em `src/entidades/dto/` — mover para `src/common/dto/pagination-meta.dto.ts` para quebrar dependência cruzada `TabelasModule → EntidadesModule`
- `[TECH-DEBT/F3]` `formatTabelaResponse` inline em `tabelas.service.ts` — mover para `src/tabelas/helpers/format-tabela-response.ts`
- `[TECH-DEBT/F3]` `validarClasse` duplicada em `EntidadeService` e `TabelaService` — extrair para `src/common/helpers/validate-classe.ts` ou injetar `ClasseService`
- `[TECH-DEBT/F3]` `ParseBigIntPipe` não aplicado em `@Param('id')` dos 3 controllers — aplicar em F3
- `[ADR/F3]` Redigir ADR-V2-025 (BigInt serialization strategy: interceptor global vs por-módulo)
- Cache de `validarClasse` em memória (Map imutável no `onModuleInit`) — implementar em F3 (15 linhas)
- `?classe=NOME` removal — sunset em 2026-06-05, remover wrapper em F3/F5 se não tiver uso

### Generator Impact

- 3 controllers genéricos (`EntidadeController`, `TabelaController`, `ClasseController`) com cursor pagination + soft-delete + Swagger 100% + ADR-V2-015 compat wrapper são **candidatos a entrar no Devari-Core v3.0** como módulos base reutilizáveis
- Registrado em `docs/lessons/issues-evolution-from-v2.md` com label `evolution-candidate`

---

- **F1 Pilar 3 — Schema canonico + Seed de DClasses** (Task #1, V2 F1)
  - 17 tabelas canonicas Devari-Core no `prisma/schema.prisma` com 4 relations FK adicionadas pre-F1 (DTask.assignee, DTask.creator, DProject.estab, DPedido.locEscritu) + reversas em DEntidade (`tasksAssigned`, `tasksCreated`, `projetos`, `pedidosAsLocEscritu`).
  - Migration inicial `prisma/migrations/20260508204157_initial_canonical/migration.sql` (17 CREATE TABLE + FKs).
  - **128 DClasses** seedadas em `prisma/seeds/classes.seed.ts` (45 fixas Devari-Core via spread de `templates/classes-base-template.ts` + 83 especificas Scrumban-V2 no range -150..-527).
  - Validador puro `prisma/seeds/validate-hierarchy.ts` — funcao `validateHierarchy()` com 6 checagens (chave negativa, sem duplicatas, root unico=-1, idPai existe, sem ciclos via DFS O(N), sem sequestro de canonicas Devari-Core -45/-47/-49/-50). Rodado em time de import — falha precoce em `tsc`/`jest`/CI antes de tocar o banco.
  - Helpers exportados: `CANONICAL_RESERVED`, `FIXED_RANGE_MIN`, `FIXED_RANGE_MAX`, `isInFixedRange()` para auditoria externa.
  - Seed-runner `prisma/seeds/seed-runner.ts` — UPSERT atomico em `prisma.$transaction` (idempotencia forte, drift detection); modo `--dry-run` para CI offline; logs estruturados.
  - 6 ADRs MADR canonicos em `docs/decisions/`: ADR-V2-019 (seed monolitico vs particionado), ADR-V2-020 (UPSERT idempotente em transacao), ADR-V2-021 (validador puro testavel), ADR-V2-022 (renumeracao corte limpo, ratifica ADR-V2-002), ADR-V2-023 (4 relations FK pre-F1), ADR-V2-024 (console.log cirurgico em prisma/seeds/).
  - Auditoria documental `docs/SCHEMA-CANONICO-AUDITORIA.md` (253 linhas, 17 tabelas + dump das 128 classes + mapeamento V2).
  - Metricas Generator (ADR-V2-017): `docs/lessons/metrics-fase-1.md`.
  - Pilares: P3 ATIVADO PLENAMENTE; P1 preparado (DPedido -300..-303 + DVFS -91..-95 prontos para F6); P2 fora de escopo F1.
  - ADRs: ADR-V2-019, ADR-V2-020, ADR-V2-021, ADR-V2-022, ADR-V2-023, ADR-V2-024.

### Changed

- `prisma/schema.prisma` — 4 relations FK acrescentadas para integridade referencial completa (justificativa em ADR-V2-023; nao infringe ADR-V2-001 — zero tabela nova).
- `package.json` — bloco `"prisma": { "seed": "ts-node prisma/seeds/seed-runner.ts" }` adicionado; `jest.rootDir` migrado de `"src"` para multi-roots `["<rootDir>/src", "<rootDir>/prisma/seeds"]` para descobrir specs do validador; `coverageDirectory` ajustado para `"./coverage"`.

### Performance

- Seed: 1a execucao **948ms** / 2a execucao **149ms** (idempotencia forte via UPSERT em transacao).
- Validador: O(N) DFS amortizado com 1 unica passada por elemento; falha em milissegundos sobre 128 classes.
- Smoke test integrado total: ~5s (excluindo docker compose startup).

### Tests

- 12 unit tests em `prisma/seeds/__tests__/validate-hierarchy.spec.ts` (vs 6 minimos do DoD-08), 100% PASS:
  1. arvore valida (classesFixas)
  2. ciclo direto A->B->A
  3. ciclo indireto A->B->C->A
  4. idPai inexistente
  5. sequestro de canonica reservada (-47)
  6. chave duplicada
  7. chave positiva
  8. root duplicado
  9. root com chave != -1
  10. exporta CANONICAL_RESERVED com 5 chaves
  11. array vazio
  12. expoe FIXED_RANGE_MIN/MAX e isInFixedRange para validacoes externas

### Security

- ZERO tabela nova fora das 17 canonicas (ADR-V2-001 enforcing via `enforce-canonical-tables.sh`).
- ZERO sequestro de DClasses canonicas Devari-Core (-45/-47/-49/-50 livres para uso fintech; validador bloqueia em time de import).
- Convencao chave negativa (seeds) vs positiva (runtime) preservada — validador rejeita chave positiva no seed.

---

**Maintained by:** Documenter Agent V2 (Scrumban-Backend-V2)
