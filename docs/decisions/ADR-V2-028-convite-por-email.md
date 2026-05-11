# ADR-V2-028: Convite de Membros por Email com Auto-Login

**Status:** ACCEPTED  
**Data:** 2026-05-11  
**Decisores:** Strategist Agent V2 (proposal), Reviewer Agent V2 (validation 8.3/10 APPROVED)  
**Tags:** #V2 #F-transversal #feature-onboarding #email #auth #security

---

## Contexto e Problema

O **Scrumban-Backend-V2** legado tinha `POST /organizations/:id/members` exigindo `userId` de usuário já registrado. O frontend tinha UI (`<InviteWorkspaceModal>` + `/invite/page.tsx`) mas o endpoint era stub com erro: "Convite por email ainda não disponível no V2".

**Necessidade:** Implementar ciclo completo de convite por email com:
- Geração de token one-shot
- Armazenamento seguro (hash SHA-256)
- Envio via email com link
- Aceitação com auto-login (reduz fricção de onboarding: 3 cliques instead of 5)
- Audit trail completo (DEvento INVITE_LIFECYCLE)
- ZERO tabela nova (ADR-V2-001)

**Restrição:** Scrumban-V2 deve funcionar 100% nas 17 tabelas canônicas. Nenhuma exceção de tabela nova — tokens devem viver em **DTabela** (ADR-V2-004 establece padrão: API Keys, MCP Keys via DTabela).

---

## Alternativas Consideradas

### Opção 1: Token em DEvento (idClasse=INVITE_TOKEN)

**Prós:**
- Audit trail nativo (imutável)
- Histórico completo do convite (sent, accepted, expired, revoked)

**Contras:**
- DEvento é append-only por design
- Marcar `usedAt` exige criar OUTRO evento ("accepted") + query agregada para saber se válido = 2x queries
- DTabela permite UPDATE simples com `metaDados.usedAt` = eficiência

**Resultado:** REJEITADA. DEvento será usado para audit trail (INVITE_SENT, INVITE_ACCEPTED via -502 INVITE_LIFECYCLE), mas armazenamento primário vai em DTabela.

### Opção 2: Token em Nova Tabela (DINVITE)

**Prós:**
- Tabela focada (zero overhead)
- Índices otimizados (tokenHash, orgId, createdAt)

**Contras:**
- **VIOLA ADR-V2-001 (ZERO tabela nova)**
- Maintenance burden: nova FK, nova migration, novo seed
- Inconsistent com padrão V2 (tudo é polimórfico nas 17)

**Resultado:** REJEITADA. ADR-V2-001 é inviolável.

### Opção 3: Token em DTabela (idClasse=INVITE_TOKEN) — **ESCOLHIDA**

**Prós:**
- Zera tabelas novas (ADR-V2-001)
- Reutiliza padrão V2: API Keys em DTabela -471, MCP Keys em DTabela -472 (ADR-V2-004)
- UPDATE eficiente: `metaDados.usedAt` + `metaDados.status`
- Hash SHA-256 nunca exposto; raw token só no email
- idLocEscritu = orgId dona; busca rápida por org

**Contras:**
- Mistura semântica (lookups + tokens na mesma tabela)
- Mitigação: DClasse -476 é explícita (INVITE_TOKEN) — semântica clara

**Resultado:** ACEITA. Vencedor.

---

### Auto-Login no Accept: Imediato vs Redirect para Login

#### Opção 2a: Auto-login imediato (escolhida)
- Accept retorna `accessToken`+`refreshToken` + `redirectTo: '/intentions'`
- Frontend salva tokens e navega automaticamente
- UX: 3 cliques (email → form → botão submit)
- Implementação: `AuthService.issueSessionForUser(userId)` novo

**Prós:**
- Friction minimal = conversão ↑
- User já logado ao chegar na app

**Contras:**
- Ligeira complicação backend (reuso de AuthService)
- Tokens emitidos imediatamente (sem validação de senha extra)
- Mitigação: Tokens são session-bound (refresh normal cobre o resto); token bruto NUNCA logado

