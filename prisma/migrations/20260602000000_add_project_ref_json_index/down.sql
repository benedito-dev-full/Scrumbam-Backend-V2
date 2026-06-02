-- DOWN (rollback manual) para 20260602000000_add_project_ref_json_index.
-- Prisma 5 NÃO aplica down.sql automaticamente — executar manualmente via psql
-- se for necessário reverter os índices de expressão Json (ADR-V2-058 Fase 3).
--
-- Remoção dos índices é segura: NÃO toca dados, apenas estrutura de busca.
-- IF EXISTS torna o rollback idempotente.
--
-- NOTA CONCURRENTLY: se os índices foram criados com CONCURRENTLY em produção
-- (ver runbook), use também DROP INDEX CONCURRENTLY (fora de transação).

DROP INDEX IF EXISTS "DProject_dados_entidadeRefId_idx";
DROP INDEX IF EXISTS "DEntidade_dados_projectId_ref_idx";
