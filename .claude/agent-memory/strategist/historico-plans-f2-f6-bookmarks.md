---
name: historico-plans-f2-f6-bookmarks
description: Histórico detalhado de plans produzidos (F2, F3, F6, Bookmarks, Remoção Sprint) e padrões estabelecidos em F2 — decisões-chave arquivadas para consulta pontual.
metadata:
  type: project
---

## Bookmarks — Decisão Arquitetural (2026-05-27, plano Task D1)

**DECISAO REVISADA:** CEO aprovou DVincula -187 (BOOKMARK) como mecanismo de persistencia.
Plano anterior (2026-05-26) propunha DBookmark como tabela nova (ADR-V2-054) — **ABANDONADO**.

Decisao atual:
- DVincula `idClasse=-187n`, `idLocEscritu=userId`, `idEntidade=targetId`, `metaDados={ targetType }`
- ZERO tabela nova — ADR-V2-001 integralmente respeitado
- DClasse -187 ja seedada (ADR-V2-051 + Bloco A) — Pilar 3 pre-cumprido
- Deduplicacao: unique constraint logica no service (busca por idLocEscritu+idEntidade+metaDados.targetType)
- Reativacao de soft-deleted aceita (update excluido=false em vez de criar duplicata)
- Plano entregue: `workspace/plans/plan-bookmarks-feature-task1.md`

BUG LATENTE (nao relacionado, registrar para task futura): `projects.service.ts:895` usa `dvVincula.idEntidade = projectId` (FK para DEntidade mas recebe ID de DProject — sequences independentes).

## HISTÓRICO DE PLANS PRODUZIDOS

