# ADR-V2-066: MCP Tool `execute_task` — modo assíncrono fire-and-poll

**Status:** Proposto
**Data:** 2026-06-15
**Decisores:** Strategist Agent V2 + CEO (a ratificar)
**Tags:** #V2 #fase-F11 #mcp #execution #async

---

## Contexto e Problema

A camada MCP do V2 vai ganhar uma 16ª tool — `execute_task` — capaz de **disparar execução de IA (Claude Code)** para uma DTask. A implementação delega a Pilar 1 (F6 — `OperacaoExecucaoClaude extends OperacaoPedido`), criando DPedido idClasse=-300..-303 com Risk Gate (F13) embutido.

O bloqueador concreto é **tempo de execução vs. timeout do transporte MCP**:

| Componente | Janela típica |
|------------|---------------|
| Timeout MCP atual (`MCP_REQUEST_TIMEOUT_MS` em `mcp-router.service.ts:103`) | **30 segundos** |
| Execução real Claude Code (refactor / feature / bugfix) | **30s – 10min** |
| Pre-processing F6 (classificador Risk Gate + enqueue BullMQ) | **< 2s** |

Manter a tool **síncrona** (esperar a IA terminar dentro do request MCP) garantiria timeout na maioria absoluta dos casos reais e prenderia sockets do servidor MCP durante minutos.

### Estado do transporte MCP

O transporte MCP atual deste backend é **JSON-RPC sobre HTTP** (não streamable). Não há suporte nativo a SSE/streaming no router atual (`mcp-router.service.ts`) nem na biblioteca cliente esperada (Claude Desktop / Cursor). Streaming seria mudança estrutural — fora do escopo desta task.

### Precedente interno

O bot do Telegram já usa **modo fire-and-poll** desde F11: dispara a execução, devolve um `executionId`, e o usuário acompanha via mensagens push/notifications. Alinhar MCP com Telegram reduz divergência conceitual entre os dois canais que disparam IA.

---

## Alternativas Consideradas

### Opção A — Síncrono com long-polling
Espera o Engine + worker completarem; resposta MCP só sai quando IA terminar.

**Prós:**
- UX direta para LLM cliente: recebe resultado em uma única chamada.

**Contras:**
- Falha por timeout em > 80% das execuções reais (30s vs. 30s–10min típicos).
- Sockets HTTP idle por minutos = custo de recursos + risco de retries em cadeia.
- Cancelamento difícil: cliente perde o handle ao desconectar.
- Diverge do Telegram (que já é async).

**Rejeitada** — inviável dentro do timeout MCP atual.

### Opção B — Streaming SSE (Server-Sent Events)
Tool devolve stream com eventos progressivos até `DONE`.

**Prós:**
- Sem timeout, com feedback em tempo real para o cliente.

**Contras:**
- Transporte MCP atual é JSON-RPC sobre HTTP (request/response), sem suporte a streaming.
- Mudança estrutural no `McpRouterService` + biblioteca cliente (Claude Desktop / Cursor) não suportam SSE nativamente hoje.
- Custo de implementação alto, escopo extrapola task atual.

**Rejeitada** — incompatível com o transporte atual; reabrir quando o protocolo MCP do projeto evoluir para streamable.

### Opção C — **Fire-and-poll (escolhida)**
Tool retorna **imediatamente** (< 2s) após enfileirar a execução. Cliente acompanha via `get_task` (status V3: `EXECUTING → DONE/FAILED`).

**Prós:**
- Sempre cabe dentro do timeout MCP (apenas pre-processing síncrono).
- Cancelamento trivial: cliente conhece `executionId` e pode reagir.
- Alinhado ao Telegram (mesmo modo operacional).
- Reusa o ciclo BullMQ + DEvento já existente para entregar resultado fora-de-banda.

**Contras:**
- LLM cliente precisa fazer polling de `get_task` — comportamento explicitado em `pollHint` no envelope de saída.
- Não devolve resultado final na mesma chamada (intencional).

**Adotada**.

---

## Decisão

`execute_task` opera em **modo assíncrono fire-and-poll**.

### Contrato de retorno

```json
{
  "executionId": "789",
  "taskId": "456",
  "projectId": "123",
  "status": "QUEUED",
  "riskLevel": "MEDIUM",
  "riskClassId": "-302",
  "createdAt": "2026-06-15T14:30:00Z",
  "pollHint": "Use get_task com taskId=456 para acompanhar (status V3: EXECUTING → DONE/FAILED)."
}
```

### Garantias

1. Resposta MCP devolvida em **< 2s** (apenas enqueue + Risk Gate sync).
2. `status` inicial é `QUEUED` ou `RUNNING` — nunca `DONE` ou `FAILED` no retorno desta tool.
3. `riskLevel` e `riskClassId` ecoam o veredito do Risk Gate (F13). Se `HIGH` for bloqueado por falta de aprovação, a tool **não** devolve este envelope: lança `INVALID_PARAMS reason=risk_gate_blocked` (ver ADR-V2-067 para erros de scope; ver §7 do plan para mapeamento completo).
4. Cliente acompanha via `get_task` existente (sem nova tool de polling neste escopo).

---

## Consequências

### Positivas
- **Sempre cabe no timeout MCP** — elimina classe inteira de falhas por timeout.
- **Reuso de infra existente** — BullMQ + DEvento já entregam resultado fora-de-banda.
- **Alinhamento com Telegram** — mesmo modelo mental para o CEO e usuários técnicos.
- **Cancelamento e retry triviais** — cliente conhece `executionId` desde o instante 0.

### Negativas
- **Cliente precisa fazer polling** — mitigado por `pollHint` explícito no envelope e descrição da tool.
- **Sem resultado inline** — não é breaking (esta tool é nova), mas LLMs precisam ser orientados a usar `get_task`. Descrição da tool no `tools.schema.json` enfatiza isso.

### Riscos residuais
- **R1 — Pre-processing F6 demorar > timeout.** Mitigação: medir em produção; se Risk Gate começar a estourar, mover classificador para worker (mudança em F13, fora deste ADR).
- **R2 — Cliente ignora `pollHint` e re-chama `execute_task`.** Mitigação: `ExecutionsService` já bloqueia "task already EXECUTING" (cenário 8 dos unit tests da Fase 6 do plan).

---

## Evolução futura (escopo explicitamente excluído)

- **Modo `wait=true` opt-in** (síncrono com long-polling): reabrir quando o protocolo MCP suportar streaming nativo.
- **Tool `get_execution`** com polling rico (logs, % progresso): escopo separado.
- **Tool `cancel_execution`**: escopo separado.

---

## Referências

- [ADR-V2-005 — OperacaoExecucaoClaude extends OperacaoPedido (Pilar 1)](./ADR-V2-005-engine-operacao-pedido.md)
- [ADR-V2-006 — Risk Gate via idClasse -301/-302/-303](./ADR-V2-006-risk-via-idclasse.md)
- [ADR-V2-042 — Tenant isolation defense-in-depth (MCP)](./ADR-V2-042-tenant-isolation-defense-in-depth.md)
- [ADR-V2-067 — Scope MCP `executions:create`](./ADR-V2-067-mcp-scope-executions-create.md)
- Plan: `workspace/plans/plan-mcp-execute-task.md` §2.3 Alternativa A

---

**Redigido por:** Implementer Agent V2
**Aceito em:** _pendente CEO_
