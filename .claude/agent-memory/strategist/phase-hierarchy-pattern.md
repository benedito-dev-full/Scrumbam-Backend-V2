---
name: phase-hierarchy-pattern
description: Padrao de hierarquia auto-referencial via idPai em DTask para Fases/Blocos. ADR-V2-047. Reutilizar quando aparecer requisito de agrupamento polimorfico hierarquico em qualquer tabela canonica.
metadata:
  type: project
---

# Hierarquia de Fases via DTask.idPai (Plan 2026-05-20)

**Decisao arquitetural:** Fases/Blocos sao DTask agrupadora (idClasse=PHASE -200)
com auto-referencia `DTask.idPai → DTask.chave`. Plano: `workspace/plans/plan-tasks-fases-via-dtask-idpai-task1.md`.

**Why:** ZERO tabela nova (ADR-V2-001). Mesmo padrao polimorfico de `DClasse.idPai → DClasse.chave` ja validado em `validateHierarchy()`. Hierarquia infinita gratis. Frontend = 1 componente recursivo.

**How to apply:** Quando aparecer requisito de "agrupar coisas em containers que podem conter outros containers" em tabela canonica (DTask, DProject, DEntidade, DTabela), aplicar self-FK + idClasse agrupador antes de propor tabela nova ou DVincula. Sempre incluir:
1. `validateNoCycle` em service (CTEs crasham com ciclo).
2. Soft-limit de profundidade (default 20) na CTE e no service (DoS protection).
3. `onDelete: NoAction` — cascata logica em service via soft-delete, nunca em FK.
4. CTE recursiva PostgreSQL com `WHERE excluido=false` em ambos os ramos.
5. Cache de metricas em `dados.metrics` so se profiling mostrar gargalo (>200ms p95).
6. Validacao de consistencia de escopo (ex: filha e pai devem ter mesmo idProject).

**Range reservado:** -200..-299 para DTask especializacoes (MEMORY.md L120, plano-mestre §3.1). Usado: -200 PHASE. Livres: -201..-299.

Linked: [[adr-v2-047-fases-via-dtask-idpai]] (a redigir).
