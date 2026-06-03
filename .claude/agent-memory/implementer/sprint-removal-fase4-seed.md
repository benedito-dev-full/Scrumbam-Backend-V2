---
name: sprint-removal-fase4-seed
description: Remoção de Sprint Fase 4 (seed) — ADR-V2-060 hard-delete; remove DClasse -400 + Sprint 1 default do seed-bootstrap; script de saneamento dry-run
metadata:
  type: project
---

# Remoção de Sprint — Fase 4 (SEED) — ADR-V2-060 (2026-06-03)

Hard-delete de Sprint do backend V2. Fases 1-3 (IA/webhooks, métricas, endpoint+tasks) commitadas em 17c24ab. Fase 4 = seed only.

**Why:** CEO removeu Sprint 100% (front já removeu). Plano `workspace/plans/plan-core-remocao-sprint-hard-delete-task1.md` §5 Fase 4.

**How to apply:** ao tocar seed ou seed-bootstrap, lembrar que -400 SPRINT foi removido (range -400..-419 liberado). Schema/migration/módulo `src/sprints/` são Fases 5-6 (NÃO feitas nesta task).

## Mudanças
- `prisma/seeds/classes.seed.ts`: removida linha `esp(-400, 'SPRINT', ...)`. Header JSDoc atualizado: item #6 "DTabela principal" 36→35; Soma 105→104, +GAP 106→105, +Nexus 108→107.
- `src/projects/seed-bootstrap.service.ts`: removida const `ID_CLASSE_SPRINT`; removido bloco `tx.dTabela.create` Sprint 1; ajustados JSDoc (sem "1 sprint"), debug log e summary log ("9 statuses + N priorities"). **Idempotência intacta**: sentinela é INBOX (-441), NÃO sprint; `existingInbox` e `seedPrioritiesIfMissing` 100% preservados. `Prisma` import ainda usado.
- `src/projects/projects.service.spec.ts`: 3 referências a "sprint" eram só TÍTULOS/COMENTÁRIOS de teste (o spec mocka `seedBootstrap.seedProject` inteiro — NÃO testa criação interna de sprint). Removida palavra "sprint" dos títulos/comments. Nenhum assert enfraquecido.
- `prisma/scripts/cleanup-sprint-orphans.ts` (NOVO): soft-delete (excluido=true) DTabelas idClasse=-400 órfãs. Padrão dry-run por padrão + `--apply` (igual backfill-project-ref-entidades, NÃO o backfill-priority que não tem dry-run). PrismaClient puro, `eslint-disable no-console`. CEO roda manual.

## GOTCHAS
- **Contagem do mandato estava STALE**: task dizia "131→130", real é 152 total / 107 especificas (45 fixas). Fonte autoritativa = `npm run seed:classes:dry` → "45 fixas + 107 especificas = 152 classes" (valida hierarquia idPai + colisões no import). NÃO confiar no número do mandato; rodar o dry-run.
- **`/seed-validate` skill é INÚTIL aqui**: grep `chave:` literal não pega o helper `esp(...)`; e a skill lista `-400 # SPRINT` como obrigatória (stale pós-ADR-V2-060). Validar via dry-run + greps adaptados `esp\(-400`.
- **Build do projeto inteiro (`nest build`) FALHA** no dev Win por dep gemini ausente + banco offline. Gate do seed = `npm run build:seeds` (tsc -p tsconfig.seeds.json) PASS.
- **8 testes pré-existentes falham em `src/projects`** (todos em `findMany()` / `doneStatusRows.map` — feature de progresso commit 7c23cd4, mocks sem `doneStatusRows`). ZERO relação com sprint. Confirmado via `git stash` → baseline idêntico 8 failed/84 passed. NÃO introduzi falha nova.
- tsc --noEmit: 25 erros baseline (só src/__tests__, arity ADR-V2-058), 0 nos meus arquivos. eslint script+service: 0.
