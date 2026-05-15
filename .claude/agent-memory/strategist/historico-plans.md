# Strategist — Histórico de Plans Produzidos

Conteúdo migrado de `MEMORY.md` em 2026-05-15 para manter o índice ≤ 200 linhas. Adicionar aqui novos plans produzidos pelo Strategist.

---

## Plans Produzidos

| Task | Plan | Data | Decisões-chave |
|------|------|------|----------------|
| F2-Task1 | `workspace/plans/plan-endpoints-genericos-f2-task1.md` | 2026-05-08 | Pilar 2 ativo: 3 controllers genéricos (entidades/tabelas/classes). ZERO controller específico (sem UserController, SprintController). ADR-V2-015 compat wrapper `?classe=NOME` com LRU cache 5min + Logger.warn + header Deprecation/Sunset. ClasseController READ-ONLY. F2.1→F2.6 sequência com Infraestrutura Comum PRIMEIRO. Eventos inline em DEvento até F7 criar EventProducerService. ADR-V2-025 proposto para BigInt serialization strategy. `createSeller` helper canônico incluído mesmo sem uso no Scrumban V2. |
| F3-Task1 | `workspace/plans/plan-auth-rbac-f3-task1.md` | 2026-05-08 | AuthCompositeGuard ordem: MCP→API Key→JWT (mais específico primeiro). RoleResolverService: LRU in-memory TTL 5min (Redis não ativo em F3). Refresh token: rotação estrita (reuse detection). MCP Key: DTabela(-472) + hash duplicado em DUserGroup.dados.mcpKeyHash. API Key: DTabela(-471). Dívidas F2 resolvidas na Fase 1 do plano (antes de qualquer guard). @SkipGuard() tombstone após remoção. Pergunta aberta Q1 para CEO sobre OrgTenantGuard e PATH_PARAM strategy em F5. |
| F6-Task1 | `workspace/plans/plan-engine-operacao-execucao-claude-task1.md` | 2026-05-09 | Pilar 1 ATIVO: Engine base Operacao.ts + OperacaoPedido.ts (FULL) + OperacaoExecucaoClaude.ts (V2). Migration chcriacao_seq START WITH 1000000 (separação de range vs BIGSERIAL). DVFS usa `chaveScript INTEGER` (campo correto no schema V2) — NUNCA `s.id` (ADR-V2-016). dvfs-loader carrega por idClasse com fallback ao pai (Q1 para CEO). Scripts seeded em idClasse=-300 (compartilhados por -301/-302/-303). 2 testes regressivos BLOQUEANTES R-CHAVE-5 e R-CHAVE-7. Task 1 = G+H+I (Engine puro); Task 2 = J+K+L (Controller/Service/testes integration). agentTunnelService e eventProducer são STUBS em F6. |
| F6-Task2 | `workspace/plans/plan-f6-executions-task2.md` | 2026-05-09 | Correção M1: `matchedPatterns: string[]` → `Array<{pattern,level}>` em IExecucaoData. ExecutionsService.execute() instancia Engine fresh (nova→calcula→[aprova/gravarComoAwaitingApproval]→grava). ApprovalFlowService.approve() usa $executeRaw race-safe (UPDATE com WHERE status='awaiting_approval' — 0 linhas = ConflictException 409). Sweeper @Cron findMany+filter+$executeRaw (Prisma ORM não suporta WHERE JSON em updateMany). rollback() cria nova execution que passa pelo Risk Gate (será HIGH). ExecutionThrottlerGuard: hash SHA-256 de projectId como tracker key (30 req/min). ExecutionAccessGuard: verifica DVincula -170..-173; ADMIN = idClasse=-171 PROJECT_MANAGER para approve/reject/rollback. Questão aberta Q1 para Implementer: reconstituição do Engine em approve() — Opção A (gravarAposAprovacaoManual) recomendada para preservar DVFS 6-7 e _executarClaude() intactos. 50 patterns adversariais: 25 HIGH + 15 MEDIUM + 10 LOW (spec verificável). |

---

## Padrões Estabelecidos em F2

- **Serialização BigInt:** `format-entidade-response.ts` + `format-tabela-response.ts` por módulo (ou interceptor global — registrar como ADR-V2-025)
- **LRU cache compartilhado:** `src/common/helpers/lru-cache.ts` (max 200, TTL 5min) — reutilizado por EntidadeService e TabelaService para alias `?classe=NOME`
- **Validação DClasse:** sempre `prisma.dClasse.findFirst({ where: { chave, excluido: false } })` antes de qualquer query principal — 404 se não existe
- **Placeholder de auth:** `@SkipGuard()` em todos os controllers F2 — F3 substitui por guards reais
- **Tree builder:** 1 `findMany` + Map em memória — NUNCA recursão de queries (N+1 proibido)
- **`?idClasse` obrigatório em GET /entidades e GET /tabelas** — listagem sem filtro de tipo proibida em F2
