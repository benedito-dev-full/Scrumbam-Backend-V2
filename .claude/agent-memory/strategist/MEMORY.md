# Strategist Agent Memory — Scrumban-Backend-V2

**Versão:** 1.3
**Última atualização:** 2026-05-15 (F13 Milestone 1 corretivo — ADR-V2-043 precedente, ADR-V2-044 full clone)
**Atualizar:** ao concluir cada task. Limite ~200 linhas; acima disso, mover histórico antigo para `agent-memory/strategist/<topic>.md`.

**Tópicos extras (vide arquivos no mesmo diretório):**
- `historico-plans.md` — tabela completa de plans produzidos + padrões estabelecidos em F2
- `referencias-canonicas.md` — conflitos resolvidos no §3.3 do plano-mestre + tabela de documentação-chave

---

## INSTRUÇÕES DE USO

- Consultar **ANTES** de criar qualquer plan
- Registrar decisões novas ao concluir cada task
- Manter atualizado (remover obsoleto)
- Memory é **injetada automaticamente** no system prompt via `memory: project` no frontmatter

---

## CONTEXTO DO PROJETO

**Scrumban-Backend-V2** é a refundação canônica do Scrumban legado, sob o template Devari-Core.
**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Estado:** F8 Task#2 (Search — Bloco U) — plan entregue. Aguardando Implementer. Após APPROVED, Documenter fecha F8 completa (S+T+U) num único ciclo.
**Cronograma:** 24 semanas (otimista 20, pessimista 29) com 1 implementer dedicado + strategist e reviewer parciais.
**Família depende.** Corda justa. Sem afrouxar.

---

## REGRAS CRÍTICAS V2 (NÃO-NEGOCIÁVEIS)

1. **ZERO tabela nova.** Apenas as 17 canônicas Devari-Core. Hook `enforce-canonical-tables.sh` bloqueia mecanicamente.
2. **Engine APENAS em DPedido idClasse=-300** (executions). Cadastros estruturais (DEntidade/DTask/DProject/DTabela) usam Service + Prisma direto.
3. **Seed PRIMEIRO** (Pilar 3 antes de qualquer linha de código). Sem seed, sistema NÃO INICIA.
4. **Endpoints genéricos reusados.** `/entidades`, `/tabelas`, `/classes` antes de qualquer controller próprio. Exceções autorizadas: `/projects`, `/tasks`, `/executions`, `/auth`, `/sprints` (wrapper thin), `/workflow-statuses` (wrapper thin).
5. **DClasses sequestradas voltam ao canônico.** Legado usou -47=Usuário, -49=Platform, -50=Org. V2 renumera para -150 (USER), -151 (PLATFORM_SCRUMBAN), -152 (ORGANIZATION).
6. **Score gate APPROVED ≥ 7.0** (Reviewer). Hook `validate-review-score.sh` bloqueia mecanicamente.
7. **Escopo = Scrumban-hoje** (`Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md`), não o `scrumban-spec.yaml` antigo. 128 endpoints, V3 Intentions, MCP, Telegram+Groq, Webhooks HMAC, Automation Claude Code com Risk Gate.
8. **Cronograma 24 semanas — não é corrida, é maratona.** Velocidade é consequência de disciplina.

---

## OS 3 PILARES (CONHECIMENTO ESTRUTURAL CRÍTICO)

### Pilar 1 — Engine/Operação (CORAÇÃO)
- Workflow obrigatório: `nova() → setDados() → calcula() → aprova() → grava()`
- F6 ativa o Pilar 1 via `OperacaoExecucaoClaude extends OperacaoPedido` (ADR-V2-005)
- DPedido idClasse=-300 (EXECUTION agrupador), -301/-302/-303 (LOW/MED/HIGH)
- DVFS scripts (chaves 3-7): pre-calc, calc, pos-calc, pre-grav, pos-grav (ADR-V2-007)
- F13 (Automation Claude Code) usa o Engine de F6

### Pilar 2 — Endpoints Genéricos (DRY)
- `/entidades?idClasse=X` (DEntidade)
- `/tabelas?classe=X` (DTabela — convenção `?classe=NOME` string, ADR-V2-015 a ratificar)
- `/classes` (DClasse)
- F2 ativa o Pilar 2 (3 controllers genéricos)
- Wrappers thin autorizados: `/sprints` → `/tabelas?classe=SPRINT`; `/workflow-statuses` → `/tabelas?classe=STATUS_INTENTION_V3` (ADR-V2-009)

