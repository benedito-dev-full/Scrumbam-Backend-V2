# Plano Estratégico — Fases 14 a 17 (Hardening, Migração, Documentação, Launch)

**Autor:** Strategist Agent (Devari Core)
**Data:** 2026-05-08
**Projeto:** Scrumban-Backend-V2
**Escopo:** Fechamento do ciclo — produção-ready, migração de dados do legado e handoff
**Pré-requisito:** Fases 0–13 concluídas (já planejadas pelos demais Strategists)
**Princípio absoluto:** ZERO tabela nova. As 17 tabelas canônicas atendem 100% do escopo.
**Contrato HTTP imutável:** Os 128 endpoints de `/Users/devaritecnologia/Documents/Benedito/Scrumbam-Backend/docs/API-CONTRACT.md` devem responder no V2 com requests/responses byte-compatíveis com o legado.

---

## Sumário Executivo

| Fase | Nome | Duração estimada | Risco operacional | Gate principal |
|------|------|------------------|-------------------|----------------|
| 14 | Hardening (testes, segurança, observabilidade) | 5 dias úteis | Médio | Build verde + cobertura ≥80% + load test p95 < 250ms |
| 15 | Migração de Dados (legado → V2) | 4 dias úteis | **CRÍTICO** | Diff zero entre legado e V2 em smoke contra dados migrados |
| 16 | Documentação e Handoff | 2 dias úteis | Baixo | Swagger 100%, JSDoc 100%, runbook validado por 3rd-party |
| 17 | Launch + Pós-Launch | Janela 4h + 30 dias | **ALTO** | Cutover rollback testado, monitoramento intensivo 24h |

**Tempo total das fases 14–17:** ~11 dias úteis + janela de cutover + 30 dias de pós-launch.

---

## Princípios Gerais que Atravessam as 4 Fases

1. **Zero tabela nova.** Toda persistência é nas 17 tabelas canônicas. Qualquer divergência é bug.
2. **Engine para INSERT em transacionais.** `OperacaoExecucaoClaude` (Fase 9) é o único caminho para criar `DPedido idClasse=-300`.
3. **Endpoints genéricos reutilizados.** `/entidades?idClasse=X` e `/tabela?classe=Y` sempre que aplicável.
4. **Seed governa.** Sem seed correto, sistema não inicia. Validação de seed em todo CI.
5. **BigInt sempre.** Nunca `parseInt`, nunca `Number` em IDs.
6. **Decimal(19,4) para dinheiro.** Storypoints, capacity, throughput permanecem `Int` ou `Decimal` conforme schema.
7. **TimezoneService para datas.** Filtros sempre via `applyDateFilters()`.
8. **Eventos somente após persistência bem-sucedida.**
9. **N+1 = zero.** Reviewer rejeita.
10. **Logger NestJS estruturado JSON. Nunca `console.log`.**

---

# FASE 14 — HARDENING (Testes, Segurança, Observabilidade)

## 14.1 Objetivo

Garantir que o V2 está produção-ready: cobertura de testes ≥80% nos pontos críticos, todos os 128 endpoints com testes de integração comprovando paridade de contrato com o legado, segurança auditada (incluindo isolamento multi-tenant via `OrgTenantGuard`), observabilidade completa (logs estruturados, métricas Prometheus, health checks profundos), e ausência verificada de N+1 queries.

## 14.2 Pilares Ativados

- **Pilar 1 (Engine):** Testes do `OperacaoExecucaoClaude`, `OperacaoPedido` (se aplicável), validação de workflow `nova → calcula → aprova → grava`.
- **Pilar 2 (Endpoints genéricos):** Testes de paridade em `/entidades`, `/tabela`, `/classes` — query params, paginação, filtros.
- **Pilar 3 (Seed):** Validação automática em CI de que seed tem ≥50 fixas + N específicas, hierarquia consistente, todos `idPai` existem, total esperado bate.

## 14.3 Padrões Obrigatórios Aplicados

- Padrão #6: N+1 query sweep (DATABASE_LOGGING=true) — target 3–5 queries/request.
- Padrão #11: Logger NestJS estruturado, sem `console.log`. HttpException apropriado.
- Padrão #16: Testes unit + integration, mocks com `Test.createTestingModule`, asserções de `BigInt` corretas.
- Padrão #21: Checklist completo aplicado a cada module antes de marcar como hardened.

## 14.4 Tabelas Canônicas Envolvidas

Todas as 14 tabelas usadas pelo V2 (DClasse, DEntidade, DUserGroup, DTabela, DVincula, DPermissao, DEvento, DProject, DTask, DPedido + tabelas de Engine como DTitulo, DMovDispo se aplicável). Nenhuma tabela nova.

## 14.5 Estrutura de Arquivos Esperada

```
test/
├── unit/
│   ├── auth/                          # JWT, RBAC, refresh, RefreshTokenService
│   ├── engine/                        # OperacaoExecucaoClaude, lifecycle
│   ├── entidades/                     # EntidadeService.getEntidadeIdFromUserGroup, etc.
│   ├── tabela/
│   ├── tasks/                         # Task → DTask + dados Json
│   ├── automation/                    # Risk Gate, Approval Flow, CommandValidator
│   ├── flow-metrics/
│   ├── webhooks/                      # HMAC signing
│   ├── notifications/
│   └── common/                        # TimezoneService, Logger, guards
├── integration/
│   ├── api-contract/                  # 1 spec por módulo HTTP, 128 endpoints cobertos
│   │   ├── analytics.e2e-spec.ts
│   │   ├── auth.e2e-spec.ts
│   │   ├── agents.e2e-spec.ts
│   │   ├── automation-execution.e2e-spec.ts
│   │   ├── automation-vinculo.e2e-spec.ts
│   │   ├── telegram-channel.e2e-spec.ts
│   │   ├── telegram-webhook.e2e-spec.ts
│   │   ├── dashboards.e2e-spec.ts
│   │   ├── flow-metrics.e2e-spec.ts
│   │   ├── forecast.e2e-spec.ts
│   │   ├── health.e2e-spec.ts
│   │   ├── mcp.e2e-spec.ts
│   │   ├── notifications.e2e-spec.ts
│   │   ├── organizations.e2e-spec.ts
│   │   ├── projects.e2e-spec.ts
│   │   ├── reports.e2e-spec.ts
│   │   ├── search.e2e-spec.ts
│   │   ├── sprints.e2e-spec.ts
│   │   ├── tasks.e2e-spec.ts
│   │   ├── teams.e2e-spec.ts
│   │   ├── webhooks.e2e-spec.ts
│   │   └── workflow-statuses.e2e-spec.ts
│   ├── tenant-isolation/              # Isolamento adversarial OrgTenantGuard
│   ├── rbac/                          # ADMIN/MEMBER/VIEWER em todos os endpoints
│   ├── command-validator/             # 58 testes adversariais portados
│   ├── risk-gate/                     # Cobertura completa do gate
│   └── approval-flow/                 # Fluxo de aprovação humana
├── load/
│   ├── k6/
│   │   ├── tasks-list.js              # 1000 req/s
│   │   ├── entidades-list.js          # 1000 req/s
│   │   ├── flow-metrics.js            # 500 req/s
│   │   └── auth-login.js              # 100 req/s (rate limit)
│   └── README.md
├── security/
│   ├── sql-injection.spec.ts
│   ├── xss-payloads.spec.ts
│   ├── jwt-tampering.spec.ts
│   ├── tenant-bypass.spec.ts
│   └── webhook-hmac-replay.spec.ts
└── n1-sweep/
    └── n1-detector.spec.ts            # Liga DATABASE_LOGGING e conta queries
```

## 14.6 Tarefas Detalhadas

### 14.6.1 Testes Unitários (cobertura ≥80% em services críticos)

1. Criar `jest.config.ts` com `collectCoverageFrom` apontando para `src/**/*.{service,guard,interceptor}.ts`, threshold global `{branches: 70, functions: 80, lines: 80, statements: 80}`.
2. Mockar `PrismaService` em todos os tests via factory padronizada `test/helpers/prisma.mock.ts`.
3. Para cada service crítico, garantir testes de:
   - Caminho feliz com retorno esperado.
   - Validações de entrada (BadRequest).
   - Recursos não encontrados (NotFound).
   - Conflitos de negócio (Conflict).
   - Rollback de transação em erro.
