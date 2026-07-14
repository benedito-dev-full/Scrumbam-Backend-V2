# ADR-V2-075: Migração de Armazenamento de Sessão no Browser — sessionStorage → localStorage (Hotfix F2) + BFF httpOnly (Alvo F5)

**Status:** Aceito (hotfix + roadmap F5)
**Data:** 2026-07-13
**Decisores:** Strategist Agent V2 + Reviewer (Score 8.0/10)
**Tags:** #V2 #fase-F2 #hotfix #auth #browser-storage #front-end

---

## Contexto e Problema

### Problema Imediato (Sintoma A — "estado zumbi")

**Manifestação:** Usuário abre aba nova do navegador (mesmo contexto de browser, cookies compartilhados). A aba nova:
- Entra no app (proxy autoriza via cookie `scrumbam_auth=1`)
- Avatar mostra `?`
- Zero projetos/workspaces listados
- **Nenhum request autenticado é disparado**
- Nenhum logout ocorre (app permanece nesse estado indefinidamente)

**Causa-raiz arquitetural:**
- Tokens (access + refresh) armazenados em `sessionStorage` — escopo **per-aba**
- Gate de rota no proxy Next.js: cookie `scrumbam_auth=1` — escopo **per-navegador**

**A divergência:**
```
Aba NOVA, mesmo navegador:
  ✓ Cookie scrumbam_auth=1  (compartilhado entre abas)
  ✗ sessionStorage vazio    (cada aba tem seu storage)
  
Resultado:
  - Proxy autoriza entrada (vê o cookie)
  - Nenhuma query dispara (enabled: !!accessToken, e accessToken==null)
  - App renderiza casca vazia para sempre
```

**Frequência de impacto:** Alto em desenvolvimento (abas novas são comuns); médio em produção (usuários com múltiplas abas abertas).

### Escopo Regulatório

| Norma | Relevância |
|-------|-----------|
| **draft-ietf-oauth-browser-based-apps** (BCP para SPAs, jan/2025) | Define o estado-da-arte: `localStorage` e `sessionStorage` têm **identicamente a mesma exposição a XSS** (ambos same-origin, JS-readable). A distinção entre os dois **não é mitigação de XSS** — é distinção de escopo (aba vs navegador). |
| **OWASP ASVS 5.0 — Session Management** | Sessões devem ser enumeráveis e revogáveis individualmente (multi-device). Tokens em cookie devem ter `HttpOnly`, `Secure`, `SameSite`. |
| **RFC 6750 — Bearer Token Usage** | `invalid_token` → **401**. Armazenamento inadequado (aba vs navegador) não é problema de token; é problema de arquitetura. |
| **Prática de indústria** | Google, Meta, Auth0, Okta recomendam BFF (Backend-For-Frontend) com token em cookie httpOnly first-party, não JS storage. |

---

## Alternativas Consideradas

### Opção 1: Manter sessionStorage + corrigir o gate de rota

| Prós | Contras |
|-----|--------|
| Zero mudança no frontend | Não resolve; é o gate que é o problema, não o storage. Quem tem permissão de rota é todos os navegadores do user; o token precisa existir na aba nova. |
| | Reintroduz o zumbi em qualquer cenário novo (abas novas, logout de uma aba não limpa outras) |

**Resultado:** Rejeitado. O storage é parte do problema.

---

### Opção 2: localStorage AGORA (Hotfix F2) + BFF httpOnly DEPOIS (Alvo F5)

**Fase 2 (AGORA — 2 dias):**
- Migração one-shot: se `localStorage` vazio e `sessionStorage` tem sessão → copia no boot
- Bootstrap defensivo: cookie sem token → refresh silencioso → se falhar, /login (nunca zumbi)
- Sincronização entre abas: BroadcastChannel + fallback storage event (logout em uma aba desloga todas)

