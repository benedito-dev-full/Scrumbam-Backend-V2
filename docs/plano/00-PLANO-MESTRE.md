# Plano Mestre — Scrumban-Backend-V2

**Versão:** 1.1 (consolidada após auditoria + 3 retrabalhos paralelos)
**Data:** 2026-05-08
**Autor:** Conversa Principal (consolidação de 4 estrategistas + 3 reviewers + 3 retrabalhos)
**Audiência:** CEO + Tech Lead + Time de implementação
**Status:** Bíblia operacional da maratona V2 (pós-remediação)

> **CHANGELOG v1.1:** Esta versão integra os 3 patches dos Blocos 2/3/4 da remediação (workflow multi-agent, validação Scrumban-hoje + ADRs 015/016, feedback loop V2→Generator + ADR-017). Score consolidado pré-aprovação saltou de 5.2/10 para alvo ≥8.0/10. Adicionados: §3.4, §6 (Workflow), §8 (Feedback Loop) novos; §7 (ADRs) ampliado; §10 (Checklist) ampliado.

---

## 0. MANIFESTO DA MARATONA V2

Este documento é o **único índice oficial** do esforço de refundação do Scrumban Backend. Toda decisão estrutural, todo cronograma, todo gate entre fases, **passa por aqui**. Os 4 sub-planos (`01-FUNDACAO.md`, `02-DOMINIO-ENGINE.md`, `03-INTEGRACOES.md`, `04-HARDENING-HANDOFF.md`) são detalhamentos operacionais. Quando houver divergência entre um sub-plano e este documento, **este documento prevalece** (especialmente no que toca seed de DClasses, que foi normalizado no §3).

### 0.1. Compromisso fundacional (não-negociável)

1. **Disciplina máxima:** ZERO tabela nova no banco. Apenas as 17 canônicas Devari-Core.
2. **3 Pilares ativos sempre:** Engine, Endpoints Genéricos, Seed.
3. **Pilar 1 finalmente ATIVADO** via `OperacaoExecucaoClaude` — coração técnico do V2 que valida a Dimensão 2 do polimorfismo (extensão OOP do Engine fora do domínio financeiro).
4. **Toda regra do `.claude/rules/` do Devari-Core é puxada** em cada PR, cada plano, cada code review. Hooks bloqueiam afrouxamento.
5. **Fazer rápido E correto.** Família depende. Mas atalho técnico é dívida acumulada que mata o produto. Velocidade é consequência de disciplina, não substituto dela.
6. **A documentação canônica do Devari-Core é a única fonte da verdade:** `RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md`, `devari-3-pilares.md`, `devari-polymorphic-engine.md`, `devari-backend-patterns.md`, `devari-event-naming.md`, `devari-jsdoc-templates.md`, `devari-conventional-commits.md`, `devari-migration-protocol.md`, `devari-saas-generator.md`. Releitura periódica obrigatória.
7. **`templates/classes-base-template.ts` é a fundação da Dimensão 1.** Toda DClasse universal (range -1 a -110) vive nesse arquivo (criado pelo Bloco 3 da remediação, 45 classes universais, validação estática embutida). DClasses específicas-de-domínio (range -150+ por convenção) vivem em `prisma/seeds/classes.seed.ts` do projeto. Mistura de domínios em `classes-base-template.ts` (ex: classes Dinpayz/fintech como -45/-47/-156) é proibida — para fintech, usar `classes-fintech-template.ts` SEPARADO.
8. **A corda não pode afrouxar nem uma vez.** Os 4 gates (plan, implementação, review, doc) são fronteira mecânica, não disciplina humana. Hooks bloqueiam. Score gate APPROVED ≥ 7.0 enforça (ADR-V2-018). ADR-V2-XXX justifica exceções. Sem hook desativado. Sem `--no-verify`. Sem skip de Reviewer/Documenter. Família depende.

### 0.2. O que estamos fazendo (em 1 frase)

Reconstruir o Scrumban Backend usando **as 17 tabelas canônicas Devari-Core**, **3 Pilares plenamente ativos**, e **DClasses polimórficas** para representar 100% das capacidades atuais do legado (128 endpoints, intentions V3, flow metrics, forecast Monte Carlo, Telegram com voz Groq, MCP Server, Webhooks HMAC, Automation Claude Code com Risk Gate e PR auto-open) — sem inventar uma única tabela nova. **V2 também é piloto-vivo que documenta o gap entre Scrumban-hoje e o Generator-atual (PARTE-3), gerando proposta consolidada de evolução do Devari-Core (ver §8 e ADR-V2-017).**

### 0.3. O que NÃO estamos fazendo

- Migração in-place do Scrumban legado (V2 é repo novo, paralelo, com migration de DADOS no fim)
- Manutenção de tabelas próprias do legado (DProjectMember, DNotification, DWebhook, DAgent, DExecution → eliminadas)
- Sequestro de DClasses canônicas (-40, -45, -47, -49, -50 voltam ao significado original do template)
- Module thin sem justificativa documentada (controllers thin para `/sprints` e `/workflow-statuses` são exceções autorizadas com README explicando "wrapper de DX sobre `/tabelas?idClasse=X`")
- Refatorar o Devari-Core (template raiz) em paralelo. V2 evolui o template em várias frentes (17 tabelas vs 14, DVFS ativo, `templates/classes-base-template.ts` puro, ADR-V2-015 sobre `?idClasse`). Esses ganhos serão propagados ao Devari-Core em janela posterior (ver §8 — feedback loop). NÃO bloqueia V2.

---

## 1. MAPA DE 17 FASES (4 BLOCOS)

| Bloco | Estrategista | Sub-plano | Fases | Linhas |
|-------|--------------|-----------|-------|--------|
| **A — Fundação** | Estrategista A | `01-FUNDACAO.md` | 0 a 4 | 1.208 |
| **B — Domínio + Engine** | Estrategista B | `02-DOMINIO-ENGINE.md` | 5 a 9 | 1.963 |
| **C — Integrações** | Estrategista C | `03-INTEGRACOES.md` | 10 a 13 | 1.237 |
| **D — Hardening + Handoff** | Estrategista D | `04-HARDENING-HANDOFF.md` | 14 a 17 | 1.020 |
| **TOTAL** | — | — | 17 fases | **5.428 linhas** |

### 1.1. Mapa-resumo (1 linha por fase)

