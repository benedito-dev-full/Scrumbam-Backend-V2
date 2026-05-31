# Implementer Agent Memory — Scrumban-Backend-V2

**Versão:** 2.19 (tableFields DTOs Fase2 — colunas customizáveis 8 tipos — 2026-05-30)
**Última atualização:** 2026-05-30

**Notas por fase:**
- tableFields DTOs Fase2 (colunas customizáveis 8 tipos — 2026-05-30): arquivo `src/tasks/table-fields/column-def.dto.ts` (NÃO em `src/projects/dto/` — plano §4 l.129 manda em tasks/table-fields; mensagem da task sugeria projects/dto, plano venceu). Define `ColumnType`+`COLUMN_TYPES` (8: text/number/date/person/status/checkbox/dropdown/link), `COLUMN_CURRENCIES` (BRL/USD), `ColumnOptionDto {id,label,color?}`, `ColumnConfigDto {currency?,decimals?,maxLength?,options?}`, `ColumnDefDto {key,type,label,order,required?,config?,builtin?}`, `TableFieldsDto {version,columns[]}`. Byte-compatível com front `Scrumbam-Frontend-V2/src/lib/prototype/groups-store.ts` (verificado campo a campo). `key` slug via `@Matches(/^f_[a-z0-9]+$/)` — NÃO BigInt (metadado de coluna). Arrays aninhados: `@ValidateNested({ each: true }) + @Type`. `color` via `@IsHexColor`. Const `readonly` arrays = fonte única (runtime @IsIn + compile-time union). Coluna `DProject.tableFields Json?` JÁ EXISTE (Fase 1 mergeada, schema.prisma l.419 — placeholder `tableFieldsXXX` já corrigido). Unicidade key/order/options.id é Fase 3 (não no DTO). **Gotcha ambiente**: `nest build` FALHA por `@google/generative-ai` ausente (gemini.provider) + banco offline — usar `npx tsc --noEmit` como gate. Baseline tsc: 14 erros pré-existentes (6× tenant-isolation arity, 1× gemini, 5× automation/agents specs arity, 1× ttl-cache spec, 1× execution-run.processor spec) — ZERO novos. **Gotcha harness**: nesta sessão alguns batches de tool outputs vieram agregados/atrasados; o `grep tsc` confirmou ZERO erros no novo arquivo.
- [DProject.tableFields Fase1](tablefields-coluna-dproject-fase1.md) — coluna aditiva p/ colunas customizáveis por Lista; plano c/ line numbers errados, sem @map, banco offline + gemini dep ausente no dev Win.
- [Cascade delete órfãs Task1](cascade-delete-orfas-task1.md) (2026-05-30): `TasksService.delete()` default cascade `isPhase`→`true`; emite `task.deleted` (DEvento -498, já cabeado) nos 2 ramos quando `!isPhase`; `@Query('cascade')` no controller; `scripts/fix-orphan-tasks.sql` (CTE, não-migration, exec manual CEO). Gotcha: `phaseHierarchyMock` precisa ser extraído via `module.get`. Baseline: `nest build` JÁ FALHA por gemini.provider (@google/generative-ai ausente), tsc=14 pré-existentes, 24 specs V3 failed pré-existentes.
- assigneeTeamId em DTask (Fase 1 backend — 2026-05-27): campo `dados.assigneeTeamId` adicionado seguindo padrão idêntico ao `taskType` e `idBloco`. 5 arquivos modificados: 4 DTOs + `tasks.service.ts` (4 pontos: create injeção, update hasDadosMerge+novosDados, findMany filtro JSON-path, buildResponse extração). `assigneeTeamId?: string` em CreateTaskDto; `assigneeTeamId?: string | null` com `@ValidateIf` em UpdateTaskDto (semântica ternária: null remove, string atribui, undefined não toca); `assigneeTeamId?: string` com `@Matches(/^\d+$/)` em ListTasksQueryDto; `assigneeTeamId!: string | null` em TaskResponseDto (campo obrigatório — quebra mocks). **Gotcha mocks Telegram**: novo campo `!:` obrigatório no `TaskResponseDto` quebra 3 specs do Telegram (`create-task.handler.spec`, `status.handler.spec`, `tasks.handler.spec`) — adicionar `assigneeTeamId: null` nos mocks (mesmo padrão de `dueDate: null` D1 e `idClasse: '-154'` ADR-V2-050). **Gotcha isPhase**: o ramo de fases no `create()` pula a injeção de assigneeTeamId naturalmente (o bloco de injeção fica dentro do ramo `else` não-FASE) — logger.warn atualizado para incluir `assigneeTeamId=${!!dto.assigneeTeamId}` na lista de campos ignorados para fases. **Conflito filtro dados**: `where.dados` é sobrescrito quando `idBloco` e `assigneeTeamId` são passados simultaneamente — `assigneeTeamId` tem precedência (último set); documentado em JSDoc; refatoração para AND explícito é trabalho futuro. `npx tsc --noEmit` preserva 13 erros pré-existentes (zero novos); `nest build` PASS.
- Bloco D D5 patch (click task → TaskDetailDrawer — Scrumbam-Frontend-V2 — 2026-05-25): `KanbanBoard` ganhou prop `onSelectTask?: (taskId: string) => void` opcional. Padrão controlado/não-controlado: quando prop fornecida, estado interno `internalSelectedTaskId` não é usado e drawer interno NÃO é renderizado (`!isControlled`); quando omitida, comportamento standalone original preservado. `BoardContent` em `lists/[id]/page.tsx` agora passa `onSelectTask={setSelectedTaskId}` para `KanbanBoard`. `ListContent` recebe `onSelectTask` e passa `onClick={() => onSelectTask(t.id)}` para cada `ListTaskRow`. `ListTaskRow` ganhou `role=button`, `tabIndex=0`, `onKeyDown` (Enter/Space), `cursor-pointer` no className. Página renderiza `<TaskDetailDrawer taskId={selectedTaskId} projectId={id} onClose={() => setSelectedTaskId(null)} />` quando `selectedTaskId !== null`. Commit: `7b7079b`. **Gotcha drawer duplo**: ao usar `onSelectTask` prop no KanbanBoard, o drawer interno deve ser suprimido via `!isControlled` — caso contrário dois DrawerShells são montados simultaneamente (dois overlays, dois painéis direita). `npx tsc --noEmit` ZERO erros.
- Bloco D D5 (/lists/[id] completa — Scrumbam-Frontend-V2 — 2026-05-25): `PageHeader` refatorado — recebe `listData`, `folderData`, `spaceData` (todos `DProjectDto`); renderiza breadcrumb encadeado Space › Folder › List com `<Link>` para `/spaces/{id}` e `/folders/{id}` (Next.js Link, hover via inline style); título real da List + ícone `IcList` envolvido em `<span style={{color,flexShrink,display:"flex"}}>` (IcList NÃO aceita `style` prop diretamente — TS2322). `ViewSwitcher` separado removido; toggle inline no header (`ViewToggleBtn` × 2 dentro de div border com divisor central) usando ícones Lucide `LayoutGrid` + `List`. Botão "Nova Task" abre `QuickCreateTask` (barra inline abaixo do header): `<form>` com `<input>` autoFocused via `useRef + useEffect`, `useCreateTask()` → `mutate({titulo, idProject})`, fecha com `onSuccess` ou `Escape`. View state: `"kanban" | "lista"` (default `"kanban"`, substituiu `"list" | "board"`). Encadeamento `useProject`: `listData?.idPai` → `folderData?.idPai` → `spaceData` — cada hook desabilitado quando `id` é null (TQ query enabled). Commit: `8fc54ea`. **Gotcha IcList**: componente customizado não aceita `style` prop — envolver em `<span style={...}>`. **Gotcha `git add` no Bash tool**: paths com `(app)` precisam de aspas, `git add "src/app/(app)/lists/[id]/page.tsx"` funciona.
- Bloco D D4 (TaskDetailDrawer + débitos D3 — Scrumbam-Frontend-V2 — 2026-05-25): `src/components/tasks/task-detail-drawer.tsx` criado com `DrawerShell` (overlay + painel fixo direita 420px), `EditableTitle` (double-click → input inline), `StatusPicker` (5 colunas Kanban → V3 Intention primária via `COLUMN_TO_INTENTION`), `PriorityPicker` (4 níveis), dueDate `<input type="date">` com `onChange` imediato (PATCH com `null` quando campo limpo), `EditableTextarea` (onBlur). **Débito 1**: `CreateTaskDto.nome→titulo`, `projectId→idProject`, campos alinhados ao backend V2; `UpdateTaskDto` também corrigido (`nome→titulo`, `dueDate?: string | null`, `assigneeId?: string | null`). **Débito 2**: import `SpaceChip` removido de `tasks-view.tsx` (era unused — ESLint já alertava). **Débito 3**: `ListContent` em `lists/[id]/page.tsx` migrado de `useTasksStore(s => s.tasks)` + `agruparPorStatus(tarefas)` para `useTasksByProject(listId)` — view tabular flat simples com colunas título, status, prioridade, vencimento. `GroupBlock`/`TaskRow` legados preservados (ainda necessários para o `CreateTaskModal` que usa `StatusTarefa` legado — remoção é refactor futuro). `KanbanBoard` ganhou `useState<string | null>(selectedTaskId)` + passa `onSelectTask` para `KanbanColumn` → `TaskCard` (agora tem `onClick`, `role=button`, `onKeyDown`). **Gotcha git staging com paths entre parênteses**: no PowerShell, `git add "src/app/(app)/lists/[id]/page.tsx"` com aspas duplas funciona; no Bash tool, o `(` sem aspas quebra. **Gotcha erros pré-existentes**: `dm/[username]/page.tsx` tem 3 erros TS pré-existentes (não relacionados) — baseline preservado, zero erros novos. Commit: `196ce23`.
- Bloco D D3 (KanbanBoard conectado ao backend — Scrumbam-Frontend-V2 — 2026-05-25): `src/hooks/use-tasks.ts` criado com 6 hooks: `useTasksByProject`, `useTask`, `useMyTasks`, `useCreateTask`, `useUpdateTaskStatus`, `useUpdateTask`. `KanbanBoard` substituído integralmente (era dnd-kit + tipos `Tarefa` legados) por versão conectada ao backend — recebe apenas `projectId: string`, usa `useTasksByProject`, agrupa via `intentionToColumn()`, exibe badge "atrasado" via `isOverdue()`, mostra `task.title` e `task.identifier`. `TasksView` migrada de `mockTarefas` para `useMyTasks()`; layout preservado; skeleton novo; sub-rotas `/tasks/in-progress|pending|done` atualizadas para V3 Intentions (`EXECUTING|INBOX|DONE`). `BoardContent` em `lists/[id]/page.tsx` migrado: não lê mais do store Zustand — passa `listId` para `KanbanBoard`. **Gotcha call site**: `BoardContent` recebe props extras (`espacoId`, `onAddTask`, `onOpenTask`) que ficam no signature mas não são usadas internamente (mantidas por compatibilidade com o parent que ainda as passa — remoção é refactor futuro). **Gotcha `git commit` no Bash tool**: sintaxe `"$(cat <<'EOF'...EOF)"` funciona no Bash tool (diferente do PowerShell onde é inválida). `npx tsc --noEmit` ZERO erros novos.
- Bloco D D2 (mapper V3 Intentions — Scrumbam-Frontend-V2 — 2026-05-25): `src/lib/mappers/task-status.mapper.ts` criado com `KANBAN_COLUMNS` (5 colunas), `intentionToColumn()` cobrindo 9 V3 Intentions, `isOverdue()` com guard de estados terminais, `getColumnConfig()`, `priorityToLabel()` e `priorityToColor()`. `TaskResponseDto` em `src/lib/types/api.ts` atualizado: `V3Intention` type novo (9 states canônicos), `TaskStatus` deprecated (alias para V3Intention p/ compatibilidade), campos novos `title`, `description?`, `statusId`, `priorityId?`, `idPai?`, `dueDate?: string | null`, `idClasse`. **Gotcha duplicação**: a edição com `old_string` contendo `CreateTaskDto`/`UpdateTaskDto`/`TaskFilters` NÃO remove o bloco original — precisa de 2a edição explícita para remover o bloco legado restante. `npx tsc --noEmit` ZERO errors. Projeto frontend: `Scrumbam-Frontend-V2` (caminho Win: `C:\Users\Benedito\Documents\Visual Studio Code\Scrumbam\Scrumbam-Frontend-V2`). `git commit` em PowerShell: usar here-string `@'...'@` (NÃO `"$(cat <<'EOF')"` — sintaxe bash inválida em PS). Hook `MEMORY.md` do implementer fica em `Scrumbam-Backend-V2/.claude/agent-memory/implementer/` (mesmo quando trabalhando no frontend).
- Bloco D D1 (dueDate em DTask — 2026-05-25): campo `dueDate DateTime? @db.Timestamptz(6)` adicionado diretamente em DTask (coluna tipada, NÃO em `dados` JSON — permite índice parcial + range scans). Migration SQL manual (banco inacessível no Win dev) + `npx prisma generate` p/ regenerar client. Índice parcial `WHERE excluido=false AND dueDate IS NOT NULL` via SQL manual (Prisma não suporta índice parcial nativo). `TimezoneService` já exportado por `CommonModule @Global()` — injetável direto no `TasksService` sem modificar `TasksModule`. `getPeriodDates('today')` retorna `{ gte: Date, lte: Date }` (NÃO `{ start, end }`). Semântica ternária no update: `undefined`=não toca, `null`=remove, `string`=nova data (mesmo padrão de `idPai`). Filtros: `dueDateToday=true` → `getPeriodDates('today')`; `dueDateFrom/To` → `{ gte, lte }` inline. **Gotcha campo obrigatório nos mocks**: `dueDate!: string | null` no `TaskResponseDto` quebra specs Telegram (create-task, status, tasks handler) — adicionar `dueDate: null` nos mocks (mesmo padrão de `idClasse: '-154'` em ADR-V2-050). **Gotcha @Allow(null)**: `@Allow(null)` lança TS2345 (argumento `null` não aceito). Para permitir null com `@ValidateIf`, basta `@IsOptional() + @ValidateIf((o) => o.field !== null) + @IsISO8601()` — sem `@Allow`. `nest build` PASS; `npx tsc --noEmit` preserva 13 erros pré-existentes (7 originais + 6 arity agents/tenant-isolation).
- ADR-V2-050 Task 2 (POST /tasks aceita idClasse=-200 — criar fase via HTTP — 2026-05-22): mudança aditiva pura. `CreateTaskDto.idClasse?` whitelist `['-154','-200']` default `'-154'`. `TasksService.create()` ramifica `isPhase`: pula `identifierService.getNextIdentifier()` (sequence DEV-N intacta), pula INBOX lookup, pula `resolvePriorityId()`, ignora silenciosamente assignee/sprint/priority/taskType com `logger.warn` (`create_phase_ignored_fields`), persiste `dados = { kind: 'phase', createdBy }` via helper top-level `buildPhaseDados()` (separado de `buildInitialTaskDados` para não poluir schema V3). Sub-fase exige `paiExiste.idClasse === ID_CLASSE_PHASE` (400 BadRequest se TASK). Reuso integral do emit `phase.created` que já existia em `tasks.service.ts:251`. `TaskResponseDto.idClasse!: string` NOVO campo obrigatório (frontend distingue TASK vs PHASE). Constante `ID_CLASSE_TASK` renomeada `_ID_CLASSE_TASK` + `void _ID_CLASSE_TASK` para evitar TS6133 sem perder doc semântica (eslint-disable-next-line NÃO suprime TS compiler). **Gotcha crítico tipos**: ao introduzir `let dadosPayload: Record<string, unknown>`, TS reclama TaskDados não atribuível (missing index signature) — usar `let dadosPayload: unknown` + cast final via `Prisma.InputJsonValue`. **Gotcha specs**: novo `idClasse!: string` obrigatório no DTO quebra 3 specs do Telegram (`create-task.handler.spec`, `status.handler.spec`, `tasks.handler.spec`) que constroem TaskResponseDto inline — adicionar `idClasse: '-154'` aos mocks. **Gotcha jest testRegex**: arquivos `.e2e-spec.ts` (com hífen) NÃO são pegos; usar `.e2e.spec.ts` (com ponto) ou apenas `.spec.ts`. **Gotcha ValidationPipe message**: ao testar @IsIn rejection, NestJS empacota em "Bad Request Exception" genérica — usar `toThrow(BadRequestException)` + `class-validator.validate()` direto para validar mensagem. 10 unit tests + 6 e2e tests novos, todos passando. Baseline tasks.service.spec.ts (24 failed pré-existentes, 65 passed) intacto. 7 TS errors pré-existentes preservados. ADR-V2-050 criado (NÃO 049 — já usado pelo Telegram listener). 487/511 tests passing na sweep ampla (tasks+telegram+mcp+flow-metrics).
- ADR-V2-047 Fase 9 (V3 guard + Flow by-Phase + Telegram listener): ver `f9-v3-flow-telegram.md`. **REUSO de `-494 TELEGRAM_MSG_OUT`** (já no seed F1) em vez de criar nova DClasse — ADR-V2-049 documenta. F9a: `tasks.service.ts:updateStatus` lança `BadRequestException` quando `task.idClasse === -200` (ADR-V2-048). F9b: `PhaseDescendantsService` (CTE recursiva igual ao `PhaseMetricsService.computeRecursive`) + `ByPhaseResolverService` (resolve phaseId → projectId+taskIds com tenant scope via `dTask.project.idEstab`). 6 endpoints novos `GET /flow-metrics/by-phase/:phaseId/<metric>` reusando services existentes — cada `calculate()` ganha `taskIdsFilter?: bigint[]` opcional retro-compat (`undefined` = sem filtro; `[]` = resposta zerada sem hit; `bigint[]` = `chave: { in: ... }`). **Throughput case**: refatorei o duplo branch day/week em um único `Prisma.sql` template com `truncUnit` variável; filtros condicionais via `Prisma.empty` + `Prisma.join(bigint[])` (NÃO interpolar string). F9c: `TelegramNotificationConsumer` em `src/channels/telegram/` implementa `IEventConsumer` + `OnModuleInit` — **auto-registra** via novo `EventRouterService.registerConsumer(match, consumer)` (método novo, simétrico a `registerWebhookListener`). EventosModule é `@Global()` então EventRouter é injetável em qualquer módulo sem import circular. Idempotência via `identificadorExterno = ${correlationId}:${event.type}:${recipientId}` em DEvento -494 (mesma DClasse de `telegram.message.out` no audit-log). Timeout 3s via `Promise.race` — não propaga; vira DEvento com `error='timeout'`. Token ausente / no_chat_link / timeout / no_org / sucesso são todos persistidos em DEvento -494 com `metaDados.success` + opcional `error`. Recipients v1: `idCreator` + `idAssignee` das **filhas DIRETAS** (não recursivo, decisão consciente). Intersect com org-membership via DVincula (1 query batch). `phase.completed` adicionado em `notification-triggers.const.ts`. Spec do TelegramNotificationConsumer usa `jest.useFakeTimers + advanceTimersByTimeAsync(3001)` para testar timeout. **Quebrei e corrigi 1 teste F8 pré-existente** ("PHASE não dispara phase.completed"): agora espera `BadRequestException` (semântica reforçada). ZERO mudança em seed/hooks/workspace. 65 testes verdes em `tasks.service.spec.ts` (era 64 baseline, +1 novo F9a); 24 falhas pré-existentes mantidas. 188 testes verdes nos specs F9-related (40 retro-compat flow-metrics + 35 novos por feature). 7 TS errors pré-existentes preservados. Build NestJS PASS.
- ADR-V2-047 Fase 5 (CTE recursiva tree + metrics — services reais): `PhaseTreeService.buildTree` e `PhaseMetricsService.compute` substituem stubs com `$queryRaw` template-tag (NUNCA `$queryRawUnsafe`). Padrão crítico: (1) pré-query `findUnique` extrai `idProject` da raiz como defense-in-depth — filtra cross-project no anchor E no passo recursivo da CTE; (2) guardrail `depth < 20` HARDCODED no SQL (PostgreSQL não aceita placeholder em literal de comparação); (3) lookup de status via `LEFT JOIN "DTabela" s ON s.chave = t."idStatus"` agrupando por `s."idClasse"` contra `-444 DONE / -445 FAILED / -443 EXECUTING / -441,-442,-448,-449 PENDING / -446,-447 EXCLUÍDOS de total`; NÃO hardcoda `idStatus` direto — DTabela tem chave POSITIVA criada em runtime por projeto, idClasse NEGATIVA é a estável. `includeMetrics=true` em `/tree`: 2ª CTE única agregando por `phase_root` (`CASE WHEN idClasse=-200 THEN chave`) — ZERO N+1 vs loop chamando compute(). `total === 0` → `percent = 0` explícito (sem NaN). `Number(row.X ?? 0)` para BigInt→number (counts cabem em MAX_SAFE_INTEGER). Cast SQL `chave::text`, `depth::int` no SELECT final do tree. ORDER BY depth ASC garante que pais aparecem antes de filhos no Map de montagem. Constantes idClasse interpoladas via `${PHASE_IDCLASSE}` etc. (template tag parametriza), mas literais negativos em `NOT IN (-446, -447)` ficam inline no SQL (FILTER clause precisa de literal). Spec do controller F4: removido bloco "Stubs PhaseTreeService/Metrics" (linhas 205-220 originais); demais testes preservados (continuam mockando services). Specs novos: `phase-metrics.service.spec.ts` (10 testes) + `phase-tree.service.spec.ts` (15 testes). Detecção de template tag em mocks: `prisma.$queryRaw.mock.calls[0][0]` é `TemplateStringsArray` (Array.isArray=true e .raw=defined); values interpolados em `mock.calls[0].slice(1)`. 50→75 testes verdes em `tasks/.*phase|services/__tests__/phase`. 7 TS errors pré-existentes preservados; 24 falhas pré-existentes em `tasks.service.spec.ts` mantidas (não tocadas).
- ADR-V2-047 Fase 4 (endpoints + filtros idPai/idClasse/depth): ver `phase-fase4-endpoints.md`. `ListTasksQueryDto` ganha 3 campos com `@Matches` regex (`idPai` aceita `"null"` literal). `TasksService.findMany` aceita filtros hierárquicos; quando `depth >= 2`, dispara CTE recursiva via `$queryRaw` (1 query extra, ZERO N+1) com `Math.min(depth, 20) - 1` no LIMIT e guardrail hardcoded `d.depth < 20`. 2 endpoints novos: `GET /tasks/:id/tree` e `GET /tasks/:id/metrics` — ambos delegam para **stubs Fase 4** (`PhaseTreeService.buildTree` / `PhaseMetricsService.compute` lançam `NotImplementedException` → HTTP 501) prontos para F5 substituir só o corpo. Tenant gate via `tasksService.findOne(id, allowed)` ANTES do service garante 404 anti-enumeration mesmo nos stubs. Endpoints `/:id/tree` e `/:id/metrics` DEVEM ficar antes do `/:id` genérico (ordem NestJS). Combinação cursor + depth>=2: merge `{ ...where.chave, in: descendantIds }` (NÃO sobrescrever). `PrismaService` injetado nos stubs com `void this._prisma` (marker p/ F5; sem TS6133). 28 testes novos passando (16 service + 12 controller); baseline `tasks.service.spec.ts` mantido (24 failed pré-existentes); 7 TS errors pré-existentes preservados.
- ADR-V2-047 Fase 3 (PhaseHierarchyService): ver `phase-hierarchy-fase3.md`. Service novo `src/tasks/services/phase-hierarchy.service.ts` com 3 metodos (`validateNoCycle`, `validateProjectConsistency`, `softDeleteCascade`). MAX_PHASE_DEPTH via env (default 20). CTE recursiva com guardrail hardcoded `depth < 20` (PG nao aceita placeholder em literal). No `create`, `validateNoCycle` recebe `taskId=BigInt(0)` como sentinela (chave nunca colide com BIGSERIAL real). `TasksService.delete` agora retorna `{ affected: number }` (era `void`); default cascade=true para idClasse=-200 PHASE, false caso contrario. TasksService constructor ganhou 5o arg — atualizar todos os `new TasksService(...)` em specs + TODOS os `Test.createTestingModule` (havia 1 spec inline "DEV-1 a DEV-10" alem do beforeEach principal). 24 testes novos passando; baseline tasks.service.spec.ts mantido (24 failed pre-existentes nao tocados). 7 TS errors pre-existentes preservados.
- F13 UNPROVISION_PROJECT fire-and-forget (2026-05-18): `ProjectAgentLinkService.unlinkAgent` agora dispara `UNPROVISION_PROJECT` pós-transaction via `void this.dispatchUnprovisionFireAndForget(...)`. Padrão: (1) capturar `metaDados` do link dentro da transaction com `select: { chave, metaDados }` e extrair `projectSlug` para variável closure; (2) após $transaction commitada, buscar agent runtime (`dEntidade.findFirst` por `agentId`) e chamar `remoteClient.dispatch('UNPROVISION_PROJECT', { projectSlug }, { agent })`. Falha = apenas `logger.warn`, nunca relança. `RemoteCommandType` em `remote-execution-client.ts` ganhou `UNPROVISION_PROJECT` na union. Spec do service atualizado: `RemoteExecutionClient` injetado como 4º argumento no constructor mock. Erros pré-existentes nos outros specs (arity 7→8 em agents-heartbeat/install/projects/execution-result) são pre-existing, não relacionados à mudança.
- F13 Provision Milestone 2 (claude-md-writer + UNPROVISION_PROJECT): `claude-md-writer.ts` em `agent/src/claude-code/` — mutex singleton `const locks = new Map<string, Promise<void>>()` no topo do módulo (NÃO instanciar por chamada). `upsertProjectEntry`: se seção `## <slug>` existir, atualiza apenas `- Caminho:` via regex `replace` (preserva outras linhas); se não existir, appenda nova seção. `removeProjectEntry`: remove seção inteira até próximo `##` ou EOF; idempotente (ENOENT → string vazia → return). Handler provision é SÍNCRONO — fire-and-forget via `void promise.catch(...)` APÓS `res.status(200).json(...)`. `UNPROVISION_PROJECT` novo type no dispatcher (6 tipos total — `toHaveLength(6)` obrigatório). Ao expandir `SUPPORTED_TYPES`, atualizar TAMBÉM o `expect.arrayContaining(...)` no teste de MISSING_TYPE. `unprovisionProjectHandler` usa `.then().catch()` (não `async` express handler) — consistente com padrão dos outros handlers do dispatcher. 160 → 175 testes passando (+15 novos).
- F11 MCP Expansion Task #4 (`search_tasks`): tool read-only com adaptador `searchForMcp` no SearchService. `SearchModule` NÃO exportava `SearchService` — adicionar `exports: [SearchService]` antes de importar no McpModule. `searchForMcp` aceita `accessibleProjectIds: string[]` (já resolvidos pela tool) e faz 1 query `dTask.findMany` com `idProject IN (bigints)` + include `project.{ chave, nome }` — ZERO N+1. Anti-enumeration: quando `projectId` não está em `accessibleIds`, lançar `invalidParams('projectId', 'projeto não acessível')` (mesma mensagem independente do projeto existir ou não). Early return quando `accessibleIds` vazio (não chamar searchService). Retorno: `{ tasks: TaskSearchResultDto[], total: number, q }` (apenas tasks, sem projects/people). Padrão: `searchTasksTool` inserido ANTES do `configService` no constructor do router (configService SEMPRE último). 13→14 tools; 124→133 testes passando (+9 nos specs de search_tasks).
- F11 MCP Expansion Task #3 (notifications batch — `list_notifications`, `update_notification`, `get_unread_count`): 3 tools simples sem gate de tenant (notificações são escopadas por `dEntidadeId` nativamente no service). `NotificationsService.findMany` recebe `ListNotificationsQueryDto` onde `unreadOnly` é `string` ('true'/'false') — no MCP chega como `boolean`, converter antes de passar. `optionalLimit` já disponível em `tool-params.ts` — INVALID_PARAMS para valores fora 1-50 (não faz clamping). `delete` existe como método público no NotificationsService (soft-delete via `updateMany` + `excluido: true`). `mark_all_read` ignora `notificationId` sem erro. Importar `NotificationsModule` no `McpModule.imports` (NotificationsModule já exporta NotificationsService). 10→13 tools; 112→124 testes passando (+12 nos specs de notificações).
- F11 MCP Expansion Task #7 (`update_project`): tool de escrita com semântica ternária de `teamId` (ausente=manter, null=desvincular, string=novo time). `parseOptionalTeamId` usa `'teamId' in input` (não `!== undefined`) para distinguir ausência de null explícito — mesmo padrão de `'teamId' in dto` no service. `parseOptionalBoolean` rejeita string/number (INVALID_PARAMS) — importante para `automationEnabled: false` (falsy mas válido). NÃO passa `organizationId` para o service (MCP é cross-org). ForbiddenException/NotFoundException propagam sem try/catch (router captura). Ao adicionar nova tool: atualizar (1) tools.schema.json, (2) mcp.module.ts providers, (3) mcp-router.service.ts constructor + tools[], (4) mcp-tools.schema-consistency.spec.ts buildRegisteredTools(), (5) mcp-block-d.spec.ts length assertion + name list. configService SEMPRE último no constructor do router — adicionar nova tool ANTES dele e adicionar `undefined` nos 2 testes do mcp-block-d que passam configService explicitamente. 9→10 tools; 99→112 testes passando.
- F11 MCP Expansion Task #1 (`get_task`): ver `mcp-expansion-task1-gotchas.md` — append-only no construtor do router (configService SEMPRE último), 2 testes em `mcp-block-d.spec.ts` ganham 1 `undefined` a cada nova tool, `schema-consistency.spec.ts` salvaguarda drift JSON↔classe; `McpUserContext` NÃO tem organizationId; NotFoundException/ForbiddenException propagam como exception (use `rejects.toThrow` em specs, não `result.error`).
- F11 MCP Expansion Task #2 (`update_task`): ver `mcp-expansion-task2-gotchas.md` — UMA tool orquestra 3 métodos do TasksService (`update` → `updateSprint` → `updateStatus` → `findOne` para snapshot final). `accessibleProjectIds` resolvido UMA vez e propagado para todas as calls. `assigneeId === null` no MCP traduz para `''` no DTO (semântica "limpar"). `priority === null` permitido para limpar. `anyOf` no schema documenta mas handler precisa enforcement próprio (`at least one field to update`). 17 testes; total MCP 78 passing.
- F11 MCP Expansion Task #5 (`list_members`): ver `mcp-expansion-task5-gotchas.md` — `ProjectMembersService.getMembers(projectId)` NÃO aceita `accessibleProjectIds` (legacy HTTP signature). Tenant gate fica na própria tool: resolver `accessibleProjectIds` → checar `includes(projectId)` → senão NotFoundException com mensagem idêntica (anti enumeration). Padrão "gate na tool" reaplicável para Tasks #6/#7/#8. 7→8 tools; 78→87 testes.
- F11 MCP Expansion Task #6 (`get_project`): ver `mcp-expansion-task6-gotchas.md` — UMA tool com `include[]` opcional (`members` | `sprints` | `stats`); sem include retorna só projeto base. Composição condicional do payload (NUNCA setar key com `undefined`). `getStats` chama `findOne` internamente — duplo gate aceitável. `tool-params.ts` NÃO tem helper p/ string array — validar inline com `Array.isArray` + `Set`. Test de paralelização via `callOrder` + `setImmediate` (assertion: todos `:start` antes de qualquer `:end`). Sprints via `tabelaService.listarPorClasse({ idClasse: '-400', dEntidadeId: projectId, pageSize: 20 })` (primeira página, sem cursor — paginação delegada à `list_sprints`). 8→9 tools; 87→99 testes (+12). `activity` adiado.
- F7 Eventos Canônicos: ver `f7-eventos-canonicos.md` (CommonModule Global, EventProducer pattern, Engine isolation via type-only import).
- F8 Flow Metrics + Forecast: ver gotchas abaixo (ThroughputService $queryRaw, CFD sem idProject, WipAgeService OnModuleInit).
- F8 Task#2 Search: queryPeople via DVincula (NÃO idEstab). Ver gotchas abaixo.
- F9 Bloco X Reports PDF: gotchas abaixo (pdfkit import, Promise.allSettled, cache payload vs buffer).
- F10 Bloco A Core Channels: gotchas abaixo (DVincula.metaDados vs DTabela.dados, busca de token por hash).
- F10 Bloco B Telegram Webhook: gotchas abaixo (ioredis SET NX sintaxe, fetch nativo multipart, @types/supertest ausente).
- F10 Bloco C Telegram Commands: gotchas abaixo (DProject sem idCreator, filtro de data em memória, var TS6133 em specs).
- F13 Cliente Sub-tarefa 5 (agent/ autossh wrapper + lifecycle): wrapper modular do `autossh` (não inline como no legado) — reconnect com backoff exponencial próprio + circuit breaker 5 crashes/60s → pausa 5min (legado entraria em flap loop dependendo só de systemd `Restart=always`); `isHealthy()` exposto p/ heartbeat; `lifecycle/shutdown.ts` ordena heartbeat → server → autossh → exit (autossh por último para drenar in-flight requests). Testes com fake clock + mock de spawn — 17 specs (84/84 total). Gotcha: backoff capeado em maxBackoffMs faz que respawns dentro da janela `crashWindowMs` empilhem timers; ao testar circuit breaker, NÃO faça tick após o crash que abre o circuito (o circuitTimer fica pendente). Decisão: spawn lançando síncrono (ENOENT) entra no MESMO flow de crash — não fail-fast no bootstrap (circuit breaker já protege).
- F13 Cliente Sub-tarefa 6 (install.sh + systemd + CLAUDE.md template): ver `agent_install_gotchas.md` (distribuição OPÇÃO C bundle-relative, `claudeMdPath` em `/root/.claude/CLAUDE.md`, idempotência forte sem `--reinstall`, EnvironmentFile do systemd carrega `ANTHROPIC_API_KEY` de `/etc/scrumban-agent/environment` 0600). ATENÇÃO: pasta `.claude/` dentro de `agent/` é PROIBIDA — toda memória do Implementer vive em `<repo-root>/.claude/agent-memory/implementer/`. `agent/.gitignore` ignora `.claude/` defensivamente.
- F13 Cliente Sub-tarefa 1 (agent/ scaffolding): coexistência ESLint do agent com flat config raiz — ver `agent-monorepo-eslint-coexistence.md`. Resumo: agent/ usa ESLint v9 + flat config local; root adicionou `agent/**` em ignores. PostToolUse hook valida cada arquivo via `cd dir_do_package_json && npx eslint <file>`, então subprojetos precisam de config próprio para evitar warning "File ignored". `node_modules` e `dist` do agent já cobertos pelo `.gitignore` raiz (`**/node_modules`, `dist/`).
- Etapa 4 orphan-workspace (2026-05-14): ver `orphan-pending-invites-etapa4.md` — endpoint `GET /auth/pending-invites` para empty state de user órfão; DTO `PendingInviteForMeDto` em `src/auth/dto/` com 5 campos (`inviteId, orgId, orgName, role, expiresAt` — ZERO leak de `tokenHash/flow/targetUserId/invitedByUserId/email`); método `listPendingInvitesForEmail(email)` em `InvitesService` (2 queries Prisma — `dTabela.findMany` por email + `dEntidade.findMany` IN batch para resolver orgName, ZERO N+1 — `DTabela` NÃO tem relation Prisma para `locEscrituracao`, apenas o escalar `idLocEscrituracao`); circular dep recíproca `AuthModule↔InvitesModule` resolvida com `forwardRef(() => InvitesModule)` no AuthModule.imports + `@Inject(forwardRef(() => InvitesService))` no constructor do AuthController; Logger novo no AuthController; `@AllowOrphan()` libera a rota para órfãos. 8 specs novos (PENDING ok / EXPIRED / expiresAt-passado / ACCEPTED via usedAt / REVOKED / org soft-deleted / lowercase normalization / batch IN dedupe / whitelist sanitização). Gotcha hook: PostToolUse:Edit ESLint trava em qualquer Edit que deixe import não-usado — usar `// eslint-disable-next-line @typescript-eslint/no-unused-vars` como ponte temporária ou agrupar imports+uso num único Edit. Em testes: cast `as unknown as Record<string, unknown>` quando precisar acessar `Object.keys` de DTO (TS2352 bloqueia cast direto).
- Etapa 3 orphan-workspace (2026-05-14): ver `orphan-login-etapa3.md` — `login`/`refresh`/`issueSessionForUser` agora aceitam user sem DVincula e emitem JWT órfão; `getMe()` retorna `isOrphan: boolean` (derivado de `availableOrgs.length === 0`); `UserProfileDto.isOrphan` obrigatório; metaDados do DEvento -501 ganha `orphan: true` (spread condicional, false não serializa); `switch-org` migrou de `JwtAuthGuard` para `AuthCompositeGuard` (carryover M1 da Etapa 2 — `@AllowOrphan` agora é load-bearing ali). Gotcha: `tsconfig.build.json` exclui specs, mas `ts-jest` não — sempre rodar `npx jest` em TODA suite ao tocar DTO obrigatório (TS2741 em mocks inline). Pre-existing failures em `tasks` + `automation` + `ttl-cache` confirmados via `git stash` (commits `5b510c4`).
- Etapa 2 orphan-workspace (2026-05-14): ver `orphan-jwt-allow-orphan-guard.md` — `RequireWorkspaceGuard` injetado no `AuthCompositeGuard` (NÃO APP_GUARD global, pois `AuthCompositeGuard` é route-level via `@UseGuards`, e APP_GUARDs rodam ANTES); `OrgTenantGuard`/`RolesGuard` relaxados para órfão (retornam true ou 403 NO_WORKSPACE); `JwtStrategy.validate` aceita payload sem `organizationId` sem consultar DVincula; `@AllowOrphan()` aplicado em `/auth/me`, `/auth/logout`, `/auth/switch-org`. ADR-V2-040 in-flight (formalização na Etapa 5).
- F13 Task#4 Sub-tarefas 4.3+4.4 (multi-project linking): novos endpoints `POST /agents/:id/projects`, `DELETE /agents/:id/projects/:projectId`, `GET /agents/:id/projects` em `AgentsController`. Já existia `ProjectAgentController` em `/projects/:id/agent` para visão project→agent — endpoints NÃO conflitam (visões inversas; semântica complementar). DVincula -185 é N:N nativo (idLocEscritu=projectId, idEntidade=agentId). Idempotência via check explícito (`findFirst` antes de `create`) sem unique constraint nova (ADR-V2-001). Schema: DVincula usa `metaDados` (não `dados`). RBAC helper privado `requireProjectManagerOrOrgAdmin` replicado de `AgentInstallTokenService` para isolamento de escopo (DRY descartado para não tocar 3 arquivos). `RoleResolverService` injetado no constructor de `AgentsService` — atualizar mocks dos 3 specs existentes (`agents-install`, `agents-heartbeat`, `execution-result.service`). Eventos `agent.project.linked/unlinked` via EventProducerService. PostToolUse:Edit ESLint hook trava em imports ainda não usados — ao adicionar import + endpoint que o consome, agrupar tudo no MESMO Edit (helper privado, body novo, controller handler tudo junto).

