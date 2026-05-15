# Documenter Agent Memory — Scrumban-Backend-V2

**Versão:** 1.5 (atualizado após Task #3 F11 MCP Notifications)
**Última atualização:** 2026-05-15

---

## INSTRUÇÕES DE USO

- Consultar **ANTES** de documentar
- Registrar patterns de JSDoc, scopes de commit, ADRs redigidos após cada task
- Limite ~200 linhas; acima, mover histórico para `agent-memory/documenter/<topic>.md`

---

## CONTEXTO V2

Você documenta o **Scrumban-Backend-V2** após Reviewer APPROVED.

**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Modelo:** Haiku (mais barato — doc é mecânica)
**Output:** JSDoc + ROADMAP + CHANGELOG + STATUS + commit (+ ADR-V2-XXX se aplicável)

---

## PATHS V2 OBRIGATÓRIOS

| Arquivo | Quando atualizar |
|---------|------------------|
| `docs/ROADMAP.md` | Toda task aprovada — marcar ✅ COMPLETA |
| `docs/CHANGELOG.md` | Toda task aprovada — entry em [Unreleased], Keep a Changelog format |
| `workspace/STATUS.md` | Toda task aprovada — section "Task [N] — COMPLETE" (CRÍTICO!) |
| `docs/decisions/ADR-V2-XXX-[slug].md` | Quando Strategist propôs decisão arquitetural |
| `src/**/*.ts` | JSDoc em métodos públicos, classes, DTOs, propriedades |

---

## OS 14 ADRs V2 PROPOSTOS — LISTA OFICIAL

| ADR | Título | Fase | Slug |
|-----|--------|------|------|
| ADR-V2-001 | 17 tabelas canônicas — zero tabela nova | F0 | adr-v2-001-17-tabelas-canonicas.md |
| ADR-V2-002 | Renumeração DClasses sequestradas | F1 | adr-v2-002-renumeracao-dclasses.md |
| ADR-V2-003 | RBAC duplo via DVincula + idClasse | F3 | adr-v2-003-rbac-via-dvincula.md |
| ADR-V2-004 | API/MCP Keys via DTabela | F3 | adr-v2-004-api-mcp-keys-via-dtabela.md |
| ADR-V2-005 | OperacaoExecucaoClaude extends OperacaoPedido | F6 | adr-v2-005-operacao-execucao-claude.md |
| ADR-V2-006 | Risk via idClasse (-301/-302/-303) | F6 | adr-v2-006-risk-via-idclasse.md |
| ADR-V2-007 | DVFS scripts como portabilidade | F6 | adr-v2-007-dvfs-portabilidade.md |
| ADR-V2-008 | DEvento substitui DNotification/DWebhook | F7 | adr-v2-008-devento-substitui-dnotification.md |
| ADR-V2-009 | Sprints/Workflow Statuses como wrappers thin | F5 | adr-v2-009-wrappers-thin-sprints.md |
| ADR-V2-010 | Channels como módulo opcional | F10 | adr-v2-010-channels-modulo-opcional.md |
| ADR-V2-011 | MCP rate limit Redis | F11 | adr-v2-011-mcp-rate-limit-redis.md |
| ADR-V2-012 | Webhooks HMAC + retry + auto-disable | F12 | adr-v2-012-webhooks-hmac-retry.md |
| ADR-V2-013 | Agent como DEntidade idClasse=-156 | F13 | adr-v2-013-agent-via-dentidade.md |
| ADR-V2-014 | Migration ETL + cutover 4h + rollback | F15 | adr-v2-014-migration-etl-cutover.md |

ADRs adicionais (V2-015+): score gate, query convention, etc. (pop-up sob demanda).

---

## TEMPLATE ADR V2

```markdown
# ADR-V2-XXX: [Título]

**Status:** Proposto | Aceito | Suplantado por ADR-V2-YYY
**Data:** [YYYY-MM-DD]
**Decisores:** Strategist Agent V2 (+ CEO se estratégico)
**Tags:** #V2 #fase-F[X] #[modulo]

---

## Contexto e Problema

[O que motivou a decisão? Qual restrição V2 impactada?]

## Alternativas Consideradas

### Opção 1: [Nome]
**Prós:** ...
**Contras:** ...

### Opção 2: [Nome]
**Prós:** ...
**Contras:** ...

### Opção 3: [Nome] (se houver)

## Decisão

**Escolhemos:** Opção [N] — [Nome]

**Justificativa:** [razões técnicas, restrições V2, impacto futuro]

## Consequências

**Positivas:** ...
**Negativas:** ...

## Implementação

- Fase V2: F[X]
- Hook que valida: [validate-XXX.sh]
- Plan vinculado: [`workspace/plans/plan-...md`]
- Tasks impactadas: [lista]

## Notas

[Decisões correlatas, ADRs vinculados, ressalvas]
```

---

## CONVENTIONAL COMMITS — SCOPES V2 OFICIAIS

**Lista exata (usar APENAS estes scopes):**

`engine | seeds | endpoints | core | auth | eventos | entidades | tabelas | classes | common | channels | mcp | webhooks | automation | executions | flow-metrics | reports | email | permissoes | docs | agents`

**NÃO usar:** `pagamento` (V2 não é financeiro).

**Tipos:** `feat | fix | docs | refactor | perf | test | chore | style`

**Formato:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Subject:** português, lowercase, ≤72 chars, sem ponto final, imperativo.

**Exemplos corretos:**
```
feat(engine): adiciona OperacaoExecucaoClaude estendendo OperacaoPedido
feat(seeds): adiciona seed canônico V2 com 120 DClasses (50 fixas + 70 V2)
fix(executions): corrige Risk Gate classificando HIGH como LOW
refactor(endpoints): consolida wrappers thin /sprints e /workflow-statuses
perf(flow-metrics): otimiza forecast Monte Carlo com cache TTL
docs(decisions): adiciona ADR-V2-005 (OperacaoExecucaoClaude)
test(automation): adiciona 58 testes adversariais Risk Gate
chore(deps): atualiza prisma 5.x → 6.x
```

**Body sempre detalhado em commits importantes** (feat, fix maiores):
```
feat(seeds): adiciona seed canônico V2 com 120 DClasses

- Seed:
  * prisma/seeds/classes.seed.ts gerado com 50 fixas + 70 V2-específicas
  * 120 DClasses totais (Pilar 3 ATIVADO)
  * Range -150..-529 (não sequestra canônicas)
  * Hierarquia validada (todos idPai existem)

- Tests:
  * 14 unit tests para validador hierarquia (100% pass)
  * Smoke test: prisma db seed roda sem erro

- Documentation:
  * JSDoc em classes-base-template.ts
  * ADR-V2-002 redigido (renumeração de DClasses sequestradas)

Closes Task #[N] (V2 Fase F1)
```

**Footer (opcional):**
- `Closes Task #N`
- `Refs ADR-V2-XXX`
- `BREAKING CHANGE: <descrição>` (raro em V2 — é refundação)

---

## TEMPLATE JSDoc V2

### Service method
```typescript
/**
 * [Verbo no infinitivo: cria/atualiza/lista/deleta] [recurso].
 *
 * [Detalhes adicionais relevantes — Pilar usado, DVFS, etc.]
 *
 * @param param1 - [descrição]
 * @param param2 - [descrição]
 * @returns [tipo + descrição]
 * @throws NotFoundException se [condição]
 * @throws BadRequestException se [condição]
 *
 * @example
 * const result = await service.method(arg1, arg2);
 */
```

### Controller endpoint
```typescript
/**
 * [Endpoint description].
 *
 * [Mencionar Pilar 2 se reutiliza endpoint genérico]
 *
 * @param dto - [descrição]
 * @returns [tipo de response]
 *
 * @example
 * curl -X POST http://localhost:3000/api/v1/[path] \
 *   -H "Authorization: Bearer {token}" \
 *   -d '{...}'
 */
```

### DTO
```typescript
/**
 * DTO para [criação/atualização/etc] de [recurso].
 *
 * Usado em [contexto].
 */
export class [Nome]Dto {
  /**
   * [Descrição da propriedade]
   * @example "valor de exemplo"
   */
  @IsString()
  @ApiProperty({ example: '...' })
  campo: string;
}
```

### Engine class
```typescript
/**
 * Engine de [tipo] — Pilar 1 ATIVADO em DPedido idClasse=-30X.
 *
 * Estende [classe pai]. Sobrescreve [métodos].
 * Workflow: nova → setDados → calcula (DVFS chaves 3,4,5) → aprova → grava (DVFS chaves 6,7).
 *
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see ADR-V2-007 (DVFS scripts como portabilidade)
 */
```

---

## TEMPLATE STATUS.md ENTRY

```markdown
---

## Task [N] — COMPLETE (V2 Fase F[X])

**Module:** [modulo V2]
**Task:** [nome]
**Status:** COMPLETA
**Duration:** [tempo]
**Quality Score:** [X.X]/10

**Agents Performance:**
| Agent | Duration | Quality |
|-------|----------|---------|
| Strategist | [tempo] | — |
| Implementer | [tempo] | — |
| Reviewer | [tempo] | [X.X]/10 |
| Documenter | [tempo] | — |

**Pilares:**
- Pilar 1 (Engine): [Usado em DPedido idClasse=-30X | N/A]
- Pilar 2 (Endpoints): [Reutilizado /entidades?idClasse=X | Controller próprio justificado]
- Pilar 3 (Seed): [N classes adicionadas | N/A]

**Deliverables:**
- [x] Item 1
- [x] Item 2
- [x] Item 3

**Metrics:**
- Build: PASS
- TypeScript: 0 errors
- N+1 Queries: ZERO
- Queries/request: [N]
- Tests: [N unit + N integration, todos PASS]

**ADRs:** [ADR-V2-XXX, ADR-V2-YYY]

**Plan:** [`workspace/plans/plan-[modulo]-[desc]-task[N].md`]
**Impl Notes:** [`workspace/implementations/impl-[modulo]-[desc]-task[N].md`]
**Review:** [`workspace/reviews/review-[modulo]-[desc]-task[N].md`]
**Commit:** [hash truncado]

---
```

---

## TEMPLATE CHANGELOG.md ENTRY

```markdown
## [Unreleased]

### Added
- **[Feature]** (Task [N], V2 F[X])
  - [Detalhes]
  - Pilares: [P1 | P2 | P3]
  - ADRs: [ADR-V2-XXX]

### Changed
- ...

### Fixed
- ...

### Performance
- [métricas, ex: forecast Monte Carlo +30% throughput]

### Tests
- [N unit + N integration, todos PASS]
- F13: 58/58 testes adversariais Risk Gate PASS
```

---

## TEMPLATE ROADMAP.md ENTRY

```markdown
### Task [N]: [Nome] — ✅ COMPLETA

**Status:** Completo
**Módulo V2:** [modulo]
**Fase V2:** F[X]
**Tempo Real:** [tempo]
**Completado em:** [YYYY-MM-DD]
**Quality Score:** [X.X]/10

**O Que Foi Feito:**
- [deliverable 1]
- [deliverable 2]

**Pilares aplicados:**
- Pilar 1 (Engine): [detalhes ou N/A]
- Pilar 2 (Endpoints): [detalhes ou N/A]
- Pilar 3 (Seed): [detalhes ou N/A]

**ADRs vinculados:** [ADR-V2-XXX, ...]
```

---

## CHECKLIST FINAL (NÃO PULE!)

1. **JSDoc completo** em métodos públicos, classes, DTOs
2. **`docs/ROADMAP.md`** marcado ✅ COMPLETA
3. **`docs/CHANGELOG.md`** entry em [Unreleased]
4. **`workspace/STATUS.md`** section "Task [N] — COMPLETE" (CRÍTICO!)
5. **ADR-V2-XXX** redigido se Strategist propôs (em `docs/decisions/`)
6. **Git commit** Conventional Commits com scope V2 válido + body detalhado

---

## NOTAS

- Documenter NÃO invoca outros agents (`disallowedTools: [Task]`).
- Documenter NÃO escreve código de feature (apenas JSDoc + docs).
- Modelo Haiku — não pedir Sonnet/Opus.
- Hook `validate-documentation.sh` valida ROADMAP, CHANGELOG, STATUS, commit.
- Em F16 (Documentação arquitetural consolidada) o trabalho é maior: Swagger, Runbook, MIGRATION-GUIDE, vídeo. Distinguir de doc-por-task.

---

## TASKS DOCUMENTADAS (HISTÓRICO)

### ADR-V2-028: Convite por Email (2026-05-11)
- **Scope:** `invites` (novo scope genérico para onboarding/convites futuros)
- **JSDoc Quality:** 100% — Service (10 métodos), Controller (3 endpoints), DTOs (4 classes), Processor (N/A)
- **ADR Redigido:** `docs/decisions/ADR-V2-028-convite-por-email.md` (~450 linhas)
- **Commits:** Backend V2 `99f01f9`, Frontend `63ec8ee`
- **Milestone:** 6 DClasses novas (-476..-480, -502), seed total 137, 18/18 testes PASS, coverage 87%
- **Padrão:** DTabela para tokens (reutiliza ADR-V2-004), $transaction no accept, fire-and-forget email com log
- **Lições:** 
  - Scope `invites` não estava em lista oficial — adicionado dinamicamente (genérico para onboarding)
  - Fire-and-forget email requer log estruturado (não throw em falha)
  - Anti-enumeração: 404 idêntico em GET e POST (timing-safe respostas)
  - AuthService.issueSessionForUser() novo método (reutiliza JWT pipeline)

### Sub-tarefa 5 F13: Autossh Wrapper + Graceful Shutdown (2026-05-12)
- **Scope:** `agent` (novo scope cliente VPS — Pilar N/A, estrutural cliente)
- **Arquivos:** `agent/src/tunnel/autossh.wrapper.ts` (457 linhas), `agent/src/lifecycle/shutdown.ts` (116 linhas), updated heartbeat-loop.ts + index.ts
- **Tests Novos:** `agent/__tests__/autossh.spec.ts` (11 specs), `agent/__tests__/shutdown.spec.ts` (6 specs) = 17 novos, 84/84 total PASS
- **Funcionalidades:**
  - Circuit breaker: 5 crashes/60s → pausa 5min (evita flap loop)
  - Backoff exponencial 1s→60s com reset após 60s uptime estável
  - `createAutosshWrapper(config, logger, options): AutosshHandle` modular, DI tunáveis
  - Graceful shutdown ordering: heartbeat → server (drena 30s) → autossh → exit(0/1)
  - Dedupe SIGTERM+SIGINT idempotente via flag `triggered`
  - `isHealthy()` exposto: Sub-tarefa 3 placeholder now refletido em payload
- **ADRs Vinculados:** ADR-V2-031 (agent monorepo), ADR-V2-035 (logs sensíveis — futura)
- **Commit:** `4c9c6e8` (scope `agent`, type `feat`)
- **Quality:** 9.0/10 APPROVED rodada 1
- **Documentação:**
  - ROADMAP: Sub-tarefa 5 marcada ✅ COMPLETA
  - CHANGELOG: entry 30 linhas com detalhe circuit breaker, shutdown, heartbeat integration
  - STATUS.md: seção 58 linhas Task #1 Sub-tarefa 5 com deliverables, métricas, decisões design
- **Workflow:** Implementer (3.5h) → Documenter (45min) = 4.25h total
- **Lições:**
  - Scope `agent` é novo (antes tudo `automation`). Cliente é V2 separado, warrant escopo próprio
  - Tunáveis em options importante para testes (fake timers, mock spawn, função "agora")
  - Circuit breaker `crashWindowMs + crashThreshold` válido padrão: não throw fast, monitora via `circuit_open` log
  - Graceful shutdown ordem defensiva: heartbeat ANTES server (evita log enganoso), server ANTES autossh (drena in-flight requests)
  - ADR-V2-035 redigir futura para log-sensíveis (agentSshKeyPath line 312 expõe caminho — remover por flag boolean)
  - STATUS.md pre-populado por Implementer (novo padrão — Documenter valida, não refaz)

### Sub-tarefa 2.1 F13: Seed Agent Session Lifecycle + ADR-V2-033 (2026-05-12)
- **Scope:** `seeds` (Pilar 3 — estrutural puro)
- **DClasses:** 2 novas (-505 AGENT_SESSION_CREATED, -506 AGENT_SESSION_RESUMED), idPai=-3 (EVENTOS)
- **Seed Total:** 45 fixas + 95 específicas = 140 DClasses (ADR-V2-033 +2)
- **ADR Redigido:** `docs/decisions/ADR-V2-033-contrato-execute-outbound-e-execution-result-inbound.md` (esqueleto, decisão e preenchida)
- **Commit:** `d7fbc63` (scope `seeds`, type `feat`)
- **JSDoc Corrigido:** Issue M1 — seed linha 249 (92/137 → 95/140)
- **Quality:** 9.0/10 APPROVED (Reviewer apreciou hierarquia idPai=-3 superior a sugestão plano)
- **Workflow:** Implementer (45min) → Reviewer (30min) → Documenter (30min) = 1.75h total
- **Lições:**
  - Scope `seeds` válido e oficial (Pilar 3)
  - CHANGELOG entry type=Added (não type=feat body — type vai em commit, entry va em CHANGELOG estruturado)
  - STATUS.md usa seção "Agents Performance" para rastrear duração por agent (novo padrão)
  - ROADMAP entry para Sub-tarefa deve detalhar pilares aplicados e ADRs (modelo seguir Task #2 F5)
  - Commit com scope `seeds` é padrão para alterações no `prisma/seeds/classes.seed.ts`
  - ADR-V2-033 é novo ADR (15º da série); redação em progresso (esqueleto completo em 2.5)

### Sub-tarefa 4.1 F13: projectId opcional no install-token (2026-05-12)
- **Scope:** `automation` (Pilar 1 N/A | Pilar 2 REUTILIZADO | Pilar 3 N/A)
- **Problema:** CEO não conseguia instalar 1 agente para N projetos (VPS V2 tem >10 projetos, precisava de 10 agentes)
- **Solução:** `GenerateInstallTokenDto.projectId` → `@IsOptional()` + `AgentInstallTokenService.createInstallToken(projectId: bigint | null)` condicional + `AgentsService.install()` sem DVincula -185 quando standalone
- **Key Files:**
  - `agents.controller.ts`: JSDoc novo em `generateInstallToken()` com ejemplos standalone + com-projeto (30 linhas)
  - `agent-install-token.service.ts`: `createInstallToken()` condicional (pula `requireProjectManagerOrOrgAdmin` quando null)
  - `agents.service.ts`: `install()` condicional (`idLocEscritu = createdBy` standalone, sem DVincula)
- **Tests:** 4 specs novos (create COM/SEM projectId, consume standalone, install standalone) + 60/60 total PASS
- **JSDoc Pattern:** Controller endpoint agora usa JSDoc 50+ linhas com:
  - Descricão breve + comportamentos detalhados (COM/SEM projectId)
  - @param, @returns, @throws (401/403/404)
  - 2 @example blocks (curl standalone + curl com-projeto)
  - @example json response
  - ADRs vinculados em top
- **Commit:** `c7cf7be` (scope `automation`, type `fix`, body 60 linhas)
- **Backward-compat:** 100% (install COM projectId = comportamento anterior DVincula automática)
- **Quality:** 8.2/10 APPROVED (Reviewer)
- **Workflow:** Implementer (1.5h) → Reviewer (0.5h) → Documenter (0.5h JSDoc + docs) = 2.5h total
- **RBAC Decisions:**
  - Standalone = qualquer JWT autenticado (conscientemente decidido, mitigação em 4.3)
  - Vinculado = MANAGER projeto OU ADMIN org (reusa `requireProjectManagerOrOrgAdmin`)
  - idLocEscritu standalone = createdBy (dono inicial = usuário que gerou token)
- **Lições:**
  - Controller JSDoc deve detalhar comportamentos condicionalidades e RBAC
  - MEDIUM ISSUE pode ser aceptável se mitigação vem em sub-tarefa seguinte (documentar explícitamente)
  - Backward-compat crítica em hotfixes — verificar que COM projectId não regride

### Task 01 F4: Corrigir persistência de `priority` em DTask (2026-05-12)
- **Scope:** `tasks` (Pilar 2 — reutilizar endpoint genérico)
- **ADR Redigido:** `docs/decisions/ADR-V2-034-priority-dtabela-por-projeto.md` (nova, padrão Priority como DTabela escopada)
- **Deliverables:**
  - `TasksService`: helper `resolvePriorityId()` + persist `idPriority` em create/update
  - `buildResponse()`: batch lookup `buildPriorityMap()` (ZERO N+1)
  - `SeedBootstrapService`: novo método `seedPrioritiesIfMissing()` cria 4 DTabelas PRIORITY por projeto
  - Backfill script: `prisma/scripts/backfill-priority-tabelas.ts` standalone idempotente
  - DTOs: enums corrigidos (CRITICAL→URGENT), `update-task.dto.spec.ts` novo (M1 fix)
  - ESLint config: glob incluído `prisma/scripts/**/*.ts`
- **Commit:** `86701a5` (scope `tasks`, type `fix`)
- **Tests:** 85/85 PASS (77 tasks + 8 DTO spec M1 fix)
- **Quality:** 8.0/10 APPROVED (padrão robusto, zero N+1, ADR justificado)
- **Workflow:** Implementer (1.5h round 2 M1) → Reviewer (40min) → Documenter (30min) = 2.33h total
- **Pilares:** P1 N/A | P2 REUTILIZADO (endpoint genérico /tasks/:id PATCH) | P3 RESPEITADO (zero tabela nova)
- **Lições:**
  - Pattern Priority espelha Status — precedente estabelecido em ADR-V2-009
  - M1 fix (DTO spec) fundamental — cliente/Reviewer identificou gap validation
  - Backfill script like best practice para seed anterior a feature
  - Scope `tasks` é padrão (não `executions` ou outro genérico — reside em tasks/)
  - Priority DTabela escopada por projeto = chaves runtime únicas por projeto (importante para multi-tenant)
  - ADR-V2-034 precedente para future custom priorities (sem código novo)
