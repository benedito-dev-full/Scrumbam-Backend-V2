---
name: tasks-heranca-rollup-timer-task1
description: Herança de campos do pai no create() + rollup de tempo das filhas diretas on-read (ADR-V2-057/047) — Frente 1 + Frente 2
metadata:
  type: project
---

# Herança + Rollup de timer das filhas (Task1, 2026-06-18)

**Why:** dor do usuário — filha de bloco "em andamento" deve nascer no estado do bloco; mãe deve exibir soma do tempo das filhas diretas. Escopo TRAVADO (não reabrir).
**How to apply:** ao mexer em `TasksService.create()`/`buildResponse()`/leitura de tasks.

## Frente 1 — herança no create() (`src/tasks/tasks.service.ts`)
- O `select` do pai (dentro do `if (dto.idPai...)`, ~l.338) JÁ existia pegando `{idProject, idClasse}`; expandi com `idAssignee, idStatus, idPriority, dueDate` → ZERO query nova.
- `paiExiste` é escopado dentro do `if`. Para usar no `$transaction`, declarei `inheritedFromParent` ANTES do `if` e capturei DEPOIS do `validateNoCycle`.
- Merge DTO-vence-pai computado no FIM do ramo TASK (`else`), em vars `finalIdStatus/finalIdPriority/finalIdAssignee/finalDueDate`; o `tx.dTask.create` data usa essas finais (`isPhase ? null : final...`). PHASE permanece null em tudo.
- **idStatus (§7 — ANTI-REGRESSÃO):** `inheritedFromParent && pai.idStatus !== null ? pai.idStatus : inboxStatusChave`. Task SEM pai → `inheritedFromParent` é null → INBOX. Pai PHASE (idStatus null) → cai no INBOX. CreateTaskDto NÃO tem campo `status` (confirmado) → não existe ramo "DTO força status".
- priority/assignee/dueDate: `dto.X ? <do DTO> : inheritedFromParent?.X ?? null/undefined`. dueDate herdado = Date do pai; sem DTO e pai null → `undefined` (coluna não tocada).

## Frente 2 — rollup on-read (`buildChildrenTimeRollupMap` + buildResponse)
- Helper privado novo `buildChildrenTimeRollupMap(taskChaves: bigint[]): Promise<Map<string, number>>` — 1 query `dTask.findMany({where:{idPai:{in:lote},excluido:false}, select:{idPai,dados}})`, soma `telemetry.manualTimers` via `taskTimerService.totalMs` (fonte única), agrupa por `idPai.toString()`. **Presença da chave no map = é mãe** (mesmo soma 0).
- **GUARD DEFENSIVO OBRIGATÓRIO:** `if (!Array.isArray(children) || children.length === 0) return map;` — sem o `Array.isArray`, o `tasks.service.spec.ts` (que NÃO mocka `dTask.findMany` nos testes de update/updateStatus/findOne) quebra com `Cannot read properties of undefined (reading 'length')` → +25 falsos negativos. Com o guard: ZERO regressão.
- `buildResponse` ganhou 5º param `rollupMap?: Map<string,number>`. Novo cálculo: `hasChildren = rollupMap?.has(taskIdStr) ?? false`; `timeSpentIsRollup = hasChildren`; `timeSpentLabel = hasChildren ? formatTotalLabel(rollupMap.get(id)) : ownTimeLabel`. Renomeei o label antigo para `ownTimeLabel`.
- Wiring: `findMany` e `findOne` montam `rollupMap` (batch / [task.chave]) e passam como 5º arg. `update`/`updateStatus` também passam (`buildResponse(updated, priorityMap, undefined, undefined, rollupMap)`) para coerência. `create` NÃO passa (task nova não tem filhas → hasChildren=false default). `timer()` herda via `findOne`.

## DTO (`src/tasks/dto/task-response.dto.ts`)
- 2 campos novos `@ApiProperty` (não-opcionais): `hasChildren!: boolean` + `timeSpentIsRollup!: boolean`. `timeSpentLabel` reusado (doc atualizada: mãe=soma filhas; folha=own-time).

## NÃO toquei (confirmado git status)
`TaskTimerService.start/close`, `PhaseTreeService`/tree, `prisma/schema.prisma`, `prisma/seeds/`. Rollup é 100% leitura — folha inicia timer normalmente.

## Testes (2 specs novos, 13 casos, todos verdes)
- `__tests__/tasks-inheritance.spec.ts` (6) + `__tests__/tasks-time-rollup.spec.ts` (7).
- **Mock module precisa incluir `ProjectRefService`** (`resolveEntidadeRef` passthrough P→P) — `tasks.service.create-phase.spec.ts` OMITE isso e por isso falha no BASELINE (missing provider, 10 fails pré-existentes; NÃO é regressão minha).
- GOTCHA mock priority no create: `resolvePriorityId` usa `tx.dTabela.findFirst` (DENTRO da transaction), não `this.prisma`. No mock da $transaction, o `tx.dTabela.findFirst` deve discriminar por `where.idClasse` (-441=INBOX vs -42X=priority) senão devolve INBOX pra tudo.
- GOTCHA rollup: `dTask.findMany` é chamado 2x no findMany (page query + rollup). Mock por `where.idPai?.in` para separar. Caso 13 valida 1 só chamada de rollup com `idPai IN [todo o lote]` (ZERO N+1).

## Build/lint/test
- `make build` (npm run build) FALHA só em `src/realtime` (@nestjs/websockets/socket.io ausentes) + `src/ai` (@anthropic-ai/sdk, openai ausentes) — PRÉ-EXISTENTE do ambiente. Gate real = `npx tsc --noEmit` (0 erros em src/tasks) + `npx eslint "src/tasks/**/*.ts" --max-warnings 0` (exit 0).
- Baseline `npx jest src/tasks`: 49 failed/251 passed/300. Pós: 49 failed/264 passed/313 (+13 meus, failed inalterado = ZERO regressão). 4 suites FAIL pré-existentes: tasks.service.spec (24 state-machine validTransitions), tasks.service.create-phase / tasks.service.custom-fields / tasks-phase-list-filters (missing ProjectRefService provider).
- **Hook eslint roda PostToolUse:Edit e BLOQUEIA com exit 2** em cada `no-unused-vars` transitório — esperado ao introduzir var antes de consumi-la; ignore até o consumidor existir.