---

## INSTRUÇÕES DE USO

- Consultar **ANTES** de codar
- Registrar codepaths, gotchas, padrões após cada task
- Limite ~200 linhas; acima, mover histórico para `agent-memory/implementer/<topic>.md`

---

## CONTEXTO V2

Você implementa código backend NestJS/TypeScript para o **Scrumban-Backend-V2**, refundação canônica do Scrumban legado sob template Devari-Core.

**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Stack:** NestJS + TypeScript strict + Prisma + PostgreSQL 15 + BullMQ + Redis
**Build command:** detectar (`make build` se Makefile, senão `npm run build`)
**Hook double-check:** `validate-implementer-build.sh` (SubagentStop) — build DEVE passar antes de retornar.

---

## CODEPATHS V2 OBRIGATÓRIOS

### Engine (Pilar 1 — F6)
- `src/engine/lib/operacao/Operacao.ts` — base abstract: `nova()`, sequence key via PostgreSQL (`nextval`), lifecycle, `erro()`
- `src/engine/lib/operacao/OperacaoPedido.ts` — full workflow (calcula, aprova, grava + scripts DVFS)
- `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` — **V2 ÚNICO Engine** (estende OperacaoPedido; ADR-V2-005)
- `src/engine/lib/dvfs/` — scripts de cálculo (chaves 3, 4, 5, 6, 7)