4. Services prioritários (cobertura mínima 90%):
   - `OperacaoExecucaoClaude` — workflow completo, scripts DVFS mockados.
   - `EntidadeService.getEntidadeIdFromUserGroup` — todos branches.
   - `AuthService` (login, register, refresh, revoke).
   - `RefreshTokenService` — tokens rotation, revocation.
   - `RbacService` — todas as combinações de ADMIN/MEMBER/VIEWER.
   - `RiskGateService` — todos os triggers de risk.
   - `ApprovalFlowService` — todos estados.
   - `CommandValidatorService` — portar os 58 testes adversariais.
   - `WebhookService` — HMAC signing, replay protection.
   - `FlowMetricsService` — cálculos throughput, cycle time, WIP.
   - `TimezoneService` — `applyDateFilters`, `getPeriodDates`.
5. Rodar `npm run test:cov` e bloquear merge se threshold falhar.

### 14.6.2 Testes de Integração — Paridade dos 128 Endpoints

1. Criar harness `test/integration/api-contract/_harness.ts` que:
   - Sobe app NestJS em `beforeAll` (modo `testing`).
   - Aplica seed de dados determinístico em transação (rollback no `afterAll`).
   - Expõe helpers `request(app).post('/api/v1/...').set('Authorization', `Bearer ${tokenAdmin}`)`.
2. Para cada um dos 22 módulos do contrato, criar 1 spec:
   - Para cada endpoint do contrato:
     - Validar status code esperado.
     - Validar shape do response (JSON Schema ou snapshot).
     - Validar headers críticos (cookies httpOnly em auth, `X-Total-Count` em listagens).
     - Validar erros (401 sem token, 403 sem permissão, 404 inexistente, 409 conflito).
3. Captura "golden" do legado:
   - Script `scripts/capture-legacy-responses.ts` chama o legado em ambiente de staging para 1 amostra de cada endpoint, salva responses em `test/integration/api-contract/golden/`.
   - V2 spec compara response com golden via deep equal (ignorando timestamps e IDs).
4. CI bloqueia merge se qualquer endpoint não tem spec ou diff vs golden.

### 14.6.3 Testes Adversariais

1. Portar os 58 testes do `CommandValidator` do legado para `test/integration/command-validator/`. Estrutura: `it.each(adversarialPayloads)('rejeita: %s', ...)`.
2. Risk Gate adversarial — mínimo 30 cenários:
   - Tenant cruzado (chamar com token de orgA tentando ler dados de orgB).
   - Privilege escalation (VIEWER tentando ADMIN).
   - Risk score boundaries (just-above-threshold, just-below).
   - Approval bypass (tentar executar sem aprovação).
3. Approval Flow — cenários: aprovação dupla, revogação após aprovação, expiração, race condition (2 aprovadores simultâneos).
4. Webhook HMAC replay — repetir mesmo payload com mesma assinatura deve rejeitar 2ª chamada (nonce ou timestamp window).

### 14.6.4 Load Tests

1. Setup `k6` no repo (`test/load/k6/`).
2. Cenários:
   - `tasks-list.js`: ramp 0→1000 req/s em 60s, sustain 5min, target p95 <200ms, error rate <0.1%.
   - `entidades-list.js`: idem.
   - `flow-metrics.js`: ramp 0→500 req/s, target p95 <300ms (queries agregadas).
   - `auth-login.js`: 100 req/s sustentado, validar throttler.
3. Roda em ambiente staging com banco populado (1M tasks, 100k entidades, 10k orgs).
4. Gate: p95 < 250ms (média ponderada), error rate < 0.5%, throughput sustentado.
5. Resultados arquivados em `docs/load-tests/{date}.md` com gráficos.

### 14.6.5 Security Review

1. **Tenant isolation:**
   - Para cada endpoint protegido por `OrgTenantGuard`, escrever 1 teste adversarial que tenta acessar com `orgId` cruzado. Esperado: 403.
   - Total: ~80 testes (endpoints com tenancy).
2. **SQL Injection:**
   - Prisma + class-validator cobre. Validar com payloads conhecidos (`'; DROP TABLE`, `' OR '1'='1`).
3. **XSS:**
   - Em campos de texto livre (`description`, `name`, `comment`), validar que servidor não retorna HTML executável. (Defesa em profundidade — front sanitiza.)
4. **Rate limiting:**
   - `@nestjs/throttler` com Redis storage.
   - Endpoints sensíveis: `/auth/login` 5/min, `/auth/register` 3/min, webhooks externos 100/min/IP.
5. **Auditoria de secrets:**
   - Adicionar `gitleaks` no pre-commit hook e em CI.
   - Banner de aviso em cada `.env.example`.
6. **HMAC webhook signing:**
   - Header `X-Scrumban-Signature: sha256=...`.
   - Janela de tolerância: 5 minutos. Replay window via Redis (TTL 300s).
7. **JWT:**
   - RS256 (não HS256), chaves rotacionáveis via `JWT_KEY_ID`.
   - httpOnly + Secure + SameSite=Strict em cookies.
8. **CORS:**
   - Whitelist explícita de origens. Sem `*` em produção.
9. **Helmet:**
   - Habilitado com CSP, HSTS, X-Frame-Options.
10. Auditoria final: rodar `npm audit --omit=dev`, sem CVEs `high`/`critical`.

### 14.6.6 Observabilidade

1. **Logger estruturado JSON:**
   - Custom NestJS Logger que emite `{level, timestamp, context, message, traceId, orgId, userId, ...}`.
   - Trace ID por request via interceptor (`X-Request-Id` header in/out).
2. **Métricas Prometheus:**
   - Endpoint `/metrics` (autenticado por header secreto ou IP whitelist).
   - Métricas básicas: `http_requests_total`, `http_request_duration_seconds`, `bullmq_queue_depth`, `bullmq_jobs_completed_total`, `bullmq_jobs_failed_total`, `db_query_duration_seconds`.
   - Custom: `risk_gate_blocks_total`, `approval_flow_pending_gauge`, `command_validator_rejections_total`.
3. **Tracing (opcional Fase 14, obrigatório se houver tempo):**
   - OpenTelemetry SDK + exporter OTLP (Tempo/Jaeger).
4. **Health endpoint:**
   - `GET /api/v1/health`:
     - DB ping (Prisma `$queryRaw\`SELECT 1\``).
     - Redis ping.
     - BullMQ queues — verificar que workers respondem.
     - Resposta inclui `version`, `uptime`, `dependencies`.
   - `GET /api/v1/health/liveness` (k8s liveness probe — só checa que processo responde).
   - `GET /api/v1/health/readiness` (k8s readiness probe — checa deps).

### 14.6.7 N+1 Sweep

1. Adicionar middleware de teste que liga `DATABASE_LOGGING=true` e conta queries por request.
2. Para os 30 endpoints mais hot (definidos por contagem de calls em produção do legado), assertion: `expect(queryCount).toBeLessThanOrEqual(5)`.
3. Listar endpoints suspeitos (>5 queries) em `docs/load-tests/n1-report.md` e refatorar com `include`/`select`.

### 14.6.8 Métricas Generator (V2 como piloto-vivo do Devari-Core)

Aplicação direta do **ADR-V2-017** e do **§7 do plano-mestre** (V2↔Generator feedback loop). A fase de hardening é o momento em que o V2 já tem código suficiente para medir objetivamente o gap entre Scrumban-hoje e o Generator atual (PARTE-3).

**Métricas obrigatórias a coletar e arquivar em `docs/lessons/metrics-fase-14.md`:**

1. **% boilerplate canônico vs específico do Scrumban (por módulo):**
   - Critério "boilerplate canônico": código idêntico (ou diff trivial) ao que o Devari-Core base produziria para qualquer SaaS — endpoints genéricos `/entidades` e `/tabela`, AuthService padrão, EntidadeService, EventService, controllers thin, DTOs gerados.
   - Critério "específico Scrumban": código com regra de negócio do domínio ágil — `OperacaoExecucaoClaude` (Pilar 1), Risk Gate, Approval Flow, Voice/Whisper, MCP tools, Webhook HMAC dispatcher, intentions V3 state machine.
   - Coleta: `cloc src/` por módulo + `git diff` contra baseline do Devari-Core.
   - Reporte: tabela módulo × % canônico × % específico × LOC total.
   - Meta indicativa: ≥60% canônico globalmente (alinhado com promessa do ADR-101 de 70–80% reuse).

