-- ============================================================================
-- PODA V3 9 -> 5 — PASSO 2: MIGRACAO DE DADOS
-- ============================================================================
--
-- ⚠️  NAO EXECUTE SEM LER. Este script ESCREVE. Quem roda e o CEO.
-- ⚠️  RODE `count-v3-removed-statuses.sql` PRIMEIRO. Confira (C) e (D):
--     - (C) divergencia entre as duas fontes -> ZERO linhas esperado.
--     - (D) projeto sem DTabela de destino   -> ZERO linhas esperado.
--         Se (D) trouxer linhas, a task ficaria orfa; crie a DTabela de destino
--         (POST /workflow-statuses/seed-defaults/:projectId) antes de migrar.
--
-- Uso (dentro de UMA transacao — nada e commitado sem o COMMIT final):
--   psql "$DATABASE_URL" -1 -f prisma/scripts/migrate-v3-statuses-9to5.sql
--
-- IDEMPOTENTE: re-rodar nao causa dano — as tasks ja migradas nao casam mais
-- com os filtros de origem (-446..-449 / 'VALIDATING'...). `migratedFrom` so e
-- gravado na primeira passagem.
--
-- AUDITORIA: o estado anterior NUNCA e apagado. Cada task migrada recebe:
--   dados.v3.migratedFrom = { state, idStatus, at, by:'poda-v3-9to5' }
--
-- ─── MAPEAMENTO ─────────────────────────────────────────────────────────────
--   VALIDATING (-448) -> EXECUTING (-443)   [ACORDADO — ainda em trabalho]
--   VALIDATED  (-449) -> DONE      (-444)   [ACORDADO]
--   CANCELLED  (-446) -> SOFT-DELETE (excluido=true)  [DECISAO CEO 2026-07-15]
--   DISCARDED  (-447) -> SOFT-DELETE (excluido=true)  [DECISAO CEO 2026-07-15]
--
--   POR QUE SOFT-DELETE (e nao DONE/INBOX):
--   mandar tarefa abandonada para DONE INFLARIA a metrica de entrega (throughput,
--   pontualidade, % conclusao). Mandar para INBOX a devolveria ao backlog vivo.
--   O CEO decidiu DELETAR: soft-delete (excluido=true) tira a task do board E das
--   metricas sem contar como entrega. REVERSIVEL — a linha permanece no banco e o
--   estado anterior fica em dados.v3.migratedFrom.
-- ============================================================================

BEGIN;

-- ─── BLOCO 1: VALIDATING (-448) -> EXECUTING (-443) ─────────────────────────

-- 1a. Fonte canonica: DTask.idStatus (aponta para a DTabela do PROPRIO projeto)
UPDATE "DTask" t
SET
  "idStatus" = tgt.chave,
  dados = jsonb_set(
    jsonb_set(
      COALESCE(t.dados, '{}'::jsonb),
      '{v3,migratedFrom}',
      COALESCE(t.dados -> 'v3' -> 'migratedFrom', jsonb_build_object(
        'state',    COALESCE(t.dados -> 'v3' ->> 'state', 'VALIDATING'),
        'idStatus', t."idStatus"::text,
        'at',       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'by',       'poda-v3-9to5'
      )),
      true
    ),
    '{v3,state}', '"EXECUTING"'::jsonb, true
  )
FROM "DTabela" src, "DTabela" tgt
WHERE t."idStatus" = src.chave
  AND src."idClasse" = -448
  AND tgt."idClasse" = -443
  AND tgt.excluido = false
  AND tgt."dEntidadeId" IS NOT DISTINCT FROM src."dEntidadeId"  -- MESMO projeto
  AND t.excluido = false;

-- 1b. Fonte espelho: dados.v3.state ainda em VALIDATING (idStatus ja ok/nulo)
UPDATE "DTask" t
SET dados = jsonb_set(
  jsonb_set(
    COALESCE(t.dados, '{}'::jsonb),
    '{v3,migratedFrom}',
    COALESCE(t.dados -> 'v3' -> 'migratedFrom', jsonb_build_object(
      'state',    'VALIDATING',
      'idStatus', COALESCE(t."idStatus"::text, ''),
      'at',       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'by',       'poda-v3-9to5'
    )),
    true
  ),
  '{v3,state}', '"EXECUTING"'::jsonb, true
)
WHERE t.dados -> 'v3' ->> 'state' = 'VALIDATING'
  AND t.excluido = false;