**Justificativa de segurança:**
- `sessionStorage` → `localStorage` **não aumenta a superfície de XSS**
- Ambos são same-origin, JS-readable; um XSS que lê um lê o outro (draft-oauth-browser-based-apps)
- O delta de risco real é **máquina compartilhada / sessão persistente**, mitigado por: expiração absoluta (30 d) + `/auth/sessions` com revoke + logout que limpa storages
- RFC 9700 exige rotação com detecção de replay — ainda aplicada (Fase 1 — backend, já implementado)

**Fase 5 (ALVO — 2–3 semanas):**
- Route handlers do Next.js como BFF (proxy)
- Sessão do BFF em Redis
- Cookie httpOnly; Secure; SameSite=Lax **first-party** (mesmo host do front)
- Token **nunca** toca o JS do browser
- Backend permanece Bearer (BFF injeta header Authorization)

| Prós | Contras | Mitigações |
|-----|---------|-----------|
| Resolve zumbi **HOJE** (2 dias) | Expõe token a XSS | Expiração 30d; `/auth/sessions` com revoke; logout limpa ambos storages |
| Já compatível com Bearer backend | Máquina compartilhada | Mesmos controles acima |
| Migração reversível (dual-read de sessão em DTabela fallback para slot legado) | Não é SOTA (BCP recomenda BFF) | BFF é a Fase 5 — não pulamos |
| Nenhum breaking change no backend | — | — |

---

### Opção 3 (REJEITADA): Cookie httpOnly direto do backend (D1-a do plano)

| Prós | Contras |
|-----|---------|
| Padrão-ouro contra XSS-exfiltration (token nunca no JS) | **Muda contrato Bearer** — frontend e backend em hosts distintos (`frontend.scrumban.com.br` vs `api.scrumban.com.br`) |
| | Com hosts distintos, cookie é **cross-site** → precisa `SameSite=None` (enfraquece CSRF) |
| | Reintroduz CSRF como risco pior que a XSS que tenta mitigar (RFC 6265bis § SameSite) |
| | **Impacto em MCP/API-key** — contrato muda, precisa de ADR e fase própria |
| | Semanas de refundação, risco alto |

**Resultado:** Rejeitado. O BFF (Opção 2 Phase 5) alcança o mesmo objetivo (token fora do JS) **sem** reintroduzir CSRF.

---

## Decisão

**Adotamos Opção 2 (duas etapas sem cima-do-muro).**

### Fase 2 (AGORA — Hotfix, 2 dias) — localStorage

1. **Migração one-shot** `sessionStorage` → `localStorage`:
   ```typescript
   // auth.ts:36-46
   function migrateSessionToLocalStorage(): void {
     if (localStorage.getItem(AUTH_STORAGE_KEY) !== null) return;  // Nunca sobrescreve novo
     const legacy = sessionStorage.getItem(AUTH_STORAGE_KEY);
     if (legacy === null) return;
     localStorage.setItem(AUTH_STORAGE_KEY, legacy);
   }
   ```
   - Idempotente: só copia se `localStorage` estiver vazio
   - Abas abertas no momento do deploy têm sessão só no `sessionStorage` → copia no boot → sobrevive
   - Quem recarregar sem `sessionStorage` cai no ponto 2

2. **Bootstrap defensivo** em `providers.tsx`:
   ```typescript
   // Pseudocódigo
   useEffect(() => {
     if (cookie scrumbam_auth exists && accessToken == null) {
       attempt silent refresh
       if failed: clearSession() + redirect /login
     }
   }, []);
   ```
   - Mata o estado zumbi **por construção** — se por qualquer motivo a migração falhar, ninguém fica zumbi; cai no login

3. **Sincronização entre abas** (`session-sync.ts`):
   - BroadcastChannel + fallback storage event
   - Logout em uma aba desloga todas → requisito ASVS de terminação de sessão
   - Rotação de tokens propaga novo par para todas as abas

