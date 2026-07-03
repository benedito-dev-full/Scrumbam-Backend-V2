# ADR-V2-069: Camada A (espaços públicos) no caminho MCP — paridade de visibilidade com o HTTP

**Status:** Aceito
**Data:** 2026-07-03
**Decisores:** Strategist Agent V2, CEO (ratificado 2026-07-03)
**Tags:** #V2 #fase-F11 #mcp #rbac #visibilidade #camada-a #espacos-publicos
**Estende:** ADR-V2-042 (tenant isolation), ADR-V2-051 §8 (Camada A / espaços públicos), ADR-V2-003 (RBAC duplo via DVincula)

---

## Contexto e Problema

Um usuário **ORG_ADMIN** (DVincula `idClasse=-161` sobre a org) gera uma chave MCP
"com acesso total", mas ao usar as tools MCP **só enxergava os projetos que ele
mesmo criou** — não a workspace inteira. Pelo HTTP autenticado, o mesmo admin vê
todos os espaços/listas **públicos** da org.

### Causa raiz

A leitura de projetos em `ProjectsService` tem duas camadas de visibilidade:

```
findMany / findAccessibleProjectIds / findOne
  ├─ Camada B  → DVincula direta de projeto (-171/-172/-173)   ── liga SEMPRE
  └─ Camada A  → projetos em SPACEs públicos da org (ADR-V2-051 §8)
                 + herança ORG_ADMIN→MANAGER (myRole)           ── ligava SÓ com organizationId
```

| Caminho | Passa `organizationId`? | Resultado |
|---|---|---|
| HTTP `GET /projects` (`projects.controller.ts`) | Sim (`req.user.organizationId` do JWT) | Camada A liga → admin vê a org pública |
| MCP `list_projects` → `findMany(ctx.dEntidadeId, {...})` | **Não** (MCP é cross-org, sem token de org) | Camada A nunca ligava → só Camada B (membership direto) |

O **criador** de um projeto vira MANAGER via `createManagerLink()` → tem DVincula
-171 → Camada B sempre o enxerga. Por isso "quem cria vê", mas "admin que não
criou não vê". A assimetria é entre **leitura** (exigia `organizationId`) e
**autorização de escrita** (`RoleResolverService.getProjectRole` já resolvia
herança de admin sem token de org, derivando de `project.idEstab`).

---

## Alternativas Consideradas

### Opção A — Enriquecer `McpUserContext` com `adminOrgIds[]` no guard/cache
Resolver as orgs-admin no `McpKeyService` e propagar via contexto para cada tool.

**Contras:** acopla RBAC à camada de auth MCP; **staleness** (cache de key 30s);
churn de assinatura nos 3 métodos + edição das 9 tools; o `findOne` por-projeto nem
precisa da lista de orgs (deriva de `idEstab`). **Rejeitada.**

### Opção B — Admin vê também projetos PRIVADOS das orgs onde é ORG_ADMIN
Incluir `DProject WHERE idEstab IN adminOrgIds` inclusive privados, espelhando
`resolveOrgAdminRole` (admin = MANAGER de tudo).

**Contras:** **diverge do HTTP** (que só mostra públicos via Camada A); expõe, via a
chave MCP do admin, **projetos privados de outros membros** da própria org. Maior
superfície de risco. **Rejeitada** — a decisão do CEO é replicar o comportamento da
web: privado só com vínculo direto.

### Opção ESCOLHIDA — Ativar a Camada A pública no caminho MCP
Ligar a Camada A no ramo "sem org", derivando o contexto de org das **memberships**
do usuário (e por-projeto no `findOne`, via `project.idEstab`).

---

## Decisão

Ativar a **Camada A pública** nos três métodos de leitura de `ProjectsService`
quando `organizationId` está ausente (caminho MCP), com **paridade exata com o
comportamento da web**:

1. **`findMany(userEntidadeId)` sem org:** derivar orgs via `resolveOrgIdsForUser`,
   unir ao conjunto os projetos de SPACEs públicos dessas orgs; `myRole = MANAGER`
   para projetos cujo `idEstab` ∈ orgs onde o usuário é ORG_ADMIN, senão `MEMBER`.
2. **`findAccessibleProjectIds(userEntidadeId)` sem org:** unir Camada B (membership
   direto) ∪ Camada A (públicos de todas as orgs do usuário) via
   `listPublicSpaceProjectIdsForOrgs` (CTE recursiva única — N+1 ZERO).
3. **`findOne(id, userEntidadeId)` sem org:** conceder acesso a espaço público
   derivando a org de `project.idEstab`; projeto **privado** sem membership continua
   `Forbidden` (idêntico ao HTTP).

**Helpers adicionados:**
- `ProjectsService.resolveOrgIdsForUser(userEntidadeId, { adminOnly? })` — distinct
  `idLocEscritu` de DVincula de org (`-161/-162/-163`, ou só `-161`).
- `listPublicSpaceProjectIdsForOrgs(prisma, orgIds[])` em `public-space.util.ts` —
  variante em lote de `listPublicSpaceProjectIds`.

**Superfície:** 3 métodos + 2 helpers em `ProjectsService`/`public-space.util.ts`.
**Zero tool MCP alterada** — conserta 9+ tools de uma vez (`list_projects`,
`list_tasks`, `get_project`, `get_task_tree`, `get_project_metrics`, `list_members`,
`search_tasks`, `get_task`, `list_blocks`, `list_block_tasks`). Zero mudança no
caminho HTTP (ramo com `organizationId` intocado).

---

## Consequências

### Positivas
- **Paridade com o HTTP:** MCP entrega a mesma Camada A pública que a web, só mudando
  a fonte do contexto de org (memberships vs `organizationId` do JWT).
- **Leak-free por construção:** Camada A só expõe SPACEs **públicos** de orgs às quais
  o usuário **pertence**. Privados nunca entram por Camada A; orgs alheias nunca
  entram.
- **DRY / Pilar 2:** reusa a lógica de espaço público e a herança de admin já
  existentes; não duplica RBAC.
- **Coerência:** alinha a leitura ao que `getProjectRole` já autoriza para escrita.

### Negativas / Limites
- Admin **não** vê espaços privados de terceiros via MCP (por decisão — paridade com a
  web; privado exige vínculo direto). Se um dia for necessário, é a Opção B.

---

## Rastreabilidade

- **Plano:** `workspace/plans/plan-mcp-rbac-admin-org-visibility-task1.md`
- **Zero tabela nova / zero DClasse nova** (ADR-V2-001 respeitado).
- **Testes:** +11 specs em `projects.service.spec.ts` (Camada A no caminho MCP),
  todos verdes.
