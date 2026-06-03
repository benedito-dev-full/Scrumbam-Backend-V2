# ADR-V2-060: Remoção TOTAL da funcionalidade Sprint do backend (hard delete) — revoga a dimensão Sprint do ADR-V2-009

**Status:** Aceito
**Data:** 2026-06-03
**Decisores:** CEO + Strategist Agent V2
**Tags:** #V2 #F5 #sprints #remocao #hard-delete #frontend-hierarquia
**Revoga (parcialmente):** ADR-V2-009 (apenas a dimensão **Sprint**; a dimensão **Workflow Statuses** permanece vigente)

---

## Contexto e Problema

A funcionalidade **Sprint** foi removida 100% do **Scrumbam-Frontend-V2** (sessão anterior,
2026-06-03): DTOs, query-keys, mock do planner, pasta "Sprints" da árvore mock, copy de
marketing. A análise do frontend confirmou que Sprint **não é chamada em nenhum fluxo de UI**
— era código morto no front.

Manter Sprint **viva no backend** enquanto o frontend a removeu gera **incoerência front/back**:
endpoint genérico aceitando `idClasse=-400`, coluna `idSprint` em DTask, seed criando "Sprint 1"
default por projeto, dimensão sprint em velocity/forecast — tudo sem consumidor de UI.

O CEO decidiu **remover COMPLETAMENTE a funcionalidade Sprint do backend** (hard delete
explícito), alinhando back e front.

### Decisões do CEO (não reabrir):
- **Hard delete puro** — descartar dados de sprint **SEM backup/arquivamento** ao nível de schema.
- **Velocity → throughput por período** (semana default) — aceito conceitualmente.
- **Forecast é candidato a remoção total futura** (não usado no front) — remoção da dimensão
  sprint feita da forma mais simples que compila e passa testes (ver `forecast-candidato-remocao`).
- **Sprint 1 órfãs** dos projetos existentes → script de saneamento manual (CEO roda no deploy).

---

## O que o ADR-V2-009 dizia (e o que muda)

ADR-V2-009 estabeleceu **Sprints E Workflow Statuses como wrappers thin** sobre o endpoint
genérico `/tabelas` (Pilar 2): zero controller próprio, CRUD via
`/tabelas?idClasse=-400&dEntidadeId={projectId}` para sprints.

Este ADR-V2-060 **revoga apenas a dimensão Sprint** do ADR-V2-009. A dimensão **Workflow
Statuses continua vigente e inalterada** — `WorkflowStatusesModule` permanece como wrapper
thin legítimo sobre `/tabelas`.

---

## Decisão

Remoção da funcionalidade Sprint em **6 camadas**, executada em fases (1 commit por fase
para checkpoint de rollback):

### Camada 1 — Pontas (IA + Webhooks)
- `src/ai/`: system-prompt, context-builder, create-task tool — sem menção a sprint.
- `src/webhooks/constants/supported-events.ts`: removidos `sprint.started` / `sprint.closed`.

### Camada 2 — Métricas
- `src/dashboards/dashboards.service.ts`: velocity passa a ser **throughput por período**
  (caminho único; o fallback throughput já existia e foi promovido).
- `src/forecast/forecast.service.ts`: janela **rolling-window 30d** como fonte única;
  `getSprintThroughput` removido.
- `src/analytics/`, `src/reports/`: `historicalSprints` → `historicalPeriods`, labels PDF.

### Camada 3 — Endpoint + Tasks
- Removido `PUT /tasks/:id/sprint` (handler + `updateSprint` em service).
- Removido `idSprint`/`sprintId` de create/filter/select/mapper e dos DTOs de task.
- Deletado `update-task-sprint.dto.ts`.

### Camada 4 — Seed
- `prisma/seeds/classes.seed.ts`: removida a DClasse `-400 (SPRINT)`.
- `src/projects/seed-bootstrap.service.ts`: deixa de criar "Sprint 1" default por projeto
  (sentinela de idempotência permanece INBOX `-441`, não sprint).

### Camada 5 — Schema (migration destrutiva)
- `prisma/schema.prisma`: removida a coluna `idSprint BigInt?` e o `@@index([idSprint])` de DTask.
- Migration `20260603000000_remove_sprint_hard_delete`: `DROP INDEX` + `DROP COLUMN`
  (idempotente; down documentado inline). **DROP COLUMN é irreversível para os dados.**

### Camada 6 — Módulo + Governança (este ADR)
- Deletada a pasta `src/sprints/` (`sprints.module.ts` + `README.md`).
- Des-registrado `SprintsModule` de `src/app.module.ts`.
- Este ADR-V2-060 formaliza a remoção e revoga a dimensão Sprint do ADR-V2-009.
- `CLAUDE.md`: a Regra de Ouro de wrapper thin passa a referenciar apenas Workflow Statuses.

---

