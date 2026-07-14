---
name: unificacao-nexus-mcp-onda3
description: Onda 3 (13 reads so-MCP) da unificacao Nexus<->MCP (ADR-V2-079) — migradas p/ Capability, nascem no Nexus; golden e tools/list (26) intactos; 2 specs pre-existentes stale corrigidos.
metadata:
  type: project
---

# Unificacao Nexus <-> MCP — Onda 3 (13 reads so-MCP) concluida

Fonte de verdade do plano: `workspace/plans/plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md` (ADR-V2-079).
Onda 0: [[unificacao-nexus-mcp-onda0]]. Onda 1 (create_task): [[unificacao-nexus-mcp-onda1]].
Onda 2 (comments no MCP): [[unificacao-nexus-mcp-onda2]].

**Why:** migrar as 13 tools de LEITURA que so existiam no MCP para
Capabilities, fazendo-as nascer TAMBEM no Nexus. Lote de MENOR risco
(idempotentes, zero efeito colateral) — valida migracao em lote antes das
Ondas 4 (writes) e 6 (execute_task).
**How to apply:** ao pegar Onda 4 (9 writes so-MCP), o padrao de replug com
FALLBACK legado (`resolveToolWithFallback`, generico) ja esta pronto — so
adicionar capabilities novas + entrada no array `tools` do router. Escrita
exige atencao extra a `principal.can(scope)` (ja provado aqui, mas Onda 4
grava dados — cross-tenant test mais rigoroso).

## Diferenca de padrao vs Onda 2 (importante)

Onda 2 = tools NASCEM no MCP (sem fallback, `resolveCapabilityOnlyTool`,
JSON schema PRECISA ganhar entrada nova). Onda 3 = tools JA EXISTIAM no MCP
(usa fallback, `resolveToolWithFallback` generico, JSON schema **NAO muda**
— `tools/list` continua com 26, golden **totalmente intocado**, nao houve
re-baseline nesta onda).

## Arquivos-chave criados

13 capabilities em `src/common/tool-capabilities/capabilities/`:
- `tasks/`: `get-task`, `get-task-tree`, `list-tasks`, `list-my-tasks`, `search-tasks`
- `projects/`: `get-project`, `list-projects`, `get-project-metrics`
- `blocks/`: `list-blocks`, `list-block-tasks`
- `misc/` (dir NOVO): `list-members`, `list-notifications`, `get-unread-count`

Cada uma: casca fina sobre o MESMO service que a tool MCP legada correspondente
ja chamava (TasksService/ProjectsService/ProjectMembersService/SearchService/
DashboardService+ForecastService/NotificationsService); `inputSchema` copiado
BYTE A BYTE do `*.tool.ts` legado; `requiredScopes` espelhado 1:1 do
`requireScope(ctx, MCP_SCOPES.X)` que a tool legada ja usava (nenhum scope
novo — 11 usam `tasks:read`, 2 usam `notifications:read`, nenhuma tinha `[]`).

## Arquivos modificados

- `tool-capabilities.module.ts` — importa `NotificationsModule`, `SearchModule`,
  `FlowMetricsModule`, `ForecastModule` (`forwardRef`, mesma disciplina das
  Ondas 1/2); registra as 13 no array `providers` + `onModuleInit`
  (`registerIfAbsent`, ja generico desde a Onda 2 — zero mudanca de padrao).
- `mcp-router.service.ts` — NOVO metodo privado generico
  `resolveToolWithFallback(capabilityName, legacyTool, capabilityAdapter)`
  (mesma logica de `resolveCreateTaskTool`, mas parametrizado por nome —
  evita duplicar 13x o mesmo par if/return). Aplicado nas 13 posicoes do
  array `tools` que ja injetavam os wrappers legados (`listTasksTool`,
  `getTaskTool`, `listProjectsTool`, etc.) — cada wrapper legado continua
  injetado no construtor (posicoes inalteradas), o array agora decide
  adapter-vs-legado por tool. `tools/list` **nao mudou** (continua vindo do
  JSON estatico, que ja continha essas 13 entradas desde antes da Onda 3).
- `ai/tools/tool-registry.ts` / `nexus-capability.adapter.ts` — **ZERO
  mudanca de codigo**. `NexusCapabilityAdapter.buildAll(ctx, scopeResolver)`
  ja itera `registry.list()` inteiro (desde a Onda 1) — as 13 capabilities
  novas aparecem automaticamente no Nexus so por estarem registradas no
  module. Prova de que o design da Onda 0 (adapters genericos) escala sem
  replug manual por capability nova no lado Nexus.

