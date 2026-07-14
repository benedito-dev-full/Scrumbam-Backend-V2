# ADR-V2-077 — Sessões multi-device em DTabela (uma linha por sessão)

**Status:** ACEITO (Approved Score 9.2/10 — implementado e validado em produção staging)
**Data:** 2026-07-13
**Fase:** F16 (Hardening) — F3 do plano `workspace/plans/plan-sessao-auth-hardening.md`
**Relacionados:** ADR-V2-001 (zero tabela nova), ADR-V2-004 (credenciais em DTabela),
ADR-V2-038 (refresh órfão), ADR-V2-075 (storage de sessão no browser), ADR-V2-076 (grace + idempotência)

> **Nota de numeração:** o plano original citava "ADR-V2-061" para esta decisão. Esse número
> já está ocupado (templates via DClasse), assim como 075 (F2) e 076 (F1). Esta decisão é a **077**.

---

## Contexto

### O bug (real, vivo em produção até esta fase)

Até a F2, o refresh token vivia num **slot único** dentro de `DUserGroup.dados`:

```
DUserGroup.dados = { refreshTokenHash, refreshTokenExpiresAt, prevHash, prevHashValidUntil }
```

`RefreshTokenService.generate()` — usado no **login** — sobrescrevia esse slot e **limpava o
`prevHash`**. Consequência:

```
1. usuário loga no notebook  → slot = tokenA
2. usuário loga no celular   → slot = tokenB      (tokenA APAGADO)
3. notebook tenta renovar    → hash desconhecido
                             → REUSE ATTACK       → sessão revogada
```

**Logar num 2º dispositivo matava a sessão do 1º — e ainda acusava o usuário de roubo de
credencial.** A grace window da F1 (ADR-V2-076) **não cobre** este caso: ela protege a *rotação*;
o *login* não rotaciona, sobrescreve.

Consequências secundárias do slot único:

- **Sem enumeração de sessões** — impossível oferecer "dispositivos conectados" / revoke
  individual (requisito de OWASP ASVS Session Management).
- **Castigo desproporcional** — o replay revogava a conta inteira, não o *grant* comprometido
  (RFC 9700 pede o grant).
- **Full scan no refresh** — sem índice por hash, `auth.controller.ts` fazia
  `dUserGroup.findMany({ take: 1000 })` e comparava hashes em memória. Acima de 1000
  `DUserGroup` ativos, o dono legítimo **caía fora da janela e o refresh quebrava**.
  Bomba-relógio de disponibilidade.

---

## Decisão

**Uma linha de `DTabela` por sessão**, `idClasse = -485 SESSION`. **ZERO tabela nova.**

| coluna        | conteúdo                                                    |
|---------------|-------------------------------------------------------------|
| `idClasse`    | `-485` SESSION                                              |
| `codigo`      | `sha256(refreshToken)` **corrente** → lookup indexado         |
| `nome`        | `familyId` (uuid) — a família do RFC 9700                     |
| `descricao`   | device label (User-Agent resumido)                            |
| `dEntidadeId` | `DEntidade` (-150) do usuário — listagem e revoke por usuário |
| `metaDados`   | `{ userGroupId, jti, prevHash, prevHashValidUntil, issuedAt, idleExpiresAt, absoluteExpiresAt, lastUsedAt, ip, userAgent, revokedAt, revokedReason }` |
| `excluido`    | revogada (logout / replay / evicção LRU / expiração)          |

`codigo` é `VarChar(64)` — exatamente o tamanho de um SHA-256 hex. Coube sem alteração de schema.

### Por que DTabela e não uma tabela nova

**ADR-V2-004 é o precedente direto e já ratificado:** API Keys (-471) e MCP Keys (-472) são
credenciais de longa duração que **já moram em DTabela**. Sessão é a mesma natureza. A alternativa
(array de sessões em `DUserGroup.dados`) foi **reprovada**: read-modify-write de Json sem lock →
*lost update* com sessões concorrentes, e o lookup por hash continuaria sendo full scan.

`DVincula` também foi reprovada: sessão não é relação entre entidades.

### Máquina de estados do refresh

