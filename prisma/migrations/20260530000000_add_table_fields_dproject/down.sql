-- Rollback (down) for: add_table_fields_dproject
-- Remove a coluna aditiva nullable "tableFields" de DProject.
-- Seguro: coluna é nullable e recém-adicionada (sem dados de produção dependentes).
-- Prisma NÃO aplica down.sql automaticamente; usar para teste manual de rollback:
--   psql "$DATABASE_URL" -f prisma/migrations/20260530000000_add_table_fields_dproject/down.sql

BEGIN;

-- AlterTable (rollback)
ALTER TABLE "DProject" DROP COLUMN IF EXISTS "tableFields";

COMMIT;
