-- Migration: add_table_fields_dproject
-- Fase 1 (Task 1 — Colunas Customizáveis por Lista) / Roadmap-produto F5 Table View.
--
-- Adiciona a coluna ADITIVA NULLABLE "tableFields" (JSONB) em DProject, espelhando
-- a coluna canônica DClasse.tableFields. Guarda o schema das colunas customizáveis
-- de uma Lista (idClasse=-352): objeto { version, columns[] }.
--
-- ADITIVA + NULLABLE: não toca dado existente, não altera relação/índice.
-- ZERO tabela nova (ADR-V2-001 — coluna ≠ tabela). Precedente: repoUrl (ADR-V2-043).
-- Convenção de nomenclatura: camelCase direto, igual a "dados", "repoUrl" e
-- DClasse."tableFields" (sem @map / snake_case neste schema).
--
-- Idempotência: ADD COLUMN IF NOT EXISTS (re-run = no-op).
-- Rollback: ver companion file `down.sql` no mesmo diretório (manual; Prisma
-- não aplica down automaticamente).

BEGIN;

-- AlterTable (nullable — não quebra inserts antigos; IF NOT EXISTS p/ idempotência)
ALTER TABLE "DProject" ADD COLUMN IF NOT EXISTS "tableFields" JSONB;

COMMIT;
