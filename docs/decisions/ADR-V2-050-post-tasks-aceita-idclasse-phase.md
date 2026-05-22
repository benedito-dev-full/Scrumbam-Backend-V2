# ADR-V2-050: POST /tasks aceita `idClasse=-200` para criar Fases via HTTP (fechamento ADR-V2-047)

**Status:** Proposed
**Data:** 2026-05-22
**Decisores:** CEO + Strategist Agent V2 + Implementer Agent V2 (Task 2)
**Tags:** #V2 #pós-F8 #tasks #hierarquia #ADR-V2-047 #ADR-V2-048
**ADR-pai:** ADR-V2-047 (Fases via DTask.idPai)

---

## Contexto e Problema

O ADR-V2-047 (mergeado em PR #7 / commit `8734d32`) introduziu Fases/Blocos como `DTask` polimórfica com `idClasse=-200` e self-FK `idPai`. Cobriu:

- **Seed F1** da DClasse PHASE (`-200`).
- **Leitura hierárquica** (`/tasks?idPai`, `/tasks?idClasse=-200`, `/tasks?depth`).
- **Update** (`PATCH /tasks/:id` permite `idPai` semântica ternária).
- **Delete em cascata** (`PhaseHierarchyService.softDeleteCascade`).
- **Tree e métricas** (`GET /tasks/:id/tree`, `GET /tasks/:id/metrics`).
- **Eventos canônicos** `phase.created/updated/deleted/completed` (F8) — emissão JÁ implementada em `tasks.service.ts:251` (condicional em `task.idClasse === ID_CLASSE_PHASE`).
- **Guard ADR-V2-048**: `PATCH /tasks/:id/status` retorna 400 em PHASE (fase não tem status próprio).

**Lacuna descoberta em 2026-05-22 durante integração do dashboard `PhaseCardsTab` no frontend:** não existe caminho HTTP para CRIAR uma fase. O `POST /tasks` força `idClasse = ID_CLASSE_TASK` (-154) hard-coded em `tasks.service.ts:211`, e o `CreateTaskDto` não tem campo `idClasse`. As fases que existem em produção foram criadas por seed/script. O frontend (commit `9541743` no Scrumbam-FrontEnd) já tem o botão "Novo bloco" esperando o endpoint.

O emit de `phase.created` está pronto — basta o `create()` chegar com `idClasse=-200`.

## Decisão

**Estender `CreateTaskDto` com campo opcional `idClasse?: string` (whitelist `'-154' | '-200'`, default `'-154'`) e ramificar o `TasksService.create()` quando `isPhase`.**

Mudanças cirúrgicas:

1. **`CreateTaskDto.idClasse`** (opcional + `@IsIn(['-154', '-200'])` + `@ApiPropertyOptional`).
2. **`TasksService.create()`** resolve `idClasse` com default `-154`; quando PHASE:
   - Pula `identifierService.getNextIdentifier()` (sequence DEV-N intacta).
   - Pula lookup INBOX (DTabela -441).
   - Pula `resolvePriorityId()`.
   - Ignora silenciosamente `assigneeId`, `sprintId`, `priority`, `taskType` (`logger.warn` para telemetria barata).
   - Persiste `dados = { kind: 'phase', createdBy }` via helper top-level `buildPhaseDados()`.
   - Valida sub-fase: se `idPai` informado, pai DEVE ter `idClasse=-200` (400 se TASK).
3. **`TaskResponseDto.idClasse`** novo campo obrigatório (frontend distingue TASK vs PHASE).
4. **Emit `phase.created`**: nenhuma mudança — código existente passa a executar.

### Whitelist estrita (`-154` | `-200`)

Decisão consciente: NÃO aceitar `idClasse` arbitrário. Se surgir EPIC/SUBTASK_TEMPLATE no futuro, AMPLIAR whitelist + tests. Defesa em profundidade: validação no DTO (`@IsIn`) E na resolução interna do service (`BigInt()` + comparação com constante).

### Por que NÃO rota dedicada (`POST /tasks/phases`)

| Alternativa | Avaliação |
|-------------|-----------|
| **Alt A** — `idClasse` opcional no DTO genérico (✅ escolhida) | Aditivo, zero break, alinhado com Pilar 2 + ADR-V2-047 + modelo polimórfico canônico. |
| Alt B — rota dedicada `POST /tasks/phases` com `CreatePhaseDto` próprio | Cria divergência semântica: leitura é `GET /tasks?idClasse=-200` (polimórfica) mas escrita seria dedicada. Fere Pilar 2 sem ganho funcional real. |
| Alt C — wrapper híbrido | Apenas mais código sem benefício. |

O precedente `EntidadeController.POST /entidades/plataformas` (e similares) NÃO é comparável: cada uma daquelas rotas orquestra criação de N entidades vinculadas (DUserGroup + DVincula + Conta Virtual) em transaction atômica. Criação de fase é UMA INSERT em DTask — não há orquestração que justifique sub-rota.

### Decisões PHASE-específicas

| Campo | Comportamento PHASE | Justificativa |
|-------|---------------------|---------------|
| `identifier` (DEV-N) | NÃO gerar (`dados.identifier` ausente; response `identifier=''`) | Sequence DEV-N é convenção de task executável. Evita consumo desnecessário. |
| `idStatus` | NULL | ADR-V2-048: fase não tem status próprio — derivado de `PhaseMetricsService.compute`. |
| `idPriority` | NULL (silenciosamente ignorado se enviado) | Prioridade pertence à task, não ao agrupador. |
| `idAssignee` | NULL (silenciosamente ignorado) | Fase não é executada por ninguém. |
| `idSprint` | NULL (silenciosamente ignorado) | Sprint é micro-unidade; fase é macro-estrutural. |
| `taskType` | Ausente em `dados` (silenciosamente ignorado) | Tipo de execução não se aplica a agrupador. |
| `dados` | `{ kind: 'phase', createdBy }` (mínimo) | Helper `buildPhaseDados()` separado de `buildInitialTaskDados` para não poluir schema V3 de task. |
| Sub-fase (`idPai` + `idClasse=-200`) | Pai DEVE ser PHASE (400 se TASK) | Hierarquia macro: PHASE pode conter PHASE; PHASE-como-filha-de-TASK não faz sentido conceitual. |
| TASK filha de PHASE (`idPai` + sem `idClasse` ou `idClasse=-154`) | Permitida (não-recíproco) | Caso de uso primário: tasks vivem DENTRO de fases. |

### Estratégia "ignorar silenciosamente" vs 400 BadRequest

Optamos por ignorar com `logger.warn` em vez de rejeitar com 400. Razões:

- Reduz fricção para clients genéricos (Telegram listener, MCP create_task) que mandam formulários completos.
- Frontend pode reusar mesmo formulário de TASK para PHASE só trocando `idClasse`.
- Documentado em Swagger.
- `logger.warn` dá telemetria barata se ficar evidente que a UX está confundindo o usuário.

## Conformidade com Pilares Devari-Core

- **Pilar 1 (Engine):** N/A — DTask é estrutural (Prisma direto + transaction). Engine é exclusivo para tabelas transacionais (DPedido/DTitulo/DMovDispo/DMovDepos/DSolicita/DRequisic).
- **Pilar 2 (Endpoints genéricos):** PRESERVADO E REFORÇADO. `/tasks` é justamente o endpoint genérico polimórfico para DTask — aceitar `idClasse` opcional é o caminho canônico, alinhado com `GET /tasks?idClasse=-200` já existente.
- **Pilar 3 (Seed):** PRESERVADO. Nenhuma nova DClasse (PHASE `-200` já seedada na F1 do ADR-V2-047).
- **ADR-V2-001 (zero tabela nova):** PRESERVADO. Apenas mudança aditiva em DTO + service TypeScript.

## Conformidade com ADRs vigentes

- **ADR-V2-042 (tenant isolation):** preservado — `accessibleProjectIds` validado ANTES de qualquer query, mesma defesa anti-enumeration.
- **ADR-V2-047 (fases via DTask.idPai):** ESTE ADR FECHA A LACUNA do 047 (criação via HTTP). Reaproveita 100% da infra existente (validação `idPai`, eventos, hierarquia).
- **ADR-V2-048 (fases fora do board V3):** complementar — guard em `updateStatus` continua ativo. Criar fase NÃO contradiz "fase não tem status próprio".

## Por que ADR-V2-050 (novo) e NÃO adendo ao ADR-V2-047

O ADR-V2-047 está mergeado (PR #7 / commit `8734d32`). Modificá-lo dilui rastreabilidade histórica e mistura decisão original com decisão de fechamento. O ADR-V2-049 já foi alocado para Telegram listener (commit `0668860`), por isso esta decisão recebe o número **050**.

ADR-V2-050 referencia ADR-V2-047 explicitamente como ADR-pai e cita explicitamente o ADR-V2-048 (guard de status em PHASE) como contraparte semântica.

## Implementação

**Plano:** `workspace/plans/plan-tasks-criar-fase-via-http-task2.md`

**Arquivos modificados:**

- `src/tasks/dto/create-task.dto.ts` — campo `idClasse` opcional whitelisted.
- `src/tasks/dto/task-response.dto.ts` — campo `idClasse` obrigatório no response.
- `src/tasks/tasks.service.ts` — ramo `isPhase` em `create()`, helper `buildPhaseDados()`, `buildResponse` expõe `idClasse`.

**Specs fixados (drift defense para o novo campo obrigatório no response):**

- `src/channels/telegram/commands/__tests__/create-task.handler.spec.ts`
- `src/channels/telegram/commands/__tests__/status.handler.spec.ts`
- `src/channels/telegram/commands/__tests__/tasks.handler.spec.ts`

**Arquivos novos:**

- `src/tasks/__tests__/tasks.service.create-phase.spec.ts` — 10 unit tests.
- `src/tasks/__tests__/tasks.controller.create-phase.e2e.spec.ts` — 6 e2e tests.

**Endpoint final:**

```http
POST /tasks
Authorization: Bearer <jwt>
Content-Type: application/json

# TASK (backward compat — sem idClasse):
{ "nome": "Implementar JWT", "projectId": "5" }
→ 201 { idClasse: "-154", identifier: "DEV-N", status: "INBOX", ... }

# PHASE root:
{ "nome": "Sprint Q2", "projectId": "5", "idClasse": "-200" }
→ 201 { idClasse: "-200", identifier: "", status: "INBOX" (default DTO), idStatus persistido NULL, ... }

# Sub-PHASE:
{ "nome": "Sub-bloco", "projectId": "5", "idClasse": "-200", "idPai": "100" }
→ 201 (se pai 100 também é PHASE) | 400 (se pai é TASK)

# Whitelist:
{ "nome": "X", "projectId": "5", "idClasse": "-999" }
→ 400 (ValidationPipe via @IsIn)
```

## Consequências

### Positivas

- **DX coesa:** frontend, MCP e Telegram usam o MESMO endpoint para criar TASK e PHASE.
- **Pilar 2 reforçado:** documentação viva de que `/tasks` é polimórfico (leitura E escrita).
- **Padrão escalável:** se surgir EPIC ou SUBTASK_TEMPLATE no futuro, basta ampliar whitelist + tests. Nenhuma rota nova.
- **Backward compat total:** callers existentes (frontend `tasksApi.create`, MCP `create_task`, Telegram `/criar`) NÃO precisam mudar — default mantém comportamento.
- **Eventos pós-commit (Pilar 7) já corretos:** `phase.created` emitido APÓS persistência, junto com `task.created`.

### Negativas

- **Branching no service:** `create()` ganhou ramo condicional `isPhase`. Manutenção: cuidar para futuras refatorações não quebrarem só um lado. Mitigação: 10 unit tests cobrindo ambos os ramos (incluindo o caso #2 backward compat).
- **DTO menos semântico que CreatePhaseDto dedicado:** `assigneeId`/`sprintId`/`priority`/`taskType` aparecem no schema do POST mas são ignorados quando PHASE. Mitigação: Swagger explica explicitamente; `logger.warn` registra uso indevido.
- **`TaskResponseDto.idClasse` virou obrigatório:** quebrou 3 specs do Telegram (mocks inline incompletos). Corrigidos. Risco futuro: qualquer novo spec inline deve incluir `idClasse`.

### Neutras

- Frontend já estava pronto (commit `9541743`). Sem trabalho frontend extra.
- Não há migration de dados — fases pré-existentes do banco continuam funcionando idênticas.

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Caller de `tasksService.create` quebra ao receber `task.idClasse=-200` no return | E2E #5 valida ciclo escrita→leitura. Frontend `PhaseCardsTab` filtra `?idClasse=-200`; board principal filtra `?idClasse=-154` (separação estanque). |
| Bug no ramo `isPhase` faz identifier ser consumido | Unit tests #1 (PHASE não chama identifierService) + #2 (TASK chama). Spy explícito. |
| Frontend manda `idClasse` em formato inesperado | `@IsString` + `@IsIn(['-154', '-200'])` strict. E2E #3 valida. |
| `enforce-canonical-tables.sh` hook falso-positivo | NÃO houve mudança de schema Prisma. Hook não dispara. |
| Telegram listener cria PHASE por engano | Telegram chama `create(dto, userId)` sem `idClasse` → default `-154` → comportamento legado preservado. |

## Cross-link

- **ADR-V2-047** — Fases via DTask.idPai (ADR-pai; este fecha lacuna de criação)
- **ADR-V2-048** — Fases fora do board V3 (status derivado; complementar)
- **ADR-V2-049** — Telegram listener para eventos de domínio (paralelo, número adjacente)
- **ADR-V2-042** — Tenant isolation defense-in-depth (preservado)
- **ADR-V2-001** — Zero tabela nova (preservado)
- **Plano:** `workspace/plans/plan-tasks-criar-fase-via-http-task2.md`
- **Frontend caller:** `Scrumbam-FrontEnd/src/lib/api/phasesApi.ts` (commit `9541743`)

## Hooks que validam

- `validate-implementer-build.sh` — build NestJS PASS.
- `validate-review-score.sh` — Reviewer Score ≥ 7.0 esperado.
- `enforce-canonical-tables.sh` — não dispara (zero schema change).
