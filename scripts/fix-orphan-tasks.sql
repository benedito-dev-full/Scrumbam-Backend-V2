-- =============================================================================
-- fix-orphan-tasks.sql — Saneamento one-shot de "tarefas órfãs vivas" (DTask)
-- =============================================================================
--
-- CONTEXTO
--   Antes da correção de cascade (ADR-V2-047 Q6), deletar uma TASK normal
--   (DTask idClasse=-154) com subtarefas NÃO cascateava o soft-delete. As
--   filhas viravam "órfãs vivas": excluido=false apontando, via idPai, para
--   uma mãe excluido=true. Continuam aparecendo em listagens, métricas, etc.
--
--   Este script corrige as órfãs JÁ EXISTENTES em uma única passada recursiva
--   (cobre cadeias filha-de-filha-de-filha). É soft-delete (reversível).
--
-- NATUREZA
--   One-shot de DADOS, NÃO é Prisma migration. Vive em scripts/, nunca em
--   prisma/migrations/ (não muda schema; não deve rodar em todo ambiente novo).
--
-- EXECUÇÃO — AÇÃO MANUAL EXCLUSIVA DO CEO (CEO 2026-05-30)
--   Nenhum agent / fluxo automático roda este UPDATE contra staging ou
--   produção. O CEO executa manualmente, no momento certo. Procedimento:
--     1. Rodar e conferir o SELECT de diagnóstico (orfas_antes).
--     2. Executar o bloco dentro de BEGIN/COMMIT.
--     3. Conferir orfas_depois = 0 antes do COMMIT.
--     4. Reversível: para reabilitar uma cadeia indevidamente excluída,
--        UPDATE "DTask" SET excluido = false WHERE chave IN (...).
--
-- USO
--   psql "$DATABASE_URL" --no-psqlrc -f scripts/fix-orphan-tasks.sql
-- =============================================================================

BEGIN;

-- 1) Diagnóstico: quantas órfãs vivas existem ANTES (raiz direta de pai morto)
SELECT COUNT(*) AS orfas_antes
FROM "DTask" f
JOIN "DTask" p ON f."idPai" = p.chave
WHERE f.excluido = false
  AND p.excluido = true;

-- 2) Correção recursiva: marca toda a subárvore viva pendurada em pai morto.
--    Âncora  = filhas vivas de pai já excluído.
--    Recursão = descendentes vivos das órfãs já capturadas.
WITH RECURSIVE orfas AS (
  SELECT f.chave
  FROM "DTask" f
  JOIN "DTask" p ON f."idPai" = p.chave
  WHERE f.excluido = false
    AND p.excluido = true

  UNION ALL

  SELECT t.chave
  FROM "DTask" t
  JOIN orfas o ON t."idPai" = o.chave
  WHERE t.excluido = false
)
UPDATE "DTask"
SET excluido = true,
    "atualizadoEm" = NOW()
WHERE chave IN (SELECT chave FROM orfas);

-- 3) Verificação: deve retornar 0 (nenhuma órfã viva remanescente)
SELECT COUNT(*) AS orfas_depois
FROM "DTask" f
JOIN "DTask" p ON f."idPai" = p.chave
WHERE f.excluido = false
  AND p.excluido = true;

COMMIT;
