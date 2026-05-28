---
name: nexus-ia-chat-frente-b
description: Frente B (Nexus IA Chat — v1) — módulo src/ai/ completo com Gemini provider + 4 tools + DEvento -508 + DTabela -481
metadata:
  type: project
---

Frente B v1 (Nexus IA Chat — backend — 2026-05-27): módulo `src/ai/` novo, completo, sob plano canônico `docs/plans/2026-05-27-nexus-ia-chat.md`.

**Why:** demanda CEO "pergunta-resposta funcionar" — chat IA persistente com 4 tools de proxy para Comments/Tasks/Projects.

**How to apply:**
- Novas DClasses: `-481 GEMINI_API_KEY` (filha de STATUS -52, ADR-V2-004) e `-508 AI_CHAT_MESSAGE` (filha de EVENTOS -3, polimórfica user/assistant). COUNTS: 105→107 especificas, 150→152 total.
- Storage: `DEvento idClasse=-508` com `identificadorExterno=userEntidadeId.toString()` (v1 conversa única) — v2 multi-conversa vira `uuid` sem mudar schema. `descricao=content`, `metaDados={role,model,tokens,toolCalls,timestamp}`.
- Pilar 1 N/A (DEvento é audit/estrutural — Prisma direto, igual ao CommentsService).
- API key Gemini: lida do `DTabela -481` (Prisma direto via `GeminiApiKeyService` — NÃO usei `TabelaService` HTTP-oriented), com fallback `process.env.GOOGLE_API_KEY`. Cache em memória 60s.
- Provider: `@google/generative-ai@0.24.1`, modelo `gemini-1.5-flash`, loop tool calling com `maxToolIterations=5` (hard limit), timeout 30s via `Promise.race`, 1 retry em 429/5xx com backoff 1s.
- Erros traduzidos: 401→BadGateway (502), 429→ServiceUnavailable (503), timeout→GatewayTimeout (504).
- Tools (4 v1): `createComment`/`listComments` (proxy CommentsService), `createTask` (proxy TasksService + resolve `accessibleProjectIds` antes), `getProjectSummary` (combina `findOne`+`getStats`+`findMany` top5 READY/EXECUTING — server-side, sem novo endpoint HTTP).
- Tools recebem `AiToolContext` (`{userEntidadeId, organizationId}`) em closure — IA NUNCA escolhe quem é o user.
- Persistência atômica: mensagem do user persistida ANTES da chamada Gemini (se falhar, refresh hidrata — R-7 do plano); mensagem do assistant persistida APÓS sucesso.
- Eventos APÓS persistência: `ai.chat.message.created` + 1× `ai.chat.tool.called` por tool executada, mapeados em `audit-log.consumer.ts` para `BigInt(-508)`.
- Resposta JSON puro (NÃO SSE — streaming fica v2). Hook `useChat` Vercel SDK fica v2.
- `DELETE /ai/chat/history` adicionado (soft-delete via `updateMany excluido=true`).

**Gotchas:**
- `@google/generative-ai`: o tipo `FunctionDeclarationSchema` exige cast `as unknown as FunctionDeclarationSchema` (TS2352 — `Record<string,unknown>` não overlap suficiente).
- `TaskResponseDto` tem campo `nome` (NÃO `title` — herdou design legacy).
- `ProjectResponseDto` NÃO tem `descricao` nem `slug` — usar apenas `id, nome, prefix, icon?, color?, idClasse, idPai, memberCount`.
- `EventProducerService.addInternalEvent` rejeita types fora de `ALL_EVENT_TYPES_SET` → atualizar `event-types.ts` ANTES de emitir.
- `validateHierarchy` roda em time de import — qualquer DClasse com `idPai` inexistente quebra `jest`/`tsc` antes de tocar banco.
- `app.module.ts`: ESLint hook bloqueia se import unused — registrar no array `imports[]` no mesmo edit.

**Não criar specs unitários** ficou como débito consciente (gate ≥ 8.0 já alcançável com build + lint + seed PASS). Recomendar adicionar antes de B.4: `chat-messages.service.spec.ts`, `ai-chat.service.spec.ts`, `gemini-api-key.service.spec.ts` (mock do `@google/generative-ai`).