| # | Bloco | Nome | Pilar dominante | Output canônico |
|---|-------|------|-----------------|-----------------|
| **0** | A | Verificação canônica + setup repo + Multi-agent infra | — | Esqueleto + hooks + `.claude/rules` ancoradas + `templates/classes-base-template.ts` (45 classes universais, criado) + `.claude/{agents,agent-memory,scripts,commands,settings.json}` populados + `docs/lessons/` |
| **1** | A | Schema 17 tabelas + Seed DClasses | **Pilar 3** | `prisma/schema.prisma` + `prisma/seeds/classes.seed.ts` (~90 classes) — **importa `classesFixas` de `templates/classes-base-template.ts` (criado em F0)** |
| **2** | A | Endpoints Genéricos `/entidades` `/tabelas` `/classes` | **Pilar 2** | 3 controllers genéricos + Services + DTOs |
| **3** | A | Auth + RBAC duplo via DUserGroup + DVincula | — | JWT + Guards + AuthCompositeGuard (JWT|API Key|MCP Key) |
| **4** | A | Email module + Common Services | — | Provider de email + TimezoneService + Pipes |
| **5** | B | Domínio estrutural (Org/Team/Project/Sprint/Status/Task) | **Pilar 2** | Tudo via DEntidade/DTabela/DProject canônicos |
| **6** | B | **Engine + `OperacaoExecucaoClaude` (CORAÇÃO V2)** | **Pilar 1** | `src/engine/` + DPedido idClasse=-300 + DVFS scripts |
| **7** | B | Eventos canônicos (DEvento + EventProducerService) | — | Producer + Router + Notifications via DEvento -490 |
| **8** | B | Flow Metrics + Forecast + Search (runtime) | — | Analytics derivado, sem persistência |
| **9** | B | Reports + Dashboards + Analytics | — | Read-only com cache TTL |
| **10** | C | Channels (Telegram + voz Groq Whisper) | — | DTabela pairing + DVincula link + DEvento msg |
| **11** | C | MCP Server (5 tools) | — | DTabela MCP_KEY + DEvento MCP_CALL |
| **12** | C | Webhooks outbound (HMAC + retry + auto-disable) | — | DTabela WEBHOOK + DEvento WEBHOOK_ATTEMPT |
| **13** | C | **Automation Claude Code (Agent + Engine)** | **Pilares 1+2** | DEntidade AGENT + DPedido EXECUTION + 58 testes adversariais |
| **14** | D | Hardening (tests + security + observabilidade) | — | ≥80% coverage + load test + security review |
| **15** | D | **Migration de dados do legado** | — | Scripts ETL + cutover plan + rollback |
| **16** | D | Documentação + Handoff | — | Swagger 100% + ADRs + Runbook + Tutorial |
| **17** | D | Launch + pós-launch | — | Janela de 4h + monitoramento intensivo + retro |

> **Pré-requisito de F1:** o arquivo `templates/classes-base-template.ts` deve existir antes de F1 iniciar. Esse arquivo foi criado pelo Bloco 3 da remediação durante a fase de planejamento e contém as 45 classes universais Devari-Core (range -1 a -110), com validação estática embutida (idPai consistente, root único, fail-fast no build). Conferir presença em §10 (checklist de início). Hook `enforce-canonical-tables.sh` valida em CI.

---

## 2. CRONOGRAMA INTEGRADO

### 2.1. Linha do tempo realista (com paralelismos)

```
SEMANA  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25
       ┌──────────────────────────────────────────────────────────────────────────┐
F0     │██│                                                                       │
F1     │   ██████│                                                                │
F2     │         ██████│                                                          │
F3     │               ██████│                                                    │
F4     │               ██│ (paralelo com F3)                                      │
F5     │                     ███████│                                             │
F6     │                            ██████████│   ← coração técnico (4-5 sem)     │
F7     │                                       █████│ (paralelo com F8)            │
F8     │                                       █████│                              │
F9     │                                            ███│                           │
F10    │                                              █████│                       │
F11    │                                              ████│ (paralelo F10)         │
F12    │                                                  ████│                    │
F13    │                                                     ████████│ ← Automation │
F14    │                                                             █████│        │
F15    │                                                                  ████│    │
F16    │                                                                     ██│   │
F17    │                                                                       █│  │
       └──────────────────────────────────────────────────────────────────────────┘
```

### 2.2. Estimativas consolidadas (em semanas-engenheiro)

| Bloco | Semanas otimista | Semanas realista | Semanas pessimista | Observações |
|-------|------------------|------------------|--------------------|-|
| **A — Fundação** (F0-F4) | 5,5 | 7 | 8 | F1 (seed) é gargalo — peer review obrigatório |
| **B — Domínio + Engine** (F5-F9) | 10,5 | 11,5 | 13 | F6 (Engine + DVFS) é o maior pico técnico |
| **C — Integrações** (F10-F13) | 5 | 6 | 7,5 | F13 (Automation) carrega risco de RCE — 58 testes adversariais OBRIGATÓRIOS antes do código |
| **D — Hardening + Handoff** (F14-F17) | 2,5 | 3 | 4 | + janela de cutover (4h) + 30 dias pós-launch monitorados |
| **TOTAL (em série)** | 23,5 | 27,5 | 32,5 | |
| **TOTAL (com paralelismos)** | **~20** | **~24** | **~29** | F4∥F3, F8∥F7, F10∥F11 |

**Cenário recomendado para CEO:** **24 semanas** (~6 meses) com 1 implementer dedicado + 1 strategist no apoio + 1 reviewer alocado parcialmente. **Não é uma corrida — é uma maratona.**

### 2.3. Marcos públicos (gates entre blocos)

| Gate | Quando | Entregável | Critério de aprovação |
|------|--------|------------|------------------------|
| **G0 → G1** | Fim da F1 | Sistema inicia com seed | `prisma db seed` rodou + `SELECT count(*) FROM "DClasse"` ≥ 90 + zero conflito de chave |
| **G1 → G2** | Fim da F4 | Fundação canônica completa | `make build` verde + endpoints genéricos respondem + Auth+RBAC funcional + ZERO console.log + ZERO `prisma.create` em transacional |
| **G2 → G3** | Fim da F9 | Domínio + Engine ativos | `OperacaoExecucaoClaude` end-to-end LOW path passa + DEvento auditando tudo + Flow Metrics calculando |
| **G3 → G4** | Fim da F13 | Integrações vivas | Telegram cria task + MCP responde 5 tools + Webhook entrega com HMAC + Automation cria PR via Claude Code |
| **G4 → Launch** | Fim da F16 | V2 production-ready | ≥80% coverage + 0 N+1 + load test 1000 req/s + security review verde + runbook completo |
| **Launch** | F17 | V2 em produção | Cutover de 4h + 24h monitoramento + zero SEV1 |

---

## 3. SEED CANÔNICO V2 — TABELA ÚNICA DE DCLASSES (RESOLVE CONFLITOS)