2. **DClasses do V2 candidatas a virar fixas no template-base:**
   - Strategist + Reviewer revisam o seed final (cf. plano-mestre §3, ~120 classes).
   - Lista as DClasses que parecem **úteis para QUALQUER SaaS de gestão ágil/colaboração** (exemplos plausíveis: SPRINT, PRIORITY, TASK_TYPE, STATUS_INTENTION_V3, NOTIFICATION).
   - Reporte: tabela `chave × código × nome × justificativa de generalidade`.
   - Saída alimenta proposta de evolução de `templates/classes-base-template.ts` no Devari-Core v3.0.

3. **Tempo gasto F0 a F13 vs tempo "prometido" pelo Generator atual:**
   - Promessa do ADR-101 / `devari-saas-generator.md`: 1–3 dias de geração + 1–3 dias de customização.
   - Coletar: tempo real (em semanas-engenheiro) de cada fase F0..F13.
   - Reporte: tabela fase × estimativa × real × delta × explicação.
   - **Não é fracasso do V2** — é evidência empírica do gap entre escopo coberto pelo Generator e escopo moderno (Channels, MCP, Automation, Voice). Alimenta proposta de novos templates/módulos no Devari-Core v3.0.

4. **Lista consolidada de capacidades modernas que viram módulos opt-in propostos:**
   - Curadoria das issues `evolution-from-v2` abertas no Devari-Core até este ponto.
   - Reporte: tabela capacidade × tabela canônica usada × DClasses associadas × ADRs do V2 que sustentam × nome sugerido do módulo opt-in (ex.: `channels.yaml`, `mcp.yaml`, `automation.yaml`).

**Hook recomendado:** `validate-metrics-fase-14.sh` valida presença e estrutura mínima de `metrics-fase-14.md` antes de fechar a fase.

**Princípio (reforçar):** V2 NÃO é projeto isolado. V2 é piloto que mede e contribui. Cada métrica não é exercício burocrático — é insumo direto para PRs no Devari-Core abertos na Fase 17.

## 14.7 Dependências

- Fases 0–13 concluídas (estrutura, módulos, seeds, OperacaoExecucaoClaude, RBAC).
- API contract do legado (`API-CONTRACT.md`) tratado como fonte da verdade.
- Acesso a ambiente staging com dados reais para captura de golden responses.

## 14.8 Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Cobertura ficar abaixo de 80% por código legado polimórfico difícil de mockar | Média | Médio | Helpers `test/helpers/prisma.mock.ts` reutilizáveis; investir 0,5 dia em fixtures |
| Diff vs golden por timestamps/IDs voláteis | Alta | Baixo | Comparador customizado que ignora campos voláteis (whitelist) |
| Load test derrubar staging | Baixa | Médio | Rodar em janela noturna; ter rollback de banco staging |
| Gitleaks falhar com falsos positivos | Média | Baixo | `.gitleaksignore` por padrão, revisão manual de exceções |
| N+1 sweep encontrar 50+ endpoints problemáticos | Média | Alto | Reservar 1 dia extra; priorizar por volume (top 30 antes do launch) |
| OpenTelemetry instabilidade em produção | Média | Médio | Manter feature flag `OTEL_ENABLED`; default off no launch |

## 14.9 Definition of Done (20 itens)

- [ ] `npm run test:cov` passa com threshold `lines >= 80%`.
- [ ] 22 specs de paridade existem, 128 endpoints cobertos, golden diff zero.
- [ ] 58 testes adversariais do CommandValidator portados e verdes.
- [ ] Risk Gate com ≥30 cenários adversariais.
- [ ] Approval Flow com ≥10 cenários (incluindo race conditions).
- [ ] Webhook HMAC replay test verde.
- [ ] Tenant isolation: 1 teste cruzado por endpoint protegido (≥80 testes).
- [ ] Load test: p95 <250ms em 4 cenários, error rate <0.5%.
- [ ] N+1 sweep: 30 endpoints hot validados ≤5 queries.
- [ ] `npm audit` sem `high`/`critical`.
- [ ] Gitleaks integrado no CI.
- [ ] Logger JSON estruturado em todos os modules.
- [ ] Métricas Prometheus expostas em `/metrics`.
- [ ] Health endpoints (live/ready/full) funcionais.
- [ ] CI pipeline executa: lint → typecheck → test → build → security scan → load test smoke (10s).
- [ ] Documento `docs/load-tests/baseline-2026-05.md` arquivado.
- [ ] **`docs/lessons/metrics-fase-14.md` arquivado** com as 4 métricas Generator (% boilerplate, DClasses candidatas, tempo F0..F13 vs estimativa, capacidades modernas → módulos opt-in propostos).
- [ ] **Issues `evolution-from-v2` abertas no Devari-Core** acumuladas até a F14 (mínimo 1 issue por capacidade não-coberta pelo Generator atual: Channels, MCP, Automation, Voice, Webhooks, Risk Gate, Approval Flow, PR auto-open).
- [ ] **% boilerplate canônico medido e reportado** (meta indicativa ≥60%).
- [ ] **Tabela "fase × estimativa × tempo real × delta"** preenchida em `docs/lessons/metrics-fase-14.md`.

## 14.10 Tempo Estimado

| Atividade | Dias |
|-----------|------|
| Unit tests | 1.5 |
| Integration tests + golden capture | 1.5 |
| Adversarial + security | 1.0 |
| Load tests + N+1 sweep | 0.5 |
| Observabilidade (logger + metrics + health) | 0.5 |
| **Métricas Generator (`docs/lessons/metrics-fase-14.md`) — ADR-V2-017** | **0.5** |
| **Total Fase 14** | **5.5 dias úteis** |

## 14.11 Como Validar (Smoke + Gates)

1. CI verde em PR final da Fase 14.
2. Comando local: `make test && make test:e2e && make load:smoke && make security:scan`.
3. Reviewer aprova checklist 14.9.
4. Snapshot de cobertura `coverage/lcov-report/index.html` arquivado.

---

# FASE 15 — MIGRAÇÃO DE DADOS (Legado → V2)

## 15.1 Objetivo

Migrar 100% dos dados do `Scrumbam-Backend` (schema com 14 modelos) para o `Scrumban-Backend-V2` (17 tabelas canônicas + dados Json), preservando integridade referencial, com scripts idempotentes, validação por diff, ensaios em staging, e cutover production-grade com rollback testado.

**Esta é a fase de maior risco operacional do projeto.** A janela de cutover é o ponto-de-não-retorno. Qualquer erro aqui pode causar perda de dados em produção. **Atenção máxima.**

## 15.2 Pilares Ativados

- **Pilar 1:** `OperacaoExecucaoClaude` NÃO é usada em scripts de migração — usamos Prisma direto em transação porque os dados já existem (não estamos criando pedidos via Engine, estamos rehidratando). Isso é exceção justificada (ETL one-shot, não criação de negócio).
- **Pilar 2:** Não cria endpoints novos — scripts são CLI, não HTTP.
- **Pilar 3:** Seed precisa estar 100% completo antes de rodar qualquer script (idClasses dos eventos, vínculos, configs precisam existir).

## 15.3 Padrões Obrigatórios Aplicados

- Padrão #1: PrismaService em scripts (não DatabaseService).
- Padrão #2: BigInt em todos IDs convertidos.
- Padrão #3: `prisma.$transaction` em cada script (rollback total se algo falhar).
- Padrão #4: TimezoneService para qualquer cálculo/filtro de data.
- Padrão #6: Bulk inserts (`createMany`), nunca loop com create individual.
- Padrão #11: Logger estruturado, contadores por entidade, progresso a cada 1000 registros.
- Padrão #21: Checklist completo por script.

## 15.4 Mapeamento Campo a Campo (Origem → Destino)

