# Nexus IA Chat — Módulo `ai/` (Multi-Provider v2)

Chat IA persistente do Scrumban, com 4 tools de proxy para `comments`,
`tasks` e `projects`. **Multi-provider nativo:** Google Gemini, Anthropic Claude,
OpenAI. Cascata de resolução de chave user→org→global→env (ADR-V2-064).
Nível user desligado por flag (degrau futuro).

## Rotas

| Método | Rota                    | Descrição                              | Auth |
|--------|-------------------------|----------------------------------------|------|
| POST   | `/ai/chat`              | Envia mensagem, retorna resposta JSON | JWT/ApiKey/MCP |
| GET    | `/ai/chat/history`      | Histórico cronológico (cursor pagin.) | JWT/ApiKey/MCP |
| DELETE | `/ai/chat/history`      | Limpa conversa (soft-delete)          | JWT/ApiKey/MCP |
| POST   | `/ai/keys`              | Cadastra chave de provedor (ADMIN-only) | JWT + OrgAdminGuard |
| GET    | `/ai/keys`              | Lista chaves (masked, ADMIN-only)    | JWT + OrgAdminGuard |
| DELETE | `/ai/keys/:id`          | Remove chave (ADMIN-only)            | JWT + OrgAdminGuard |
| GET    | `/ai/preference`        | Preferência de provedor da org       | JWT |
| PUT    | `/ai/preference`        | Define preferência da org (ADMIN-only) | JWT + OrgAdminGuard |
| GET    | `/ai/providers`         | Lista provedores disponíveis por org | JWT |

**Resposta = JSON puro, não streaming** (decisão 5 do plano canônico).

## Tools

| Nome                 | Faz o quê                                                                  |
|----------------------|----------------------------------------------------------------------------|
| `createComment`      | Cria comentário em task/project/folder/list (`CommentsService`)            |
| `listComments`       | Lista comentários de um alvo (`CommentsService`)                           |
| `createTask`         | Cria task em projeto (estado inicial INBOX — `TasksService`)               |
| `getProjectSummary`  | `ProjectsService.findOne` + `getStats` + 5 tasks ativas (READY/EXECUTING)  |

Tenant isolation: tools recebem `userEntidadeId` + `organizationId` do JWT
do request. Services internos já fazem o gate (Comments via
`CommentTargetResolver`, Tasks/Projects via `findAccessibleProjectIds`).
**IA nunca escolhe quem é o user.**

## Provedores Suportados

| Provedor | SDK | Modelo Default | Chave DClasse | Storage |
|----------|-----|-----------------|----------------|---------|
| **Gemini** (v2 default) | `@google/generative-ai` | `gemini-2.5-flash` | `-481` | DTabela dEntidadeId=NULL/orgId |
| **Claude** | `@anthropic-ai/sdk` | `claude-sonnet-4-5` | `-482` | DTabela dEntidadeId=NULL/orgId |
| **OpenAI** | `openai` | `gpt-4o` | `-483` | DTabela dEntidadeId=NULL/orgId |

**Retrocompatibilidade:** Chamadas sem `provider` no body → default Gemini. ✅

## Storage

### Mensagens de Chat

- **Mensagens** → `DEvento idClasse=-508 AI_CHAT_MESSAGE`.
  - `identificadorExterno = userEntidadeId.toString()` (v2: conversa única por user).
    Futuro multi-conversa: vira `uuid` — **schema não muda**.
  - `descricao = content`; `metaDados = { role, model?, tokens?, toolCalls?, timestamp }`.

### Chaves de API (Multi-Provider)

| DClasse | Provedor | Escopo | Dados |
|---------|----------|--------|-------|
| `-481` | **Gemini** | NULL (global), orgId (org-scoped), userId (user-futuro) | plaintext, hash, prefix, createdBy, lastRotatedAt |
| `-482` | **Claude** | NULL/orgId/userId | idem |
| `-483` | **OpenAI** | NULL/orgId/userId | idem |

- **Cascata de resolução:** user (se ENABLE_USER_LEVEL_KEYS=true) → org → global → env.
- `dEntidadeId = NULL` (global), `orgId` (org-level), `userId` (user-level-futuro).
- `dados.plaintext` armazenado. Masking obrigatório em GET (plaintext nunca expõe).
- Rotação: novo record em DTabela (cascata toma de maior `chave`).

### Preferência de Provedor por Org

- **DClasse `-484` AI_PREFERENCES** (per org).
  - `dEntidadeId = organizationId`.
  - `dados.provider = 'gemini' | 'claude' | 'openai'` (futuro: `model?`).

**ZERO tabela nova** (ADR-V2-001). Chaves em DTabela (ADR-V2-004). **Pilar 1 N/A** — estrutural.

## Configuração de Chaves

### Env Vars (Dev/Fallback)

`.env`:
```env
GOOGLE_API_KEY=AIzaSy...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
ENABLE_USER_LEVEL_KEYS=false  # Desligado (futuro)
```

`AiKeyResolverService` cascata: user (se flag) → org → global → env.

### Criação de Chaves (Produção)

