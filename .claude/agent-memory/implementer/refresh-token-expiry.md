---
name: refresh-token-expiry
description: Expiração por idade do refresh token (REFRESH_TOKEN_EXPIRY_DAYS) + validate() com 3 estados
metadata:
  type: project
---

# Refresh Token — expiração por tempo (2026-06-05)

Liguei `REFRESH_TOKEN_EXPIRY_DAYS` (antes declarada mas IGNORADA). Zona auth.

**`src/auth/services/refresh-token.service.ts`:**
- `+ConfigService` no construtor (além de PrismaService). `ConfigModule` é `isGlobal:true` (app.module l.88) E importado em auth.module → DI limpa, sem mudança no module.
- `const DEFAULT_REFRESH_TOKEN_EXPIRY_DAYS = 7` (top-level).
- helper `getExpiryDays()`: lê env, `parseInt(.,10)`, valida `Number.isFinite && >0`; ausente→default silencioso; inválido/<=0→default + `logger.warn`.
- `generate()`: grava `refreshTokenExpiresAt` = ISO de `Date.now()+dias*86400000` junto do hash (spread preserva resto).
- `validate()`: retorno trocado de `boolean` p/ **`export type RefreshTokenValidation = 'valid'|'expired'|'invalid'`**. Ordem: hash não bate→`'invalid'`; hash bate + sem carimbo (legado, `typeof !== 'string'`)→`'expired'` (caminho seguro, NÃO revoga); `new Date(exp).getTime() < Date.now()`→`'expired'`; senão `'valid'`.
- `revoke()`: destructuring agora descarta `refreshTokenHash` E `refreshTokenExpiresAt` (`void _x` em ambos p/ eslint).

**`src/auth/auth.service.ts` `refresh()` (~l300):** `isValid` boolean → `validation` union. `'invalid'`→mantém warn REUSE + revoke + 401. `'expired'`→`logger.log` informativo (NÃO 'REUSE') + 401 'Sessão expirada' SEM revoke/rotate. `'valid'`→fluxo segue. Único caller de `validate()` no codebase (grep confirmou; outros `.validate(` são command-validator/api-key, não relacionados).

**Specs:** refresh-token.service.spec reescrito — `+ConfigService` mock (`get` por chave), helper `buildService(days?)` recria módulo p/ testar env ausente/inválida/0. auth.service.spec — 3 `validate.mockResolvedValue(boolean)` → union ('valid'/'invalid'/'valid'); +teste novo 'expired' assert `revoke`/`rotate` NÃO chamados.

**Resultados:** eslint 0; `npm run build` EXIT 0; `jest src/auth` 70/70 (7 suites), era 67. NÃO commitado (pedido do CEO). ZERO mudança de schema (tudo em DUserGroup.dados Json).