4. **Tratamento de erro 503** no interceptor (`api.ts`):
   - Infra lenta/timeout não desloga — backoff + retry
   - Precedente: Fase 1 backend já devolve 503 em falha de infra (em vez de 401 mascarado)

### Fase 5 (ALVO — BFF com httpOnly, 2–3 semanas)

**Pré-requisito:** F2 estabilizada por ≥2 semanas em produção.

1. **Route handlers do Next.js como proxy** (`src/app/api/[...slug]/route.ts`):
   - Recebe request do cliente (sem token no header)
   - Lê token do cookie httpOnly
   - Injeta `Authorization: Bearer <token>` no request ao backend

2. **Sessão do BFF em Redis:**
   - Token refreshed pelo BFF, armazenado em Redis com chave de sessão httpOnly
   - TTL gerenciado pelo BFF
   - Mesmo impacto que hoje (cache de token) com benefício de token nunca tocar JS

3. **Cookie httpOnly; Secure; SameSite=Lax first-party:**
   - Cookie em `api.scrumban.com.br` com path `/api`
   - Frontend (SPA) continua em `frontend.scrumban.com.br`
   - Requer DNS/proxy que unifique os hosts (`*.scrumban.com.br` → cookie compartilhado)
   - **Sem `SameSite=None` → CSRF é seguro**
   - Backend **permanece Bearer** — BFF é apenas um proxy, não muda o contrato

4. **Impacto zero em MCP/API-key:**
   - MCP Server (cliente direto do backend) usa credenciais como antes
   - BFF não toca em autenticação de máquina-para-máquina
   - API-key segue ADR-V2-004 (em DTabela)

---

## Consequências

### Positivas

- **Fase 2:** Estado zumbi eliminado **em 2 dias**. Deploy sem deslogar ninguém (migração one-shot + bootstrap defensivo).
- **Fase 2:** Aba nova tem sessão no primeiro render → zero silêncio de rede.
- **Fase 2:** Logout e revoke de sessão sincronizados entre abas → requisito ASVS atendido.
- **Fase 5:** Token **nunca** no JS → mitigação total de XSS-exfiltration (SOTA).
- **Fase 5:** `SameSite=Lax` (não `None`) → CSRF eliminado (não enfraquecido).
- **Segurança preservada:** RFC 9700 (detecção de replay de refresh) continua ativa. Fase 1 backend já implementou grace + idempotência + família/jti.

### Negativas

- **Fase 2:** Máquina compartilhada pode ter sessão persistente após logout (em 30 d). Mitigado por: logout limpa storage + `document.cookie` revoke + expiração absoluta + `/auth/sessions` com revoke.
- **Fase 2:** Ainda exposto a XSS (mesmo que `sessionStorage`); não é SOTA. Aceito como tradeoff de tempo de entrega.
- **Fase 5:** BFF é trabalho real (route handlers + Redis) — 2–3 semanas de desenvolvimento.
- **Fase 5:** Requer infra (DNS/proxy unificado para cookies first-party). Precisamos validar setup de produção antes de F5.

---

## Implementação

### Fase 2 (Frontend-V2, Task #996 DEV-172)

**Arquivos modificados/criados:**

1. `src/lib/stores/auth.ts` — migração + `localStorage`
2. `src/lib/auth/session-sync.ts` — BroadcastChannel + fallback
3. `src/lib/auth/storage-keys.ts` — constantes
4. `src/lib/api.ts` — interceptor: guard `refreshToken` nulo, 503 com retry/backoff, `code`-aware
5. `src/app/providers.tsx` — bootstrap defensivo, `initSessionSync()`
6. `src/components/shell/app-topbar.tsx` — avatar fix (usar `useMe()` ao invés de store direto)
7. `e2e/auth-new-tab.spec.ts` — teste que falha ANTES da F2, passa DEPOIS
8. `playwright.config.ts` — config Playwright

