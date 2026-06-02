-- Migration: add_project_ref_json_index
-- Fase 3 (Task 1 — Correção sistêmica DVincula↔DProject) / ADR-V2-058.
--
-- Adiciona DOIS índices de EXPRESSÃO Json (B-tree sobre `dados->>'...'`) para
-- resolução O(1) do handle canônico de projeto (PROJECT_REF -158):
--
--   1. DProject  ((dados->>'entidadeRefId'))                  → forward  P→E
--   2. DEntidade ((dados->>'projectId')) WHERE idClasse=-158  → reverso E→P (partial)
--
-- Prisma NÃO declara índice de expressão Json via @@index — por isso o SQL é raw.
--
-- ADITIVO: cria apenas índices; ZERO tabela/coluna nova (ADR-V2-001 preservado).
-- Os ponteiros vivem em `dados` Json (coluna existente). O índice parcial em
-- DEntidade usa `WHERE "idClasse" = -158` para indexar SÓ os espelhos (não infla
-- o índice com as demais DEntidade — usuários, orgs, teams, folders).
--
-- Idempotência: CREATE INDEX IF NOT EXISTS (re-run = no-op).
-- Rollback: ver companion file `down.sql` (manual; Prisma não aplica down auto).
--
-- ────────────────────────────────────────────────────────────────────────────
-- NOTA SOBRE CONCURRENTLY (para o cutover de produção — ver runbook):
-- `CREATE INDEX CONCURRENTLY` NÃO pode rodar dentro de transação, e o
-- `prisma migrate deploy` envolve cada migration numa transação implícita —
-- portanto CONCURRENTLY aqui causaria erro ("CREATE INDEX CONCURRENTLY cannot
-- run inside a transaction block"). Mantemos `CREATE INDEX` simples (lock de
-- escrita BREVE — DProject/DEntidade são tabelas estruturais pequenas).
-- Se em produção essas tabelas forem grandes o suficiente para o lock importar,
-- o CEO deve criar os índices MANUALMENTE com CONCURRENTLY (fora do Prisma) e
-- só então `prisma migrate resolve --applied 20260602000000_add_project_ref_json_index`.
-- O comando CONCURRENTLY equivalente está documentado no runbook.
-- ────────────────────────────────────────────────────────────────────────────

-- Forward P→E: resolução do espelho a partir do projeto.
CREATE INDEX IF NOT EXISTS "DProject_dados_entidadeRefId_idx"
  ON "DProject" (("dados" ->> 'entidadeRefId'));

-- Reverso E→P: resolução do projeto a partir do espelho. Parcial (só -158).
CREATE INDEX IF NOT EXISTS "DEntidade_dados_projectId_ref_idx"
  ON "DEntidade" (("dados" ->> 'projectId'))
  WHERE "idClasse" = -158;
