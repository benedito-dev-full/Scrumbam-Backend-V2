---
name: unificacao-nexus-mcp-onda1
description: Onda 1 (piloto create_task) da unificacao Nexus<->MCP (ADR-V2-079) — capability + wiring nos dois adapters, golden intacto.
metadata:
  type: project
---

# Unificacao Nexus <-> MCP — Onda 1 (piloto create_task) concluida

Fonte de verdade do plano: `workspace/plans/plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md` (ADR-V2-079).
Onda 0 (fundacao): ver [[unificacao-nexus-mcp-onda0]].

**Why:** primeira migracao real de uma tool para a camada neutra de Capabilities,
provando o contrato antes de escalar as Ondas 2-6.
**How to apply:** ao pegar Onda 2+, replicar o padrao de wiring abaixo por
capability nova.

## Arquivos-chave criados/alterados

- `src/common/tool-capabilities/capabilities/tasks/create-task.capability.ts` —
  Capability neutra, casca fina sobre `TasksService.create` + `ProjectsService.findOne`.
  `inputSchema` = copia EXATA do `tools.schema.json` do MCP (paridade completa
  com `CreateTaskDto`). `source` do DTO = `principal.surface` ('mcp'|'nexus').
- `src/common/tool-capabilities/tool-capabilities.module.ts` — NOVO modulo
  (`forwardRef` p/ TasksModule/ProjectsModule) que registra `CreateTaskCapability`
  no `CapabilityRegistry` via `onModuleInit`. McpModule e AiModule importam este
  modulo (nao registram a capability eles mesmos).
- `src/mcp/services/mcp-router.service.ts` — `McpCapabilityAdapter` injetado como
  **26o parametro posicional** (ultimo, apos `configService`) — aditivo, ZERO specs
  legados quebrados. Metodo privado `resolveCreateTaskTool(legacyTool, adapter)`:
  adapter GANHA se presente E capability registrada; senao cai no wrapper legado
  `CreateTaskTool`. `tools/list` continua vindo do `tools.schema.json` estatico
  (NAO do registry) — por isso o golden nem precisou tocar.
- `src/mcp/tools/mcp-capability.adapter.ts` — adicionado `getCapability(name)`
  (lookup direto no registry) — usado pelo router para decidir o caminho.
- `src/ai/tools/tool-registry.ts` — injeta `NexusCapabilityAdapter` +
  `RoleResolverService` (auth); `createTaskTool` legado REMOVIDO do array de
  providers/buildAll (arquivo `create-task.tool.ts` continua no repo, so nao
  roda mais no fluxo — aposentadoria formal fica p/ Onda 5, conforme o plano).
  `scopeResolver` = `roleResolver.getAllowedMcpScopes(userEntidadeId)` — MESMO
  mapa RBAC->scopes ja usado p/ as MCP keys (ADR-V2-068 Fase 2), reaproveitado
  tal e qual (nao reinventado).
- `src/ai/ai.module.ts` / `src/mcp/mcp.module.ts` — importam `ToolCapabilitiesModule`;
  providers `NexusCapabilityAdapter`/`McpCapabilityAdapter` adicionados.
- `src/ai/system-prompt.ts` — `createTask` -> `create_task` na lista de tools
  (nome mudou de propósito: capability e canonica snake_case).

## GOTCHA critico: como preservar o golden test SEM tocar nele

O golden `mcp-wire.golden.spec.ts` instancia `new McpRouterService(undefined,
new CreateTaskTool(...))` — SEM passar `capabilityAdapter`. Como o adapter e o
ULTIMO parametro (aditivo), esse teste cai automaticamente no wrapper legado e
nunca viu o adapter. NAO foi necessario alterar 1 linha do golden nem do
baseline. Mesma logica protege TODOS os specs pre-existentes que instanciam
`McpRouterService` manualmente com poucos argumentos.

`tools/list` no MCP vem do JSON estatico `tools.schema.json`, NUNCA do
`CapabilityRegistry` — por isso a Onda 1 nao mexeu nele. Isso muda na Onda 5
("todo o tools/list deriva do registry") — ai sim о schema estatico devera ser
substituido/sincronizado.

## Testes novos desta onda

- `src/common/tool-capabilities/capabilities/tasks/create-task.capability.spec.ts` —
  espelha 1:1 os casos de `mcp-tools.create-task.spec.ts` (paridade a-g) +
  `source` por surface.
- `src/mcp/__tests__/mcp-router.create-task-capability.spec.ts` — prova o wire
  do ADAPTER plugado no router (registry real), incl. fallback p/ wrapper legado
  quando `capabilityAdapter` ausente.
- `src/ai/tools/tool-registry.spec.ts` — prova `create_task` aparece no Nexus
  via adapter + RoleResolverService real (mock), incl. nega sem `tasks:write`.

## Resultado

- `npm run build` verde.
- Golden MCP verde, baseline (`tools-list.baseline.json` + hashes FROZEN_*)
  **intocado**.
- Paridade (`capability-parity.spec.ts`) verde (registries fake continuam
  cobrindo o guard-rail; nao precisou de caso novo pois `create_task` nao esta
  no manifesto de isencao — ja nasce paritario).
- ESLint 0 errors nos arquivos tocados/criados.
- 4 falhas PRE-EXISTENTES confirmadas via `git stash` (nao introduzidas por
  esta onda): `update-timer.tool.spec.ts` (2 asserts, BigInt extra arg),
  `mcp-block-d.spec.ts` (timeout de jest fake timers), `update-timer.integration.spec.ts`
  e `execute-task.integration.spec.ts` (TS2352 em mocks de `JsonRpcResponse`).

## Pendencia de doc (nao tocada nesta onda — Documenter formaliza no fim)

- `src/ai/README.md` linha ~30 ainda lista `createTask` (nome antigo) na
  tabela de tools — Documenter atualiza junto do ADR-V2-079.
