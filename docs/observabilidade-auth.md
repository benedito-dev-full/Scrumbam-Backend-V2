# Observabilidade de Autenticação — Guia Prático (F0)

**Data:** 2026-07-13  
**Fase:** F0 (Observabilidade de Sessão/Auth)  
**Audiência:** Operações, DevOps, SRE — para extrair baseline e diagnosticar incidente

> **Leia isto às 2h da manhã durante um incidente. Todos os comandos são copiar-e-colar.**

---

## Os 7 Contadores Críticos

### 1. `auth.refresh.attempt` / `.success` / `.reuse_detected` / `.expired` / `.not_found`

**Mede:** Tentativas de refresh de token e seus outcomes.

**Onde vive:** Log estruturado backend (`src/auth/auth.service.ts`)

| Métrica | Significado | Esperado | Alerta |
|---------|-----------|----------|--------|
| `auth.refresh.attempt` | Tentou fazer refresh | Qualquer número | — |
| `auth.refresh.success` | Refresh bem-sucedido | ~ 70% de attempt | < 50% é problema |
| `auth.refresh.reuse_detected` | Replay de token detectado | **Muito raro (<1/hora)** | **> 5/hora = sintoma B1** |
| `auth.refresh.expired` | Token expirado | Alguns | Alto = pools de conexão velha |
| `auth.refresh.not_found` | Token desconhecido | Muito baixo | Alto = token forjado? |

**Comandos para extrair (substitua `LOG_FILE`):**

```bash
# Baseline: contar todos os refresh nos últimos 48h
grep '"metric":"auth.refresh' /container/logs/LOG_FILE | wc -l

# Detalhe: success vs reuse vs expired (últimas 48h)
grep -E '"metric":"auth.refresh\.(success|reuse_detected|expired|not_found)"' /container/logs/LOG_FILE | \
  jq -s 'group_by(.metric) | map({metric: .[0].metric, count: length})'

# Tendência: reuse_detected por hora (últimas 24h)
grep '"metric":"auth.refresh.reuse_detected"' /container/logs/LOG_FILE | \
  jq -s 'group_by(.ts | split("T")[0] + " " + split("T")[1] | split(":")[0]) | \
  map({hour: .[0], count: length}) | sort_by(.hour)'

# Taxa de sucesso (últimas 48h)
ATTEMPT=$(grep '"metric":"auth.refresh.attempt"' /container/logs/LOG_FILE | wc -l)
SUCCESS=$(grep '"metric":"auth.refresh.success"' /container/logs/LOG_FILE | wc -l)
echo "Taxa de sucesso: $((SUCCESS * 100 / ATTEMPT))%"
```

---

### 2. `auth.refresh.revoke_all`

**Mede:** Revogação de toda sessão do usuário (o "sangramento").

**Significado:** Quando o refresh com um token antigo e detectado como replay **real** (fora da grace window), o sistema revoga a SESSÃO INTEIRA do usuário. Isso é o sintoma B1 — usuário é derrubado por falso positivo.

**Esperado:** ~0 em operação normal (< 1/hora, max)  
**Alerta:** **> 3/hora = incidente em progresso**

**Campos:**
- `userGroupId` — BigInt do usuário derrubado
- `ip` — IP de onde saiu a tentativa (suspeita)
- `ua` — User-Agent truncado (qual navegador/cliente)

**Comandos:**

```bash
# Contar revogações (últimas 48h)
grep '"metric":"auth.refresh.revoke_all"' /container/logs/LOG_FILE | wc -l

# Listar QUEM foi revogado (últimas 48h)
grep '"metric":"auth.refresh.revoke_all"' /container/logs/LOG_FILE | \
  jq '{ts, userGroupId, ip, ua}' | sort | uniq -c

# Distribuição por IP (últimas 48h) — detectar ataque coordenado
grep '"metric":"auth.refresh.revoke_all"' /container/logs/LOG_FILE | \
  jq -s 'group_by(.ip) | map({ip: .[0].ip, count: length}) | sort_by(-count)'
```

---

### 3. `auth.401` **por motivo**

**Mede:** Erros 401 (não autenticado) por **causa específica**.

**Significado:** Todo 401 tem um motivo:
- `token_expired` — Token vencido (normal, dispara refresh)
- `token_invalid` — Token malformado/inválido (raro, log de erro)
- `no_credential` — Nenhum token enviado (raro, endpoint public?)
- `guard_exception` — **Exceção durante validação** (PROBLEMA! Lentidão de DB)

