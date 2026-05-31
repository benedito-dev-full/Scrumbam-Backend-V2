---
name: tablefields-fase6-spec-coverage
description: tableFields Fase6 — 2 testes de cobertura no service.update() (required+null e idProject null); fluxo real do mergeCustomFieldValues
metadata:
  type: project
---

# tableFields Fase 6 — testes de cobertura service.update() (2026-05-31)

Adicionados 2 testes ao `src/tasks/__tests__/tasks.service.custom-fields.spec.ts` (4→6, todos PASS), fechando lacunas apontadas pelo Reviewer da Fase 6. ZERO mudança de produção.

**Why:** Reviewer F6 apontou que `mergeCustomFieldValues` (privado em tasks.service.ts) + `validateFieldValues`/`assertRequiredFieldValues` (de `src/tasks/table-fields/field-value.validator.ts`) já cobertos a nível unitário, mas faltavam testes de INTEGRAÇÃO no `service.update()` exercendo (a) required recebendo null e (b) task sem projeto.

**How to apply:** ao mexer em colunas customizáveis, espelhar o padrão do spec — mocks `prisma.dTask.findFirst/update` + `prisma.dProject.findFirst`, helpers `makeTask()`/`tableFields()`, asserts `.rejects.toThrow(BadRequestException)` + `expect(prisma.dTask.update).not.toHaveBeenCalled()`.

## Fluxo REAL confirmado em tasks.service.ts (fonte de verdade)
- `mergeCustomFieldValues` (l.227): **1º** `if (!projectId) throw new BadRequestException('Task sem projeto nao aceita dados.fields customizaveis')` (l.232-233) — ANTES de `dProject.findFirst`. Logo o teste "idProject null" NÃO precisa mockar `dProject.findFirst`.
- Schema lookup usa `this.prisma.dProject.findFirst({ where: { chave: projectId, excluido: false }, select: { tableFields: true } })` — NÃO `findUnique`. O mock deve retornar `{ tableFields: { version, columns } }`. Helper `tableFields(columns)` já monta `{ version: 1, columns }`.
- Required+null: `validateFieldValues` (field-value.validator.ts l.64-66) lança quando uma coluna `required:true` recebe `null` — exceção sobe ANTES do `dTask.update`.
- Call site em `update()` (~l.876): `if (hasOwnKey(dto.dados,'fields'))` → `mergeCustomFieldValues(existing.idProject, dadosAtuais, incomingFields)` ANTES de `prisma.dTask.update`. Em ambos cenários novos a exceção sobe antes do update → `not.toHaveBeenCalled()` vale.

## Gotchas ambiente (confirmados nesta sessão)
- **Harness retornou outputs VAZIOS/espúrios e CANCELOU calls paralelas em cascata** quando 1 Bash falhou (findstr com path Windows quebrou e cancelou ~15 calls irmãs, incluindo Edit/Write/Read que reportaram "success" mas NÃO persistiram). Confirmar SEMPRE com `git status`/`Test-Path` após Write/Edit; refazer o que não persistiu. NÃO usar findstr/Bash com paths Windows com espaços.
- Baseline `npx tsc --noEmit` = **14 erros pré-existentes** (exit 2; tenant-isolation.adversarial×6, gemini.provider, agents-heartbeat/install, execution-result/ttl-cache/execution-run.processor specs). ZERO novos no spec (custom-fields hits=0). NÃO rodar build (gemini dep `@google/generative-ai` ausente + banco offline). Gate = jest do spec (6/6 PASS) + tsc --noEmit (14 baseline).
