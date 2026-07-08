---
name: historico-scores-completo
description: Histórico completo de scores de review por task/módulo/fase, do início do projeto até o mais recente. Consultar para calibrar expectativas de score por tipo de módulo.
metadata:
  type: project
---

Tabela cronológica completa (mais antigo → mais recente). Índice resumido em [[MEMORY]]; aqui está o detalhe integral.

| Task | Módulo | Fase | Score | Decisão | Issue principal |
|------|--------|------|-------|---------|-----------------|
| Task 1 | endpoints | F2 | 9.0 | APPROVED | Dívidas menores (PaginationMetaDto acoplamento, ParseBigIntPipe não aplicado) |
| Task 1 | auth | F3 | 7.8 | APPROVED | Bracket notation acesso privado + N+1 write path (ambos dívida F14) |
| Task 1 | email+common | F4 | 8.2 | APPROVED | nestjs-pino não instalado (DoD explícito); @Public() ausente no HealthController |
| Task 1 | domain-structural | F5 | 8.0 | APPROVED | parseInt(limit) em 4 controllers; for...of vs createMany no bootstrap; TeamsService sem AuditService |
| Task 2 | executions (F6) | F6 | 8.5 | APPROVED | ScheduleModule.forRoot() duplicado; testes de integração I1-I4 ausentes (unit tests cobrem os casos) |
| Task#1 | eventos-canonicos | F7 | 8.5 | APPROVED | auth.service.ts com 4 prisma.dEvento.create diretos (débito, não bloqueador) |
| Task#1 | flow-metrics-forecast | F8 | 8.5 | APPROVED | N+1 e criadoEm corrigidos em re-review (6.5 → 8.5 após correções MAJOR) |
| Task#2 | search | F8 | 8.8 | APPROVED | 4 queries/request (3 paralelas + DVincula→DEntidade justificado); zero issues bloqueantes |
| Task#2 sub3 | automation-backend-side | F13 | 8.8 | APPROVED | slug em dados.slug (Json); backfill sequencial idempotente; fallback untitled-<ts> pragmático |
| Task#2 sub4 | automation-backend-side | F13 | 8.8 | APPROVED | Pilar 1 inviolado; isolation dupla camada; zero vazamento sessionPath; 11/11 specs |
| Task#1 sub1 | agent scaffolding | F13 cliente | 9.0 | APPROVED | 4 MINORs: branches loader não cobertas, ownership check ausente, jest.config discrepância |
| Task#1 sub2 | automation-agent (cliente VPS) | F13 | 9.2 | APPROVED | 5 críticos segurança OK; HMAC byte-a-byte; bind 127.0.0.1 hardcoded; nonce pós-HMAC; 26/26 specs |
| Task#1 sub4 | automation-agent (cliente VPS) | F13 | 9.0 | APPROVED | 6 críticos segurança OK; execFile sem shell; realpathSync+prefix; 67/67 specs; M1 is_error não entra em success |
| Task#1 sub6 | agent install+systemd | F13 cliente | 7.4 | NEEDS_CHANGES | M1 .claude/ local errado; M2 ANTHROPIC_API_KEY gap; M3 ssh-keyscan stderr silenciado |
| Task#1 (hmac-alignment) | automation-hmac-guard | F13 | 8.8 | APPROVED | timingSafeEqual OK; rawBody ok; 13/13 specs; M1 regex /api/v\d+ frágil |
| Task#1 | folders-mvp | pós-F5 | 8.3 | APPROVED | Pilar 2 OK; seed -155/-183 corretos; 30/30 specs; M1 comentário seed desatualizado |
| Task D1 | bookmarks-feature | pós-F5 | 7.5 | NEEDS_CHANGES | H1 @IsString em vez de @IsNumberString; H2 bug hasMore pós-filtro JS |
| Task D2 | bookmarks-validacao | Pós-D1 | 9.0 | APPROVED | 16/16 specs; assertTargetExists O(1); M1 gap futuro TargetType; M2 idClasse não verificado em folder/list |
| Task#1 Fase0 | fases-via-dtask-idpai (ADR-V2-047) | pós-F5 | 8.5 | APPROVED | ADR doc-only; H1 CTE métricas sem depth propagado; M1 anti-trigger DB ausente |
| Task#1 Fase1 | fases-via-dtask-idpai (Seed PHASE) | pós-F5 | 8.8 | APPROVED | Seed-only; PHASE(-200) correto; H1/M1/M2 corrigidos no ADR |
| Task#1 Fase3 | fases-via-dtask-idpai (Service Layer) | pós-F5 | 8.7 | APPROVED | 24/24 specs; M1 query redundante create; M3 24 falhas pré-existentes |
| Task#1 Fase4 | fases-via-dtask-idpai (Endpoints REST) | pós-F5 | 8.5 | APPROVED | 28/28 specs; tenant gate anti-enumeration; M1 BigInt("abc") sem @Matches |
| Task#1 Fase7 | fases-via-dtask-idpai (MCP tools) | pós-F5 | 9.0 | APPROVED | 158/158 specs; Pilar 2 DRY perfeito; zero N+1; tenant gate dupla OK |
| Task#3 Fase9 | fases-via-dtask-idpai (V3+Flow+Telegram) | pós-F8 | 8.7 | APPROVED | ZERO seed diff; 91/91 specs; M1 JSDoc @throws incorreto; M2 DVincula sem restrição idClasse role |
| Task1 Fase5 | ai-multi-provider (keys CRUD) | Frente B Nexus | 8.5 | APPROVED | DVincula -161 direção correta; plaintext nunca vaza; 70/70 specs; M1 upsertKey sem transaction |
| (2026-06-01) | rename-archive-builtin-columns | Frontend+Backend | 8.5 | APPROVED | Gate 8.0; M1 spec só __nome; M2 arquivar todas colunas sem guard; M3 applySetColumnHidden silencioso |
| (2026-05-26) | prompt-builder | Pós-F13 | 7.2 | NEEDS_CHANGES | C1 DANGEROUS_CHARS rejeita () no placeholder; mascarado por mock |
| (2026-05-26) re-review | prompt-builder | Pós-F13 | 8.8 | APPROVED | C1 fix placeholder simbólico; R1 dupla camada anti-enum; R2 @Matches ^\d+$ |
| Task7 | projects (promote-to-template) | ext. Templates | 5.5 | NEEDS_CHANGES | C1 gate copyPhases testa classe pós-remap → blocos nunca copiados; ver [[bug-pattern-gate-testa-classe-materializada-pos-remap]] |
| Task7 re-review | projects (promote-to-template) | ext. Templates | 9.0 | APPROVED | C1 corrigido (node.idClasse quando toTemplate); M1 corrigido (List filha de Space testada); M2 (query origem sem filtro org) remanescente, não-bloqueante |
| Task B.2 | ai-chat-backend (Nexus) | Frente B | 8.3 | APPROVED | M1 topPendingTasks filtro em memória; M2 timer leak GeminiProvider; tenant isolation sólido |
