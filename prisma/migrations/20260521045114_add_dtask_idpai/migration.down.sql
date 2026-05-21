-- Rollback: add_dtask_idpai
-- ADR-V2-047 — desfaz Fases via DTask.idPai
--
-- ATENÇÃO: não executado automaticamente pelo Prisma. Script manual
-- para staging/prod caso seja necessário reverter. Em desenvolvimento,
-- use uma nova migration "drop_dtask_idpai" se precisar reverter no
-- histórico tracked.
--
-- Segurança de dados:
--   * `idPai` é NULLABLE — DROP COLUMN não perde linhas (apenas perde
--     o vínculo pai/filho). Tasks com idPai populado ficarão órfãs
--     (sem hierarquia), mas continuarão existindo.
--   * Antes de rodar em produção, considere export prévio das
--     hierarquias: `SELECT chave, idPai FROM "DTask" WHERE "idPai" IS NOT NULL;`

BEGIN;

-- 1. Drop FK primeiro (índice DTask_idPai_fkey criado implicitamente
--    pelo CONSTRAINT desaparece junto).
ALTER TABLE "DTask" DROP CONSTRAINT IF EXISTS "DTask_idPai_fkey";

-- 2. Drop índices explícitos.
DROP INDEX IF EXISTS "DTask_idPai_excluido_idx";
DROP INDEX IF EXISTS "DTask_idPai_idx";

-- 3. Drop coluna (perde vínculos, preserva linhas).
ALTER TABLE "DTask" DROP COLUMN IF EXISTS "idPai";

COMMIT;
