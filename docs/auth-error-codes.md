# Auth Error Codes — Contrato API V2

**Data:** 2026-07-13  
**Fase:** F1 Hotfix (Task #995 / DEV-171)  
**Formato:** RFC 9457 — Problem Details for HTTP APIs  
**Consumidor:** Frontend (Scrumbam-Frontend-V2 interceptor)

---

## Envelope Padrão de Erro

Todos os erros HTTP retornam este formato:

```json
{
  "statusCode": 401,
  "code": "TOKEN_INVALID",
  "message": "Refresh token não encontrado ou inválido",
  "error": "Unauthorized",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-07-13T12:00:00.000Z",
  "path": "/api/v1/auth/refresh"
}
```

### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `statusCode` | number | HTTP status code (401, 403, 404, 500, 503) |
| `code` | string | Discriminador machine-readable — determina ação do cliente |
| `message` | string \| string[] | Mensagem legível humano (pode ter tradução) |
| `error` | string | Nome genérico do erro HTTP (ex: "Unauthorized", "Forbidden") |
| `correlationId` | string | ID único para rastreamento de erro (logs, suporte) |
| `timestamp` | string | ISO 8601 do instante do erro |
| `path` | string | Path HTTP que gerou o erro |

---

## Catálogo de Códigos

### AUTH — Autenticação / Refresh Token (401)

#### `TOKEN_INVALID`

**Status:** 401 Unauthorized  
**Quando disparado:** Refresh token não encontrado, inválido, ou hash não corresponde  
**Exemplo:** Usuário tenta usar `refreshToken: "lixo"` ou token de outra sessão  
**Ação esperada do cliente:**
- Limpar `localStorage/sessionStorage` de auth
- Redirecionar para `/login` (re-autenticar)
- Mostrar toast: "Sua sessão expirou. Por favor, faça login novamente."

**Exemplo response:**
```json
{
  "statusCode": 401,
  "code": "TOKEN_INVALID",
  "message": "Refresh token não encontrado ou inválido",
  "correlationId": "abc-123",
  "timestamp": "2026-07-13T12:00:00Z",
  "path": "/api/v1/auth/refresh"
}
```

---

#### `TOKEN_EXPIRED`

**Status:** 401 Unauthorized  
**Quando disparado:** Refresh token existe, mas passou da validade (>7 dias)  
**Exemplo:** Usuário não acessa a plataforma por 8 dias  
**Ação esperada do cliente:**
- Idêntica a `TOKEN_INVALID`
- Limpar auth, redirecionar `/login`

---

#### `SESSION_REVOKED`

**Status:** 401 Unauthorized  
**Quando disparado:** Admin ou sistema revogou a sessão (soft-delete `excluido=true` em DTabela -476 na Fase 3)  
**Exemplo:** Admin revogou sessão via `DELETE /auth/sessions/:id`  
**Ação esperada do cliente:**
- Mesmo fluxo que TOKEN_INVALID
- Log opcional: "Sua sessão foi encerrada pelo administrador."

---

#### `SESSION_REUSE_DETECTED`

**Status:** 401 Unauthorized  
**Quando disparado:** Replay real detectado — refresh token apresentado **fora** da grace window de 60s  
**Exemplo:** Atacante tenta reutilizar token roubado 2 minutos depois  
**Ação esperada do cliente:**
- Mesmo fluxo: limpar auth, redirecionar `/login`
- Log de segurança: "Possível tentativa de roubo de sessão detectada"
- Sem mensagem amigável (não alertar atacante que foi detectado)

---

### CONTEXT — Contexto de Organização (401, 403)

#### `ORG_CONTEXT_STALE`

**Status:** 401 Unauthorized  
**Quando disparado:** JWT contém `organizationId` de uma org da qual o usuário **não é mais membro** (removido, org deletada, etc.)  
**Exemplo:** Usuário logado em Org A, admin remove usuário de Org A, usuário tenta acessar projeto em Org A com token antigo  
**Ação esperada do cliente:**
- **Não** logout imediato
- **Tentar refresh silencioso** via `POST /auth/refresh` (obtém novo token sem organizationId OU organizationId correto)
- Após refresh, **repetir request original** automaticamente
- Se refresh também falhar com `ORG_CONTEXT_STALE`, aí sim logout (contexto inconsistente)

**Implementação esperada (interceptor NestJS):**
```typescript
if (error.status === 401 && error.code === 'ORG_CONTEXT_STALE') {
  // Tentar refresh
  const newToken = await authService.refresh();
  if (newToken) {
    // Repetir request original
    return retry(originalRequest);
  }
  // Refresh também falhou
  clearSession();
  redirect('/login');
}
```

---

### AUTHORIZATION — Permissões (403)

#### `NO_WORKSPACE`

**Status:** 403 Forbidden  
**Quando disparado:** Usuário autenticado, MAS não tem acesso a nenhum workspace/organização/projeto  
**Exemplo:** Usuário novo criado, MAS admin ainda não concedeu acesso a nenhum espaço  
**Ação esperada do cliente:**
- Mostrar tela vazia: "Nenhum workspace disponível"
- Sugestão: "Entre em contato com seu administrador"
- Não logout (usuário **está** autenticado, só não tem contexto)

---

#### `FORBIDDEN_ROLE`

**Status:** 403 Forbidden  
**Quando disparado:** Usuário tenta escrever em um recurso onde a escrita é explicitamente bloqueada  
**Exemplo HOJE implementado:** Usuário tenta deletar ou modificar task em template global (read-only por definição, `idEstab=NULL`)  
**Exemplo FUTURO (ainda não implementado):** Usuário é VIEWER de projeto, tenta deletar card (DELETE /tasks/123) — esse caso atual ainda retorna 404 (anti-enumeração) por design pre-existente  

**Nota arquitetural:** A validação de role (VIEWER vs MEMBER vs MANAGER) atualmente **não diferencia permissões no gate de escrita**. O endpoint genérico `/tasks` aceita qualquer role que tenha acesso de leitura ao projeto. Futuro follow-up vai adicionar check de `canWrite` por papel.

**Ação esperada do cliente:**
- Desabilitar botão de ação na UI para VIEWER (evitar request)
- Se usuário conseguir contornar e fazer request em template global: mostrar toast "Você não tem permissão para esta ação"
- Não logout

---

### INFRASTRUCTURE — Falhas de Infraestrutura (503)

#### `AUTH_BACKEND_UNAVAILABLE`

**Status:** 503 Service Unavailable  
**Quando disparado:** Falha de infra no caminho de auth (Postgres pool esgotado, timeout, Redis fora, etc.)  
**Exemplo:** Database está down, `POST /auth/refresh` e `GET /projects` chega ao guard e tenta validar membership no DB  
**Ação esperada do cliente:**
- **NÃO logout imediato**
- Mostrar spinner/toast: "Servidor temporariamente indisponível. Tentando novamente..."
- **Tentar novamente** com backoff exponencial (1s, 2s, 4s, max 60s)
- Após 3+ tentativas falhas: logout com mensagem "Servidor fora do ar. Por favor, tente mais tarde."
- **CRÍTICO:** Este erro **NÃO é logout automático** — é retry/timeout

**Diferença de antes (Fase 0):**
- Antes: Infra lenta → 401 "Autenticação necessária" → logout imediato (ERRADO)
- Depois: Infra lenta → 503 "Servidor indisponível" → retry (CORRETO)

---

### INTERNAL — Erros Não-Tratados (500)

#### `INTERNAL_ERROR`

**Status:** 500 Internal Server Error  
**Quando disparado:** Exceção não-HTTP capturada pelo filter universal (`@Catch()`)  
**Exemplo:** Bug no código, null pointer exception, erro não previsto  
**Ação esperada do cliente:**
- Mostrar toast: "Erro interno do servidor. Por favor, tente novamente ou contate suporte."
- Log no cliente com `correlationId` para compartilhar com suporte
- Retry automático opcional (mesmo backoff que 503)
- **Stack trace NUNCA é enviado ao cliente** (logado apenas no servidor)

---

## Fluxo de Exemplo: Login → Refresh com Erro

### Cenário 1: Token Expirado (Normal)

```
1. Usuário login → recebe accessToken (15min) + refreshToken (7d)
2. 16 minutos depois, accessToken expira
3. Frontend tenta request ao API
4. Guard retorna 401 { code: 'TOKEN_EXPIRED' }
5. Interceptor dispara: POST /auth/refresh { refreshToken }
6. ✅ Sucesso → novo accessToken
7. Interceptor repete request original
8. Fluxo continua transparente para usuário
```

### Cenário 2: Refresh Também Expirou

```
1. Usuário não acessa por 8 dias (refreshToken expira com 7d)
2. Tenta request ao API
3. Guard retorna 401 { code: 'TOKEN_EXPIRED' }
4. Interceptor tenta refresh
5. POST /auth/refresh retorna 401 { code: 'TOKEN_EXPIRED' }
6. Interceptor não consegue renovar
7. Clearar auth, redirecionar /login
```

### Cenário 3: Infra Lenta (503)

```
1. POST /auth/refresh
2. Guard tenta validar membership em DB
3. Postgres pool timeout → error PrismaClientKnownRequestError P2024
4. Guard classifica como isInfraFailure() → 503 { code: 'AUTH_BACKEND_UNAVAILABLE' }
5. Interceptor frontend vê 503
6. Retry automático: wait 1s, retry
7. Retry 2: wait 2s, retry
8. ✅ Sucesso (infra recuperada)
```

### Cenário 4: Org Context Stale

```
1. Usuário logado em Org A com token
2. Admin remove usuário de Org A
3. Usuário faz request em Org A
4. Guard valida membership no DB → user não está mais em Org A
5. Retorna 401 { code: 'ORG_CONTEXT_STALE' }
6. Interceptor tenta refresh
7. POST /auth/refresh obtém novo token (sem organizationId OU correto)
8. Interceptor repete request original
9. ✅ Sucesso (context atualizado) ou 403 NO_WORKSPACE (usuario sem nenhum acesso)
```

---

## Implementação Frontend (Interceptor)

Pseudo-código de como o interceptor deve tratar os códigos:

```typescript
@Injectable()
export class AuthInterceptor {
  constructor(private auth: AuthService, private router: Router) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        const code = error.error?.code;

        switch (code) {
          // Auth — Logout
          case 'TOKEN_INVALID':
          case 'TOKEN_EXPIRED':
          case 'SESSION_REVOKED':
          case 'SESSION_REUSE_DETECTED':
            this.auth.clearSession();
            this.router.navigate(['/login']);
            return throwError(() => error);

          // Context — Retry com refresh
          case 'ORG_CONTEXT_STALE':
            return this.auth.refresh().pipe(
              switchMap(() => next.handle(req)), // Repetir request
              catchError(() => {
                this.auth.clearSession();
                this.router.navigate(['/login']);
                return throwError(() => error);
              })
            );

          // Authorization — Não logout, só error
          case 'NO_WORKSPACE':
          case 'FORBIDDEN_ROLE':
            // Mostrar error sem logout
            return throwError(() => error);

          // Infra — Retry com backoff
          case 'AUTH_BACKEND_UNAVAILABLE':
          case 'INTERNAL_ERROR':
            return this.retryWithBackoff(req, next, 3, 1000);

          default:
            return throwError(() => error);
        }
      })
    );
  }

  private retryWithBackoff(
    req: HttpRequest<any>,
    next: HttpHandler,
    attempts: number,
    delayMs: number
  ): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((error) => {
        if (attempts > 1) {
          return timer(delayMs).pipe(
            switchMap(() =>
              this.retryWithBackoff(req, next, attempts - 1, delayMs * 2)
            )
          );
        }
        // Após 3 tentativas, logout
        this.auth.clearSession();
        this.router.navigate(['/login']);
        return throwError(() => error);
      })
    );
  }
}
```

---

## Resumo: Ações por `code`

| code | statusCode | Ação Cliente | Retry |
|------|-----------|--------------|-------|
| TOKEN_INVALID | 401 | Logout imediato | Não |
| TOKEN_EXPIRED | 401 | Logout imediato | Não |
| SESSION_REVOKED | 401 | Logout imediato | Não |
| SESSION_REUSE_DETECTED | 401 | Logout imediato (sem alerta) | Não |
| ORG_CONTEXT_STALE | 401 | Refresh + Retry | Sim |
| NO_WORKSPACE | 403 | Mostrar vazio | Não |
| FORBIDDEN_ROLE | 403 | Mostrar error | Não |
| AUTH_BACKEND_UNAVAILABLE | 503 | Retry backoff | Sim |
| INTERNAL_ERROR | 500 | Retry backoff | Sim |

---

## Observação: Migração Gradual

Este contrato é **novo na Fase 1**. O `code` field é opcional por compatibilidade:

- **Fase 0 (Observabilidade):** Não existe `code` ainda
- **Fase 1 (Hotfix):** `code` é adicionado ao filter (`@Catch()`)
- **Fase 4 (Semântica):** ADR-V2-064 expande `code` para **100%** dos endpoints de auth (não só refresh)

Frontend pode começar a consumir `code` em Fase 1, caindo em `code: undefined` gracefully para endpoints que ainda não o enviam.

---

**Maintained by:** Reviewer Agent V2 (audited), Documenter Agent V2 (documented)  
**Last Updated:** 2026-07-13  
**Version:** 1.0 (Fase 1, Task #995)
