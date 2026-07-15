# Implementer Agent Memory — Scrumban-Backend-V2

**Versão:** 2.24 (merge de duas máquinas: unificação Nexus⇄MCP + notas F4/delay/mcp-tools — 2026-07-13)
**Última atualização:** 2026-07-09

## COMO USAR ESTA MEMÓRIA

1. Consultar **ANTES** de codar.
2. Este arquivo é só ÍNDICE — uma linha por entrada. Detalhe completo vive nos
   arquivos linkados (`*.md` no mesmo diretório) e em `notas-por-fase-archive.md`.
3. Referência permanente de padrões/Engine/DVFS/build/gotchas V2:
   [padroes-engine-dvfs-build-reference.md](padroes-engine-dvfs-build-reference.md)
4. Codepaths + gotchas por fase (F4-F10 estrutural/auth/search/flow-metrics/reports/channels):
   [codepaths-gotchas-f3-f10.md](codepaths-gotchas-f3-f10.md)
5. Ao concluir uma task: registrar 1 linha aqui + criar/atualizar arquivo de tópico com o
   detalhe. Se este índice passar de ~140 linhas, mover entradas antigas para
   `notas-por-fase-archive.md`.

## CONTEXTO V2 (resumo)

Backend NestJS/TypeScript do **Scrumban-Backend-V2** (refundação canônica sob template
Devari-Core). Stack: NestJS + TS strict + Prisma + PostgreSQL 15 + BullMQ + Redis.
Build: `make build` se houver Makefile, senão `npm run build` (Windows: `make` indisponível,
usar `npm run build` direto). Hook `validate-implementer-build.sh` (SubagentStop) faz
double-check — build DEVE passar antes de retornar.

**Módulos V2 válidos (scope names):** `engine | seeds | endpoints | core | auth | eventos |
entidades | tabelas | classes | common | channels | mcp | webhooks | automation | executions |
flow-metrics | reports | email | permissoes | docs | agents` — NÃO usar `pagamento`.

**Regra absoluta:** Engine (`OperacaoExecucaoClaude`) SOMENTE em DPedido idClasse=-300/-301/-302/-303.
Cadastros estruturais (DEntidade/DTask/DProject/DTabela) usam Service + Prisma + `$transaction`.
Ver detalhe completo em `padroes-engine-dvfs-build-reference.md`.

**Endpoints V2 (128, escopo Scrumban-hoje):** distribuição por fase e contrato HTTP também em
`padroes-engine-dvfs-build-reference.md`.

## ÍNDICE POR TASK (mais recente primeiro)

