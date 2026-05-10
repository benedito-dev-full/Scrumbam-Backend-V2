# Auditoria do Schema Canonico — Scrumban-Backend-V2

**Data:** 2026-05-08
**Fase:** F1 (Pilar 3 — Schema Canonico + Seed de DClasses)
**Migration:** `20260508204157_initial_canonical`
**ADRs vinculados:** V2-019, V2-020, V2-021, V2-022, V2-023, V2-024

---

## 1. As 17 Tabelas Canonicas Devari-Core

| # | Tabela | Papel V2 | Campos opt-in | Uso imediato Scrumban-V2 |
|---|--------|----------|---------------|--------------------------|
| 1 | **DClasse** | Taxonomia / sistema de tipos polimorfico | `tableFields`, `metaDados` (futuro) | 128 classes seed (45 fixas + 83 especificas) |
| 2 | **DEntidade** | Cadastro universal polimorfico | `dados` (V3 fields, agent config), `metaDados` | Users (-150), Platform (-151), Org (-152), Agent (-156), Team (-180) |
| 3 | **DTabela** | Lookups, configuracoes, catalogos | `dados`, `metaDados` | Sprint, Priority, Status V3, Channel, Webhook, API Key, MCP Key, Install Token |
| 4 | **DVincula** | Relacoes genericas N:N e 1:N | `metaDados` | Org-User RBAC, Project-User RBAC, Team membership, Project-Agent, Telegram links |
| 5 | **DEvento** | Audit trail polimorfico | `metaDados` | Notifications, webhook attempts, agent heartbeat, telegram, MCP, execution logs, audit |
| 6 | **DRecurso** | Produtos, servicos, ativos, despesas, receitas | `metaDados` | Sem uso direto V2 (reservado) |
| 7 | **DUserGroup** | Usuarios e grupos (login) | `dados` (refresh tokens, MCP keys, MFA) | Auth F3 |
| 8 | **DPermissao** | Permissoes por grupo | `metaDados` | RBAC F3 |
| 9 | **DTask** | Atividades, etapas, tarefas | `dados` (V3 intentions, telemetria, workSessions) | Tasks F5 (com identifier publico DEV-N e V3 statuses) |
| 10 | **DProject** | Projetos, boards, negocios, obras | `dados` (git deploy keys, automation config) | Projects F5 |
| 11 | **DPedido** | Transacional (Engine F6) | `dados` (command, stdout, riskLevel), `metaDados` | Executions Claude Code (idClasse -300..-303) |
| 12 | **DTitulo** | Financeiro (contas a pagar/receber) | `metaDados` | Sem uso direto V2 (reservado) |
| 13 | **DMovDispo** | Ledger financeiro (extrato dinheiro) | `metaDados` | Sem uso direto V2 (reservado) |
| 14 | **DMovDepos** | Movimentacao de estoque | `metaDados` | Sem uso direto V2 (reservado) |
| 15 | **DSolicita** | Solicitacoes (transferencia entre depositos) | `metaDados` | Sem uso direto V2 (reservado) |
| 16 | **DRequisic** | Requisicoes internas (consumo) | `metaDados` | Sem uso direto V2 (reservado) |
| 17 | **DVFS** | Virtual File System (scripts dos Engines) | `metaDados` | F6 ativacao de OperacaoExecucaoClaude |

**Tabelas eliminadas vs legado (substituidas por canonicas):**
| Legado | V2 substituta | Padrao |
|--------|--------------|--------|
| DProjectMember | DVincula (idClasse=-160..-179) | RBAC duplo |
| DNotification | DEvento (idClasse=-490) | Audit trail |
| DWebhook | DTabela (-470) + DEvento (-491) | Config + attempts |
| DAgent | DEntidade (-156) | Cadastro polimorfico |
| DExecution | DPedido (-300..-303) | Engine workflow |

---

## 2. Mapeamento Legado → V2 (DClasses sequestradas → renumeradas)

| Legado | V2 | Razao |
|--------|-----|-------|
| -47 USER (sequestro Dinpayz SELLER) | **-150 USER** | Corte limpo (ADR-V2-022) |
| -49 PLATFORM (sequestro Dinpayz PLATAFORMA) | **-151 PLATFORM_SCRUMBAN** | Corte limpo |
| -50 ORG (sequestro Dinpayz COMPRADOR) | **-152 ORGANIZATION** | Corte limpo |

Chaves -45/-47/-49/-50 ficam **livres** no seed Scrumban-V2 — reservadas
para uso fintech canonico Devari-Core. `validate-hierarchy.ts` bloqueia
mecanicamente qualquer tentativa de uso.

