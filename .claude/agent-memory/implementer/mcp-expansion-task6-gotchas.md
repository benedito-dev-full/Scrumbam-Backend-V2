---
name: mcp-expansion-task6-gotchas
description: Gotchas da Task #6 (MCP get_project com include[]) — design da tool, paralelizacao, helpers inline
metadata:
  type: project
---

# MCP Expansion Task #6 — `get_project` (com `include[]`)

**Data:** 2026-05-14
**Commit-ready:** ainda nao commitado (Implementer nao commita)
**Total testes MCP apos esta task:** 87 → 99 passing (+12 specs nesta task)

## Decisao chave: UMA tool com `include[]`

Strategist §4.4 fechou: `get_project` e UMA tool com `include[]` opcional. Valores aceitos: `members` | `sprints` | `stats`. Sem `include` retorna so projeto base. `activity` foi explicitamente EXCLUIDO desta task.

**Razao:** reduz round-trips do LLM. Em vez de 4 calls (`get_project_base` + `list_members` + `list_sprints` + `get_project_stats`), o LLM faz UMA call com `include: ['members','sprints','stats']`.

**Why:** menor latencia + menor consumo de tokens em fluxos onde o LLM precisa de dados agregados.
**How to apply:** padrao reaplicavel para Task #8 (`get_project_metrics`) se for necessario combinar paineis. Sempre prefira UMA tool com `include[]` a multiplas tools fragmentadas para o MESMO recurso.

## Composicao do payload

`result: Record<string, unknown> = { ...project }` — spread do `findOne` (ProjectResponseDto), depois `result.members = ...` etc CONDICIONAIS. NUNCA setar keys com `undefined` (poluiriam o output JSON-RPC).

```typescript
const wantsMembers = include.includes('members');
// ...
const [project, members, sprints, stats] = await Promise.all([
  this.projectsService.findOne(projectId, ctx.dEntidadeId),
  wantsMembers ? this.projectMembersService.getMembers(projectId) : Promise.resolve(undefined),
  // ...
]);

const result: Record<string, unknown> = { ...project };
if (wantsMembers) result.members = members;
// ...
```

## `getStats` chama `findOne` internamente — duplo gate aceitavel

`projectsService.getStats(id, userEntidadeId)` em `projects.service.ts:854` ja chama `this.findOne(id, userEntidadeId, organizationId)` na primeira linha. Quando a tool faz Promise.all com `findOne` + `getStats`, ocorrem 2 chamadas a findOne — performance OK (db cache) e defense in depth aceitavel.

## Helper `optionalStringArray` nao existe em `tool-params.ts`

`tool-params.ts` so tem: `assertRecord`, `optionalRecord`, `requiredString`, `optionalString`, `maxStringLength`, `optionalLimit`, `parseBigIntParam`, `invalidParams`, `textResult`. Para validar `include: string[]`, parsei INLINE via `Array.isArray` + `Set` check com `ALLOWED_INCLUDES`. Decisao: nao adicionei helper generico em `tool-params.ts` ainda — se outras tools precisarem (Task #4 talvez), abstrair entao (YAGNI no momento).

## Test de paralelizacao via `callOrder` + setImmediate

Caso (e) — include multiplo — validou paralelizacao real:

```typescript
const callOrder: string[] = [];
projectsService.findOne.mockImplementation(async () => {
  callOrder.push('findOne:start');
  await new Promise((r) => setImmediate(r));
  callOrder.push('findOne:end');
  return projectBase;
});
// ... idem para getMembers, listarPorClasse, getStats

// Assercao: TODOS os :start ocorrem antes de QUALQUER :end
const starts = callOrder.filter((c) => c.endsWith(':start'));
const firstEndIdx = callOrder.findIndex((c) => c.endsWith(':end'));
expect(starts).toHaveLength(4);
expect(lastStartIdx).toBeLessThan(firstEndIdx);
```

Padrao reaplicavel quando precisar provar Promise.all em tools futuras.

## Listar sprints via `TabelaService.listarPorClasse`

Sprint = DTabela idClasse `-400`. Para listar sprints de um projeto: `listarPorClasse({ idClasse: '-400', dEntidadeId: projectId, pageSize: 20 })`. Note: `dEntidadeId` aqui e o projectId (DTabela escopada por projeto).

Para `include: ['sprints']` paginei em 20 itens (primeira pagina) — sem cursor. Decisao consciente: se cliente quer paginar sprints, usa a tool dedicada `list_sprints`. `get_project` da o "preview".

## Gotcha eslint: imports nao-usados em Edit incremental

Hook PostToolUse:Edit trava ESLint a CADA Edit. Adicionar import + uso DEVE acontecer no MESMO Edit. Esta task confirmou novamente:

- Tentei Edit 1: adicionar import `GetProjectTool` em `mcp.module.ts` → ESLint trava com "defined but never used".
- Solucao: AGRUPAR import + provider declaration na mesma Edit (ou primeiro adicionar o uso, depois o import — mas isso e contraintuitivo). Mesmo gotcha em `mcp-router.service.ts` e `schema-consistency.spec.ts`.

## Build status

- `make build` / `npm run build` — PASS, sem warnings novos.
- `npx jest src/mcp` — 13 suites, 99 testes, 100% pass.
- `npx tsc --noEmit` — erros pre-existentes (memorias Etapa 3 confirmam: `automation/agents/__tests__/*`, `ttl-cache.service.spec`, `execution-run.processor.spec`). NENHUM erro novo introduzido por esta task.
- ESLint nos 6 arquivos modificados/criados — zero warnings.

## Append-only constructor pattern (3ª confirmacao)

Construtor `McpRouterService` cresceu para 10 parametros (9 tools + configService). Cada nova task: param novo PENULTIMO (antes do configService) + push no array `tools[]` na mesma posicao. Mocks nos specs precisam de `undefined` extra nas posicoes anteriores ao tool novo.

Em `mcp-block-d.spec.ts` os 2 construtores ganharam mais um `undefined` (de 8 para 9 antes do configService).
