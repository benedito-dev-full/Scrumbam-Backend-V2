-- Migration: add_dtask_idpai
-- ADR-V2-047: Fases via DTask.idPai (hierarquia auto-referencial)
-- Adiciona coluna idPai e self-FK em DTask para suportar hierarquia
-- pai/filho (Fases agrupando tasks) sem criar tabela nova (ADR-V2-001).
--
-- Idempotência:
--   * UP: cada statement é idempotente em re-run controlado:
--     - ADD COLUMN IF NOT EXISTS evita falha se a coluna já existir.
--     - ADD CONSTRAINT idem (Postgres 9.6+ não suporta IF NOT EXISTS
--       em ADD CONSTRAINT — re-run causará erro 42710 esperado; o
--       Prisma rastreia migrations aplicadas em _prisma_migrations,
--       então não há re-run real em ambiente gerido).
--     - CREATE INDEX IF NOT EXISTS evita falha em re-run.
--
-- Produção (runbook customizado — NÃO usado em migrate dev):
--   * Para produção, recomenda-se substituir `CREATE INDEX` por
--     `CREATE INDEX CONCURRENTLY` (não bloqueia escrita) — porém
--     CONCURRENTLY não funciona dentro de transaction, então deve
--     ser executado como script standalone, fora do `prisma migrate
--     deploy`. Ver plano §7 (risco MEDIO #4).
--
-- Rollback: ver companion file `migration.down.sql` no mesmo diretório
-- (não executado automaticamente pelo Prisma — script manual para
-- staging/prod caso seja necessário reverter).

BEGIN;

-- 1. Adiciona coluna idPai (nullable, sem default — instantâneo em PG,
--    não rewrite). Nullable é obrigatório: tasks-raiz não têm pai.
ALTER TABLE "DTask" ADD COLUMN IF NOT EXISTS "idPai" BIGINT;

-- 2. Self-FK apontando para DTask("chave"). NoAction em ambos (consistente
--    com o restante do schema). Permitir DELETE/UPDATE manuais sem cascata
--    — exclusão lógica via flag `excluido` resolve o caso real.
ALTER TABLE "DTask"
  ADD CONSTRAINT "DTask_idPai_fkey"
  FOREIGN KEY ("idPai") REFERENCES "DTask"("chave")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 3. Índice simples em idPai (lookup de filhos por pai — caso comum:
--    "listar tasks da Fase X").
CREATE INDEX IF NOT EXISTS "DTask_idPai_idx" ON "DTask"("idPai");

-- 4. Índice composto (idPai, excluido) — filtra filhos não-excluídos
--    em UMA passada (evita seq scan + filtro em listas de fase).
CREATE INDEX IF NOT EXISTS "DTask_idPai_excluido_idx" ON "DTask"("idPai", "excluido");

COMMIT;
