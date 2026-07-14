-- Fase 2 (Justificativa de Atraso — Painel Admin, ADR-V2-070): índice parcial
-- de expressão em DEvento para acelerar a agregação do painel de motivos.
-- Referência: workspace/plans/plan-eventos-justificativa-atraso-task1.md §5 (Fase 2)
--
-- A agregação (GET /reports/delay-reasons) sempre opera sobre o subconjunto
-- de justificativas VIGENTES:
--   WHERE "idClasse" = -503 AND "excluido" = false
-- e faz JOIN com DProject por (metaDados->>'projetoId')::bigint (escopo de org),
-- GROUP BY por motivo (metaDados->>'motivoClasse'), por usuário (idEntidade) ou
-- por projeto (metaDados->>'projetoId'), com filtro de período em "criadoEm".
--
-- Este índice PARCIAL de EXPRESSÃO indexa exatamente esse working set,
-- cobrindo a chave de JOIN (projetoId), o group-by por usuário (idEntidade),
-- o group-by por motivo (motivoClasse) e a poda de período (criadoEm).
--
-- NÃO usa tabela nova (ADR-V2-001 preservado) — apenas índice estrutural.
-- Partial + expression index não é expressável em schema.prisma → raw SQL only.
-- IF NOT EXISTS torna a migration idempotente (rodar 2x não quebra).

-- CreateIndex (parcial de expressão — restrito às justificativas vigentes -503)
CREATE INDEX IF NOT EXISTS "DEvento_delay_reason_agg_idx"
  ON "DEvento" (
    (("metaDados" ->> 'projetoId')),
    "idEntidade",
    (("metaDados" ->> 'motivoClasse')),
    "criadoEm"
  )
  WHERE "idClasse" = -503 AND "excluido" = false;

-- Migration down (rollback manual — padrão V2; sem perda de dados: só índice)
-- DROP INDEX IF EXISTS "DEvento_delay_reason_agg_idx";