**Hierarquia OOP** (do Devari-Core):
```
Operacao (abstract)
  ├─ OperacaoPedido (full)
  │   ├─ OperacaoBaixa (não usada V2)
  │   ├─ OperacaoSaque, OperacaoAntecipacao (Dinpayz, não V2)
  │   └─ **OperacaoExecucaoClaude (V2)** ← AQUI estende
  ├─ OperacaoMovDisponivel (não V2)
  └─ OperacaoMovDeposito (não V2)
```

### Endpoints Genéricos (Pilar 2 — F2)
- `src/entidades/entidade.controller.ts` — `GET /entidades?idClasse=X` (DEntidade)
- `src/entidades/entidade.service.ts` — métodos centralizados (`getEntidadeIdFromUserGroup`)
- `src/tabelas/tabela.controller.ts` — `GET /tabelas?classe=X` (DTabela)
- `src/classes/classe.controller.ts` — `GET /classes` (DClasse)

### Seeds (Pilar 3 — F1)
- `templates/classes-base-template.ts` — ~50 fixas (range -1..-110), INTOCADAS
- `prisma/seeds/classes.seed.ts` — spread fixas + ~70 V2-específicas (range -150..-529)
- `prisma/seeds/seed-runner.ts` — entrypoint `prisma db seed`
- `prisma/seeds/dvfs.seed.ts` — scripts DVFS (chaves 3-7) para `OperacaoExecucaoClaude`

