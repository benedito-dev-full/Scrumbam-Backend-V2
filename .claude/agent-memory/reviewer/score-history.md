---
name: score-history
description: Histórico completo de scores de review por task/módulo/fase, usado para calibrar expectativas de score.
metadata:
  type: project
---

# Histórico de Scores — Scrumban-Backend-V2 (Reviewer)

**Por que:** calibração de score entre reviews — comparar módulos similares, ver a distribuição real de scores 7.0-9.5 e os issues mais comuns por fase.
**Como aplicar:** antes de decidir score de um módulo novo, buscar entradas do mesmo módulo/fase abaixo para calibrar rigor equivalente.

## Tabela consolidada (mais recente primeiro dentro de cada bloco)

| Task | Módulo | Fase | Score | Decisão | Issue principal |
|------|--------|------|-------|---------|-----------------|
| Task#1 | eventos-justificativa-atraso Fase1 (Captura) | pós-F8 | **9.0** | **APPROVED** | DEvento -503+seed -530..-537 corretos; taskId em identificadorExterno (nunca idEntidade); supersede atômico em $transaction; org-alvo=DProject.idEstab (mais seguro que JWT ativo); VALIDATING em COMPLETED_STATES coerente com doneAt persistente; autorId=req.user.entidadeId OK (JWT já carrega DEntidade.chave); 41 erros TS + 1 suite eventos = baseline confirmado via git stash -u; 22/22 specs próprios |
| (2026-06-01) | rename-archive-builtin-columns | Frontend+Backend | **8.5** | **APPROVED** | Gate CEO 8.0 atingido; MINOR-1: spec de rename testa só __nome; MINOR-2: "arquivar todas as colunas" sem guard de mínimo; MINOR-3: applySetColumnHidden silencioso se key não existe |
| Task#1 | heranca-rollup-timer-filhas | F5/F8 | **8.8** | **APPROVED** | 13/13 specs; anti-regressão INBOX OK; timer folha OK; M1 finalDueDate init dupla; M2 Array.isArray guard pragmático; L1 1 query extra por mutação (aceitável) |
| Task1 Fase5 | ai-multi-provider (keys CRUD) | Frente B Nexus | **8.5** | **APPROVED** | gate CEO 8.0; DVincula -161 direção correta; orgId exclusivo JWT; plaintext nunca vaza; 70/70 specs; M1 upsertKey sem $transaction (race teórico); M2 índice tripla não garantido |
| (2026-05-26) re-review | prompt-builder | Pós-F13 | **8.8** | **APPROVED** | C1 fix Opção B (placeholder simbólico); C2/M1 teste REAL detectou variante `<``>`; R1 dupla camada anti-enum; R2 @Matches `^\d+$`; gate CEO 8.5 atingido |
| (2026-05-26) | prompt-builder | Pós-F13 | **7.2** | **NEEDS_CHANGES** | C1: CommandValidator.DANGEROUS_CHARS rejeita `()` no prompt placeholder (feature disfuncional); mascarado por mock no integration test |
| Task D2 | bookmarks-validacao | Pós-D1 | **9.0** | **APPROVED** | 16/16 specs; assertTargetExists 1 query O(1); doc=501 correto; M1 gap futuro TargetType; M2 folder/list sem assert idClasse |
| Task D1 | bookmarks-feature | pós-F5 | **7.5** | **NEEDS_CHANGES** | H1: @IsString() em targetId devia @IsNumberString(); H2: bug paginação hasMore sobre filtered em vez de rows |
| Task B.2 | ai-chat-backend (Nexus) | Frente B | **8.3** | **APPROVED** | gate 8.0; M1 topPendingTasks filtro em memória; M2 timer leak setTimeout sem clear; M1 comentário "fire-and-forget" diverge de allSettled |
| Task#1 | folders-mvp | pós-F5 | **8.3** | **APPROVED** | Pilar 2 OK (zero FolderController); seed -155/-183 corretos; 30/30 specs; M1 comentário seed desatualizado; M2 ADR-V2-FOLDERS-001 não criado; M5 DRY duplicate |
| Task#1 Fase0 | fases-via-dtask-idpai (ADR-V2-047) | pós-F5 | **8.5** | **APPROVED** | ADR doc-only; gate CEO 8.0; H1 CTE métricas sem propagar depth (SQL inválido); M1 anti-trigger DB ausente; M2 §3.1 citado como §3.2 |
| Task#1 Fase1 | fases-via-dtask-idpai (Seed PHASE) | pós-F5 | **8.8** | **APPROVED** | Seed-only; gate CEO 8.0; PHASE(-200) correto; H1/M1/M2 corrigidos no ADR; L1 cast bigint cosmético |
| Task#1 Fase3 | fases-via-dtask-idpai (Service Layer) | pós-F5 | **8.7** | **APPROVED** | 24/24 specs; build verde; M1 query redundante create; M2 sem cobertura integração; M3 24 falhas pré-existentes (débito state-machine) |
| Task#1 Fase4 | fases-via-dtask-idpai (Endpoints REST) | pós-F5 | **8.5** | **APPROVED** | 28/28 specs; tenant gate ANTES dos stubs; CTE 1 query; M1 BigInt("abc") sem @Matches → 500 em vez de 400 |
| Task#1 Fase7 | fases-via-dtask-idpai (MCP tools) | pós-F5 | **9.0** | **APPROVED** | 158/158 specs; Pilar 2 DRY perfeito; zero N+1; tenant gate dupla OK; BigInt→string via PhaseTreeService |
| Task#3 Fase9 | fases-via-dtask-idpai (V3+Flow+Telegram) | pós-F8 | **8.7** | **APPROVED** | ZERO seed diff; -494 reutilizado OK; 91/91 specs novos; M1 JSDoc @throws incorreto; M2 DVincula tenant filter sem restrição idClasse; M3 worker timer leak; L1 phase.completed sem ADR |
| Task#2 sub3 | automation-backend-side | F13 | **8.8** | **APPROVED** | slug em dados.slug (Json); backfill sequencial idempotente; fallback untitled-<ts> pragmático |
| Task#2 sub4 | automation-backend-side | F13 | **8.8** | **APPROVED** | Pilar 1 inviolado; isolation dupla camada; zero vazamento sessionPath; -496 reutilização pragmática; 11/11 specs |
| Task#1 sub2 | automation-agent (cliente VPS) | F13 | **9.2** | **APPROVED** | 5 críticos segurança OK; HMAC byte-a-byte; bind 127.0.0.1 hardcoded; nonce pós-HMAC; 26/26 specs; zero scope creep |
| Task#1 sub4 | automation-agent (cliente VPS) | F13 | **9.0** | **APPROVED** | 6 críticos segurança OK; session_id snake_case; execFile sem shell; realpathSync+prefix; mutex try/finally; 67/67 specs; M1 is_error não entra em success |
| Task#1 (hmac-alignment) | automation-hmac-guard | F13 | **8.8** | **APPROVED** | timingSafeEqual OK; rawBody ok; secret nunca vaza; 13/13 specs; M1 regex /api/v\d+ frágil; M2 sem spec decryptCommandSecret |
| Task 1 sub1 | agent scaffolding | F13 cliente | **9.0** | **APPROVED** | 4 MINORs: branches loader não cobertas, ownership check ausente, discrepância jest.config.js, 0% coverage logger/index (esperado) |
| Task 1 sub6 | agent install+systemd | F13 cliente | **7.4** | **NEEDS_CHANGES** | M1 agent/.claude/ localização errada; M2 ANTHROPIC_API_KEY gap; M3 ssh-keyscan stderr silenciado |
| Task#2 | search | F8 | **8.8** | **APPROVED** | 4 queries/request (3 paralelas + DVincula→DEntidade justificado); zero issues bloqueantes |
| Task#1 | flow-metrics-forecast | F8 | **8.5** | **APPROVED** | N+1 e criadoEm corrigidos em re-review (6.5 → 8.5 após correções MAJOR) |
| Task#1 | eventos-canonicos | F7 | **8.5** | **APPROVED** | auth.service.ts com 4 prisma.dEvento.create diretos (débito, não bloqueador) |
| Task 2 | executions (F6) | F6 | **8.5** | **APPROVED** | ScheduleModule.forRoot() duplicado; testes I1-I4 ausentes (unit tests cobrem) |
| Task 1 | domain-structural | F5 | **8.0** | **APPROVED** | parseInt(limit) em 4 controllers; for...of vs createMany no bootstrap; TeamsService sem AuditService |
| Task 1 | email+common | F4 | **8.2** | **APPROVED** | nestjs-pino não instalado (DoD explícito); @Public() ausente no HealthController |
| Task 1 | auth | F3 | **7.8** | **APPROVED** | Bracket notation acesso privado + N+1 write path (ambos dívida F14) |
| Task 1 | endpoints | F2 | **9.0** | **APPROVED** | Dívidas menores (PaginationMetaDto acoplamento, ParseBigIntPipe não aplicado) |

Detalhes adicionais (scores antigos pré-consolidação): [F2 scores](project_f2_scores.md) | [F3 scores](project_f3_scores.md) | [F5 scores](project_f5_scores.md)