**Esperado:**
- `token_expired` — alguns (natural, tokens expiram)
- `no_credential` — zero ou muito baixo
- **`guard_exception` — ZERO** (se > 0, DB está lento)

**Campos:**
- `reason` — motivo específico (um dos 4 acima)
- `code` — código de erro (ex: P2024 = pool timeout)

**Comandos:**

```bash
# Contar 401 por motivo (últimas 48h)
grep '"metric":"auth.401"' /container/logs/LOG_FILE | \
  jq -s 'group_by(.reason) | map({reason: .[0].reason, count: length})'

# ALERTA: guard_exception (indica DB/infra lento)
grep '"metric":"auth.401".*"reason":"guard_exception"' /container/logs/LOG_FILE | \
  jq '{ts, code, ip, ua}' | head -20

# Taxa por hora (últimas 24h)
grep '"metric":"auth.401"' /container/logs/LOG_FILE | \
  jq -s 'group_by(.ts | split("T")[1] | split(":")[0:2] | join(":")) | \
  map({hour: .[0], count: length}) | sort_by(.hour)'
```

---

### 4. `auth.guard.infra_error`

**Mede:** Falhas de infraestrutura nos guards de autenticação.

**Significado:** Quando uma exceção **não é credencial** (ex: pool esgotado, timeout de DB, erro de Redis), o sistema emite este contador. Ele PROVA a hipótese B3 do plano — "lentidão de banco desloga usuário".

**Esperado:** ~0 (zero ou raro)  
**Alerta:** **> 0 em picos = problema de infraestrutura**

**Campos:**
- `kind` — tipo de erro (`prisma_known`, `prisma_init`, `redis`, `timeout`, etc.)
- `code` — código Prisma (P2024 = pool timeout, P1008 = timeout operação, etc.)

**Códigos Prisma críticos:**
- `P1001`/`P1002` — Servidor inalcançável
- `P1008` — Timeout de operação
- `P1017` — Servidor fechou conexão
- **`P2024`** — **Pool esgotado** (o mais provável no incidente)
- `P2028`/`P2034` — Write conflict / transação abortada

**Comandos:**

```bash
# Contar erros de infra (últimas 48h)
grep '"metric":"auth.guard.infra_error"' /container/logs/LOG_FILE | wc -l

# Detalhe: tipo e código (últimas 48h)
grep '"metric":"auth.guard.infra_error"' /container/logs/LOG_FILE | \
  jq -s 'group_by({kind: .kind, code: .code}) | \
  map({kind: .[0].kind, code: .[0].code, count: length})'

# Timeline (últimas 12h) — correlacionar com resets/degradação DB
grep '"metric":"auth.guard.infra_error"' /container/logs/LOG_FILE | \
  jq '{ts}' | sort | uniq -c | tail -20

# CRÍTICO: P2024 (pool timeout) em últimas 4h
grep '"metric":"auth.guard.infra_error".*"code":"P2024"' /container/logs/LOG_FILE | wc -l
```

---

### 5. `auth.role_cache.hit` / `.miss` / `.negative_hit`

**Mede:** Eficiência do cache de roles (permissões).

**Significado:**
- `hit` — Role lido do cache (rápido, sem query DB)
- `miss` — Role não estava em cache, foi para DB
- `negative_hit` — Role CACHEUOU NEGATIVO (usuário sem permissão), e aquela negação é válida por 5 min

**Esperado:**
- Hit rate > 80% (maioria vem do cache)
- **Negative hit baixo** (usuário negado deveria ser raro)

**Alerta:** **Negative hit alto = cache negativo segurando permissão legítima** (sintoma B2)

**Campos:**
- Nenhum, é apenas contador silencioso (default `silent: true`)

**Comandos:**

```bash
# Cache hit rate (ultimas 48h) — via snapshot periodico
grep '"metric":"metrics.snapshot"' /container/logs/LOG_FILE | tail -5 | \
  jq '.counters | {hit: .["auth.role_cache.hit"], miss: .["auth.role_cache.miss"]}'

# Ou por linha individual (se nao usar silent)
grep '"metric":"auth.role_cache' /container/logs/LOG_FILE | \
  jq -s 'group_by(.metric) | map({metric: .[0].metric, count: length})'

# Calcular taxa
HITS=$(grep -c '"metric":"auth.role_cache.hit"' /container/logs/LOG_FILE)
MISSES=$(grep -c '"metric":"auth.role_cache.miss"' /container/logs/LOG_FILE)
TOTAL=$((HITS + MISSES))
[ "$TOTAL" -gt 0 ] && echo "Hit rate: $(( HITS * 100 / TOTAL ))%"
```

