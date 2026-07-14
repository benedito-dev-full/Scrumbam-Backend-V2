---
name: mcp-rbac-camada-a-sem-token-adr069
description: ADR-V2-069 — liga a Camada A (espaços públicos) no caminho MCP/sem-token derivando org das memberships; fix RBAC em ProjectsService (findMany/findAccessibleProjectIds/findOne)
metadata:
  type: project
---

# ADR-V2-069 — Camada A no caminho MCP (ProjectsService leitura sem org)

Fix do bug: ORG_ADMIN/membro via chave MCP só via projetos onde tinha DVincula direta (Camada B), não a workspace. Causa: os 3 métodos de LEITURA de `ProjectsService` desligavam a Camada A quando `organizationId` ausente (MCP não tem org de token). Guards de ESCRITA já resolviam herança via `RoleResolverService.getProjectRole` (deriva org de `project.idEstab`).

**Why:** decisão CEO 2026-06-25 — paridade plena MCP↔HTTP, leak-free (só públicos).
**How to apply:** ao mexer em visibilidade de projeto no caminho sem-org, derive o contexto de tenant das *memberships* do usuário (não exija organizationId).

## Decisões CEO (implementadas EXATAMENTE)
1. `adminOnly=false`: Camada A liga para QUALQUER membro de org (-161/-162/-163), não só ADMIN. `myRole=MANAGER` só p/ orgs onde é ADMIN; demais = MEMBER.
2. Somente PÚBLICOS (`privado=false`). Privado só via membership direto (Camada B). Zero vazamento de org alheia.

## Superfície (só `src/projects/`, zero arquivo de tool tocado, zero schema/seed/DClasse)
- `utils/public-space.util.ts`: NOVO `listPublicSpaceProjectIdsForOrgs(prisma, orgIds[])` — variante batch (1 CTE, `idEstab IN (${Prisma.join(orgIds)})`; guard `orgIds.length===0 → []`). Importa `Prisma` de `@prisma/client`.
- `projects.service.ts`:
  - NOVO helper privado `resolveOrgIdsForUser(userEntidadeId, { adminOnly })` → `bigint[]` distinct (1 query DVincula ORG_ROLE_CLASSES / só -161). Dedupe via `new Set(bigint)` (BigInt compara por valor em Set).
  - `findAccessibleProjectIds` ramo `!organizationId`: era `return candidateIds`; agora une Camada B ∪ `listPublicSpaceProjectIdsForOrgs(resolveOrgIdsForUser(uid))`.
  - `findMany` ramo `orgIdBig===undefined` (novo `else`): troquei boolean `isOrgAdmin` por `adminOrgIdsSet: Set<string>`; no-org consulta `dProject WHERE idEstab IN orgIds AND privado=false` (mesma forma FLAT do branch org-present, NÃO a CTE) + adminOrgIds p/ herança. `myRole` agora per-projeto: `p.idEstab ∈ adminOrgIdsSet ? MANAGER : explicitRole ?? MEMBER` (byte-equiv ao antigo no HTTP pois página org-present tem idEstab=orgIdBig).
  - `findOne`: NÃO mudou o corpo. Mudei os 2 helpers que ele chama → passaram a derivar org de `project.idEstab` quando sem token:
    - `hasPublicSpaceAccess(project: {chave; idEstab?}, ...)`: orgIdBig = token (válido) OU `project.idEstab`; null → false. Mantém check público + membership da org dona.
    - `isOrgAdminForProject`: idem; com token mantém coerência de tenant (`idEstab===orgIdBig`), sem token usa `idEstab`.

## Paridade por-método (importante)
- `findMany` no-org espelha `findMany` org-present = FLAT `privado=false` (não CTE).
- `findAccessibleProjectIds`/`findOne` no-org espelham seus branches org-present = CTE `isProjectPubliclyVisible`/`listPublicSpaceProjectIds*`. Essa divergência flat-vs-CTE entre métodos JÁ existia no código — mantida (paridade-com-HTTP por método).

## Callers no-org (auditados)
- MCP tools (todos) e Telegram `status.handler`/`tasks.handler` chamam `findAccessibleProjectIds(uid)` SEM org → ganham Camada A. Leak-free → melhoria consistente (Telegram passa a ver tasks de espaço público da org, igual web).
- comments/realtime/ai SEMPRE passam `organizationId` → org-present, intocados.

## GOTCHAS de teste (projects.service.spec)
- Mocks de `findMany` no-org usam sequência `mockResolvedValueOnce` de `dVincula.findMany`. Inserir UM call de `resolveOrgIdsForUser(all)` ENTRE roles(Camada B) e team-links. Se orgIds=[] → short-circuit (não chama adminOnly nem dProject público). Só precisei consertar 1 teste ("blindagem sem idClasse") = único net-new regression; demais 8 vermelhos são PRÉ-EXISTENTES (fixtures `dTask.groupBy`/`dTabela.findMany` ausentes, commit 7c23cd4 — confirmado por stash).
- `findOne` no-org com vinculo presente e `idEstab=null` (mockProject) → `isOrgAdminForProject` retorna false ANTES de query (idEstab null) → não consome mock extra → testes findOne existentes intactos.
- Sequência de `dVincula.findFirst` em findOne no-org público: [vinculo, teamLink, folderLink, hasPublicSpaceAccess-membership, isOrgAdminForProject-admin]. `$queryRaw` = isProjectPubliclyVisible (chain com SPACE -350).
- 11 specs novos (4 findAccessibleProjectIds + 3 findMany + 4 findOne). Zero net regressão: projects.spec 8 fail(=baseline)/84 pass; mcp 4 suites fail(=baseline); telegram specs não-compilam(=baseline arity).

## Build/lint gate
- Gate = `npx tsc --noEmit` (0 nos meus arquivos; 48 baseline em specs/realtime/ai). `npm run build` (nest build) falha SÓ por deps ausentes em `src/ai/providers` (@anthropic-ai/sdk, openai) + `src/realtime` (@nestjs/websockets, socket.io) — não meus. eslint hook roda a CADA Edit e BLOQUEIA: import novo sem uso quebra → adicionar import+consumidor no mesmo passo lógico (fiz import→função em 2 edits, hook reclamou do 1º mas edit persiste).