### Core
- `src/prisma.service.ts` — extends PrismaClient (NUNCA usar DatabaseService — deprecated)
- `src/common/services/timezone.service.ts` — TODAS filtros de data (`applyDateFilters`, `getPeriodDates`) [F4 ✓]
- `src/common/services/correlation-id.service.ts` — AsyncLocalStorage por request (X-Correlation-Id) [F4 ✓]
- `src/common/services/audit.service.ts` — stub MVP INSERT em DEvento idClasse=-501 [F4 ✓]
- `src/common/middlewares/correlation-id.middleware.ts` — gera/lê X-Correlation-Id [F4 ✓]
- `src/common/interceptors/logging.interceptor.ts` — loga method/path/status/ms [F4 ✓]
- `src/common/filters/http-exception.filter.ts` — padroniza 4xx/5xx com correlationId [F4 ✓]
- `src/common/health/` — checkDb/checkRedis/checkEmail, GET /health público [F4 ✓]
- `src/email/` — EmailModule: SMTP/SendGrid/Resend + 4 templates + AuditService [F4 ✓]
- `src/eventos/core/event-producer.service.ts` — emitir DEvento APÓS persistência

### Codepaths F5
- `src/organizations/` — OrganizationsModule (DEntidade -152 + DVincula -161/-162/-163)
- `src/teams/` — TeamsModule (DEntidade -180 + DVincula -181 + DTabela -475)
- `src/sprints/` — ZERO controller TS; apenas README.md + sprints.module.ts
- `src/workflow-statuses/` — WorkflowStatusesModule (apenas seedDefaults + README)
- `src/projects/` — ProjectsModule (DProject + DVincula -171/-172/-173 + SeedBootstrap)
- `src/tasks/` — TasksModule (DTask + V3 Intentions + identifier atômico DEV-N + state machine)

