# Fase 3 do ADR-V2-047 — PhaseHierarchyService (2026-05-21)

## Resumo

Service novo `src/tasks/services/phase-hierarchy.service.ts` que gerencia a
hierarquia auto-referencial de DTask via `idPai`. Integrado ao TasksService
para validar create/update e suportar cascade soft-delete.

## Gotchas

### MAX_PHASE_DEPTH configuravel

- Env var `MAX_PHASE_DEPTH` lida via `ConfigService.get`. Aceita string ou
  number. Validar com `Number.isFinite(parsed) && parsed > 0`, fallback
  `DEFAULT_MAX_PHASE_DEPTH = 20`.
- Expor `get maxDepth(): number` no service para introspeccao + testes.

### validateNoCycle no create

- No `create`, a task ainda nao existe — passar `taskId = BigInt(0)`
  como sentinela em `validateNoCycle(BigInt(0), idPaiBigInt)`.
- Esse `BigInt(0)` nao colide com chaves reais (BIGSERIAL comeca em 1),
  entao a checagem `current === taskId` nunca dispara — so a profundidade
  e o "pai inexistente/excluido" sao enforced.

### CTE recursiva tem guardrail hardcoded

- `WITH RECURSIVE ... WHERE d.depth < 20` na propria SQL. PostgreSQL nao
  aceita parametro em `WHERE d.depth < $1` quando o limite vem do template
  literal do Prisma — alinhar hardcoded com o default do service (20).
- Defesa em profundidade: o limite ja foi enforced no `validateNoCycle`
  durante o create. CTE serve so como ultima trincheira.

### TasksService.delete agora retorna `{ affected: number }`

- Antes: `Promise<void>`. Agora: `Promise<{ affected: number }>`.
- Controller (Fase 4) precisa propagar o count no response 200 ou ignorar
  o retorno se preferir manter contract 204.
- Specs e callers existentes que faziam `await delete(...)` sem capturar
  o retorno continuam funcionando (TypeScript aceita ignorar `Promise<X>`).

### Default de cascade

- `delete(id, scope, { cascade })`:
  - explicit `true` ou `false`: respeitar.
  - omitido: default = `true` se `idClasse === BigInt(-200)` (PHASE),
    `false` caso contrario.
- Decisao: tasks regulares NAO cascateiam por default mesmo com filhas
  (cenario raro mas suportado pelo schema). Comportamento consistente com
  "uma task normal nao tem semantica de fase".

### Construtor do TasksService ganhou 5o argumento

- `PhaseHierarchyService` injetado como 5o parametro.
- Atualizar TODAS as instanciações diretas em specs (`new TasksService(...)`).
- No projeto: `src/__tests__/tenant-isolation.adversarial.spec.ts` tinha
  6 ocorrencias (todas atualizadas com `{} as never` no 5o slot).
- Specs que usam `Test.createTestingModule(...)` precisam adicionar
  `{ provide: PhaseHierarchyService, useValue: mock }` aos providers.
  No `tasks.service.spec.ts`, ATENCAO: existem 2 spots distintos onde o
  modulo de teste eh montado (o beforeEach principal + 1 spec inline em
  "DEV-1 a DEV-10 sem colisao"). Atualizar AMBOS.

### Semantica do `idPai` em update (DTO)

- `UpdateTaskDto.idPai?: string | null`:
  - `undefined` → nao toca.
  - `null` → mover para raiz.
  - `string` → novo pai (valida ciclo + cross-project).
- Decorador `@ValidateIf((o) => o.idPai !== null)` antes de `@IsString()`
  permite null explicito sem falhar validacao class-validator. Mesmo
  padrao de `priority` em UpdateTaskDto.

### Idempotencia do softDeleteCascade

- CTE filtra `excluido = false` no anchor — descendentes ja excluidos sao
  ignorados.
- Task inexistente: anchor retorna vazio → `affected = 0` sem erro.
- Comportamento de "no-op silencioso" e intencional (caller pode chamar sem
  pre-check).

### TypeScript: 7 errors pre-existentes preservados

- Baseline tem 7 erros TS2554 nao relacionados a Fase 3:
  - `src/automation/agents/__tests__/agents-heartbeat.spec.ts`
  - `src/automation/agents/__tests__/agents-install.spec.ts` (2x)
  - `src/automation/agents/__tests__/agents-projects.spec.ts`
  - `src/automation/agents/__tests__/execution-result.service.spec.ts`
  - `src/common/cache/ttl-cache.service.spec.ts`
  - `src/executions/__tests__/execution-run.processor.spec.ts`
- Validar via `git stash` + `tsc` que o numero bate. Se aumentar, ha
  regressao.

### Testes pre-existentes em tasks.service.spec.ts

- Baseline: 24 failed, 53 passed (state machine V3 mudou em commit
  anterior; specs nao foram atualizados).
- Ao adicionar mock do PhaseHierarchyService no `beforeEach` principal,
  esperar a MESMA conta de falhas. Se subir para 25, falta atualizar
  algum `Test.createTestingModule` inline (caso da spec "DEV-1 a DEV-10").