## GOTCHA critico: 2 specs pre-existentes ficaram STALE desde a Onda 2 (nao Onda 3)

Ao rodar a suite filtrada completa, 2 specs quebraram que NAO sao causadas
pela Onda 3 — sao consequencia nao-testada da Onda 2 (`tools.schema.json`
24->26, nunca rodado nesses 2 specs antes):

1. **`mcp-block-d.spec.ts`** — `expect(toolsSchema.tools).toHaveLength(24)`
   hardcoded + array de nomes sem `create_comment`/`list_comments`. Corrigido
   p/ 26 + nomes completos (mesmo padrao que `mcp-router.create-task-capability.spec.ts`
   ja tinha corrigido na propria Onda 2, mas este arquivo ficou pra tras).
2. **`mcp-tools.schema-consistency.spec.ts`** — comparava
   `registeredTools.length === schemaEntries.length` 1:1, mas
   `create_comment`/`list_comments` NUNCA tiveram `*.tool.ts` legado
   (capability-only desde que nasceram, Onda 2) — cardinalidade quebrada.
   Corrigido com `CAPABILITY_ONLY_TOOL_NAMES = ['create_comment', 'list_comments']`
   como isencao explicita nos 2 testes de cardinalidade/correspondencia
   (comentado no topo do arquivo, referenciando ADR-V2-079).

**Confirmado via `git stash` que ambos JA quebravam antes da Onda 3** (a
`tools.schema.json` com 26 entradas era diff de trabalho nao commitado desde
a Onda 2) — corrigi por estarem no raio de acao direto desta onda (tocam
`list_tasks`/`get_task` etc. que agora tambem sao capability), nao por
regressao introduzida aqui.

## Testes novos desta onda

- 13 arquivos `*.capability.spec.ts` (1 por capability) — metadados
  (name/requiredScopes), happy path com service mockado, tenant gate
  (scope vazio / fora do escopo -> vazio ou NotFound conforme semantica da
  tool legada), INVALID_INPUT por campo. 64 testes novos.
- `mcp-router.reads-capability.spec.ts` — prova o wire do
  `resolveToolWithFallback` com 2 amostras representativas (`get_task` 5o
  param posicional, `list_members` 7o): adapter GANHA quando capability
  registrada, fallback legado quando `capabilityAdapter` ausente, gate de
  scope FORBIDDEN, `tools/list` continua 26.
- `tool-registry.spec.ts` (Nexus) — reescrito: registry real agora com 16
  capabilities (3 das Ondas 1/2 + 13 desta onda); prova que as 13 aparecem
  automaticamente na lista do Nexus (zero wiring manual) + 1 caso completo
  (`get_unread_count`: execute + RBAC nega sem `notifications:read`).

## Resultado

- `npm run build` verde.
- Golden MCP verde, baseline **totalmente intocado** (26 tools, hashes
  FROZEN_* inalterados — Onda 3 nao mexeu no `tools.schema.json`).
- Paridade (`capability-parity.spec.ts`) verde — as 13 nascem paritarias
  (sem entrada no manifesto de isencao).
- `npx tsc --noEmit` e ESLint: ZERO erros novos introduzidos por esta onda
  (confirmado por filtro exclusivo dos arquivos tocados — os erros
  pre-existentes de `tsc --noEmit` em specs de `executions/`, `channels/`,
  `common/cache/` sao 100% alheios a esta onda, confirmados via `git stash`).
- 530 testes verdes na suite filtrada (`tool-capabilities|mcp/__tests__|ai/tools|mcp/tools`),
  +62 vs baseline da Onda 2. 4 falhas PRE-EXISTENTES remanescentes (mesmas da
  Onda 1, reconfirmadas via `git stash`): `update-timer.tool.spec.ts` (2
  asserts BigInt), `mcp-block-d.spec.ts` (timeout fake-timers — teste
  DIFERENTE do que foi corrigido aqui), `update-timer.integration.spec.ts` e
  `execute-task.integration.spec.ts` (TS2352 mocks `JsonRpcResponse`).

## Pendencia de doc (nao tocada nesta onda — Documenter formaliza no fim)

- `src/ai/README.md` ainda lista so 4 tools legadas — Documenter atualiza
  junto do ADR-V2-079 (mesma pendencia acumulada desde a Onda 1).
