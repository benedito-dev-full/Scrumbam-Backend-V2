# ADR-V2-047: Fases/Blocos via `DTask.idPai` (hierarquia auto-referencial), sem tabela nova

**Status:** Proposed
**Data:** 2026-05-21
**Decisores:** CEO + Strategist Agent V2
**Tags:** #V2 #pós-F5 #entidades #estrutural #hierarquia

---

## Contexto e Problema

Projetos reais do Scrumban tendem a operar com 300–500 tasks vivas em paralelo. O acompanhamento macro fica inviável apenas com lista plana de tasks: gestores precisam de **agrupamento em Fases/Blocos** (ex.: "Discovery", "MVP", "Hardening") com métrica de **% de conclusão agregada**, sem perder a granularidade da task individual.

Requisitos materializados a partir da call de 2026-05-20 com o CEO:

1. Modelar **Fases como entidade agrupadora** que contém tasks (folhas) e/ou outras Fases (sub-fases).
2. **Hierarquia infinita** (Projeto → Bloco → Fase → Subfase → Task, sem ceiling fixo no schema).
3. Cada task pertence a **no máximo 1 Fase** (cardinalidade 1:1 — não N:N).
4. **% conclusão** calculada por agregação recursiva sobre descendentes.
5. **Frontend recursivo** (1 componente árvore único, renderiza Fase e Task polimorficamente).
6. Preservar restrição **ADR-V2-001 (zero tabela nova)**.

Decisões CEO confirmadas na mesma call (todas vinculantes para v1):

| Q# | Pergunta | Decisão CEO |
|----|----------|-------------|
| Q1 | Fase é DProject de DProject? | NÃO — Fase é DTask agrupadora |
| Q2 | Profundidade máxima fixa? | NÃO — hierarquia infinita conceitual, soft-limit operacional em service |
| Q3 | Task em múltiplas fases? | NÃO — 1 task = 1 fase máx (cardinalidade 1:1) |
| Q4 | Cálculo de % conclusão? | CTE recursiva PostgreSQL em v1 (sem cache materializado) |
| Q5 | Frontend? | Componente árvore recursivo único |
| Q6 | Cascade delete de fase com filhas? | Soft-delete recursivo configurável, com audit em DEvento |

Estado atual relevante do código (verificado em `prisma/schema.prisma:347-380` e plano-mestre §3.1):

- DTask **não tem** coluna `idPai`, nem relations `parent`/`children`.
- DClasse `SCRUMBAN_TASK` (-154) já existe como folha em `ENTIDADES` (-37).
- Range **-200..-299 está reservado e livre** para especializações de DTask (MEMORY.md L120; plano-mestre §3.1 — seção "Faixas reservadas").
- Validador `validateHierarchy()` já cobre os invariantes de DClasse (sem necessidade de adaptação).

---

## Alternativas Consideradas

### Opção A — Hierarquia em DProject (DProject de DProject)

**Descrição:** Modelar Fase como um DProject filho com `idEstab` apontando para o projeto-pai. A árvore seria `DProject → DProject → DTask`.

**Prós:**
- DProject já tem `idClasse` próprio e suporta soft-delete + audit.
- Separação semântica forte entre "agrupador" e "task executável".

**Contras:**
- **Fase NÃO é um projeto.** DProject carrega responsabilidades específicas — `repoUrl` (ADR-V2-043), configuração de automation, vínculos com agents via DVincula -185 (F13). Forçar fase a herdar tudo isso polui o modelo.
- Quebra o mapeamento mental do frontend: a UI atual trata projeto como container raiz e tasks como cards do board. Um "subprojeto" exige UX duplicada.
- Hierarquia limitada a 2 níveis efetivos sem reformular `DProject.idEstab` (que hoje aponta para organização, não para outro projeto).
- Frontend precisaria de 2 componentes distintos para árvore (Project + Task), violando o requisito de "componente árvore único".

**Status:** ❌ REJEITADA por desalinhamento semântico.

---

### Opção B — Tabela DPhase nova (modelagem tradicional)

**Descrição:** Criar tabela `DPhase(chave, idProject, idPai, nome, status, dados)` com FK ortodoxa de `DTask.idPhase → DPhase.chave`.

**Prós:**
- Modelagem ORM tradicional, explícita, com FK no schema.
- Queries diretas via JOIN sem CTE.

