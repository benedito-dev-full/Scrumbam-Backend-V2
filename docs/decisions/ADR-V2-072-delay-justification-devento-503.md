# ADR-V2-072: Justificativa de Atraso via DEvento -503 + Motivos via DClasse -530..-537

**Status:** Aceito
**Data:** 2026-07-09
**Decisores:** Strategist Agent V2, CEO (decisões travadas 2026-07-09)
**Tags:** #V2 #fase-F1 #eventos #delay-justifications #rbac #justificativa

---

## Contexto e Problema

O sistema Scrumban-Backend-V2 hoje mostra tarefas atrasadas na aba "Em atraso" de `/assigned`, mas não captura o **porquê** do atraso. A feature "Justificativa de Atraso de Tarefas" fecha esse ciclo permitindo que o responsável justifique com uma categoria (obrigatória) + detalhe opcional.

Questão crítica: onde persistir a justificativa? Como versionar edições?

### O anterior que já existe

- **ADR-V2-001** — ZERO tabela nova (inviolável). Toda persistência cabe nas 17 tabelas.
- **ADR-V2-008** — DEvento é o barramento de eventos/auditoria. Edição = novo evento → histórico natural.
- **ADR-V2-003** — RBAC duplo via DVincula + idClasse: org roles (-161/-162/-163), project roles (-171/-172/-173).
- **ADR-V2-058** — FK de DVincula/DEvento exige DEntidade (não IDs de DTask/DProject).

### O bloqueador

Onde guardar: em `DTask.dados` inline (mais simples, mas sem histórico) vs em `DEvento` (auditável, com histórico via supersede)?

---

## Alternativas Consideradas

### Opção A — Justificativa em `DTask.dados.delayJustification` (Json inline)

Embutir a justificativa como campo Json na própria tarefa.

**Prós:**
- Mais simples: leitura da vigente é trivial (já vem no GET da task)
- Uma coluna (dados) já existe

**Contras:**
- **Sem histórico real:** edição sobrescreve (perde a justificativa anterior)
- **Agregação do painel = full scan:** painel admin precisa agrupar por motivo × usuário × período; SEM o DEvento, exige full scan de DTask + reduce em memória (N+1/scan, Reviewer rejeita)
- **Mistura dado de execução com auditoria:** violação de separação de preocupações

**Rejeitada** — impossível implementar painel (Fase 2) sem quebra de performance.

### Opção B — **Justificativa via DEvento -503, motivos via DClasse (escolhida)**

Criar:
1. **DEvento -503 `DELAY_JUSTIFICATION`** — cada versão é um evento (auditável)
2. **DClasse -530 `DELAY_REASON`** (agrupador) + 7 folhas (-531..-537) — taxonomia de motivos
3. **Versioning via supersede:** editar marca a anterior `excluido=true`, insere a nova
4. **Agregação:** `$queryRaw` sobre DEvento (1 query, ZERO N+1)

**Prós:**
- **Histórico nativo (ADR-V2-008):** cada versão é um evento persistido
- **Agregação 1 query via jsonb:** painel grupo by `idEntidade`/`motivoClasse`/período
- **Radio de motivos via endpoint genérico:** `GET /classes?idPai=-530` (Pilar 2, ZERO controller novo)
- **Zero tabela nova (ADR-V2-001):** tudo cabe nas 17 tabelas
- **Escala para N justificativas/edições:** DEvento é transacional, suporta volume

**Adotada** — arquitetura canônica, escalável, auditável.

**Nota sobre B:** O histórico exigido pela CEO decisão 5 e o painel agregado (decisão 6) tornam B inviável como fonte primária. `DTask.dados` pode, no máximo, cachear um flag leve `hasDelayJustification` + `lastReasonClasse` para badge sem hit — mas **fonte de verdade é o DEvento**.

---

## Decisão

### Estrutura de Persistência

#### 1. DEvento -503 `DELAY_JUSTIFICATION`

```sql
DEvento
  chave         → PK sequenciada
  idClasse      = -503 (DELAY_JUSTIFICATION)
  idEntidade    = autorId (DEntidade do responsável) — FK válida (ADR-V2-058)
  identificadorExterno = taskId (string, SEM FK, índice para "vigente da task")
  descricao     = texto livre (opcional)
  metaDados     = { taskId, motivoClasse, texto, projetoId, autorId, delayDays, delayKind, version, supersededBy }
  excluido      = false (vigente) | true (superseded)
  criadoEm      = timestamp
```

**"1 vigente + histórico" via supersede:**
- Editar marca a vigente anterior `excluido=true` + `metaDados.supersededBy=<novaChave>`
- Insere nova com `excluido=false`
- **Vigente = a única linha `excluido=false`** daquela task
- **Histórico = todas as linhas** (inclui `excluido=true`)

#### 2. DClasse -530..-537 (motivos de atraso)