| Origem (Scrumbam-Backend) | Destino (Scrumban-Backend-V2) | Estratégia | Padrão |
|---------------------------|-------------------------------|-----------|--------|
| **DProjectMember** | **DVincula** com `idClasse` para org-user OU project-user (2 idClasses) | 1 row → 1 vincula. `idLocEscritu` = orgId/projectId, `idEntidade` = userId, `tipo` = role | DVincula |
| **DNotification** | **DEvento** `idClasse=-490` | Json `dados` preserva: `type`, `read`, `payload`. `idEntidade` = recipientId | DEvento |
| **DWebhook** | **DTabela** `idClasse=-470` com `dados Json` | `dEntidadeId` = projectId, `nome` = url, `dados` = `{events, secret, active, lastDelivery, ...}` | DTabela |
| **DAgent** | **DEntidade** `idClasse=-152` | `nome` = agent name, `dados Json` = `{publicKey, lastSeen, status, version, capabilities}` | DEntidade |
| **DExecution** | **DPedido** `idClasse=-300` (via INSERT direto, não Engine) | `chave` = nova sequence, `dados Json` = `{command, output, exitCode, durationMs, riskScore, approvedBy, ...}` | DPedido (exceção ETL) |
| **DTask (V3)** campos colunados extras | **DTask.dados Json** | Move campos não-canônicos para `dados`: `wipLimit`, `cycleTime`, `blockReasons[]`, etc. | DTask |
| **Refresh tokens** (qualquer tabela do legado) | **DUserGroup.dados Json** | Hash dos tokens ativos em `dados.refreshTokens[]` (se já estavam em coluna no legado, agora em Json) | DUserGroup |
| **API Keys** (colunas de DProject no legado) | **DTabela** `idClasse=-471` | `dEntidadeId` = projectId, `nome` = key name, `dados` = `{hash, scopes, lastUsedAt, expiresAt}` | DTabela |
| **MCP Keys** (colunas de DUserGroup no legado) | **DTabela** `idClasse=-472` | `dEntidadeId` = userId (via DEntidade do user), `dados` = `{hash, scopes, ...}` | DTabela |
| **Telegram chat link** (colunas de DEntidade no legado) | **DVincula** `idClasse=-483` | `idLocEscritu` = userId, `dados Json` = `{chatId, username, linkedAt}` | DVincula |
| **DProject (V3 colunados)** | **DProject** + `dados Json` para campos não-canônicos | Manter `chave`, `nome`. Mover `boardConfig`, `wipLimits`, `aiAgentConfig` para `dados` | DProject |
| **DTask (V3 colunados)** | **DTask** + `dados Json` | Manter `chave`, `titulo`, `idProject`, `idStatus`. Mover `priority`, `assignees[]`, `labels[]`, `customFields` para `dados` | DTask |

**Tabelas "DEPRECATED" do legado (não migram, ficam no histórico):**
- `DProjectMember` é fundida em `DVincula`.
- `DNotification`, `DWebhook`, `DAgent`, `DExecution` se dissolvem nas tabelas canônicas.

## 15.5 Estrutura de Arquivos Esperada

```
prisma/migrations-data/
├── 00-prereq-check.ts            # Valida seed, conexão dual (legado + V2), versões
├── 01-vinculos.ts                # DProjectMember → DVincula
├── 02-eventos.ts                 # DNotification → DEvento
├── 03-tabelas-config.ts          # DWebhook + API Keys + MCP Keys → DTabela
├── 04-entidades-agent.ts         # DAgent → DEntidade idClasse=-152
├── 05-pedidos-execution.ts       # DExecution → DPedido idClasse=-300
├── 06-task-dados-json.ts         # DTask V3 → DTask + dados Json
├── 06b-project-dados-json.ts     # DProject V3 → DProject + dados Json
├── 07-cleanup.ts                 # Drop de tabelas obsoletas no V2 (após validação)
├── _common/
│   ├── legacy-prisma.ts          # Prisma client apontando para legado (read-only)
│   ├── v2-prisma.ts              # Prisma client apontando para V2
│   ├── progress-reporter.ts      # Logger + counters
│   ├── checkpoint.ts             # Salva checkpoint a cada N registros (resumível)
│   └── diff-validator.ts         # Compara contagens e amostras
├── validation/
│   ├── 01-counts.ts              # Conta registros origem vs destino
│   ├── 02-sample-diff.ts         # Diff de 100 registros aleatórios por tabela
│   ├── 03-referential.ts         # Valida FKs (DVincula.idEntidade existe em DEntidade)
│   └── 04-business-invariants.ts # Invariantes (ex: cada user em org tem ≥1 vínculo)
├── rollback/
│   ├── 01-restore-snapshot.sh    # Restaura snapshot pg_dump
│   └── README.md
└── README.md                     # Como rodar, ordem, troubleshooting
```

## 15.6 Estratégia ETL (Extract → Transform → Load)

Cada script segue o mesmo padrão:

```typescript
// Pseudocódigo
async function migrate() {
  await assertSeedComplete();
  await assertCheckpointTable();

  const total = await legacy.dProjectMember.count();
  let processed = await getCheckpoint('01-vinculos');

  while (processed < total) {
    const batch = await legacy.dProjectMember.findMany({
      take: 1000,
      skip: processed,
      orderBy: { id: 'asc' }
    });

    await v2.$transaction(async (tx) => {
      const transformed = batch.map(transformToVincula);
      await tx.dVincula.createMany({ data: transformed, skipDuplicates: true });
      await saveCheckpoint('01-vinculos', processed + batch.length);
    });

    processed += batch.length;
    progress.report(processed, total);
  }

  await validateCounts();
}
```

**Idempotência:**
- `createMany({ skipDuplicates: true })` — evita re-inserir.
- Checkpoint table `MigrationCheckpoint(scriptName, processed, completedAt)` no V2.
- Re-rodar um script já completo é no-op.

**Atomicidade:**
- Cada batch (1000 registros) em uma transação.
- Falha no batch reverte só aquele batch — checkpoint não avança.
- Falha mid-script: re-rodar continua do checkpoint.

## 15.7 Tarefas Detalhadas

1. **Setup dual-database connection:** `legacy.prisma.schema` (read-only) + `v2.prisma.schema` (RW). Variáveis `LEGACY_DATABASE_URL` e `V2_DATABASE_URL`.
2. **Implementar `00-prereq-check.ts`:** valida seed do V2 (≥50 fixas + N específicas), conta origem, registra baseline.
3. **Implementar 7 scripts de migração** (01–07) seguindo o template ETL.
4. **Implementar 4 scripts de validação** (counts, sample diff, referential, business invariants).
5. **Implementar runbook de rollback** (snapshot + restore + smoke).
6. **Ensaios em staging:**
   - Ensaio 1: clone do banco prod → staging → roda scripts → valida → mede tempo.
   - Ensaio 2: idem, com falha injetada (kill no meio) → re-roda → valida idempotência.
   - Ensaio 3: roda V2 contra dados migrados em staging → smoke 128 endpoints.
   - Ensaio 4: timing precision — cronometrar cada passo do cutover.
   - Mínimo 3 ensaios completos antes do cutover real.
7. **Documentar diff esperado:** por tabela, contagem de origem vs destino (acceptable delta = 0).

## 15.8 Runbook de Cutover (Production-Grade)

**Janela alvo:** Domingo 02:00–06:00 BRT (4h, baixo tráfego).
**Equipe:** Backend Lead + Strategist + DBA + DevOps + 1 backup.
**Comunicação:** Banner no front do legado ("manutenção 02:00–06:00") agendado 48h antes.

### Pré-Cutover (24h antes)

| Passo | Ação | Tempo | Responsável |
|-------|------|-------|-------------|
| P-1 | Confirmar último ensaio em staging passou (todos validators verdes) | — | Strategist |
| P-2 | Snapshot do banco legado (`pg_dump --format=custom`) → S3 com 3 cópias | 60min | DBA |
| P-3 | Validar snapshot (restore em ambiente isolado, smoke quick) | 30min | DBA |
| P-4 | Comunicar equipes downstream (front, mobile, integrações externas) | 15min | Backend Lead |
| P-5 | Verificar deploy V2 em produção apontando para banco V2 vazio (com seed aplicado) | 30min | DevOps |
| P-6 | Verificar redirect/failover do load balancer documentado e testado | 30min | DevOps |
| P-7 | Banner agendado no legado (CMS/feature flag) | 10min | Backend Lead |

