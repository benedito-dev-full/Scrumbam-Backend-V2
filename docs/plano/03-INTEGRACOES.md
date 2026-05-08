# 03 - INTEGRAÇÕES (Fases 10 a 13)

**Criado por:** Strategist Agent (Devari Core)
**Data:** 2026-05-08
**Projeto:** Scrumban-Backend-V2
**Cobertura:** Fases 10 (Channels) → 11 (MCP) → 12 (Webhooks Outbound) → 13 (Automation Claude Code)
**Pré-requisito:** Fases 1 a 9 concluídas (seed, auth, entidades, projetos, tasks, eventos, engine, etc.)

---

## CONTEXTO ESTRUTURAL

Este documento planeja a CAMADA DE INTEGRAÇÕES do Scrumban V2. Todas as fases
respeitam as **17 tabelas canônicas** do Devari Core. **ZERO tabelas novas.**
Cada integração é um conjunto de DClasses + Services + Controllers que se
encaixam nas tabelas existentes (DEntidade, DTabela, DVincula, DEvento,
DPedido). O Engine (`OperacaoExecucaoClaude`, criado na Fase 6) é o único
ponto de gravação em tabela transacional (DPedido) para execuções.

### DClasses globais usadas nestas fases (resumo — definir no seed da Fase 1)

| Range | Domínio | Tabela host |
|-------|---------|-------------|
| -150 a -156 | Sub-tipos de Pessoa (AGENT, etc.) | DEntidade |
| -300 a -310 | Sub-tipos de Pedido (EXECUTION) | DPedido |
| -450 a -459 | Channels (CHANNEL agrupador, WEB, WHATSAPP, EMAIL, SLACK, API, TELEGRAM) | DEntidade ou DTabela |
| -470 a -479 | Configs de integração (WEBHOOK, MCP_KEY, INSTALL_TOKEN, PAIRING_TOKEN) | DTabela |
| -480 a -489 | Vínculos (PROJECT_AGENT, TELEGRAM_LINK, etc.) | DVincula |
| -490 a -499 | Eventos (NOTIFICATION, WEBHOOK_ATTEMPT, AGENT_HEARTBEAT, TELEGRAM_MSG_IN, MCP_CALL) | DEvento |
| -495 a -507 | Status de execução / risk levels | DTabela (lookup) |

### Rede de dependências entre fases

```
Fase 10 (Channels)         ──┐
                              ├──> Fase 12 (Webhooks Outbound)
Fase 11 (MCP)              ──┤        │
                              │        v
Fase 13 (Automation) ────────┴───> task/execution events disparam webhook
                                       │
                                       v
                              fase 6 Engine OperacaoExecucaoClaude
                              fase 9 EventProducer/EventRouter
```

A **Fase 13** é a mais delicada — exige Engine, scripts DVFS (risk gate),
SSH reverso, sweeper cron, integração GitHub. Família depende. Atenção máxima.

---
---

## FASE 10 — CHANNELS (Multi-Channel + Telegram Bot)

### Objetivo

Construir a camada genérica de canais de comunicação (Channels Layer) e
implementar o **canal Telegram completo** como primeiro canal funcional.
A camada deve ser extensível para WhatsApp, Slack, Email e Web sem reescrever
infraestrutura.

Casos de uso do Telegram:
1. Pareamento conta Scrumban ↔ chat Telegram via código TTL
2. Comandos slash (`/start`, `/tasks`, `/create`, `/status`, `/pair`)
3. Captura de mensagens de texto e voz (transcrição via Groq Whisper)
4. Criação de tasks por mensagem ou voz com inferência básica de intent
5. Notificações outbound (eco de webhooks de task.* para o usuário)

### Pilares ativados / respeitados

- **Pilar 1 (Engine):** Mensagens recebidas que viram tasks chamam `TaskService`
  canonicamente — que internamente decide se cria via Engine ou Prisma direto
  (DTask é tabela estrutural, não transacional → Prisma direto OK).
- **Pilar 2 (Endpoints genéricos):** Pairing tokens, links e configs de canal
  são DTabela/DVincula → reusar `/tabela?idClasse=X` e `/vinculos` (não criar
  controllers REST dedicados para `pairing-tokens`, `telegram-links`).
- **Pilar 3 (Seed):** Todas as DClasses listadas abaixo são pré-criadas na
  Fase 1 (seed inicial). Fase 10 NÃO cria seed — apenas consome.

### Padrões obrigatórios aplicados

- **#1 PrismaService** (nunca DatabaseService).
- **#2 BigInt** para todos IDs.
- **#3 $transaction** ao gravar mensagem recebida (DEvento) + atualizar
  contadores em DTabela (lastSeenAt do link).
- **#4 TimezoneService** para qualquer filtro de data em comandos `/tasks`.
- **#5 EntidadeService.getEntidadeIdFromUserGroup** ao mapear chat→user.
- **#6 ZERO N+1** ao listar mensagens com sender (use include/select).
- **#7 Eventos APÓS persistência** — só chamar EventProducer depois do
  commit do DEvento de mensagem recebida.
- **#9 DTOs com class-validator** em todo payload do webhook Telegram.
- **#10 Guards** — webhook Telegram tem `TelegramSecretGuard` próprio (não
  JWT); endpoints administrativos (gerar pairing) usam `JwtAuthGuard`.
- **#11 Logger** estruturado com correlationId por update Telegram.
- **#14 EventProducerService** — `telegram.message.received`,
  `channel.user.linked`, `channel.user.unlinked`.

### Tabelas canônicas envolvidas

| Tabela | Uso |
|--------|-----|
| **DClasse** | Define os tipos -450..-456, -474, -483, -493 |
| **DEntidade** | (Opcional) registrar canais como entidade no caso de servidores Slack/WhatsApp; no Telegram, basta o link em DVincula |
| **DTabela** | `idClasse=-474` PAIRING_TOKEN (TTL, one-shot); configs de canal por usuário |
| **DVincula** | `idClasse=-483` TELEGRAM_LINK (idLocEscritu=user, metaDados={chatId,username}) |
| **DEvento** | `idClasse=-493` TELEGRAM_MSG_IN (texto + transcrição); `idClasse=-494` TELEGRAM_MSG_OUT (eco) |
| **DTask** | Quando comando `/create` cria task — via TaskService canônico |

### DClasses a criar (no seed da Fase 1)

| Chave | Código | Nome | idPai | agrupamento |
|------:|--------|------|------:|:-----------:|
| -450 | CHANNEL | Canais (agrupador) | -52 | true |
| -451 | CHANNEL_WEB | Canal Web | -450 | false |
| -452 | CHANNEL_WHATSAPP | Canal WhatsApp | -450 | false |
| -453 | CHANNEL_EMAIL | Canal Email | -450 | false |
| -454 | CHANNEL_SLACK | Canal Slack | -450 | false |
| -455 | CHANNEL_API | Canal API (genérico) | -450 | false |
| -456 | CHANNEL_TELEGRAM | Canal Telegram | -450 | false |
| -474 | PAIRING_TOKEN | Token de pareamento (TTL) | -52 | false |
| -483 | TELEGRAM_LINK | Vínculo user↔chat Telegram | -37 | false |
| -493 | TELEGRAM_MSG_IN | Mensagem Telegram recebida | -3 | false |
| -494 | TELEGRAM_MSG_OUT | Mensagem Telegram enviada | -3 | false |

### Estrutura de arquivos esperada

```
src/
├─ channels/
│  ├─ channels.module.ts
│  ├─ core/
│  │  ├─ channel-adapter.interface.ts        # ChannelAdapter abstrato
│  │  ├─ message-router.service.ts           # roteia msg → command/intent handler
│  │  ├─ command-registry.service.ts         # registra /start, /tasks, /create...
│  │  ├─ pairing.service.ts                  # gera/valida tokens (DTabela -474)
│  │  ├─ account-link.service.ts             # CRUD DVincula -483
│  │  └─ dto/
│  │     ├─ generate-pairing.dto.ts
│  │     └─ link-account.dto.ts
│  ├─ pairing.controller.ts                  # POST /channels/pairing (autenticado)
│  └─ telegram/
│     ├─ telegram.module.ts
│     ├─ telegram-webhook.controller.ts      # POST /webhooks/telegram (TelegramSecretGuard)
│     ├─ telegram-webhook.service.ts         # parser de Update (Telegram Bot API)
│     ├─ telegram-send.service.ts            # sendMessage / sendChatAction (com rate limit)
│     ├─ telegram-file-download.service.ts   # baixa voice notes (timeout + AbortController)
│     ├─ telegram-secret.guard.ts            # valida X-Telegram-Bot-Api-Secret-Token
│     ├─ commands/
│     │  ├─ start.handler.ts
│     │  ├─ pair.handler.ts
│     │  ├─ tasks.handler.ts
│     │  ├─ create-task.handler.ts
│     │  └─ status.handler.ts
│     ├─ intents/
│     │  └─ create-task-from-text.intent.ts  # heurística simples (regex/keywords)
│     └─ dto/
│        ├─ telegram-update.dto.ts
│        └─ telegram-message.dto.ts
└─ integrations/
   └─ groq/
      ├─ groq.module.ts
      ├─ groq-whisper.service.ts             # POST audio → transcrição
      └─ dto/
         └─ transcription.dto.ts
```