#### Opção 2b: Redirect para login
- Accept retorna `{success: true}`
- Frontend redireciona `/login` com email pré-preenchido
- User digita senha de novo
- UX: 5+ cliques

**Resultado:** ACEITA 2a. Conversão crítica para onboarding.

---

## Decisão

**Escolhemos Opção 3 (DTabela) + Opção 2a (auto-login imediato).**

### Modelagem do Token

```sql
DTabela (idClasse=-476 INVITE_TOKEN)
├─ idLocEscritu = orgId (dono do convite)
├─ nome = email (indexável; nunca o token bruto)
├─ dEntidadeId = userId do admin que convidou (inviter)
├─ metaDados = {
│   "tokenHash": "sha256hex",
│   "role": "MEMBER" | "VIEWER",
│   "expiresAt": "ISO8601",
│   "usedAt": null | "ISO8601",
│   "status": "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED"
│ }
└─ excluido = false (preserva audit — marcar inativo vs deletar)
```

### Fluxo Técnico

**Create Invite (`POST /organizations/:orgId/invites`):**
1. Auth: JWT + ADMIN da org (via DVincula -161)
2. Validações:
   - Email não é já membro (DEntidade -150 + DVincula)
   - Não existe convite pendente (DTabela -476 sem usedAt)
3. Gera: `crypto.randomBytes(32).base64url()` (43 chars)
4. Hash: SHA-256 → metaDados
5. Persiste: DTabela INVITE_TOKEN + metaDados
6. Audit: DEvento -502 action='sent'
7. Email: Fire-and-forget (falha não bloqueia resposta)
8. Rate limit: @Throttle 3/min

**Get Invite Info (`GET /invites/:token`):**
1. Publico (sem auth)
2. Hash token + $queryRaw busca em DTabela -476
3. Valida: não expirado, não usado
4. Retorna: sanitizado (sem hash, sem ids internos)
5. Anti-enumeração: 404 idêntico para invalido/expirado/usado

**Accept Invite (`POST /invites/:token/accept`):**
1. Publico (sem auth)
2. Valida token (hash + expirado/usado)
3. `prisma.$transaction` atomic:
   - Verifica race: email não virou DEntidade -150
   - Cria: DUserGroup (hash bcrypt 12 rounds)
   - Cria: DEntidade -150 (nome, email, criadoPor=inviter)
   - Cria: DVincula -162/-163 (role correto)
   - UPDATE: DTabela marca usedAt + status=ACCEPTED
   - INSERT: DEvento -502 action='accepted'
4. Fora da tx: Gera JWTs via `AuthService.issueSessionForUser()`
5. Retorna: `{accessToken, refreshToken, user, redirectTo: '/intentions'}`

### DClasses Adicionadas (6 — ADR-V2-028)

| Chave | Código | Nome | idPai | Uso |
|-------|--------|------|-------|-----|
| -476 | `INVITE_TOKEN` | Token de convite | -52 | Armazenamento primário (DTabela) |
| -477 | `INVITE_STATUS_PENDING` | Status: Pendente | -52 | Lookup (future; agora em metaDados) |
| -478 | `INVITE_STATUS_ACCEPTED` | Status: Aceito | -52 | Lookup (future) |
| -479 | `INVITE_STATUS_EXPIRED` | Status: Expirado | -52 | Lookup (future) |
| -480 | `INVITE_STATUS_REVOKED` | Status: Revogado | -52 | Lookup (future) |
| -502 | `INVITE_LIFECYCLE` | Audit lifecycle | -3 | DEvento para sent/accepted/expired/revoked |

**Seed total:** 45 fixas + 92 especificas = **137 DClasses** (ADR-V2-028: +6 classes).

---

## Consequências

### Positivas

✅ **Onboarding mais fluido:** auto-login reduz atrito (3 vs 5+ cliques)  
✅ **ZERO tabela nova:** respeita ADR-V2-001 e reusa padrão V2 (DTabela para tokens)  
✅ **Segurança robusta:** hash SHA-256, token bruto só no email, rate limit 3/min  
✅ **Auditoria completa:** DEvento -502 rastreia sent/accepted/expired/revoked  
✅ **Atomicidade:** $transaction garante consistência user+vincula+convite  
✅ **Anti-enumeração:** 404 idêntico previne vaza de emails registrados  
✅ **Race-condition safe:** re-validação de email dentro da tx  