### Gotchas F4 — Priority DTabela (Task 01 fix 2026-05-12, ADR-V2-034)
- **Priority segue padrão Status V3**: DTabela escopada por projeto (`dEntidadeId=projectId`), idClasse -421..-424. Cada projeto novo precisa das 4 DTabelas via `SeedBootstrapService.seedPrioritiesIfMissing`. Backfill standalone em `prisma/scripts/backfill-priority-tabelas.ts` cobre projetos legados.
- **Helpers em tasks.service.ts**: `resolvePriorityId` (enum→chave), `buildPriorityMap` (batch lookup ZERO N+1), `mapPriorityEnum` (BigInt→enum string), `buildResponse(task, priorityMap?)` (priorityMap opcional para listas).
- **DTOs alinhados com seed**: `CRITICAL` → `URGENT`. Frontend e legado usam URGENT. Sem migration.
- **Update semântica**: `undefined`=não toca, `null`=limpa, `string`=resolve. `priority: string | null` no DTO.
- **Fallback silencioso**: DTabela ausente → `logger.warn` + `null` (não BadRequest). Operador roda backfill.
- **`eslint.config.js` precisa de glob explícito**: `prisma/scripts/**/*.ts` adicionado (junto com `prisma/seeds/**/*.ts`). Sem isso, ESLint ignora e hook bloqueia com warning "File ignored".
- **Hook PostToolUse:Edit dispara ESLint a cada Edit** — ao adicionar `const X = ...` que será usado em Edit subsequente, agrupar a declaração + primeiro uso na mesma Edit. Caso contrário `@typescript-eslint/no-unused-vars` bloqueia.

### Codepaths F6 Task 2 (ExecutionsModule)
- `src/executions/executions.service.ts` — execute() com Engine completo + decisão LOW/MEDIUM/HIGH
- `src/executions/approval-flow.service.ts` — approve() race-safe ($executeRaw) + reject() + rollback()
- `src/executions/approval-flow-sweeper.service.ts` — @Cron EVERY_MINUTE expira awaiting_approval
- `src/executions/execution-history.service.ts` — findMany() cursor pagination ZERO N+1
- `src/executions/claude-runner.service.ts` — STUB F6 (STUB_CLAUDE_FAIL=true para falha)
- `src/executions/guards/execution-access.guard.ts` — membership + ADMIN para approve/reject/rollback
- `src/executions/guards/execution-throttler.guard.ts` — 30 req/min SHA-256(projectId)
- `src/executions/executions.controller.ts` — 8 endpoints Swagger 100%
- `src/engine/dvfs/__tests__/risk-gate-adversarial.spec.ts` — 58 cenários adversariais

### Gotchas F6 (Engine + OperacaoExecucaoClaude)
- **`private readonly logger` em subclasse de Engine** — NÃO redeclarar `logger` como `private` em `OperacaoExecucaoClaude`. `Operacao.ts` já declara `protected readonly logger`. Redeclarar como `private` causa TS2415 (`incorrectly extends base class`). Usar `this.logger` herdado.
- **Scripts DVFS chave=7 no seed** — combinar `pr-auto-open.js` + `notification-dispatcher.js` em wrapper async: `(async function (op) { await prAutoOpen(op); await notificationDispatcher(op); })`. Cada script é uma `async function` nomeada.
- **`dvfs.seed.ts` path relativo** — usar `path.join(__dirname, '..', '..', 'src', 'engine', 'dvfs')` (de `prisma/seeds/` para `src/engine/dvfs/`).
- **Mock DvfsLoaderHelper em testes** — `DvfsLoaderHelper` faz 2 chamadas `findFirst` por chaveScript (idClasse concreto → fallback -300). Mock deve responder ao `where.chaveScript` (não ao `where.idClasse`).
- **R-CHAVE-5 / R-CHAVE-7 são BLOQUEANTES** — testes em `OperacaoPedido.regressao-dvfs.spec.ts`. F6 não fecha sem ambos verdes. Valida que `_funcPosCalculo` (chave 5) e `_funcPosGravacao` (chave 7) são carregados e executados.
- **`OperacaoExecucaoClaude` não reexporta IExecucaoData** — interface é importada de `IExecucaoData.ts` separado. Arquivo `OperacaoExecucaoClaude.ts` importa direto de `../interfaces/IExecucaoData`.
- **`agentTunnelService` é `any` em F6** — STUB. Service retorna mock `{ exitCode: 0, stdout, stderr, headBefore, headAfter, ... }`. F13 tipará corretamente.
- **`ScheduleModule.forFeature()` não existe** — usar `forRoot()` (já no AppModule). Evitar duplicar forRoot() no ExecutionsModule — NestJS singleton.
- **`agentId` deve ser BigInt-convertível** — string numérica ('100'), não 'agent-stub-100'. OperacaoExecucaoClaude faz `BigInt(params.agentId)`.
- **`gravarAposAprovacaoManual()` usa UPDATE** — método adicionado ao Engine em Task 2. Reconstrói state sem nova() e faz dPedido.update(), não create(). Chama `_carregaScriptsGrav()` se scripts não carregados.
- **TRUNCATE promovido para HIGH** — Task 1 tinha TRUNCATE como MEDIUM; Task 2 o moveu para HIGH (25 patterns). Teste OperacaoExecucaoClaude.unit.spec.ts atualizado.
- **risk-gate-adversarial spec em TypeScript** — Jest só reconhece `.spec.ts`. Usar eval IIFE: `eval('(function(){ ' + scriptContent + '; return riskGateValidator; })()')`.
- **race condition em approve()** — `$executeRaw` com WHERE condicional. Se `updated === 0`: outro admin venceu → ConflictException. Não usar findFirst + update sequencial (não race-safe).
- **dPedido.update mock em testes** — `_executarClaude()` → `_atualizarPedidoCompleto()` chama `dPedido.update`. Mock do Prisma em testes deve incluir `dPedido.update: jest.fn()`.

