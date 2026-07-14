---
name: auth-hardening-fase2-frontend
description: F2 do plano de sessão/auth — hotfix frontend (localStorage + bootstrap defensivo + Web Locks/BroadcastChannel + 401 por code + 503 backoff) no repo Scrumbam-Frontend-V2
metadata:
  type: project
---

# F2 — Hotfix Frontend de Sessão (2026-07-13, repo `Scrumbam-Frontend-V2`)

Plano: `workspace/plans/plan-sessao-auth-hardening.md` §5 FASE 2. Backend F0 (`f1b991f`) e F1 (`2e566bb`) já entregues; contrato em `docs/auth-error-codes.md` (9 códigos) e ADR-V2-062 (grace 60 s + idempotência de refresh).

**Bug morto:** token em `sessionStorage` (escopo ABA) + gate de rota por cookie `scrumbam_auth` (escopo NAVEGADOR) → aba nova entra sem token; toda query tem `enabled: !!accessToken` → zero request → zero 401 → zero logout = **estado zumbi**.

## Arquitetura escolhida (o que reusar depois)
- `src/lib/auth/refresh.ts` — **ponto único de rotação**. `performRefresh()` = `inFlight` (por aba) + `navigator.locks.request` (por navegador) + guard de refreshToken nulo + `api.defaults.baseURL`. Consumido pelo interceptor E pelo bootstrap. Fallback quando não há Web Locks: no-op no lock (backend é idempotente — degrada performance, não correção).
- `src/lib/auth/session-sync.ts` — BroadcastChannel (tokens + logout entre abas); fallback = evento `storage`. Flag `applyingRemote` corta o eco (store→publish→onmessage→store).
- `src/lib/auth/storage-keys.ts` — `AUTH_STORAGE_KEY` fonte única (o `name` do persist e o `event.key` do storage listener precisam bater).

## Gotchas
- **Ciclo de imports:** `api.ts` importa `refresh.ts` estaticamente; `refresh.ts` importa `api.ts` e o store por `await import()` dentro da função (padrão que o arquivo já usava). Store importa `session-sync` estático; `session-sync` importa o store dinamicamente. Build passa.
- **Migração one-shot roda DENTRO do `createJSONStorage(() => ...)`** — é o único ponto garantidamente anterior à 1ª leitura do persist. Só copia se `localStorage[chave] === null` (nunca sobrescreve sessão mais nova).
- `clearSession()` precisa apagar TAMBÉM o resíduo de `sessionStorage`, senão um boot futuro ressuscita a sessão migrada.
- **useMe não tinha `setUser`** (duas fontes de verdade → avatar `?`). React Query v5 não tem `onSuccess` em `useQuery` → sincronizar via `useEffect` no hook (`src/hooks/use-auth.ts`; o plano cita `use-me.ts`, que NÃO existe).
- Hook PostToolUse roda `eslint --max-warnings 0` por Edit → constantes/imports adicionados antes do uso derrubam o hook (transitório); terminar cada arquivo lint-clean.
- Frontend não tinha NENHUM runner de teste. Instalei `@playwright/test` + `playwright.config.ts` + `e2e/auth-new-tab.spec.ts` (+ script `test:e2e`, + `.gitignore` de test-results). **Browsers NÃO instalados e não há stack rodando no dev** → os specs coletam mas dão `skip` sem `E2E_EMAIL`/`E2E_PASSWORD`. O e2e ainda NÃO foi executado contra stack real.
- Validação: `npx tsc --noEmit` (0) + `npx eslint` (0) + `npm run build` (0). `next build` NÃO gateia eslint.
- NÃO tocar em `src/app/(app)/ai/page.tsx` e `src/app/globals.css` (working tree de outra task, redesign da tela /ai).