### Cutover (janela 02:00–06:00)

| Passo | Ação | Tempo | Ponto-de-não-retorno? |
|-------|------|-------|----------------------|
| C-1 | **02:00** Ativar banner "manutenção" no legado | 5min | Não |
| C-2 | **02:05** Freeze de writes no legado (set `READ_ONLY=true` env, restart) | 5min | Não (reverter = unset env) |
| C-3 | **02:10** Aguardar drain de jobs em flight (BullMQ workers) | 10min | Não |
| C-4 | **02:20** Snapshot final do legado (delta desde P-2) → S3 | 30min | Não |
| C-5 | **02:50** Validar contagem origem (snapshot S3) vs estado vivo (deve bater) | 5min | Não |
| C-6 | **02:55** Rodar `00-prereq-check.ts` em V2 | 2min | Não |
| C-7 | **02:57** Rodar `01-vinculos.ts` (DProjectMember → DVincula) | ~10min | Não |
| C-8 | **03:07** Rodar `02-eventos.ts` (DNotification → DEvento) | ~15min | Não |
| C-9 | **03:22** Rodar `03-tabelas-config.ts` (Webhook + API + MCP keys → DTabela) | ~5min | Não |
| C-10 | **03:27** Rodar `04-entidades-agent.ts` (DAgent → DEntidade) | ~3min | Não |
| C-11 | **03:30** Rodar `05-pedidos-execution.ts` (DExecution → DPedido) | ~20min | Não |
| C-12 | **03:50** Rodar `06-task-dados-json.ts` (DTask V3 → DTask + Json) | ~15min | Não |
| C-13 | **04:05** Rodar `06b-project-dados-json.ts` | ~3min | Não |
| C-14 | **04:08** Rodar validators 01–04 (counts, sample, referential, invariants) | 10min | Não |
| C-15 | **04:18** Smoke test 128 endpoints contra V2 (script automatizado) | 15min | Não |
| C-16 | **04:33** Smoke manual de 5 fluxos críticos (login, criar task, listar projects, executar agent, webhook) | 15min | Não |
| C-17 | **04:48** **PONTO-DE-NÃO-RETORNO** — Decisão GO / NO-GO da liderança | 10min | **SIM** |
| C-18 | **04:58** Se GO: swap de DNS / load balancer (legado → V2) | 5min | **SIM** |
| C-19 | **05:03** Remover banner "manutenção" | 2min | Sim |
| C-20 | **05:05** Smoke público (curl externo) confirmando V2 servindo | 5min | — |
| C-21 | **05:10** Anunciar conclusão para equipes; iniciar monitoramento intensivo (ver Fase 17) | 5min | — |

**Buffer:** 50 minutos (06:00 - 05:10) para imprevistos.

### Rollback Plan (se NO-GO em C-17 ou erro grave em C-7..C-16)

| Passo | Ação | Tempo |
|-------|------|-------|
| R-1 | Decisão NO-GO comunicada | imediato |
| R-2 | Reverter banner ("voltamos em breve") | 2min |
| R-3 | Reverter freeze de writes no legado (`READ_ONLY=false`, restart) | 5min |
| R-4 | Validar legado funcionando (smoke 5 fluxos) | 10min |
| R-5 | Anunciar rollback; agendar nova janela | imediato |
| R-6 | Pós-mortem (próximo dia útil) | — |

**Tempo total rollback:** <20 min. Banco V2 não é tocado (sem `DROP`); fica para próxima tentativa.

### Rollback Pós-Swap (se erro descoberto após C-18)

Mais grave — usuários já no V2. Estratégia:
1. Se erro for crítico (data corruption): swap reverso para legado + comunicar perda de transações da última hora (banner explicando).
2. Se erro for recuperável (bug em endpoint): hotfix + redeploy. Não fazer swap reverso.
3. Decisão de swap reverso requer **autorização do CTO/founder**. Documentar critério: erro afeta ≥10% requests E não tem hotfix em ≤30min.

## 15.9 Dependências

- Fase 14 concluída (V2 com testes verdes).
- Snapshot do banco legado validado.
- Acesso de rede entre máquina de migração e ambos os bancos.
- Seed do V2 aplicado e validado.
- Janela de manutenção comunicada aos stakeholders.

## 15.10 Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Cutover ultrapassa janela de 4h | Média | Alto | 3+ ensaios cronometrados; buffer de 50min; abort se ultrapassar 04:00 sem chegar em C-15 |
| Diff de contagem após migração | Média | **Crítico** | Validators rodam em todos ensaios; investigação obrigatória antes de cutover |
| Idempotência quebrar (script falha em re-execução) | Baixa | Alto | Ensaio 2 obrigatório com falha injetada |
| Constraint violation no V2 (FK órfã) | Média | Alto | Validator referential roda antes de cada cutover; ordem dos scripts respeita dependências |
| Performance — script demora horas | Média | Médio | Bulk inserts (createMany); batches de 1000; índices criados após inserção |
| Charset/encoding (UTF-8 vs LATIN1) | Baixa | Crítico | Validar em ensaio 1 com amostra de strings com acentos/emojis |
| Delta entre snapshot P-2 e estado vivo (writes durante 24h) | Alta | Médio | Snapshot final em C-4 captura delta; comparação em C-5 |
| Time de DBA indisponível na janela | Baixa | Crítico | 1 backup nomeado; runbook completo permite execução por outro engenheiro sênior |
| Front quebrar com novo formato de response | Média | Alto | Fase 14 garante paridade de contrato; smoke C-15 valida |
| Webhooks externos não recebem eventos durante migração | Alta | Baixo | Banner avisa; eventos críticos são re-enviados após launch (replay queue) |
| Senso de urgência levar a pular ensaios | Baixa | **Crítico** | Mínimo 3 ensaios bloqueante; documento de approval do Tech Lead |

## 15.11 Definition of Done (18 itens)

- [ ] 7 scripts de migração implementados e idempotentes.
- [ ] 4 scripts de validação implementados.
- [ ] Runbook de rollback escrito e testado em staging.
- [ ] Ensaio 1 (clone prod → staging) verde, tempo medido.
- [ ] Ensaio 2 (com falha injetada) verde, idempotência confirmada.
- [ ] Ensaio 3 (V2 contra dados migrados, smoke 128 endpoints) verde.
- [ ] Ensaio 4 (cronometragem precisa do cutover) verde, dentro de 4h.
- [ ] Snapshot pg_dump testado (restore em ambiente isolado).
- [ ] Validador de counts: delta = 0 em todos os mapeamentos.
- [ ] Validador de sample diff: ≥99% match (whitelist documentada para diferenças aceitáveis).
- [ ] Validador referential: 0 FKs órfãs.
- [ ] Validador business invariants: todos checks verdes.
- [ ] Charset/encoding validado com amostra acentuada.
- [ ] Comunicação 48h antes enviada para todas as equipes downstream.
- [ ] Banner de manutenção agendado no front.
- [ ] Equipe (5 pessoas) confirmada e disponível na janela.
- [ ] Critério de GO/NO-GO em C-17 documentado e assinado por Tech Lead.
- [ ] Pós-cutover: validação de contagem em produção verde dentro de 1h.

## 15.12 Tempo Estimado

| Atividade | Dias |
|-----------|------|
| Implementar 7 scripts de migração | 1.5 |
| Implementar 4 validadores + harness ETL | 0.5 |
| Ensaios 1+2+3+4 em staging | 1.5 |
| Documentação de runbook + rollback | 0.5 |
| **Total Fase 15 (preparação)** | **4 dias úteis** |
| Cutover + buffer | 4h (janela noturna) |

## 15.13 Como Validar (Smoke + Gates)

1. Após cada ensaio em staging: rodar `npm run validate:migration` (executa todos validators).
2. Smoke V2 contra dados migrados: `npm run test:e2e -- --testPathPattern=api-contract`.
3. Após cutover real: validador roda em loop por 1h, alerta em qualquer regressão.
4. Pós-cutover (24h): comparação contínua de métricas (volume de tasks criadas, logins) vs baseline do legado.

