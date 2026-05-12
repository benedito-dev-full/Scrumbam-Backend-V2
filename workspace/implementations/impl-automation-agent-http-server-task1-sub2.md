# Implementation: Task #1 Sub-tarefa 2 — HTTP Server + HMAC + Dispatcher

**Implementer:** Implementer Agent V2
**Data:** 2026-05-12
**Módulo:** automation/agent (`Scrumban-Backend-V2/agent/`)
**Fase V2:** F13 cliente — Sub-tarefa 2 de 7
**Plano:** `workspace/plans/plan-automation-agent-v2-client-task1.md` §5 Sub-tarefa 2
**Tempo Total:** ~4h (plano estimou 5-6h)

---

## O Que Foi Feito

### Arquivos Criados

| Arquivo | LoC aprox | Função |
|---|---|---|
| `agent/src/server/nonce.store.ts` | ~80 | LRU anti-replay (10min TTL, 10k max) |
| `agent/src/server/hmac.middleware.ts` | ~200 | Algoritmo HMAC idêntico ao backend, `timingSafeEqual` |
| `agent/src/server/rate-limit.middleware.ts` | ~60 | `express-rate-limit` 60 req/min por agentId |
| `agent/src/server/dispatcher.ts` | ~95 | `POST /v1/execute` dispatcher PING/RCC/unknown/missing |
| `agent/src/server/http.server.ts` | ~200 | Express bind 127.0.0.1, pipeline, graceful shutdown |
| `agent/__tests__/http.server.spec.ts` | ~350 | 15 specs supertest |

### Arquivos Modificados

| Arquivo | Mudança |
|---|---|
| `agent/src/index.ts` | Bootstrap agora chama `server.start()` e instala handlers SIGTERM/SIGINT |
| `agent/package.json` | +deps: `express-rate-limit`, `lru-cache`; +devDeps: `supertest`, `@types/supertest` |
| `agent/src/server/.gitkeep` | Removido (server/ agora tem arquivos reais) |
| `workspace/STATUS.md` | Nova seção Sub-tarefa 2 ⏳ |

---

## 3 Pilares

### Pilar 1: Engine/Operação
N/A — agente é executor passivo; não persiste DPedido nem chama Engine. Toda escrita transacional ocorre no backend via `OperacaoExecucaoClaude` (F13 backend já feito).

### Pilar 2: Endpoints Genéricos
N/A — agente expõe **dois endpoints inbound proprietários** (`GET /ping`, `POST /v1/execute`). Não há reuso de `/entidades` ou `/tabelas` porque (a) agente não fala Prisma, (b) o contrato HTTP+HMAC é específico do canal backend↔agente (ADR-V2-033).

### Pilar 3: Seed de Classes
N/A — zero DClasse nova. Todas as classes do agente já existem no seed do backend (-156 AGENT, -185 INSTALL_TOKEN, -300..-303 EXECUTION).

---

## Decisões Tomadas

### 1. GET /ping COM HMAC

Recomendação do plano seguida. Razão: coerência > simplicidade marginal. Backend faz health checks autenticados — manter pipeline uniforme reduz superfície de erro (não precisa lembrar exceção). Resposta `{ok:true, agentId, version:'0.1.0', uptimeSec}` é suficiente para o backend correlacionar liveness.

### 2. Stub RUN_CLAUDE_CODE → 501 NotImplemented

Recomendação do plano seguida. Semanticamente correto:
- 501 = "server reconhece o método, mas não implementou".
- Distingue de 400 (cliente errou o pedido) e 503 (transitório).
- Body inclui `executionId` (ecoado do request) e `errorCode: NOT_IMPLEMENTED` para o backend logar / Sub-tarefa 4 substituir sem mudar contrato.

### 3. Algoritmo HMAC byte-a-byte com o backend

Replicado da função `buildHeaders()` em `src/automation/runtime/remote-execution-client.ts:227-251`:

```
canonical = method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + sha256_hex(rawBody)
signature = hmac_sha256(secret, canonical).toString("hex")
```

Headers esperados:
- `x-scrumban-agent-id` (deve casar com `config.agentId`)
- `x-scrumban-timestamp` (ISO 8601, skew ±5min)
- `x-scrumban-nonce` (UUID v4, anti-replay 10min)
- `x-scrumban-signature` (`hmac-sha256=<hex64>`)

Comparação via `crypto.timingSafeEqual` em buffers hex de mesmo tamanho.

### 4. `rawBody` preservation via `express.json({ verify })`

`req.rawBody` é populado pelo callback `verify` ANTES do parse JSON. Necessário porque `sha256(JSON.stringify(parsed))` ≠ `sha256(originalBytes)` (espaços, ordem de chaves, escape Unicode podem divergir).

### 5. Path canônico = `req.path` (sem querystring)

Espelha o backend que usa `path = '/v1/execute'` na construção do canonical. `req.originalUrl` traria a querystring e quebraria a assinatura. Documentado no comentário do `hmac.middleware.ts`.

### 6. Pipeline: parser → HMAC → rate limit → dispatcher

Ordem deliberada:
- Body parser PRIMEIRO (gera `rawBody`).
- HMAC ANTES do rate limit — requests inválidos não consomem bucket. Atacante sem secret válido recebe 401 e não polui o limite legítimo.
- Nonce só é registrado APÓS HMAC válido (mesma razão).

### 7. Bind 127.0.0.1 hardcoded

`app.listen(config.tunnelPort, '127.0.0.1', ...)` — endereço fixo, não configurável. Decisão de segurança: agente só recebe via reverse tunnel SSH (autossh, Sub-tarefa 5). Bind em `0.0.0.0` exporia o socket à rede da VPS mesmo com HMAC válido.

