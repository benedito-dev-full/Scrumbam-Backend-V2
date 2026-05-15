-- Migration: add_repo_url_to_dproject
-- ADR-V2-043 (exceção autorizada ao ADR-V2-001):
-- Promove DProject.dados->>'gitRepo' (Json solto) para coluna estrutural tipada
-- repoUrl VARCHAR(512). Mantém o campo Json populado em paralelo (compat com
-- frontend antigo) — remoção do Json virá em migration separada após release N+1.
--
-- Idempotência:
--   * UP: ADD COLUMN IF NOT EXISTS + backfill com WHERE repoUrl IS NULL.
--     Rodar 2x = no-op (segunda execução: coluna existe, UPDATE matcha 0 linhas).
--
-- Rollback: ver companion file `migration.down.sql` no mesmo diretório
-- (não executado automaticamente pelo Prisma — script manual para staging/prod
-- caso seja necessário reverter).

BEGIN;

-- 1. Adicionar coluna (nullable — não quebra inserts antigos).
--    IF NOT EXISTS garante idempotência se a coluna já existir (re-run).
ALTER TABLE "DProject" ADD COLUMN IF NOT EXISTS "repoUrl" VARCHAR(512);

-- 2. Backfill idempotente: copia DProject.dados->>'gitRepo' para repoUrl
--    APENAS onde repoUrl IS NULL (re-run não duplica nem sobrescreve).
--    Filtra também por tamanho ≤ 512 para evitar truncamento silencioso
--    (registros com URLs absurdamente longas ficam com NULL — alerta operacional).
UPDATE "DProject"
SET "repoUrl" = dados->>'gitRepo'
WHERE "repoUrl" IS NULL
  AND dados->>'gitRepo' IS NOT NULL
  AND length(dados->>'gitRepo') > 0
  AND length(dados->>'gitRepo') <= 512;

-- 3. NÃO apagar dados->'gitRepo' — manter por 1 release para compat
--    com leituras antigas (frontend legado, services em desenvolvimento).
--    A remoção será feita em migration separada após release N+1.

COMMIT;