-- ─── BLOCO 2: VALIDATED (-449) -> DONE (-444) ───────────────────────────────

-- 2a. Fonte canonica: DTask.idStatus
UPDATE "DTask" t
SET
  "idStatus" = tgt.chave,
  dados = jsonb_set(
    jsonb_set(
      COALESCE(t.dados, '{}'::jsonb),
      '{v3,migratedFrom}',
      COALESCE(t.dados -> 'v3' -> 'migratedFrom', jsonb_build_object(
        'state',    COALESCE(t.dados -> 'v3' ->> 'state', 'VALIDATED'),
        'idStatus', t."idStatus"::text,
        'at',       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'by',       'poda-v3-9to5'
      )),
      true
    ),
    '{v3,state}', '"DONE"'::jsonb, true
  )
FROM "DTabela" src, "DTabela" tgt
WHERE t."idStatus" = src.chave
  AND src."idClasse" = -449
  AND tgt."idClasse" = -444
  AND tgt.excluido = false
  AND tgt."dEntidadeId" IS NOT DISTINCT FROM src."dEntidadeId"  -- MESMO projeto
  AND t.excluido = false;

-- 2b. Fonte espelho
UPDATE "DTask" t
SET dados = jsonb_set(
  jsonb_set(
    COALESCE(t.dados, '{}'::jsonb),
    '{v3,migratedFrom}',
    COALESCE(t.dados -> 'v3' -> 'migratedFrom', jsonb_build_object(
      'state',    'VALIDATED',
      'idStatus', COALESCE(t."idStatus"::text, ''),
      'at',       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'by',       'poda-v3-9to5'
    )),
    true
  ),
  '{v3,state}', '"DONE"'::jsonb, true
)
WHERE t.dados -> 'v3' ->> 'state' = 'VALIDATED'
  AND t.excluido = false;

-- NOTA (VALIDATED -> DONE e telemetry.doneAt):
-- `telemetry.doneAt` ja e gravado na transicao para DONE e PERSISTE ao longo de
-- VALIDATING/VALIDATED. Portanto as tasks migradas de VALIDATED ja tem `doneAt`
-- e entram normalmente nas metricas de pontualidade/throughput. Nada a fazer.

-- ============================================================================
-- ─── BLOCO 3: CANCELLED (-446) e DISCARDED (-447) -> SOFT-DELETE ─────────────
--     DECISAO DO CEO (2026-07-15): tarefas canceladas e descartadas sao
--     DELETADAS via soft-delete (excluido = true). Somem do board E das metricas
--     sem contar como entrega. REVERSIVEL — a linha continua no banco; para
--     restaurar, `excluido = false`. O estado anterior fica em
--     dados.v3.migratedFrom (by = 'poda-v3-9to5-softdelete').
--
--     Cobre as DUAS fontes: DTask.idStatus (-446/-447) e o espelho
--     dados.v3.state ('CANCELLED'/'DISCARDED').

-- 3a. CANCELLED (-446) por idStatus (fonte canonica)
UPDATE "DTask" t
SET excluido = true,
    dados = jsonb_set(
      COALESCE(t.dados, '{}'::jsonb),
      '{v3,migratedFrom}',
      COALESCE(t.dados -> 'v3' -> 'migratedFrom', jsonb_build_object(
        'state',    COALESCE(t.dados -> 'v3' ->> 'state', 'CANCELLED'),
        'idStatus', t."idStatus"::text,
        'at',       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'by',       'poda-v3-9to5-softdelete'
      )),
      true
    )
FROM "DTabela" src
WHERE t."idStatus" = src.chave
  AND src."idClasse" = -446
  AND t.excluido = false;

