---
name: delay-justification-fase1-backend
description: Fase 1 backend da Justificativa de Atraso (DEvento -503 + motivos DClasse -530..-537, ADR-V2-070) — módulo src/delay-justifications, RBAC assignee|org-ADMIN, overdue por dia TZ Brasil
metadata:
  type: project
---

# Justificativa de Atraso — Fase 1 BACKEND (ADR-V2-070, 2026-07-09)

Módulo NOVO `src/delay-justifications/` (controller+service+overdue.util+3 DTOs+README+2 specs). Plano canônico: `workspace/plans/plan-eventos-justificativa-atraso-task1.md`.

**Why:** capturar o PORQUÊ de tarefas atrasadas (radio de motivo obrigatório + texto opcional) na aba "Em atraso".
**How to apply:** ao mexer nessa feature ou em DEvento versionável por supersede, seguir este padrão.

## Seed (Pilar 3, primeiro) — `prisma/seeds/classes.seed.ts`
- `-503 DELAY_JUSTIFICATION` (idPai -3 EVENTOS) inserido na zona DEvento após -502.
- `-530 DELAY_REASON` **agrupador (agrupamento=true, idPai -51 TABELAS)** + folhas `-531..-537` (idPai -530) inseridas após -527 RISK_LEVEL_HIGH.
- `-503`/`-530..-537` estavam LIVRES (confirmei via grep antes). Total 157→**166** (45 fixas + 121 especificas). COUNTS é dinâmico (não hardcoded) — nenhum teste de contagem quebra. Validado por `npx ts-node --transpile-only -e "require('./prisma/seeds/classes.seed')"` (validateHierarchy roda no import). Atualizei os comentários de cabeçalho (112→121, -527→-537, 157→166) + ADR list.
- GOTCHA: seed usa helper `esp(chave,codigo,nome,idPai,agrupamento=false)` — não literal `chave:`. `/seed-validate` (grep chave:) não pega; use jest prisma/seeds (12 pass).

## Storage — DEvento -503 (padrão TASK_COMMENT -507, Pilar 1 NÃO se aplica)
- `idEntidade`=autorId (DEntidade), `identificadorExterno`=taskId (string, SEM FK — ADR-V2-058 taskId NÃO cabe na FK idEntidade→DEntidade; erro = 500), `descricao`=texto, `metaDados`={taskId,motivoClasse,texto,projetoId,autorId,delayDays,delayKind,version,supersededBy}.
- **Supersede**: editar = `$transaction`[ updateMany(vigentes excluido=false → excluido=true) → create nova (excluido=false) → update old set metaDados.supersededBy=novo.chave ]. Vigente = única excluido=false. version = (vigente.metaDados.version||0)+1. Ordem: updateMany ANTES do create (senão o novo excluido=false seria pego). Linka old→new só quando editou.
- Ler vigente: findFirst {idClasse:-503n, identificadorExterno:taskId, excluido:false} (índice `(idClasse, identificadorExterno)` existe no schema).

## RBAC (CEO decisões 1+3, TRAVADAS) — service `assertCanAccess`
- Autoriza: `task.idAssignee === requester` (bigint===bigint OK) OU **org ADMIN (-161)** via `RoleResolverService.getOrgRole(requester, project.idEstab)==='ADMIN'`. Senão 403.
- **Project MANAGER (-171) NÃO autoriza** — por isso NÃO usar `getProjectRole` (ele herda ORG_ADMIN→MANAGER e daria falso-positivo). Uso `getOrgRole` direto.
- DESVIO JUSTIFICADO do plano: org-alvo = **org DONA do projeto** (`DProject.idEstab`), não "org ativa" do JWT — evita vazamento cross-tenant. Só consulta org quando NÃO-assignee (curto-circuito).

## overdue.util.ts (puro, recebe TimezoneService — sem DI; spec faz `new TimezoneService()`)
- `computeOverdue({dueDate,dados,atualizadoEm}, tz, now=new Date())` → {isOverdue,delayKind:'OPEN'|'COMPLETED_LATE'|null,delayDays}. Por DIA de calendário TZ Brasil (dayDiff via `tz.toStartOfDayBrazil` → Math.round(diff/86400000); Brasil sem DST desde 2019).
- COMPLETED = state∈{DONE,VALIDATING,VALIDATED} (incluí VALIDATING além de DONE/VALIDATED do plano — fiel à nota de que doneAt persiste; documentei). Dia de conclusão cascata: `dados.telemetry.doneAt`→`dados.v3.movedAt`(se DONE/VALIDATED)→`atualizadoEm`.
- pending-count = 2 queries (dTask.findMany assignee+dueDate not null [+idProject], filtra overdue em memória; depois 1 dEvento.findMany identificadorExterno IN lote → Set). assigneeId SEMPRE do JWT nunca input.

## Endpoints (controller `@Controller()` sem prefixo, paths completos p/ conviver /tasks e /me)
- POST/GET `/tasks/:taskId/delay-justification`, GET `/me/delay-justifications/pending-count?projectId=`. Guard `AuthCompositeGuard`. req.user.entidadeId JÁ é DEntidade (não usar getEntidadeIdFromUserGroup). Radio de motivos = REUSO `GET /classes?idPai=-530` (Pilar 2, zero controller).
- Evento pós-persistência `delay.justified` (add em EVENT_TYPES + `'delay.justified':-489` no TYPE_TO_CLASSE do audit-log.consumer — reusa AUDIT_GENERIC, NÃO -503 senão double-count no painel).

## Wiring / build
- Módulo importa só `forwardRef(()=>AuthModule)` (exporta AuthCompositeGuard + RoleResolverService). TimezoneService/CorrelationIdService (CommonModule @Global) e EventProducerService (EventosModule @Global) — sem import. Registrado em app.module após CommentsModule.
- DTOs required usam definite-assignment `!:` (convenção do repo, senão TS2564 strictPropertyInitialization). Optional `?:`.
- **Build**: `npm run build` (nest build; NÃO há make no dev). GOTCHA baseline: build quebrava por dep `jose` DECLARADA em package.json mas NÃO instalada (env gap, igual gemini/realtime). `npm install jose@^4.15.9 --no-save` → build GREEN. tsc --noEmit: 43 erros baseline (só *.spec arity/deps), 0 nos meus arquivos. jest src/delay-justifications 22/22. eslint 0. `notification.consumer.spec` FALHA no baseline (TS2554 arity, pré-existente, não toquei).
