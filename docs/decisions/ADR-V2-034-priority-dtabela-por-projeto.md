# ADR-V2-034: Priority como DTabela escopada por projeto

**Status:** Aceito
**Data:** 2026-05-12
**Autor:** Implementer Agent V2 (após plano do Strategist)
**Contexto:** F4 (Tasks/DProject) — Task 01 (fix priority persistence)

---

## Contexto

`DTask.idPriority: BigInt?` foi declarado no schema canônico V2 referenciando
DTabela (`idClasse=-42X`). O seed F1 (`prisma/seeds/classes.seed.ts`) já cria
as 4 DClasses agrupadas em `-420 PRIORITY` (`-421 HIGH`, `-422 MEDIUM`,
`-423 LOW`, `-424 URGENT`).

Bug encontrado (frontend → backend debug):

1. `TasksService.create()` e `TasksService.update()` IGNORAVAM `dto.priority`,
   nunca persistindo em `idPriority`.
2. `SeedBootstrapService.seedProject()` criava 9 statuses + 1 sprint, mas
   **NÃO** criava as 4 DTabelas PRIORITY — portanto, projetos novos não
   tinham dados para lookup, e projetos legados também não.
3. DTOs aceitavam `'CRITICAL'` no enum, divergindo do seed canônico (`URGENT`).

Resultado: `PUT /tasks/:id { priority: "HIGH" }` retornava `priority: null`.

## Decisão

**Priority adota o mesmo padrão de Status:**

- Cada projeto possui suas próprias 4 DTabelas PRIORITY com
  `dEntidadeId = projectId` e `idClasse ∈ {-421, -422, -423, -424}`.
- O enum string (`HIGH/MEDIUM/LOW/URGENT`) mapeia para `idClasse` via
  constante `PRIORITY_TO_TABELA_CLASSE` no service.
- `DTask.idPriority` aponta para a **chave runtime** da DTabela (não para
  a DClasse), permitindo customização por projeto no futuro (mesma flexibilidade
  já oferecida ao Status V3).
- O bootstrap de projetos foi expandido para criar as 4 priorities
  automaticamente. Um script idempotente (`prisma/scripts/backfill-priority-tabelas.ts`)
  cobre projetos legados.
- DTOs alinham com o seed canônico: enum aceita `URGENT`, não `CRITICAL`.
- Response (`TaskResponseDto.priority`) retorna a **string enum** derivada
  do `idClasse` da DTabela referenciada, não o BigInt persistido. Lookup batch
  via `buildPriorityMap` em listas (ZERO N+1).

## Alternativas Consideradas

### A. `idPriority` aponta direto para DClasse (-421..-424)

Rejeitado. Quebra o padrão estabelecido pelo Status V3 (que aponta para
DTabela), elimina a flexibilidade de customização por projeto, e introduz
inconsistência arquitetural.

### B. Adicionar `-425 CRITICAL` ao seed

Rejeitado. O frontend e o legado já usam `URGENT`. Alterar o seed exige
re-migração; corrigir o DTO é mais simples e canônico.

### C. Manter `idPriority` em `DTask.dados.priority` (Json)

Rejeitado. O schema canônico V2 já tem o campo tipado `idPriority`. Não
podemos alterar schema canônico sem ADR justificando, e usar Json quando
existe campo tipado é anti-padrão (N+1 ao filtrar/agrupar).

## Consequências

### Positivas

- Paridade com Status V3 (precedente estabelecido).
- ZERO tabela nova (ADR-V2-001 respeitado).
- Bootstrap automático para projetos novos.
- Backfill idempotente cobre projetos legados sem migration de banco.
- Frontend pode listar opções via `GET /tabelas?classe=PRIORITY&projectId=X`
  (endpoint genérico — Pilar 2).

### Negativas

- Cada novo projeto cria 4 rows extras em DTabela (overhead irrelevante).
- Lookup adicional no `update()` para resolver enum → chave (uma findFirst).
- `buildResponse` precisa de batch lookup em listas (1 query findMany), mas
  encapsulado em helper `buildPriorityMap` (ZERO N+1 garantido).

### Fallback Comportamental

Se uma DTabela PRIORITY não existir para um projeto (ex.: backfill não rodado),
`resolvePriorityId` registra `logger.warn` e retorna `null` (em vez de lançar
BadRequest). Isso evita quebrar a operação principal de `update`/`create` por
um problema operacional de seed. O contrato `priority: null` é válido no DTO.

## Implementação

Arquivos tocados:

- `src/tasks/tasks.service.ts` — constantes `PRIORITY_TO_TABELA_CLASSE` +
  `TABELA_CLASSE_TO_PRIORITY`; helpers privados `resolvePriorityId`,
  `buildPriorityMap`, `mapPriorityEnum`; persistência em `create()` e
  `update()`; `buildResponse()` recebe `priorityMap` opcional.
- `src/tasks/dto/create-task.dto.ts` — enum `CRITICAL` → `URGENT`.
- `src/tasks/dto/update-task.dto.ts` — enum `CRITICAL` → `URGENT`; aceita
  `null` para limpar.
- `src/tasks/dto/task-response.dto.ts` — documentação do contrato `priority`
  como string enum.
- `src/projects/seed-bootstrap.service.ts` — `PRIORITY_DEFAULTS` +
  `seedPrioritiesIfMissing()` (também idempotente standalone).
- `prisma/scripts/backfill-priority-tabelas.ts` — script de backfill para
  projetos legados.
- `eslint.config.js` — incluir `prisma/scripts/**/*.ts` no glob de lint.

## Testes

7 novos testes unitários em `src/tasks/tasks.service.spec.ts`:

- `update()` persiste `idPriority="HIGH"` (DTabela existe).
- `update()` com `priority: null` limpa `idPriority`.
- `update()` sem priority no DTO não toca `idPriority`.
- `update()` com DTabela ausente persiste null + log warn (fallback silencioso).
- `update()` com priority inválida → `BadRequestException`.
- `create()` persiste `idPriority` quando dto.priority="MEDIUM".
- `create()` sem priority persiste null.

Total da suite TasksService: 77 testes PASS.

## Rollout

1. Deploy do backend com este patch.
2. Rodar `npx ts-node prisma/scripts/backfill-priority-tabelas.ts` em
   staging e prod (idempotente, seguro re-executar).
3. Frontend continua enviando `priority: "HIGH"|"MEDIUM"|"LOW"|"URGENT"`.
4. Smoke `PUT /tasks/:id { priority: "HIGH" }` → response `priority: "HIGH"`.

## Referências

- ADR-V2-001 (zero tabela nova)
- ADR-V2-009 (DTabela escopada por projeto — Sprints/Status precedente)
- `workspace/plans/plan-tasks-fix-priority-persistence-task01.md`