**Contras:**
- **Viola ADR-V2-001** (zero tabela nova) frontalmente. Hook `enforce-canonical-tables.sh` bloqueia mecanicamente.
- Adiciona 18ª tabela ao canônico — destrói o invariante das 17.
- Custo de adapter perpétuo: endpoints próprios, services próprios, DTOs próprios, seeds próprios.
- Frontend obriga a 2 componentes (Phase + Task) ao invés de 1 recursivo.
- Quebra portabilidade upstream (template Devari-Core não tem DPhase — projeto não-Scrumban herdaria tabela inútil).

**Status:** ❌ REJEITADA por violação de ADR-V2-001.

---

### Opção C — DVincula `PHASE_TASK_LINK` (relação N:N)

**Descrição:** Manter DTask plana. Criar DClasse `PHASE_TASK_LINK` (ex.: -201) e usar DVincula com `idLocEscritu=phaseId`, `idEntidade=taskId` para vincular task↔fase. Cardinalidade N:N nativa.

**Prós:**
- Reutiliza tabela canônica DVincula (zero coluna nova em DTask).
- N:N nativo (task em múltiplas fases) — flexibilidade máxima.
- Pattern já validado em V2 (ex.: PROJECT_TEAM_LINK -182, FOLDER_PROJECT_LINK -183).

**Contras:**
- **N:N não é requisito do CEO** (Q3: 1 task = 1 fase máx). Adiciona complexidade desnecessária.
- Query de % conclusão precisa de JOIN extra em DVincula a cada nível de recursão — CTE fica mais cara.
- Frontend recursivo fica ambíguo: ao montar a árvore, qual vínculo é "o pai canônico"? Precisaria de regra de desambiguação (ex.: vínculo mais antigo) que adiciona invariante implícito.
- Cascade delete fica menos direto (precisa atualizar N DVinculas vs uma coluna FK).

**Status:** ❌ REJEITADA POR AGORA. Reabordagem futura: se v2 introduzir requisito de task multi-fase, adicionar DVincula `PHASE_TASK_LINK` **em paralelo** a `idPai` (idPai = fase primária canônica; DVincula = fases adicionais).

---

### Opção D — `DTask.idPai → DTask.chave` (self-FK) — ESCOLHIDA

**Descrição:** Adicionar uma única coluna nullable `idPai BigInt?` em DTask, com FK self-reference e índices apropriados. Criar DClasse `PHASE` (-200) como filho de `ENTIDADES` (-37), agrupamento=true. Fases são DTasks com `idClasse=-200`; tasks executáveis são DTasks com `idClasse=-154` (SCRUMBAN_TASK). A árvore se forma naturalmente: qualquer DTask pode ter pai, qualquer DTask pode ter filhos.

```
DClasse:
  -200 PHASE   (idPai=-37 ENTIDADES, agrupamento=true)

DTask:
  chave     BigInt PK
  idClasse  BigInt  → -200 (PHASE) ou -154 (SCRUMBAN_TASK)
  idPai     BigInt? → DTask.chave (self-FK, ON DELETE NoAction)
  idProject BigInt? → DProject.chave (fase pertence a 1 projeto)
  ... (campos existentes)

Índices:
  @@index([idPai])
  @@index([idPai, excluido])
```

**Prós:**
- ✅ **ZERO tabela nova** (ADR-V2-001 respeitado integralmente — apenas 1 coluna nullable em tabela canônica).
- ✅ **Polimorfismo natural** alinhado a `DClasse.idPai → DClasse.chave` (mesmo padrão familiar à base).
- ✅ **Hierarquia infinita gratuita** (Projeto → Bloco → Fase → Subfase → Task), sem ceiling no schema.
- ✅ **Cardinalidade 1:1 garantida pela natureza FK** (uma coluna escalar não pode apontar para dois pais).
- ✅ **Frontend recursivo direto** — 1 componente árvore renderiza qualquer DTask (Fase ou Task) polimorficamente.
- ✅ **CTE recursiva PostgreSQL** é padrão maduro, performance excelente até ~10k descendentes.
- ✅ **Audit/soft-delete nativos** — DTask já tem `excluido` e emite DEvento; sem trabalho extra.
- ✅ **Migration trivial** — `ADD COLUMN nullable` é instantâneo em Postgres (sem table rewrite).
- ✅ **Portabilidade upstream** — coluna nullable não quebra projetos que não usam (candidato a feature opcional do template Devari-Core em F16).

