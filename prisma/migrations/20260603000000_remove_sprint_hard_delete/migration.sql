-- Remoção COMPLETA de Sprint (hard delete) — Task 1 pós-F9 / ADR-V2-060.
-- Plano: workspace/plans/plan-core-remocao-sprint-hard-delete-task1.md (Fase 5).
-- Revoga ADR-V2-009 (Sprints como wrapper thin). V2-específico (não propaga ao template).
--
-- MIGRATION DESTRUTIVA: dropa a coluna `idSprint` e seu índice de DTask.
-- O dado `idSprint` é DESCARTADO (hard delete confirmado pelo CEO — Q2 do plano).
--
-- NÃO usa tabela nova (ADR-V2-001 preservado). DTask permanece canônica.
-- A coluna foi criada na migration inicial 20260508204157_initial_canonical.
--
-- ⚠️ BACKUP OBRIGATÓRIO ANTES DO CUTOVER EM PROD (devari-migration-protocol):
--   pg_dump -t '"DTask"' <db> > dtask_backup_pre_sprint_drop.sql
-- O DROP COLUMN remove permanentemente os valores de idSprint. Down recria a
-- coluna VAZIA (NULL) + índice para destravar rollback de schema, mas os dados
-- de sprint NÃO retornam (hard delete por definição).
--
-- Idempotência: IF EXISTS garante re-run sem erro.

-- DropIndex
DROP INDEX IF EXISTS "DTask_idSprint_idx";

-- AlterTable
ALTER TABLE "DTask" DROP COLUMN IF EXISTS "idSprint";

-- Migration down (rollback manual — padrão V2; recria coluna VAZIA + índice):
-- ALTER TABLE "DTask" ADD COLUMN "idSprint" BIGINT;
-- CREATE INDEX "DTask_idSprint_idx" ON "DTask"("idSprint");