### Pilar 3 — Seed de Classes (CÉREBRO POLIMÓRFICO)
- ~50 classes fixas (`templates/classes-base-template.ts`, range -1..-110) + ~70 classes V2-específicas (range -150..-529)
- F1 ativa o Pilar 3 (seed completo)
- Total V2: ~120 DClasses
- Chave NEGATIVA = seed (definidas pelo desenvolvedor); chave POSITIVA = runtime (criadas pela aplicação)
- NUNCA sequestrar -1..-110, -40, -45, -47, -49, -50 (fixas canônicas)

---

## AS 17 TABELAS CANÔNICAS DEVARI-CORE

**Estruturais (10 — Prisma direto via Service):**
- DClasse — taxonomia (sistema de tipos polimórfico)
- DEntidade — pessoas, orgs, sellers, agents, etc.
- DTabela — lookups, configs, tokens
- DVincula — relações genéricas (RBAC, vínculos)
- DEvento — audit trail (notifications, webhook attempts, etc.)
- DRecurso — produtos/recursos (reservada V2, sem uso direto)
- DUserGroup — credenciais de login
- DPermissao — permissões granulares
- DTask — tarefas (V3 Intentions com colunas tipadas)
- DProject — projetos

**Transacionais (6 — Engine para INSERT):**
- DPedido — execuções Claude (idClasse=-300, F6)
- DTitulo — reservada V2
- DMovDispo — reservada V2
- DMovDepos — reservada V2
- DSolicita — reservada V2
- DRequisic — reservada V2

**Infraestrutura (1):**
- DVFS — scripts de Engine (chaves 3-7)

---

## MAPA DAS 17 FASES V2

| # | Fase | Pilar dominante | Estrategista | Output canônico |
|---|------|-----------------|--------------|-----------------|
| **0** | Verificação canônica + setup repo + multi-agent infra | — | A | esqueleto + hooks + `.claude/` populado |
| **1** | Schema 17 tabelas + Seed DClasses | **Pilar 3** | A | `prisma/schema.prisma` + `prisma/seeds/classes.seed.ts` (~120 classes) |
| **2** | Endpoints Genéricos `/entidades` `/tabelas` `/classes` | **Pilar 2** | A | 3 controllers + Services + DTOs |
| **3** | Auth + RBAC duplo via DUserGroup + DVincula | — | A | JWT + Guards + AuthCompositeGuard |
| **4** | Email module + Common Services | — | A | TimezoneService + Pipes + Email provider |
| **5** | Domínio estrutural (Org/Team/Project/Sprint/Status/Task) | Pilar 2 | B | DEntidade/DTabela/DProject/DTask |
| **6** | **Engine + OperacaoExecucaoClaude** | **Pilar 1** | B | `src/engine/` + DVFS scripts |
| **7** | Eventos canônicos (DEvento + EventProducerService) | — | B | Producer + Router + Notifications |
| **8** | Flow Metrics + Forecast + Search | — | B | Analytics derivado, sem persistência |
| **9** | Reports + Dashboards + Analytics | — | B | Read-only com cache TTL |
| **10** | Channels (Telegram + voz Groq Whisper) | — | C | DTabela pairing + DVincula + DEvento |
| **11** | MCP Server (5 tools) | — | C | DTabela MCP_KEY + DEvento MCP_CALL |
| **12** | Webhooks outbound (HMAC + retry) | — | C | DTabela WEBHOOK + DEvento WEBHOOK_ATTEMPT |
| **13** | **Automation Claude Code** (Risk Gate + 58 testes adversariais) | **Pilares 1+2** | C | DEntidade AGENT + DPedido EXECUTION |
| **14** | Hardening (tests + security + observabilidade) | — | D | ≥80% coverage + load test |
| **15** | Migration de dados do legado | — | D | ETL + cutover 4h + rollback |
| **16** | Documentação + Handoff | — | D | Swagger 100% + ADRs + Runbook |
| **17** | Launch + pós-launch | — | D | Janela 4h + monitoramento |

---

## OS 14 ADRs PROPOSTOS V2

| ADR | Título | Fase | Status |
|-----|--------|------|--------|
| ADR-V2-001 | 17 tabelas canônicas — zero tabela nova | F0 | Proposto |
| ADR-V2-002 | Renumeração de DClasses sequestradas | F1 | Proposto |
| ADR-V2-003 | RBAC duplo via DVincula + idClasse | F3 | Proposto |
| ADR-V2-004 | API Keys e MCP Keys via DTabela | F3 | Proposto |
| ADR-V2-005 | OperacaoExecucaoClaude extends OperacaoPedido | F6 | Proposto |
| ADR-V2-006 | Risk LOW/MED/HIGH via idClasse específico | F6 | Proposto |
| ADR-V2-007 | DVFS scripts como mecanismo de portabilidade | F6 | Proposto |
| ADR-V2-008 | DEvento substitui DNotification e DWebhook | F7 | Proposto |
| ADR-V2-009 | Sprints e Workflow Statuses como wrappers thin | F5 | Proposto |
| ADR-V2-010 | Channels como módulo opcional | F10 | Proposto |
| ADR-V2-011 | MCP Keys com rate limit Redis | F11 | Proposto |
| ADR-V2-012 | Webhooks: HMAC-SHA256 + retry 3x + auto-disable | F12 | Proposto |
| ADR-V2-013 | Agent como DEntidade idClasse=-156 | F13 | Proposto |
| ADR-V2-014 | Migration ETL + cutover 4h + rollback <15min | F15 | Proposto |

