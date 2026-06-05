---
name: ai-multi-provider-fase4
description: Fase 4 do multi-provider IA Nexus — AiProviderRegistry + desacoplar AiChatService do Gemini fixo (roteamento dto→pref→default)
metadata:
  type: project
---

# AI Multi-Provider Fase4 (ADR-V2-064, 2026-06-04)

Provider Registry + desacoplamento do `AiChatService`. Pilar 1 N/A (DEvento -508, sem Engine), zero tabela nova.

**Criado:** `src/ai/providers/ai-provider.registry.ts` (`AiProviderRegistry`) — recebe os 3 providers concretos no construtor, monta `Map<string,AiProvider>` por `.name`; `resolve(name)` → instância ou `BadRequestException("Provider de IA desconhecido: ${name}")` (nunca undefined); getter `defaultName='gemini'` (compat); `listNames()`.

**Roteamento** em `ai-chat.service.sendMessage` (após carregar contexto, antes do chat):
`orgPref = orgId ? await providerPref.getDefaultForOrg(BigInt(orgId)) : null` →
`providerName = dto.provider ?? orgPref?.provider ?? registry.defaultName` →
`effectiveModel = dto.model ?? orgPref?.model` →
`provider = registry.resolve(providerName)` → `provider.chat({..., ...(effectiveModel?{model}:{})})`.
1 query de pref por request (cacheada 60s no pref service) só quando há org — sem N+1.

**DTO** `send-message.dto.ts`: +`provider?` (`@IsIn(AI_PROVIDER_NAMES)`) +`model?` (`@IsString @MaxLength(100)`), ambos opcionais. Exporta const `AI_PROVIDER_NAMES = ['gemini','claude','openai'] as const` + tipo `AiProviderName` (fonte única runtime+compile).

**Module:** registrou `AiProviderRegistry` nos providers (os 3 concretos + AiProviderPrefService já estavam da Fase 2/3). JSDoc "Provider unico v1: Gemini" → multi-provider.

**GOTCHAS:**
- NÃO existia `ai-chat.service.spec.ts` — criei do zero (8 testes de roteamento). Mockei os 3 providers como stubs `{name, chat: jest.fn()}` e passei a um `AiProviderRegistry` REAL (não mock) — testa o registry junto. Demais collaborators mockados via `Pick<...>`.
- Construtor do `AiChatService` mudou ordem: `(chatMessages, toolRegistry, providerRegistry, providerPref, eventProducer, correlationId, contextBuilder)`. Quem instanciar manualmente em spec precisa seguir.
- Compat retroativa coberta por teste explícito: `opts.model === undefined` quando sem dto.model/pref.model; provider gemini chamado sem provider/pref.

**Validação:** `npm run build` EXIT 0; `npm run lint` 0 errors (114 warnings no-explicit-any pré-existentes, nenhum nos meus arquivos); `npx jest src/ai` 6 suites/49 tests verdes (6 registry + 8 routing novos).

**Fase 5 NÃO tocada:** sem AiKeysController/Service, OrgAdminGuard, GET /ai/providers, DTOs de chave. Sem alterar cascata de chave (Fase2) nem providers (Fase3).