-- 3b. DISCARDED (-447) por idStatus (fonte canonica)
UPDATE "DTask" t
SET excluido = true,
    dados = jsonb_set(
      COALESCE(t.dados, '{}'::jsonb),
      '{v3,migratedFrom}',
      COALESCE(t.dados -> 'v3' -> 'migratedFrom', jsonb_build_object(
        'state',    COALESCE(t.dados -> 'v3' ->> 'state', 'DISCARDED'),
        'idStatus', t."idStatus"::text,
        'at',       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'by',       'poda-v3-9to5-softdelete'
      )),
      true
    )
FROM "DTabela" src
WHERE t."idStatus" = src.chave
  AND src."idClasse" = -447
  AND t.excluido = false;

-- 3c. Fonte espelho: dados.v3.state ainda em CANCELLED/DISCARDED
--     (idStatus nulo ou apontando p/ outra tabela). As ja pegas em 3a/3b saem
--     por t.excluido = false; migratedFrom preservado pelo COALESCE.
UPDATE "DTask" t
SET excluido = true,
    dados = jsonb_set(
      COALESCE(t.dados, '{}'::jsonb),
      '{v3,migratedFrom}',
      COALESCE(t.dados -> 'v3' -> 'migratedFrom', jsonb_build_object(
        'state',    t.dados -> 'v3' ->> 'state',
        'idStatus', COALESCE(t."idStatus"::text, ''),
        'at',       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'by',       'poda-v3-9to5-softdelete'
      )),
      true
    )
WHERE t.dados -> 'v3' ->> 'state' IN ('CANCELLED', 'DISCARDED')
  AND t.excluido = false;
-- ============================================================================

-- ─── BLOCO 4: VERIFICACAO (roda ANTES do COMMIT) ────────────────────────────
-- Com o BLOCO 3 ativado (soft-delete), deve sobrar ZERO task (excluido=false)
-- nos QUATRO status: -446/-447/-448/-449 por idStatus, e
-- 'VALIDATING'/'VALIDATED'/'CANCELLED'/'DISCARDED' por dados.v3.state.
-- As canceladas/descartadas saem por excluido=true (nao por mudanca de status).

\echo ''
\echo '=== SOBRARAM (por idStatus) — esperado: nenhum -448/-449 ==='
SELECT s."idClasse", s.codigo, COUNT(*) AS tasks
FROM "DTask" t
JOIN "DTabela" s ON t."idStatus" = s.chave
WHERE s."idClasse" IN (-446, -447, -448, -449) AND t.excluido = false
GROUP BY s."idClasse", s.codigo
ORDER BY s."idClasse" DESC;

\echo ''
\echo '=== SOBRARAM (por dados.v3.state) — esperado: nenhum VALIDATING/VALIDATED ==='
SELECT t.dados -> 'v3' ->> 'state' AS v3_state, COUNT(*) AS tasks
FROM "DTask" t
WHERE t.dados -> 'v3' ->> 'state' IN ('CANCELLED', 'DISCARDED', 'VALIDATING', 'VALIDATED')
  AND t.excluido = false
GROUP BY 1 ORDER BY 1;

-- ─── BLOCO 5: LIMPEZA DAS DTabelas ORFAS ────────────────────────────────────
-- ⚠️  SO DESCOMENTE DEPOIS que o BLOCO 3 tiver sido decidido E executado, e que
--     o BLOCO 4 acima mostrar ZERO tasks nos 4 status. Soft-delete (excluido =
--     true) — reversivel. Tira os 4 status do endpoint generico /tabelas e dos
--     seletores do frontend.
--
-- UPDATE "DTabela"
-- SET excluido = true
-- WHERE "idClasse" IN (-446, -447, -448, -449)
--   AND excluido = false
--   AND NOT EXISTS (
--     SELECT 1 FROM "DTask" t
--     WHERE t."idStatus" = "DTabela".chave AND t.excluido = false
--   );
--
-- As DClasses -446..-449 ja sairam de `prisma/seeds/classes.seed.ts`. O
-- seed-runner faz UPSERT (nunca DELETE), entao as linhas de DClasse permanecem
-- no banco — inofensivas, sem nenhuma DTabela viva apontando para elas. Ficam
-- RESERVADAS: nao reutilizar essas chaves para outra coisa.

COMMIT;