---

## 3. Composicao do Seed (128 DClasses)

- **45 fixas universais Devari-Core** (range -1..-110), via spread de
  `templates/classes-base-template.ts`. Hierarquia: Root, Movimentacoes,
  Eventos, Financeiro, Estoque, Pedidos, Cadastros, Entidades, Pessoas,
  Tabelas, Status, Recursos, Tarefas, Projetos, Scripts (DVFS), Permissoes,
  Eventos de Seguranca.

- **83 especificas Scrumban-V2** (range -150..-527):
  - 5  DEntidade  (USER, PLATFORM_SCRUMBAN, ORGANIZATION, AGENT, TEAM)
  - 11 DVincula   (ORG/PROJECT roles, TEAM, PROJECT_AGENT, TELEGRAM)
  - 4  DPedido    (EXECUTION + EXEC_LOW/MED/HIGH)
  - 35 DTabela main (SPRINT, PRIORITY×4, TASK_TYPE×5, STATUS V3×9, CHANNEL×6, WEBHOOK/KEY/TOKEN/COUNTER×6)
  - 12 DEvento    (NOTIFICATION, WEBHOOK_ATTEMPT, AGENT_HEARTBEAT, TELEGRAM×2, MCP, EXECUTION_LOG, audit×5)
  - 16 DTabela secondary (AGENT_STATUS×4, EXEC_STATUS×9, RISK_LEVEL×3)

**Nota sobre contagem:** O Plano Mestre §3.2 declara nominalmente "~70"
classes especificas; o Plano F1 §6 sumariza "80" mas a tabela detalhada
soma 83 entradas (35 DTabela main em vez de 32 listados no header). O
DoD-06 estabelece piso `>= 97` (45 + 52); a entrega real e **128** (45 + 83),
acima do piso. A discrepancia entre prosa e tabela do Plano F1 §6 e
discrepancia editorial do plano — os dados da tabela sao a fonte da
verdade e foram digitados na integra.

---

## 4. Dump Completo das 128 DClasses

Gerado via:
```sql
SELECT chave, codigo, nome, "idPai" FROM "DClasse" ORDER BY chave DESC;
```