### Tarefas detalhadas

**Bloco A — Core Channels (genérico)**
1. Definir interface `ChannelAdapter` com métodos `send`, `parseInbound`,
   `verifySignature`. Permite plugar WhatsApp/Slack futuramente sem mexer
   na camada de comandos.
2. Implementar `PairingService.generate(userId)` — cria DTabela `idClasse=-474`
   com `dEntidadeId=userId`, `dados={code:'XXXX-XXXX',expiresAt,channelType,used:false}`.
   TTL configurável (default 10min). Use CSPRNG (`crypto.randomBytes`) para
   o code. Hash do code armazenado, plaintext devolvido apenas na geração.
3. Implementar `PairingService.consume(plainCode, channelMeta)` — busca
   token não-usado, não-expirado, marca `used=true` em transação atômica
   com criação do `DVincula -483` (TELEGRAM_LINK).
4. Implementar `AccountLinkService.findByChat(chatId)` — query única em
   DVincula filtrando `idClasse=-483` AND `metaDados @> {chatId}` (índice
   GIN em metaDados ajuda; criar migration da Fase 1).
5. `MessageRouterService.handleInbound(channel, message)` — dispatcha para
   handler de comando (se começa com `/`) ou para `intent` resolver.
6. `CommandRegistryService` — DI container que mapeia `comando→handler`.
   Cada handler implementa interface `{ name, description, run(ctx) }`.

**Bloco B — Telegram Webhook**
7. `TelegramSecretGuard` lê header `X-Telegram-Bot-Api-Secret-Token` e
   compara com `TELEGRAM_WEBHOOK_SECRET` do env (constant-time compare).
8. `POST /webhooks/telegram` recebe `Update`, valida com DTO, despacha para
   `TelegramWebhookService.handleUpdate(update)` em `setImmediate` e
   retorna **200 imediatamente** (Telegram exige <60s, melhor responder em
   <100ms). Erros são logados, não voltam para o Telegram.
9. `handleUpdate` extrai chat/user, busca link em `AccountLinkService`. Se
   chat não-pareado e msg ≠ `/pair <code>`, responde "Use /pair <código>".
10. Para mensagens de texto: cria `DEvento -493` com metaDados completos
    (text, chatId, messageId, sender, timestamp). Em $transaction:
    insere DEvento + atualiza `lastSeenAt` no DVincula -483.
11. Para mensagens de voz: chama `TelegramFileDownloadService` (timeout 15s,
    AbortController) → `GroqWhisperService.transcribe(buffer, mime)`. Grava
    DEvento -493 com `metaDados={voiceUrl, transcript, durationSec}`.
