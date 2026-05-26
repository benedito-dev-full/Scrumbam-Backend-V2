# Changelog — Scrumban-Backend-V2

Todas as mudancas notaveis deste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere a [Semantic Versioning 2.0.0](https://semver.org/lang/pt-BR/).

Tipos de entrada usados: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`, `Performance`, `Tests`.

---

## [Unreleased]

### Added

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