### Gotchas F5 (Blocos C+E+F)
- **zod NÃO está instalado** — não usar `import { z } from 'zod'`. Usar interfaces TypeScript + funções parse helper
- **DTask não tem campo `codigo`** — usar `dados.identifier` para DEV-N identifier (não `DTask.codigo`)
- **Circular dependency AuthModule ↔ OrganizationsModule** — resolver com `forwardRef()` em ambos
- **auth.service.spec.ts** — ao injetar novo service no AuthService, adicionar mock no spec
- **TeamsController multi-prefixo** — usar `@Controller()` sem prefixo + path completo nas rotas
- **auth.service register()** — refatorado para 2 transactions separadas (usuário + org)
- **WorkflowStatusesService.seedDefaults** — usa `-441` (INBOX) como sentinela de idempotência
- **TasksIdentifierService** — receber `PrismaService` via DI mas NÃO armazenar como `private readonly` (TS6138). Usar `constructor(_prisma: PrismaService) {}` pois métodos usam `tx` passado por parâmetro
- **idClasse DProject/DTask** — sem definição explícita no plano; usados -300 e -200 como placeholder. Confirmar com seed real
- **DTask.idStatus → DTabela.chave** — filtrar tasks por status V3 requer buscar DTabela com idClasse=-44X primeiro, depois filtrar DTask.idStatus IN ids
- **Telemetria workSessions** — ao DONE: buscar última session sem endedAt via `.reverse().find(s => !s.endedAt)`
- **OrganizationsService** — `buildResponse` aceita `dados` como parâmetro opcional para evitar double-read

### Gotchas F4
- **`APP_INTERCEPTOR`/`APP_FILTER`** vêm de `@nestjs/core`, NÃO de `@nestjs/common`
- **DTOs TypeScript strict** — campos sem inicializador precisam de `campo!: tipo`
- **`private readonly config` em providers** — se config é usado apenas no construtor e NÃO como propriedade, remover `private readonly` para evitar TS6138
- **DEntidade usa `criadoEm`** (não `chcriacao`) para filtro de data
- **DEvento não tem `idUsuario`** — passar userId em `metaDados` como string
- **TimezoneService depende de `date-fns` + `date-fns-tz`** (não apenas `luxon`)
- **Quando adicionar dependência em Service, atualizar spec** adicionando o provider no módulo de teste

### Codepaths F8 Task#2 (SearchModule)
- `src/search/search.module.ts` — importa AuthModule para guards
- `src/search/search.controller.ts` — GET /search com JwtAuthGuard + OrgTenantGuard
- `src/search/search.service.ts` — Promise.all(queryTasks, queryProjects, queryPeople)
- `src/search/dto/search-query.dto.ts` — SearchQueryDto com MinLength(2)
- `src/search/dto/search-response.dto.ts` — SearchResponseDto + sub-DTOs

### Gotchas F8 Task#2 (Search)
- **queryPeople é via DVincula, NÃO via idEstab** — OrganizationsService.addMember() cria DVincula idClasse in [-161,-162,-163] com idLocEscritu=orgId. DEntidade USER (-150) NÃO tem idEstab apontando para org. Buscar membros: dVincula.findMany({ idLocEscritu: orgId, idClasse: in [...] }) → pegar idEntidade → dEntidade.findMany({ chave: in [...], idClasse: -150 }).
- **queryPeople usa 2 queries** (DVincula + DEntidade) encapsuladas em 1 branch do Promise.all — total 4 queries por request, não 3. Ainda ZERO N+1.
- **people=[] quando DVincula vazio** — testar edge case: se org sem membros, dEntidade.findMany não deve ser chamado (early return).
- **Spec 13 ForbiddenException** — testar com organizationId='' para garantir guard no service (não apenas no guard).
- **Falso-positivo grep eventProducer** — comentário em texto em spec gera match. Não é código funcional — verificar que é apenas comentário.

### Gotchas F8 (Flow Metrics + Forecast — read-only analytics)
- **ThroughputService `$queryRaw` com Prisma.sql** — `IN (${id1}, ${id2})` funciona com valores explícitos. NÃO usar `IN (${arrayDeBigInt})` — Prisma não serializa BigInt[] corretamente no template literal. Expandir manualmente.
- **CFD sem `idProject` em DEvento -498** — DEvento -498 não tem FK para DProject. Filtrar via `metaDados.taskId` (string) comparado ao Set de taskIds do projeto. Fallback via `identificadorExterno`.
- **WipAgeService — OnModuleInit** — carrega mapa de status (DTabela -441..-449) uma vez no boot sem TTL. Em testes, chamar `loadStatusCodes()` manualmente no `beforeEach` após `jest.clearAllMocks()`.
- **PeriodResolver é `@Injectable()`** — deve ser declarado em `providers` do módulo (não é global). ForecastModule reusa o PeriodResolver do FlowMetricsModule via imports (registrar também como provider no ForecastModule).
- **Forecast: WipAgeService não é necessário no ForecastService** — contagem de tasks restantes via `prisma.dTask.count` direto (sem injetar WipAgeService).
- **Monte Carlo Mulberry32** — seed via closure funciona: `let s = seed >>> 0`. Para seeds negativos ou undefined: usar `Math.random` puro (não quebra).
- **Coverage dos controllers** — controllers têm 0% coverage sem testes e2e. Não bloqueia DoD desta task. Testar via request HTTP em integração é responsabilidade de F14.

### Codepaths F9 Bloco X (ReportsModule)
- `src/reports/reports.module.ts` — imports: AuthModule, DashboardsModule, AnalyticsModule, ForecastModule
- `src/reports/reports.controller.ts` — GET /reports/projects/:projectId/pdf + res.end(buffer)
- `src/reports/reports.service.ts` — assembleReportData via Promise.allSettled + TtlCacheService 5min
- `src/reports/pdf-generator.service.ts` — PDFKit 8 seções, sem Prisma, sem Engine
- `src/reports/dto/report-query.dto.ts` — periodDays (1-180), periodFrom, periodTo, includeTasks, includeStakeholderSummary
- `src/reports/dto/project-report-data.dto.ts` — payload completo com warnings[]

### Codepaths F10 Bloco A (ChannelsModule — Core)
- `src/channels/channels.module.ts` — importa EntidadesModule, AuthModule, TasksModule; exporta 4 services; `onModuleInit` verifica CHANNELS_ENABLED
- `src/channels/pairing.controller.ts` — POST /channels/pairing/generate + /link; JwtAuthGuard; converte DUserGroup→DEntidade antes de chamar PairingService
- `src/channels/core/channel-adapter.interface.ts` — ChannelAdapter + InboundMessage (interfaces puras)
- `src/channels/core/pairing.service.ts` — generate() + consume() com $transaction
- `src/channels/core/account-link.service.ts` — findByChat() com query única via metaDados JSONB
- `src/channels/core/message-router.service.ts` — handleInbound() + registerIntentHandler() + IntentHandler interface
- `src/channels/core/command-registry.service.ts` — CommandHandler interface + register() + resolve()

### Gotchas F10 Bloco A (Core Channels)
- **DVincula usa `metaDados` (não `dados`)** — DTabela tem AMBOS (`dados` e `metaDados`); DVincula tem APENAS `metaDados`. Verificar schema.prisma antes de usar campo polimórfico em DVincula. Erro TS2353 sinaliza campo errado.
- **Busca de token por hash usa `findMany` + filter em memória** — não `$queryRaw` — para evitar SQL raw com JSONB path. Seguro porque o conjunto de tokens ativos é pequeno (TTL curto).
- **`chatId` do Telegram é Int64** — SEMPRE `BigInt(chatId)` no ponto de entrada. Nunca `parseInt` ou `Number`.
- **CHANNELS_ENABLED — módulo inerte, não ausente** — quando `!== 'true'`, loga warn mas NÃO lança. Permite que testes importem o módulo sem env var.
- **Mocks de $transaction** — passar callback `(fn) => fn(txMock)`. txMock deve incluir TODOS os models usados dentro da tx (dTabela, dVincula). Se faltar um model no mock, o teste trava.
- **Teste de "fail-safe" gera ERROR no logger** — esperado. O teste verifica que erros de handler são capturados sem propagar. O logger.error aparece no output do Jest mas o teste PASSA.

