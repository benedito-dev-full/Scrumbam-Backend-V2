# Runbook de Deploy — FASE 3 Sessões Multi-Device (V2 F16 Hardening)

**Escrito para:** DevOps / Tech Lead (deploy em staging/produção)
**Data:** 2026-07-13
**Task:** #997 (DEV-173) — Sessões multi-device em DTabela
**Score:** 9.2/10 APPROVED
**Duração estimada:** 45 min (deploy + validação)

---

## 🚨 PRÉ-REQUISITOS (CRÍTICO)

### 1. Verificar Migrations Pendentes no Banco

```bash
# Conectar em staging/produção
psql "postgresql://user:pass@host:5432/scrumban"

# Listar migrations pendentes
SELECT name FROM schema_migrations WHERE success = false ORDER BY installed_on DESC;
```

**Situação real (2026-07-13):** Há 3 migrations pendentes no banco local:
1. `remove_sprint_hard_delete` (task anterior, D Task table)
2. `add_devento_delay_reason_agg_idx` (task anterior, DEvento table)
3. `20260713000000_add_session_lookup_indexes` (ESTA FASE F3)

**ATENÇÃO:** As duas primeiras **nunca foram testadas em produção**. Recomendação:
- Rodar `prisma migrate deploy` em **staging PRIMEIRO** (2-3 horas antes do deploy de produção)
- Validar que nenhuma delas quebra queries existentes
- Se uma falhar: corrigir em staging, gerar nova migration, redeploy

### 2. Confirmar Seed de Classes

```bash
# Validar que as novas DClasses foram carregadas (dry-run sem write)
npm run seed:classes:dry

# Output esperado:
# 171 DClasses validadas (45 fixas + 126 específicas)
# Hierarquia validada
```

Se falhar: o banco **NÃO ESTÁ PRONTO** para deploy. Não continuar.

### 3. Feature Flag Disponível

Verificar que `.env` tem a flag `SESSIONS_V2_ENABLED`:

```bash
grep SESSIONS_V2_ENABLED .env
# Output: SESSIONS_V2_ENABLED=false  (começa desligado para rollback instantâneo)
```

---

## 📋 Checklist de Deploy (Ordem Inegociável)

### FASE 1 — Preparação (30 min — SEM DOWNTIME)

#### 1.1 Rodar Seed de Classes

```bash
# Backup do banco (CRÍTICO!)
pg_dump postgresql://user:pass@host:5432/scrumban > backup-20260713-pre-f3.sql

# Rodar seed das novas DClasses (-485, -504, -509, -523, -524)
# Isso CRIA as linhas em DClasse mas NÃO toca sessões existentes
npx prisma db seed
# Output esperado: Seed completed. Added 4 new DClasses for SESSION infrastructure.
```

**O que aconteceu:**
- DClasse -485 (SESSION) criada
- DClasses -504/-509/-523/-524 (eventos de segurança) criadas
- Nenhuma mudança no banco além de linhas em DClasse

#### 1.2 Rodar Migration de Índices

```bash
# Criar 4 índices em DTabela e DUserGroup (ZERO coluna nova, ZERO tabela nova)
npx prisma migrate deploy

# Confirmar que passou:
# - Migration `20260713000000_add_session_lookup_indexes` aplicada
# - 4 índices criados: 
#   * (idClasse, codigo) em DTabela
#   * (metaDados->>'prevHash') em DTabela WHERE idClasse=-485 AND excluido=false
#   * (dados->>'refreshTokenHash') em DUserGroup (legado, dual-read)
#   * (dados->>'prevHash') em DUserGroup (legado, dual-read)
```

**IMPORTANTE:** Os 2 últimos índices são **temporários** (5-7 dias). Existem para a janela de dual-read. Podem ser dropados depois.

### FASE 2 — Deploy de Código (15 min)

#### 2.1 Fazer Build e Teste

```bash
# Build sem erros
npm run build
# Output: Compilation successful. No TypeScript errors.

# Testes passam (especialmente os de sessão)
npm test src/auth/services/session.service.spec.ts
# Output esperado: 18/18 tests PASS

# Linter sem warnings
npx eslint src/auth src/tabelas --max-warnings 0
# Output: No errors or warnings found.
```

#### 2.2 Deploy

```bash
# Deploy em staging primeiro (NUNCA produção sem validação)
git push origin feature/integracao-sessoes-multidevice
# Criar PR, mergear em staging, triggar CI/CD

# Validar que:
# - Container subiu
# - Swagger acessível
# - Health check passa
# - Logs sem errors `SessionService` ou índices de banco
```

### FASE 3 — Ativar Feature Flag (5 min)

```bash
# NO SERVIDOR (staging ou produção):
# 1. Ligar a flag
export SESSIONS_V2_ENABLED=true

# 2. Recarregar processo (sem restart completo se usar nodemon)
# Ou fazer reload/SIGHUP do app

# 3. Validar que SessionService está ativo
curl -H "Authorization: Bearer {TOKEN}" \
  http://localhost:3000/auth/sessions
# Output esperado: []  (usuário não tem sessões em DTabela ainda)
```

