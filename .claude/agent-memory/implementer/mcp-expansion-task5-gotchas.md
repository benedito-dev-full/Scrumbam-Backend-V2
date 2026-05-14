---
name: mcp-expansion-task5-gotchas
description: Gotchas e codepaths confirmados na Task #5 (list_members) da MCP Expansion — gate de tenant fica na propria tool, nao no service
metadata:
  type: project
---

# MCP Expansion — Task #5 (list_members) gotchas

**Fato:** Diferente de `TasksService.findOne` (que aceita `accessibleProjectIds`), `ProjectMembersService.getMembers(projectId: string)` NAO tem parametro de scope. A assinatura vem do controller HTTP, ja protegido por `JwtAuthGuard`. Por isso o tenant gate fica na propria tool, ANTES de chamar `getMembers`.

**Why:** `ProjectMembersService.getMembers` retorna `ListProjectMembersResponseDto` direto via `dVincula.findMany({ idLocEscritu: projectIdBigInt, idClasse: in [-171,-172,-173] })`. Sem gate prévio, qualquer usuario MCP poderia listar membros de qualquer projeto. ADR-V2-042 (defense in depth) exige validacao explicita na tool.

**How to apply:**
- Resolver `accessibleProjectIds` via `ProjectsService.findAccessibleProjectIds(ctx.dEntidadeId)` ANTES.
- Se `!accessibleProjectIds.includes(projectId)` → `throw new NotFoundException(\`Projeto ${projectId} não encontrado\`)`. Mensagem identica a projeto inexistente (anti enumeration).
- Soh depois chamar `projectMembersService.getMembers(projectId)`.
- `getMembers` NAO precisa ser modificado — o gate fica na camada de tool, nao no service.

**Codepaths confirmados:**
- `ProjectMembersService.getMembers(projectId: string): Promise<ListProjectMembersResponseDto>` — em `src/projects/project-members.service.ts:76`. Retorna `{ members: ProjectMemberDto[] }`. ZERO N+1 (1 query com `include: { entidade: { select: { chave, nome, email } } }`).
- `ProjectsModule` ja exporta `ProjectMembersService` (linha 43). Modulo MCP ja importa `ProjectsModule`. Sem changes em imports.
- `ListProjectMembersResponseDto` em `src/projects/dto/project-response.dto.ts:146` — campo unico `members: ProjectMemberDto[]`.

**Padrao "gate na tool" (template para tools que chamam services HTTP-legados):**

```typescript
const accessibleProjectIds = await projectsService.findAccessibleProjectIds(ctx.dEntidadeId);
if (!accessibleProjectIds.includes(projectId)) {
  throw new NotFoundException(`Projeto ${projectId} não encontrado`);
}
const result = await projectMembersService.getMembers(projectId);
return textResult(result);
```

Aplicavel a outras tools que vao consumir services que nao receberam refactor para receber `accessibleProjectIds` (Tasks #6, #7, #8 — get_project, update_project, get_project_metrics).

**Numerologia confirmada:**
- 7→8 tools no router/schema/spec.
- 2 construtores em `mcp-block-d.spec.ts` ganharam +1 `undefined` (linhas 84-91 + 113-124).
- Total MCP: 78 → 87 testes (1 spec novo com 9 testes).

**Hook PostToolUse:Edit (ESLint) — mesmo padrao das Tasks #1/#2:**
- Imports adicionados sem uso disparam `@typescript-eslint/no-unused-vars` no mesmo Edit. Solucao: agrupar import + uso em Edits CONSECUTIVOS (o "blocking error" intermediario nao bloqueia o estado final).
- 3 arquivos afetados: `mcp.module.ts`, `mcp-router.service.ts`, `mcp-tools.schema-consistency.spec.ts`.

Relaciona-se com [[mcp-expansion-task1-gotchas]] (padrao base), [[mcp-expansion-task2-gotchas]] (orquestracao condicional), [[tenant-isolation-adr-v2-042]].