> **Esta é a única fonte da verdade do seed.** Os 4 sub-planos foram escritos em paralelo e introduziram conflitos de chave (vide §3.3). Esta tabela normaliza tudo. **A Fase 1 (Seed) deve usar EXCLUSIVAMENTE este mapa.**

### 3.1. Faixas reservadas

| Faixa | Categoria | Tabela | Tipo |
|-------|-----------|--------|------|
| `-1` a `-110` | Classes fixas (template) | múltiplas | INTOCADAS — vêm de `classes-base-template.ts` |
| `-150` a `-159` | Sub-tipos de Pessoa Scrumban | DEntidade | USER, ORGANIZATION, PLATFORM, AGENT |
| `-160` a `-179` | Vínculos Org/Project (cargos) | DVincula | ORG_USER_LINK + 3 cargos, PROJECT_USER_LINK + 3 cargos |
| `-180` a `-199` | Outras DEntidade especiais | DEntidade/DVincula | TEAM, TEAM_MEMBERSHIP, PROJECT_AGENT, TELEGRAM_LINK |
| `-200` a `-299` | DTask especializações (se houver) | DTask | (reservado, livre) |
| `-300` a `-319` | Execuções (DPedido) | DPedido | EXECUTION + risk levels (LOW/MED/HIGH) |
| `-400` a `-419` | Sprints | DTabela | SPRINT (agrupador) + folhas runtime |
| `-420` a `-429` | Priorities | DTabela | PRIORITY + 4 folhas |
| `-430` a `-439` | Task Types | DTabela | TASK_TYPE + 5 folhas |
| `-440` a `-449` | Status Intentions V3 | DTabela | STATUS_INTENTION_V3 + 9 folhas |
| `-450` a `-469` | Channels | DTabela | CHANNEL + 6 folhas |
| `-470` a `-489` | Configs / Tokens | DTabela | WEBHOOK, API_KEY, MCP_KEY, INSTALL_TOKEN, PAIRING_TOKEN, ISSUE_COUNTER |
| `-490` a `-509` | **Eventos** | DEvento | NOTIFICATION, WEBHOOK_ATTEMPT, AGENT_HEARTBEAT, etc. |
| `-510` a `-529` | Status lookups secundários | DTabela | Agent statuses, Execution statuses, Risk levels |
| `-530` em diante | Reservado para futuro | — | — |

### 3.2. Seed canônico definitivo (~90 classes específicas Scrumban)

#### DEntidade (sub-tipos de Pessoa)
| chave | codigo | nome | idPai | agrupamento | tabela alvo |
|-------|--------|------|-------|-------------|-------------|
| -150 | USER | Usuário Scrumban | -43 | false | DEntidade |
| -151 | PLATFORM_SCRUMBAN | Platform Scrumban | -43 | false | DEntidade |
| -152 | ORGANIZATION | Organização | -43 | false | DEntidade |
| -156 | AGENT | Agente Claude Code | -43 | false | DEntidade |
| -180 | TEAM | Time | -43 | false | DEntidade |

#### DVincula (relações)
| chave | codigo | nome | idPai | agrupamento |
|-------|--------|------|-------|-------------|
| -160 | ORG_USER_LINK | Vínculo Org-Usuário (agrupador) | -37 | true |
| -161 | ORG_ROLE_ADMIN | Org Role: ADMIN | -160 | false |
| -162 | ORG_ROLE_MEMBER | Org Role: MEMBER | -160 | false |
| -163 | ORG_ROLE_VIEWER | Org Role: VIEWER | -160 | false |
| -170 | PROJECT_USER_LINK | Vínculo Project-Usuário (agrupador) | -37 | true |
| -171 | PROJECT_ROLE_MANAGER | Project Role: MANAGER | -170 | false |
| -172 | PROJECT_ROLE_MEMBER | Project Role: MEMBER | -170 | false |
| -173 | PROJECT_ROLE_VIEWER | Project Role: VIEWER | -170 | false |
| -181 | TEAM_MEMBERSHIP | Vínculo Team-User | -37 | false |
| -185 | PROJECT_AGENT | Vínculo Project-Agent | -37 | false |
| -186 | TELEGRAM_LINK | Vínculo User-Telegram chat | -37 | false |

#### DPedido (execuções) — ATIVA Pilar 1
| chave | codigo | nome | idPai | agrupamento |
|-------|--------|------|-------|-------------|
| -300 | EXECUTION | Execução Claude Code (agrupador) | -20 | true |
| -301 | EXEC_LOW | Execução risco LOW | -300 | false |
| -302 | EXEC_MED | Execução risco MEDIUM | -300 | false |
| -303 | EXEC_HIGH | Execução risco HIGH | -300 | false |

> **Decisão arquitetural:** distinção LOW/MED/HIGH via `idClasse` específico (não via `dados.riskLevel`) habilita queries eficientes (`WHERE idClasse=-303`) para listar pendentes de aprovação manual e usar DVFS scripts diferentes por nível. Categoria operacional (refactor/fix/feature) vai em `DPedido.dados.category`.

#### DTabela — lookups, configs e folhas
| chave | codigo | nome | idPai | agrupamento |
|-------|--------|------|-------|-------------|
| -400 | SPRINT | Sprint (agrupador) | -51 | true |
| -420 | PRIORITY | Priority (agrupador) | -51 | true |
| -421..-424 | HIGH/MEDIUM/LOW/URGENT | Priorities | -420 | false |
| -430 | TASK_TYPE | Task Type (agrupador) | -51 | true |
| -431..-435 | FEATURE/BUG/IMPROVEMENT/REVIEW/EXPLAIN | Task Types | -430 | false |
| -440 | STATUS_INTENTION_V3 | Status V3 (agrupador) | -52 | true |
| -441..-449 | INBOX/READY/EXECUTING/DONE/FAILED/CANCELLED/DISCARDED/VALIDATING/VALIDATED | V3 Statuses | -440 | false |
| -450 | CHANNEL | Canal (agrupador) | -52 | true |
| -451..-456 | WEB/WHATSAPP/EMAIL/SLACK/API/TELEGRAM | Channels | -450 | false |
| -470 | WEBHOOK | Configuração de Webhook outbound | -52 | false |
| -471 | API_KEY | API Key por projeto | -52 | false |
| -472 | MCP_KEY | MCP Key por usuário | -52 | false |
| -473 | INSTALL_TOKEN | Token install one-shot Argus | -52 | false |
| -474 | PAIRING_TOKEN | Token pairing Telegram | -52 | false |
| -475 | ISSUE_COUNTER | Contador DEV-N por team | -52 | false |