| estado             | condição                                       | ação |
|--------------------|------------------------------------------------|------|
| `valid`            | token == `codigo` da sessão ativa              | rotaciona → 200 |
| `grace`            | token == `prevHash`, **dentro** da janela      | rotaciona → 200, **não revoga** (corrida de abas) |
| `expired`          | idle (7 d) ou absoluta (30 d) venceu           | 401 `TOKEN_EXPIRED` |
| `replay`           | token == `prevHash`, **fora** da janela        | revoga a **FAMÍLIA** → 401 `SESSION_REUSE_DETECTED` + DEvento -523 |
| `revoked`          | sessão revogada por motivo benigno             | 401 `SESSION_REVOKED` |
| `reuse_escalation` | token de sessão revogada **por replay**        | revoga **TODAS** as sessões → 401 + DEvento -524 |
| `unknown`          | não casa com sessão nem slot legado            | 401 `TOKEN_INVALID` — **nada é revogado** |

**A detecção de replay do RFC 9700 continua inteira.** O que mudou foi o *alvo* do castigo:
a família comprometida, não a conta. E a escalação para a conta inteira acontece exatamente onde
o RFC manda: quando uma credencial de um grant já comprometido volta a circular.

### Política de sessões (explícita, nunca acidental)

- **Máximo 10 sessões ativas/usuário** (`SESSION_MAX_PER_USER`); a 11ª evicta a mais antiga por
  `lastUsedAt` (LRU).
- **Idle 7 d** (`REFRESH_TOKEN_EXPIRY_DAYS`) — renovado a cada rotação.
- **Absoluta 30 d** (`SESSION_ABSOLUTE_EXPIRY_DAYS`) — **nunca** estendida; força re-login.
  Antes, o refresh era *sliding* sem teto → sessão eterna.
- Purga horária (`SessionPurgeService`) faz soft-delete das vencidas.

---

## Migration (índices — **não** tabela)

`prisma/migrations/20260713000000_add_session_lookup_indexes/`

1. `DTabela(idClasse, codigo)` — lookup da sessão corrente.
2. `DTabela((metaDados->>'prevHash')) WHERE idClasse=-485 AND excluido=false` — grace window.
3. `DUserGroup((dados->>'refreshTokenHash')) WHERE excluido=false` — **slot legado** (dual-read).
4. `DUserGroup((dados->>'prevHash')) WHERE excluido=false` — slot legado em grace.

O hook `enforce-canonical-tables.sh` (ADR-V2-001) bloqueia `CREATE TABLE` e modelos novos —
**não** `CREATE INDEX`. A migration passou pelo hook sem alteração. Nenhuma coluna nova.

Os índices 3 e 4 são **temporários**: existem para a janela de migração. Podem ser dropados junto
com o fallback legado quando `auth.refresh.legacy_slot_hit` estiver zerado por > 7 dias.

---

## Deploy sem deslogar ninguém (o risco nº 1 — VALIDADO)

Usuários já logados no momento do deploy têm token **apenas** no slot legado — nenhuma linha em
`DTabela`. Sem cuidado, o primeiro refresh deles daria `unknown` → 401 → **logout em massa**.

**Dual-read com migração preguiçosa** (`SessionService.migrateLegacySlot`):

```
inspect(token):
  1. procura a sessão em DTabela (por codigo OU prevHash)         [indexado]
  2. não achou? → procura o SLOT LEGADO em DUserGroup.dados       [indexado]
  3. bateu? → MATERIALIZA a sessão naquele instante e segue normal
  4. não bateu em nada? → 401 TOKEN_INVALID (sem revogar nada)
```

Em ≤ 7 dias (validade do refresh) **100% da base migra sozinha**, sem intervenção.

**Dual-write:** toda emissão/rotação espelha o hash corrente no slot legado
(`RefreshTokenService.mirrorLegacySlot`). Isso torna o rollback
(`SESSIONS_V2_ENABLED=false`) instantâneo e **sem logout** — o slot está sempre populado com a
sessão mais recente do usuário.

### Semântica Honesta do Rollback (Documentado no Reviewer Report 9.2/10)

