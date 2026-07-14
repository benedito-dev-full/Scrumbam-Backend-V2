# Strategist Agent Memory — Scrumban-Backend-V2

**Versão:** 1.8 · **Última atualização:** 2026-07-13 (merge de duas máquinas: unificação Nexus⇄MCP + plans MCP create_* / delay-justification / Pontualidade)

**Estado atual:** Unificação Nexus⇄MCP (DEV-154, ADR-V2-079) COMPLETA (Ondas 0–6); F4 Cache/Contexto COMPLETA (DEV-174). Cronograma 24 semanas. Família depende — corda justa.

## Índice de tópicos
- [referencia-v2-nucleo.md](referencia-v2-nucleo.md) — Núcleo estável: 3 Pilares, 17 tabelas, mapa das 17 fases, 14+ ADRs, conflitos do seed, faixas do seed, stack técnico, docs-chave, top 5 riscos. Consultar sempre que faltar contexto estrutural.
- [v2-canonical-knowledge.md](v2-canonical-knowledge.md) — SEMENTE: regras inegociáveis, 3 Pilares, 17 tabelas, mapa 17 fases, ADRs, conflitos §3.3, ranges seed, stack, docs-chave, top-5 riscos. **Ler antes de qualquer plan.**
- [plans-history.md](plans-history.md) — Histórico de plans entregues (decisões-chave por task) + padrões F2 + decisão Bookmarks DVincula -187.
- [historico-plans-f2-f6-bookmarks.md](historico-plans-f2-f6-bookmarks.md) — Histórico de plans F2/F3/F6/Bookmarks/Remoção Sprint + padrões estabelecidos em F2.
- [client-side-vs-endpoint-agregacao.md](client-side-vs-endpoint-agregacao.md) — Critério: dado já no array carregado → client-side; recorte multi-usuário/multi-projeto sem teto de volume → endpoint agregado (Prisma direto, sub-rota do controller de domínio). `@Max(100)` é hard cap real; subir `limit` já quebrou produção 1x.
- [mcp-scope-catalog.md](mcp-scope-catalog.md) — ADR-V2-068: catálogo 6 scopes (tasks:read/write, notifications:read/write, projects:write, executions:create), privilege escalation via role, grandfathering one-shot.
- [mcp-camada-a-rbac-facts.md](mcp-camada-a-rbac-facts.md) — Admin não vê workspace via MCP: Camada A desliga sem organizationId; getProjectRole já tem herança; fix em 3 reads de ProjectsService.
- [mcp-tools-extension-facts.md](mcp-tools-extension-facts.md) — MCP server (6 tools de leitura): router posicional, projects:write só update_project, MCP sem org JWT, services a reusar.
- [mcp-create-project-facts.md](mcp-create-project-facts.md) — Tool create_project: resolução de org sem token (resolveOrgIdsForUser private→public), CreateProjectDto sem `source`, router re-lança Nest exceptions, 22→23 tools, ADR-V2-070.
- [mcp-create-from-template-facts.md](mcp-create-from-template-facts.md) — Tool create_from_template: createFromTemplate exige org, resolução por presença de idPai, autorização de origem grátis (global/org-scoped, sem MANAGER na origem), 23→24 tools.
- [phase-hierarchy-pattern.md](phase-hierarchy-pattern.md) — Padrao de hierarquia auto-referencial via idPai em DTask para Fases/Blocos (ADR-V2-047).
- [dados-json-merge-conventions.md](dados-json-merge-conventions.md) — Merge seletivo (DProject) vs raso (DTask) em `dados Json`; idClasses -350..-353.
- [dvincula-fk-exige-dentidade.md](dvincula-fk-exige-dentidade.md) — DVincula FK exige DEntidade nos 2 lados; NUNCA gravar DProject.chave; usar DEntidade-espelho PROJECT_REF (ADR-V2-058, plan fk-systemic-fix).
- [delay-justification-facts.md](delay-justification-facts.md) — Justificativa de Atraso: motivos=DClasse -530..-537, justificativa=DEvento -503; idEntidade=autor, identificadorExterno=taskId; painel via $queryRaw jsonb (ADR-V2-070).
- [worksession-badge-lock-facts.md](worksession-badge-lock-facts.md) — Task #794: badge "em trabalho" + trava MCP via workSessions; agentId=movedBy vs ctx.dEntidadeId; guard MCP-only nos 5 tools de escrita.
- [worksession-collision-ui-795-facts.md](worksession-collision-ui-795-facts.md) — Task #795: confirm-dialog humano (frontend-only, zero backend); 4 superfícies move→EXECUTING + 3 reatribuir; guard de reatribuir é o que realmente dispara.
- [dedup-detection-799-facts.md](dedup-detection-799-facts.md) — Task #799: detecção de duplicata; método único SearchService.findPossibleDuplicates (reusa #791); GET /tasks/check-duplicates (UI) + possibleDuplicates[] no MCP create_task (não bloqueia).

## Instruções de uso
- Consultar `referencia-v2-nucleo.md` / `v2-canonical-knowledge.md` ANTES de criar qualquer plan (contexto estrutural: 3 Pilares, 17 tabelas, fases, ADRs, seed).
- Registrar decisões novas ao concluir cada task (novo topic file + 1 linha no índice).
- Índice é índice: 1 linha/entrada, <140 linhas. Detalhe sempre em `<topic>.md`.
- Memory é injetada automaticamente no system prompt (`memory: project`).

---

## ESTADO ATUAL

**Scrumban-Backend-V2** é a refundação canônica do Scrumban legado, sob o template Devari-Core.
**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Cronograma:** 24 semanas (otimista 20, pessimista 29). **Família depende. Corda justa. Sem afrouxar.**

Regras críticas não-negociáveis (ZERO tabela nova, Engine só em DPedido -300,
Seed primeiro, endpoints genéricos reusados, score gate ≥7.0, escopo =
Scrumban-hoje) — ver `referencia-v2-nucleo.md` para o detalhe completo.
