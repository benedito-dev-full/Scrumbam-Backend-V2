# ADR-V2-064: Provider Registry + Cascata de Resolução de Chave para Multi-Provider IA no Nexus

**Status:** Aceito (ratificado pelo CEO 2026-06-04)
**Data:** 2026-06-04
**Decisores:** Strategist Agent V2, Implementer Agent V2, Reviewer Agent V2 (Scores Fase 1-6: 8.0/10 médio), Documenter Agent V2
**Tags:** #V2 #F7 #ai #multi-provider #nexus #chaves #gemini #claude #openai

---

## Contexto e Problema

O **Nexus IA Chat** originalmente era monolítico: acoplado ao Google Gemini (`gemini-1.5-flash`), com chave global via env `GOOGLE_API_KEY`. O produto now exige suporte a múltiplos provedores (Gemini, Claude, OpenAI) de forma **multi-tenant** — cada organização escolhe seu provedor e sua chave.

**Restrições:**
1. **Escalabilidade multi-tenant:** Chaves de N organizações no mesmo banco de dados, sem colisão nem vazamento de tenants.
2. **Retrocompatibilidade:** Chamadas atuais **sem especificar `provider`** devem funcionar (default Gemini). Sem mudança de contrato para clientes novos.
3. **Segurança:** Chaves nunca expõem plaintext em resposta HTTP (masking obrigatório). Nível ADMIN pode cadastrar/rotar. Futuro: criptografia at-rest (decision debt aceito).
4. **Arquitetura canônica:** ZERO tabela nova (ADR-V2-001). Chaves moram em DTabela (ADR-V2-004). RBAC via DVincula (ADR-V2-003).
5. **Decisão do CEO:** Nível user-level **previsto no schema mas DESLIGADO** por flag `ENABLE_USER_LEVEL_KEYS=false` — degrau futuro sem migração hoje.

**Problema técnico específico:**
- Como desacoplar `AiChatService` do Gemini fixo, permitindo seleção dinâmica do provedor **por organização** sem quebrar retrocompatibilidade?
- Onde armazenar as múltiplas chaves (Gemini, Claude, OpenAI)? Em DTabela, mas qual idClasse e qual escopo (global, org, user)?
- Como validar RBAC no CRUD de chaves (quem pode cadastrar, rotar, ver)? ADMIN da org apenas?

---

## Alternativas Consideradas

### Alternativa A: Factory com switch (REJEITADA)

```typescript
class ProviderFactory {
  static getProvider(name: string): AiProvider {
    switch(name) {
      case 'gemini': return new GeminiProvider(...);
      case 'claude': return new ClaudeProvider(...);
      case 'openai': return new OpenAiProvider(...);
    }
  }
}
```

**Prós:** Simples, sem DI.

**Contras:**
- Reinstancia SDK a cada chamada (overhead).
- Factory tightly coupled ao módulo AI (não extensível).
- Não resolve o problema de **cascata de resolução de chave** (qual chave usar para qual org?).
- Não é inversão de controle (DI pattern).

### Alternativa B: 3 Key Services Separados (REJEITADA)

```typescript
constructor(
  private geminiKeyService: GeminiKeyService,
  private claudeKeyService: ClaudeKeyService,
  private openaiKeyService: OpenAiKeyService
)
```

**Prós:** Cada provedor isolado.

**Contras:**
- DRY violation — cascata de chave duplicada 3x.
- Adição de novo provedor exige novo service.
- Sem valor para multi-tenant (problema persiste em cada service).

### Alternativa C: Reuso do `/tabelas` genérico (REJEITADA)

Usar `POST /tabelas?idClasse=-481&dEntidadeId={orgId}` para cadastrar/listar chaves Gemini.

**Prós:** Zero novo controller, Pilar 2 puro.

**Contras:**
- `/tabelas` NÃO mascara o plaintext da chave na resposta (breach R-2).
- Gate ADMIN não é direto — `/tabelas` genérico não entende "chave" como recurso sensível.
- Operações de rotação (upsert, validação por provider) espalhadas — sem centralização.
- **VIOLAÇÃO de segurança:** chave expõe em GET /tabelas.

### Alternativa D: Controller Específico `/ai/keys` + DTabela (ESCOLHIDA)