### Gotchas F10 Bloco B (Telegram Webhook)
- **ioredis SET NX sintaxe** — usar `redis.set(key, '1', 'PX', ttlMs, 'NX')` (PX antes de NX). A assinatura `set(key, value, 'NX', 'PX', ttl)` gera TS2769 no ioredis v5.
- **fetch nativo Node 18+ para multipart** — Construir multipart/form-data manualmente via `Buffer.concat` sem dependência de `form-data`. Projeto usa Node 18+ com fetch global.
- **`@types/supertest` não instalado** — Testes de controller usam TestingModule direto (sem HTTP stack real). Instalar em F14 para testes e2e. Evitar import de supertest em specs existentes.
- **TelegramModule declara AccountLinkService como provider próprio** — Para evitar dependência circular com ChannelsModule (que importa TelegramModule), TelegramModule inclui AccountLinkService, MessageRouterService e CommandRegistryService em seus providers. NestJS cria instâncias separadas (correto).
- **handleText usa $transaction; handleVoice não** — handleText afeta DEvento + DVincula (multi-tabela → $transaction). handleVoice afeta apenas DEvento (tabela única → create direto). Esta distinção é intencional.
- **event-types.ts requer adição manual de novos tipos** — EventProducerService lança BadRequestException se o tipo não estiver em ALL_EVENT_TYPES_SET. Adicionar SEMPRE em event-types.ts antes de emitir novo tipo. F10 Bloco B adicionou TELEGRAM_MESSAGE_RECEIVED e TELEGRAM_VOICE_RECEIVED.
- **isDuplicate retorna false em modo degradado** — Se Redis indisponível, permite processamento (fail-open para deduplicação). Aceitável pois Telegram tem retry limitado. Não lança exceção.
- **TelegramWebhookService.onModuleInit inicializa Redis** — Redis deve ser inicializado apenas se CHANNELS_ENABLED=true. Testes precisam mockar `initRedis` para evitar conexão real.

### Gotchas F10 Bloco C (Telegram Commands)
- **DProject não tem `idCreator`** — Schema de DProject (F5) tem apenas `idClasse`, `idEstab`, `nome`, `descricao`, `dados`. NÃO tem `idCreator`. Para resolver projeto padrão do usuário, buscar por `idEstab = userId` e fallback para projeto mais recente não excluído.
- **`TasksService.findMany` sem filtro de data** — `ListTasksQueryDto` não tem `dateFrom`/`dateTo`. Para handlers que precisam de filtro por período (today/week), buscar com `limit: 100` e filtrar em memória via `TimezoneService.getPeriodDates`. Aceitável pois volume via Telegram é pequeno.
- **`PairingService` deve ser provido no TelegramModule** — `PairHandler` precisa de `PairingService`. Padrão: adicionar ao array `providers` do TelegramModule (mesma abordagem de AccountLinkService, MessageRouterService etc. do Bloco B).
- **Variável não usada em spec gera TS6133** — TypeScript strict rejeita `let service: Type` sem uso em spec, mesmo com `_` prefix. Remover a declaração se não for usada nas asserções.
- **`canHandle` para text livre** — verificar `message.type === 'text' && typeof message.text === 'string' && message.text.length > 0`. Checar `typeof` evita falso positivo com `undefined`.
- **Status de erros em testes são logs esperados** — `logger.error` aparece no output do Jest quando testamos o path de erro. O teste PASSA; o log é comportamento correto do error handling.

### Gotchas F9 Bloco X (Reports PDF)
- **PDFKit import** — `const PDFDocument: new (options?) => PDFKit.PDFDocument = require('pdfkit')` é o único padrão que compila. `import * as PDFDocument from 'pdfkit'` → TS2351 (not constructable). `import PDFDocument from 'pdfkit'` sem esModuleInterop falha. Usar require com tipagem explícita.
- **Promise.allSettled vs Promise.all** — usar allSettled para relatórios: ForecastService lança BadRequestException quando histórico insuficiente (comportamento esperado). allSettled captura e converte em warning; allSettled permite relatório parcial.
- **Cache de payload, não de Buffer** — cachear ProjectReportDataDto (não o Buffer PDF). Buffer é gerado em <500ms; cachear Buffer consumiria mais RAM e impediria personalização futura.
- **res.end(buffer) para PDF binário** — usar Response Express diretamente em vez de StreamableFile do NestJS. StreamableFile não permite setar Content-Disposition facilmente. Anotar parâmetro com @Res() e chamar res.setHeader() + res.end().
- **AnalyticsService exportado via AnalyticsModule** — importar AnalyticsModule no ReportsModule (não apenas AnalyticsService diretamente). AnalyticsModule exporta AnalyticsService e reexporta DashboardsModule.
- **DashboardsModule exporta DashboardsService** — importar DashboardsModule no ReportsModule garante acesso a DashboardsService sem reimportar FlowMetricsModule separadamente.

### Módulos V2 (lista oficial — usar exatamente esses scope names)

`engine | seeds | endpoints | core | auth | eventos | entidades | tabelas | classes | common | channels | mcp | webhooks | automation | executions | flow-metrics | reports | email | permissoes | docs | agents`

**NÃO usar `pagamento` (V2 não é financeiro).**

---

## OS 21 PADRÕES OBRIGATÓRIOS

Skill `devari-backend-patterns` é auto-injetada. Os 21 padrões:

1. **PrismaService** (não DatabaseService)
2. **BigInt** para IDs (não parseInt/Number)
3. **Transactions** (`prisma.$transaction`) em multi-tabela
4. **TimezoneService** para filtros de data (America/Sao_Paulo)
5. **EntidadeService.getEntidadeIdFromUserGroup** (DUserGroup → DEntidade)
6. **N+1 queries: ZERO** (use `include`/`select` JOIN ou batch)
7. **Eventos APÓS persistência** (não antes!)
8. **Decimal(19,4)** para valores monetários (não aplicável intensamente em V2 — Scrumban não é financeiro)
9. **DTOs com class-validator + Swagger**
10. **Guards** em endpoints privados (JwtAuthGuard, ApiKeyGuard, McpKeyGuard, AuthCompositeGuard)
11. **Logger NestJS** (não console.log — eslint bloqueia)
12. **HttpException apropriada** (NotFoundException, ConflictException, BadRequestException, UnauthorizedException)
13. **Padrão Controller** (orquestra, não implementa)
14. **Padrão Service** (lógica de negócio isolada)
15. **EventProducerService + naming** (`order.created`, `entity.created`, `system.audit.log`...)
16. **Cursor pagination** (não offset) + `select` para reduzir payload
17. **Testes unit + integration**
18. **Swagger decorators completos** (@ApiOperation, @ApiResponse, @ApiParam, @ApiQuery, @ApiBody)
19. **Imports organizados** (NestJS → libs externas → services → DTOs → tipos/enums)
20. **Constantes de IDs** apenas no seed (NUNCA hardcoded em services)
21. **Checklist final** antes de marcar pronto

---

## ANTI-PADRÕES V2 (8 + extras)

### Os 8 clássicos
1. **DatabaseService deprecated** — use `PrismaService`
2. **`parseInt(id)`** — use `BigInt(id)`
3. **`setHours()` / UTC manual** — use `TimezoneService`
4. **N+1 queries** (loop com `findFirst`) — use `include`/`select` ou batch
5. **`eventProducer.emit()` antes de persistir** — persista primeiro, emita depois
6. **`prisma.dPedido.create()` direto** — Pilar 1 violado, use `OperacaoExecucaoClaude`
7. **UserController/SprintController/StatusController** — Pilar 2 violado, reusar `/entidades` `/tabelas`
8. **Seed faltando** — Pilar 3 violado, sistema não inicia

### Extras V2
9. **Modelo novo no schema.prisma** (qualquer fora das 17) → hook `enforce-canonical-tables.sh` bloqueia
10. **Coluna nova em tabela canônica sem ADR** → use `dados`/`metaDados` Json ou redija ADR-V2-XXX
11. **Sequestro de DClasse canônica (-40, -45, -47, -49, -50, -1..-110)** → renumerar para -150..-529
12. **Engine em cadastro estrutural** (DEntidade/DTask/DProject/DTabela) → use Service + Prisma direto
13. **Chave POSITIVA no seed** → seeds são SEMPRE chaves negativas
14. **`role` enum em DUserGroup** → RBAC via DVincula + idClasse (-161/-162/-163, -171/-172/-173)
15. **DProjectMember/DNotification/DWebhook/DAgent/DExecution** → eliminadas; use canônicas

---

## REGRA V2 ABSOLUTA: ENGINE APENAS EM DPedido idClasse=-300

```typescript
// CORRETO — F6 e F13
import OperacaoExecucaoClaude from 'src/engine/lib/operacao/OperacaoExecucaoClaude';

const op = new OperacaoExecucaoClaude({
  usuario: userId.toString(),
  classe: '-301',  // ou -302/-303 conforme Risk Gate
  bd: this.prisma
});
await op.nova();
op.pedidoCab.setDados({ command, riskLevel, category });
await op.calcula();
await op.aprova({ aprovador: userId.toString() });
await op.grava();

// ERRADO — Engine para criar Org/Project/Task estrutural
const op = new OperacaoExecucaoClaude({ classe: '-152', ... });  // -152 = ORGANIZATION
// ❌ Org é DEntidade estrutural; criar com Service + Prisma direto
```

**Cadastros estruturais (DEntidade/DTask/DProject):**
```typescript
// CORRETO — Service + Prisma + transaction
return await this.prisma.$transaction(async (tx) => {
  const org = await tx.dEntidade.create({ data: { idClasse: -152n, nome: dto.nome, ... } });
  // criar vínculo Org-User como ADMIN (DVincula idClasse=-161)
  await tx.dVincula.create({ data: { idClasse: -161n, idLocEscritu: org.chave, idEntidade: userId } });
  return org;
});
```

