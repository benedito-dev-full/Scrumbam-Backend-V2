-- F3 (Sessões multi-device — ADR-V2-077): índices de LOOKUP DE SESSÃO.
-- Referência: workspace/plans/plan-sessao-auth-hardening.md §5 FASE 3 (3.2 / 3.7) e §7.
--
-- ZERO TABELA NOVA (ADR-V2-001 preservado — o hook `enforce-canonical-tables.sh`
-- bloqueia CREATE TABLE, não CREATE INDEX; validado: este arquivo passou o hook).
-- Nenhuma coluna nova: as sessões vivem em DTabela (idClasse = -485 SESSION),
-- precedente ADR-V2-004 (API/MCP keys já moram em DTabela).
--
-- O QUE ESTES ÍNDICES MATAM
-- ------------------------
-- Hoje `POST /auth/refresh` resolve o dono do token com um FULL SCAN
-- (`dUserGroup.findMany({ take: 1000 })` em auth.controller.ts) e compara os
-- hashes EM MEMÓRIA. Acima de 1000 DUserGroup ativos, o dono simplesmente cai
-- fora da janela e o refresh QUEBRA — bomba-relógio de disponibilidade.
-- Depois desta migration, os dois caminhos de resolução são INDEXADOS:
--   1. sessão nova  → DTabela (idClasse, codigo)                  [índice 1/2]
--   2. slot legado  → DUserGroup ((dados->>'refreshTokenHash'))   [índice 3/4]
--
-- Os índices 3 e 4 existem para a JANELA DE MIGRAÇÃO (dual-read, §7): usuários
-- que já estão logados têm token só no slot legado e PRECISAM continuar
-- renovando sem serem deslogados no deploy. Em ≤ 7 dias (validade do refresh)
-- toda a base migra sozinha para DTabela; aí eles podem ser dropados junto com
-- o fallback (task separada, com o contador `auth.refresh.legacy_slot_hit`
-- provando que chegou a zero).

-- 1) Sessão CORRENTE: codigo = sha256(refreshToken vigente).
--    Cobre o lookup quente do refresh e o `GET /auth/sessions`.
--    (Espelha `@@index([idClasse, codigo])` em prisma/schema.prisma.)
CREATE INDEX IF NOT EXISTS "DTabela_idClasse_codigo_idx"
  ON "DTabela" ("idClasse", "codigo");

-- 2) Sessão ANTERIOR dentro da grace window (corrida de abas — F1/D2-i):
--    o token apresentado pode ser o `prevHash` da sessão, guardado em metaDados.
--    Índice PARCIAL de expressão — só as linhas de SESSION, só as ativas.
CREATE INDEX IF NOT EXISTS "DTabela_session_prev_hash_idx"
  ON "DTabela" ((("metaDados" ->> 'prevHash')))
  WHERE "idClasse" = -485 AND "excluido" = false;

-- 3) SLOT LEGADO (janela de migração): hash corrente em DUserGroup.dados.
--    É o que permite ZERO LOGOUT no deploy — sem este índice, honrar o slot
--    legado exigiria o full scan de volta.
CREATE INDEX IF NOT EXISTS "DUserGroup_legacy_refresh_hash_idx"
  ON "DUserGroup" ((("dados" ->> 'refreshTokenHash')))
  WHERE "excluido" = false;

-- 4) SLOT LEGADO — token anterior dentro da grace (mesmo motivo do índice 2).
CREATE INDEX IF NOT EXISTS "DUserGroup_legacy_prev_hash_idx"
  ON "DUserGroup" ((("dados" ->> 'prevHash')))
  WHERE "excluido" = false;

-- Migration down (rollback manual — padrão V2; sem perda de dados: só índices)
-- DROP INDEX IF EXISTS "DTabela_idClasse_codigo_idx";
-- DROP INDEX IF EXISTS "DTabela_session_prev_hash_idx";
-- DROP INDEX IF EXISTS "DUserGroup_legacy_refresh_hash_idx";
-- DROP INDEX IF EXISTS "DUserGroup_legacy_prev_hash_idx";
