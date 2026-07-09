---
name: plans-history
description: Histórico de plans entregues pelo Strategist (decisões-chave por task) + padrões estabelecidos em F2 + decisão Bookmarks.
metadata:
  type: project
---

# Histórico de Plans Produzidos

| Task | Plan | Decisões-chave |
|------|------|----------------|
| F2-Task1 | plan-endpoints-genericos-f2-task1.md | Pilar 2: 3 controllers genéricos. ZERO controller específico. ADR-V2-015 wrapper `?classe=NOME` + LRU 5min + Deprecation header. ClasseController read-only. Eventos inline até F7. ADR-V2-025 BigInt serialization. |
| F3-Task1 | plan-auth-rbac-f3-task1.md | AuthCompositeGuard ordem MCP→API Key→JWT. RoleResolver LRU 5min. Refresh com rotação estrita. MCP key DTabela(-472), API key DTabela(-471). @SkipGuard tombstone. |
| F6-Task1 | plan-engine-operacao-execucao-claude-task1.md | Pilar 1: Operacao base + OperacaoPedido + OperacaoExecucaoClaude. Migration chcriacao_seq START 1000000. DVFS `chaveScript INTEGER` nunca `s.id` (ADR-V2-016). Scripts em -300. 2 testes regressivos R-CHAVE-5/7 bloqueantes. |
| F6-Task2 | plan-f6-executions-task2.md | matchedPatterns→Array<{pattern,level}>. approve() $executeRaw race-safe (409 ConflictException). Sweeper @Cron findMany+filter. rollback re-passa Risk Gate. ExecutionAccessGuard via DVincula -171. 50 patterns adversariais (25H/15M/10L). |
| Bookmarks-D1 | plan-bookmarks-feature-task1.md | DVincula -187 BOOKMARK (CEO; DBookmark tabela própria ABANDONADO). idLocEscritu=user, idEntidade=target, metaDados.targetType. Dedup lógica no service. Reativa soft-deleted. 3 endpoints GET/POST/DELETE. Zero seed novo. |
| RemoveSprint-Task1 | plan-core-remocao-sprint-hard-delete-task1.md | HARD DELETE Sprint (CEO). Revoga ADR-V2-009, propõe -060. Refatorar velocity/forecast p/ janela temporal pura (fallback throughput/rolling-30d já existia). Migration destrutiva DROP idSprint+índice. Seed -400 removido (131→130). 3 perguntas bloqueantes ao CEO. ~16h. |
| MCP-RBAC-Task1 | plan-mcp-rbac-admin-org-visibility-task1.md | Admin não vê workspace via MCP. Fix Camada A nos 3 reads de ProjectsService (findMany/findAccessibleProjectIds/findOne) só no ramo sem organizationId. Reusa listPublicSpaceProjectIds + herança de getProjectRole. Público apenas (leak-free). ADR-V2-069 estende -042. Zero tabela/DClasse/tool tocado. Ver mcp-camada-a-rbac-facts.md. |

# Padrões Estabelecidos em F2
- Serialização BigInt: `format-*-response.ts` por módulo (ou interceptor global — ADR-V2-025).
- LRU cache compartilhado: `src/common/helpers/lru-cache.ts` (max 200, TTL 5min) p/ alias `?classe=NOME`.
- Validação DClasse: `prisma.dClasse.findFirst({ where: { chave, excluido: false } })` antes da query principal → 404.
- `@SkipGuard()` em controllers F2 → F3 substituiu por guards reais.
- Tree builder: 1 findMany + Map em memória, NUNCA N+1.
- `?idClasse` obrigatório em GET /entidades e /tabelas em F2.

# Bug latente registrado
- `projects.service.ts:~895` usava `dVincula.idEntidade = projectId` (FK p/ DEntidade recebendo ID de DProject). Resolvido sistemicamente por ADR-V2-058 (DEntidade-espelho PROJECT_REF) — ver dvincula-fk-exige-dentidade.md.