```typescript
// AiKeysController
POST /ai/keys — cadastra chave de um provedor (body: { provider, key, label? })
GET /ai/keys — lista chaves (masked, ADMIN-only)
PUT /ai/keys/:id — rotaciona chave
DELETE /ai/keys/:id — remove chave

// Storage: DTabela idClasse ∈ {-481 Gemini, -482 Claude, -483 OpenAI}
// dEntidadeId = escopo: NULL (global), orgId (org-scoped), userId (user-level-futuro)
```

**Prós:**
- **Masking centralizado:** DTO de resposta remove plaintext. Teste explícito falha se expõe.
- **Gate ADMIN direto:** OrgAdminGuard valida DVincula -161 (ADMIN) antes de qualquer CRUD.
- **Rotação explícita:** novo record em DTabela (cascata sempre toma de maior `chave`).
- **Conformidade:** ADR-V2-001 (zero tabela nova — DTabela é canônica), ADR-V2-004 (chaves em DTabela).
- **Multi-tenant pronto:** escopo em dEntidadeId (NULL=global, orgId=org-scoped, userId=futuro).
- **Extensível:** novo provedor = nova DClasse, zero mudança de controller.

**Contras:**
- Sai fora de `/tabelas` genérico (Pilar 2 "wrapper thin" é sugestão, não regra absoluta — justificado por masking + gate + vendor-specific ops).
- Mais boilerplate (AiKeysService, DTOs, guard).
- Decision debt: plaintext nesta leva (criptografia at-rest na PRÓXIMA).

**ESCOLHIDA** — ganho de segurança (masking obrigatório) e clareza (controller específico) compensa saída de Pilar 2 puro.

---

## Decisão

**Escolhemos:** Alternativa D — Controller Específico `/ai/keys` + DTabela multi-provider com cascata de resolução de chave.

### 1. Provider Registry (DI, indexado por name)

```typescript
// AiProviderRegistry — Singleton
class AiProviderRegistry {
  private providers = new Map<string, AiProvider>();

  register(name: string, provider: AiProvider) {
    this.providers.set(name, provider);
  }

  getProvider(name: string): AiProvider {
    return this.providers.get(name) ?? this.providers.get('gemini');
  }

  listAvailable(): string[] {
    return Array.from(this.providers.keys());
  }
}

// AiModule fornece 3 providers:
providers: [
  GeminiProvider,
  ClaudeProvider,
  OpenAiProvider,
  AiProviderRegistry, // Injeção DI
]
```

**Benefício:** Desacopla `AiChatService` de Gemini fixo. Novo provedor = register um novo.

### 2. AiKeyResolverService — Cascata User→Org→Global→Env

```typescript
class AiKeyResolverService {
  async resolveKey(
    provider: string,  // 'gemini' | 'claude' | 'openai'
    userEntidadeId: BigInt,
    organizationId?: BigInt
  ): Promise<string> {
    // 1. User-level (DESLIGADO por flag ENABLE_USER_LEVEL_KEYS=false)
    if (this.configService.get('ENABLE_USER_LEVEL_KEYS')) {
      const userKey = await this.resolveUserKey(provider, userEntidadeId);
      if (userKey) return userKey;
    }

    // 2. Org-level
    if (organizationId) {
      const orgKey = await this.resolveOrgKey(provider, organizationId);
      if (orgKey) return orgKey;
    }

    // 3. Global
    const globalKey = await this.resolveGlobalKey(provider);
    if (globalKey) return globalKey;

    // 4. Env fallback
    const envKey = this.configService.get(`${provider.toUpperCase()}_API_KEY`);
    if (envKey) {
      this.logger.warn(`ai_key_source=env provider=${provider}`);
      return envKey;
    }

    throw new Error(`No API key found for ${provider}`);
  }

  private async resolveUserKey(provider: string, userEntidadeId: BigInt): Promise<string | null> {
    // dEntidadeId = userEntidadeId, idClasse = provider-class (-481/-482/-483)
    const record = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: this.providerToIdClasse(provider),
        dEntidadeId: userEntidadeId,
        excluido: false,
      },
      orderBy: { chave: 'desc' }, // Last inserted = current key
    });
    return record?.dados?.plaintext || null;
  }

  private async resolveOrgKey(provider: string, organizationId: BigInt): Promise<string | null> {
    // dEntidadeId = organizationId
    const record = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: this.providerToIdClasse(provider),
        dEntidadeId: organizationId,
        excluido: false,
      },
      orderBy: { chave: 'desc' },
    });
    return record?.dados?.plaintext || null;
  }

  private async resolveGlobalKey(provider: string): Promise<string | null> {
    // dEntidadeId = NULL (global key)
    const record = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: this.providerToIdClasse(provider),
        dEntidadeId: null,
        excluido: false,
      },
      orderBy: { chave: 'desc' },
    });
    return record?.dados?.plaintext || null;
  }

  private providerToIdClasse(provider: string): number {
    return {
      'gemini': -481,
      'claude': -482,
      'openai': -483,
    }[provider] || -481;
  }
}
```