### 8. Graceful shutdown 30s + force `closeAllConnections`

`server.close()` aguarda conexões in-flight; após 30s, força `closeAllConnections()` (Node 18+). Evita processo zumbi se um cliente segurar a conexão aberta indefinidamente. Idempotente — segundo `stop()` resolve imediatamente.

### 9. Rate limit `windowMs/max` configurável via factory option

Default produção: 60 req/min. Testes usam `{windowMs:60_000, max:3}` para acionar 429 sem disparar 60 requests reais. Não muda semântica — apenas calibra para o ambiente.

### 10. `express-rate-limit` e `lru-cache` como `dependencies`

Não `devDependencies`. Rodam em produção. Único deps adicionados além do supertest+@types/supertest (que vão para devDependencies).

---

## Testes Realizados

### Compilação

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS — 0 errors |
| `npm run build` (tsc) | PASS — gera `dist/server/{nonce.store,hmac.middleware,rate-limit.middleware,dispatcher,http.server}.{js,d.ts,js.map}` |
| `npm run lint` | PASS — 0 errors, 0 warnings |

### Funcional (specs)

15 specs em `__tests__/http.server.spec.ts`, todos PASS (1.3s total no `npm test`):

| # | Cenário | Status |
|---|---|---|
| 1 | HMAC válido + type=PING → 200 `{accepted:true, message:'pong'}` | PASS |
| 2 | Signature errada → 401 `HMAC_INVALID` | PASS |
| 3 | Timestamp velho (>5min) → 401 `TIMESTAMP_SKEW` | PASS |
| 4 | Nonce repetido → 2ª request 409 `NONCE_REPLAY` | PASS |
| 5 | Type desconhecido → 400 `UNKNOWN_COMMAND_TYPE` com `supportedTypes` | PASS |
| 6 | Type=RUN_CLAUDE_CODE → 501 `NOT_IMPLEMENTED` | PASS |
| 7 | Sem type → 400 `MISSING_TYPE` | PASS |
| 8 | x-scrumban-agent-id errado → 401 `AGENT_MISMATCH` | PASS |
| 9 | GET /ping HMAC válido → 200 `{ok:true, agentId, version, uptimeSec}` | PASS |
| 10 | Rate limit 4ª request (max=3 para teste) → 429 `RATE_LIMIT_EXCEEDED` | PASS |
| 11 | Headers HMAC ausentes → 401 `MISSING_HEADER` | PASS |
| 12 | Rota inexistente → 404 `NOT_FOUND` | PASS |
| 13 | Body JSON malformado → 400 `INVALID_JSON` | PASS |
| 14 | `start()` + supertest contra socket real (porta 40123) → 200 | PASS |
| 15 | `start()` duas vezes → throws "ja foi iniciado" | PASS |

Total de specs no agent/: 26 (11 config.loader + 15 http.server). Todos PASS.

### Performance / N+1

N/A nesta sub-tarefa — agente não toca DB, só processa request HTTP single-shot.

---

## Confirmações de Escopo (NÃO toquei em outras sub-tarefas)

- [x] **NÃO criei** outbound client / heartbeat (Sub-tarefa 3). Pasta `agent/src/outbound/` permanece vazia.
- [x] **NÃO implementei** handler real de RUN_CLAUDE_CODE (Sub-tarefa 4). Dispatcher retorna 501 stub. Pasta `agent/src/claude-code/` permanece vazia.
- [x] **NÃO criei** autossh wrapper (Sub-tarefa 5). Pasta `agent/src/tunnel/` permanece vazia.
- [x] **NÃO criei** install.sh nem systemd unit (Sub-tarefa 6).
- [x] **NÃO escrevi** ADR-V2-030/031/032 (Sub-tarefa 7).

---

## Checklist do Plano

- [x] Leu plano-task1 §4 (endpoints REST + payload V2) e §5 Sub-tarefa 2
- [x] `src/server/http.server.ts` (express + bind 127.0.0.1)
- [x] `src/server/hmac.middleware.ts` (algoritmo idêntico ao backend, timing-safe compare)
- [x] `src/server/nonce.store.ts` (LRU 10min, max 10k entries)
- [x] `src/server/rate-limit.middleware.ts` (60 req/min por agentId)
- [x] Handler `GET /ping` (com HMAC, retorna agentId/version/uptime)
- [x] Handler `POST /v1/execute` (dispatcher PING/RUN_CLAUDE_CODE/unknown)
- [x] Stub 501 pra RUN_CLAUDE_CODE
- [x] `src/index.ts` atualizado pra startar server e SIGTERM/SIGINT
- [x] 10 specs obrigatórios PASS (+ 5 bonus edge cases + 2 lifecycle)
- [x] `cd agent && npm test` PASS (26/26)
- [x] `cd agent && npm run build` PASS
- [x] `cd agent && npm run lint` PASS (0 warnings)
- [x] STATUS.md atualizado

---

## Melhorias Futuras (fora desta sub-tarefa)

- **Métricas Prometheus** (`/metrics` em outra porta) — Sub-tarefa de hardening pós-MVP.
- **Hot-reload de config** via SIGHUP — Sub-tarefa de hardening.
- **Auditoria de nonce store** — métrica `noncestore.size` em /metrics ou heartbeat.
- **Ownership check do config.json** (`stat.uid === process.getuid()`) — pode entrar em Sub-tarefa 6 (install.sh).

**Pronto para Review.**