---

# FASE 16 — DOCUMENTAÇÃO + HANDOFF

## 16.1 Objetivo

Entregar documentação enterprise-grade que permita a um engenheiro novo (não envolvido na construção) operar, debugar e estender o V2 em ≤1 semana de onboarding. Inclui: API docs (Swagger 100%), JSDoc 100% nos services, ADRs cumulativos, runbook operacional, guia de migração legada, e tutorial em vídeo curto sobre os pontos mais críticos.

## 16.2 Pilares Ativados

- Documentar QUAL pilar cada feature usa.
- Documentar endpoints genéricos reutilizados (Pilar 2) e como o front consome.
- Documentar seed e como customizar para projetos derivados (Pilar 3).
- Documentar Engine `OperacaoExecucaoClaude` e DVFS (Pilar 1).

## 16.3 Padrões Obrigatórios Aplicados

- Padrão #17: Swagger decorators completos em todos os 128 endpoints.
- Padrão #18: Imports organizados (visíveis em exemplos).
- `devari-jsdoc-templates.md`: JSDoc seguindo template (descrição, params, returns, examples, throws).
- `devari-conventional-commits.md`: CHANGELOG gerado a partir de commits.

## 16.4 Tabelas Canônicas Envolvidas

Todas as 17 documentadas em `docs/POLYMORPHIC-GUIDE.md` com mapeamento `idClasse → semântica` específico do Scrumban.

## 16.5 Estrutura de Arquivos Esperada

```
docs/
├── README.md                        # Índice da documentação
├── ARCHITECTURE.md                  # Arquitetura V2 (módulos, fluxos, decisões macro)
├── DECISIONS.md                     # ADRs cumulativos (todos do projeto)
├── adrs/
│   ├── ADR-001-v2-greenfield.md
│   ├── ADR-002-task-dados-json.md
│   ├── ADR-003-rbac-strategy.md
│   ├── ADR-004-engine-execucao-claude.md
│   ├── ADR-005-risk-gate-design.md
│   ├── ADR-006-cutover-strategy.md
│   └── ...
├── RUNBOOK.md                       # Troubleshooting, comandos, alarms
├── MIGRATION-FROM-V1.md             # Como rodar migration scripts, validar, rollback
├── POLYMORPHIC-GUIDE.md             # Como entender DClasse → idClasse → tabelas canônicas
├── ENGINE-GUIDE.md                  # OperacaoExecucaoClaude, DVFS, lifecycle
├── RBAC-GUIDE.md                    # Permissões, OrgTenantGuard, ProjectScopeGuard
├── EVENTS-GUIDE.md                  # BullMQ filas, EventRouterService, event naming
├── FRONTEND-INTEGRATION.md          # Como front consome (cookies httpOnly, refresh, RBAC)
├── API.md                           # Link para Swagger UI + visão geral dos 22 módulos
├── ROADMAP.md                       # Pós-launch features
├── CHANGELOG.md                     # Conventional commits agregados
├── SECURITY.md                      # Modelo de ameaças, controles, contato responsible disclosure
├── ONBOARDING.md                    # Setup local (1h, passo a passo)
├── CONTRIBUTING.md                  # Como contribuir, fluxo de PR, padrões
├── load-tests/                      # Resultados de Fase 14
├── videos/
│   └── operacao-execucao-claude.md  # Script + link YouTube unlisted
└── plano/                           # Os planos das fases (este arquivo)

README.md (root)                     # Quickstart: clone, env, make dev
Makefile                             # Comandos canônicos (dev, build, test, migrate, seed)
```

## 16.6 Tarefas Detalhadas

### 16.6.1 API Docs (Swagger 100%)

1. Para cada controller, todos os métodos têm:
   - `@ApiOperation({ summary, description })`.
   - `@ApiParam` para todo path param.
   - `@ApiQuery` para todo query param.
   - `@ApiBody` apontando para DTO.
   - `@ApiResponse` para 200, 400, 401, 403, 404, 409, 500 (quando aplicável).
   - `@ApiBearerAuth()` em endpoints protegidos.
2. DTOs com `@ApiProperty({ example, description })` em TODOS os campos.
3. Exemplos realistas (não `"string"` genérico).
4. Swagger UI disponível em `/api/docs` (autenticado em produção).
5. Export de OpenAPI JSON em CI: `npm run swagger:export` → `docs/openapi.json` versionado.

### 16.6.2 README + Onboarding

1. README root: 1 página, foco em "executar em 5min":
   - `git clone`
   - `cp .env.example .env` (com defaults dev)
   - `make up` (docker-compose: postgres + redis)
   - `make migrate seed`
   - `make dev`
   - `curl localhost:3000/api/v1/health`
2. ONBOARDING.md: 1h de leitura. Cobre 3 Pilares, 17 tabelas, fluxo de auth, fluxo de execução claude.
3. Makefile com targets: `dev`, `build`, `test`, `test:e2e`, `migrate`, `seed`, `seed:reset`, `lint`, `typecheck`, `format`, `up`, `down`, `logs`, `psql`, `redis-cli`.

### 16.6.3 ARCHITECTURE.md

1. Diagrama macro (Mermaid) com módulos NestJS e dependências.
2. Diagrama de tabelas canônicas (17 caixas + relações principais).
3. Fluxo de request típico (controller → service → engine → prisma → BullMQ).
4. Decisões arquiteturais com link para ADR.

### 16.6.4 ADRs

1. Para cada decisão importante do V2 (revisar PRs e RELATÓRIOS-DIVERGÊNCIA), criar 1 ADR.
2. Total esperado: 15–25 ADRs.
3. Cada ADR seguindo template do `strategist.md` (Status, Contexto, Alternativas, Decisão, Consequências).

### 16.6.5 RUNBOOK.md

1. Comandos de diagnóstico:
   - "Como saber se BullMQ está saudável?" → `make redis-cli` + comandos.
   - "Como ver queries lentas?" → DATABASE_LOGGING + grep.
   - "Como invalidar cache?" → comando.
2. Troubleshooting comum:
   - Login retorna 500 → checar JWT keys.
   - Tasks não aparecem → checar OrgTenantGuard + idClasse.
   - Engine falha em `aprova()` → checar DVFS.
3. Alarms:
   - p95 > 500ms → degradar.
   - error rate > 1% → page.
   - queue depth > 1000 → escalar workers.

### 16.6.6 MIGRATION-FROM-V1.md

1. Pré-requisitos.
2. Como rodar scripts (com flags, env vars).
3. Como validar (rodar validators).
4. Como rollback.
5. Troubleshooting comum dos scripts.

### 16.6.7 POLYMORPHIC-GUIDE.md

1. As 17 tabelas e seu papel.
2. Como `idClasse` determina semântica.
3. Mapa específico do Scrumban: cada idClasse usado e seu significado.
4. Como adicionar nova feature sem criar tabela (exemplo passo-a-passo).

### 16.6.8 ENGINE-GUIDE.md

1. `OperacaoExecucaoClaude`: workflow completo.
2. DVFS scripts: como customizar.
3. Por que Engine vs Prisma direto.
4. Exemplos de extensão (criar novo Engine derivado).

### 16.6.9 JSDoc 100% nos Services

1. Todo método público de service tem JSDoc (template do `devari-jsdoc-templates.md`):
   - Descrição do que faz e por quê.
   - `@param` para cada parâmetro.
   - `@returns`.
   - `@throws` para HttpExceptions.
   - `@example` quando útil.
2. Engine 100% documentado (toda fase do workflow).
3. CI: `typedoc` gera HTML em `docs/api-internal/`. Falha se cobertura JSDoc <90%.

### 16.6.10 Vídeo Tutorial (script)

1. Vídeo de 8–12 minutos cobrindo:
   - Tour pelo código (módulos).
   - Demo de criar uma task.
   - Demo de executar agent (Engine + Risk Gate + Approval).
   - Como debugar uma execução problemática.
2. Script em `docs/videos/operacao-execucao-claude.md` (5 cenas, locução, comandos exatos).
3. Gravação opcional na Fase 16; agendar após launch.

### 16.6.11 ROADMAP + CHANGELOG