**Contras / trade-offs:**
- Cardinalidade 1:1 é **regra natural do schema** (não validação de service como em DVincula), mas a regra de "Fase pai e Task filha pertencem ao mesmo projeto" é **invariante de service** (não há FK composta no banco).
  - Mitigação: `validateProjectConsistency(taskId, newIdPai)` no service, com teste unitário cobrindo.
- CTE recursiva em fase muito grande (>5k descendentes) pode degradar — não é problema em v1, mas exige observabilidade.
  - Mitigação: profilar em F8; se p95 > 300ms, materializar `dados.metrics` no nó pai com invalidação por hook de service (v2).
- Profundidade descontrolada é vetor de DoS (atacante criando 10000 níveis).
  - Mitigação: **soft-limit `MAX_PHASE_DEPTH=20`** configurável por env, validado tanto no `validateNoCycle` quanto na própria CTE (`WHERE depth < 20`).
- Cascade delete de fase com 500 tasks precisa ser explícito na UX.
  - Mitigação: `DELETE /tasks/:id?cascade=true` exige flag; service retorna count de afetados; DEvento -489 audit-genérico registra lista de chaves removidas.

**Status:** ✅ **ESCOLHIDA**.

---

### Comparativo direto

| Critério | A (DProject) | B (DPhase) | C (DVincula N:N) | D (idPai self-FK) |
|----------|--------------|------------|------------------|-------------------|
| ADR-V2-001 (zero tabela nova) | ✅ | ❌ | ✅ | ✅ |
| Cardinalidade 1:1 (Q3 CEO) | ✅ | ✅ | ⚠️ (service) | ✅ (schema) |
| Hierarquia infinita (Q2 CEO) | ❌ | ✅ | ✅ | ✅ |
| Frontend componente único (Q5 CEO) | ❌ | ❌ | ⚠️ | ✅ |
| Performance CTE | n/a | n/a | ⚠️ (JOIN extra) | ✅ |
| Custo de migration | médio | alto | baixo | baixo |
| Portabilidade upstream | médio | baixo | alto | alto |
| Veredicto | ❌ | ❌ | ⏸️ (v2) | ✅ |

---

## Decisão

**Implementar Opção D: `DTask.idPai → DTask.chave` (self-FK) + DClasse `PHASE` (-200).**

### Modelagem técnica

**Schema (`prisma/schema.prisma` — DTask):**

```prisma
model DTask {
  // ... campos existentes
  idPai    BigInt?
  parent   DTask?  @relation("TaskHierarchy", fields: [idPai], references: [chave], onDelete: NoAction, onUpdate: NoAction)
  children DTask[] @relation("TaskHierarchy")

  @@index([idPai])
  @@index([idPai, excluido])
}
```

**Seed (`prisma/seeds/classes.seed.ts`):**

```typescript
esp(-200, 'PHASE', 'Fase (agrupador de tasks)', -37, true)
```

- `idPai=-37` (ENTIDADES) — mesmo pai de `SCRUMBAN_TASK` (-154).
- `agrupamento=true` — sinaliza que esta DClasse representa agrupador (compatível com convenção V2).

### Regras de negócio (validadas em service)

1. **1 task tem 0 ou 1 idPai** — garantido pelo schema (coluna escalar).
2. **Fase pai e Task filha pertencem ao MESMO `idProject`** — invariante de service (`validateProjectConsistency`).
3. **Sem ciclos** — `validateNoCycle(taskId, newIdPai)` percorre ancestrais (máximo `MAX_PHASE_DEPTH=20`) antes de aceitar update.
4. **Profundidade máxima soft-limit 20** — guardrail na CTE (`WHERE depth < 20`) e no validador.
5. **Cascade soft-delete configurável** — `DELETE /tasks/:id?cascade=true` (default `true` se `idClasse=PHASE`); audit em DEvento -489 com lista completa de chaves removidas.

### Métricas (% conclusão)

Cálculo via **CTE recursiva PostgreSQL** em v1 (sem cache materializado):

