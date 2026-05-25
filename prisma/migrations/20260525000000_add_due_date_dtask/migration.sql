-- D1 (Bloco D — integração frontend V2): adicionar dueDate tipado em DTask
-- Referência: docs/plano/integracao-frontend-v2/bloco-d.md
--
-- NÃO usa tabela nova (ADR-V2-001 preservado).
-- Coluna DateTime? em tabela estrutural canônica DTask.
-- Índice parcial WHERE excluido = false AND dueDate IS NOT NULL
-- melhora range scans de vencimento (dueDateToday, dueDateFrom/To).

-- AlterTable
ALTER TABLE "DTask" ADD COLUMN "dueDate" TIMESTAMPTZ;

-- CreateIndex (parcial — exclui registros deletados e sem data)
CREATE INDEX "DTask_dueDate_idx" ON "DTask"("dueDate") WHERE "excluido" = false AND "dueDate" IS NOT NULL;

-- Migration down (rollback manual — padrão V2)
-- DROP INDEX IF EXISTS "DTask_dueDate_idx";
-- ALTER TABLE "DTask" DROP COLUMN IF EXISTS "dueDate";