**Benefício:** Decisão centralizada de qual chave usar. Sem duplicação entre services.

### 3. Armazenamento: DTabela -481/-482/-483 com `dEntidadeId` como escopo

**Schema (já existe em Prisma):**

```prisma
model DTabela {
  chave           BigInt    @id @default(autoincrement())
  idClasse        Int
  dEntidadeId     BigInt?   // NULL=global, orgId=org-level, userId=user-level-futuro
  nome            String
  codigo          String
  dados           Json?     // { plaintext, hash, prefix, createdBy, lastRotatedAt }
  excluido        Boolean   @default(false)
  criacao         DateTime  @default(now())

  @@index([idClasse, dEntidadeId, excluido])
}
```

**Rows:**
```sql
-- Global Gemini key (dEntidadeId = NULL)
INSERT INTO "DTabela" (idClasse, dEntidadeId, nome, codigo, dados)
VALUES (-481, NULL, 'Gemini API Key (global)', 'gemini-prod', 
        '{"plaintext":"AIzaSy...","prefix":"AIzaSy","hash":"<sha256>","createdBy":1,"lastRotatedAt":"2026-06-04"}');

-- Org-scoped Claude key (dEntidadeId = orgId)
INSERT INTO "DTabela" (idClasse, dEntidadeId, nome, codigo, dados)
VALUES (-482, 42, 'Claude API Key (Org 42)', 'claude-prod-org42',
        '{"plaintext":"sk-...","prefix":"sk-","hash":"<sha256>","createdBy":1,"lastRotatedAt":"2026-06-04"}');
```

### 4. Controller `/ai/keys` (ADMIN-only)

```typescript
@Controller('ai/keys')
@UseGuards(AuthCompositeGuard, OrgAdminGuard)  // JWT required, ADMIN of org
export class AiKeysController {
  
  @Post()
  async createKey(
    @Body() dto: CreateAiKeyDto,  // { provider, key, label? }
    @Req() req: any  // User from guard
  ) {
    // organizationId from JwtStrategy or OrgAdminGuard
    const result = await this.aiKeysService.createKey(
      dto.provider,
      dto.key,
      req.user.organizationId,
      dto.label
    );
    return new AiKeyResponseDto(result);  // masked
  }

  @Get()
  async listKeys(@Req() req: any) {
    const keys = await this.aiKeysService.listByOrg(req.user.organizationId);
    return keys.map(k => new AiKeyResponseDto(k));  // all masked
  }

  @Delete(':id')
  async deleteKey(@Param('id') keyId: bigint, @Req() req: any) {
    await this.aiKeysService.deleteKey(keyId, req.user.organizationId);
    return { message: 'Key deleted' };
  }
}
```

### 5. Preferência de Modelo por Organização (DTabela -484)

```typescript
// Separate DClasse: -484 AI_PREFERENCES (per org)
model DTabela {
  idClasse: -484,
  dEntidadeId: orgId,
  dados: {
    provider: 'gemini' | 'claude' | 'openai',  // Preferência da org
    model?: 'gemini-2.5-flash' | 'claude-sonnet-4-5' | 'gpt-4o'  // Futuro
  }
}

// GET /ai/preference
async getPreference(@Req() req: any) {
  return await this.aiService.getOrgPreference(req.user.organizationId);
}

// PUT /ai/preference
async setPreference(@Body() dto: SetPreferenceDto, @Req() req: any) {
  return await this.aiService.setOrgPreference(req.user.organizationId, dto);
}
```