```sql
WITH RECURSIVE descendants AS (
  -- Anchor (filhas diretas)
  SELECT chave, "idStatus", "idClasse", 0 AS depth
  FROM "DTask"
  WHERE "idPai" = $1 AND excluido = false

  UNION ALL

  -- Recursive (filhas das filhas) — coluna depth propagada para guardrail
  SELECT t.chave, t."idStatus", t."idClasse", d.depth + 1
  FROM "DTask" t
  INNER JOIN descendants d ON t."idPai" = d.chave
  WHERE t.excluido = false AND d.depth < 20
)
SELECT
  COUNT(*) FILTER (WHERE "idClasse" != -200) AS total,
  COUNT(*) FILTER (WHERE "idStatus" = -444)  AS done,
  COUNT(*) FILTER (WHERE "idStatus" = -445)  AS failed,
  COUNT(*) FILTER (WHERE "idStatus" = -443)  AS in_progress
FROM descendants;
```

> **Nota:** a coluna `depth` precisa aparecer tanto no termo *anchor* quanto
> no termo *recursive* da CTE. O guardrail `WHERE d.depth < 20` referencia
> a coluna propagada — sem essa propagação, o SQL é inválido em PostgreSQL.
> Mesmo padrão da CTE de tree no plano (§4, query "3. CTE recursiva").

Cache materializado em `dados.metrics` é **expansão de v2** (Fase 6 do plano, adiada).

### Eventos

- Reusar **DEvento -497 (TASK_CREATED)** e **DEvento -498 (TASK_STATUS_CHANGED)** para fases (com `metaDados._meta.taskKind=PHASE`).
- Reusar **DEvento -489 (AUDIT_GENERIC)** para cascade soft-delete (com `metaDados._meta.action=PHASE_CASCADE_DELETE`).
- **NÃO criar evento dedicado** `PHASE_LIFECYCLE` em v1 (conformidade com ADR-V2-026).

---

## Consequências

### Positivas

1. **Reutilização dos 3 Pilares:**
   - Pilar 1 (Engine): zero envolvimento — cadastro estrutural via Prisma direto, conforme ADR-V2-005.
   - Pilar 2 (Endpoints genéricos): `/tasks?idClasse=PHASE` e `?idPai=X` reutilizam controller existente; rotas especializadas `/tasks/:id/tree` e `/tasks/:id/metrics` justificadas (CTE não cabe em listagem).
   - Pilar 3 (Seed): 1 DClasse nova no range reservado -200..-299; sem mudança no validador.

2. **Arquitetura limpa:**
   - ZERO tabela nova (ADR-V2-001 respeitado).
   - Polimorfismo natural alinhado ao padrão `DClasse.idPai → DClasse.chave`.

3. **Extensibilidade futura sem migration:**
   - Nível adicional de hierarquia (BLOCK, MILESTONE, EPIC): apenas nova DClasse no seed.
   - Task em múltiplas fases (N:N): adicionar DVincula `PHASE_TASK_LINK` **em paralelo** a `idPai`, sem quebrar v1.
   - Dependências entre fases: nova DClasse de DVincula (ex.: -201 PHASE_DEPENDENCY).

4. **Frontend simplificado:**
   - 1 componente árvore recursivo único renderiza Fase e Task polimorficamente.
   - Reaproveita pattern já existente para árvore de DClasse hierárquica.

5. **Portabilidade upstream:**
   - Coluna `idPai` nullable não quebra projetos que não usam.
   - Candidato a feature opcional do template Devari-Core em F16 (PR upstream).

### Negativas / trade-offs

1. **Cardinalidade 1:1 é regra natural do schema**, mas:
   - "Fase pai e Task filha mesmo projeto" é invariante de service (sem FK composta).
   - **Mitigação:** `validateProjectConsistency()` com teste unitário dedicado.

2. **CTE recursiva em fases muito grandes (>5k descendentes) pode degradar:**
   - p95 esperado < 200ms até 1000 tasks; profilar em F8.
   - **Mitigação:** cache materializado em `dados.metrics` com invalidação por hook (v2 — Fase 6 do plano).
   - **Decisão explícita — NÃO usar trigger de banco para invalidação de cache:** quando o v2 implementar materialização de `dados.metrics`, a invalidação será feita em **service** (hook em `tasksService.updateStatus()` que percorre ancestrais e zera `dados.metrics`), **nunca via trigger SQL**. Justificativa: (a) trigger acopla regra de negócio ao schema, dificultando portabilidade upstream (template Devari-Core); (b) trigger é invisível ao debug — falhas silenciosas vs exceção propagada do service; (c) service-level é testável com Jest e reversível por feature flag; (d) trigger torna o rollback da Fase 6 cirúrgico (precisa drop trigger + drop function) ao invés de simples desligamento de hook.