**Comportamento esperado pós-ativação:**
- Novos logins criam linhas em DTabela (idClasse=-485)
- Usuários com refresh token legado (pré-F3) continuam funcionando (dual-read)
- Na primeira renovação, a sessão é criada em DTabela (migração preguiçosa)

### FASE 4 — Validação (5 min)

```bash
# 4.1 Login e refresh funcionam
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "test@example.com", "password": "xxxxx"}'
# Output: { accessToken, refreshToken, ...}

# 4.2 GET /auth/sessions retorna lista (vazia ou com sessões)
curl -H "Authorization: Bearer {TOKEN}" \
  http://localhost:3000/auth/sessions
# Output: []  (primeira vez) ou [{ id, device, ip, lastUsedAt }]

# 4.3 Verificar logs estruturados
# Procurar por:
#   - [SessionService] Loaded session from DTabela
#   - [SessionService] Migrated legacy slot to DTabela
#   - No errors ou warnings de sessão
tail -f /var/log/app.log | grep SessionService

# 4.4 Banco: confirmar que sessões estão em DTabela
psql "postgresql://user:pass@host:5432/scrumban"
SELECT COUNT(*) FROM DTabela WHERE idClasse = -485 AND excluido = false;
# Output: N > 0 (há sessões ativas)
```

---

## 🔄 Rollback (Se Necessário)

### Rollback Instantâneo (< 1 min)

```bash
# Desligar a flag
export SESSIONS_V2_ENABLED=false

# Recarregar processo
# Qualquer novo refresh vai usar o slot legado (idempotente)

# Validar
curl http://localhost:3000/auth/sessions
# Output: 404 (SessionController desligado) ou []  (OK, nenhuma sessão nova)
```

**SEM deslogar ninguém.** O slot legado está sendo mantido em sync (dual-write) — usuários continuam funcionando com a sessão mais recente.

### Rollback Completo (se migration quebrou)

```bash
# 1. Parar o app
systemctl stop scrumban-backend

# 2. Reverter migration (volta indices)
npx prisma migrate resolve --rolled-back 20260713000000_add_session_lookup_indexes

# 3. Excluir linhas de sessão de DTabela (opcional, não crítico)
DELETE FROM DTabela WHERE idClasse = -485;
DELETE FROM DClasse WHERE chave IN (-485, -504, -509, -523, -524);

# 4. Restaurar banco se necessário
psql postgresql://user:pass@host:5432/scrumban < backup-20260713-pre-f3.sql

# 5. Ligar app
systemctl start scrumban-backend
```

---

## 📊 Validação Pós-Deploy (checklist operacional)

### Dashboard de Métricas (se disponível)

Procurar por:
```
auth.refresh.attempt        — aumentando (novos logins)
auth.refresh.success        — alto (>95%)
auth.refresh.legacy_slot_hit — diminuindo gradualmente (0% em 7 dias)
auth.sessions.active        — crescendo (novos usuários)
auth.sessions.migrated      — crescendo (usuários do slot legado)
http.latency.p95 (/auth/refresh)  — <200ms (índice funcionando)
```

### Alertas a Monitorar

🚨 **CRÍTICO:**
- `auth.refresh.failed > 5%` — investigar logs, possível bug de banda
- `SessionService.findByHash timeout` — índice não funcionou
- `duarr.DTabela_session_idx não existe` — migration falhou silenciosamente

⚠️  **AVISO:**
- `auth.sessions.active > 10 * users` — possível leak de sessões (cap LRU falhou)
- `auth.refresh.legacy_slot_hit ainda > 0 após 7 dias` — usuário não renovando

✅ **ESPERADO:**
- `auth.refresh.legacy_slot_hit → 0` gradualmente (5-7 dias)
- `auth.sessions.active ≈ users_online * device_avg` (típico 1.5-2 por usuário)

### Limpeza Pós-Estabilização (8-10 dias depois)

Quando `auth.refresh.legacy_slot_hit = 0` por > 7 dias **em todos os ambientes (staging + prod)**:

```sql
-- REMOVER o fallback legado (feito em task separada, não agora)
-- Apenas exemplos — NÃO rodar ainda!
-- DELETE FROM schema_migrations WHERE name = '...';
-- DROP INDEX idx_dUserGroup_refreshTokenHash;
-- DROP INDEX idx_dUserGroup_prevHash;
-- ALTER TABLE DUserGroup DROP COLUMN dados (se estiver vazio);  -- NÃO! Outros dados usam dados
```

---

## 🆘 Troubleshooting

### "Sintoma A" (zumbi) Ainda Existe Pós-Deploy