12. **Após** persistir, emite `telegram.message.received` via EventProducer.
13. `MessageRouterService` decide: se transcript/text começa com `/` → command
    handler; senão tenta `CreateTaskFromTextIntent` (regex simples: "criar
    task X", "nova task X"). Sem match → resposta "Não entendi. Use /help".

**Bloco C — Comandos**
14. `/start` — explica o bot, oferece link para gerar pairing code (URL do
    frontend ou orientação).
15. `/pair <code>` — chama `PairingService.consume`, cria DVincula -483.
    Mensagem de sucesso/erro ao usuário.
16. `/tasks [today|week|backlog]` — TaskService.listByUserAndPeriod (já
    existente da Fase 5). TimezoneService aplica filtro Brasil. Resposta
    formatada em markdown legível.
17. `/create <título>` ou texto livre detectado → `TaskService.create({
    titulo, projectId: defaultProjectOfUser, status:'BACKLOG' })`. Após
    sucesso, eco no Telegram com link do task.
18. `/status` — saúde do pareamento, contagem de tasks abertas, último
    sweep de execução (se Fase 13 ativa).

**Bloco D — Rate limit + observabilidade**
19. Rate limit por chatId em Redis: chave `tg:rl:<chatId>` com `INCR + EXPIRE`
    de 60s. Limite 30 msgs/min. Excedeu → resposta única "Calma, muitas
    mensagens" (não spam).
20. Logger estruturado com `correlationId = update.update_id`.
21. Métricas: contador eventos por tipo, p95 latência de transcrição.

### Dependências

- **Fase 1** seed com DClasses (-450..-456, -474, -483, -493, -494) já criadas.
- **Fase 5** TaskService (`create`, `listByUserAndPeriod`).
- **Fase 9** EventProducerService funcional.
- **Variáveis env:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `GROQ_API_KEY`, `CHANNELS_ENABLED`, `PAIRING_TOKEN_TTL_MIN=10`.
- **Redis** ativo (rate limit).
- **Webhook público** acessível (ngrok/Cloudflare Tunnel em dev, domínio
  HTTPS em prod). Configurar via `setWebhook` na inicialização do módulo.

### Riscos e mitigações

| # | Risco | Severidade | Mitigação |
|---|-------|------------|-----------|
| R1 | Voice download timeout (Telegram CDN lento) | Alto | AbortController 15s + retry 1x; falha → mensagem "Não consegui processar áudio" |
| R2 | Groq Whisper rate limit / fora do ar | Alto | Circuit breaker + fallback "Áudio não pôde ser transcrito agora" + grava DEvento mesmo sem transcript |
| R3 | Token Telegram exposto em logs | Crítico | Logger filter remove `bot<token>` de URLs; `TELEGRAM_BOT_TOKEN` nunca logado |
| R4 | Chat sequestrado (replay de Update) | Alto | `TelegramSecretGuard` mais validação `update_id` único (cache 1h em Redis) |
| R5 | Pairing code adivinhado por brute-force | Médio | TTL 10min + one-shot + rate limit 5 tentativas/IP/min |
| R6 | N+1 ao listar mensagens com sender | Médio | include/select obrigatório; revisor verifica |
| R7 | DEvento crescendo indefinidamente | Médio | Fase futura: archival cron mensal (out of scope F10) |
| R8 | Fila de updates do Telegram acumula em pico | Médio | Resposta 200 em <100ms + processamento async via setImmediate; futura migração para queue BullMQ |

### Definition of Done (checklist)

- [ ] Seed contém todas as 11 DClasses listadas; total bate.
- [ ] `TelegramSecretGuard` valida assinatura constant-time (test).
- [ ] `POST /webhooks/telegram` responde 200 em <100ms (test e2e).
- [ ] Pairing token: gera, expira, é one-shot (3 testes integração).
- [ ] DVincula -483 criado em $transaction com consumo do token.
- [ ] Mensagem de texto: DEvento -493 criado com metaDados corretos.
- [ ] Mensagem de voz: download + Groq + transcrição gravada (mock Groq em test).
- [ ] Evento `telegram.message.received` emitido APÓS commit.
- [ ] Comandos `/start /pair /tasks /create /status` funcionais (e2e).
- [ ] Intent CreateTaskFromText cria DTask via TaskService.
- [ ] Rate limit Redis 30msg/min (teste com fake clock).
- [ ] Zero N+1 ao listar mensagens (verificado com `DATABASE_LOGGING=true`).
- [ ] Tokens nunca aparecem em logs (grep + test).
- [ ] DTOs com class-validator em todo payload externo.
- [ ] `make build` passa, lint passa, testes (unit+integration) ≥ 85% cobertura no módulo.
- [ ] Swagger documenta endpoints administrativos (`/channels/pairing`).
- [ ] Smoke test descrito abaixo executado com sucesso em staging.

### Tempo estimado

| Bloco | Horas |
|-------|------:|
| A — Core Channels | 8h |
| B — Telegram Webhook | 10h |
| C — Comandos | 8h |
| D — Rate limit + obs | 4h |
| Tests + docs | 8h |
| **Subtotal** | **38h** |
| Buffer 20% | 7h |
| **Total** | **~45h (~6 dias)** |

### Como validar (smoke tests)

```
1. Gerar pairing: POST /channels/pairing (JWT user A) → recebe code 'AB12-CD34'.
2. Enviar /pair AB12-CD34 ao bot via cliente Telegram → resposta sucesso.
3. Verificar DVincula -483 no banco (idLocEscritu=userA.id).
4. Enviar texto livre "criar task comprar leite" → DTask criada, eco com link.
5. Enviar voz "marcar reunião amanhã" → DEvento -493 com transcript; intent
   resolve sem criar task (out of scope: parsing data → tarefa Fase futura).
6. /tasks today → lista filtrada timezone Brasil.
7. Reenviar /pair AB12-CD34 → erro "token já usado".
8. Aguardar TTL → /pair com novo code expirado → erro "expirado".
9. Confirmar evento `telegram.message.received` no logger / fila.
```

---
---

## FASE 11 — MCP SERVER (Model Context Protocol)

### Objetivo

Expor ao Scrumban um endpoint MCP compatível com Claude Code, Cursor e Claude
Desktop. Permite que IDEs/assistentes consultem e criem tasks, listem
projetos e sprints diretamente, sem precisar JWT do user.

Endpoint único `POST /mcp` (JSON-RPC 2.0). Autenticação via header `X-MCP-Key`
(prefixo `scrumban_mcp_<hash>`). Rate limit 60req/min por key.

### Pilares ativados / respeitados

- **Pilar 1:** Tools MCP que criam tasks/projetos chamam Services canônicos
  (não duplicam lógica nem tocam Prisma). Engine não é envolvido (DTask/DProject
  são estruturais).
- **Pilar 2:** Listagens reusam services dos endpoints genéricos
  (TaskService, ProjectService, TabelaService). Endpoint `/mcp` é ÚNICO
  controller — não criar `/mcp/tasks`, `/mcp/projects`, etc.
- **Pilar 3:** DClasses -472 (MCP_KEY) e -497 (MCP_CALL) no seed da Fase 1.

### Padrões obrigatórios aplicados

- **#1, #2, #5** (Prisma, BigInt, conversão userId).
- **#9 DTOs** rigorosos para o envelope JSON-RPC (jsonrpc:'2.0', method, params, id).
- **#10 Guards:** `McpKeyGuard` próprio (não JWT). Composto opcionalmente
  com `AuthCompositeGuard` (JWT OR MCP) para rotas que aceitam ambos.
- **#11 Logger** com `correlationId = jsonrpc.id || uuid()`.
- **#15 Cursor pagination** em listagens (não offset).
- **#17 Swagger** documenta o esquema MCP (`/mcp` aceita JSON-RPC payload).

### Tabelas canônicas envolvidas

| Tabela | Uso |
|--------|-----|
| **DTabela** | `idClasse=-472` MCP_KEY (`dEntidadeId=userId`, `dados={hash,prefix,createdAt,lastUsedAt,scopes,disabled}`) |
| **DEvento** | `idClasse=-497` MCP_CALL — auditoria de cada chamada (metaDados={method,paramsHash,httpCode,durationMs,keyPrefix}) |
| **DTask, DProject, DTabela (sprints)** | Recursos consultados/manipulados pelas tools |
| **Redis** | Rate limit (`mcp:rl:<keyHash>` INCR/EXPIRE) — não banco |

### DClasses a criar (no seed da Fase 1)

| Chave | Código | Nome | idPai | agrupamento |
|------:|--------|------|------:|:-----------:|
| -472 | MCP_KEY | Chave MCP | -52 | false |
| -497 | MCP_CALL | Auditoria de chamada MCP | -3 | false |

### Estrutura de arquivos esperada

```
src/
└─ mcp/
   ├─ mcp.module.ts
   ├─ mcp.controller.ts                    # POST /mcp (JSON-RPC envelope único)
   ├─ mcp-keys.controller.ts               # CRUD chaves (JWT) — POST/DELETE /mcp/keys
   ├─ services/
   │  ├─ mcp-router.service.ts             # dispatch method → tool
   │  ├─ mcp-key.service.ts                # gerar (CSPRNG), hash bcrypt+sha256, revogar
   │  ├─ mcp-rate-limit.service.ts         # Redis token bucket
   │  └─ mcp-audit.service.ts              # registra DEvento -497 (async/fire-forget após resposta)
   ├─ guards/
   │  └─ mcp-key.guard.ts                  # extrai header, valida hash, injeta user no req
   ├─ tools/
   │  ├─ tool.interface.ts                 # { name, description, schema, handler(params, ctx) }
   │  ├─ list-tasks.tool.ts
   │  ├─ create-task.tool.ts
   │  ├─ update-status.tool.ts
   │  ├─ list-projects.tool.ts
   │  └─ list-sprints.tool.ts
   ├─ dto/
   │  ├─ json-rpc-request.dto.ts
   │  ├─ json-rpc-response.dto.ts
   │  └─ create-mcp-key.dto.ts
   └─ schemas/
      └─ tools.schema.json                 # JSON Schema das 5 tools (servido em initialize)
```

### Tarefas detalhadas

1. **Geração de chave:** `mcp-key.service.ts:generate(userId, scopes[])`
   produz 32 bytes CSPRNG, formato visível `scrumban_mcp_<base64url(16bytes)>`,
   armazena `prefix=primeiros 12 chars` + `hash = sha256(key)` em DTabela -472.
   Plaintext é mostrado **uma única vez** na resposta de criação.
2. **Validação:** `McpKeyGuard` extrai header → sha256 → busca em DTabela
   onde `metaDados.hash = ?` AND `disabled=false`. Cache em Redis (TTL 30s)
   para hot-path. Atualiza `lastUsedAt` em background (sem bloquear request).
3. **Endpoint `POST /mcp`** aceita batch e single (JSON-RPC 2.0).
   Methods suportados: `initialize`, `tools/list`, `tools/call`,
   `notifications/initialized`. Esquema MCP oficial 2024-11.
4. **`tools/list`** retorna a lista das 5 tools com seus inputSchemas
   (JSON Schema). Estático (cacheado em memória).
5. **`tools/call`** chama `MCP-Router.dispatch(name, params, userCtx)`:
   - `list_tasks(params: {projectId?, status?, assigneeId?, limit?, cursor?})`
     → TaskService.list (cursor pagination). Retorna lista compacta.
   - `create_task(params: {projectId, titulo, descricao?, assigneeId?, sprintId?})`
     → TaskService.create (canônico). Retorna task criada.
   - `update_status(params: {taskId, statusCode})` → TaskService.updateStatus.
   - `list_projects(params: {limit?, cursor?})` → ProjectService.list.
   - `list_sprints(params: {projectId, limit?, cursor?})` →
     TabelaService.list({idClasse:-400, idLocEscritu:projectId}).
6. **Rate limit Redis:** `mcp-rate-limit.service.ts` aplica token bucket
   simples. Chave `mcp:rl:<sha256(key)>`. Limite 60/min. Excedeu → 429
   JSON-RPC error `{code:-32000, message:'Rate limit'}`.
7. **Auditoria:** `mcp-audit.service.ts.record(method, params, result, ctx)`
   grava DEvento -497 em fire-and-forget após resposta enviada (não bloqueia).
   `paramsHash = sha256(JSON.stringify(params))` para auditoria sem PII.
8. **Endpoints administrativos** (JWT auth):
   - `POST /mcp/keys` — gera nova key. Retorna plaintext UMA vez.
   - `DELETE /mcp/keys/:id` — soft-delete (disabled=true).
   - `GET /mcp/keys` — lista keys do usuário (sem hash, só prefix+lastUsedAt).
9. **Timeout** de 30s por chamada (`MCP_REQUEST_TIMEOUT_MS`).
10. **Compatibilidade MCP:** seguir spec 2024-11 (campos
    `protocolVersion`, `capabilities`, `serverInfo`).

### Dependências

- Fases 5 (TaskService), 4 (ProjectService), 3 (TabelaService).
- Redis (rate limit + cache).
- `MCP_ENABLED=true`, `MCP_REQUEST_TIMEOUT_MS=30000`.

### Riscos e mitigações

| # | Risco | Severidade | Mitigação |
|---|-------|------------|-----------|
| R1 | MCP key vaza em log de erro | Crítico | Logger sanitizer global redacta header `x-mcp-key`; teste verifica |
| R2 | Spec MCP muda (cliente Claude Desktop quebra) | Médio | Contratar versão `protocolVersion: '2024-11-05'`; CI roda smoke contra cliente real |
| R3 | Tool executa ação que requer permissão de outro user | Crítico | userCtx (extraído da key) propagado em todo service call; service valida ownership/role |
| R4 | Redis fora → guard bloqueia tudo | Alto | Fallback degradado (rate limit em memória local com warning); reabilita ao recuperar |
| R5 | Auditoria em DEvento gera carga excessiva | Médio | Batch insert opcional (acumular 50 por 1s) na Fase de tuning |

### Definition of Done

- [ ] DClasses -472 e -497 no seed.
- [ ] `POST /mcp` aceita JSON-RPC 2.0 single + batch.
- [ ] `initialize`, `tools/list`, `tools/call` funcionais.
- [ ] 5 tools implementadas com JSON Schema validado.
- [ ] McpKeyGuard valida hash em tempo constante (test).
- [ ] Plaintext da key retornado UMA vez (test verifica não-repetição).
- [ ] Rate limit 60/min por key (test com fake clock).
- [ ] Auditoria DEvento -497 não bloqueia resposta (medir p95).
- [ ] Header `x-mcp-key` nunca em logs (grep + test).
- [ ] Timeout 30s configurável.
- [ ] Cursor pagination em todas listagens.
- [ ] Compatível com Claude Desktop (smoke real).
- [ ] Endpoints `/mcp/keys` (CRUD) protegidos por JWT.
- [ ] `make build` ok, lint ok, cobertura ≥85%.
- [ ] Swagger documenta envelope JSON-RPC e endpoints admin.
- [ ] Doc `mcp-setup.md` em `docs/` (config Claude Desktop, Cursor).

### Tempo estimado

| Bloco | Horas |
|-------|------:|
| Core router + envelope JSON-RPC | 8h |
| Key service + guard + admin endpoints | 8h |
| 5 tools | 8h |
| Rate limit + auditoria | 5h |
| Tests + docs + smoke real | 8h |
| **Subtotal** | **37h** |
| Buffer 20% | 7h |
| **Total** | **~44h (~5,5 dias)** |

### Como validar (smoke tests)

```
1. POST /mcp/keys (JWT user) → recebe scrumban_mcp_xxx (anota).
2. POST /mcp { initialize } com X-MCP-Key → 200, capabilities OK.
3. POST /mcp { tools/list } → retorna 5 tools.
4. POST /mcp { tools/call list_tasks {limit:5} } → tasks do user.
5. POST /mcp { tools/call create_task {projectId,titulo} } → task criada,
   verificar DTask + DEvento -497 auditoria.
6. 61 chamadas em 60s → 61ª retorna -32000 rate limit.
7. DELETE /mcp/keys/:id → próxima chamada retorna 401.
8. Configurar key no Claude Desktop, perguntar "liste minhas tasks" →
   resposta com dados reais.
```

---
---

## FASE 12 — WEBHOOKS OUTBOUND

### Objetivo

Permitir que clientes externos (Zapier, n8n, IFTTT, sistemas próprios) recebam
notificações HTTP quando eventos ocorrem no Scrumban (`task.created`,
`task.status_changed`, `execution.started`, `execution.completed`, etc.).

Suporta múltiplas URLs por projeto, assinatura HMAC-SHA256, retry exponencial,
auto-disable após falhas, reabilitação manual via endpoint admin.

### Pilares ativados / respeitados

- **Pilar 1:** Sem Engine. Webhooks são integração lateral (HTTP outbound).
  Apenas DEvento (estrutural) gravado por tentativa.
- **Pilar 2:** Configs em DTabela -470 → reusar `/tabela?idClasse=-470`
  para listagem básica. Endpoints específicos (test, redrive) ficam em
  controller próprio dedicado a webhooks (justificado: testes/replay).
- **Pilar 3:** DClasses -470 e -491 no seed inicial.

### Padrões obrigatórios aplicados

- **#1, #2** (Prisma, BigInt).
- **#3 $transaction** ao gravar tentativa + atualizar contador `failureCount`
  no DTabela do webhook.
- **#7 Eventos APÓS persistência:** Webhooks são CONSUMIDORES de eventos
  internos. EventRouter (Fase 9) detecta eventos disparáveis e enfileira
  no `webhook-dispatch-queue` BullMQ.
- **#9 DTOs** em CRUD de webhooks (URL, events[]).
- **#10 Guards** JWT em CRUD; webhook outbound é serviço interno, sem guard.
- **#11 Logger** com correlationId = `eventId`.
- **#14 EventProducer / EventRouter** (Fase 9): novo método
  `EventRouter.isWebhookDispatchableEvent(event)` retorna true para os tipos
  configuráveis.
- **#15 Cursor pagination** em listagem de tentativas.

### Tabelas canônicas envolvidas

| Tabela | Uso |
|--------|-----|
| **DTabela** | `idClasse=-470` WEBHOOK; `dEntidadeId=projectId`; `dados={url, events[], secretHash, disabled, failureCount, createdAt, lastSuccessAt, lastFailureAt}` |
| **DEvento** | `idClasse=-491` WEBHOOK_ATTEMPT; `idEntidade=webhookConfigId`; `metaDados={eventType,eventId,httpCode,bodyHashIn,bodyHashOut,attemptN,nextRetryAt,errorMessage,durationMs}` |
| **Redis (BullMQ)** | Fila `webhook-dispatch-queue` |

### DClasses a criar

| Chave | Código | Nome | idPai | agrupamento |
|------:|--------|------|------:|:-----------:|
| -470 | WEBHOOK | Webhook outbound config | -52 | false |
| -491 | WEBHOOK_ATTEMPT | Tentativa de webhook | -3 | false |

### Eventos suportados (configuráveis na criação do webhook)

```
task.created             task.status_changed       task.assigned
task.deleted             task.commented            task.priority_changed
project.created          project.member_added      project.deleted
sprint.started           sprint.closed
execution.queued         execution.awaiting_approval
execution.approved       execution.rejected
execution.started        execution.completed
execution.failed         execution.expired         execution.rolled_back
agent.online             agent.offline
```

(Lista cresce conforme novas fases — manter constante exportada.)

### Estrutura de arquivos esperada

```
src/
└─ webhooks/
   ├─ webhooks.module.ts
   ├─ webhooks.controller.ts                # CRUD config (JWT, scope:project owner)
   ├─ services/
   │  ├─ webhooks.service.ts                # CRUD em DTabela -470
   │  ├─ webhooks-dispatcher.service.ts     # consumer da fila webhook-dispatch
   │  ├─ webhooks-retry.service.ts          # cálculo backoff + reagendamento
   │  ├─ webhooks-signing.service.ts        # HMAC-SHA256
   │  └─ webhooks-redrive.service.ts        # reabilita + replay tentativas falhas
   ├─ processors/
   │  └─ webhook-dispatch.processor.ts      # @Processor BullMQ
   ├─ guards/
   │  └─ webhook-owner.guard.ts             # valida user é owner/admin do projeto
   ├─ dto/
   │  ├─ create-webhook.dto.ts
   │  ├─ update-webhook.dto.ts
   │  ├─ test-webhook.dto.ts
   │  └─ webhook-event.dto.ts
   └─ constants/
      └─ supported-events.ts
```

### Tarefas detalhadas

1. **CRUD webhooks** (`POST/GET/PUT/DELETE /webhooks`): IDs em BigInt;
   geração de `secret` (32 bytes CSPRNG) → `secretHash=sha256(secret)`
   armazenado, plaintext devolvido uma vez.
2. **Validação eventos**: payload `events[]` valida contra constante
   `SUPPORTED_EVENTS`. Eventos desconhecidos → 400.
3. **Hook no EventRouter (Fase 9)**: para qualquer evento dispatchable,
   `WebhooksHookService.onEvent(event)` busca DTabela -470 onde
   `disabled=false` AND `events @> [event.type]` AND
   `dEntidadeId IN scope` → enfileira jobs em `webhook-dispatch-queue`
   (1 job por webhook).
4. **Processor** consome job: monta payload `{ id, type, occurredAt,
   data, projectId }`. Calcula `signature = hmacSha256(secret, body)`.
   POST com headers:
   - `Content-Type: application/json`
   - `X-Webhook-Signature: sha256=<hex>`
   - `X-Webhook-Event: <type>`
   - `X-Webhook-Delivery: <uuid>`
   - `User-Agent: Scrumban-Webhooks/1.0`
   Timeout 10s. AbortController.
5. **Sucesso (2xx)**: grava DEvento -491 status=success em $transaction
   atualiza `lastSuccessAt`, zera `failureCount`.
6. **Falha (não-2xx, timeout, DNS)**: grava DEvento -491 status=fail.
   Retry exponencial: 1min, 5min, 30min (3 tentativas). Após 3 fails,
   incrementa `failureCount`. Se `failureCount >= 10` (consecutivas no
   nível config), `disabled=true` automaticamente. Loga warning + emite
   evento interno `webhook.auto_disabled`.
7. **Endpoint admin**:
   - `POST /webhooks/:id/test` — dispara payload sintético `webhook.test`.
   - `POST /webhooks/:id/redrive` — reabilita (disabled=false, failureCount=0)
     e opcionalmente replay últimas N tentativas falhas.
   - `GET /webhooks/:id/attempts?cursor=&limit=` — lista DEvento -491.
8. **Ordem de delivery**: best-effort, não-garantida. Documentar no Swagger.
9. **Idempotência**: `X-Webhook-Delivery` UUID permite consumidor deduplicar.

### Algoritmo de retry (pseudocódigo)

```
attempt = job.data.attempt || 1
try:
  response = httpPost(url, body, headers, timeout=10s)
  if 200..299:
    record success
    return
  else:
    throw new HttpError(status)
catch err:
  record fail
  if attempt < 3:
    delay = [60, 300, 1800][attempt-1] * 1000  // ms
    queue.add(job, { delay, data: { ...job.data, attempt: attempt+1 } })
  else:
    increment failureCount in $transaction
    if failureCount >= 10:
      set disabled=true; emit webhook.auto_disabled
```

### Dependências

- Fase 9: EventRouter expõe API para registrar listeners + EventProducer.
- BullMQ (já instalado).
- `WEBHOOK_DISPATCH_TIMEOUT_MS=10000`, `WEBHOOK_AUTO_DISABLE_THRESHOLD=10`.

### Riscos e mitigações

| # | Risco | Severidade | Mitigação |
|---|-------|------------|-----------|
| R1 | URL aponta para rede interna (SSRF) | Crítico | Validar URL: bloquear loopback, link-local, RFC1918 (a menos `WEBHOOKS_ALLOW_PRIVATE=true` em dev) |
| R2 | Secret vaza em logs | Crítico | Sanitizer global; secret nunca em DEvento (só hash) |
| R3 | Payload grande satura fila | Médio | Truncar `data` a 256KB; full payload via API se necessário |
| R4 | Consumer lento bloqueia fila | Alto | Concurrency 10 workers + dedicated queue por prioridade |
| R5 | Retry storm após restart Redis | Médio | Persistência BullMQ + dedup por `X-Webhook-Delivery` |
| R6 | DEvento -491 explode em volume | Médio | Archival cron mensal (Fase futura); índice parcial em (idEntidade, criadoEm) |

### Definition of Done

- [ ] DClasses -470 e -491 no seed.
- [ ] CRUD webhooks com auth + ownership (test).
- [ ] Secret plaintext mostrado UMA vez.
- [ ] Validação SSRF (test com URLs privadas).
- [ ] HMAC-SHA256 assinado e verificável (test com cliente fake).
- [ ] Retry 3x com backoff exato (60/300/1800s) — test fake clock.
- [ ] Auto-disable após 10 falhas consecutivas.
- [ ] DEvento -491 grava todas tentativas.
- [ ] `POST /webhooks/:id/test` funciona.
- [ ] `POST /webhooks/:id/redrive` reabilita + replay.
- [ ] EventRouter dispara apenas eventos suportados.
- [ ] Cursor pagination em `/attempts`.
- [ ] Timeout 10s com AbortController.
- [ ] Idempotência via header X-Webhook-Delivery documentada.
- [ ] `make build`, lint, cobertura ≥85%.
- [ ] Swagger completo + doc `webhooks-guide.md`.

### Tempo estimado

| Bloco | Horas |
|-------|------:|
| CRUD + signing + SSRF | 8h |
| Dispatcher + processor + retry | 10h |
| Hook no EventRouter + integração Fase 9 | 5h |
| Auto-disable + redrive + test endpoint | 5h |
| Tests + docs | 8h |
| **Subtotal** | **36h** |
| Buffer 20% | 7h |
| **Total** | **~43h (~5,5 dias)** |

### Como validar (smoke tests)

```
1. Criar webhook com URL https://webhook.site/<uuid>, events=[task.created].
2. Criar task → ver requisição em webhook.site com headers corretos.
3. Verificar HMAC: replicar sha256(secret, body), bate.
4. Mudar URL para localhost → 400 SSRF.
5. URL inválida 503 → ver 3 tentativas em /attempts (60s, 5min, 30min).
6. Forçar 10 falhas → webhook auto-disabled, evento webhook.auto_disabled.
7. POST /redrive → reabilita, próxima task ok.
8. POST /test → envia payload sintético sem afetar contadores.
```

---
---

## FASE 13 — AUTOMATION CLAUDE CODE (Agent + Execution)

### Objetivo

Permitir que **agentes Claude Code remotos** (instalados em VPSs Linux dos
clientes) sejam vinculados a projetos Scrumban, recebam tarefas de execução
e executem comandos com **risk gate**, **fluxo de aprovação humana**, **PR
auto-open no GitHub** e **rollback** automático em falha. Ciclo end-to-end
auditável via DEvento.

Esta é a fase mais complexa — combina:
- Engine (`OperacaoExecucaoClaude`, criado na Fase 6)
- Scripts DVFS (`risk-gate-validator`, `pr-auto-open`)
- SSH reverso (agente liga no backend)
- Cron sweepers (heartbeat + approval)
- Integração GitHub
- 58 testes adversariais portados

### Pilares ativados / respeitados

- **Pilar 1 — Engine OBRIGATÓRIO:** Execuções são DPedido (transacional!).
  TODA criação/aprovação/conclusão de execução passa por
  `OperacaoExecucaoClaude` (workflow `nova → calcula → aprova → grava`).
  Scripts DVFS implementam Risk Gate (chave 3, pré-cálculo) e PR auto-open
  (chave 7, pós-gravação). NUNCA `prisma.dPedido.create()` direto.
- **Pilar 2:** Agents são DEntidade `idClasse=-152` → reusar `/entidades?idClasse=-152`
  para listagem. Endpoints próprios em `/agents/...` justificados pela lógica
  de install/heartbeat/tunnel. Vínculos Project↔Agent via DVincula -482 →
  acessados via service interno; expor via subrota `/projects/:id/agent`.
- **Pilar 3:** Seed contém todas DClasses (-152, -300..-310, -473, -482,
  -490..-507) na Fase 1.

### Padrões obrigatórios aplicados

- **#1, #2, #3** sempre.
- **#4 TimezoneService** no sweeper de aprovação (timeout em horas Brasil).
- **#5 EntidadeService.getEntidadeIdFromUserGroup** quando registrar
  approver/requester em FK de DEntidade.
- **#6 ZERO N+1** em listagem de execuções com agent + project + status.
- **#7 Eventos APÓS persistência** — todos `execution.*` emitidos pós-grava.
- **#8 Decimal** se houver custos/timeouts financeiros (não há nesta fase).
- **#9 DTOs** rigorosos — comandos validados via DTO + CommandValidator
  custom (whitelist, regex bloqueio).
- **#10 Guards:**
  - `JwtAuthGuard` em endpoints de usuário (gerar token, aprovar).
  - `InstallTokenGuard` em `POST /agents/install` (one-shot).
  - `AgentAuthGuard` em `POST /agents/:id/heartbeat` e tunnel ops
    (autenticação via API key específica do agent).
  - Loopback-only em endpoints de tunnel.
- **#11 Logger** com correlationId = `executionId` do pedido.
- **#14 EventProducer** — `agent.registered`, `agent.online`, `agent.offline`,
  `execution.queued`, `execution.awaiting_approval`, `execution.approved`,
  `execution.rejected`, `execution.started`, `execution.completed`,
  `execution.failed`, `execution.expired`, `execution.rolled_back`.

### Tabelas canônicas envolvidas

| Tabela | Uso |
|--------|-----|
| **DEntidade** | `idClasse=-152` AGENT (`dados={hostname,sshHost,sshUser,sshPort,sshPublicKey,version,statusCode,lastSeen,apiKeyHash,tunnelPort}`) |
| **DTabela** | `idClasse=-473` INSTALL_TOKEN (one-shot, TTL 10min, `dados={tokenHash,expiresAt,projectId,createdBy}`); lookups de status (-490..-507) e risk levels (-505..-507) |
| **DVincula** | `idClasse=-482` PROJECT_AGENT (`idLocEscritu=projectId`, `idEntidade=agentId`, `tipo=primary|secondary`) |
| **DPedido** | `idClasse=-300..-310` EXECUTION (subtipos por categoria); workflow via Engine |
| **DEvento** | `idClasse=-492` AGENT_HEARTBEAT, `-498` EXECUTION_STDOUT, `-499` EXECUTION_AUDIT |
| **DVFS** | Scripts: risk-gate-validator (pré-cálculo), pr-auto-open (pós-gravação) |

### DClasses a criar

| Chave | Código | Nome | idPai | agrup. | Nota |
|------:|--------|------|------:|:------:|------|
| -152 | AGENT | Agente Claude Code | -43 | false | sub-tipo de Pessoa |
| -300 | EXECUTION | Execução Claude Code (root) | -20 | true | sub-tipo de Pedido |
| -301 | EXECUTION_REFACTOR | Execução: refactor | -300 | false | |
| -302 | EXECUTION_FIX | Execução: bug fix | -300 | false | |
| -303 | EXECUTION_FEATURE | Execução: feature | -300 | false | |
| -304 | EXECUTION_TEST | Execução: testes | -300 | false | |
| -305 | EXECUTION_DOCS | Execução: docs | -300 | false | |
| -473 | INSTALL_TOKEN | Token install one-shot | -52 | false | |
| -482 | PROJECT_AGENT | Vínculo project↔agent | -37 | false | sub-tipo de Vínculo |
| -490 | AGENT_STATUS_ONLINE | Status online | -52 | false | |
| -491 | AGENT_STATUS_OFFLINE | Status offline | -52 | false | (CUIDADO: -491 também usado por WEBHOOK_ATTEMPT — ver nota abaixo) |
| -492 | AGENT_STATUS_PENDING_INSTALL | Pending install | -52 | false | |
| -493 | AGENT_STATUS_NEVER_CONNECTED | Never connected | -52 | false | (CUIDADO: -493 já usado por TELEGRAM_MSG_IN) |
| -495 | EXEC_STATUS_QUEUED | Status QUEUED | -52 | false | |
| -496 | EXEC_STATUS_AWAITING_APPROVAL | Status AWAITING_APPROVAL | -52 | false | |
| -497 | EXEC_STATUS_APPROVED | Status APPROVED | -52 | false | (CUIDADO: -497 já usado por MCP_CALL) |
| -498 | EXEC_STATUS_REJECTED | Status REJECTED | -52 | false | |
| -499 | EXEC_STATUS_RUNNING | Status RUNNING | -52 | false | |
| -500 | EXEC_STATUS_SUCCESS | Status SUCCESS | -52 | false | |
| -501 | EXEC_STATUS_FAILED | Status FAILED | -52 | false | |
| -502 | EXEC_STATUS_EXPIRED | Status EXPIRED | -52 | false | |
| -503 | EXEC_STATUS_ROLLED_BACK | Status ROLLED_BACK | -52 | false | |
| -505 | RISK_LEVEL_LOW | Risk low | -52 | false | |
| -506 | RISK_LEVEL_MEDIUM | Risk medium | -52 | false | |
| -507 | RISK_LEVEL_HIGH | Risk high | -52 | false | |
| -508 | AGENT_HEARTBEAT | Heartbeat | -3 | false | (mapear -492 anterior aqui) |
| -509 | EXECUTION_AUDIT | Audit detalhado | -3 | false | |

> **AVISO DE COLISÃO CRÍTICO:** O briefing original sobrepõe chaves entre
> domínios (ex: -491 webhook_attempt vs agent_offline; -493 telegram_msg_in
> vs agent_never_connected; -497 mcp_call vs exec_approved). **DECISÃO:** o
> seed da Fase 1 deve ALOCAR ranges não-colidentes:
> - Webhooks: -470 (config) e -471 (attempt)  ← realocar de -491 → -471
> - Channels/Telegram: -493 (msg_in), -494 (msg_out)  ← manter
> - MCP: -472 (key), -475 (call)  ← realocar -497 → -475
> - Automation status agent: -490..-494  ← manter
> - Automation status execução: -495..-507  ← manter
>
> O Strategist VOLTA atrás na FASE 1 e ajusta ranges ANTES de começar a Fase 10.
> Em todo este documento, considere os ranges definitivos:
> - WEBHOOK_ATTEMPT = **-471**
> - MCP_CALL = **-475**

### Estrutura de arquivos esperada

```
src/
├─ automation/
│  ├─ automation.module.ts
│  ├─ agents/
│  │  ├─ agents.controller.ts                    # /agents (registro, lista, delete)
│  │  ├─ agents.service.ts                       # CRUD + status
│  │  ├─ agent-install-token.service.ts          # gera/valida (DTabela -473)
│  │  ├─ agent-port-allocator.service.ts         # allocate via advisory lock
│  │  ├─ agent-tunnel.service.ts                 # SSH reverso (probe TCP 127.0.0.1:port)
│  │  ├─ agent-status-sweeper.service.ts         # @Cron 30s — marca offline
│  │  ├─ guards/
│  │  │  ├─ install-token.guard.ts               # consume one-shot
│  │  │  ├─ agent-auth.guard.ts                  # API key do agent
│  │  │  └─ agent-tunnel-loopback.guard.ts       # 127.0.0.1 only
│  │  └─ dto/
│  │     ├─ generate-install-token.dto.ts
│  │     ├─ register-agent.dto.ts                # tokenPlain, hostname, sshPublicKey, version
│  │     └─ heartbeat.dto.ts
│  ├─ projects-link/
│  │  ├─ projects-link.controller.ts             # /projects/:id/agent (link/unlink/status)
│  │  └─ project-agent-link.service.ts           # CRUD DVincula -482
│  ├─ execution/
│  │  ├─ execution.controller.ts                 # CRUD execuções (queue, approve, reject, list)
│  │  ├─ execution.service.ts                    # camada acima do Engine
│  │  ├─ approval-flow-sweeper.service.ts        # @Cron 1min — expira awaiting_approval
│  │  ├─ command-validator.service.ts            # 58 testes adversariais
│  │  └─ dto/
│  │     ├─ create-execution.dto.ts
│  │     ├─ approve-execution.dto.ts
│  │     ├─ reject-execution.dto.ts
│  │     └─ execution-status.dto.ts
│  └─ constants/
│     └─ command-blocklist.ts                    # padrões proibidos
├─ engine/lib/operacao/
│  └─ OperacaoExecucaoClaude.ts                  # criada na Fase 6
└─ integrations/
   └─ github/
      ├─ github.module.ts
      ├─ github-pr.service.ts                    # auto-open PR via Octokit
      └─ dto/
         └─ open-pr.dto.ts

prisma/scripts-dvfs/
├─ risk-gate-validator.ts                        # DVFS chave 3 (pré-cálculo)
├─ pr-auto-open.ts                               # DVFS chave 7 (pós-gravação)
└─ rollback-on-failure.ts                        # DVFS chave 7 alt
```

### Tarefas detalhadas (em 6 blocos)

**Bloco A — Agent registry (Conectividade)**

A1. `POST /agents/install-token` (JWT, role:project-admin)
    → `AgentInstallTokenService.generate(projectId, createdBy)`. Retorna
    plaintext de 24 chars (CSPRNG). Hash em DTabela -473 com
    `expiresAt = now + 10min`, `used=false`. Plaintext **uma vez**.

A2. `POST /agents/install` (`InstallTokenGuard`)
    Body: `{ tokenPlain, hostname, sshPublicKey, version, sshHost, sshUser, sshPort }`.
    Em $transaction:
    - Valida token (não-expirado, não-usado).
    - Marca token `used=true`.
    - Cria DEntidade `idClasse=-152` AGENT.
    - Cria DVincula -482 PROJECT_AGENT (idLocEscritu=projectId, idEntidade=agent.chave).
    - Aloca porta via `agent-port-allocator.service.ts` (PostgreSQL
      advisory lock para evitar race). Persiste em `agent.dados.tunnelPort`.
    - Gera `apiKey` do agent (CSPRNG) → hash em `agent.dados.apiKeyHash`,
      retorna plaintext.
    - Status inicial = AGENT_STATUS_PENDING_INSTALL (-492).
    - Emite `agent.registered`.

A3. `POST /agents/:id/heartbeat` (`AgentAuthGuard`)
    Body: `{ version?, metrics? }`.
    - Atualiza `lastSeen=now()`, `statusCode=AGENT_STATUS_ONLINE (-490)`,
      `version`.
    - Insere DEvento -508 AGENT_HEARTBEAT.
    - Se transição offline→online: emite `agent.online`.

A4. `AgentStatusSweeperService` `@Cron('*/30 * * * * *')` (a cada 30s):
    - Busca DEntidade -152 com `lastSeen < now() - 90s` AND status=ONLINE.
    - Marca offline em batch update.
    - Para cada: emite `agent.offline`.

**Bloco B — Project↔Agent link**

B1. `POST /projects/:id/agent` (JWT, role:project-admin):
    body `{ agentId, tipo:'primary'|'secondary' }`. Cria DVincula -482.
    Restrição: 1 agent primário por project (constraint via index parcial).

B2. `DELETE /projects/:id/agent/:agentId`. Marca DVincula `excluido=true`.
    Bloqueia se houver execução em RUNNING/AWAITING_APPROVAL.

B3. `GET /projects/:id/agent/status` — combina DVincula + DEntidade + probe.
    `AgentStatusProbeService.probe(agent)` faz ping TCP em
    `127.0.0.1:tunnelPort` com timeout 2s. Retorna `{ status, lastSeen,
    tunnelOk, version }`.

**Bloco C — Engine `OperacaoExecucaoClaude` (criado Fase 6, integrado aqui)**

C1. Workflow:
    - `nova()` → seq key, idClasse = -301..-305.
    - `setDados({ command, args, projectId, agentId, requestedBy, riskLevel? })`.
    - `calcula()` → executa script DVFS chave 3 = `risk-gate-validator`.
      Script analisa command vs whitelist/regex/AST → atribui riskLevel
      (-505 LOW / -506 MEDIUM / -507 HIGH). Se HIGH, marca `requireApproval=true`.
    - `aprova()` → marca status QUEUED se LOW, AWAITING_APPROVAL se MEDIUM/HIGH.
    - `grava()` → persiste DPedido + script DVFS chave 7 = post-grava
      (emit `execution.queued` ou `execution.awaiting_approval`).

C2. `CommandValidatorService` (Fase 6) é chamado pelo script DVFS de risk gate.
    Importar 58 testes adversariais do legado (em `__tests__`):
    - `rm -rf /`, `:(){:|:&};:`, `curl ... | sh`, escapes shell,
      command injection, etc.

**Bloco D — Approval Flow**

D1. `GET /executions?status=AWAITING_APPROVAL&projectId=X` — listagem
    cursor pagination, include agent+project (zero N+1).

D2. `POST /executions/:id/approve` (JWT, role:project-admin):
    - Busca DPedido com status -496.
    - Em $transaction: update status para -497 APPROVED, registra
      `approver`, `approvedAt`. Insere DEvento -509 audit.
    - Emite `execution.approved`.
    - Enfileira job em `execution-run-queue` para o agent executar.

D3. `POST /executions/:id/reject` (JWT, role:project-admin):
    Body `{ reason }`. Análogo, status -498 REJECTED, emite
    `execution.rejected`. Não enfileira.

D4. `ApprovalFlowSweeperService` `@Cron('0 */1 * * * *')` (a cada minuto):
    - Busca DPedido status=AWAITING_APPROVAL com
      `chcriacao < TimezoneService.toBrazil(now()) - APPROVAL_TTL_MIN`.
    - Marca EXPIRED (-502). Emite `execution.expired`.

**Bloco E — Execução remota (consumer)**

E1. Worker consome `execution-run-queue`. Para cada job:
    - Probe agent (TCP). Se offline → status FAILED + emit `execution.failed`.
    - Conecta no agent via SSH (chave pública trocada no install) com
      timeout. Envia comando estruturado (JSON via stdin).
    - Recebe stdout/stderr em stream. Cada linha → DEvento -498
      EXECUTION_STDOUT (limitado a 1MB total para evitar DoS).
    - Marca status RUNNING ao iniciar, emite `execution.started`.

E2. Sucesso (exit code 0): status SUCCESS (-500). Executa script DVFS
    chave 7 alt = `pr-auto-open`. Se branch criado, chama
    `GithubPrService.openPr({ owner, repo, base, head, title, body })`
    via Octokit. Persiste `prUrl` em `pedido.dados`.
    Emite `execution.completed` com prUrl.

E3. Falha (exit code != 0 OU timeout 1h):
    status FAILED (-501) ou EXPIRED (-502).
    Se `pedido.dados.rollbackOnFailure=true`, executa script DVFS
    `rollback-on-failure` (git reset/revert via SSH). Status
    ROLLED_BACK (-503). Emit eventos correspondentes.

**Bloco F — Hardening + observabilidade**

F1. `command-validator`: 58 testes adversariais escritos antes do código
    (TDD). 100% pass.

F2. Rate limit por agent: 30 req/min via `AgentThrottlerGuard`
    (fork de `McpThrottlerGuard`).

F3. `AgentTunnelGuard`: rotas de tunnel (heartbeat) só aceitam `127.0.0.1`
    (loopback) — agent fala sempre via SSH reverso, nunca via internet pública.

F4. Logs estruturados, métricas: contador execuções por status, latência
    p95, tempo médio em fila.

F5. Idempotência: `POST /executions` aceita header `Idempotency-Key`.
    Cache em Redis 24h.

### Diagrama de fluxo end-to-end (Mermaid)

```mermaid
sequenceDiagram
    autonumber
    actor U as User (Project Admin)
    participant API as Scrumban Backend
    participant DB as Postgres (DEntidade/DTabela/DVincula/DPedido/DEvento)
    participant EVT as EventProducer/Router
    participant Q as BullMQ
    participant SW as Sweepers (cron)
    participant AGT as Claude Code Agent (VPS)
    participant GH as GitHub

    %% Onboarding do agente
    U->>API: POST /agents/install-token (JWT)
    API->>DB: insert DTabela -473 (token TTL 10min)
    API-->>U: tokenPlain (uma vez)
    U-->>AGT: copia token (instalação manual no VPS)
    AGT->>API: POST /agents/install (tokenPlain + sshPublicKey + hostname)
    API->>DB: $tx: marca token used; cria DEntidade -152 + DVincula -482
    API->>EVT: emit agent.registered
    API-->>AGT: agentApiKey (uma vez), tunnelPort

    %% Heartbeat contínuo
    loop a cada 30s
        AGT->>API: POST /agents/:id/heartbeat (AgentAuthGuard)
        API->>DB: update lastSeen + DEvento -508
    end

    SW->>DB: sweep: marca offline lastSeen<-90s
    SW->>EVT: emit agent.offline (se aplicável)

    %% Solicitação de execução
    U->>API: POST /executions {projectId, command, args}
    API->>API: OperacaoExecucaoClaude.nova()+setDados()
    API->>API: calcula() → DVFS risk-gate-validator
    Note right of API: riskLevel=HIGH → AWAITING_APPROVAL
    API->>API: aprova() + grava()
    API->>DB: insert DPedido -3xx + DEvento -509
    API->>EVT: emit execution.awaiting_approval
    API-->>U: 201 {id, status: AWAITING_APPROVAL}

    %% Aprovação humana
    U->>API: POST /executions/:id/approve
    API->>DB: $tx: update status=-497 + DEvento audit
    API->>EVT: emit execution.approved
    API->>Q: enqueue execution-run job
    API-->>U: 200

    %% Sweeper de expiração (caso ninguém aprove)
    SW->>DB: sweep: AWAITING_APPROVAL > APPROVAL_TTL_MIN → EXPIRED
    SW->>EVT: emit execution.expired

    %% Execução remota
    Q->>API: consumer pega job
    API->>AGT: SSH reverse → execução (stdin: JSON)
    API->>EVT: emit execution.started
    AGT-->>API: stream stdout/stderr
    API->>DB: insert DEvento -498 EXECUTION_STDOUT (linha a linha)

    alt Sucesso (exit=0)
        API->>DB: status=-500 SUCCESS
        API->>API: DVFS pr-auto-open
        API->>GH: Octokit.pulls.create({owner,repo,base,head,title,body})
        GH-->>API: prUrl
        API->>DB: update pedido.dados.prUrl
        API->>EVT: emit execution.completed (prUrl)
    else Falha (exit!=0 / timeout)
        API->>DB: status=-501 FAILED
        opt rollbackOnFailure
            API->>API: DVFS rollback-on-failure
            API->>AGT: SSH git reset/revert
            API->>DB: status=-503 ROLLED_BACK
            API->>EVT: emit execution.rolled_back
        end
        API->>EVT: emit execution.failed
    end

    %% Webhook outbound (Fase 12)
    EVT-->>Q: enqueue webhook-dispatch (execution.completed)
    Q->>GH: cliente externo recebe POST /webhook (HMAC)
```

### Dependências

- Fases 1–9 completas.
- Fase 6 já criou o esqueleto `OperacaoExecucaoClaude` + scripts DVFS placeholders.
- Fase 12 (Webhooks) — events de execution dispararão webhooks.
- Octokit `@octokit/rest` instalado.
- `node-pty` ou ssh2 para SSH reverso.
- `@nestjs/schedule` para crons.
- Redis para idempotency e rate limit.
- Variáveis env: `APPROVAL_TTL_MIN=30`, `EXECUTION_TIMEOUT_MS=3600000`,
  `AGENT_HEARTBEAT_TIMEOUT_S=90`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_INSTALLATION_ID`.

### Riscos e mitigações

| # | Risco | Severidade | Mitigação |
|---|-------|------------|-----------|
| **R1** | **Command injection escapando do CommandValidator** | **CRÍTICO** | TDD: 58 testes adversariais escritos ANTES do código. Code review obrigatório com 2 reviewers. Whitelist de comandos + AST parsing + regex bloqueio em camadas. Sandbox no agent (chroot/container). |
| **R2** | **SSH reverso comprometido (agent malicioso ou MITM)** | **CRÍTICO** | Chave pública SSH trocada no install (TOFU + verificação). Agent só aceita comandos assinados (HMAC com apiKey). Backend valida fingerprint. Rate limit + monitoring. |
| **R3** | **Risk Gate classifica errado (HIGH como LOW)** | **CRÍTICO** | Default fail-safe: dúvida → MEDIUM (requer aprovação). Configuração `STRICT_RISK_GATE=true` em prod. Auditoria de toda classificação em DEvento. Re-treino periódico das regras. |
| R4 | Approval flow com TTL não dispara (sweeper falha) | Alto | Cron supervisionado + healthcheck endpoint; alerta se sweeper não roda há >5min |
| R5 | Race condition em aprovação dupla (2 admins clicam simultâneo) | Alto | $transaction com SELECT FOR UPDATE no DPedido; segunda chamada retorna 409 |
| R6 | Auto-open PR cria PR em repo errado | Alto | Validação owner/repo contra DProject.dados.repo no `pr-auto-open` script |
| R7 | Stdout grande (>1MB) DoS no DEvento | Médio | Truncamento por job a 1MB; flag `truncated=true`; download completo via API se necessário |
| R8 | Token install plaintext logado | Crítico | Sanitizer global + test grep |
| R9 | Agent registrado em projeto errado por engano | Alto | install-token vinculado a projectId no momento da geração; agent não pode mudar de projeto sem novo token |
| R10 | Sweeper marca offline durante deploy/restart | Médio | Heartbeat tolerância 90s (3x intervalo); registro de janelas de manutenção |
| R11 | Rollback git pode apagar trabalho legítimo | Alto | Rollback opcional (flag `rollbackOnFailure`); branch separado; PR de rollback ao invés de force-push |
| R12 | Octokit rate limit | Médio | Cache de tokens + retry com backoff; usar GitHub App (5000 req/h) |

### Definition of Done (checklist mínimo 20 itens — fase crítica)

- [ ] Seed da Fase 1 ajustado: ranges não-colidentes (-471 webhook, -475 mcp_call).
- [ ] Todas as DClasses listadas na Fase 13 presentes no seed e validadas.
- [ ] `OperacaoExecucaoClaude` criado na Fase 6 e funcional aqui.
- [ ] Scripts DVFS `risk-gate-validator`, `pr-auto-open`, `rollback-on-failure`
      registrados na DVFS com chaves 3 e 7.
- [ ] **CommandValidator: 58 testes adversariais 100% pass (TDD).**
- [ ] Token install: gera, expira em 10min, é one-shot (3 testes integração).
- [ ] `POST /agents/install`: $transaction cria entidade+vínculo+aloca porta.
- [ ] AgentApiKey plaintext mostrado UMA vez; armazenado como hash.
- [ ] Heartbeat atualiza lastSeen + DEvento -508.
- [ ] AgentStatusSweeper marca offline após 90s sem heartbeat.
- [ ] Project↔Agent link/unlink funcional; bloqueia unlink se exec ativa.
- [ ] Probe TCP em 127.0.0.1:tunnelPort com timeout 2s.
- [ ] Engine pipeline `nova→calcula(DVFS risk gate)→aprova→grava` correto.
- [ ] Approve/Reject endpoints com SELECT FOR UPDATE (sem race).
- [ ] ApprovalFlowSweeper marca EXPIRED após APPROVAL_TTL_MIN.
- [ ] Worker SSH executa, captura stdout limitado a 1MB.
- [ ] PR auto-open via Octokit em sucesso, persiste prUrl.
- [ ] Rollback opcional executa em falha quando `rollbackOnFailure=true`.
- [ ] Eventos `execution.*` e `agent.*` emitidos APÓS commit em todos casos.
- [ ] AgentTunnelGuard restringe a 127.0.0.1.
- [ ] AgentThrottlerGuard 30 req/min por agent.
- [ ] Idempotency-Key suportada em `POST /executions`.
- [ ] Zero N+1 em listagem `GET /executions` com agent+project+status.
- [ ] Cursor pagination em todas listagens.
- [ ] Logger nunca expõe tokenPlain, sshPrivateKey, agentApiKey.
- [ ] Webhook outbound (Fase 12) recebe `execution.*` corretamente.
- [ ] Smoke E2E completo passa: install→link→execute→approve→PR.
- [ ] `make build`, lint, cobertura ≥ 90% (fase crítica exige mais).
- [ ] Swagger documenta TODOS endpoints + RBAC.
- [ ] Doc `automation-guide.md` + `automation-agent-install-runbook.md`.

### Tempo estimado

| Bloco | Horas |
|-------|------:|
| A — Agent registry + sweeper | 14h |
| B — Project↔Agent link | 5h |
| C — Engine integração + DVFS scripts | 14h |
| D — Approval flow + sweeper | 8h |
| E — Worker SSH + PR auto-open + rollback | 16h |
| F — Hardening + 58 testes adversariais (TDD) | 14h |
| Tests E2E + docs runbook | 12h |
| **Subtotal** | **83h** |
| Buffer 25% (fase crítica) | 21h |
| **Total** | **~104h (~13 dias)** |

### Como validar (smoke tests E2E)

```
1. Login user-admin → POST /agents/install-token → tokenA.
2. SSH no VPS de teste → instalar agent CLI → rodar
   `agent install --token=tokenA --backend=https://scrumban.app`.
3. Verificar DEntidade -152 criada, DVincula -482, DTabela -473 used.
4. Aguardar primeiro heartbeat → status -490 ONLINE.
5. POST /projects/:id/agent {agentId, tipo:'primary'} → vinculado.
6. GET /projects/:id/agent/status → online + tunnelOk:true.
7. POST /executions {projectId, command:'ls', riskHint:'low'} → status QUEUED.
8. POST /executions {projectId, command:'rm -rf /tmp/foo'} →
   Risk Gate classifica MEDIUM → AWAITING_APPROVAL.
9. POST /executions {projectId, command:'rm -rf /'} → CommandValidator REJEITA
   antes de gravar (400 Bad Request, não vai a banco).
10. POST /executions/:id8/approve → status APPROVED, fila enqueue.
11. Worker executa → status RUNNING → SUCCESS → PR aberto no GitHub.
12. GET /executions/:id8 → contém prUrl.
13. POST /executions {projectId, command:'sleep 4000'} → após 1h timeout → FAILED.
14. Reset network → agent stop heartbeat → após 90s → status OFFLINE,
    evento agent.offline.
15. POST /executions com agent offline → exec FAILED imediato.
16. Tentar reusar tokenA → 401 (one-shot).
17. ApprovalFlow: criar exec MEDIUM, aguardar APPROVAL_TTL_MIN+1 →
    status EXPIRED, evento execution.expired.
18. Webhook (Fase 12) configurado em events=[execution.completed] →
    recebeu POST com prUrl.
```

---
---

## CONSOLIDAÇÃO FINAL

### Resumo de tempo

| Fase | Estimativa |
|------|-----------:|
| 10 — Channels + Telegram | ~45h (~6d) |
| 11 — MCP Server | ~44h (~5,5d) |
| 12 — Webhooks Outbound | ~43h (~5,5d) |
| 13 — Automation Claude Code | ~104h (~13d) |
| **Total Integrações** | **~236h (~30 dias úteis)** |

### Critérios MUST-HAVE (bloqueadores de release)

- Seed final consolidado SEM colisões de DClasse.
- Engine `OperacaoExecucaoClaude` 100% através do workflow.
- 58 testes adversariais do CommandValidator passam.
- Risk Gate fail-safe (dúvida → MEDIUM).
- AgentTunnelGuard loopback-only.
- Tokens (install, MCP, pairing, agentApiKey, webhook secret) plaintext
  uma única vez; armazenados como hash.
- HMAC verificável em webhooks.
- Approval flow com TTL.
- ZERO N+1 em todas listagens (DATABASE_LOGGING confirma).
- Eventos APÓS commit em todos os caminhos.

### Critérios SHOULD-HAVE

- Auto-open PR via GitHub App.
- Rollback automático opcional.
- Métricas Prometheus expostas para sweepers e filas.
- Cursor pagination em todas listagens.

### Critérios COULD-HAVE (out of scope, Fase futura)

- WhatsApp/Slack channels (a infra está pronta).
- AI parsing de mensagens Telegram com data ("amanhã às 15h").
- Webhooks com filtros condicionais (JSONPath).
- Risk Gate via LLM (atualmente regras determinísticas).
- Archival cron de DEvento.

### Handoff para Implementer

Implementação na ordem **10 → 11 → 12 → 13** (cada fase entra com seed
estável e Engine pronto da Fase 6). Em cada fase:
1. Validar seed/DClasses ANTES de qualquer código.
2. Escrever DTOs + testes TDD do que é crítico (CommandValidator!).
3. Implementar Service → Controller → Guard.
4. Integrar EventProducer/Router após persistência.
5. Documentação Swagger + runbook em `docs/`.
6. Smoke test descrito antes de PR.

**Blocker absoluto:** Fase 13 NÃO inicia sem 58 testes adversariais
do CommandValidator passando. TDD obrigatório.
