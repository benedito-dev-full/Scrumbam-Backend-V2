---
name: project-ref-158-fase3-migration-backfill
description: ADR-V2-058 Fase 3 — migration índice expressão Json + backfill idempotente PROJECT_REF (-158) com relatório de suspeitos de colisão; dry-run por padrão
metadata:
  type: project
---

# ADR-V2-058 Fase 3 — Migration índice + backfill PROJECT_REF (-158) (2026-06-02)

**Fato:** Entregue a migration de índices de expressão Json + script de backfill idempotente + runbook para cutover do CEO. Fases 1 (seed+ADR) e 2 (helper `ProjectRefService` + 27 call sites P→E) já estavam concluídas/commitadas (8.5/10).

**Why:** Os projetos LEGADOS (pré-Fase 2) não têm espelho -158 e suas linhas DVincula ainda gravam `DProject.chave` (P) onde a FK exige `DEntidade.chave`. Precisa criar espelhos + reescrever P→E nas linhas antigas, com índices para resolução O(1). Ver [[project-ref-158-fase1]].

**Arquivos entregues:**
- `prisma/migrations/20260602000000_add_project_ref_json_index/migration.sql` + `down.sql` (companion manual — Prisma 5 não aplica down auto).
- `prisma/scripts/backfill-project-ref-entidades.ts` (dry-run por padrão; `--apply` escreve).
- `docs/runbook-backfill-project-ref-entidades.md` (backup→dry-run→migration→apply→validar→rollback).

**How to apply / gotchas desta Fase 3:**
- **CONCURRENTLY NÃO vai na migration Prisma:** `prisma migrate deploy` envolve cada migration numa transação implícita; `CREATE INDEX CONCURRENTLY` não roda em transação → erro. Migration usa `CREATE INDEX IF NOT EXISTS` simples (DProject/DEntidade são estruturais pequenas). O runbook §4 documenta o caminho CONCURRENTLY manual + `prisma migrate resolve --applied <nome>` para quando as tabelas forem grandes em prod.
- **Índices:** 2 — `DProject (("dados"->>'entidadeRefId'))` (forward P→E) e `DEntidade (("dados"->>'projectId')) WHERE "idClasse"=-158` (reverso E→P, PARCIAL só nos espelhos). Sintaxe de expressão Json válida PG 11+; Prisma não declara isso via @@index → SQL raw obrigatório.
- **Backfill 2 fases:** A) cria espelho -158 p/ cada DProject sem `dados.entidadeRefId` (transação por projeto, replica a regra de `ProjectRefService.ensureEntidadeRef` em PrismaClient puro — script roda fora do NestJS). B) reescreve DVincula P→E: famílias `idLocEscritu` = [-171,-172,-173,-188], famílias `idEntidade` = [-182,-183].
- **Detecção de colisão (CRÍTICO):** `classifyValue(valor)` faz `Promise.all([dEntidade.findFirst, dProject.findFirst])`. Se valor existe em DProject E numa DEntidade NÃO-espelho (idClasse!=-158) → `ambiguo` → NÃO repara, vai p/ relatório de suspeitos (lista detalhada + bloco JSON copiável). Se só DProject → `projeto` → repara. Se só DEntidade ou já -158 → nada a fazer. Se nenhum → `desconhecido` (órfão real, conta como erro).
- **-188 SPACE_PRIVATE_MEMBER ainda NÃO é criado por nenhum service** (só documentado em DTOs project/dto/*.dto.ts). Em prod não há linhas -188 hoje; incluí no repair por completude/futuro (gated em existência real).
- **DEvento AUDIT (-489 AUDIT_GENERIC) emitido** no `--apply` da Fase A (`idEntidade=E`, descricao='project.ref.backfilled') — não bloqueante. -489 confirmado no seed.
- **Idempotência:** Fase A pula projeto com espelho vivo; Fase B só repara campo que ainda é P e não-ambíguo (já-E é ignorado).

**Ambiente dev (Win) — validação possível:**
- **Banco OFFLINE no dev** (sem DATABASE_URL em `.env.local`; só `REDIS_ENABLED=false`). NÃO dá p/ rodar `prisma migrate` nem o backfill ao vivo aqui. Validação = tsc + eslint + revisão de SQL estática. Cutover ao vivo é do CEO via runbook (mesmo padrão dos outros backfill scripts, que validam por dry-run, não jest).
- **tsc:** `npx tsc --noEmit` = 20 erros PRÉ-EXISTENTES, TODOS em `src/**/__tests__/*.spec.ts` (tenant-isolation.adversarial, agents-heartbeat/install/projects, execution-result/run/prompt-mode/unit, ttl-cache, notification.consumer, approval-flow.unit, webhook-owner.guard, executions.unit). ZERO em `prisma/scripts` ou `prisma/migrations`. Baseline subiu de 7→14→20 ao longo das sessões (specs de arity quebrados pré-existentes).
- **eslint:** `npx eslint prisma/scripts/backfill-project-ref-entidades.ts` = 0 (precisei `// eslint-disable-next-line no-console` no helper `log()` e `@typescript-eslint/no-explicit-any` no `...args: any[]` — mesmo padrão dos outros backfill scripts que usam console direto).
- **jest roots** = só `src` + `prisma/seeds`; `prisma/scripts` NÃO está em roots e os scripts rodam `main()` no import → não dá p/ ter spec sem refatorar + adicionar root. Mantive paridade com `backfill-default-folders.ts`/`backfill-priority-tabelas.ts` (sem spec, validação por dry-run).
- **prisma version:** 5.22.0 (CLI e client).
- Constantes de classe confirmadas em call sites Fase 2: -171/-172/-173 (project-members/projects/user-project.service), -182/-183 (projects.service), -183 (folders.service).
