---
name: delay-justification-fase2-backend
description: Fase 2 (Painel Admin) da Justificativa de Atraso — agregação $queryRaw org-scoped, history, índice parcial jsonb. Estende src/delay-justifications/.
metadata:
  type: project
---

# Justificativa de Atraso — Fase 2 (Painel Admin) BACKEND (ADR-V2-070)

Continuação de [[delay-justification-fase1-backend]]. F2 = agregação para o painel do admin + histórico + índice. Tudo no MESMO módulo `src/delay-justifications/` (NÃO em `src/reports/`).

**Why:** coesão — o conhecimento do payload de `DEvento -503` fica num único módulo; espalhar em `reports` duplicaria a semântica. Desvio consciente do plano §4 (que sugeria `src/reports/delay-reasons/`), documentado no deliverable e na JSDoc do módulo.

**How to apply:** ao estender esta feature (ex.: export CSV, drill-down), continuar em `src/delay-justifications/`. A rota é declarada com `@Controller()` + path completo (`@Get('reports/delay-reasons')`), padrão dos outros endpoints do módulo — não usa prefixo de `@Controller('...')`.

## Endpoints entregues
- `GET /reports/delay-reasons?groupBy=&userId=&projectId=&motivoClasse=&from=&to=` — `DelayReasonsController`/`DelayReasonsService`. `groupBy` ∈ `motivo|usuario|projeto` (obrigatório). **org ADMIN (-161) SOMENTE**.
- `GET /tasks/:taskId/delay-justification/history` — método `getHistory` no service/controller da F1. RBAC = assignee OU org ADMIN (reusa `assertCanAccess` da F1, "igual à Fase 1"). Retorna todas as versões (vigente+superseded) ordenadas por `version` desc, com flags `isVigente`/`supersededBy`.

## Agregação (padrão canônico reutilizável)
- `$queryRaw(Prisma.sql\`...\`)` — 1 query de agregação + 1 query batch de rótulos = ZERO N+1. Padrão espelha `src/tasks/services/punctuality-metrics.service.ts` (Prisma.join(filters,' AND ',' AND ',''), Prisma.empty quando sem filtro).
- **groupBy dinâmico sem injeção:** mapa estático `GROUP_COLUMN: Record<groupBy, Prisma.Sql>` (fragmento fixo em código); `groupBy` só indexa o mapa (validado por @IsIn). Valores (org/user/motivo/datas) vão como bind params.
- **Escopo de tenant OBRIGATÓRIO:** `INNER JOIN DProject p ON p.chave = (e."metaDados"->>'projetoId')::bigint AND p.excluido=false` + `WHERE p.idEstab = orgId`. Sem isso, admin da org A veria org B. Consequência: justificativas de tasks SEM projeto não entram no painel (não há org a atribuir).
- **org-alvo:** se `projectId` filtrado → org = `DProject.idEstab` desse projeto (404 se projeto não existe); senão → `req.user.organizationId` do JWT (403 se ausente). Depois valida `roleResolver.getOrgRole(requester, orgId) === 'ADMIN'` (403 caso contrário). NUNCA `getProjectRole`/MANAGER (CEO decisão 3).
- **Tipos de retorno do driver:** `COUNT(*)::int` → number; `AVG(numeric)` → **string | null** (normalizar com Number + Math.round(x*10)/10). Casts: `->>` dá text → `::numeric`/`::bigint`.
- Response shape estável p/ o front (gaveta pede os 3 cortes trocando só groupBy): `{ groupBy, orgId, total, groups:[{key,label,count,avgDelayDays}], filters }`. `label` resolvido em batch: motivo→DClasse.nome, usuario→DEntidade.nome, projeto→DProject.nome (null se não resolvido).

## Migration (ZERO tabela nova)
- `prisma/migrations/20260709000000_add_devento_delay_reason_agg_idx/migration.sql` — índice **parcial de expressão** `DEvento_delay_reason_agg_idx` sobre `WHERE idClasse=-503 AND excluido=false`, colunas `((metaDados->>'projetoId')), idEntidade, ((metaDados->>'motivoClasse')), criadoEm`. Idempotente `IF NOT EXISTS`; down como comentário (`DROP INDEX IF EXISTS`) — padrão V2 de migration manual (NÃO refletido em schema.prisma: partial+expression index não é expressável em Prisma).

## Gotchas
- ESLint hook (PostToolUse) roda por-edição com `--max-warnings 0` e BLOQUEIA import não-usado. Ao adicionar import, adicionar o uso na MESMA sequência de edits (imports isolados quebram o hook até o método que os usa existir).
- `npx tsc --noEmit` do repo tem ~dezenas de erros PRÉ-EXISTENTES em specs alheios (tenant-isolation.adversarial, automation/*, channels/telegram/* — Operacao arg-count e TaskResponseDto sem hasChildren/timeSpentIsRollup). NÃO são regressão; o gate real é `make build` (nest build, exclui specs) — passou exit 0.
- Build: `make build` funciona (jose já instalado nesta sessão; F1 tinha precisado `npm i jose --no-save`).

## Testes: 36 specs verdes no módulo (14 novos)
- `__tests__/delay-reasons.service.spec.ts` — RBAC 403 (MEMBER/null/sem-org), org via projectId (idEstab) vs JWT, 404 projeto, 3 groupBy c/ rótulo, eco de filtros, 1 query agregação.
- `__tests__/delay-justifications-history.service.spec.ts` — 404, 403 terceiro, admin não-assignee OK, ordenação por version desc + flags isVigente/supersededBy, findMany sem filtro `excluido`.