3. **Profundidade descontrolada é vetor de DoS:**
   - **Mitigação:** soft-limit `MAX_PHASE_DEPTH=20` configurável por env; aplicado tanto no `validateNoCycle` quanto na CTE.

4. **Cascade soft-delete pode apagar 500+ tasks inadvertidamente:**
   - **Mitigação:** flag explícita `?cascade=true`; service retorna `affectedCount`; DEvento -489 audit-genérico registra todas as chaves removidas; frontend exige confirmação modal.

5. **Migration `CREATE INDEX` em tabela DTask grande pode bloquear writes em prod:**
   - **Mitigação:** usar `CREATE INDEX CONCURRENTLY` em ambiente produtivo (Implementer gera SQL manual se `prisma migrate` não suportar nativamente).

---

## Conformidade com regras canônicas

| Regra / ADR | Conformidade | Justificativa |
|-------------|:------------:|---------------|
| **ADR-V2-001** (zero tabela nova) | ✅ | Apenas 1 coluna nullable em tabela canônica existente (DTask). Hook `enforce-canonical-tables.sh` não bloqueia adição de coluna em tabela existente. |
| **ADR-V2-003** (RBAC duplo via DVincula) | ✅ | Fases herdam permissões do projeto via DVincula PROJECT_USER_LINK (-171/-172/-173). Sem RBAC próprio. |
| **ADR-V2-005** (Engine apenas em DPedido -300) | ✅ | Fases são cadastro estrutural — Prisma direto via service. Engine não se envolve. |
| **ADR-V2-009** (wrappers thin) | ✅ | `GET /tasks?idClasse=PHASE` e `?idPai=X` reutilizam `/tasks` existente. Rotas `/tasks/:id/tree` e `/tasks/:id/metrics` são justificadas (CTE recursiva não cabe em listagem) — sem necessidade de `/phases` controller dedicado. |
| **ADR-V2-019** (seed monolítico) | ✅ | DClasse PHASE adicionada diretamente em `prisma/seeds/classes.seed.ts`, sem fragmentar o seed. |
| **ADR-V2-026** (AUDIT_GENERIC -489) | ✅ | Fases reutilizam DEvento -497 (TASK_CREATED), -498 (TASK_STATUS_CHANGED) e -489 (AUDIT_GENERIC). Sem evento dedicado em v1. |
| **ADR-V2-027** (lifecycle action via `metaDados._meta.action`) | ✅ | Cascade delete usa `metaDados._meta.action=PHASE_CASCADE_DELETE` (pattern já validado). |
| **Hook `enforce-canonical-tables.sh`** | ✅ | Não há tabela nova — apenas coluna. Hook não bloqueia. |
| **Hook `block-destructive-commands.sh`** | ✅ | Migration usa `ADD COLUMN` (não destrutivo). Rollback testado. |

---

## Implementação faseada (referência ao plano)

Plano detalhado: **[`workspace/plans/plan-entidades-fases-via-dtask-idpai-task1.md`](../../workspace/plans/plan-entidades-fases-via-dtask-idpai-task1.md)**.

Síntese das 10 fases (esforço total ~40h v1 com buffer 20%):

| Fase | Escopo | Esforço |
|------|--------|---------|
| **0** | ADR-V2-047 (este documento) — bloqueante, antes de qualquer código | 1.2h |
| **1** | Seed: adicionar DClasse PHASE (-200); bump COUNTS | 1.2h |
| **2** | Migration: `DTask.idPai` + self-FK + 2 índices; up/down testados | 3.6h |
| **3** | Service: `validateNoCycle`, `validateProjectConsistency`, cascade soft-delete | 6h |
| **4** | Endpoints: estender `/tasks` (filtros `idPai`, `idClasse`); criar `/tasks/:id/tree` e `/tasks/:id/metrics` | 7.2h |
| **5** | CTE recursiva: `PhaseTreeService` + `PhaseMetricsService` (zero N+1) | 7.2h |
| **6** | Cache em `dados.metrics` — **ADIADA PARA v2** (profilar em F8 antes) | (v2) |
| **7** | MCP tools: `list_phases`, `get_phase_tree` | 2.4h |
| **8** | Webhooks: `phase.created/updated/deleted/completed` | 2.4h |
| **9** | V3 Intentions + Flow Metrics breakdown por fase + Telegram | 4.8h |
| **10** | Testes E2E: árvore com 100 nós, métricas com 300 tasks, profundidade 21 rejeitada, ciclo rejeitado, cross-project rejeitado, N+1 zero | 4.8h |