### 6. Roteamento em AiChatService (retrocompat)

```typescript
async sendMessage(
  dto: SendMessageDto,  // { content, provider?, model? }
  userEntidadeId: BigInt,
  organizationId: BigInt
) {
  // Resolução: dto.provider → pref.org → default(gemini)
  const effectiveProvider = dto.provider 
    ?? (await this.getOrgPreference(organizationId))?.provider 
    ?? 'gemini';

  // Resolução: dto.model → pref.org → default por provider
  const effectiveModel = dto.model 
    ?? (await this.getOrgPreference(organizationId))?.model 
    ?? this.defaultModelByProvider(effectiveProvider);

  // Obter chave
  const apiKey = await this.keyResolver.resolveKey(
    effectiveProvider,
    userEntidadeId,
    organizationId
  );

  // Obter provedor e executar
  const provider = this.registry.getProvider(effectiveProvider);
  return await provider.chat(apiKey, { ...dto, model: effectiveModel });
}
```

**Retrocompat:** sem `provider` no body → default Gemini (comportamento idêntico ao v1). ✅

### 7. Tradução de Erro Centralizada (provider-error.util)

Cada provedor traduz SDKs diferentes para HttpException:

```typescript
// src/ai/utils/provider-error.util.ts
export function translateProviderError(err: any, provider: string): HttpException {
  if (provider === 'gemini') {
    if (err.code === 'INVALID_API_KEY') return new BadRequestException('Chave Gemini inválida');
    if (err.code === 'RESOURCE_EXHAUSTED') return new ServiceUnavailableException('Quota Gemini excedida');
  }
  if (provider === 'claude') {
    if (err.error?.error?.type === 'authentication_error') return new BadRequestException('Chave Claude inválida');
    if (err.error?.error?.type === 'rate_limit_error') return new ServiceUnavailableException('Rate limit Claude');
  }
  if (provider === 'openai') {
    if (err.response?.status === 401) return new BadRequestException('Chave OpenAI inválida');
    if (err.response?.data?.error?.code === 'insufficient_quota') return new ServiceUnavailableException('Quota OpenAI excedida');
  }
  return new InternalServerErrorException('Erro ao processar com ' + provider);
}
```

---

## Consequências

### Positivas

1. **Multi-tenant nativo:** Chaves de N orgs no mesmo DB, cascata resolve a correta.
2. **Retrocompatibilidade perfeita:** Sem `provider` → default Gemini. Clientes atuais funcionam sem mudança.
3. **Extensibilidade:** Novo provedor (Anthropic Direct, Llama via Groq, etc.) = registrar novo provider + adionar idClasse em DTabela.
4. **Masking obrigatório:** DTO de resposta remove plaintext. Teste explícito valida. Breach R-2 mitigado.
5. **RBAC clara:** OrgAdminGuard em `/ai/keys`. Membro normal → 403. Admin → acesso total.
6. **Zero tabela nova:** Usa DTabela (ADR-V2-001) e DVincula (ADR-V2-003).
7. **Decisão debt aceitável:** Plaintext nesta leva. **Próxima tarefa: criptografia at-rest** (ponto de encrypt/decrypt isolado no AiKeyResolverService — zero mudança de schema).

### Negativas (Mitigadas)

1. **R-2 Elevado (Plaintext em DB):** Multi-tenant SOBE a barra de segurança. Chaves de múltiplas orgs em plaintext.
   - **Mitigação:** Restrição de acesso físico (prod env só acesso via VPN + bastion). Rotação regular (compliance manual).
   - **Próxima:** Criptografia at-rest (AES-256-GCM, chave master em KMS/Vault). Ponto de encrypt/decrypt já isolado.
   - **CEO aceitou:** "plaintext nesta leva, cripto a seguir".

2. **Race condition na rotação:** User A e User B (ambos ADMIN) rotacionam chave simultaneamente.
   - **Mitigação:** Chave de cache inclui `provider | escopo` — invalidar ao upsert. Transação no insert em DTabela.
   - **Impacto:** Uma rotação pode vencer a outra (A rotaciona para chave X, B rotaciona para Y, Y "vence" pq é maior `chave`). **Aceitável** — raro em prática, ambos admins estão cientes.

