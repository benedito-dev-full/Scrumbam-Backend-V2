-- Rollback: add_repo_url_to_dproject (DOWN)
-- ADR-V2-043 — script manual para reverter a migration UP.
--
-- IMPORTANTE: Prisma NÃO executa este arquivo automaticamente.
-- Para reverter em staging/prod, executar manualmente:
--   psql $DATABASE_URL -f prisma/migrations/20260515151000_add_repo_url_to_dproject/migration.down.sql
-- E depois remover/marcar a entrada em _prisma_migrations (ou usar
-- `prisma migrate resolve --rolled-back 20260515151000_add_repo_url_to_dproject`).
--
-- Idempotência:
--   * Restaura dados.gitRepo APENAS para registros com repoUrl NÃO-NULO
--     e que NÃO já tinham gitRepo no JSON (não sobrescreve).
--   * Drop com IF EXISTS — re-run = no-op.

BEGIN;

-- 1. Garantir que dados.gitRepo está populado para registros que só
--    tinham repoUrl (caso o frontend já tenha começado a escrever só
--    na coluna). Idempotente — só preenche se ainda não tem.
--    Usa to_jsonb sobre o texto para serializar corretamente como JSON string.
--
-- Wrap em DO bloco para que a referência à coluna "repoUrl" só seja
-- resolvida em EXECUTE — assim re-run após drop não falha por parse.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'DProject'
      AND column_name = 'repoUrl'
  ) THEN
    EXECUTE $sql$
      UPDATE "DProject"
      SET dados = jsonb_set(
        COALESCE(dados, '{}'::jsonb),
        '{gitRepo}',
        to_jsonb("repoUrl"::text)
      )
      WHERE "repoUrl" IS NOT NULL
        AND (
          dados IS NULL
          OR NOT (dados ? 'gitRepo')
          OR dados->>'gitRepo' IS NULL
          OR length(dados->>'gitRepo') = 0
        )
    $sql$;
  END IF;
END $$;

-- 2. Drop da coluna (IF EXISTS — idempotente).
ALTER TABLE "DProject" DROP COLUMN IF EXISTS "repoUrl";

COMMIT;
