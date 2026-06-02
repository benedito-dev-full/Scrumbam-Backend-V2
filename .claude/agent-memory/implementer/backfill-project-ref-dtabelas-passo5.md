---
name: backfill-project-ref-dtabelas-passo5
description: Backfill passo 5 ADR-V2-058/059 — corrige DTabela.dEntidadeId P→E (espelho -158) para classes project-scoped
metadata:
  type: project
---

Script `prisma/scripts/backfill-project-ref-dtabelas.ts` + runbook `docs/runbook-backfill-project-ref-dtabelas.md` (passo 5 ADR-V2-058/059, 2026-06-02, branch feature/integracao-frontend-v2-hierarquia).

**O que faz:** corrige DADOS legados de DTabela cujo `dEntidadeId` foi gravado como `DProject.chave` (P), reescrevendo para handle canônico DEntidade-espelho -158 (E). Passos 1-2 (commit 0c68dbb) e 4 (webhooks) corrigiram ESCRITA/LEITURA no código; este corrige dados antigos.

**Why:** espelha 1:1 o `backfill-project-ref-entidades.ts` (DVincula). DTabela tem UM campo handle (`dEntidadeId`), não dois — então sem `LOC_ESCRITU_FAMILIES`/`ENTIDADE_FAMILIES`, há um único `repairTabelas()` em vez de `repairFamily(campo,...)`. Reusa `ensureEspelho` (Fase A), `classifyValue` (idêntico), dry-run padrão (`--apply`), relatório suspeitos+JSON, DEvento AUDIT -489.

**How to apply:**
- `PROJECT_SCOPED_TABELA_CLASSES` = [-440..-449, -400, -420..-424, -430, -470]. NUNCA adicionar -471 (API key=userId), -472 (MCP key=userId), -475 (ISSUE_COUNTER=teamId) — dEntidadeId é DEntidade REAL ali; filtro idClasse já as exclui (comentário explícito no const).
- Diferença de classifyValue: kind `entidade` numa classe project-scoped é ANÔMALO → vai pro relatório de suspeitos (não repara), não é "nada a fazer" como no DVincula. `canonico` continua no-op.
- Reparo `--apply` envolve `dTabela.update` + DEvento AUDIT numa `$transaction` (descricao `dtabela.scope.backfilled`, metaDados {tabelaChave, projectId, entidadeRefId, idClasse, source}).
- Fase A replicada (auto-suficiente) — roda DVincula antes só por conveniência; idempotente.

**Validação (banco dev OFFLINE — NÃO rodar ao vivo):** `npx tsc --noEmit` = 0 erros no script novo (baseline 25 erros TODOS em *.spec.ts de outros módulos — confirmar com `Select-String "error TS" | Select-String "\.spec\.ts" -NotMatch` → vazio). `npx eslint <arquivo> --max-warnings 0` = EXIT 0. eslint-disable replicado: `no-console` no log(), `@typescript-eslint/no-explicit-any` no `...args: any[]`. Sem jest (scripts backfill não têm spec, validados por dry-run ao vivo do CEO — paridade com entidades/default-folders/priority).

**GOTCHA PowerShell:** `npx tsc --noEmit 2>&1 | Select-String` faz o tool reportar erro (NativeCommandError wrapping em PS 5.1) e cancela calls paralelas. Capturar em `$out = npx tsc --noEmit` SEM `2>&1`, depois filtrar `$out`.
