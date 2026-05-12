-- Sub-tarefa 2.3 (plan-automation-backend-side-task2): índice expression
-- único em DProject.dados->>'slug' para garantir unicidade do projectSlug
-- (ADR-V2-030). Parcial (apenas projetos não-excluídos) para reduzir custo
-- de manutenção e permitir reuso de slugs após soft-delete.
--
-- Migration idempotente: `IF NOT EXISTS` permite re-run sem erro. Sem DDL
-- de tabela nova (ADR-V2-001 respeitado).
--
-- Rollback (manual, não-destrutivo):
--   DROP INDEX IF EXISTS "dproject_slug_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "dproject_slug_unique"
  ON "DProject" ((LOWER("dados"->>'slug')))
  WHERE "excluido" = false;
