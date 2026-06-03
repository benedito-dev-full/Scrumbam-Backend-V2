---
name: sprint-removal-fase5-schema-migration
description: Remoção de Sprint Fase 5 (schema + migration destrutiva) — drop idSprint de DTask; migration manual (DB dev offline); prisma generate confirma código limpo
metadata:
  type: project
---

# Remoção de Sprint — Fase 5 (SCHEMA + MIGRATION DESTRUTIVA) — ADR-V2-060 (2026-06-03)

Hard-delete: dropar coluna `idSprint` + índice de DTask. Fases 1-4 commitadas (Fase 4 seed = e8dc53e). Ver [[sprint-removal-fase4-seed]].

**Why:** Plano `workspace/plans/plan-core-remocao-sprint-hard-delete-task1.md` §5 Fase 5. CEO removeu Sprint 100%.

**How to apply:** coluna `idSprint` e `@@index([idSprint])` removidos de `model DTask` (schema.prisma). Migration `20260603000000_remove_sprint_hard_delete` criada mas NÃO aplicada (DB dev offline) — DROP COLUMN em prod é decisão do CEO no cutover. Módulo `src/sprints/` + ADR-V2-060 são Fase 6 (NÃO feita).

## Mudanças
- `prisma/schema.prisma`: removida linha `idSprint BigInt? // → DTabela idClasse=-40X` e `@@index([idSprint])` de model DTask. Nada mais tocado.
- `prisma/migrations/20260603000000_remove_sprint_hard_delete/migration.sql` (NOVO, criado MANUALMENTE): `DROP INDEX IF EXISTS "DTask_idSprint_idx"; ALTER TABLE "DTask" DROP COLUMN IF EXISTS "idSprint";` + down comentado (recria coluna VAZIA + índice — dados não voltam, hard delete). Backup pg_dump documentado no header (devari-migration-protocol).

## GOTCHAS
- **DB dev OFFLINE**: `.env.local` NÃO tem DATABASE_URL (só `.env.example` tem). `prisma migrate dev` falha P1012 (env não encontrada). Migration criada MANUALMENTE seguindo padrão dos arquivos existentes em prisma/migrations (forward DDL + down comentado, igual `20260525000000_add_due_date_dtask`). NÃO testada up/down em banco real — PENDENTE para o CEO no deploy.
- **`prisma generate` NÃO precisa de DB** mas valida o env do schema → rodar com `DATABASE_URL="postgresql://u:p@localhost:5432/db" npx prisma generate` (dummy, generate nunca conecta). PASS → tipos Prisma Client sem idSprint.
- **`nest build` PASSOU nesta Fase 5** (diferente do reportado na Fase 4): nest build usa tsconfig.build.json que EXCLUI specs → não bate na dep gemini (que está só em código tocado por specs? não — confirmar) e compila src/ produção limpo. Exit 0. Confirma que Fases 1-3 zeraram idSprint do código de produção.
- **tsc --noEmit: 25 erros baseline** (todos `*.spec.ts`, TS2554 arity — tenant-isolation, agents, ttl-cache, execution-run.processor, approval-flow, executions.prompt-mode/unit, notification.consumer — baseline ADR-V2-058). ZERO menção a sprint/idSprint. ZERO novos.
- **grep `idSprint` em src/: VAZIO. grep `sprintId` em src/: VAZIO.** Fases 1-3 já tinham limpado tudo. Em prisma/ sobram só: a nova migration, a migration inicial 20260508204157 (histórica — NÃO editar), e um doc-comment em cleanup-sprint-orphans.ts.