---

### 6. `auth.org_context_stale`

**Mede:** Tokens com contexto organizacional inválido.

**Significado:** Quando um JWT tem `organizationId` de uma org da qual o usuário **foi removido** (ou que mudou), o sistema detecta isso e emite este contador. Hoje isso retorna 200 com lista vazia (silenciosamente) — com este contador, vira visível.

**Esperado:** ~0 ou muito raro (< 1/hora)  
**Alerta:** **> 5/hora = usuários sendo removidos frequentemente OU JWT cacheuado stale**

**Campos:** Nenhum especial, é principalmente um boolean flag

**Comandos:**

```bash
# Contar org_context_stale (últimas 48h)
grep '"metric":"auth.org_context_stale"' /container/logs/LOG_FILE | wc -l

# Timeline (últimas 12h)
grep '"metric":"auth.org_context_stale"' /container/logs/LOG_FILE | \
  jq '{ts}' | sort | uniq -c

# Correlacionar com mudanças de membership
grep -E '"metric":"auth.org_context_stale|auth.role_cache.invalidate"' /container/logs/LOG_FILE | \
  jq '{metric, ts}' | sort -k3
```

---

### 7. `http.5xx` em `/auth/refresh`

**Mede:** Erros 500 especificamente no endpoint de refresh.

**Significado:** O endpoint `POST /auth/refresh` deveria retornar 401 (token inválido) ou 200 (sucesso), NUNCA 500. Se houver 500, significa que o backend teve um erro não-tratado — provavelmente o `new Error` cru sendo enviado como 500 ao cliente.

**Esperado:** **ZERO**  
**Alerta:** **> 0 = bug ou degradação severa**

**Comandos:**

```bash
# Contar 5xx no refresh (últimas 48h)
grep '"metric":"http.5xx"' /container/logs/LOG_FILE | \
  grep -i 'refresh' | wc -l

# Ou procurar erros 500 no próprio log de access
grep 'POST /auth/refresh' /container/logs/access.log | grep ' 500 ' | wc -l

# Detalhes (últimas 5xx no refresh)
grep 'POST /auth/refresh.*500' /container/logs/access.log | tail -5
```

---

## Extração Rápida do Baseline (48 horas)

Copie e execute este bloco para gerar um **relatório resumido**:

```bash
#!/bin/bash
set -e

LOG_FILE="${1:-.logs/app.log}"  # ajuste o caminho se necessário

echo "=== BASELINE DE OBSERVABILIDADE (48h) ==="
echo "Log: $LOG_FILE"
echo ""

echo "1. REFRESH (tentativas, sucesso, reuse)"
grep '"metric":"auth.refresh' "$LOG_FILE" | \
  jq -s 'group_by(.metric) | map({metric: .[0].metric, count: length})' || echo "0"
echo ""

echo "2. REVOGAÇÃO (sangramento — auth.refresh.revoke_all)"
REVOKES=$(grep -c '"metric":"auth.refresh.revoke_all"' "$LOG_FILE" || echo 0)
echo "Total revogações: $REVOKES"
if [ "$REVOKES" -gt 0 ]; then
  echo "Usuários afetados:"
  grep '"metric":"auth.refresh.revoke_all"' "$LOG_FILE" | \
    jq -s 'group_by(.userGroupId) | map({userGroupId: .[0].userGroupId, count: length})' | head -10
fi
echo ""

echo "3. 401 (por motivo)"
grep '"metric":"auth.401"' "$LOG_FILE" | \
  jq -s 'group_by(.reason) | map({reason: .[0].reason, count: length})' || echo "0"
echo ""

echo "4. INFRA ERRORS"
INFRA=$(grep -c '"metric":"auth.guard.infra_error"' "$LOG_FILE" || echo 0)
echo "Total erros infra: $INFRA"
if [ "$INFRA" -gt 0 ]; then
  echo "Tipos:"
  grep '"metric":"auth.guard.infra_error"' "$LOG_FILE" | \
    jq -s 'group_by(.kind) | map({kind: .[0].kind, count: length})'
fi
echo ""

echo "5. CACHE ROLE"
HITS=$(grep -c '"metric":"auth.role_cache.hit"' "$LOG_FILE" || echo 0)
MISSES=$(grep -c '"metric":"auth.role_cache.miss"' "$LOG_FILE" || echo 0)
TOTAL=$((HITS + MISSES))
if [ "$TOTAL" -gt 0 ]; then
  echo "Hit rate: $(( HITS * 100 / TOTAL ))%"
else
  echo "Sem dados de cache"
fi
echo ""

echo "6. ORG CONTEXT STALE"
STALE=$(grep -c '"metric":"auth.org_context_stale"' "$LOG_FILE" || echo 0)
echo "Total stale: $STALE"
echo ""

echo "7. HTTP 5xx (refresh)"
FIVEHUNDRED=$(grep 'POST /auth/refresh.*500' /container/logs/access.log 2>/dev/null | wc -l || echo "N/A")
echo "Total 5xx: $FIVEHUNDRED"
echo ""

echo "=== FIM DO BASELINE ==="
```