Caminho crítico sequencial: 0 → 1 → 2 → 3 → 5 → 4 → 10. Paralelismos possíveis após Fase 5 entregue: 7 ∥ 8 ∥ 9 (~5h reais ao invés de 14h sequencial).

---

## Genericidade upstream (template Devari-Core)

O padrão `DTask.idPai` é candidato natural a **feature do template Devari-Core**:

- Hierarquia auto-referencial em DTask é reutilizável em qualquer projeto de gestão (obras, tickets, OKRs, sub-tarefas).
- Coluna nullable + relations nomeadas não quebram projetos-filhos que não usam (compatibilidade reversa total).
- Permite ao template oferecer árvore de tasks "out of the box" sem migrations adicionais.

**Plano de upstream:**

1. Implementar e estabilizar no V2 (este plano — Fases 0–10).
2. Em **F16 (Handoff/Doc)**, propor PR upstream ao Devari-Core adicionando:
   - Coluna `idPai BigInt?` em DTask com self-FK + índices.
   - DClasse `PHASE` (-200) opcional no seed-template.
   - Documentação do pattern (CTE recursiva, `validateNoCycle`, soft-limit profundidade).
3. Documentar como **padrão opcional** — não obrigatório para projetos que não usam hierarquia.

Esta etapa é **independente do V2** (não bloqueia entrega) e fica registrada como melhoria estratégica de longo prazo.

---

## Status do ADR

**Proposed** (2026-05-21).

Será movido para **Accepted** após:

1. Reviewer Agent V2 aprovar o ADR com score ≥ 7.0 (validate-review-score.sh).
2. Merge da branch `feature/dtask-fases-via-idpai` em `main`.
3. Documenter Agent V2 atualizar `docs/auditoria/00-AUDITORIA-CONSOLIDADA.md` e `docs/plano/00-PLANO-MESTRE.md §3.2` registrando ADR-V2-047 como ratificado.

Em caso de NEEDS_CHANGES ou REJECTED do Reviewer:

- Strategist revisa premissas.
- Implementer revisa redação (ADR é doc, não tem build — Reviewer avalia clareza, completude, conformidade).
- CEO consultado se 3 rejeições consecutivas.

---

## Links relacionados

- [ADR-V2-001 — Zero tabela nova](./ADR-V2-001-17-tabelas-canonicas.md) — restrição central respeitada
- [ADR-V2-003 — RBAC duplo via DVincula](./ADR-V2-003-rbac-dvíncula.md) — RBAC herdado do projeto
- [ADR-V2-005 — Engine apenas em DPedido -300](./ADR-V2-005-engine-execucao-claude.md) — Engine não se envolve em fases
- [ADR-V2-009 — Wrappers thin](./ADR-V2-009-wrappers-thin.md) — `/tasks` reutilizado, sem `/phases` dedicado
- [ADR-V2-019 — Seed monolítico](./ADR-V2-019-seed-monolitico.md) — `classes.seed.ts` direto
- [ADR-V2-026 — AUDIT_GENERIC -489](./ADR-V2-026-audit-generic-dclass.md) — eventos reutilizados
- [ADR-V2-027 — Project lifecycle via `metaDados._meta.action`](./ADR-V2-027-project-org-lifecycle.md) — pattern para cascade audit
- [ADR-V2-FOLDERS-001 — Folders via DEntidade + DVincula](./ADR-V2-FOLDERS-001-folder-via-dentidade-dvincula.md) — precedente de modelagem polimórfica sem tabela nova
- [Plano detalhado da iniciativa](../../workspace/plans/plan-entidades-fases-via-dtask-idpai-task1.md)

---

**Maintained by:** Devari Tecnologia
**Versão:** 1.0
**Última atualização:** 2026-05-21
