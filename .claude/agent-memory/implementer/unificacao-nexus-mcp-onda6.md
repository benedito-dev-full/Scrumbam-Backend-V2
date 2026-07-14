---
name: unificacao-nexus-mcp-onda6
description: Onda 6 (ADR-V2-079) — execute_task habilitado no Nexus atrás de feature-flag + scope + confirmação; MCP intacto; padrões de wiring da flag
metadata:
  type: project
---

# Onda 6 — execute_task no Nexus (gated), ADR-V2-079

Última onda da unificação Nexus⇄MCP. `execute_task` dispara `claude -p` na VPS
(DPedido -301/-302/-303 via `OperacaoExecucaoClaude` — Pilar 1). Habilitada no
chat com TRÊS travas cumulativas.

**Why:** tool com custo real + efeito externo irreversível; merece isolamento,
flag e confirmação (o CEO avalia esta onda com atenção redobrada).

**How to apply (ao mexer em execute_task ou na camada de capabilities):**

- **Capability:** `src/common/tool-capabilities/capabilities/executions/execute-task.capability.ts`.
  Casca fina sobre `ExecutionsService.execute` (NUNCA Prisma/Engine direto — o
  service é dono do `OperacaoExecucaoClaude`). Espelha o wrapper legado
  `src/mcp/tools/execute-task.tool.ts`: findOne task → projectsService.findOne
  (membership) → `entidadeService.getUserGroupIdFromEntidade(actorEntidadeId)`
  → `execute(projectId,{taskId},userGroupId.toString())` → shape idêntico
  `{executionId,taskId,projectId,status,riskLevel,riskClassId,createdAt,pollHint}`.
  `requiredScopes=['executions:create']` (NÃO tasks:write — ADR-V2-067).
  BadRequestException→CapabilityError INVALID_INPUT reason=risk_gate_blocked;
  NotFound/Forbidden propagam.

- **Feature-flag `NEXUS_EXECUTE_TASK_ENABLED` (default OFF):** mora em
  `src/common/tool-capabilities/execute-task.flag.ts` (arquivo próprio, SEM deps
  Nest). GOTCHA que motivou o arquivo separado: o manifesto de paridade precisa
  ler a flag E o módulo também — importar a flag DO módulo criaria ciclo
  módulo↔manifesto (o módulo puxa dezenas de capabilities/forwardRefs). Padrão
  `process.env.X === 'true'` (igual `ENABLE_USER_LEVEL_KEYS` em ai-key-resolver).

- **Efeito da flag = registro condicional no módulo.** `ToolCapabilitiesModule.
  onModuleInit` chama `registerIfAbsent(executeTaskCapability)` SÓ se
  `NEXUS_EXECUTE_TASK_ENABLED`. OFF ⇒ não entra no `CapabilityRegistry` ⇒
  ausente do Nexus (e do McpCapabilityAdapter). Não precisou filtrar no
  NexusCapabilityAdapter — registrar-ou-não já é a trava.

- **MCP byte-idêntico nos DOIS estados (golden verde):** o `McpRouterService`
  serve execute_task pelo wrapper LEGADO diretamente (`executeTaskTool`, ~linha
  131), SEM passar por `resolveToolWithFallback`/adapter. Logo, mesmo com a
  capability no registry (flag ON), o router NÃO a roteia. `tools.schema.json`
  fica com `taskId` only. A capability adiciona `confirm` ao inputSchema —
  contrato SÓ-Nexus; não vaza pro wire MCP porque o MCP nunca serve o schema da
  capability.

- **Confirmação explícita:** arg `confirm:boolean` (required no inputSchema da
  capability). `confirm!==true` ⇒ CapabilityError INVALID_INPUT ANTES de
  qualquer query. `system-prompt.ts` instrui o modelo a só setar confirm=true
  após o usuário confirmar no turno.

- **Manifesto de paridade flag-aware:** `capability-parity.manifest.ts` importa
  a flag; `presentOn` de execute_task = `['mcp','nexus']` se ON, `['mcp']` se
  OFF. Parity spec prova os dois estados: OFF ⇒ so-MCP isento; ON (simulado
  registrando no registry) ⇒ aparece nos dois adapters, ZERO divergência sem
  isenção. `buildRealRegistry()` no spec continua SEM execute_task (reflete
  default OFF) — não mexer.

**Verificação:** `npx jest "execute-task" "mcp-wire.golden" "capability-parity"
"tool-capabilities" "nexus-capability" "mcp-capability.adapter" --silent` ⇒
203 pass. FALHA PRÉ-EXISTENTE (ignorar): `src/mcp/__tests__/execute-task.
integration.spec.ts` tem TS2352 (cast JsonRpcResponse) — falha em árvore limpa,
não é da Onda 6. `npm run build` exit 0 (nest build usa tsconfig.build.json que
exclui *.spec.ts, então o erro do spec não quebra o build).