## Escopo: V2-específico (NÃO propagar ao template Devari-Core)

Esta remoção é **exclusiva do Scrumban-Backend-V2**. O conceito de Sprint como wrapper thin
permanece **válido como padrão** no template Devari-Core para projetos que queiram Sprints.
A decisão aqui é de **produto** (o Scrumban-V2 abandonou Sprint em favor de Blocos/Fases),
não uma mudança de arquitetura canônica.

O **range de DClasse -400..-419 fica liberado** no V2 para reuso futuro.

---

## Alternativas Consideradas

### Alternativa A (ESCOLHIDA): Hard delete total em 6 camadas faseadas
**Prós:** coerência front/back total; remove código morto; libera range -400..-419; simplifica
velocity/forecast (caminho único). **Contras:** migration destrutiva (dados de sprint perdidos —
aceito pelo CEO); revoga parte de um ADR vigente (formalizado aqui).

### Alternativa B: Soft-disable (esconder endpoint, manter schema/seed)
**Rejeitada.** Manteria coluna `idSprint`, DClasse -400 e "Sprint 1" default — dívida técnica
e incoerência persistente. O CEO pediu explicitamente hard delete.

### Alternativa C: Renomear Sprint → "Ciclo/Iteração"
**Rejeitada.** O CEO determinou que qualquer coisa relacionada a sprint pode ser **removida, não
renomeada**. O produto adotou Blocos/Fases como unidade de agrupamento.

---

## Consequências

### Positivas
- **Coerência front/back** restaurada (Sprint não existe em nenhuma das pontas).
- **Código morto eliminado** (endpoint, coluna, seed default, ramo sprint de métricas).
- **Velocity/Forecast simplificados** para caminho único (sem ramo sprint).
- **Range -400..-419 liberado** para reuso.
- **Zero tabela nova** mantido (apenas remoção; ADR-V2-001 respeitado).

### Negativas
- **Migration destrutiva** — dados de sprint perdidos (aceito; CEO faz `pg_dump` por segurança no deploy).
- **Revoga parte de ADR vigente** — exige disciplina de não recriar Sprint sem novo ADR.
- **Aplicação da migration pendente** — ambiente dev offline; CEO aplica em staging→prod no deploy.

---

## Implementação

| Fase | Camadas | Commit | Review |
|------|---------|--------|--------|
| 1 | IA + Webhooks (1) | `17c24ab` | 8.5/10 |
| 2 | Métricas (2) | `17c24ab` | 8.5/10 |
| 3 | Endpoint + Tasks (3) | `17c24ab` | 8.5/10 |
| 4 | Seed (4) | `e8dc53e` | 8.5/10 |
| 5 | Schema + Migration (5) | `392104e` | 9.0/10 |
| 6 | Módulo + Governança (6) | _(este commit)_ | — |

### Artefatos de deploy (CEO executa manualmente)
- `prisma/scripts/cleanup-sprint-orphans.ts` — soft-delete (`excluido=true`) das DTabelas
  `idClasse=-400` órfãs ("Sprint 1" default). Dry-run por padrão; `--apply` para efetivar.
- `prisma/migrations/20260603000000_remove_sprint_hard_delete/migration.sql` — aplicar em
  staging primeiro (`\d "DTask"` sem `idSprint`), depois prod, com `pg_dump` de backup antes.

---

## Validação (Enforçamentos)

| Validação | Como | Status |
|-----------|------|--------|
| `grep idSprint src/ --include=*.ts` vazio | inspeção | ✅ |
| `npx prisma generate` sem `idSprint` + build verde | tsc | ✅ |
| `createPhase` / `tenant-isolation.adversarial` preservados | specs | ✅ |
| Idempotência seed-bootstrap (sentinela INBOX -441) | inspeção | ✅ |
| Workflow Statuses (wrapper thin) intacto | inspeção | ✅ |

**Falhas de teste PRÉ-EXISTENTES** (não desta task, confirmado via git stash): arity drift
do ADR-V2-058 (`ProjectRefService` no construtor, specs desatualizadas) e 8 falhas de progresso
em `projects` (commit `7c23cd4`). Fora de escopo.

---

## Referências

- **Revoga (parcial):** ADR-V2-009 (dimensão Sprint; Workflow Statuses permanece)
- **Plan:** `workspace/plans/plan-core-remocao-sprint-hard-delete-task1.md`
- **Handoff:** `workspace/HANDOFF-remocao-sprint-2026-06-03.md`
- **ADRs correlatos:** ADR-V2-001 (zero tabela nova), ADR-V2-047/048/050 (Blocos/Fases via DTask)
- **Memórias:** `forecast-candidato-remocao`, `feedback_disciplina_ceo`

---

**Status:** Aceito (CEO 2026-06-03)
**Próximo passo:** Aplicar migration no deploy (staging→prod) com backup; rodar cleanup-sprint-orphans.ts --apply.