| Task | Plan | Data | Decisões-chave |
|------|------|------|----------------|
| F2-Task1 | `workspace/plans/plan-endpoints-genericos-f2-task1.md` | 2026-05-08 | Pilar 2 ativo: 3 controllers genéricos (entidades/tabelas/classes). ZERO controller específico (sem UserController, SprintController). ADR-V2-015 compat wrapper `?classe=NOME` com LRU cache 5min + Logger.warn + header Deprecation/Sunset. ClasseController READ-ONLY. F2.1→F2.6 sequência com Infraestrutura Comum PRIMEIRO. Eventos inline em DEvento até F7 criar EventProducerService. ADR-V2-025 proposto para BigInt serialization strategy. `createSeller` helper canônico incluído mesmo sem uso no Scrumban V2. |
| F3-Task1 | `workspace/plans/plan-auth-rbac-f3-task1.md` | 2026-05-08 | AuthCompositeGuard ordem: MCP→API Key→JWT (mais específico primeiro). RoleResolverService: LRU in-memory TTL 5min (Redis não ativo em F3). Refresh token: rotação estrita (reuse detection). MCP Key: DTabela(-472) + hash duplicado em DUserGroup.dados.mcpKeyHash. API Key: DTabela(-471). Dívidas F2 resolvidas na Fase 1 do plano (antes de qualquer guard). @SkipGuard() tombstone após remoção. Pergunta aberta Q1 para CEO sobre OrgTenantGuard e PATH_PARAM strategy em F5. |
| F6-Task1 | `workspace/plans/plan-engine-operacao-execucao-claude-task1.md` | 2026-05-09 | Pilar 1 ATIVO: Engine base Operacao.ts + OperacaoPedido.ts (FULL) + OperacaoExecucaoClaude.ts (V2). Migration chcriacao_seq START WITH 1000000 (separação de range vs BIGSERIAL). DVFS usa `chaveScript INTEGER` (campo correto no schema V2) — NUNCA `s.id` (ADR-V2-016). dvfs-loader carrega por idClasse com fallback ao pai (Q1 para CEO). Scripts seeded em idClasse=-300 (compartilhados por -301/-302/-303). 2 testes regressivos BLOQUEANTES R-CHAVE-5 e R-CHAVE-7. Task 1 = G+H+I (Engine puro); Task 2 = J+K+L (Controller/Service/testes integration). agentTunnelService e eventProducer são STUBS em F6. |
| F6-Task2 | `workspace/plans/plan-f6-executions-task2.md` | 2026-05-09 | Correção M1: `matchedPatterns: string[]` → `Array<{pattern,level}>` em IExecucaoData. ExecutionsService.execute() instancia Engine fresh (nova→calcula→[aprova/gravarComoAwaitingApproval]→grava). ApprovalFlowService.approve() usa $executeRaw race-safe (UPDATE com WHERE status='awaiting_approval' — 0 linhas = ConflictException 409). Sweeper @Cron findMany+filter+$executeRaw (Prisma ORM não suporta WHERE JSON em updateMany). rollback() cria nova execution que passa pelo Risk Gate (será HIGH). ExecutionThrottlerGuard: hash SHA-256 de projectId como tracker key (30 req/min). ExecutionAccessGuard: verifica DVincula -170..-173; ADMIN = idClasse=-171 PROJECT_MANAGER para approve/reject/rollback. Questão aberta Q1 para Implementer: reconstituição do Engine em approve() — Opção A (gravarAposAprovacaoManual) recomendada para preservar DVFS 6-7 e _executarClaude() intactos. 50 patterns adversariais: 25 HIGH + 15 MEDIUM + 10 LOW (spec verificável). |
| Bookmarks-Task1 | `workspace/plans/plan-bookmarks-modulo-completo-task1.md` | 2026-05-26 | DBookmark tabela própria (não DVincula) — PLANO ABANDONADO pelo CEO. Substituído por D1. |
| Bookmarks-D1 | `workspace/plans/plan-bookmarks-feature-task1.md` | 2026-05-27 | DVincula -187 (CEO). Deduplicacao logica no service (busca + filtro JS). Reativacao soft-deleted. AuthCompositeGuard. Cursor pagination em GET. 3 endpoints: GET/POST/DELETE /bookmarks. Greenfield. Zero seed novo. |
| RemoveSprint-Task1 | `workspace/plans/plan-core-remocao-sprint-hard-delete-task1.md` | 2026-06-03 | **HARD DELETE Sprint** (CEO). REVOGA ADR-V2-009; propoe ADR-V2-060. Alt. B escolhida: refatorar velocity/forecast p/ janela temporal pura (NAO remover — Alt. A reduziria escopo, proibido). Achado-chave: dashboards.calculateVelocity JA tem fallback throughput (sprints===0); forecast JA tem fallback rolling-window 30d → refactor = deletar ramo sprint, promover fallback. Migration DESTRUTIVA: DROP COLUMN idSprint + DROP INDEX DTask_idSprint_idx (up/down). Seed -400 removido (131→130; range -400..-419 liberado). seed-bootstrap para de criar "Sprint 1" (sentinela idempotencia = INBOX -441, intacto). Ordem: pontas(IA+webhooks)→metricas→tasks/endpoint→seed→schema/migration→modulo+ADR. NAO QUEBRAR: createPhase (write-site :475 mistura isPhase+sprint), tenant-isolation.adversarial. historicalSprints→historicalPeriods. 3 perguntas BLOQUEANTES ao CEO (Q1 param breaking, Q2 descarte dados sprint, Q3 semantica velocity=throughput). ~16h. |

## PADRÕES ESTABELECIDOS EM F2

- **Serialização BigInt:** `format-entidade-response.ts` + `format-tabela-response.ts` por módulo (ou interceptor global — registrar como ADR-V2-025)
- **LRU cache compartilhado:** `src/common/helpers/lru-cache.ts` (max 200, TTL 5min) — reutilizado por EntidadeService e TabelaService para alias `?classe=NOME`
- **Validação DClasse:** sempre `prisma.dClasse.findFirst({ where: { chave, excluido: false } })` antes de qualquer query principal — 404 se não existe
- **Placeholder de auth:** `@SkipGuard()` em todos os controllers F2 — F3 substitui por guards reais
- **Tree builder:** 1 `findMany` + Map em memória — NUNCA recursão de queries (N+1 proibido)
- **`?idClasse` obrigatório em GET /entidades e GET /tabelas** — listagem sem filtro de tipo proibida em F2
