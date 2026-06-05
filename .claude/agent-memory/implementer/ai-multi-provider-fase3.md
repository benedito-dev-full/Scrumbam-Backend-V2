---
name: ai-multi-provider-fase3
description: Fase 3 do multi-provider Nexus — ClaudeProvider + OpenAiProvider implementando AiProvider, mesmas defesas do Gemini
metadata:
  type: project
---

# AI Multi-Provider Fase 3 — Providers Claude + OpenAI (ADR-V2-064, 2026-06-04)

Dois providers novos implementando `AiProvider`, molde = GeminiProvider. NÃO mexe em routing (Fase 4).

**Why:** plano `plan-ai-multi-provider-nexus-task1.md` Fase 3; Fases 1/2 já deram seed (-482/-483/-484), `AiKeyResolverService.resolveKey`, e interface com `model?/orgId?/userEntidadeId?`.

**How to apply:** ao mexer em qualquer provider de IA, espelhar exatamente o Gemini (timeout 30s Promise.race + 1 retry manual em 429/5xx backoff 1s; `callWithTimeoutAndRetry`/`translateError`/`extractHttpStatus`/`hashArgs`/`previewOutput`/`normalizeToolOutput` replicados idênticos). Reviewer compara lado a lado.

## SDKs instalados
- `@anthropic-ai/sdk@^0.100.1`, `openai@^6.42.0` — `npm install ... --save` (projeto pina com `^`, online OK). Ambos têm **default export** (`import Anthropic from '@anthropic-ai/sdk'`, `import OpenAI from 'openai'`).
- GOTCHA: `require('@anthropic-ai/sdk/package.json')` falha (ERR_PACKAGE_PATH_NOT_EXPORTED) — checar versão via `grep` no package.json, não via require do subpath.

## Tool-calling por vendor (mapeado p/ o contrato AiProviderResult)
- **Claude (Messages API)**: `system` é param top-level (NÃO mensagem role system). Sem role 'tool': resultados voltam como `role:'user'` content block `tool_result` (`tool_use_id`+`content` JSON-string, `is_error` em falha). Loop enquanto `stop_reason==='tool_use'`; extrai blocos `tool_use` (id/name/input), executa, devolve. Texto final = concat dos blocos `text`. `max_tokens` é OBRIGATÓRIO (usei 4096). finishReason: end_turn/stop_sequence→STOP, max_tokens→MAX_TOKENS, loop→TOOL_LOOP_EXCEEDED. tokens: usage.input_tokens/output_tokens. Erro extra: 529 overloaded→503.
- **OpenAI (Chat Completions)**: `system` é a 1ª mensagem `{role:'system'}`. Tool result = `{role:'tool',tool_call_id,content}`. Msg do assistant que pediu tool leva `tool_calls`. Loop enquanto `message.tool_calls`; `JSON.parse(arguments)` (defensivo `parseArgs`→{} se malformado). Texto final = `message.content`. finishReason: stop→STOP, length→MAX_TOKENS. tokens: prompt_tokens/completion_tokens. 429 (insufficient_quota+rate_limit ambos)→503.

## GOTCHA tsc — tipos do SDK Anthropic
`messages.create({...tools})` deu TS2769: tools `input_schema: Record<string,unknown>` ≠ `InputSchema` (exige `type`). Fix: montar `createParams` e castar o objeto inteiro `as unknown as Anthropic.MessageCreateParamsNonStreaming` (não thread os tipos do vendor; o provider tem suas próprias interfaces de resposta `AnthropicMessageResponse` etc.). OpenAI: `messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[]` no create — passou direto.

## Testes (mock do SDK, sem API real)
- `jest.mock('@anthropic-ai/sdk', () => ({__esModule:true, default: jest.fn().mockImplementation(()=>({messages:{create: mock}}))}))` — declarar o mock fn ANTES do import do provider (hoisting do jest.mock cobre, mas o `const xMock = jest.fn()` precisa estar no escopo de módulo). Idem OpenAI com `chat.completions.create`.
- 19 specs verdes (10 claude + 9 openai): name, resolveKey(provider certo+org/user), tradução msg/tools, loop tool (executa com args certos + resultado volta), maxToolIterations (mock sempre tool→limite respeitado), 401→BadGateway, 429→ServiceUnavailable (2 chamadas=retry), 5xx/529, não vaza chave (`rejects.not.toThrow(/sk-.../)`). Os ERROR/WARN no output são dos error-path tests (esperado).

## Registro
`ai.module.ts` providers += ClaudeProvider, OpenAiProvider (só injetável; NÃO no AiChatService — routing é Fase 4).

## Validação verde
- `npx tsc --noEmit` 0 erros nos 2 providers.
- `npm run build` (nest build) **EXIT 0** — 1ª vez passa em sessões recentes: antes falhava por `@google/generative-ai` ausente; agora todas as deps de IA presentes.
- `npx jest src/ai/providers` 19/19.
- eslint nos 5 arquivos: 0 (rodei `npx eslint <arquivos>` direto; `npm run lint` é `--fix` na árvore toda).
- NÃO toquei ai-chat.service.ts (o diff dele é da Fase 2 — `this.gemini.chat` continua único call, sem registry/routing).
