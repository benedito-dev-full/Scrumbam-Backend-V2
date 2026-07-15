-- ============================================================================
-- PODA V3 9 -> 5 — PASSO 1: CONTAGEM (READ-ONLY, seguro em producao)
-- ============================================================================
--
-- Roda ANTES da migracao. NAO escreve nada. Serve para o CEO decidir o destino
-- de CANCELLED / DISCARDED com o numero na mao.
--
-- Uso:
--   psql "$DATABASE_URL" -f prisma/scripts/count-v3-removed-statuses.sql
--
-- Existem DUAS fontes de verdade para o status de uma task, e elas podem
-- divergir. As duas precisam ser contadas e as duas serao migradas:
--   (A) DTask.idStatus  -> DTabela.chave -> DTabela.idClasse  (fonte canonica,
--       e a que TasksService.findMany usa para filtrar)
--   (B) DTask.dados->'v3'->>'state'                            (fonte espelho,
--       gravada por TasksService.updateStatus)
-- ============================================================================

\echo ''
\echo '=== (A) POR idStatus -> DTabela.idClasse (fonte canonica) ==='
SELECT
  s."idClasse",
  s.codigo,
  COUNT(*) AS tasks
FROM "DTask" t
JOIN "DTabela" s ON t."idStatus" = s.chave
WHERE s."idClasse" IN (-446, -447, -448, -449)
  AND t.excluido = false
GROUP BY s."idClasse", s.codigo
ORDER BY s."idClasse" DESC;

\echo ''
\echo '=== (B) POR dados.v3.state (fonte espelho) ==='
SELECT
  t.dados -> 'v3' ->> 'state' AS v3_state,
  COUNT(*) AS tasks
FROM "DTask" t
WHERE t.dados -> 'v3' ->> 'state' IN ('CANCELLED', 'DISCARDED', 'VALIDATING', 'VALIDATED')
  AND t.excluido = false
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '=== (C) DIVERGENCIA entre as duas fontes (idStatus != dados.v3.state) ==='
\echo '    Se retornar linhas, as duas fontes NAO batem — investigar antes de migrar.'
SELECT
  t.chave        AS task_id,
  t."idProject"  AS project_id,
  s.codigo       AS status_por_idstatus,
  t.dados -> 'v3' ->> 'state' AS status_por_dados
FROM "DTask" t
LEFT JOIN "DTabela" s ON t."idStatus" = s.chave
WHERE t.excluido = false
  AND (
        s."idClasse" IN (-446, -447, -448, -449)
     OR t.dados -> 'v3' ->> 'state' IN ('CANCELLED', 'DISCARDED', 'VALIDATING', 'VALIDATED')
      )
  AND COALESCE(s.codigo, '') IS DISTINCT FROM COALESCE(t.dados -> 'v3' ->> 'state', '')
ORDER BY t.chave;

\echo ''
\echo '=== (D) PRE-VOO: projetos que NAO tem a DTabela de DESTINO ==='
\echo '    A migracao move a task para a DTabela de destino DO MESMO projeto.'
\echo '    Se um projeto tem task em -448/-449 mas nao tem a DTabela de'
\echo '    EXECUTING(-443)/DONE(-444), a task ficaria para tras. ZERO linhas = OK.'
SELECT DISTINCT
  src."dEntidadeId" AS escopo_dtabela,
  src."idClasse"    AS origem,
  CASE src."idClasse" WHEN -448 THEN -443 WHEN -449 THEN -444 END AS destino_faltante
FROM "DTask" t
JOIN "DTabela" src ON t."idStatus" = src.chave
WHERE t.excluido = false
  AND src."idClasse" IN (-448, -449)
  AND NOT EXISTS (
    SELECT 1 FROM "DTabela" tgt
    WHERE tgt."dEntidadeId" IS NOT DISTINCT FROM src."dEntidadeId"
      AND tgt.excluido = false
      AND tgt."idClasse" = CASE src."idClasse" WHEN -448 THEN -443 WHEN -449 THEN -444 END
  );

\echo ''
\echo '=== (E) DTabelas orfas dos 4 status removidos (serao soft-deletadas) ==='
SELECT "idClasse", codigo, COUNT(*) AS linhas_dtabela
FROM "DTabela"
WHERE "idClasse" IN (-446, -447, -448, -449) AND excluido = false
GROUP BY "idClasse", codigo
ORDER BY "idClasse" DESC;