- [Poda status V3 9→5 (cross-repo back+front)](poda-v3-status-9para5.md) (2026-07-14) — causa raiz = enum do MCP (IA escolhia VALIDATING); fonte única `tasks/constants/task-status.const`; mata divergência overdue.util(concluído) vs phase-metrics(pendente); golden MCP re-baselinado de propósito (count/names intactos = prova); front: FAILED é badge (board 4 colunas) mas ganha `intentionToPill` p/ não sumir na grade; migração NÃO rodada (2 fontes: idStatus + dados.v3.state)
- [Unificação Nexus↔MCP Onda 6 (execute_task no Nexus, gated)](unificacao-nexus-mcp-onda6.md) (2026-07-13) — capability sensível DPedido-300..-303 via ExecutionsService (Pilar 1); feature-flag NEXUS_EXECUTE_TASK_ENABLED default OFF = registro condicional no módulo; MCP intacto (router usa legado, não o adapter); confirm:true no inputSchema (só-Nexus, wire MCP byte-idêntico); manifesto de paridade flag-aware; flag mora em execute-task.flag.ts p/ evitar ciclo módulo↔manifesto
- [Unificação Nexus↔MCP Onda 4 (9 writes so-MCP viram Capabilities)](unificacao-nexus-mcp-onda4.md) (2026-07-12) — 5 caps restantes + wiring module/router; execute_task FORA (Pilar 1); golden intacto; mcp-block-d timeout é flaky pré-existente
- [Unificação Nexus↔MCP Onda 3 (13 reads so-MCP nascem no Nexus)](unificacao-nexus-mcp-onda3.md) (2026-07-12) — resolveToolWithFallback genérico; golden/tools-list (26) INTOCADO nesta onda; adapters da Onda 0 escalam sem replug manual; 2 specs stale da Onda 2 corrigidos
- [Unificação Nexus↔MCP Onda 2 (bidirecionalidade create_comment/list_comments)](unificacao-nexus-mcp-onda2.md) (2026-07-12) — 2 capabilities nascem no MCP; tools/list 24→26 (re-baseline consciente do golden); tool-registry.spec.ts reescrito; scope reusa tasks:write/tasks:read
- [Unificação Nexus↔MCP Onda 1 (piloto create_task)](unificacao-nexus-mcp-onda1.md) (2026-07-12) — Capability neutra + wiring nos 2 adapters; McpCapabilityAdapter como 26º param posicional (aditivo, golden intacto); NexusCapabilityAdapter reusa RoleResolverService.getAllowedMcpScopes
- [Unificação Nexus↔MCP Onda 0 (fundação)](unificacao-nexus-mcp-onda0.md) (2026-07-12) — camada neutra `src/common/tool-capabilities/`, golden test MCP, paridade + manifesto isenções
- [Margem de atraso (DEV-132) — irmã de Pontualidade](margem-atraso-dev132.md) (2026-07-09) — computeStrictDelayForProject reaproveita aggregate() + filtro `> interval '0'`; GET /tasks/projects/:id/delay-margin; useMemo margemAtrasoMetrics (diffDays<=0 excluído); PontualidadeReadout ganhou legendaOverride
- [Pontualidade / margem de atraso — Task 8 F1-F3](punctuality-metrics-task8.md) (2026-07-09) — AVG SQL por projeto (GET /tasks/projects/:projectId/punctuality) + useMemo client-side; completedAt=dados.telemetry.doneAt (JSON), status via JOIN DTabela.idClasse -444/-449; route-order provada via path-to-regexp sem DB
- [Ritmo média móvel — TODAS as fases (Frontend-V2)](ritmo-media-movel-fases1a4.md) (2026-07-09) — KPI Ritmo=janela fixa 28d/dias úteis; limit 100→250 em 3 hooks tasks; PanelRitmo redesenhado em 4 barras semanais (aval CEO); Task 6 completa
- [Refresh Token expiração por tempo](refresh-token-expiry.md) (2026-06-05) — `validate()` retorna `'valid'|'expired'|'invalid'`; `refresh()` trata expired como 401 benigno
- [AI Keys encrypt-at-rest (R-2)](ai-keys-encrypt-at-rest.md) (ADR-V2-064, 2026-06-04) — AES-256-GCM em DTabela -481/-482/-483, auto-migração fire-and-forget de legados
- [AI Multi-Provider Fase5](ai-multi-provider-fase5.md) (ADR-V2-064, 2026-06-04) — CRUD ADMIN-only de chaves por ORG + OrgAdminGuard; DVincula -161 direção idLocEscritu=ORG/idEntidade=USER
- [AI Multi-Provider Fase3](ai-multi-provider-fase3.md) (ADR-V2-064, 2026-06-04) — ClaudeProvider+OpenAiProvider, molde=Gemini
- [AI Multi-Provider Fase2](ai-multi-provider-fase2.md) (ADR-V2-064, 2026-06-04) — AiKeyResolverService cascata user→org→global→env
- [Realtime WebSocket Task6 Fase1](realtime-websocket-fase1.md) (2026-06-04) — módulo `src/realtime/`, WsJwtGuard + RealtimeGateway namespace /realtime
- [Template GLOBAL bypass leitura tasks](notas-por-fase-archive.md) (ADR-V2-061, 2026-06-03) — `isGlobalTemplate` helper cirúrgico em TasksService
- [Remoção Sprint Fase5 SCHEMA+MIGRATION](sprint-removal-fase5-schema-migration.md) (ADR-V2-060, 2026-06-03) — drop idSprint de DTask, migration manual criada
- [Remoção Sprint Fase4 SEED](sprint-removal-fase4-seed.md) (ADR-V2-060, 2026-06-03) — hard-delete DClasse -400 do seed
- [Backfill DTabela passo5](backfill-project-ref-dtabelas-passo5.md) (ADR-V2-058/059, 2026-06-02) — espelha P→E (-158) em DTabela.dEntidadeId
- [PROJECT_REF -158 Fase3 migration+backfill](project-ref-158-fase3-migration-backfill.md) (ADR-V2-058, 2026-06-02) — índice expressão Json + backfill 2-fases idempotente
- [PROJECT_REF -158 Fase1](project-ref-158-fase1.md) (ADR-V2-058, 2026-06-02) — DClasse -158 PROJECT_REF no seed, corrige FK DVincula↔DProject
- [Timer Fase3 coluna timeSpent](tablefields-timespent-fase3.md) (ADR-V2-057, 2026-06-01) — 7ª builtin read-only na grade Blocos
- [Timer Fase2 FRONTEND](timer-frontend-fase2.md) (ADR-V2-057, 2026-06-01) — hook use-task-timer + TaskTimerPanel
- [tableFields FRONTEND Fase1](notas-por-fase-archive.md) (2026-05-31) — leitura read-only colunas custom, GOTCHA harness edits espúrios
- [tableFields FRONTEND Fase2](tablefields-frontend-fase2-edit.md) (2026-05-31) — células custom editáveis via PUT /tasks
- [tableFields Fase6 cobertura spec](tablefields-fase6-spec-coverage.md) (2026-05-31)
- [tableFields Fase3 CRUD schema](notas-por-fase-archive.md) (2026-05-30) — PATCH /projects/:id + validador puro
- [tableFields DTOs Fase2](notas-por-fase-archive.md) (2026-05-30) — column-def.dto.ts, 8 tipos de coluna
- [DProject.tableFields Fase1](tablefields-coluna-dproject-fase1.md) (2026-05-30)
- [Cascade delete órfãs Task1](cascade-delete-orfas-task1.md) (2026-05-30) — default cascade=true em TasksService.delete()
- [assigneeTeamId em DTask](notas-por-fase-archive.md) (2026-05-27) — dados.assigneeTeamId, padrão igual taskType/idBloco
- [Bloco D D5 patch + D5 + D4 + D3 + D2 + D1 (Frontend-V2)](notas-por-fase-archive.md) (2026-05-25) — TaskDetailDrawer, /lists/[id], KanbanBoard conectado, dueDate em DTask
- [ADR-V2-050 Task 2](notas-por-fase-archive.md) (2026-05-22) — POST /tasks aceita idClasse=-200 (fases)
- [ADR-V2-047 Fase 9](f9-v3-flow-telegram.md) — V3 guard + Flow by-Phase + Telegram listener
- [ADR-V2-047 Fase 5](notas-por-fase-archive.md) — CTE recursiva tree+metrics substitui stubs
- [ADR-V2-047 Fase 4](phase-fase4-endpoints.md) — endpoints + filtros idPai/idClasse/depth
- [ADR-V2-047 Fase 3](phase-hierarchy-fase3.md) — PhaseHierarchyService
- [F13 UNPROVISION_PROJECT + Provision Milestone 2](notas-por-fase-archive.md) (2026-05-18) — dispatch fire-and-forget, mutex singleton claude-md-writer
- [F11 MCP Expansion Tasks #1-#7](notas-por-fase-archive.md) — ver `mcp-expansion-task*-gotchas.md`; padrão: append-only no construtor do router
- [F7 Eventos Canônicos](f7-eventos-canonicos.md)
- F8 Flow Metrics+Forecast, F8 Search, F9 Reports PDF, F10 Blocos A/B/C Channels — ver `codepaths-gotchas-f3-f10.md`
- [Etapa 2-4 orphan-workspace](notas-por-fase-archive.md) (2026-05-14) — ver `orphan-*.md`
- [F13 Task#4 multi-project linking](notas-por-fase-archive.md) — AgentsController + ProjectAgentController complementares

## REFERÊNCIA PERMANENTE (movida do índice — 2026-07-14)

O índice passou de 100KB (conteúdo além de ~24KB era DESCARTADO no load). Detalhe
agora vive nos arquivos abaixo — leia-os quando precisar:

- [Codepaths V2 obrigatórios](codepaths-v2-obrigatorios.md) — Engine, seeds, endpoints
  genéricos, core, módulos V2, paths críticos.
- [Padrões / Engine / DVFS / build / gotchas](padroes-engine-dvfs-build-reference.md) —
  21 padrões obrigatórios, 8 anti-padrões, regra "Engine só em DPedido -300..-303",
  chaves DVFS 3-7, build dinâmico, convenção de query, F2/F3, 128 endpoints, output.
- [Codepaths + gotchas F3-F10](codepaths-gotchas-f3-f10.md)
- [Notas por fase (histórico completo)](notas-por-fase-archive.md)
