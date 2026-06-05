---
name: ai-multi-provider-fase2
description: Fase 2 do multi-provider IA Nexus — AiKeyResolverService (cascata user→org→global→env) + AiProviderPrefService (-484) + religar Gemini ao resolver; GeminiApiKeyService aposentado
metadata:
  type: project
---

# Multi-Provider IA Nexus — Fase 2 (ADR-V2-064, 2026-06-04)

Núcleo da cascata de resolução de chave + preferência de provider da org. Plano: `workspace/plans/plan-ai-multi-provider-nexus-task1.md`.

**Why:** CEO quer escolher Claude/OpenAI/Gemini no chat Nexus; Fase 1 (seed -482/-483/-484) já aprovada 9.0/10. Fase 2 generaliza o mono-provider `GeminiApiKeyService` em resolver multi-provider+multi-nível, sem ainda criar providers Claude/OpenAI (Fase 3) nem registry (Fase 4) nem CRUD de chaves (Fase 5).

**How to apply:** Ao continuar (Fase 3+), o resolver e o pref service já existem e estão religados ao Gemini. Padrão de chave: `dados.plaintext` em DTabela por idClasse+dEntidadeId (espelha ApiKeyService -471). Acesso estrutural Prisma direto — Pilar 1 N/A (NÃO criar Operação para chaves).

## Arquivos
- CRIADO `src/ai/ai-key-resolver.service.ts` — `AiKeyResolverService.resolveKey({provider,orgId?,userEntidadeId?})`. Mapa estático `PROVIDER_KEY_CONFIG` (gemini→-481/GOOGLE_API_KEY, claude→-482/ANTHROPIC_API_KEY, openai→-483/OPENAI_API_KEY). Cascata para no 1º hit: user (guardado por flag) → org → global(dEntidadeId=null) → env. Cache Map por escopo `${provider}|${level}|${ownerId}` TTL 60s; `invalidateCache()` + `invalidateScope()`. orgId/userEntidadeId são **bigint**.
- CRIADO `src/ai/ai-provider-pref.service.ts` — `getDefaultForOrg(orgId): {provider,model?}|null` em DTabela -484 dEntidadeId=orgId. Setter `setDefaultForOrg` implementado mas SEM controller (exposição via endpoint é Fase 5). Cache por org TTL 60s.
- CRIADOS 2 specs (16 testes, todos verdes): cascata (org/global/env/miss→erro), flag user OFF não consulta nível user, cache, plaintext vazio ignorado; getter pref (com/sem model/null/inválido/cache) + setter (create/update).
- DELETADO `src/ai/gemini-api-key.service.ts` (aposentado — plano linha 150). Grep antes confirmou refs só em ai.module + gemini.provider (ambos religados) + docs/memory (não-código).
- MOD `src/ai/providers/gemini.provider.ts` — `keyService:GeminiApiKeyService` → `keyResolver:AiKeyResolverService`; `resolveKey({provider:'gemini',orgId?,userEntidadeId?})`; suporta `opts.model` override (`modelName = opts.model ?? GEMINI_MODEL`) em getGenerativeModel E no result.model.
- MOD `src/ai/providers/ai-provider.interface.ts` — `AiProviderChatOptions` ganhou campos OPCIONAIS `model?:string`, `orgId?:bigint`, `userEntidadeId?:bigint` (não quebra implementações).
- MOD `src/ai/ai-chat.service.ts` — passa `userEntidadeId` + `orgId: BigInt(organizationId)` (org é string no service) ao `gemini.chat()`. Mínimo: só chave, não roteamento (registry é Fase 4).
- MOD `src/ai/ai.module.ts` — removido GeminiApiKeyService, registrados AiKeyResolverService + AiProviderPrefService; JSDoc atualizado.
- MOD `prisma/seeds/classes.seed.ts` linha ~360 comentário "109 especificas = 154" → "112 / 157" (pedido do Reviewer Fase 1).

## Flag ENABLE_USER_LEVEL_KEYS (degrau user DESLIGADO)
Const top-level no resolver: `const ENABLE_USER_LEVEL_KEYS = process.env.ENABLE_USER_LEVEL_KEYS === 'true'`. Default false → nível user é PULADO na cascata (código presente, guardado). Gravação de chave por user é Fase futura.

## Gotchas
- **Prisma Json em create/update**: `dados: Record<string,unknown>` dá TS2322 (espera `Prisma.InputJsonValue`). Fix: `import { Prisma } from '@prisma/client'` + `const dados = obj as Prisma.InputJsonValue`. (resolver só LÊ dados → não teve problema; só o setter do pref.)
- **Build OK**: `npm run build` (nest build) PASSA — `@google/generative-ai` JÁ está instalado no dev agora (memória antiga dizia ausente; mudou). `npm run lint` 0 errors (114 warnings pré-existentes, nenhuma nos meus arquivos). `npx jest src/ai --silent` 16/16 verdes.
- **Seed count real**: `npm run seed:classes:dry` = "45 fixas + 112 especificas = 157". COUNTS é computado dinâmico (`.length`), só o comentário-texto estava errado. /seed-validate (grep `chave:`) não pega `esp(...)`.
- Teste "miss total" emite `logger.error ai_key_missing` no output do jest — é ESPERADO (assert do InternalServerErrorException), não é falha.
- Compat retroativa Gemini: sem provider/org → resolveKey({provider:'gemini'}) vai direto a global(dEntidadeId=null)→env — idêntico à v1.