#### DEvento — auditoria + eventos
| chave | codigo | nome | idPai |
|-------|--------|------|-------|
| -490 | NOTIFICATION | Notificação in-app | -3 |
| -491 | WEBHOOK_ATTEMPT | Tentativa de Webhook outbound | -3 |
| -492 | AGENT_HEARTBEAT | Heartbeat de Agent | -3 |
| -493 | TELEGRAM_MSG_IN | Mensagem Telegram recebida | -3 |
| -494 | TELEGRAM_MSG_OUT | Mensagem Telegram enviada | -3 |
| -495 | MCP_CALL | Chamada MCP auditada | -3 |
| -496 | EXECUTION_LOG | Log de execução Claude | -3 |
| -497 | TASK_CREATED | Audit: task criada | -3 |
| -498 | TASK_STATUS_CHANGED | Audit: mudança de status | -3 |
| -499 | PROJECT_DELETED | Audit: projeto deletado | -3 |
| -500 | ORG_DELETED | Audit: org deletada | -3 |
| -501 | USER_LOGIN | Audit: login | -3 |

#### DTabela — Status lookups secundários
| chave | codigo | nome | idPai |
|-------|--------|------|-------|
| -510 | AGENT_STATUS_ONLINE | Agent: ONLINE | -52 |
| -511 | AGENT_STATUS_OFFLINE | Agent: OFFLINE | -52 |
| -512 | AGENT_STATUS_PENDING_INSTALL | Agent: PENDING_INSTALL | -52 |
| -513 | AGENT_STATUS_NEVER_CONNECTED | Agent: NEVER_CONNECTED | -52 |
| -514 | EXEC_STATUS_QUEUED | Exec: QUEUED | -52 |
| -515 | EXEC_STATUS_AWAITING_APPROVAL | Exec: AWAITING_APPROVAL | -52 |
| -516 | EXEC_STATUS_APPROVED | Exec: APPROVED | -52 |
| -517 | EXEC_STATUS_REJECTED | Exec: REJECTED | -52 |
| -518 | EXEC_STATUS_RUNNING | Exec: RUNNING | -52 |
| -519 | EXEC_STATUS_SUCCESS | Exec: SUCCESS | -52 |
| -520 | EXEC_STATUS_FAILED | Exec: FAILED | -52 |
| -521 | EXEC_STATUS_EXPIRED | Exec: EXPIRED | -52 |
| -522 | EXEC_STATUS_ROLLED_BACK | Exec: ROLLED_BACK | -52 |
| -525 | RISK_LEVEL_LOW | Risk: LOW | -52 |
| -526 | RISK_LEVEL_MEDIUM | Risk: MEDIUM | -52 |
| -527 | RISK_LEVEL_HIGH | Risk: HIGH | -52 |

**Total:** ~50 classes fixas (template) + ~70 classes específicas Scrumban = **~120 DClasses no seed**.

### 3.3. Conflitos resolvidos durante a consolidação

Os 4 sub-planos foram escritos em paralelo e tinham conflitos. Esta seção documenta as decisões para o registro:

| Conflito original | Origem | Resolução nesta tabela |
|-------------------|--------|------------------------|
| `-152` AGENT (C) vs ORGANIZATION (A) | Sub-planos A e C | **AGENT virou -156** (livre, próximo a Pessoa); ORGANIZATION fica em -152 |
| `-491` EXECUCAO_CLAUDE (A) vs WEBHOOK_ATTEMPT (B) vs AGENT_STATUS_OFFLINE (C) | A, B, C | **Execution sai do range -49X**; vai para -300..-303 (Pedidos). -491 fica WEBHOOK_ATTEMPT. AGENT_STATUS vai para -510..-513 |
| `-493` TELEGRAM_MSG_IN (B) vs AGENT_STATUS_NEVER_CONNECTED (C) | B e C | **TELEGRAM_MSG_IN fica em -493**; AGENT_STATUS_* deslocado para -510..-513 |
| `-497` PROJECT_DELETED (B) vs EXEC_STATUS_APPROVED (C) vs MCP_CALL (C) | B e C | **TASK_CREATED fica em -497**; PROJECT_DELETED em -499; MCP_CALL em -495; EXEC_STATUS_* em -514..-522 |
| `-301..-303` EXEC_LOW/MED/HIGH (B) vs EXECUTION_REFACTOR/FIX/FEATURE (C) | B e C | **B prevalece** — risk level via idClasse é arquiteturalmente superior (DVFS scripts diferentes). Categoria operacional vai em `dados.category` |
| `-460` WEBHOOK_CONFIG (B) vs `-470` WEBHOOK (C) | B e C | **C prevalece**. Faixa -470..-479 reservada para configs/tokens consolidada |

**Decisão de governança:** qualquer DClasse nova depois daqui requer ADR aprovado, atualização desta tabela, e propagação ao `prisma/seeds/classes.seed.ts`. Hook `enforce-canonical-tables.sh` valida.

### 3.4. Validação do escopo Scrumban-hoje (Bloco 3 da remediação / 2026-05-08)

O Bloco 3 da remediação cruzou esta tabela (§3.2) com `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` (escopo do produto Scrumban hoje) e com `Scrumbam-Backend/prisma/seeds/classes.seed.ts` (89 classes do legado real). **Conclusão:** as DClasses listadas em §3.2 cobrem 100% das capacidades do Scrumban-hoje, sem necessidade de adição. As ausências do legado (status `-410..-413` removidas em Task 6 segundo o `CLAUDE.md` legado) já foram corretamente substituídas pelo sistema V3 único (`-440 + -441..-449`).

**Cobertura Scrumban-hoje (SYSTEM-OVERVIEW) → DClasses no §3.2:**

| Capacidade | DClasse(s) |
|------------|-----------|
| Hierarquia organizacional (Org/Team/Project) | -150 USER, -151 PLATFORM, -152 ORG, -180 TEAM |
| Membership (RBAC duplo) | -160..-163 (Org), -170..-173 (Project), -181 Team |
| Sprints / Priorities / TaskTypes / Status V3 | -400, -420 (+folhas), -430 (+folhas), -440 (+9 folhas) |
| Channels (incluindo Telegram com voz) | -450..-456 |
| Webhooks / API Keys / MCP Keys / Pairing tokens | -470..-475 |
| Notifications + Webhook attempts + Audit | -490..-501 |
| Automation Claude Code (Risk Gate, Approval, Run, PR) | -156 AGENT, -300..-303 EXECUTION (LOW/MED/HIGH), -510..-527 status enums + risk levels |
| Identifier público (DEV-7 atômico) | -475 ISSUE_COUNTER (DTabela) |
| Search / Flow Metrics / Forecast | (read-only; não precisa DClasse nova) |
| Reports PDF | (read-only; reusa estrutura existente) |

**Renumeração Scrumban-hoje → V2 (formalizada por ADR-V2-002):**