| chave | codigo | nome | idPai | agrupamento |
|-------|--------|------|-------|-------------|
| -530 | `DELAY_REASON` | Motivo de atraso | -51 (Tabelas) | **true** |
| -531 | `DELAY_DEPENDENCY` | Dependência não entregue | -530 | false |
| -532 | `DELAY_EXTERNAL_BLOCK` | Bloqueio externo / aguardando cliente | -530 | false |
| -533 | `DELAY_UNDERESTIMATED` | Subestimei o esforço | -530 | false |
| -534 | `DELAY_PRIORITY_SHIFT` | Prioridade mudou no meio | -530 | false |
| -535 | `DELAY_TECHNICAL` | Problema técnico / bug | -530 | false |
| -536 | `DELAY_OVERLOAD` | Sobrecarga (tarefas demais) | -530 | false |
| -537 | `DELAY_OTHER` | Outro | -530 | false |

### Endpoints (Fase 1 — Captura)

| Método | Rota | RBAC | Descrição |
|--------|------|------|-----------|
| `GET` | `/classes?idPai=-530` | Jwt | Radio de motivos (Pilar 2 — Endpoint genérico) |
| `POST` | `/tasks/:taskId/delay-justification` | Jwt + (assignee OU org ADMIN) | Cria/edita vigente (supersede) |
| `GET` | `/tasks/:taskId/delay-justification` | Jwt + (assignee OU org ADMIN) | Lê vigente (CEO decisão 1: membro NÃO lê de terceiros) |
| `GET` | `/me/delay-justifications/pending-count?projectId=` | Jwt | Badge de atrasos sem justificativa |

**RBAC:** Assignee da task OU **org ADMIN (DVincula -161) SOMENTE.** Project MANAGER (-171) NÃO autoriza (CEO decisão 3).

### Endpoints (Fase 2 — Painel admin — FORA DE ESCOPO DA FASE 1)

| Método | Rota | RBAC | Descrição |
|--------|------|------|-----------|
| `GET` | `/tasks/:taskId/delay-justification/history` | Jwt + (assignee OU org ADMIN) | Histórico completo |
| `GET` | `/reports/delay-reasons?userId=&projectId=&motivoClasse=&from=&to=` | Jwt + **org ADMIN SOMENTE** | Agregação por usuário × projeto × motivo × período |

---

## Critério de Atraso (overdue.util.ts)

**Via `TimezoneService` — comparação por DIA de calendário em TZ America/Sao_Paulo (não timestamp).**

Fonte do "dia de conclusão" (CEO decisão 2):
1. **Primário:** `dados.telemetry.doneAt` (server-side, persiste até VALIDATED)
2. **Fallback:** `dados.v3.movedAt` se estado terminal (VALIDATING/VALIDATED)
3. **Último recurso:** `atualizadoEm` (ruidoso, qualquer edição bumps)

**Tipos de atraso:**
- **Aberto:** `status ≠ DONE/VALIDATED` e `hoje > dueDate_dia` → `delayKind='OPEN'`
- **Concluído com atraso:** `status ∈ {DONE, VALIDATED}` e `conclusao_dia > dueDate_dia` → `delayKind='COMPLETED_LATE'`

---

## Consequências

### Positivas

- **Histórico nativo:** cada edit é um evento persistido, sem precisar de schema change
- **Agregação eficiente:** 1 query via `$queryRaw` sobre DEvento (ZERO N+1)
- **Semântica alinhada:** ADR-V2-008 (DEvento é barramento), ADR-V2-001 (zero tabela nova)
- **Reutilização:** padrão "fato datado versionável por supersede" é reutilizável (motivos de cancelamento, rejeição, etc.)

### Negativos

- **Prisma `groupBy` insuficiente:** agregação do painel exige `$queryRaw` com bind params (não é problema — padrão em Devari)
- **Double-count de edições:** mitigado via supersede (`excluido=true` marca anterior, agregação conta só `excluido=false`)

---

## Implementação — Fase 1 (Captura) — COMPLETA

| Item | Status |
|------|--------|
| Seed (+9 DClasses -503, -530..-537) | ✅ DONE — `classes.seed.ts` + validação hierarquia |
| DTOs (create, response, pending-count) | ✅ DONE — class-validator + Swagger |
| `overdue.util.ts` (critério "atrasada") | ✅ DONE — via TimezoneService, 22 testes |
| `DelayJustificationsService` | ✅ DONE — createOrEdit (supersede), getVigente, getPendingCount |
| **RBAC** (CEO decisões 1, 3) | ✅ DONE — assignee OU org ADMIN (-161); Project MANAGER (-171) negado |
| Controller + endpoints | ✅ DONE — POST/GET `/tasks/:taskId/delay-justification` + `/me/.../pending-count` |
| Eventos emitidos | ✅ DONE — `delay.justified` pós-persistência via `EventProducerService` |
| README do módulo (Pilar 2) | ✅ DONE — idClasse, payload, RBAC, reuso `/classes` |
| Testes unit + integration | ✅ DONE — 22/22 PASS (overdue.util, service com RBAC/supersede/histoire) |
| **Frontend (modal + badge)** | ❌ FORA — Task F1 backend COMPLETA; frontend F1 é Task separada |