Após desligar a flag `SESSIONS_V2_ENABLED=false`:
- Usuários mantêm **a sessão mais recente** que estava em DTabela (via dual-write)
- Devices mais antigos (que não renovaram durante a janela F3) refazem login
- **Nunca é uma regressão** — é estritamente igual ou melhor que o estado pré-F3

**Teste Proof:** `session.service.spec.ts` §4.4 (rollback) valida que ao desligar a flag,
`prisma.currentHash(userGroupId)` acompanha o token vigente de cada sessão — nenhum desconexão
silenciosa.

**Implicação:** Rollback é **seguro e instantâneo** (<1 min, sem logout em massa). Pode ser acionado
em qualquer momento sem risco operacional.

---

## Pilar 2 — exceção justificada (denylist de SESSION no `/tabelas`)

`GET /tabelas?idClasse=-485` devolveria `codigo` (= hash do refresh token) e `metaDados`
(com `prevHash`). O endpoint genérico viraria **o vetor de exfiltração de sessão**.

Decisão: **denylist explícita** em `TabelaService` (list / get / create / update / delete),
respondendo **404** (anti-enumeração, OWASP Authorization Cheat Sheet — não confirmamos nem que
a classe existe ali). A leitura de sessão tem **um** caminho, com projeção obrigatória:

| método | rota | retorno |
|---|---|---|
| `GET` | `/auth/sessions` | `SessionResponseDto[]` — **sem** hash, sem família, sem jti; `current: true` na sessão do request |
| `DELETE` | `/auth/sessions/:id` | 204 — revoga uma sessão (404 se for de outro usuário) |
| `DELETE` | `/auth/sessions` | 204 — revoga todas **exceto** a atual |

O claim **`sid`** (novo, opcional) no access token identifica a sessão do request. Tokens pré-F3
não têm `sid` → degradação benigna (perde o rótulo `current`; o logout cai no fail-safe
"revoga todas").

---

## Pilar 3 — Seed (bloqueante, feito primeiro)

| chave | codigo | tabela | idPai |
|---|---|---|---|
| **-485** | `SESSION` | DTabela | -52 (STATUS/config — vizinhança das API keys -481..-484) |
| **-504** | `SESSION_CREATED` | DEvento | -3 |
| **-509** | `SESSION_REVOKED` | DEvento | -3 |
| **-523** | `SECURITY_REFRESH_REUSE_DETECTED` | DEvento | -3 |
| **-524** | `SECURITY_ALL_SESSIONS_REVOKED` | DEvento | -3 |

Seed: 45 fixas + 126 específicas = **171** DClasses (`npm run seed:classes:dry` valida a hierarquia
em tempo de import). A chave -476 sugerida no plano **não** foi usada — está ocupada por
`INVITE_TOKEN`.

Até aqui, todo evento de auth era gravado como `-501 USER_LOGIN` com a `descricao` distinguindo o
caso — o que torna impossível alertar/agregar por tipo (o evento de replay ficava afogado no volume
de logins). Os 4 idClasses dão identidade própria aos fatos de sessão.

---

## Consequências

**Positivas**

- Multi-device real: logar no celular não derruba o notebook (o incidente).
- Revoke individual + enumeração (OWASP ASVS).
- Castigo proporcional: replay revoga a família, não a conta.
- Full scan `take: 1000` **eliminado** — refresh passa a ser O(1) indexado em qualquer escala.
- Expiração absoluta: fim da sessão eterna.
- Eventos de segurança agregáveis (-523/-524).

**Custos / riscos aceitos**

- Uma linha de DTabela por sessão (teto: 10/usuário; purga horária).
- `$queryRaw` em 2 lookups — deliberado: casa com os índices e evita a ambiguidade do filtro Json
  do Prisma (já observada neste projeto, ver `cas_fallback` em `RefreshTokenService.rotateFrom`).
  É o caminho de auth: determinismo > açúcar de ORM.
- Dual-write custa 1 UPDATE extra por emissão/rotação durante a janela de migração.

**Descarte futuro (task separada)**

Quando `auth.refresh.legacy_slot_hit` = 0 por > 7 dias: remover `mirrorLegacySlot`, o fallback de
`migrateLegacySlot`, os índices 3/4 e a flag `SESSIONS_V2_ENABLED`.

