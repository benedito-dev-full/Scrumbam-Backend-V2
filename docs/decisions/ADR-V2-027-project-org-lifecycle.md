# ADR-V2-027 — Renomeacao de `-499 PROJECT_DELETED` → `PROJECT_LIFECYCLE` e `-500 ORG_DELETED` → `ORG_LIFECYCLE`

**Status:** Aceito
**Data:** 2026-05-09
**Decisores:** Strategist (Plano F7 Task#1 — proposta) — ratificada formalmente pelo CEO em 2026-05-09
**Tags:** `#dominio-engine` `#pilar-3` `#eventos` `#fase-F7` `#fase-F1-update`

---

## Contexto e Problema

O seed F1 atual declara apenas `-499 PROJECT_DELETED` ("Audit: projeto deletado") e `-500 ORG_DELETED` ("Audit: org deletada") na faixa de DEvento auditoria — cobrindo somente o evento `*.deleted`.

A F5 (dominio estrutural) emite tambem eventos `project.created`, `project.updated`, `org.created` (e potencialmente `org.updated`, `team.created`, etc. — esses ultimos cobertos por outras categorias). O stub F4 atual escreve esses eventos em `-501 USER_LOGIN` (errado, conforme ADR-V2-026 trata) ou em `-499`/`-500` (DClasses cujo NOME literal sugere apenas `deleted`).

Surge o problema:

**Como gravar `project.created` no DEvento se a unica DClasse `-499` chama-se `PROJECT_DELETED`?**

A F7 Task#1, ao instalar `AuditLogConsumer`, precisa decidir o mapeamento canonico `event.type → idClasse`. Ha 3 opcoes principais:

(a) Adicionar 3 novas DClasses (`-486 PROJECT_CREATED`, `-487 PROJECT_UPDATED`, `-488 ORG_CREATED`) — granularidade alta.
(b) **Renomear** `-499` para `PROJECT_LIFECYCLE` e `-500` para `ORG_LIFECYCLE`, gravando `action` (`created`/`updated`/`deleted`) em `metaDados._meta.action`.
(c) Mapear `project.*` todos para `-499` (aceitando o nome inadequado da DClasse) e `org.*` para `-500` — pragmaticamente errado.

O **Plano Mestre `docs/plano/00-PLANO-MESTRE.md` §3.3** EXIGE que renomeacoes na faixa de eventos sejam acompanhadas por ADR formal antes de alterar o seed F1 — alem de validar que nenhum codigo dependa do **nome literal** da DClasse renomeada (apenas da chave numerica).

---

## Validacao por Grep — Quem depende dos nomes literais hoje?

Executado em **2026-05-09** via `Grep "PROJECT_DELETED|ORG_DELETED"`:

| Arquivo | Linha | Tipo de referencia |
|---------|-------|-------------------|
| `prisma/seeds/classes.seed.ts:174` | `esp(-499, 'PROJECT_DELETED', ...)` | **NOMINAL** (declaracao do seed) |
| `prisma/seeds/classes.seed.ts:175` | `esp(-500, 'ORG_DELETED', ...)` | **NOMINAL** (declaracao do seed) |
| `docs/plano/00-PLANO-MESTRE.md:224-225` | tabela DEvento | **NOMINAL** (documentacao) |
| `docs/plano/00-PLANO-MESTRE.md:259` | resolucao de conflitos | **NOMINAL** (documentacao) |
| `docs/plano/02-DOMINIO-ENGINE.md:1635-1636` | tabela auxiliar | **NOMINAL** (documentacao — usa numeros diferentes -497/-498, sub-plano desatualizado) |
| `docs/SCHEMA-CANONICO-AUDITORIA.md:201-202` | tabela | **NOMINAL** (documentacao) |
| `.claude/agent-memory/strategist/MEMORY.md:151` | conflito resolvido | **NOMINAL** (memory do agent) |

**Codigo TypeScript de runtime (`src/`):** **ZERO ocorrencias** de `PROJECT_DELETED` ou `ORG_DELETED` como string ou identificador. Nenhum service, controller, dto, helper, test, middleware ou DVFS script referencia esses nomes literalmente.

**Conclusao:** Renomeacao e segura. Apenas docs + seed + memory precisam atualizar — todos sob versionamento.

---

## Alternativas Consideradas

### Alternativa A — Adicionar 3 DClasses especificas (`-486`, `-487`, `-488`)

`-486 PROJECT_CREATED` (filho de -3), `-487 PROJECT_UPDATED` (filho de -3), `-488 ORG_CREATED` (filho de -3).

**Pros:**
- Granularidade maxima — cada acao tem DClasse dedicada.
- Queries diretas: `SELECT * FROM DEvento WHERE idClasse=-486` retorna so `project.created`.

**Contras:**
- **Crescimento descontrolado:** se cada entidade (project, org, team, sprint, status, agent...) tiver `created`/`updated`/`deleted`/`archived`, sao ~24+ DClasses na faixa de eventos — saturando o range.
- Decisao prematura: ainda nao se sabe se cada `action` de cada entidade justifica DClasse propria. Provavelmente nao — analytics agrega por entidade, nao por action.
- Para alinhar `team`/`sprint`, precisariamos repetir o padrao — viral.
- `org.updated` nao existe hoje, mas se vier amanha, exige nova DClasse (`-485 ORG_UPDATED`?). Esquema fragil.
- Viola Mestre §3.3 (consolidacao por categoria).

**Rejeitada.**

### Alternativa B — Renomear `-499 → PROJECT_LIFECYCLE` e `-500 → ORG_LIFECYCLE` (escolhida)

Renomear as 2 DClasses existentes para nome generico de "lifecycle" e diferenciar a acao via `metaDados._meta.action: 'created' | 'updated' | 'deleted'`. Mantem chaves numericas (-499, -500) — apenas o `codigo` muda no seed.

**Pros:**
- **Sem crescimento de seed:** zero DClasses adicionais.
- **Forward-compat com qualquer nova `action`:** `archived`, `restored`, `cloned` cabem em `metaDados._meta.action` sem novo seed.
- **Coerente com Mestre §3.3 (consolidacao):** mesma logica de "C prevalece. Faixa consolidada".
- **Simetrico:** se F8/F14 quiser renomear `-497 TASK_CREATED → TASK_LIFECYCLE` para incluir `task.updated`, e a mesma estrategia (ADR proprio).
- **Migration trivial:** UPSERT idempotente do seed (ADR-V2-020) atualiza o `codigo` sem perda de registros DEvento ja gravados (registros usam `idClasse` numerico, nao o nome).
- **Validacao de seguranca executada:** grep confirmou ZERO referencias literais em `src/`.

**Contras:**
- Mudanca nominal no seed exige reseed coordenado. Mitigado pelo UPSERT idempotente.
- Documentacao atual (sub-plano F7 §7.5, mestre §3.2) precisa atualizar — incluido nesta ADR.
- Quem ler "DEvento WHERE idClasse=-499" precisa entender que e LIFECYCLE, nao apenas DELETED. **Mitigacao:** README da pasta `src/eventos/` documenta o mapeamento. JSDoc no `AuditLogConsumer` explicita.

### Alternativa C — Mapear `project.*` todos para `-499` mantendo nome `PROJECT_DELETED`

**Pros:**
- Zero alteracao no seed.

**Contras:**
- Audit trail confuso: `SELECT codigo FROM DClasse WHERE chave=-499` retorna `PROJECT_DELETED`, mas registros incluem `created` e `updated`. Onboarding novo membro fica perdido.
- Reviewer rejeita: viola devari-event-naming.md (consistencia semantica).
- Débito tecnico que se propaga em F8 (search) e F14 (reports/dashboards).

**Rejeitada.**

### Alternativa D — Status quo (nao gravar `project.created`/`org.created` em DEvento)

Simplesmente nao auditar `created`/`updated` — emitir apenas `deleted`.

**Contras:**
- Quebra contratos do Scrumban-hoje (auditoria completa de project/org lifecycle).
- F4 ja emite esses eventos hoje (em -501 errado) — Task#1 precisa migrar, nao remover.

**Rejeitada.**

---

## Decisao

**Adotada Alternativa B.** Renomear as 2 DClasses existentes:

- `-499 PROJECT_DELETED` → `-499 PROJECT_LIFECYCLE` ("Audit: lifecycle de projeto")
- `-500 ORG_DELETED` → `-500 ORG_LIFECYCLE` ("Audit: lifecycle de organizacao")

A acao especifica (`created` / `updated` / `deleted`) sera gravada em:
- `metaDados._meta.action: string` (campo principal — fonte de verdade)
- `descricao: string` (espelho do `event.type` original — ex: `project.created`, `project.deleted`)

**Mudancas necessarias:**

### 1. `prisma/seeds/classes.seed.ts` linhas 174-175

```ts
// ANTES
esp(-499, 'PROJECT_DELETED', 'Audit: projeto deletado', -3),
esp(-500, 'ORG_DELETED', 'Audit: org deletada', -3),

// DEPOIS
esp(-499, 'PROJECT_LIFECYCLE', 'Audit: lifecycle de projeto (created/updated/deleted via metaDados._meta.action)', -3),
esp(-500, 'ORG_LIFECYCLE', 'Audit: lifecycle de organizacao (created/updated/deleted via metaDados._meta.action)', -3),
```

### 2. `docs/plano/00-PLANO-MESTRE.md` §3.2 linhas 224-225

```
| -499 | PROJECT_LIFECYCLE | Audit: lifecycle de projeto | -3 |
| -500 | ORG_LIFECYCLE | Audit: lifecycle de organizacao | -3 |
```

E linha 259 (resolucao de conflitos) atualizar referencia:

```
| `-497` PROJECT_DELETED ... | ... | TASK_CREATED fica em -497; PROJECT_LIFECYCLE em -499; MCP_CALL em -495; ...
```

### 3. `docs/SCHEMA-CANONICO-AUDITORIA.md` linhas 201-202

Mesma renomeacao.

### 4. `docs/plano/02-DOMINIO-ENGINE.md` linhas 1635-1636

Sub-plano F7 §7.5 usa numeros desatualizados (`-497 PROJECT_DELETED`, `-498 ORG_DELETED`) — atualizar para refletir os numeros canonicos do Mestre (`-499`, `-500`) e os novos nomes (`PROJECT_LIFECYCLE`, `ORG_LIFECYCLE`). Marcar com nota: "alinhado ao Mestre §3.2 e ADR-V2-027 em 2026-05-09".

### 5. `.claude/agent-memory/strategist/MEMORY.md` linha 151

Atualizar referencia ao conflito resolvido.

### 6. `workspace/plans/plan-eventos-canonicos-f7-task1.md` §4.4 (audit-log.consumer.ts)

Atualizar mapa `TYPE_TO_CLASSE`:

```ts
'project.created':              BigInt(-499),  // PROJECT_LIFECYCLE (action: 'created')
'project.updated':              BigInt(-499),  // PROJECT_LIFECYCLE (action: 'updated')
'project.deleted':              BigInt(-499),  // PROJECT_LIFECYCLE (action: 'deleted')
'org.created':                  BigInt(-500),  // ORG_LIFECYCLE (action: 'created')
'org.deleted':                  BigInt(-500),  // ORG_LIFECYCLE (action: 'deleted')
```

E garantir que o consumer extraia `action` do `event.type` (apos o ultimo `.`) e grave em `metaDados._meta.action`.

### 7. Reseed

Executar `npm run seed:classes` (UPSERT idempotente, ADR-V2-020). Registros DEvento ja gravados com `idClasse=-499` ou `-500` continuam validos — apenas o `DClasse.codigo` e `DClasse.nome` mudam. Total de DClasses permanece **131** (apos ADR-V2-026 adicionar `-489 AUDIT_GENERIC`).

---

## Consequencias

### Positivas

- **Forward-compat:** novas `action` (`archived`, `restored`, `cloned`) cabem sem novo seed.
- **Consolidacao por categoria:** alinha com Mestre §3.3 e com a logica ja aplicada a `-470` (WEBHOOK consolida configs/tokens).
- **Custo de migracao baixo:** apenas docs/seed/memory atualizam — nenhum codigo de runtime quebra (validado via grep).
- **Audit trail consistente:** `SELECT codigo FROM DClasse WHERE chave=-499` retorna `PROJECT_LIFECYCLE` — explicito sobre o que armazena.
- **Simetria com `-489 AUDIT_GENERIC` (ADR-V2-026):** ambas seguem o padrao de DClasse generica + diferenciacao via `metaDados`.

### Negativas (mitigadas)

- **Nomes mais longos:** `PROJECT_LIFECYCLE` vs `PROJECT_DELETED`. **Mitigacao:** consistente com pattern Devari (`STATUS_INTENTION_V3`, `EXEC_STATUS_APPROVED`, etc. — codigos descritivos sao a norma).
- **Nova convencao a aprender:** consumidores de DEvento devem saber que `idClasse=-499` é polimorfico (3 actions). **Mitigacao:** README de `src/eventos/` + JSDoc no `audit-log.consumer.ts` documentam.

### Plano de migracao

Como **nenhum codigo de runtime** (`src/**/*.ts`) referencia o nome literal `PROJECT_DELETED` ou `ORG_DELETED`, NAO ha migracao de codigo a fazer. Apenas:

1. Atualizar 6 arquivos de doc/seed/memory listados acima.
2. Reseed via UPSERT.
3. Validar via `psql -c "SELECT chave, codigo, nome FROM \"DClasse\" WHERE chave IN (-499, -500);"` retorna nomes novos.
4. Implementer da Task#1 implementa `AuditLogConsumer` com mapeamento canonico ja atualizado.

**Sem necessidade de:** dual-write, feature flag, deprecation period — a renomeacao e puramente nominal e nao quebra contratos.

---

## Implementacao

**Quem implementa:** Implementer da F7 Task#1 (depois de aprovacao formal desta ADR pelo CEO).

**Sequencia (Fase 2 do plano da Task#1, junto com ADR-V2-026):**

1. Editar `prisma/seeds/classes.seed.ts` (renomear 2 linhas — chaves -499 e -500 — e adicionar -489 conforme ADR-V2-026).
2. Atualizar `docs/plano/00-PLANO-MESTRE.md` §3.2 (linhas 224-225) e §3.3 (linha 259).
3. Atualizar `docs/SCHEMA-CANONICO-AUDITORIA.md` (linhas 201-202).
4. Atualizar `docs/plano/02-DOMINIO-ENGINE.md` (linhas 1635-1636) com nota de alinhamento.
5. Atualizar `.claude/agent-memory/strategist/MEMORY.md` (linha 151).
6. Rodar `npm run seed:classes` (UPSERT idempotente).
7. Validar via psql que codigo/nome mudaram nas chaves -499/-500.
8. Em sequencia, implementar `AuditLogConsumer` com mapeamento canonico (Fase 5 do plano).

**Hook que valida:** `validate-canonical-tables.sh` (zero impacto — sem tabelas novas, apenas renomeacao). Hook de validacao de seed (se houver) deve passar — UPSERT idempotente preserva integridade hierarquica.

---

## Referencias

- `docs/plano/00-PLANO-MESTRE.md` §3.2 (tabela DEvento — linhas 224-225) e §3.3 (regra de adicao/renomeacao requer ADR — linha 259).
- `docs/plano/02-DOMINIO-ENGINE.md` §7.5 linhas 1635-1636 (sub-plano F7 desatualizado — sera corrigido por esta ADR).
- `docs/SCHEMA-CANONICO-AUDITORIA.md` linhas 201-202 (tabela auxiliar).
- `workspace/plans/plan-eventos-canonicos-f7-task1.md` §3.3, §4.4, §9 Decisao #3.
- `prisma/seeds/classes.seed.ts:174-175` (linhas a renomear).
- `.claude/agent-memory/strategist/MEMORY.md:151` (memory entry a atualizar).
- ADR-V2-008 (DEvento substitui DNotification/DWebhook) — esta ADR refina o mapeamento.
- ADR-V2-020 (UPSERT idempotente do seed) — viabiliza renomeacao sem perda de dados.
- ADR-V2-026 (audit generico) — esta ADR e ADR-V2-026 sao implementadas juntas na Fase 2 da Task#1.
- Validacao por grep executada em 2026-05-09: `Grep "PROJECT_DELETED|ORG_DELETED" — todas referencias sao NOMINAIS em docs/seed/memory; ZERO em src/`.