1. ROADMAP.md: backlog pós-launch (canais futuros — Slack, Discord; integração GitHub; melhorias de Risk Gate; etc.). Mínimo 10 itens.
2. CHANGELOG.md: agregar conventional commits desde início do V2.

## 16.7 Dependências

- Fases 14 e 15 concluídas (código estável).
- ADRs do projeto (espalhados em PRs e relatórios) consolidados.

## 16.8 Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Documentação envelhecer rápido | Alta | Médio | CI quebra se Swagger desatualizado; PR template exige update de docs |
| JSDoc cobertura <90% | Média | Médio | typedoc no CI bloqueia merge; reservar 0,5 dia extra |
| ADRs faltarem decisões importantes | Média | Médio | Revisão cruzada entre os 4 strategists antes do close |
| Vídeo não gravado a tempo | Alta | Baixo | Aceitar gravar 2 semanas pós-launch; script + screenshots cobrem MVP |
| Onboarding ineficaz | Média | Alto | Validar com 1 engenheiro externo (3rd-party reader test) antes do close |

## 16.9 Definition of Done (15 itens)

- [ ] Swagger UI 100% completo, todos endpoints documentados com exemplos.
- [ ] OpenAPI JSON exportado e versionado.
- [ ] README root <100 linhas, executável em 5min.
- [ ] ONBOARDING.md validado por engenheiro externo.
- [ ] ARCHITECTURE.md com diagramas Mermaid.
- [ ] ADRs (≥15) cumulativos em `docs/adrs/`.
- [ ] RUNBOOK.md com troubleshooting + alarms.
- [ ] MIGRATION-FROM-V1.md validado em ensaio.
- [ ] POLYMORPHIC-GUIDE.md com mapa específico do Scrumban.
- [ ] ENGINE-GUIDE.md cobrindo OperacaoExecucaoClaude + DVFS.
- [ ] RBAC-GUIDE.md, EVENTS-GUIDE.md, FRONTEND-INTEGRATION.md, SECURITY.md.
- [ ] JSDoc cobertura ≥90% (typedoc).
- [ ] Script de vídeo escrito (gravação opcional).
- [ ] ROADMAP.md com ≥10 itens.
- [ ] CHANGELOG.md gerado de conventional commits.

## 16.10 Tempo Estimado

| Atividade | Dias |
|-----------|------|
| Swagger + JSDoc | 0.5 |
| ADRs + ARCHITECTURE | 0.5 |
| Runbook + Migration + Polymorphic + Engine guides | 0.5 |
| Onboarding + RBAC + Events + Frontend + Security | 0.5 |
| **Total Fase 16** | **2 dias úteis** |

## 16.11 Como Validar

1. Engenheiro externo lê ONBOARDING.md, segue instruções, sobe V2 local em ≤1h.
2. Reviewer aprova checklist 16.9.
3. CI verde (typedoc, swagger export, link checker).

---

# FASE 17 — LAUNCH + PÓS-LAUNCH

## 17.1 Objetivo

Executar o launch produção-grade do V2 com monitoramento intensivo, hotfix protocol claro, coleta de feedback estruturada, e captura de aprendizados para retroalimentação no Devari Core (template framework).

## 17.2 Pilares Ativados

- Validar em produção que os 3 pilares operam corretamente sob carga real.
- Captura de métricas para alimentar evolução do template.

## 17.3 Padrões Obrigatórios Aplicados

- Padrão #11: Logging estruturado em todas as ocorrências de produção.
- Padrão #21: Checklist completo aplicado.

## 17.4 Tabelas Canônicas Envolvidas

Todas — monitoramento de volume, growth e health por tabela.

## 17.5 Estrutura de Arquivos Esperada

```
docs/
├── launch/
│   ├── PRE-LAUNCH-CHECKLIST.md
│   ├── LAUNCH-DAY-CHECKLIST.md
│   ├── POST-LAUNCH-24H.md
│   ├── POST-LAUNCH-WEEK1.md
│   ├── POST-LAUNCH-MONTH1.md
│   ├── HOTFIX-PROTOCOL.md
│   └── INCIDENT-LOG/             # Incidentes registrados durante 30 dias pós-launch
└── retro/
    ├── 2026-XX-launch-retro.md   # Retrospectiva técnica
    └── lessons-to-template.md    # Aprendizados → atualizar Devari Core rules
```

## 17.6 Pré-Launch Checklist (T-7 dias, T-1 dia)

### T-7 dias

- [ ] Build green em main (todos CI checks).
- [ ] Cobertura testes ≥80%.
- [ ] Security review aprovado por Security Lead.
- [ ] Load test arquivado, p95 dentro do SLO.
- [ ] Migração ensaiada ≥3 vezes em staging.
- [ ] Snapshot de prod validado (restore em isolamento).
- [ ] DRP (Disaster Recovery Plan) escrito.
- [ ] Comunicação enviada (T-7) para todos stakeholders.
- [ ] On-call schedule definido para janela + 7 dias seguintes.
- [ ] Rollback runbook revisado e aprovado.

### T-1 dia

- [ ] Banner de manutenção agendado.
- [ ] Equipe de cutover confirmada (5 pessoas).
- [ ] Acessos validados (SSH, banco, AWS, monitoring).
- [ ] War room agendado (Zoom/Slack canal).
- [ ] Chocolate/café para a equipe.
- [ ] Sleep early. Hidrate.

## 17.7 Launch Day Checklist (executado durante a janela de 4h da Fase 15)

Já detalhado em 15.8 (cutover runbook). Adições:

| Gate | Responsável | Critério |
|------|-------------|----------|
| Pré-cutover GO/NO-GO | Tech Lead | Snapshot validado, equipe presente, banner ativo |
| Mid-cutover GO/NO-GO (após validators) | Tech Lead + Strategist | Diff = 0, smoke endpoints verde |
| **Final GO/NO-GO (C-17)** | **CTO/Founder + Tech Lead** | Smoke manual de 5 fluxos críticos verde |
| Pós-swap monitoramento (1h) | Backend Lead | Error rate <1%, p95 dentro SLO |

## 17.8 Pós-Launch — Primeiras 24h

1. **Monitoramento intensivo:**
   - 1 engenheiro on-call dedicado por turno (3 turnos de 8h).
   - Dashboard Grafana aberto: error rate, latency p50/p95/p99, queue depth, DB connections.
   - Alertas Slack em: error rate >1% por 5min, p95 >500ms por 10min, queue depth >5000.
2. **Standup a cada 4h:**
   - Status de incidentes.
   - Métricas vs baseline.
   - Decisões pendentes.
3. **Hotfix protocol:**
   - Bug crítico (afeta >10% users): hotfix branch → PR fast-track (1 reviewer) → merge → deploy em <1h.
   - Bug não-crítico: backlog, próximo deploy.
4. **Coleta de feedback:**
   - Canal Slack `#scrumban-v2-launch` para usuários internos.
   - Formulário público (Typeform) para usuários externos.

## 17.9 Pós-Launch — Semana 1

1. Daily standup (15min) com time + stakeholders.
2. Triage diário do feedback recebido (label: bug, ux, feature-request).
3. Hotfix queue priorizada (bugs críticos).
4. Performance tuning baseado em métricas reais (top 10 endpoints lentos).
5. Comparação contínua de métricas vs baseline:
   - Volume de requests (deve estar ±5% do legado).
   - Error rate (deve ser <= legado).
   - Latency p95 (deve ser ≤ legado).
6. Relatório de status semanal para stakeholders.

## 17.10 Pós-Launch — Mês 1

1. **Retrospectiva técnica:**
   - O que deu certo?
   - O que deu errado?
   - O que aprendemos?