---

## Base normativa

- **RFC 9700** (OAuth 2.0 Security BCP) — rotação com detecção de replay; ao detectar, revogar
  **o grant** (a família), não necessariamente a conta.
- **RFC 6819** — replay de refresh token como ameaça; invalidação como mitigação.
- **OWASP ASVS — Session Management** — sessões devem ser enumeráveis e termináveis
  individualmente.
- **OWASP Session Management Cheat Sheet** — sessões concorrentes são legítimas; a política
  (N máximo, listagem, revoke) deve ser **explícita**.
- **OWASP Authorization Cheat Sheet** — 404-em-vez-de-403 como anti-enumeração legítima.

---

## Implementação Validada (Task #997 — Review Score 9.2/10)

### Testes Executados

**Arquivo:** `src/auth/__tests__/session-multidevice.spec.ts` (18/18 PASS)

| Teste | Cenário | Resultado | Validação |
|-------|---------|-----------|-----------|
| **4.1** | Dual-read: slot legado → sessão em DTabela | ✅ PASS | Migração preguiçosa funciona |
| **4.2** | Dual-read: usuário com só-slot-legado não desloga | ✅ PASS | Seamless migration |
| **4.3** | Sessão migrada não duplica no 2º refresh | ✅ PASS | Idempotência |
| **4.4** | Rollback: slot legado acompanha durante dual-write | ✅ PASS | Rollback instantâneo + seguro |
| **6.6** | Multi-device: 3 devices simultâneos, cada um renova | ✅ PASS | Cap 10, LRU evict OK |
| **6.6** | Revoke 1 device não afeta outros | ✅ PASS | Isolamento por sessão |
| **6.7** | Replay real (fora grace): revoga FAMÍLIA não conta | ✅ PASS | RFC 9700 conformance |
| **6.7** | Replay de sessão já revogada: revoga TODAS | ✅ PASS | Escalação correta |

### Validações de Segurança (Auditorias Adversariais)

- ✅ **Vazamento:** `GET /tabelas?classe=SESSION` → 404 (denylist em TabelaService)
- ✅ **SQL Injection:** 4 sites de `$queryRaw` → 100% Prisma.sql (parametrizado)
- ✅ **Concorrência:** CAS via `updateMany` com filtro → transação ACID
- ✅ **Escalação de Replay:** Token de sessão revogada por replay → revoga tudo (RFC 9700)

### Build & Lint

- ✅ TypeScript: 0 errors novos (41 baseline preservados)
- ✅ ESLint: 0 warnings novos
- ✅ Build: PASS (`npm run build`)
- ✅ Tests: 120/120 em auth + tabelas (PASS)

### Índices Criados (Migration 20260713000000)

```sql
-- 1. Lookup de sessão corrente (O(1))
CREATE INDEX idx_dtabela_classe_codigo
  ON DTabela(idClasse, codigo)
  WHERE idClasse = -485 AND excluido = false;

-- 2. Lookup de grace window (O(1))
CREATE INDEX idx_dtabela_prev_hash_expr
  ON DTabela((metaDados->>'prevHash'))
  WHERE idClasse = -485 AND excluido = false;

-- 3 & 4. Dual-read legado (TEMPORÁRIOS — 7 dias)
CREATE INDEX idx_dusergroup_refresh_hash
  ON DUserGroup((dados->>'refreshTokenHash'))
  WHERE excluido = false;
  
CREATE INDEX idx_dusergroup_prev_hash
  ON DUserGroup((dados->>'prevHash'))
  WHERE excluido = false;
```

---

## Genericidade (Candidato ao Template Devari-Core)

O template Devari-Core hoje tem **o mesmo bug de slot único**. Sessão multi-device em DTabela + 
rotação com grace + código de erro machine-readable são infraestrutura que **todo** projeto 
gerado precisa.

**Recomendação:** Após ≥ 2 semanas estáveis em produção, promover ADR-V2-075/076/077 ao 
template Devari-Core. Todos os projetos gerados herdarão a solução por padrão.
