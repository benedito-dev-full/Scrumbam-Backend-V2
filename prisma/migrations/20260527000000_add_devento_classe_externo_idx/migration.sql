-- Frente B.0 (Nexus IA Chat — pré-requisito): índice composto em DEvento
-- Referência: docs/plans/2026-05-27-nexus-ia-chat.md (Fase B.0)
--
-- Resolve DEBT-COMMENTS-01: queries no padrão
--   WHERE idClasse = X AND identificadorExterno = Y
-- são usadas tanto pelo CommentsModule (Frente A — já entregue) quanto
-- pelo futuro chat IA persistente (Frente B). Sem este índice composto,
-- performance degrada conforme volume de DEvento cresce.
--
-- Decisão R-4 (usuário): modo padrão Prisma (sem CONCURRENTLY).
-- Aceita bloqueio breve de INSERTs durante criação do índice em produção.
--
-- NÃO usa tabela nova (ADR-V2-001 preservado). Apenas índice estrutural.

-- CreateIndex
CREATE INDEX "DEvento_idClasse_identificadorExterno_idx" ON "DEvento"("idClasse", "identificadorExterno");

-- Migration down (rollback manual — padrão V2)
-- DROP INDEX IF EXISTS "DEvento_idClasse_identificadorExterno_idx";