2. **Sessão de retro com Devari-Core (OBRIGATÓRIA — implementação do ADR-V2-017):**
   - Reunir Tech Lead + Strategist + Implementer + Reviewer + Documenter por 1 semana dedicada.
   - **Insumos:**
     - 17 arquivos `docs/lessons/metrics-fase-NN.md` produzidos ao longo da maratona (F0..F17).
     - Issues `evolution-from-v2` abertas durante todas as fases.
     - 14 ADRs do V2 + ADR-V2-017 (este).
   - **Saída obrigatória:** `docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md` consolidando:
     - Sumário executivo das propostas
     - Top 5 capacidades modernas que viram **módulos opt-in** propostos (Channels, MCP, Automation, Voice/Whisper, Webhooks HMAC dispatcher são candidatos óbvios — confirmar com dados)
     - Top 10 DClasses candidatas a virar **fixas** no `templates/classes-base-template.ts`
     - Sugestões de **novas rules** em `.claude/rules/` (ex.: `devari-channels.md`, `devari-mcp-tools.md`, `devari-claude-automation.md`)
     - Bugs do template descobertos pelo V2 (ex.: `s.id` vs `s.chave` em DVFS, citado na auditoria PARTE-1)
   - **DoD da retro:** 5–10 PRs reais abertos no repositório Devari-Core com label `evolution-from-v2`. **Sem esses PRs, a Fase 17 não fecha.**
3. **Lessons learned → Devari Core (operacionalização do retro):**
   - Patterns novos descobertos viram regra em `.claude/rules/`.
   - ADRs novos viram template para próximos SaaS.
   - Anti-patterns descobertos viram alerta no Reviewer.
   - Capacidades modernas viram módulos opt-in / templates novos no Generator (PARTE-3 v3.0).
4. **Atualização do template:**
   - PRs do retro são abertos imediatamente, mesmo sem merge garantido (cadência trimestral de absorção pelo Devari-Core).
5. **Monitoramento contínuo:**
   - Dashboard mantido.
   - Alertas refinados (reduzir falsos positivos).
6. **Roadmap pós-launch ativado** (canais futuros, melhorias).

**Reforço de princípio:** V2 NÃO é projeto isolado. V2 é piloto que mede e contribui. A retro do mês 1 é o ponto de transferência do conhecimento — sem ela, a maratona V2 perde 50% do seu valor estratégico para o Devari-Core. Família depende do produto V2 entregue; o ecossistema Devari depende dessa retro.

## 17.11 Hotfix Protocol Detalhado

```
1. Identificação: alerta ou report manual.
2. Severity:
   - SEV1 (crítico, afeta >50% users ou data loss): war room imediato, hotfix em <1h.
   - SEV2 (sério, afeta 10-50% users): hotfix em <4h.
   - SEV3 (menor, afeta <10% users): próximo deploy regular.
3. Branch: `hotfix/sev{N}-{slug}`.
4. PR fast-track: 1 reviewer obrigatório, CI verde, deploy direto.
5. Comunicação: status page atualizado, banner se SEV1/SEV2.
6. Pós-fix: incidente registrado em `docs/launch/INCIDENT-LOG/`.
```

## 17.12 Dependências

- Fases 14, 15, 16 concluídas.
- Equipe de on-call definida e disponível.
- Infraestrutura de monitoramento (Grafana, alertas Slack) operacional.

## 17.13 Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Bug crítico em produção descoberto pós-swap | Média | Crítico | Hotfix protocol; ensaio do hotfix em staging antes do launch |
| Carga real maior que load test | Baixa | Alto | Auto-scaling habilitado; load test com 2x margem |
| Equipe esgotada após cutover | Alta | Médio | Turnos rotativos 24h; folga compensatória pós-launch |
| Feedback negativo de usuários | Média | Médio | Canal de feedback estruturado; resposta em <24h |
| Aprendizados não incorporados ao template | Alta | Médio | Mês 1 termina com PR mandatório no Devari-Core |
| Regressão detectada após semana 1 | Baixa | Alto | Smoke tests automatizados rodando a cada deploy |

## 17.14 Definition of Done (19 itens)

- [ ] Pré-launch checklist 100% verde (T-7 e T-1).
- [ ] Launch day checklist 100% verde.
- [ ] V2 servindo 100% do tráfego em produção.
- [ ] Legado mantido em standby por 7 dias (read-only) para emergência.
- [ ] Monitoramento intensivo 24h documentado em `INCIDENT-LOG/dia-1.md`.
- [ ] Hotfix protocol ativado e testado (mesmo se nenhum hotfix necessário, simular).
- [ ] Standups diários documentados (semana 1).
- [ ] Métricas vs baseline relatadas (semana 1).
- [ ] Retrospectiva técnica realizada (mês 1).
- [ ] Lessons learned documentadas em `docs/retro/lessons-to-template.md`.
- [ ] **Sessão de retro com Devari-Core executada (mês 1)** — implementação do ADR-V2-017.
- [ ] **`docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md` consolidado e mergeado.**
- [ ] **5–10 PRs reais abertos no Devari-Core** com label `evolution-from-v2` (entregável obrigatório do feedback loop).
- [ ] PR(s) no Devari-Core com atualizações de regras (`.claude/rules/`).
- [ ] Roadmap pós-launch publicado.
- [ ] Dashboards Grafana ajustados (alertas refinados).
- [ ] Snapshot do legado arquivado (3 cópias S3, retenção 1 ano).
- [ ] Decomissionamento do legado planejado (data alvo: launch + 60 dias).
- [ ] Equipe descansada e celebrada.

## 17.15 Tempo Estimado

| Atividade | Duração |
|-----------|---------|
| Pré-launch (T-7 a T-1) | 7 dias (paralelo a Fases 14–16) |
| Launch day (cutover Fase 15) | 4h |
| Pós-launch 24h (intensivo) | 24h corrido |
| Pós-launch semana 1 | 7 dias |
| Pós-launch mês 1 | 30 dias |
| **Total atividades dedicadas** | ~40 dias calendário (parte em background) |

## 17.16 Como Validar

1. Métricas em produção batem ou superam baseline do legado em 7 dias.
2. Zero incidentes SEV1 em 30 dias pós-launch.
3. Lessons learned PR mergeado no Devari-Core.
4. Feedback estruturado coletado de ≥10 usuários.

---

# Apêndices

## A. Sequência Cronológica Sugerida

```
Dia 1–5:  Fase 14 (hardening) — em paralelo, time de docs começa estruturar Fase 16.
Dia 6:    Fase 16 concluída (curta, 2 dias com paralelismo).
Dia 7–10: Fase 15 — implementação de scripts + ensaios em staging.
Dia 11:   Ensaio final de cutover.
Dia 12:   Window de comunicação T-7 ativada.
Dia 19:   T-1 checklist.
Dia 20:   Cutover (fim de semana, janela 02:00–06:00).
Dia 20-21: Pós-launch 24h.
Dia 21-27: Pós-launch semana 1.
Dia 27-50: Pós-launch mês 1.
Dia 50+:   Decomissionamento do legado, retro final, evolução contínua.
```

## B. Equipe Mínima por Fase

| Fase | Pessoas | Papéis |
|------|---------|--------|
| 14 | 3 | Backend Lead, QA, Security |
| 15 (prep) | 3 | Backend Lead, DBA, Strategist |
| 15 (cutover) | 5 | Backend Lead, DBA, DevOps, Strategist, Backup |
| 16 | 2 | Tech Writer + Backend Lead |
| 17 (pós-launch 24h) | 3 (turnos) | On-call rotativo |
| 17 (semana+mês) | 1–2 | Backend Lead + analista |

## C. Métricas de Sucesso (KPIs)

1. **Cutover sucesso:** janela ≤4h, diff = 0, zero perda de dados.
2. **SLOs em produção (30 dias):** uptime ≥99.9%, p95 ≤200ms, error rate ≤0.5%.
3. **Cobertura testes:** ≥80% lines, ≥70% branches.
4. **Documentação:** Swagger 100%, JSDoc ≥90%.
5. **Aprendizados:** ≥3 lições incorporadas ao Devari Core template.

## D. Checklist Final Master (antes de declarar projeto entregue)

- [ ] Todas as 4 fases (14–17) com Definition of Done verde.
- [ ] V2 em produção servindo tráfego real.
- [ ] Legado decommissionado (ou agendado para D+60).
- [ ] Documentação validada por engenheiro externo.
- [ ] Aprendizados retroalimentando Devari Core.
- [ ] Equipe descansada e reconhecida.
- [ ] Family safe. Mission accomplished.

---

**FIM DO PLANO 04 — HARDENING + HANDOFF**

*"Disciplina máxima. Zero tabela nova. Família depende. Fazer rápido E correto."*