**Endpoint (ADMIN-only):**
```bash
POST /ai/keys
Content-Type: application/json
Authorization: Bearer <jwt-admin-org>

{
  "provider": "gemini",
  "key": "AIzaSy...",
  "label": "Prod Key (rotação 2026-06-04)"
}
```

**Resposta (masked):**
```json
{
  "id": 12345,
  "provider": "gemini",
  "prefix": "AIzaSy",
  "createdBy": "user@org.com",
  "lastRotatedAt": "2026-06-04T10:30:00Z"
  // plaintext NÃO retorna
}
```

### Cache e Invalidação

`AiKeyResolverService` cache com TTL 60s por (provider, orgId, userId). Invalidar ao:
- POST /ai/keys (nova chave)
- DELETE /ai/keys/:id (remove chave)
- PUT /ai/preference (muda provider padrão)

## Eventos emitidos

| Tipo                          | DEvento idClasse |
|-------------------------------|------------------|
| `ai.chat.message.created`     | `-508`           |
| `ai.chat.tool.called`         | `-508`           |

Mapeados em `src/eventos/consumers/audit-log.consumer.ts` (TYPE_TO_CLASSE).

## Defesas

- `maxToolIterations = 5` — hard limit do loop de tool calling (R-5).
- Timeout `30s` por chamada Gemini + 1 retry em 429/5xx com backoff 1s.
- `MaxLength(50000)` no `content` da mensagem (R-9).
- Mensagem do user persistida **ANTES** da chamada Gemini (R-7 — refresh
  hidrata mesmo se Gemini falhar).
- Tools sempre via services existentes — tenant gate natural.

## Pendências (Próximas Prioridades)

| Item | Status | Razão | Quando |
|------|--------|-------|--------|
| **Criptografia at-rest das chaves** | ⚠️ DEBT | Plaintext em DB (R-2 elevado em multi-tenant). Ponto de encrypt/decrypt isolado em `AiKeyResolverService`. Zero mudança de schema. | **PRÓXIMA TAREFA** |
| **Seleção de modelo específico** | ⏳ FUTURO | Agora: default por provider (gemini-2.5-flash, claude-sonnet-4-5, gpt-4o). Field `model?` em `AiPreferences` pronto, falta UI. | Depois cripto |
| Multi-conversa por user | ⏳ FUTURO | `identificadorExterno` vira `uuid`. Schema DEvento já suporta. | Later |
| Título automático da conversa | ⏳ FUTURO | Call extra após 1ª resposta. | Later |
| Streaming SSE | ⏳ FUTURO | Response `text/event-stream`. | Later |
| Mais tools | ⏳ FUTURO | `updateTaskStatus`, `assignTask`, `searchTasks`, etc. | Later |
| Sumarização de histórico longo | ⏳ FUTURO | Compactar mensagens antigas. | Later |
| RAG sobre conteúdo do projeto | ⏳ FUTURO | Vector DB (Pinecone, Weaviate). | Later |
| Voice input | ⏳ FUTURO | Groq Whisper reaproveitado do Telegram. | Later |
| Métricas de uso/tokens | ⏳ FUTURO | Billing futuro. | Later |
| Frontend: seleção de provedor | 🔲 BACKLOG | UI na aba de configuração da org. Endpoint GET /ai/preference pronto. | Later |
| Rate limit por user | 🔲 BACKLOG | Relacionado a R-3 (não bloqueador). | Later |

## Referências

- **ADR-V2-064:** Provider Registry + cascata de resolução de chave (decisão arquitetural completa)
- **Plan:** `workspace/plans/plan-ai-multi-provider-nexus-task1.md` (Fases 1-7)
- **Commits:**
  - `37b6c91` — Fases 1-4 (seed, key resolver, Claude/OpenAI providers, registry)
  - `ae9df86` — Fase 5 (gestão de chaves ADMIN-only, masked)
  - `e253683` — Fase 6 (tradução de erro padronizada por vendor)
- **Padrões vinculados:**
  - `src/comments/comments.service.ts` — DEvento polimórfico
  - `src/auth/services/api-key.service.ts` — DTabela com dEntidadeId
- **ADRs:**
  - **ADR-V2-064** (novo — multi-provider, cascata, masking, plaintext debt)
  - ADR-V2-001 (zero tabela nova)
  - ADR-V2-003 (RBAC via DVincula)
  - ADR-V2-004 (chaves em DTabela)
  - ADR-V2-008 (DEvento base)

## Testes

**Unit + Integration:** 94 specs ai.* — 100% PASS
- Provider Registry (register, getProvider, default, list) — 20 specs
- AiKeyResolverService (cascata, cache, invalidação) — 18 specs
- AiKeysController (auth 403/200, masking, CRUD) — 8 specs
- Provider error translation (Gemini/Claude/OpenAI/unknown) — 15 specs
- AiChatService (roteamento, retrocompat sem provider) — 5 specs
- End-to-end retrocompat (default Gemini) — 2 specs
- Regression (baseline tasks) — 26 specs

**Build:** ✅ PASS (tsc 0 errors, eslint 0 warnings, npm run build completa)

**Performance:** Sem regressão (1 query cache por (provider, orgId, userId), TTL 60s)