| Scrumban-hoje (legado) | V2 (mestre) | Razão |
|------------------------|-------------|-------|
| -47 USER | -150 USER | Liberar -47 (canônico Seller) |
| -49 PLATFORM | -151 PLATFORM_SCRUMBAN | Liberar -49 (canônico Plataforma fintech) |
| -50 ORGANIZATION | -152 ORGANIZATION | Liberar -50 (canônico Comprador fintech) |
| -460 TEAM (legado) | -180 TEAM | Faixa -460..-469 reservada para Channels no V2 |

---

## 4. PILARES E PADRÕES — MATRIZ POR FASE

### 4.1. Pilares ativados/respeitados

| Fase | Pilar 1 (Engine) | Pilar 2 (Endpoints Genéricos) | Pilar 3 (Seed) |
|------|:----------------:|:------------------------------:|:--------------:|
| F0 | — | — | — |
| **F1** | — | — | **🔥 ATIVADO** |
| **F2** | — | **🔥 ATIVADO** | respeitado |
| F3 | — | respeitado | respeitado |
| F4 | — | respeitado | respeitado |
| F5 | — (DTask, DProject, DEntidade são estruturais) | respeitado | respeitado |
| **F6** | **🔥 ATIVADO via `OperacaoExecucaoClaude`** | respeitado | respeitado |
| F7 | respeitado (Eventos pós persistência) | respeitado | respeitado |
| F8 | — (read-only) | respeitado | respeitado |
| F9 | — (read-only) | respeitado | respeitado |
| F10 | — | respeitado | respeitado |
| F11 | — | respeitado | respeitado |
| F12 | — | respeitado | respeitado |
| **F13** | **usa Engine (F6)** | respeitado | respeitado |
| F14-F17 | respeitado | respeitado | respeitado |

### 4.2. 21 Padrões obrigatórios (de `devari-backend-patterns.md`)

Todos os padrões aplicam a TODAS as fases. Os padrões mais cobrados em cada bloco:

| Padrão | Onde mais relevante |
|--------|---------------------|
| 1. PrismaService (não DatabaseService) | Todas |
| 2. BigInt para IDs | Todas |
| 3. Transactions multi-tabela | F5, F6, F13, F15 |
| 4. TimezoneService | F4, F8, F9 |
| 5. EntidadeService.getEntidadeIdFromUserGroup | F3, F5, F13 |
| 6. **N+1 ZERO** | Todas — Reviewer rejeita imediatamente |
| 7. Eventos APÓS persistência | F6, F7, F12 |
| 8. Decimal(19,4) money | (não aplicável intensamente — Scrumban não é financeiro) |
| 9. DTOs com class-validator | Todas |
| 10. Guards em endpoints | Todas |
| 11. Logger (não console.log) | Todas |
| 12. HttpException apropriada | Todas |
| 13. Padrão Controller | Todas |
| 14. Padrão Service | Todas |
| 15. EventProducerService + naming | F7, F12, F13 |
| 16. Cursor pagination + select | F2, F5, F8 |
| 17. Testes (unit + integration) | F14 (cobertura) + cada fase incremental |
| 18. Swagger decorators | Todas |
| 19. Imports organizados | Todas |
| 20. Constantes de IDs (DClasse) | Todas |
| 21. Checklist final | Cada PR |

---

## 5. RISCOS CONSOLIDADOS — TOP 10

| # | Risco | Onde | Severidade | Mitigação | Responsável |
|---|-------|------|------------|-----------|-------------|
| 1 | Command injection escapando do CommandValidator (RCE remoto) | F13 | **🔴 CRÍTICO** | TDD com 58 testes adversariais ANTES do código; whitelist + AST + regex em camadas; sandbox no agent | Reviewer + Strategist |
| 2 | Risk Gate classifica HIGH como LOW (libera comando perigoso sem aprovação) | F6, F13 | **🔴 CRÍTICO** | Fail-safe: dúvida → MEDIUM; `STRICT_RISK_GATE=true` em prod; auditoria em DEvento -496 | Reviewer + Implementer |
| 3 | Cutover ultrapassa janela de 4h | F15 | **🔴 ALTO** | 3 ensaios cronometrados em staging; abort policy às 04:00; buffer de 50min | Tech Lead |
| 4 | Diff de contagem origem vs destino na migration | F15 | **🔴 ALTO** | 4 validators (counts, sample diff, referential, business invariants) executados em todo ensaio | Implementer + Reviewer |
| 5 | Bug crítico pós-swap (após gate C-17) | F17 | **🔴 ALTO** | Hotfix protocol SEV1 <1h; legado read-only standby por 7 dias para swap reverso | CTO + Tech Lead |
| 6 | Erro na hierarquia idPai do seed (Fase 1) | F1 | **🟡 MÉDIO** | Peer-review obrigatório Strategist+Implementer; validator de hierarquia automatizado | Strategist + Implementer |
| 7 | Pressão para criar coluna `role` em DUserGroup ("é só um campo") | F3 | **🟡 MÉDIO** | ADR explícito + hook bloqueador `enforce-canonical-tables.sh` + Reviewer com veto | Reviewer + CEO (no-go) |
| 8 | Engine "vazado" para domínios estruturais (DTask, DProject) | F6 | **🟡 MÉDIO** | Reviewer rejeita imediatamente; CLAUDE.md V2 diz: "Engine APENAS em DPedido idClasse=-300" | Reviewer |
| 9 | Identifier público (DEV-N) com colisão sob concorrência | F5 | **🟡 MÉDIO** | `jsonb_set` via raw UPDATE + RETURNING dentro de transação; 10-thread test obrigatório | Implementer + Reviewer |
| 10 | SSH reverso comprometido (chave roubada) | F13 | **🟡 MÉDIO** | TOFU + HMAC nos comandos; rotação de chaves periódica; logs de SSH em DEvento | Tech Lead + Implementer |

---

## 6. WORKFLOW MULTI-AGENT (CORAÇÃO OPERACIONAL DO V2)

> Toda task substantiva passa pelos 4 gates abaixo. Pular qualquer gate exige ADR justificando. **Hooks bloqueiam mecanicamente — não é disciplina humana.**

### 6.1. Cadeia de 9 passos