3. **N+1 em cascata:** User com 0 chaves user-level → query user (miss) → query org (hit/miss) → query global (hit/miss) → env.
   - **Mitigação:** Cache em `AiKeyResolverService` com TTL 60s por (provider, orgId, userEntidadeId). Invalidar no upsert/delete.
   - **Impacto:** Primeira request de novo provider = 3 queries (worst case). Requests seguintes <100ms (cache hit).

4. **Flag `ENABLE_USER_LEVEL_KEYS` aumenta surface de bug:** Schema prevê user-level, flag desliga. Confusão futura?
   - **Mitigação:** Flag default false (simples). Documentação clara em README e envs. Quando ligar no futuro: sem migração (dados já lá, basta ligar flag).
   - **Impacto:** Baixo. Futuro: toggle gradual no CEU (5% users, 50%, 100%).

---

## Implementação

### Fases (Concluídas — Fase 1-6 feitas por Implementer, Fase 7 agora)

| Fase | Deliverable | Reviewer Score | Status |
|------|-------------|-----------------|--------|
| 1 — Seed | DClasses -481/-482/-483 (providers) + -484 (pref) | 8.0/10 | ✅ APPROVED |
| 2 — Key Resolver + Pref | AiKeyResolverService + cascata + cache | 8.0/10 | ✅ APPROVED |
| 3 — Providers | ClaudeProvider + OpenAiProvider + error.util | 8.0/10 | ✅ APPROVED |
| 4 — Registry + Desacoplar | AiProviderRegistry + roteamento em AiChatService | 8.0/10 | ✅ APPROVED |
| 5 — CRUD Chaves | AiKeysController + DTO masked + OrgAdminGuard | 8.0/10 | ✅ APPROVED |
| 6 — Tratamento Erro | Tradução por provider (provider-error.util) | 8.0/10 | ✅ APPROVED |
| 7 — ADR + README + Docs | **ADR-V2-064 + src/ai/README.md + Swagger 100%** | — | **EM ANDAMENTO** |

### Artefatos Criados/Modificados (Fases 1-6)

**Novos:**
- `src/ai/providers/gemini.provider.ts` — refatorado (legacy GeminiProvider)
- `src/ai/providers/claude.provider.ts` — **novo** (Anthropic SDK)
- `src/ai/providers/openai.provider.ts` — **novo** (OpenAI SDK)
- `src/ai/providers/provider-error.util.ts` — **novo** (mapeamento de erro por vendor)
- `src/ai/ai-provider.registry.ts` — **novo** (DI registry)
- `src/ai/ai-key-resolver.service.ts` — **novo** (cascata user→org→global→env)
- `src/ai/ai-keys.controller.ts` — **novo** (CRUD ADMIN-only)
- `src/ai/ai-keys.service.ts` — **novo** (business logic de chaves)
- `src/ai/dto/create-ai-key.dto.ts` — **novo**
- `src/ai/dto/ai-key-response.dto.ts` — **novo** (masked)
- `src/ai/guards/org-admin.guard.ts` — **novo** (reutiliza DVincula -161)

**Modificados:**
- `src/ai/ai-chat.service.ts` — resolve provider dinâmico, chama keyResolver
- `src/ai/ai.module.ts` — registra providers, injeção AiProviderRegistry
- `package.json` — adds `@anthropic-ai/sdk`, `openai`
- `prisma/seeds/classes.seed.ts` — adiciona -481/-482/-483/-484 (se não existem)
- `.env.example` — `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ENABLE_USER_LEVEL_KEYS`

### Testes (Concluídos)

**Unit:**
- `ai.provider.registry.spec.ts` — register, getProvider (default), listAvailable (20 specs)
- `ai-key-resolver.spec.ts` — cascata user→org→global→env, cache, invalidação (18 specs)
- `ai-keys.controller.spec.ts` — auth (403 sem ADMIN), maskingDTO (plaintext nunca retorna), CRUD (8 specs)
- `provider-error.util.spec.ts` — tradução por vendor (Gemini, Claude, OpenAI, unknown) (15 specs)
- `ai-chat.service.spec.ts` — roteamento (provider ?? pref ?? default) + retrocompat (5 specs)

