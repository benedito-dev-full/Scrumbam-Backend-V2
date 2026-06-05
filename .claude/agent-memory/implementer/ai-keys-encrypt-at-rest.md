---
name: ai-keys-encrypt-at-rest
description: Criptografia at-rest (AES-256-GCM) das chaves de IA do Nexus — R-2 / ADR-V2-064; plug do util ai-key-crypto na escrita/leitura + auto-migração
metadata:
  type: project
---

# AI Keys encrypt-at-rest (R-2 / ADR-V2-064) — 2026-06-04

Util `src/ai/crypto/ai-key-crypto.ts` (já existia) exporta `encrypt/decrypt/isEncrypted/tryDecrypt`.
Formato `enc:v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`. Master key de `process.env.AI_KEYS_ENCRYPTION_KEY`
(hex 64 chars; fallback sha256+warn se fora do formato; ausente → InternalServerErrorException claro).

**Why:** decisão CEO travada — cifrar `dados.plaintext` de DTabela -481/-482/-483 sem mudar schema; só `node:crypto`.

**How to apply (4 pontos cirúrgicos):**
- ESCRITA `ai-keys.service.ts` upsertKey: 2 ramos (update `existing` + create) gravam `plaintext: encrypt(key)`.
  CRÍTICO: `prefix`/`hash` continuam derivados do `key` CRU (máscara + detecção de duplicata). `toResponse`
  envolve `dados.plaintext` em `tryDecrypt` ANTES de extrair prefix/sufixo → robusto p/ novos (cifrados) e
  legados (plaintext). `listKeys` chama `toResponse` lendo do banco → cobre cifrado e legado.
- LEITURA `ai-key-resolver.service.ts` `tryReadFromDTabela`: `select` passou a incluir `chave` (PK p/ update);
  retorna `tryDecrypt(raw)`. Quando `!isEncrypted(raw)` E `row.chave` existe → `migrateToEncrypted()`
  fire-and-forget (`void prisma...update().then().catch()`), preserva demais campos de `dados`, NUNCA loga a chave.
  Helper separado `migrateToEncrypted(chave, dados, raw)` — try/catch no `encrypt` (chave-mestra ausente não
  quebra leitura), `.catch` no update best-effort.

**Gotchas:**
- Specs existentes NÃO setavam `AI_KEYS_ENCRYPTION_KEY` → upsertKey passaria a lançar em `encrypt()`. Adicionei
  `beforeAll`/`afterAll` setando `'b'.repeat(64)` em ai-keys.service.spec e `process.env.AI_KEYS_ENCRYPTION_KEY='c'.repeat(64)`
  no beforeEach do resolver.spec (que já reseta `process.env` no afterEach).
- Resolver spec antigo mocka rows `{ dados: { plaintext } }` SEM `chave` → auto-migração corretamente pulada
  (guard `row.chave !== undefined`). Por isso passou sem tocar nesses casos.
- Auto-migração é microtask: no teste, `await Promise.resolve()` após resolveKey antes de assertar `update`.
- `data: { dados: encryptedDados as any }` no update do resolver precisa `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
  (Prisma InputJsonValue; padrão dos outros services do módulo usa cast).
- Crypto spec: adulterar authTag = XOR no 4º segmento base64; `decrypt` de formato inválido também lança.

**Resultado:** build EXIT 0 (`npm run build` = nest build + copy:dvfs-assets), `npm run lint` 0 errors
(114 warnings pré-existentes), jest src/ai = 110/110 (era 70; +crypto.spec +casos cifrado/auto-migração).
README src/ai + .env.example ganharam `AI_KEYS_ENCRYPTION_KEY` com `openssl rand -hex 32`.
Não houve commit (orquestra a conversa principal).