**Esperado:** F3 NÃO resolve sintoma A (aba nova zumbi). Aquele é F2 (frontend localStorage).
**Verificação:**
- F2 foi feita? (`localStorage` em vez de `sessionStorage`)
- Bootstrap defensivo está ativo? (cookie sem token → refresh silencioso)

Se F3 rodando e F2 não: sintoma A persiste. **Isso é OK** — ordem é F0→F1→F2→F3.

### "Refresh devolve SESSION_REVOKED"

Dois cenários legítimos:

1. **Usuário fez logout explícito** — esperado, sessão foi revogada propositalmente
   - Ação: redirecionar para `/login`

2. **Session timeout** (idle 7d ou absoluta 30d)
   - Ação: redirecionar para `/login` (re-login forçado)

3. **Replay real detectado** (fora da grace)
   - Ação: revogar FAMÍLIA (não conta inteira), re-login, revisar acesso

**NÃO é bug.**

### "Refresh devolve 503 AUTH_BACKEND_UNAVAILABLE"

DB está lento ou pool esgotado. Não é error do código — é infra.

**Ação:**
- Verificar pool: `SHOW max_connections` vs conexões ativas
- Se pool < 50% disponível: trigger escalação infra
- Se pool > 50% livre: possível deadlock em query — verificar slow logs

---

## 📝 Notas Operacionais

### Dual-Read/Dual-Write (Janela de Migração 5-7 dias)

Durante a janela, DUAS fontes de verdade existem:
- `DTabela` (new): sessões em linhas, lookup indexado
- `DUserGroup.dados` (legacy): slot único, full scan (temporário)

**O backend verifica em ordem:**
1. DTabela (rápido, indexado) → achou? Use
2. DUserGroup (lento, full scan) → achou e converteu para DTabela? Use
3. Neither → 401 TOKEN_INVALID

**Consequência:** Queries de sessão ativas ficarão ligeiramente mais lentas durante 5-7 dias (dual-read). Negligenciável (<50ms) para escala normal. Performance volta ao normal após janela.

### Cap de Sessões (LRU)

Máximo 10 sessões ativas por usuário. A 11ª evicta a mais antiga (por `lastUsedAt`).

**Cenário:** Usuário com 10 abas + abre aba 11.
- Login na aba 11 cria 11ª sessão
- SessionService evicta a mais antiga (aba com menor lastUsedAt)
- Aba antiga recebe 401 SESSION_REVOKED na próxima request
- Necessário fazer login novamente

**É expected.** Proteção contra abas zumbi sem limite.

### Purge Automático

Job rodando a cada hora:
```sql
UPDATE DTabela SET excluido = true 
WHERE idClasse = -485 
  AND (
    (absoluteExpiresAt < NOW())  -- teto duro de 30d
    OR (idleExpiresAt < NOW())   -- 7d sem uso
  );
```

Sessões expiradas são soft-deleted (excluido=true). Query de refresh não as pega mais.

**Limpeza física:** task separada (não é crítico — soft-delete é suficiente).

---

## 📞 Escalação

**Problema:** Migrations quebrou | Feature está causando logout em massa | Índices não criaram

**Ação imediata:**
1. Desligar flag: `SESSIONS_V2_ENABLED=false`
2. Recarregar app
3. Ninguém é deslogado (dual-read + dual-write fazem rollback automático)
4. Investigar em staging
5. Abrir issue no backlog

**Tempo de resolução:** < 5 min (rollback é instantâneo).

---

## ✅ Checklist Final (Antes de Comunicar "Deploy OK")

- [ ] Seed de classes rodou sem erro
- [ ] Migration aplicada (4 índices visíveis em DB)
- [ ] Feature flag está em `.env` (inicialmente false)
- [ ] Build passou sem erros
- [ ] Testes de sessão (18/18) passaram
- [ ] Feature flag ligada (SESSIONS_V2_ENABLED=true)
- [ ] Login/refresh funcionam
- [ ] GET /auth/sessions retorna lista (pode estar vazia)
- [ ] Logs estruturados mostram SessionService ativo
- [ ] DB mostra DTabela.idClasse=-485 com N > 0 linhas
- [ ] Contador legacy_slot_hit começou a cair (usuários migrando)
- [ ] Rollback testado (flag=false, ninguém deslogado)

---

## 📚 Documentação Relacionada

- `docs/decisions/ADR-V2-077-sessoes-multidevice-dtabela.md` — Decisão arquitetural
- `workspace/plans/plan-sessao-auth-hardening.md` — Plano detalhado (Fases 0-5)
- `docs/CHANGELOG.md` — Entry Task #997 (F3)
- `workspace/reviews/review-auth-sessao-multidevice-f3-task1.md` — Review 9.2/10

---

**Autor:** Documenter Agent V2
**Data:** 2026-07-13
**Task:** #997 (DEV-173) — Sessões Multi-Device Fase 3
**Review Score:** 9.2/10 APPROVED