**Quality Score:** 9.0/10 (APPROVED pelo Reviewer — net-zero regressão, 3 desvios auditados/validados, ZERO N+1)

---

## Implementação — Fase 2 (Painel Admin) — COMPLETA

| Item | Status |
|------|--------|
| Migration (índice parcial jsonb) | ✅ DONE — `20260709000000_add_devento_delay_reason_agg_idx` (idempotente, rollback documentado) |
| `DelayReasonsService` (agregação $queryRaw) | ✅ DONE — GROUP BY `idEntidade`/`motivoClasse`/período + whitelist SQL (sem injection) |
| DTOs (query, response) | ✅ DONE — `DelayReasonsQueryDto` (filtros + `groupBy` validado), `DelayReasonsResponseDto` (ranking) |
| `DelayReasonsController` | ✅ DONE — `GET /reports/delay-reasons` — org ADMIN (-161) SOMENTE; Project MANAGER (-171) negado |
| GET `/history` endpoint | ✅ DONE — `GET /tasks/:taskId/delay-justification/history` — retorna todas as versões (inclui superseded) |
| **RBAC** (Fase 2) | ✅ DONE — org-alvo = `DProject.idEstab` (org dona do projeto); só ADMIN (-161) dessa org acessa |
| Resolução de rótulos (batch) | ✅ DONE — 1 query agregação + 1 query batch de rótulos (motivo, usuário, projeto); ZERO N+1 |
| Testes (agregação, filtros, período) | ✅ DONE — 4 suites, 36/36 testes PASS (SELECT + agregação + RBAC 403) |
| README atualizado (endpoints Fase 2) | ✅ DONE — documentação de `groupBy`, filtros, RBAC org-ADMIN-only |
| **Frontend (painel admin + charts)** | ❌ FORA — Task F2 backend COMPLETA; frontend/gaveta F2 é Task separada (em andamento) |

**Quality Score:** 9.0/10 (APPROVED pelo Reviewer — SQL injection auditada, RBAC testada, ZERO N+1 confirmado via DATABASE_LOGGING)

---

## Sumário das 2 Fases

| Fase | O Quê | Status |
|------|-------|--------|
| **F1** | Captura (modal, radio, textarea, badge) | ✅ COMPLETA — backend 9.0/10, frontend separado |
| **F2** | Painel admin (agregação, filtros, ranking) | ✅ COMPLETA — backend 9.0/10, frontend/gaveta separada |

**Próximos passos (fora de escopo desta ADR):**
- Frontend Fase 1: integração de modal na aba "Em atraso" + badge
- Frontend Fase 2: painel admin com charts (skill dataviz)
- Potencial Fase 3: webhooks de notificação ao admin quando novo atraso justificado

---

## Decisões do CEO Travadas (2026-07-09 — Não reabrí)

1. **Membro SÓ justifica.** Assignee cria/edita a justificativa da PRÓPRIA task e lê a própria vigente. Painel/agregação é **exclusivo do admin**. Membro NÃO vê justificativa de terceiros. → Aplicado em endpoints Fase 1, RBAC no controller.

2. **Dia de conclusão:** `dados.telemetry.doneAt` (primário, server-side, persiste) → `dados.v3.movedAt` (fallback, sempre populado) → `atualizadoEm` (último recurso, ruidoso). Verificado contra `TasksService.updateStatus`. → Aplicado em `overdue.util.ts`.

3. **Admin = org ADMIN (DVincula -161) SOMENTE.** Project MANAGER (-171) NÃO tem painel nem edita justificativa de terceiros. → Aplicado em endpoints, RBAC com `getOrgRole(userId, orgId)` (NUNCA `getProjectRole`).

4. **Badge = ambos:** global (`/me`) E por projeto (`?projectId=`). → Mantido em endpoint `/me/delay-justifications/pending-count`.

5. **Prazo estendido → justificativa permanece como HISTÓRICO** (não arquiva; supersede só em edição explícita). → Padrão de supersede em `$transaction`.

**Nenhuma questão em aberto restante.**

---

## Referências

- **Plano:** `workspace/plans/plan-eventos-justificativa-atraso-task1.md` (detalhe técnico completo)
- **Review:** `workspace/reviews/review-eventos-justificativa-atraso-fase1-task1.md` (Score 9.0/10, 3 desvios auditados/validados)
- **Código:** `src/delay-justifications/` (service, controller, DTOs, overdue.util, testes)
- **Seed:** `prisma/seeds/classes.seed.ts` (+9 DClasses)

---

**Redigido por:** Documenter Agent V2
**Aceito em:** 2026-07-09 (Implementer COMPLETA + Reviewer APPROVED 9.0/10)
**Status:** Aceito — decisões travadas, Fase 1 implementada e testada, pronto para Fase 2 (painel admin)