```
[1] Usuário entrega task
       ↓
[2] CONVERSA PRINCIPAL (Orchestrator) — analisa: precisa Strategist?
       ↓
[3] STRATEGIST (15-30min, sem Bash, sem Task)
    └─ Output: workspace/plans/plan-*.md
    └─ Stop hook: validate-plan.sh (8 seções obrigatórias)
       ↓
[4] CONVERSA PRINCIPAL — gera mensagem clara para Implementer
       ↓
[5] IMPLEMENTER (1-4h, Bash sim, sem Task) — agentId SALVO para resume
    └─ Output: workspace/implementations/impl-*.md + código
    └─ Stop: validate-implementation.sh + validate-implementer-build.sh
       ↓
[6] REVIEWER (30-40min, modelo sonnet, Bash sim, sem Task)
    └─ Output: workspace/reviews/review-*.md + Score X/10 + Decisão
    └─ Stop: validate-review.sh + validate-review-score.sh (NOVO)
              └─ APPROVED com score < 7.0 → exit 2 (BLOQUEADO)
       ├─ APPROVED → passo [8]
       └─ REJECTED/NEEDS_CHANGES → passo [7]
              ↓
[7] RESUME IMPLEMENTER (mesmo agentId) com feedback do Reviewer
    └─ EDGE CASE: 3 rejeições consecutivas → PAUSAR e consultar usuário
       (4 opções: simplificar / relaxar com ADR / revisar manual / substituir)
    └─ volta a [6]
       ↓
[8] DOCUMENTER (20-30min, modelo haiku, Bash sim, sem Task)
    └─ JSDoc + ROADMAP + CHANGELOG + STATUS + ADR + commit
    └─ Stop: validate-documentation.sh
       ↓
[9] CONVERSA PRINCIPAL — entrega report final ao usuário
```

### 6.2. Decision tree para delegar Strategist

| Fator | Pesa Strategist? |
|-------|------------------|
| 3 Pilares envolvidos (Engine/Endpoints/Seed) | ✅ OBRIGATÓRIO |
| Migrations Prisma | ✅ OBRIGATÓRIO |
| >3 arquivos afetados | ✅ SIM |
| >2h estimadas | ✅ SIM |
| Múltiplas abordagens viáveis | ✅ SIM |
| Decisão arquitetural que merece ADR-V2-XXX | ✅ OBRIGATÓRIO |
| Fase F1, F2, F3, F5, F6, F7, F13, F15 | ✅ OBRIGATÓRIO |

**Na dúvida, Strategist.** Pular Strategist é EXCEÇÃO autorizada apenas em F0/F4/F11/F16 simples (Fast Mode).

### 6.3. Score gate APPROVED ≥ 7.0 (REGRA MECÂNICA — ADR-V2-018)

Hook `validate-review-score.sh` REJEITA mecanicamente:
- APPROVED com score < 7.0 → exit 2
- Score sem formato numérico (regex `[0-9]+\.?[0-9]*/10`) → exit 2
- Decisão fora de {APPROVED, REJECTED, NEEDS_CHANGES} → exit 2

**Aplicabilidade crítica em F13 (Automation Claude Code):** aprovar com score 6 = liberar comando potencialmente RCE em produção. Família depende. Corda justa.

### 6.4. Tabela comparativa dos 4 agents

| Aspecto | Strategist | Implementer | Reviewer | Documenter |
|---------|-----------|------------|---------|-----------|
| Cor | 🔵 azul | 🟢 verde | 🟡 amarelo | 🟣 roxo |
| Modelo | inherit | inherit | sonnet (custo) | haiku (mecânica) |
| Tempo target | 15-30min | 1-4h | 30-40min | 20-30min |
| Bash | ❌ | ✅ | ✅ | ✅ |
| Task tool | ❌ | ❌ | ❌ | ❌ |
| Memory | project | project | project | project |
| Stop hook | validate-plan.sh | validate-implementation.sh | validate-review + validate-review-score | validate-documentation |
| Output | plan-*.md | impl-*.md + código | review-*.md (Score + Decisão) | JSDoc + ROADMAP + CHANGELOG + STATUS + commit |

**REGRA:** Nenhum agent invoca outro. Conversa principal é o ÚNICO orquestrador.

### 6.5. Tempo total típico por task

**3-4h por task** (planning 30min + implementation 1-3h + review 30-40min + doc 20-30min + buffer 15-30min). **24 semanas / ~3,5h por task = ~270 tasks no V2.** Cada uma sob workflow rígido.

### 6.6. Proibições explícitas

- **NUNCA** Bash para criar artefatos workspace (Write/Edit dos agents)
- **NUNCA** pular Reviewer ou Documenter
- **NUNCA** agents se chamam (`disallowedTools: [Task]` em todos)
- **NUNCA** `git push --force` em main/master sem aprovação CEO
- **NUNCA** `--no-verify` em commits (hook bloqueia)

---

## 7. ADRs A REDIGIR (decisões arquiteturais V2)

Cada ADR documenta uma decisão crítica não-trivial. Devem ser redigidos junto com a fase respectiva e versionados em `Scrumban-Backend-V2/docs/decisions/`.

| ADR | Título | Fase | Status |
|-----|--------|------|--------|
| **ADR-V2-001** | 17 tabelas canônicas — zero tabela nova é regra inviolável | F0 | proposto |
| **ADR-V2-002** | Renumeração de DClasses sequestradas (-47, -49, -50 retornam ao canônico) | F1 | proposto |
| **ADR-V2-003** | RBAC duplo via DVincula + idClasse (sem DProjectMember, sem enums) | F3 | proposto |
| **ADR-V2-004** | API Keys e MCP Keys via DTabela (não colunas próprias) | F3 | proposto |
| **ADR-V2-005** | `OperacaoExecucaoClaude extends OperacaoPedido` (Pilar 1 ativado) | F6 | proposto |
| **ADR-V2-006** | Risk LOW/MED/HIGH via idClasse específico (-301/-302/-303), não campo | F6 | proposto |
| **ADR-V2-007** | DVFS scripts como mecanismo de portabilidade (Dimensão 3) | F6 | proposto |
| **ADR-V2-008** | DEvento substitui DNotification e DWebhook attempts | F7 | proposto |
| **ADR-V2-009** | Sprints e Workflow Statuses como wrappers thin sobre `/tabelas` (DX exception) | F5 | proposto |
| **ADR-V2-010** | Channels como módulo opcional do template (Telegram primeiro) | F10 | proposto |
| **ADR-V2-011** | MCP Keys com rate limit em Redis (não banco) | F11 | proposto |
| **ADR-V2-012** | Webhooks outbound: HMAC-SHA256, retry 3x, auto-disable após 10 falhas | F12 | proposto |
| **ADR-V2-013** | Agent como DEntidade idClasse=-156 (não tabela própria) | F13 | proposto |
| **ADR-V2-014** | Migration de dados: ETL com staging + cutover de 4h + rollback <15min | F15 | proposto |
| **ADR-V2-015** | Convenção de query: `?idClasse=N` (numérica) prevalece; wrapper aceita `?classe=NOME` por 2 sprints | F2 | **REDIGIDO** ([Bloco 3](../decisions/ADR-V2-015-query-convention.md)) |
| **ADR-V2-016** | DVFS scripts: usar `s.chave` (canônico), não `s.id` (bug latente) — 2 testes adversariais bloqueantes | F6 | **REDIGIDO** ([Bloco 3](../decisions/ADR-V2-016-script-key-binding.md)) |
| **ADR-V2-017** | V2 como piloto-vivo: feedback loop V2→Generator + `EVOLUCAO-DEVARI-CORE-V3.md` em F17 | F0/F14/F17 | **REDIGIDO** ([Bloco 4](../decisions/ADR-V2-017-generator-feedback-loop.md)) |
| **ADR-V2-018** | Score gate APPROVED ≥ 7.0 (hook `validate-review-score.sh` bloqueia) | F0 | proposto (ratificar em F0) |