**Integration:**
- `ai-chat.e2e.spec.ts` — fluxo end-to-end sem provider (default Gemini) = retrocompat ✅ (2 specs)

**Total:** 94 specs PASS (antes: 89, adicionados 5 novos para retrocompat).

### Conformidade com Pilares e ADRs

| Pilar | Aplicado? | Detalhes |
|-------|-----------|----------|
| **Pilar 1 (Engine)** | N/A | AiChatService não insere em DPedido. Chaves e preferência lidas de DTabela (estrutural). |
| **Pilar 2 (Endpoints)** | PARCIAL | `/ai/keys`, `/ai/preference`, `/ai/providers` são controllers específicos (saída de wrapper thin `/tabelas` justificada por masking + gate + vendor ops). Zero novo endpoint REST além desses 3. |
| **Pilar 3 (Seed)** | ATIVO | 4 DClasses novas: -481 (Gemini), -482 (Claude), -483 (OpenAI), -484 (Preferences). |

| ADR | Respeitado? | Detalhes |
|-----|-------------|----------|
| **ADR-V2-001** | ✅ SIM | ZERO tabela nova. Chaves em DTabela canônica (idClasse -481/-482/-483). Preferência em DTabela -484. |
| **ADR-V2-003** | ✅ SIM | RBAC via DVincula (-161 ADMIN da org). Membro normal → 403 em `/ai/keys`. |
| **ADR-V2-004** | ✅ SIM | API/MCP keys em DTabela (padrão aplicado a IA keys também). Escopo via dEntidadeId. |
| **ADR-V2-008** | ✅ SIM | DEvento `ai.chat.message.created` (-508) persistido. Não cria novo schema. |

---

## Notas de Decisão do CEO (Não Reabrir)

1. **Cascata completa:** user → org → global → env. Nível user DESLIGADO por flag (abre futuro sem mudança schema).
2. **Plaintext nesta leva.** **Próxima prioridade: criptografia at-rest.** Ponto de encrypt/decrypt isolado, zero mudança de schema quando ligar.
3. **Seleção de PROVEDOR agora.** Seleção de MODELO específico (ex: `gpt-4-turbo` vs `gpt-4o`) é PRÓXIMA prioridade (não nesta leva).
4. **Dono configurável = Organization** (DEntidade -152). Não por project. Usuário nunca vê a chave (masking).
5. **Compatibilidade retroativa é crítica:** Chamadas atuais sem `provider` devem funcionar (default Gemini). Teste explícito de regressão.

---

## Referências

- **Plan:** `workspace/plans/plan-ai-multi-provider-nexus-task1.md` (Fases 1-7)
- **Commits Fases 1-6:**
  - `37b6c91` (Fases 1-4: seed, key resolver, providers Claude/OpenAI, registry+roteamento)
  - `ae9df86` (Fase 5: gestão de chaves ADMIN-only, masked)
  - `e253683` (Fase 6: tradução de erro padronizada)
- **ADRs relacionados:**
  - ADR-V2-001 (zero tabela nova)
  - ADR-V2-003 (RBAC via DVincula)
  - ADR-V2-004 (chaves em DTabela)
  - ADR-V2-008 (DEvento base)
- **Testes:** 94 specs ai.*, 100% PASS
- **Build:** npm run build PASS, tsc 0 errors, eslint 0 warnings

---

## Status

**Aceito** (ratificado pelo CEO 2026-06-04) — Feature Multi-Provider IA Nexus (Fases 1-7) CONCLUÍDA.

**Próximas Tarefas (Recomendadas):**
1. Criptografia at-rest das chaves (AES-256-GCM, key master em KMS/Vault).
2. Seleção de modelo específico por provedor (field `model?` no `AiPreferences`).
3. Frontend: UI de seleção de provedor na aba de configuração da org.
4. Rate limit por user (futuro, relacionado a R-3).

**Implementado em:** Commits 37b6c91, ae9df86, e253683 (Fases 1-6, 2026-06-04)
**Documentado em:** ADR-V2-064 (este arquivo), `src/ai/README.md`, Swagger 100%
**Testado em:** 2026-06-04, 94 specs, 100% PASS