| chave | codigo | nome | idPai |
|------:|--------|------|------:|
| -1    | ROOT | Root | (null) |
| -2    | MOVIMENTACOES | Movimentacoes | -1 |
| -3    | EVENTOS | Eventos | -2 |
| -4    | FINANCEIRO | Financeiro | -2 |
| -5    | TITULOS | Titulos | -4 |
| -6    | TIT_RECEBER | Titulos a Receber | -5 |
| -7    | TIT_PAGAR | Titulos a Pagar | -5 |
| -8    | MOV_DISPONIVEL | Movimentacao Disponivel | -4 |
| -10   | ESTOQUE | Estoque | -2 |
| -11   | MOV_DEPOSITO | Movimentacao Deposito | -10 |
| -12   | SOLICITACOES | Solicitacoes | -10 |
| -13   | REQUISICOES | Requisicoes | -10 |
| -20   | PEDIDOS | Pedidos | -2 |
| -36   | CADASTROS | Cadastros | -1 |
| -37   | ENTIDADES | Entidades | -36 |
| -38   | ESTABELECIMENTOS | Estabelecimentos | -37 |
| -39   | LOC_ESCRITURACAO | Local de Escrituracao | -37 |
| -40   | DISPONIVEIS | Disponiveis | -37 |
| -41   | NUCLEOS | Nucleos | -37 |
| -42   | CENTROS_DE_CUSTO | Centros de Custo | -41 |
| -43   | PESSOAS | Pessoas | -37 |
| -44   | DEPOSITOS | Depositos | -41 |
| -46   | USUARIOS | Usuarios | -43 |
| -51   | TABELAS | Tabelas | -36 |
| -52   | STATUS | Status | -51 |
| -60   | RECURSOS | Recursos | -36 |
| -61   | PRODUTOS | Produtos | -60 |
| -62   | MERCADORIAS | Mercadorias | -60 |
| -63   | ATIVOS | Ativos Imobilizados | -60 |
| -64   | DESPESAS | Despesas | -60 |
| -65   | RECEITAS | Receitas | -60 |
| -66   | SERVICOS | Servicos | -60 |
| -70   | TAREFAS | Tarefas | -1 |
| -71   | ATIVIDADES | Atividades | -70 |
| -80   | PROJETOS | Projetos | -1 |
| -81   | NEGOCIOS | Negocios | -80 |
| -90   | SCRIPTS | Scripts | -1 |
| -91   | SCRIPT_PRE_CALCULO | Script Pre-Calculo | -90 |
| -92   | SCRIPT_CALCULO | Script Calculo | -90 |
| -93   | SCRIPT_POS_CALCULO | Script Pos-Calculo | -90 |
| -94   | SCRIPT_PRE_GRAVACAO | Script Pre-Gravacao | -90 |
| -95   | SCRIPT_POS_GRAVACAO | Script Pos-Gravacao | -90 |
| -100  | PERMISSOES | Permissoes | -1 |
| -101  | GRUPO_PERMISSAO | Grupo de Permissao | -100 |
| -110  | EVENTOS_SEGURANCA | Eventos de Seguranca | -3 |
| -150  | USER | Usuario Scrumban | -43 |
| -151  | PLATFORM_SCRUMBAN | Platform Scrumban | -43 |
| -152  | ORGANIZATION | Organizacao | -43 |
| -156  | AGENT | Agente Claude Code | -43 |
| -160  | ORG_USER_LINK | Vinculo Org-Usuario | -37 |
| -161  | ORG_ROLE_ADMIN | Org Role: ADMIN | -160 |
| -162  | ORG_ROLE_MEMBER | Org Role: MEMBER | -160 |
| -163  | ORG_ROLE_VIEWER | Org Role: VIEWER | -160 |
| -170  | PROJECT_USER_LINK | Vinculo Project-Usuario | -37 |
| -171  | PROJECT_ROLE_MANAGER | Project Role: MANAGER | -170 |
| -172  | PROJECT_ROLE_MEMBER | Project Role: MEMBER | -170 |
| -173  | PROJECT_ROLE_VIEWER | Project Role: VIEWER | -170 |
| -180  | TEAM | Time | -43 |
| -181  | TEAM_MEMBERSHIP | Vinculo Team-User | -37 |
| -185  | PROJECT_AGENT | Vinculo Project-Agent | -37 |
| -186  | TELEGRAM_LINK | Vinculo User-Telegram chat | -37 |
| -300  | EXECUTION | Execucao Claude Code | -20 |
| -301  | EXEC_LOW | Execucao risco LOW | -300 |
| -302  | EXEC_MED | Execucao risco MEDIUM | -300 |
| -303  | EXEC_HIGH | Execucao risco HIGH | -300 |
| -400  | SPRINT | Sprint (agrupador) | -51 |
| -420  | PRIORITY | Priority (agrupador) | -51 |
| -421  | HIGH | Priority HIGH | -420 |
| -422  | MEDIUM | Priority MEDIUM | -420 |
| -423  | LOW | Priority LOW | -420 |
| -424  | URGENT | Priority URGENT | -420 |
| -430  | TASK_TYPE | Task Type (agrupador) | -51 |
| -431  | FEATURE | Task FEATURE | -430 |
| -432  | BUG | Task BUG | -430 |
| -433  | IMPROVEMENT | Task IMPROVEMENT | -430 |
| -434  | REVIEW | Task REVIEW | -430 |
| -435  | EXPLAIN | Task EXPLAIN | -430 |
| -440  | STATUS_INTENTION_V3 | Status V3 (agrupador) | -52 |
| -441  | INBOX | Status INBOX | -440 |
| -442  | READY | Status READY | -440 |
| -443  | EXECUTING | Status EXECUTING | -440 |
| -444  | DONE | Status DONE | -440 |
| -445  | FAILED | Status FAILED | -440 |
| -446  | CANCELLED | Status CANCELLED | -440 |
| -447  | DISCARDED | Status DISCARDED | -440 |
| -448  | VALIDATING | Status VALIDATING | -440 |
| -449  | VALIDATED | Status VALIDATED | -440 |
| -450  | CHANNEL | Canal (agrupador) | -52 |
| -451  | WEB | Canal WEB | -450 |
| -452  | WHATSAPP | Canal WHATSAPP | -450 |
| -453  | EMAIL | Canal EMAIL | -450 |
| -454  | SLACK | Canal SLACK | -450 |
| -455  | API | Canal API | -450 |
| -456  | TELEGRAM | Canal TELEGRAM | -450 |
| -470  | WEBHOOK | Configuracao de Webhook outbound | -52 |
| -471  | API_KEY | API Key por projeto | -52 |
| -472  | MCP_KEY | MCP Key por usuario | -52 |
| -473  | INSTALL_TOKEN | Token install one-shot Argus | -52 |
| -474  | PAIRING_TOKEN | Token pairing Telegram | -52 |
| -475  | ISSUE_COUNTER | Contador DEV-N por team | -52 |
| -489  | AUDIT_GENERIC | Audit generico (fallback sem categoria semantica) | -3 |
| -490  | NOTIFICATION | Notificacao in-app | -3 |
| -491  | WEBHOOK_ATTEMPT | Tentativa de Webhook outbound | -3 |
| -492  | AGENT_HEARTBEAT | Heartbeat de Agent | -3 |
| -493  | TELEGRAM_MSG_IN | Mensagem Telegram recebida | -3 |
| -494  | TELEGRAM_MSG_OUT | Mensagem Telegram enviada | -3 |
| -495  | MCP_CALL | Chamada MCP auditada | -3 |
| -496  | EXECUTION_LOG | Log de execucao Claude | -3 |
| -497  | TASK_CREATED | Audit: task criada | -3 |
| -498  | TASK_STATUS_CHANGED | Audit: mudanca de status | -3 |
| -499  | PROJECT_LIFECYCLE | Audit: lifecycle de projeto (created/updated/deleted via metaDados._meta.action) | -3 |
| -500  | ORG_LIFECYCLE | Audit: lifecycle de organizacao (created/updated/deleted via metaDados._meta.action) | -3 |
| -501  | USER_LOGIN | Audit: login | -3 |
| -510  | AGENT_STATUS_ONLINE | Agent: ONLINE | -52 |
| -511  | AGENT_STATUS_OFFLINE | Agent: OFFLINE | -52 |
| -512  | AGENT_STATUS_PENDING_INSTALL | Agent: PENDING_INSTALL | -52 |
| -513  | AGENT_STATUS_NEVER_CONNECTED | Agent: NEVER_CONNECTED | -52 |
| -514  | EXEC_STATUS_QUEUED | Exec: QUEUED | -52 |
| -515  | EXEC_STATUS_AWAITING_APPROVAL | Exec: AWAITING_APPROVAL | -52 |
| -516  | EXEC_STATUS_APPROVED | Exec: APPROVED | -52 |
| -517  | EXEC_STATUS_REJECTED | Exec: REJECTED | -52 |
| -518  | EXEC_STATUS_RUNNING | Exec: RUNNING | -52 |
| -519  | EXEC_STATUS_SUCCESS | Exec: SUCCESS | -52 |
| -520  | EXEC_STATUS_FAILED | Exec: FAILED | -52 |
| -521  | EXEC_STATUS_EXPIRED | Exec: EXPIRED | -52 |
| -522  | EXEC_STATUS_ROLLED_BACK | Exec: ROLLED_BACK | -52 |
| -525  | RISK_LEVEL_LOW | Risk: LOW | -52 |
| -526  | RISK_LEVEL_MEDIUM | Risk: MEDIUM | -52 |
| -527  | RISK_LEVEL_HIGH | Risk: HIGH | -52 |