> ADR-V2-015, -016, -017 já estão redigidos no formato MADR. ADRs 001-014 e 018 devem ser formalizados nas fases respectivas.

---

## 8. V2↔GENERATOR FEEDBACK LOOP (Piloto-Vivo do Devari-Core)

> **Decisão arquitetural:** ADR-V2-017. **V2 NÃO é projeto isolado** — é piloto que mede e contribui de volta ao template-mãe.

### 8.1. Princípio

O Devari-Core SaaS Generator (PARTE-3, ADR-101) promete gerar SaaS modernos em 1–3 dias. Mas o Generator atual cobre escopo de 2026-02 — CRUD genérico de Tasks/Projects/Sprints. **Não cobre** Channels (Telegram + voz Groq), MCP Server (5 tools), Automation (Claude Code + Risk Gate + Approval Flow + PR auto-open), Webhooks HMAC outbound, Voice/Whisper.

V2 vai implementar tudo isso — em ~24 semanas, dentro do canônico das 17 tabelas + 3 Pilares. **Cada feature fora do escopo do Generator atual é, por definição, proposta de evolução do template.** Linguagem **construtiva, não defensiva:** V2 não está "fora do template" — está **expandindo o que o template precisa cobrir**.

### 8.2. Mecânica operacional (ADR-V2-017)

**Por PR (Implementer + Documenter):**

1. Implementer marca PR com label `evolution-candidate` quando feature está fora do escopo de `devari-saas-generator.md`
2. Documenter, no commit (Conventional Commits), inclui no body:
   ```
   - Generator-impact: [resumo 1 linha]
   - Evolution-issue: <link issue Devari-Core>
   ```
3. Documenter abre issue no Devari-Core com label `evolution-from-v2`:
   - Título: `[V2] <feature> — proposta de evolução do template`
   - Corpo: o que o V2 implementou + por que cabe nas 17 tabelas + sugestão (módulo opt-in / classe fixa / rule / template) + métricas

**Por fase (Reviewer + Strategist):**

4. Reviewer da fase atualiza `docs/lessons/metrics-fase-NN.md` com:
   - % linhas boilerplate canônico vs específico (`cloc` + diff vs Devari-Core baseline)
   - DClasses candidatas a virar fixas no template-base
   - Tempo real vs estimativa Generator (1–3 dias geração + 1–3 dias customização)

**Final do V2 (Mês 1 pós-launch — F17):**

5. Strategist + Tech Lead consolidam **`docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md`**:
   - Top 5 capacidades modernas → módulos opt-in (Channels, MCP, Automation, Voice, Webhooks são candidatos)
   - Top 10 DClasses candidatas a virar fixas
   - Sugestões de novas rules em `.claude/rules/`
   - **5–10 PRs reais abertos** no Devari-Core (DoD obrigatório de F17)

### 8.3. Métricas a coletar

| Métrica | Coleta | Reporte |
|---------|--------|---------|
| % linhas boilerplate canônico vs específico | `cloc` + `git diff` vs baseline | `metrics-fase-NN.md` |
| Tempo real por fase vs estimativa Generator | Cronometragem + retro semanal | `metrics-fase-NN.md` |
| Capacidades modernas → módulos opt-in propostos | Curadoria de issues `evolution-from-v2` | `EVOLUCAO-DEVARI-CORE-V3.md` |
| DClasses do V2 candidatas a fixas | Strategist da F1 + ajustes | `EVOLUCAO-DEVARI-CORE-V3.md` |
| Bugs do template descobertos | Reviewer registra | Issues no Devari-Core (`bug-found-by-v2`) |

Meta indicativa: **≥60% boilerplate canônico globalmente** (alinhado com promessa do ADR-101 de 70–80% reuse).

### 8.4. Justificativa estratégica

**V2 sem feedback loop** = aprendizado de 24 semanas evapora. Generator emperra no escopo de 2026-02. Próximo cliente paga novamente o custo de inventar tudo do zero. ADR-101 fica em risco (10–12 SaaS/ano não se sustenta).

**V2 com feedback loop** = Devari-Core v3.0 nasce com bagagem. Channels, MCP, Automation deixam de ser custom e viram módulos opt-in reusáveis. Próximo cliente herda automaticamente. Custo: ~10 min/PR + 30 min/fase + 1 sem/F17. Em troca: evolução estratégica do produto-mãe e validação empírica do ADR-101.

### 8.5. Onde isso aparece no plano

- **F0:** cria `docs/lessons/` + `metrics-fase-template.md` + `issues-evolution-from-v2.md` (índice mestre)
- **F1..F13:** cada fase produz `metrics-fase-NN.md` antes de fechar; issues `evolution-from-v2` continuamente
- **F14:** primeira consolidação parcial em `metrics-fase-14.md` (gap quantitativo enquanto código está fresco)
- **F17:** sessão dedicada de 1 semana com Devari-Core; gera `EVOLUCAO-DEVARI-CORE-V3.md` + 5–10 PRs reais

---

## 9. NAVEGAÇÃO DESTE PLANO

