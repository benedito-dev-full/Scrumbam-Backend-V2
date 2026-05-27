# Nexus IA Chat — Módulo `ai/` (Frente B v1)

Chat IA persistente do Scrumban, com 4 tools de proxy para `comments`,
`tasks` e `projects`. Provider único na v1: **Google Gemini**
(`gemini-1.5-flash`). Arquitetura preparada para Claude/OpenAI futuro
(interface `AiProvider`).

## Rotas

| Método | Rota               | Descrição                              |
|--------|--------------------|----------------------------------------|
| POST   | `/ai/chat`         | Envia mensagem, retorna resposta JSON |
| GET    | `/ai/chat/history` | Histórico cronológico (cursor pagin.) |
| DELETE | `/ai/chat/history` | Limpa conversa (soft-delete)          |

Autenticação: `AuthCompositeGuard` (JWT/ApiKey/MCP).
**Resposta = JSON puro, não streaming** (decisão 5 do plano canônico).

## Tools v1

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

## Storage

- **Mensagens** → `DEvento idClasse=-508 AI_CHAT_MESSAGE`.
  - `identificadorExterno = userEntidadeId.toString()` (v1: conversa única
    por user). v2 multi-conversa: vira `uuid` — **schema não muda**.
  - `descricao = content`; `metaDados = { role, model?, tokens?, toolCalls?, timestamp }`.
- **API Key Gemini** → `DTabela idClasse=-481 GEMINI_API_KEY` (ADR-V2-004).
  - `dados.plaintext` (necessário — backend chama vendor em runtime).
  - `dados.hash`, `dados.prefix`, `dados.createdBy`, `dados.lastRotatedAt`.

**ZERO tabela nova** (ADR-V2-001). **Pilar 1 N/A** — DEvento é audit/structural.

## Configuração da Gemini Key

### Dev local

`.env`:
```
GOOGLE_API_KEY=AIzaSy...
```

`GeminiApiKeyService` tenta DTabela primeiro, cai no env automaticamente
(emite `logger.warn(gemini_api_key_source=env)`).

### Produção

Criar manualmente UMA vez via Prisma Studio (ou SQL direto):

```sql
INSERT INTO "DTabela" ("idClasse", "nome", "codigo", "dados")
VALUES (
  -481,
  'Gemini API Key (global)',
  'gemini-prod',
  '{"plaintext":"AIzaSy...","prefix":"AIzaSy","hash":"<sha256>"}'::jsonb
);
```

Para rotacionar: criar novo registro (o service pega o de maior `chave`).
Cache em memória do `GeminiApiKeyService` invalida em 60s — sem necessidade
de redeploy.

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

## v2 — Expansão futura (rastreabilidade)

Lista canônica de evoluções documentada na seção 11 do plano canônico
(`docs/plans/2026-05-27-nexus-ia-chat.md`). Resumo dos itens:

1. Multi-conversa por user (sidebar estilo ChatGPT).
2. Título automático da conversa (call extra após 1ª resposta).
3. Streaming SSE (trocar response para `text/event-stream`).
4. Multi-provider (Claude, OpenAI) — adicionar `ClaudeProvider`,
   `OpenAiProvider` (interface já preparada).
5. Mais tools (`updateTaskStatus`, `assignTask`, `searchTasks`, etc.).
6. Sumarização de histórico longo.
7. RAG sobre conteúdo do projeto.
8. Voice input (Groq Whisper reaproveitado do Telegram).
9. Métricas de uso/tokens (billing futuro).
10. Admin UI para gerenciar Gemini Key.
11. Encriptação da plaintext key (Vault/KMS) — sobe a barra de R-2.
12. Rate limit por user — sobe a barra de R-3.

## Referências

- `docs/plans/2026-05-27-nexus-ia-chat.md` — plano canônico Frente B.
- `src/comments/comments.service.ts` — padrão DEvento polimórfico espelhado.
- `src/auth/services/api-key.service.ts` — padrão DTabela espelhado para -481.
- ADR-V2-001 (zero tabela nova), ADR-V2-004 (API keys em DTabela),
  ADR-V2-005 (Engine só em DPedido).
