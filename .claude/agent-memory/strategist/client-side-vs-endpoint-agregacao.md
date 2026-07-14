---
name: client-side-vs-endpoint-agregacao
description: Critério para decidir client-side vs endpoint agregado no backend quando um KPI/métrica precisa de dados de múltiplos usuários/projetos além do escopo já carregado pela tela.
metadata:
  type: project
---

Decisão tomada na Task 8 (plan-pontualidade-margem-atraso-task8.md, Frontend-V2):
métrica de pontualidade ("margem de atraso") foi resolvida de forma HÍBRIDA —
recorte "por usuário logado" ficou client-side (reaproveita `tasks` já
carregado pelos hooks de `assigned/page.tsx`, mesmo padrão do KPI Ritmo);
recorte "por projeto" (soma de tasks de TODOS os assignees de um projeto)
virou endpoint novo no backend, sub-rota do `TasksController` já existente
(`GET /tasks/projects/:projectId/punctuality`), Prisma direto + SQL de
agregação (`AVG`), sem Engine, sem tabela nova — seguindo o precedente já
aprovado de `GET /tasks/:id/metrics` (`PhaseMetricsService`).

**Critério geral para decidir (aplicar em métricas futuras):**
1. O dado cabe 100% no array já carregado pelo hook da tela (mesmo escopo
   de usuário/time que o usuário já está vendo)? → client-side, `useMemo`
   puro, sem tocar backend (padrão do KPI Ritmo).
2. O recorte precisa de dados de MÚLTIPLAS pessoas/múltiplos projetos que
   nenhum hook existente carrega, e o volume cresce sem teto natural (ex:
   "todas as conclusões históricas de um projeto", sem janela temporal
   curta)? → endpoint agregado no backend (SQL `AVG`/`COUNT`/`GROUP BY`),
   como sub-rota do controller de domínio já existente, Prisma direto.
   NÃO tentar mitigar subindo `limit` no frontend.

**Why:** `@Max(100)` em `ListTasksQueryDto.limit` é hard cap real e ativo.
Uma tentativa anterior (durante a task do KPI Ritmo) de elevar `limit` de
100 para 250 nos hooks do frontend **quebrou a listagem em produção e foi
revertida** (comentário permanente em `use-tasks.ts` linha ~88-92 do
Frontend-V2, `useMyTasks`). Isso fecha definitivamente "elevar limit" como
mitigação viável para qualquer feature futura que precise de mais volume —
a mitigação correta é mover o cálculo que exige volume para o backend,
onde a agregação SQL roda sobre todas as linhas de uma vez, sem paginação.

**How to apply:** ao planejar qualquer KPI/métrica novo nas telas do
Frontend-V2, primeiro perguntar "esse recorte específico precisa de dados
que já não estão no array que a tela carregou?" — se sim E o volume não
tem teto natural (não é uma janela curta tipo "últimas 4 semanas"), ir
direto para endpoint agregado; não propor "subir o limit" como alternativa,
nem em rascunho. Ver também [[padroes-engine-dvfs-build-reference]] para o
padrão de onde colocar agregações Prisma direto (sub-rota de controller de
domínio, não controller genérico `/entidades`/`/tabelas`).