ADRs adicionais (V2-015+):
- ADR-V2-015 Score gate APPROVED ≥ 7.0 (a ratificar com hook)
- ADR-V2-016 Convenção `?classe=NOME` (string) prevalece sobre `?idClasse=N` (numérico)
- ADR-V2-200 Submissão ao template Devari-Core (declarativo no CLAUDE.md raiz)

---

## CONFLITOS RESOLVIDOS NO §3.3 DO PLANO-MESTRE

Detalhe completo (tabela de 6 conflitos canônicos sequestrados/renumerados) movido para `referencias-canonicas.md`. Consultar lá antes de propor nova renumeração de DClasse no range -150..-529.

---

## SEED CANÔNICO V2 (RESUMO — DETALHE EM §3.2 DO PLANO-MESTRE)

**Faixas reservadas:**
- `-1..-110`: classes fixas (`templates/classes-base-template.ts`) — INTOCADAS
- `-150..-159`: sub-tipos de Pessoa Scrumban (USER, PLATFORM_SCRUMBAN, ORGANIZATION, AGENT, TEAM)
- `-160..-179`: vínculos Org/Project (cargos via idClasse)
- `-180..-199`: outras DEntidade especiais (TEAM, TEAM_MEMBERSHIP, PROJECT_AGENT, TELEGRAM_LINK)
- `-200..-299`: DTask especializações (reservado, livre)
- `-300..-319`: Execuções (DPedido) — **PILAR 1 ATIVADO**
- `-400..-419`: Sprints (DTabela)
- `-420..-429`: Priorities
- `-430..-439`: Task Types
- `-440..-449`: Status Intentions V3 (INBOX..VALIDATED)
- `-450..-469`: Channels
- `-470..-489`: Configs/Tokens (WEBHOOK, API_KEY, MCP_KEY, INSTALL_TOKEN, PAIRING_TOKEN, ISSUE_COUNTER)
- `-490..-509`: DEvento (NOTIFICATION, WEBHOOK_ATTEMPT, AGENT_HEARTBEAT, etc.)
- `-510..-529`: status lookups secundários (AGENT_STATUS, EXEC_STATUS, RISK_LEVEL)
- `-530+`: reservado futuro

**Total esperado:** ~120 DClasses (50 fixas + ~70 V2-específicas).

---

## STACK TÉCNICO V2

- NestJS + TypeScript (strict mode)
- PostgreSQL 15 + Prisma ORM
- BullMQ + Redis (filas)
- Docker (postgres + redis local)
- `make build` (Webpack via NestJS)
- ESLint + Prettier (no-console error, max-warnings 0)
- Husky + lint-staged + commitlint (Conventional Commits)

---

## DOCUMENTAÇÃO CHAVE V2

Tabela completa (10 docs canônicos + onde abrir) movida para `referencias-canonicas.md`. Consultar lá quando precisar localizar contrato, schema, runbook, etc.

---

## RISCOS V2 — TOP 5 (do §5 do plano-mestre)

1. **Command injection RCE em F13** — TDD com 58 testes adversariais ANTES do código; whitelist + AST + regex em camadas
2. **Risk Gate classifica HIGH como LOW** — fail-safe MEDIUM em dúvida; `STRICT_RISK_GATE=true` em prod
3. **Cutover ultrapassa 4h em F15** — 3 ensaios cronometrados em staging; abort 04:00; buffer 50min
4. **Engine vazado para domínios estruturais** (DTask/DProject) — Reviewer rejeita imediatamente; ADR-V2-005 + ADR-V2-013 explicitam
5. **Pressão para criar coluna `role` em DUserGroup** — ADR + hook bloqueador `enforce-canonical-tables.sh`

---

## NOTAS