---

## DVFS — CHAVES DE SCRIPT

Para `OperacaoExecucaoClaude` (F6), DVFS na tabela tem 5 chaves de script:

| Chave | Momento | Propósito V2 |
|-------|---------|--------------|
| 3 | Pré-cálculo | Validar comando, classificar risco (Risk Gate) |
| 4 | Cálculo | Calcular custos estimados, prazo |
| 5 | Pós-cálculo | Ajustes finais antes de aprova |
| 6 | Pré-gravação | Validar aprovador (HIGH precisa aprovação manual) |
| 7 | Pós-gravação | Side-effects (DEvento -496 EXECUTION_LOG, fila BullMQ para executar) |

**ATENÇÃO bug latente:** auditoria detectou risco `s.id` vs `s.chave` em `_carregaScriptsCalc` e `_carregaScriptsGrav`. F6 DoD obrigatório com 2 testes regressivos adversariais bloqueantes (ver ADR-V2-007 e §5 plano-mestre).

---

## BUILD DINÂMICO

```bash
if [ -f Makefile ] && grep -q "^build:" Makefile; then
  make build
else
  npm run build
fi

npx tsc --noEmit  # 0 errors obrigatório
npx eslint src/ --ext .ts --max-warnings 0  # 0 errors
```

Hook `validate-implementation.sh` (Stop, 180s) executa build automático.
Hook `validate-implementer-build.sh` (SubagentStop) double-check antes de retornar à conversa principal.

---

## CONVENÇÃO DE QUERY V2 (ADR-V2-016 a ratificar)

- `?classe=NOME` (string, ex: `?classe=SPRINT`) — convenção PRIMÁRIA do TabelaController herdada
- `?idClasse=N` (numérico, ex: `?idClasse=-400`) — wrapper de compatibilidade aceito por 2 sprints, depois deprecated

EntidadeController aceita ambos hoje:
- `GET /entidades?idClasse=-150&nome=Joao&page=1&pageSize=10` (USER)
- `GET /entidades?idClasse=-152` (ORGANIZATION)

---

## GOTCHAS V2 CONHECIDOS

- **`jsonb_set` para identifier público (DEV-N):** usar raw UPDATE + RETURNING dentro de transação. 10-thread test obrigatório (concorrência).
- **F13 command injection:** TDD com 58 testes adversariais ANTES do código (whitelist + AST + regex em camadas).
- **F13 SSH reverso:** TOFU + HMAC nos comandos; rotação de chaves.
- **F1 hierarquia idPai do seed:** validator automatizado (todos `idPai` existem); peer-review obrigatório.
- **F15 cutover:** 3 ensaios cronometrados em staging; abort policy às 04:00.
- **TypeScript com Prisma BigInt:** uso de `BigInt(id)` em wheres e tipos. Nunca `as any`.
- **TS2564 em DTOs (strictPropertyInitialization):** tsconfig tem `strict: true`. DTOs de resposta sem construtor precisam de `!` em todos os campos obrigatórios (ex: `chave!: string`).
- **Prisma Json + Record<string, unknown>:** Campos Json do Prisma exigem cast `as Prisma.InputJsonValue`. `Record<string, unknown>` não é compatível diretamente.
- **Windows: `make` não disponível** — usar `npm run build` diretamente. `make build` falha com "command not found".
- **npm install necessário** antes do primeiro build (node_modules não commitado).
- **ESLint path para scan:** `npx eslint "src/**/*.ts" --max-warnings 0` (com aspas para glob no Windows).

## CONVENÇÃO ADR-V2-015 IMPLEMENTADA (F2)

**Canônico:** `?idClasse=-150` → BigInt direto, sem log
**Deprecated:** `?classe=USER` → LRU cache (TTL 5min) + Logger.warn + headers `Deprecation: true`, `Sunset: 2026-06-05`
**Ambos:** → 400 BadRequest
**Nenhum:** → 400 BadRequest
**Sunset date:** 2026-06-05 (2 sprints a partir de F2)

## F2 IMPLEMENTADO — ESTRUTURA DE ARQUIVOS

```
src/common/pipes/parse-bigint.pipe.ts           # string → bigint, valida ^-?\d+$
src/common/pipes/parse-optional-bigint.pipe.ts  # versão opcional
src/common/decorators/skip-guard.decorator.ts   # TOMBSTONE F3 — não usar; usar @Public()
src/common/helpers/lru-cache.ts                 # LRU genérico max:200 ttl:5min
src/common/dto/pagination-meta.dto.ts           # movida de src/entidades/dto/ em F3
src/common/helpers/validar-classe.helper.ts     # extraída de entidades+tabelas em F3

src/entidades/entidades.service.ts              # 8 métodos (inclui getEntidadeIdFromUserGroup)
src/entidades/entidades.controller.ts           # F3: AuthCompositeGuard + OrgTenantGuard
src/entidades/entidades.module.ts               # F3: forwardRef(AuthModule)

src/tabelas/tabelas.service.ts                  # F3: usa validarClasse helper + formatTabelaResponse
src/tabelas/tabelas.controller.ts               # F3: AuthCompositeGuard + OrgTenantGuard
src/tabelas/helpers/format-tabela-response.ts   # extraída de tabelas.service.ts em F3

src/classes/classes.controller.ts               # F3: AuthCompositeGuard, POST retorna 403
```
- **DEvento.idUsuario aponta para DEntidade.chave (não DUserGroup.chave)** — usar `EntidadeService.getEntidadeIdFromUserGroup(userGroupId)` para conversão.

## F3 IMPLEMENTADO — AUTH + RBAC DUPLO

```
src/auth/auth.module.ts              # JWT + Passport + forwardRef(EntidadesModule)
src/auth/auth.service.ts             # register (tx), login, refresh, logout, getMe, updateMe, deleteMe
src/auth/auth.controller.ts          # 13 endpoints /auth/*, /auth/me/api-key, /auth/me/mcp-key
src/auth/strategies/jwt.strategy.ts  # PassportStrategy JWT
src/auth/guards/jwt-auth.guard.ts    # NÃO lança; @Public() bypass
src/auth/guards/api-key.guard.ts     # X-API-Key; popula req['project']; NÃO lança
src/auth/guards/mcp-key.guard.ts     # X-MCP-Key; NÃO lança
src/auth/guards/auth-composite.guard.ts # OR: MCP→APIKey→JWT; ÚNICO que lança 401
src/auth/guards/org-tenant.guard.ts  # DProject.idEstab + LRU cache (decisão CEO Q1)
src/auth/guards/roles.guard.ts       # DVincula role + LRU cache
src/auth/decorators/public.decorator.ts  # @Public() substitui @SkipGuard()
src/auth/services/role-resolver.service.ts # LRU 1000 entries TTL 5min; N+1 ZERO
src/auth/services/api-key.service.ts # DTabela(-471): generate/validate (SHA-256)/revoke
src/auth/services/mcp-key.service.ts # DTabela(-472) + DUserGroup.dados.mcpKeyHash
src/auth/services/refresh-token.service.ts # rotação estrita; reuse detection

src/permissoes/permissoes.module.ts
src/permissoes/permissoes.controller.ts # @Roles('ADMIN')
src/permissoes/permissoes.service.ts    # CRUD DPermissao
```

**Gotchas F3 críticos:**
- **forwardRef obrigatório** entre AuthModule↔EntidadesModule/TabelasModule/ClassesModule (circular dep)
- **Guards internos NÃO lançam** — apenas retornam false; AuthCompositeGuard é o único que lança
- **Refresh token scan em POST /auth/refresh** — acessa DUserGroup.dados.refreshTokenHash em scan; F14 precisa indexar
- **BCRYPT_ROUNDS = 12** — constante em auth.service.ts
- **bcryptjs** (não bcrypt) está instalado; import `* as bcrypt from 'bcryptjs'`
- **JwtPayload sub/entidadeId/organizationId são strings** (não BigInt) — evita BigInt serialization
- **AuthCompositeGuard** verificar req.user após JwtAuthGuard.canActivate (JWT pode retornar true mas sem user)

---

## ENDPOINTS V2 — 128 a entregar (escopo Scrumban-hoje)

Distribuição por bloco de fases:
- **F2 (genéricos):** /entidades, /tabelas, /classes (~3 controllers cobrem ~50 endpoints lógicos via idClasse)
- **F3 (auth):** /auth/login, /auth/refresh, /auth/me, /users (auth wrapper)
- **F5 (estrutural):** /projects, /tasks, /sprints (wrapper), /workflow-statuses (wrapper)
- **F6 (engine):** /executions
- **F8/F9:** /flow-metrics, /forecast, /reports, /dashboards
- **F10:** /channels, /channels/telegram/webhook
- **F11:** /mcp/* (5 tools)
- **F12:** /webhooks (CRUD config), /webhooks/test
- **F13:** /agents, /agents/{id}/install, /executions (Automation flow)

Contrato HTTP detalhado: `Scrumbam-Backend/docs/API-CONTRACT.md`.

---

## OUTPUT OBRIGATÓRIO

`workspace/implementations/impl-[modulo]-[descricao]-task[N].md`

Modulos válidos = lista no agent file. Lowercase + hífens + prefixo módulo + sufixo task[N].

---

## NOTAS

- Se não achar arquivo do plan: PARAR e pedir à conversa principal. NÃO improvisar.
- Se 3 Pilares estão envolvidos: confirmar que o Strategist redigiu plan (não fazer Fast Mode em F1, F2, F3, F5, F6, F7, F13, F15).
- Se o build quebra apenas com 1 import: checar `tsconfig.json` paths e `package.json` deps.
- Em dúvida arquitetural: NÃO improvisar — pedir ao Strategist via conversa principal.