**Migração segura (zero logout):**
- Uma sessão em `sessionStorage` **antes** do deploy → copia no boot → `localStorage` → sobrevive
- Uma sessão **sem** `sessionStorage` (hard reload em aba nova) → bootstrap defensivo → refresh silencioso ou /login
- Logout explícito → ambos storages limpos + broadcast logout para todas as abas

**Teste de validação (§6.5 do plano):**
```bash
E2E_EMAIL=... E2E_PASSWORD=... npx playwright test e2e/auth-new-tab.spec.ts
```
- Antes da F2: aba nova dispara zero requests autenticados (zumbi)
- Depois da F2: aba nova dispara `/auth/me` + lista workspaces

**Pendências reais documentadas:**

1. **E2E nunca foi executado** — gate §6.5 do plano foi skipado (sem `E2E_EMAIL`/`E2E_PASSWORD`, sem stack de pé). Score 8.0 baseado em verificação estática, não empírica. **Precisa rodar antes do deploy real** com credenciais de teste.

2. **503 inconsistente** — um 503 (`AUTH_BACKEND_UNAVAILABLE`) durante `bootstrapSession` resulta em logout (catch não distingue infra de credencial). O interceptor de `api.ts` trata 503 com retry/backoff; o bootstrap não. Não é o zumbi (é logout honesto), mas é ajuste fino pendente (follow-up em Fase 3).

### Fase 5 (Backend-V2 + Frontend-V2, alvo F5)

*Detalhes em ADR-V2-075-parte-2-bff-httponly.md (a ser redigido na Fase 4).*

---

## Notas

### Relacionados

- **ADR-V2-076** — Rotação com grace + idempotência (backend, Fase 1). Não aumenta exposição XSS; apenas reduz falso-positivo de reuse.
- **ADR-V2-061** — Sessões multi-device em DTabela (backend, Fase 3). Complemento necessário para revoke por sessão.
- **ADR-V2-064** — Semântica de erro com `code` (backend, Fase 1–4). Frontend consome `code` para distinção: `TOKEN_EXPIRED` → retry, `SESSION_REVOKED` → logout, `ORG_CONTEXT_STALE` → refresh+retry, `AUTH_BACKEND_UNAVAILABLE` → backoff+retry.
- **auth-pattern-v2** (memory) — V2 usa Bearer (tokens no body do login), não cookie. Fase 5 **não muda** o contrato do backend; BFF é um proxy que injeta o header.

### Por que localStorage não é segurança degradada

Citação direta de **draft-ietf-oauth-browser-based-apps**:

> "There is no strong distinction between sessionStorage and localStorage from a security perspective. Both are vulnerable to the same XSS attacks, as they are accessible from JavaScript in the same origin."

— Section 5.2, IETF

A segurança real contra XSS vem de:
1. CSP (Content Security Policy)
2. Eliminação de inline scripts
3. Input validation no backend
4. **BFF (alvo F5)** — token nunca no JS

A escolha entre `sessionStorage` e `localStorage` afeta **escopo**, não **defesa**.

### Timeline de deploy (sem deslogar ninguém)

```
Fase 2 (F2) — hotfix frontend, 2 dias:
  ✓ Construída com dual-read (localStorage + fallback bootstrap)
  ✓ Deploy: segunda-feira 8h, fora do pico
  ✓ Métrica: beacon `auth-zombie` = 0 por 72 h (hoje: >0)
  
Fase 3–4 (backend estrutural) — 2–3 semanas
  ✓ Sessões multi-device em DTabela + multi-tenant + semântica de erro

Fase 5 (F5, alvo) — BFF, 2–3 semanas
  ✓ BFF com route handlers + Redis
  ✓ Cookie httpOnly first-party
  ✓ Token **nunca** no JS
```

---

**Versão:** 1.0  
**Última revisão:** 2026-07-13  
**Próximo passo:** ADR-V2-075-parte-2-bff-httponly.md (Fase 4–5)