(Tambem nao se inclui nenhuma -45/-47/-49/-50 — chaves canonicas
fintech reservadas, validador bloqueia.)

---

## 5. Validacao Operacional (smoke test integrado)

```bash
make build                                      # PASS
npx tsc --noEmit                                # 0 errors
npx eslint src/ prisma/seeds/ --max-warnings 0  # 0 errors
npx jest                                        # 11 tests PASS
docker compose up -d postgres redis             # OK
npx prisma migrate dev --name initial_canonical # 17 CREATE TABLE + FKs
npx prisma db seed (1ª execucao)                # 128 classes upserted em 948ms
npx prisma db seed (2ª execucao)                # idempotente, 149ms
SELECT count(*) FROM "DClasse";                 # 128
```

---

## 6. Anti-regressao por Hooks (validacao mecanica)

| Tentativa | Hook que bloqueia | Resultado esperado |
|-----------|-------------------|--------------------|
| `enum Test { A B }` no schema | `enforce-canonical-tables.sh` | exit 2 |
| `model DAgent { ... }` no schema | `enforce-canonical-tables.sh` | exit 2 |
| `esp(-47, 'USER_FAKE', ...)` em `classes.seed.ts` | `validateHierarchy()` em time de import | throw em jest/tsc |

---

**Conclusao:** Pilar 3 ATIVADO PLENAMENTE. Sistema pronto para F2
(endpoints genericos) e F6 (Engine OperacaoExecucaoClaude).