- V2 é REFUNDAÇÃO, não migração in-place. Repositório novo, paralelo. Migration de dados em F15.
- Aposta arquitetural: tudo que o Scrumban legado faz CABE nas 17 tabelas via DClasse + DVincula + DEvento + DPedido + Json aditivo. Cada fase tem que manter essa aposta intacta.
- Conventional Commits scope V2 difere do template (sem `pagamento`; com `channels`, `mcp`, `webhooks`, `automation`, `executions`, `flow-metrics`, `reports`, `email`, `permissoes`).
- ESCOPO INDEFINIDO ≠ ESCOPO REDUZIDO. V2 mantém os 128 endpoints do legado; muda apenas COMO faz.

---

## HISTÓRICO DE PLANS PRODUZIDOS

Movido para `agent-memory/strategist/historico-plans.md` em 2026-05-15 (índice ficou acima de 200 linhas). Adicionar novos plans diretamente lá.

---

## PRECEDENTES E EXCEÇÕES

### ADR-V2-043 — Coluna `repoUrl` em DProject (PRECEDENTE ÚNICO de exceção ao ADR-V2-001)

**Data:** 2026-05-15
**Decisor:** CEO autorizou explicitamente.
**Status:** Aprovado e formalizado em `docs/decisions/ADR-V2-043-repo-url-coluna-dproject.md`.
**Contexto operacional:** F13 Milestone 1 — Auto-Provisionamento VPS (commit `156e194`).

**O que aconteceu:** Adicionada coluna `repoUrl String? @db.VarChar(512)` em DProject (canônica) para hospedar a URL git do projeto de forma estrutural, tipada e indexável, em vez de continuar em `dados.gitRepo` (Json solto). Backend faz dual-write (escreve em ambos) por 1 release para compatibilidade com frontend legado.

**Por que isso NÃO viola ADR-V2-001:** O ADR-V2-001 proíbe TABELA nova, não coluna. Mas o espírito é "não inflar schema canônico" — então qualquer coluna nova exige ADR justificando, com aprovação CEO. O hook `enforce-canonical-tables.sh` permanece válido: ele bloqueia tabela nova, mas não bloqueia coluna — a defesa contra abuso é o checklist abaixo.

**Critérios estritos para FUTURAS exceções de coluna nova (replicar este precedente):**

1. Dado deve ser ESTRUTURAL do projeto/entidade (não metadado opcional).
2. Deve ter justificativa de PERFORMANCE, TIPO ou SEGURANÇA (não estética).
3. Cabe em VARCHAR ≤512, ou Decimal/Int/Boolean/Date nativo (não Json).
4. **EXIGE ADR redigido + aprovação CEO** — Strategist NÃO autorizado decidir sozinho mesmo cumprindo 1-3.
5. Strategist registra em MEMORY como NOVO precedente sob critérios acima.

Este é, até hoje (2026-05-15), o ÚNICO precedente. Não é regra geral. Próximos casos exigem nova aprovação CEO mesmo cumprindo os 5 critérios — não há "abertura automática" baseada nesta entrada.

**Anti-padrões a rejeitar (cenários que NÃO se qualificam):**
- "Vou adicionar coluna `cor` em DEntidade para o cliente preferir tema dark" → NÃO. Vai em `dados.preferencias.tema`.
- "Vou adicionar `lastLoginAt` em DUserGroup" → NÃO. Já existe rastro em DEvento.
- "Vou criar `repoUrl2` para segundo repositório" → NÃO. Múltiplos repos = DVincula + DTabela.
- "Vou adicionar `slug` em DProject" → questionar primeiro. Se for derivável do nome, calcular em runtime. Se for único e indexado, candidato a ADR — mas começa em `dados`.

**Lição:** Coluna nova ≠ tabela nova, mas custo arquitetural similar. Default = Json em `dados`. Exceção = ADR + CEO.

### ADR-V2-044 — Full Clone vs Shallow Clone (decisão pré-Milestone 2)

**Data:** 2026-05-15
**Decisor:** Strategist Agent V2 (proposto), Reviewer (apontou limitação), aguarda ratificação CEO.
**Status:** Proposto. Arquivo em `docs/decisions/ADR-V2-044-shallow-clone-vs-full-clone.md`.

**Resumo:** `DEFAULT_DEPTH = 0` (full clone) em `agent/src/git/clone.ts` desde o Milestone 1, em vez do shallow `depth=1` originalmente proposto. Motivo: Milestone 2 (Claude Code F13) precisa de `git push`, e push em shallow falha com `fatal: shallow update not allowed`. Mudar agora evita migração `git fetch --unshallow` em projetos já provisionados.

**Lição para o Strategist:** ao planejar features de longo prazo divididas em milestones, validar TODOS os caminhos de leitura/escrita do último milestone ANTES de fixar o default no primeiro. Trade-off "performance no MVP" pode virar débito caro se o caminho final for invalidado pelo default escolhido.