**Para executar:**

```bash
chmod +x extract-baseline.sh
./extract-baseline.sh /path/to/app.log > baseline-2026-07-13.txt
```

---

## Dashboard Esperado (Fase 0 → Fase 2)

| Métrica | F0 (Baseline) | F1 (Hotfix) | F2 (Completo) |
|---------|---------------|------------|---------------|
| `auth.refresh.revoke_all` | >> 0 (sintoma B1) | → 0 gradual | **= 0** |
| `frontend.auth_zombie` | >> 0 (sintoma A) | — | **= 0 por 72h** |
| `auth.401.guard_exception` | > 0? | → 0 | **= 0** |
| `auth.guard.infra_error` | ? | detecção | **próximas ações** |
| `auth.role_cache.negative_hit` | ? | análise | **reduzir TTL** |
| `auth.org_context_stale` | ?? | medição | **404 onde deveria** |

---

## Troubleshooting por Sintoma

### "Tenho reuse_detected alto"
```bash
# Ver padrão de reuse
grep '"metric":"auth.refresh.reuse_detected"' /container/logs/LOG_FILE | \
  jq '{ts, userGroupId, ip}'
```
**Provável:** Duas abas refazendo refresh em paralelo (Fase 1 com grace/idempotência resolverá).

### "revoke_all > 5 por hora"
```bash
# Ver quem está sendo revogado
grep '"metric":"auth.refresh.revoke_all"' /container/logs/LOG_FILE | \
  jq -s 'group_by(.userGroupId) | sort_by(-.[].length) | map({user: .[0].userGroupId, times: length}) | .[0:5]'
```
**Provável:** Mesmos usuários sendo derrubados (check: estão em múltiplas abas? token caducado?).

### "auth.guard.infra_error > 0"
```bash
# Ver código Prisma
grep '"metric":"auth.guard.infra_error"' /container/logs/LOG_FILE | \
  jq '{code, ts}' | sort -k2 | tail -20
```
**Provável:** P2024 = pool PostgreSQL esgotado. Aumentar `DATABASE_POOL_SIZE` e retesar teste.

### "auth.role_cache.negative_hit muito alto"
```bash
# Histograma de negative_hit por minuto
grep '"metric":"auth.role_cache.negative_hit"' /container/logs/LOG_FILE | \
  jq -s 'group_by(.ts | split("T")[1] | .[0:5]) | map({minute: .[0], count: length})'
```
**Provável:** Usuário sem permissão e sendo negado repetidamente. F4 com cache negativo TTL de 10s resolverá.

---

## Para o Próximo Agent (Fase 1+)

Depois de implementar as correções (grace, idempotência, 503 vs 401), **reproduzir este baseline** e comparar:

```bash
# Antes
./extract-baseline.sh /logs/app-2026-07-12.log > before.txt

# Depois da F1
./extract-baseline.sh /logs/app-2026-07-15.log > after.txt

# Diff
diff before.txt after.txt
```

**Criterios de sucesso (de plano.md):**
- `auth.refresh.revoke_all` → 0 por 7 dias
- `frontend.auth_zombie` → 0 por 7 dias
- `auth.401.guard_exception` → 0 (infra nunca mais desloga)
- `auth.refresh.reuse_detected` ainda > 0 (segurança preservada) mas << baseline

---

## Referências

- **Plano completo:** `workspace/plans/plan-sessao-auth-hardening.md` (§5 — Fase 0)
- **Review report:** `workspace/reviews/review-observability-fase0-sessao-auth-task1.md`
- **Backend service:** `src/common/observability/metrics.service.ts`
- **Frontend beacon:** `src/lib/telemetry.ts`
- **Endpoint telemetria:** `src/common/observability/telemetry.controller.ts`

---

**Versão:** 1.0  
**Escrito:** 2026-07-13  
**Para:** Fase 0 (Observabilidade) — DEV-170 / Task #994