### Negativas

⚠️ **Mistura semântica:** tokens + lookups em DTabela (mitigado: idClasse explícita -476)  
⚠️ **DVFS não se aplica:** invite é operação estrutural (sem Engine); scripts não reutilizáveis entre projetos  
⚠️ **Fire-and-forget email:** falha de provider não bloqueia, mas log estruturado permite detecção. Fase 2: endpoint `/invites/:id/resend`  
⚠️ **Email já registrado em outra org:** MVP rejeita com 409 + msg clara. Fase 2: suportar multi-tenancy explícito (reuso sem criar novo user)  

---

## Implementação

### Fase V2
- **Transversal pós-F8** — autorizada pelo CEO (usa fundações F1/F2/F3/F4)
- Depende: F1 (seed), F2 (endpoints), F3 (auth RBAC), F4 (email)

### Arquivos Criados
- `src/invites/` (module, controller, service, DTOs, tests)
- `docs/decisions/ADR-V2-028-convite-por-email.md` (este arquivo)

### Arquivos Modificados
- `prisma/seeds/classes.seed.ts` (+6 DClasses)
- `src/app.module.ts` (import InvitesModule)
- `src/auth/auth.service.ts` (novo método `issueSessionForUser`)
- `src/eventos/core/event-types.ts` (4 tipos novos: invite.sent/accepted/expired/revoked)
- `src/eventos/consumers/audit-log.consumer.ts` (mapping INVITE_LIFECYCLE)
- `.env.example` (APP_BASE_URL documentado)

### Endpoints Entregues
| Método | Rota | Auth | Rate Limit |
|--------|------|------|-----------|
| `POST` | `/organizations/:orgId/invites` | JWT + ADMIN | 3/min |
| `GET` | `/invites/:token` | Publico | — |
| `POST` | `/invites/:token/accept` | Publico | — |

### Testes de Aceitação (DoD)
- [x] 6 DClasses seedadas, validateHierarchy PASS, total=137
- [x] 3 endpoints funcionais (create, getInfo, accept)
- [x] Token em DTabela com hash SHA-256, raw só no email
- [x] $transaction atomica no accept (rollback completo se falhar)
- [x] Auto-login no accept (retorna accessToken + refreshToken)
- [x] Rate limit 3/min funcional (integration test)
- [x] Anti-enumeração: 404 idêntico para token invalido/expirado/usado
- [x] EmailService dispara email com template + URL absoluta
- [x] DEvento INVITE_LIFECYCLE para audit (sent + accepted)
- [x] Frontend `/invite/page.tsx` funcional
- [x] InviteWorkspaceModal usa novo endpoint
- [x] Build PASS (TypeScript + ESLint)
- [x] Coverage backend invites/ ≥85%
- [x] Smoke test em staging (Dokploy) com email real

---

## Notas

### SHOULD HAVE (Fase 2 — Backlog)
- `POST /invites/:id/resend` — regenera token + reenvia email
- `DELETE /invites/:id` — admin revoga convite pendente
- `GET /organizations/:orgId/invites` — admin lista convites pendentes
- Cron BullMQ marca convites expirados + emite DEvento
- Suporte "convite para email já registrado em outra org" (multi-tenancy explícito)
- Bulk invite (`POST /organizations/:id/invites/bulk`)

### Correlatos
- **ADR-V2-001:** ZERO tabela nova — conforme
- **ADR-V2-003:** RBAC duplo via DVincula + idClasse — reutilizado (-161/-162/-163)
- **ADR-V2-004:** Tokens via DTabela — padrão aplicado (-476)
- **ADR-V2-008:** DEvento substitui notification — INVITE_LIFECYCLE (-502)
- **ADR-V2-026:** AUDIT_GENERIC (-489) para fallback
- **ADR-V2-027:** PROJECT_LIFECYCLE, ORG_LIFECYCLE renomeadas

---

**Redator:** Documenter Agent V2  
**Versão:** 1.0  
**Aceito em:** 2026-05-11
