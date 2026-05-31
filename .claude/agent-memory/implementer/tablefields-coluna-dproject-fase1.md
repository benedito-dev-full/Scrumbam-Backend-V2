---
name: tablefields-coluna-dproject-fase1
description: Fase 1 da Task colunas customizáveis — coluna DProject.tableFields (migration aditiva); divergências do plano e baseline de build/banco no dev Win
metadata:
  type: project
---

# DProject.tableFields — Fase 1 (Colunas Customizáveis por Lista) — 2026-05-30

Adicionada coluna `tableFields Json?` em `model DProject` (schema.prisma ~l.419, após `dados Json?`). Migration manual em `prisma/migrations/20260530000000_add_table_fields_dproject/` com `migration.sql` (up: `ALTER TABLE "DProject" ADD COLUMN IF NOT EXISTS "tableFields" JSONB;` em BEGIN/COMMIT) + `down.sql` (`DROP COLUMN IF EXISTS`).

**Why:** decisão CEO "Opção B" — schema das colunas custom mora em coluna dedicada (espelha `DClasse.tableFields`), não em `DProject.dados`. Valores de célula continuam em `DTask.dados.fields`. Plano: `workspace/plans/plan-tasks-colunas-customizaveis-8-tipos-task1.md`.

**How to apply (Fases 2-7 desta task):** DTOs dos 8 tipos em `src/tasks/table-fields/`, PATCH /projects/:id write direto na coluna, validação de valores no PUT /tasks/:id (1 query `select: { tableFields: true }`), expor em ProjectResponseDto.

## Gotchas críticos descobertos
- **Plano com line numbers desatualizados:** dizia DProject em l.190-205 e placeholder `tableFieldsXXX` em l.200. FALSO. DProject real começa em l.396; `tableFieldsXXX` NÃO existe (grep = 0 matches). Coluna foi adicionada do zero, não "corrigida".
- **Convenção SEM `@map`:** plano sugeria `@map("table_fields")`. Mas `DClasse.tableFields` (l.50), `DProject.dados`, `DProject.repoUrl` são todos camelCase direto. Migration inicial confirma `"tableFields" JSONB`, `"dados" JSONB`, `"repoUrl"`. Segui camelCase para consistência. Coluna física = `"tableFields"`.
- **Migrations de referência:** `20260515151000_add_repo_url_to_dproject` (BEGIN/COMMIT + ADD COLUMN IF NOT EXISTS + backfill) e `20260525000000_add_due_date_dtask` são os padrões a copiar para migrations manuais. Prisma NÃO aplica down.sql — é teste manual via `psql -f`.

## Baseline de ambiente Win dev (NÃO são regressões)
- **Banco offline:** `prisma migrate status` falha com `P1001 Can't reach database server at localhost:5432` (ou `P1012 DATABASE_URL not found` quando env não setado na chamada bash). Apply/rollback live impossível no dev Win. Postgres precisa rodar (docker-compose) para fechar DoD de migration.
- **`npm run build` E `npx nest build` FALHAM por dep ausente:** `gemini.provider.ts:17 TS2307 Cannot find module '@google/generative-ai'`. `ls node_modules/@google/generative-ai` = MISSING apesar de estar no package.json (dep não instalada neste ambiente). Para validar mudança de schema, usar `npx tsc --noEmit` e conferir que nenhum erro novo aparece além do baseline; ou instalar a dep (`npm i @google/generative-ai`) e então `npx nest build`.
- **`npx tsc --noEmit` baseline = 14 erros pré-existentes:** tenant-isolation.adversarial.spec (6× arity 7vs6), gemini.provider (1× TS2307 @google/generative-ai), agents-heartbeat/install(2)/projects/execution-result.spec (5× arity 8vs7), ttl-cache.service.spec (1× arity 0vs1), execution-run.processor.spec (1× arity 6vs5). Nenhum relacionado a DProject.tableFields; ZERO novos introduzidos pela coluna.