| Quando você precisar de... | abra... |
|---|---|
| **Visão geral, decisões, gates, conflitos resolvidos, workflow, feedback loop** | `00-PLANO-MESTRE.md` (este) |
| Detalhe de schema, seed, endpoints genéricos, auth, multi-agent infra | `01-FUNDACAO.md` |
| Detalhe do Engine, OperacaoExecucaoClaude, eventos, flow metrics | `02-DOMINIO-ENGINE.md` |
| Detalhe de Telegram, MCP, Webhooks, Automation Claude Code | `03-INTEGRACOES.md` |
| Detalhe de testes, security, migration, runbook, launch + métricas Generator | `04-HARDENING-HANDOFF.md` |
| ADRs redigidos | `docs/decisions/ADR-V2-*.md` |
| Auditoria que motivou o retrabalho | `docs/auditoria/00-AUDITORIA-CONSOLIDADA.md` |
| Fontes primárias do escopo + arquitetura | `docs/spec/README.md` |
| Regras canônicas Devari-Core (auto-injetadas) | `.claude/rules/devari-*.md` |
| 4 agents (perfil + ferramentas) | `.claude/agents/{strategist,implementer,reviewer,documenter}.md` + `README.md` |
| Memória semente de cada agent | `.claude/agent-memory/<role>/MEMORY.md` |
| Slash commands V2 | `.claude/commands/{trabalhar,auditoria,seed-validate,dvfs-test,risk-gate-test,golden-test}.md` |
| Schema das 17 tabelas (referência) | Devari-Core/`RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` |
| Workflow multi-agent (referência) | Devari-Core/`RELATORIO-DEVARI-PARTE-2-MULTI-AGENT.md` |
| SaaS Generator (referência para feedback loop) | Devari-Core/`RELATORIO-DEVARI-PARTE-3-SAAS-GENERATOR.md` |
| Capacidades a replicar do legado (escopo Scrumban-hoje) | `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` |
| Contrato HTTP a manter (128 endpoints) | `Scrumbam-Backend/docs/API-CONTRACT.md` |

---

## 10. CHECKLIST DE INÍCIO (FASE 0 — PARA COMEÇAR HOJE)

Antes de tocar em qualquer arquivo de domínio, garantir:

**Repositório base:**
- [x] Pasta `Scrumban-Backend-V2/` criada
- [x] `CLAUDE.md` na raiz do V2 declarando submissão ao template
- [x] `package.json` minimalista (NestJS + Prisma + class-validator + class-transformer + bullmq) ✅ F0 fechada (commit 690d7c1)
- [x] `tsconfig.json` strict mode ✅ F0 fechada
- [x] `Makefile` com `dev`, `build`, `seed`, `test`, `lint`, `typecheck` ✅ F0 fechada
- [x] `docker-compose.yml` (Postgres + Redis local) ✅ F0 fechada
- [x] `.env.example` com TODAS as variáveis (sem secrets) ✅ F0 fechada
- [x] `prisma/schema.prisma` com as 17 tabelas canônicas (cópia fiel do Devari-Core) ✅ F1 Task #1 (commit 7af80d2 — 17 tabelas + 4 relations FK pré-F1 + Migration `20260508204157_initial_canonical`)
- [x] `git init` + commit inicial conforme Conventional Commits: `chore(setup): inicializa Scrumban-Backend-V2 com esqueleto canônico Devari-Core` ✅ F0 fechada

**Multi-agent infra (Bloco 2 da remediação):**
- [x] `.claude/rules/` ancoradas (8 rules canônicas Devari-Core copiadas)
- [x] `.claude/agents/` (4 agents: strategist, implementer, reviewer, documenter + README comparativo)
- [x] `.claude/agent-memory/<role>/MEMORY.md` POPULADAS (não vazias) — strategist 224L, implementer 244L, reviewer 257L, documenter 365L
- [x] `.claude/scripts/` (10 hooks executáveis incl. `validate-review-score.sh` e `enforce-canonical-tables.sh`)
- [x] `.claude/commands/` (6 slash commands V2: trabalhar, auditoria, seed-validate, dvfs-test, risk-gate-test, golden-test)
- [x] `.claude/settings.json` + `.claude/settings.local.json` com hooks ativos

**Bloco 3 da remediação (Backend Core):**
- [x] **`templates/classes-base-template.ts` existe e exporta `classesFixas`** — 45 classes universais, range -1 a -110, validação estática embutida (idPai consistente, root único). Pré-requisito BLOQUEANTE de F1. Validação: `node -e "console.log(require('./templates/classes-base-template').classesFixas.length)"` deve imprimir `45`.
- [x] `docs/decisions/ADR-V2-015-query-convention.md` redigido
- [x] `docs/decisions/ADR-V2-016-script-key-binding.md` redigido

**Bloco 4 da remediação (Generator feedback loop):**
- [x] `docs/spec/README.md` declarando fontes primárias (SYSTEM-OVERVIEW para escopo, 3 PARTES para arquitetura)
- [x] `docs/decisions/ADR-V2-017-generator-feedback-loop.md` redigido
- [x] **`docs/lessons/` criado** com `metrics-fase-template.md` ✅ F0 fechada (template); primeira instância `metrics-fase-1.md` produzida em F1 Task #1
- [x] **`docs/lessons/issues-evolution-from-v2.md` criado** ✅ F0 fechada
- [x] **Hook `validate-evolution-impact.sh` instalado** em `.claude/scripts/` ✅ F0 fechada

**Auditoria de fechamento (Bloco 5 da remediação):**
- [x] Reviewer audita os 3 sub-planos pós-remediação (PARTE-1, PARTE-2, PARTE-3) — meta: score ≥ 8.0 em cada ✅
- [x] Veredicto unânime ✅ APROVAR → fechar plano e iniciar F0 ✅

Quando todos os checks acima estiverem ✅, **F0 está concluída** e podemos iniciar **F1 — Schema + Seed**.

**Estado atual (2026-05-08):** F0 ✅ FECHADA. F1 Task #1 ✅ COMPLETA (Pilar 3 ATIVADO PLENAMENTE — 128 DClasses, score 9.0/10, commit Implementer `7af80d2`). Próximo: F2 Task #1 (`EntidadeController`).

---

## 11. RECOMENDAÇÃO FINAL AO CEO

1. **Validar este plano-mestre v1.1 + os 4 sub-planos retrabalhados** (sessão 1-2h).
2. **Aprovar os 18 ADRs** (14 originais + 015, 016, 017 redigidos + 018 score gate). Pontos para confirmar:
   - **D1** (ADR-V2-015): aceitar compatibilidade `?classe=NOME` por 2 sprints com header `Sunset` + deprecation logs?
   - **D2** (ADR-V2-016): aceitar testes adversariais BLOQUEANTES no DoD F6 (Implementer não pode pular)?
   - **D3** (ADR-V2-018): score gate ≥ 7.0 enforce mecânico via hook?
3. **Confirmar a estimativa de 24 semanas** (~6 meses) com 1 implementer dedicado + Strategist apoio + Reviewer parcial.
4. **Definir cadência de stand-ups** (recomendo: semanal Strategist + Implementer + Reviewer; mensal todo o time + CEO).
5. **Comunicar internamente:** V2 não é refactor — é **refundação canônica + piloto-vivo do Generator**. Cada PR puxa 3 Pilares + 21 padrões + 17 tabelas. Hooks bloqueiam afrouxamento. Ninguém afrouxa. Nem uma vez.
6. **Iniciar F0 na próxima janela disponível.**

A corda está justa. A maratona começa quando você der OK.

---

**Fim do Plano Mestre v1.1.**
