# Strategist Agent Memory — Scrumban-Backend-V2

**Versão:** 1.7 · **Última atualização:** 2026-07-03 (Plan MCP create_from_template — Task 3/3, última de "MCP cria estrutura"; reusa projects:write/ADR-V2-070)

**Estado atual:** F8/F11 — plan MCP RBAC (Camada A no caminho MCP) entregue, aguardando decisão CEO + Implementer. Cronograma 24 semanas. Família depende — corda justa.

## Índice de tópicos
- [v2-canonical-knowledge.md](v2-canonical-knowledge.md) — SEMENTE: regras inegociáveis, 3 Pilares, 17 tabelas, mapa 17 fases, ADRs, conflitos §3.3, ranges seed, stack, docs-chave, top-5 riscos. **Ler antes de qualquer plan.**
- [plans-history.md](plans-history.md) — Histórico de plans entregues (decisões-chave por task) + padrões F2 + decisão Bookmarks DVincula -187.
- [mcp-scope-catalog.md](mcp-scope-catalog.md) — ADR-V2-068: 6 scopes MCP (tasks/notifications/projects:write/executions:create), escalação via role.
- [mcp-camada-a-rbac-facts.md](mcp-camada-a-rbac-facts.md) — Admin não vê workspace via MCP: Camada A desliga sem organizationId; getProjectRole já tem herança; fix em 3 reads de ProjectsService.
- [mcp-tools-extension-facts.md](mcp-tools-extension-facts.md) — MCP server (6 tools de leitura): router posicional, projects:write só update_project, MCP sem org JWT, services a reusar.
- [mcp-create-project-facts.md](mcp-create-project-facts.md) — Tool create_project: resolução de org sem token (resolveOrgIdsForUser private→public), CreateProjectDto sem `source`, router re-lança Nest exceptions, 22→23 tools, ADR-V2-070.
- [mcp-create-from-template-facts.md](mcp-create-from-template-facts.md) — Tool create_from_template: createFromTemplate exige org, resolução por presença de idPai, autorização de origem grátis (global/org-scoped, sem MANAGER na origem), 23→24 tools.
- [phase-hierarchy-pattern.md](phase-hierarchy-pattern.md) — Hierarquia auto-referencial via idPai em DTask p/ Fases/Blocos (ADR-V2-047).
- [dados-json-merge-conventions.md](dados-json-merge-conventions.md) — Merge seletivo (DProject) vs raso (DTask) em `dados Json`; idClasses -350..-353.
- [dvincula-fk-exige-dentidade.md](dvincula-fk-exige-dentidade.md) — DVincula FK exige DEntidade nos 2 lados; usar DEntidade-espelho PROJECT_REF (ADR-V2-058).
- [delay-justification-facts.md](delay-justification-facts.md) — Justificativa de Atraso: motivos=DClasse -530..-537, justificativa=DEvento -503; idEntidade=autor, identificadorExterno=taskId; painel via $queryRaw jsonb (ADR-V2-070).

## Instruções de uso
- Consultar v2-canonical-knowledge.md ANTES de criar qualquer plan.
- Registrar decisões novas ao concluir cada task (em topic file; só 1 linha no índice).
- Índice é índice: 1 linha/entrada, <140 linhas. Detalhe sempre em `<topic>.md`.
- Memory é injetada automaticamente no system prompt (`memory: project`).
