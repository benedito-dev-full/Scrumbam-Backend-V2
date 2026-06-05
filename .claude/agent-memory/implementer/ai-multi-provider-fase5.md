---
name: ai-multi-provider-fase5
description: Fase 5 do multi-provider IA Nexus — CRUD ADMIN-only de chaves por org + OrgAdminGuard + endpoints disponibilidade/preferencia (ADR-V2-064)
metadata:
  type: project
---

# AI Multi-Provider Fase5 — Gestão de chaves CRUD ADMIN-only (ADR-V2-064, 2026-06-04)

CRUD de chaves de IA por ORG (nível org da cascata) + guard ADMIN + endpoints de disponibilidade/preferência. NÃO ligou nível user (flag `ENABLE_USER_LEVEL_KEYS` segue false). Plaintext sem cripto (R-2).

**Why:** expor gestão das chaves Claude/OpenAI/Gemini ao ADMIN da org via `ai/keys`, com masking obrigatório e gate ADMIN — o que o `/tabela` genérico não faz com segurança (Pilar 2: controller específico justificado, plano §3).

**How to apply:** ao mexer em `ai/keys` ou qualquer gate ADMIN-org.

## Investigação do guard (resultado)
- NÃO existia guard reutilizável de ADMIN-org. Procurei em src/organizations, src/auth, src/common (Glob `src/**/guards/*.ts` + Grep `OrgAdmin|OrgRole|161|ADMIN`). O RBAC ADMIN das orgs mora num helper **PRIVADO** de service (`OrganizationsService.requireAdminRole`, l.742), não exposto como guard. Criei `src/ai/guards/org-admin.guard.ts` (1ª extração desse padrão p/ camada HTTP).
- **DIREÇÃO EXATA do DVincula -161 (confirmada em organizations.service.ts requireAdminRole):** `idLocEscritu = ORG` (dono do vínculo), `idEntidade = USER`, `idClasse = -161`. **O PLANO (linha 182) SUGERIU INVERTIDO** (`idLocEscritu: userEntidadeId, idEntidade: orgId`) — IGNORAR o plano, seguir o código real. Errar a direção desliga o gate silenciosamente.
- Guard lê `req.user.organizationId` (BigInt) + `req.user.entidadeId`. Sem org → `BadRequestException` (400, erro de uso, não permissão). Sem vínculo ADMIN → `ForbiddenException` (403). Só injeta PrismaService (CommonModule @Global) — NÃO precisou importar OrganizationsModule.

## Arquivos
- Criados: `guards/org-admin.guard.ts`(+spec), `ai-keys.service.ts`(+spec), `ai-keys.controller.ts`(+spec), DTOs `upsert-ai-key.dto.ts`/`ai-key-response.dto.ts`(masked, SEM campo plaintext/key)/`set-provider-pref.dto.ts`/`ai-provider-availability.dto.ts`.
- Modificados: `ai.module.ts` (+AiKeysController em controllers, +AiKeysService +OrgAdminGuard em providers), `ai-provider-pref.service.ts` (M1: setDefaultForOrg agora em `$transaction`), `ai-chat.service.ts` (MINOR JSDoc "chamada Gemini"→"chamada ao provider", l.25-26), `ai-provider-pref.service.spec.ts` (mock `$transaction`).

## Decisões/padrões
- **provider→idClasse**: replicado LOCAL em ai-keys.service `PROVIDER_ID_CLASSE` (gemini→-481/claude→-482/openai→-483) — o resolver NÃO exporta o mapa. Novo provider = +1 aqui +1 no resolver +1 seed. AI_PROVIDER_NAMES/AiProviderName reusados de `dto/send-message.dto.ts` (fonte única).
- **Masking**: prefix = primeiros 8 chars (espelha api-key.service -471), masked = `prefix…últimos4`. dados = `{ plaintext, prefix, hash(sha256), createdBy, createdAt, lastRotatedAt }`. toResponse NUNCA inclui plaintext.
- **Rotação**: UPDATE no registro ativo existente (resolver lê `orderBy chave desc`, registro continua o mais novo) preservando createdAt; senão CREATE. Delete = `updateMany excluido:true` em TODOS registros ativos do escopo (defesa multi-registro). Delete inexistente → 404 NotFound.
- **Invalidação de cache do resolver**: após upsert/delete chama `keyResolver.invalidateScope(provider, 'org', orgId)` — sem isso a chave nova só valeria após TTL 60s do resolver.
- **Validação de formato TOLERANTE**: só rejeita vazio/curto (DTO minLength=10); prefixo inesperado (`AIza`/`sk-ant-`/`sk-`) gera `logger.warn`, NÃO rejeita (vendor pode mudar prefixo).
- **orgId SEMPRE do JWT** (`req.user.organizationId`), nunca do body — impede cadastrar chave p/ outra org.
- **Guards por rota**: POST/GET/DELETE `/ai/keys` + PUT `/ai/preference` = `AuthCompositeGuard, OrgAdminGuard` (ADMIN). GET `/ai/providers` + GET `/ai/preference` = só `AuthCompositeGuard` (membro vê disponibilidade/preferência, nunca a chave). Controller `@Controller('ai')` (rotas keys/providers/preference); guards POR ROTA (não classe) pois nem toda rota é ADMIN.
- **M1 atomicidade resolvido**: `setDefaultForOrg` agora `prisma.$transaction(async tx => find→update/create)`. Read-then-write serializado evita race de 2 concorrentes criando 2 registros.

## GOTCHAS
- **AiKeyDados interface NÃO é assignable a `Record<string,unknown>`** (TS interfaces sem index signature implícita) → `toResponse(provider, { ...dados })` (spread cria record). Mesmo motivo do cast `as unknown as Prisma.InputJsonValue` em create/update.
- **Quebra de spec existente ao adicionar `$transaction`**: ai-provider-pref.service.spec mockava prisma sem `$transaction` → `TypeError: $transaction is not a function`. Fix: mock `$transaction: jest.fn((cb) => cb(mock))` (executa callback com o próprio mock como tx, preserva assertions sobre dTabela.create/update). SEMPRE que adicionar $transaction num service já testado, atualizar o mock.
- **Controller spec**: `.overrideGuard(AuthCompositeGuard).useValue({canActivate:()=>true})` + idem OrgAdminGuard — evita montar container auth. Autorização real testada no org-admin.guard.spec isoladamente.
- **Teste de não-vazamento**: `expect(JSON.stringify(res)).not.toContain('<secret>')` + `expect((res as ...).plaintext).toBeUndefined()` em service E controller spec.

## Validação (tudo verde)
- `npm run build` (nest build) PASS — 1ª vez build completo OK (deps IA já instaladas das fases anteriores; `make` não existe no Win).
- `npx eslint "src/ai/**/*.ts"` exit 0.
- `npx jest src/ai` = 70/70 passed, 9 suites (era 49 antes; +21 novos, zero regressão).
- tsc `--noEmit` grep src/ai/ = ZERO erros.
- Seed Fase1 já tinha -481..-484 (confirmado, não toquei).

NÃO feito (fora de escopo): Fase 6 (erros transversais por vendor), Fase 7 (ADR-V2-064 redação + README + Swagger global). Nível user continua desligado.
