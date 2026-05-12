# Scrumban-Backend-V2 — Submissão ao Template Devari-Core

**Versão:** 1.0
**Data:** 2026-05-08
**Estado:** Fase 0 (Verificação canônica + Setup repo + Multi-agent infra) em planejamento

---

## DECLARAÇÃO FORMAL DE SUBMISSÃO AO TEMPLATE

O **Scrumban-Backend-V2** é projeto-filho do template **Devari-Core**.
Submete-se INTEGRALMENTE à governança canônica:

- **17 tabelas canônicas** (DClasse, DEntidade, DTabela, DVincula, DEvento, DRecurso, DUserGroup, DPermissao, DTask, DProject, DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS) — ZERO tabela nova (ADR-V2-001).
- **3 Pilares** (Engine, Endpoints Genéricos, Seed) — ativos sempre.
- **Fábrica multi-agent** (`.claude/`) — Strategist → Implementer → Reviewer → Documenter, sob hooks mecânicos.
- **8 rules canônicas** auto-injetadas via skills.
- **Conventional Commits** com scope V2 oficial.

Exceções a estas regras requerem **ADR-V2-XXX justificando**. Hook `enforce-canonical-tables.sh` bloqueia mecanicamente tentativas de tabela nova.

---

## CHECKLIST DE INÍCIO (LEIA ANTES DE QUALQUER COISA)

1. [ ] Li `docs/plano/00-PLANO-MESTRE.md`?
2. [ ] Li o sub-plano da fase atual (`01-FUNDACAO.md`..`04-HARDENING-HANDOFF.md`)?
3. [ ] Li `.claude/agents/README.md` (tabela comparativa dos 4 agents)?
4. [ ] Li `.claude/agent-memory/<role>/MEMORY.md` (semente do meu papel)?
5. [ ] Sei que ZERO tabela nova é regra inviolável (hook bloqueia)?
6. [ ] Sei que Engine é APENAS em DPedido idClasse=-300?
7. [ ] Sei que Score gate APPROVED ≥ 7.0 (hook bloqueia)?
8. [ ] Sei que cadeia Strategist→Implementer→Reviewer→Documenter é OBRIGATÓRIA (gates não pulam)?

---

## REGRAS DE OURO V2 (NÃO-NEGOCIÁVEIS)

| Regra | Origem | Hook que valida |
|-------|--------|-----------------|
| ZERO tabela nova fora das 17 | ADR-V2-001 | `enforce-canonical-tables.sh` |
| DClasses sequestradas (-47, -49, -50) voltam ao canônico | ADR-V2-002 | Reviewer rejeita score <5 |
| RBAC duplo via DVincula + idClasse (sem DProjectMember) | ADR-V2-003 | Reviewer |
| API/MCP keys via DTabela | ADR-V2-004 | Reviewer |
| OperacaoExecucaoClaude extends OperacaoPedido (Pilar 1 ATIVADO) | ADR-V2-005 | F6 DoD |
| Risk via idClasse (-301/-302/-303), não campo | ADR-V2-006 | F6 DoD |
| DVFS scripts para portabilidade (chaves 3-7) | ADR-V2-007 | F6 DoD + bug regressivo `s.id` vs `s.chave` |
| DEvento substitui DNotification/DWebhook | ADR-V2-008 | Reviewer |
| Sprints/Workflow Statuses como wrappers thin | ADR-V2-009 | README obrigatório |
| Score gate APPROVED ≥ 7.0 | ADR-V2-015 (a ratificar) | `validate-review-score.sh` |
| Conventional Commits scope V2 | devari-conventional-commits.md | `validate-documentation.sh` |

---

## ESCOPO V2 (CEO 2026-05-08)

V2 = Scrumban-hoje (`Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md`):
- 128 endpoints HTTP
- V3 Intentions (INBOX, READY, EXECUTING, DONE, FAILED, CANCELLED, DISCARDED, VALIDATING, VALIDATED)
- Flow Metrics + Forecast Monte Carlo
- Telegram com voz Groq Whisper
- MCP Server (5 tools)
- Webhooks outbound HMAC
- Automation Claude Code (com Risk Gate + 58 testes adversariais)

**NÃO reduzir escopo.** Apenas mudar como faz (das 17 tabelas, sob 3 Pilares).

---

## SISTEMA MULTI-AGENT (Workflow Orchestrator — 9 passos)

```
1. Usuário entrega task
2. Conversa Principal analisa: precisa Strategist?
   ├─ SIM (3 Pilares OU migration OU >3 files OU >2h OU múltiplas abordagens) → passo 3
   └─ NÃO → Fast Mode (passo 5 direto, em F0/F4/F11/F16 apenas)
3. Conversa Principal chama Strategist (Task tool)
   └─ Output: workspace/plans/plan-*-task[N].md (validate-plan.sh)
4. Conversa Principal lê plan e gera mensagem clara para Implementer
5. Conversa Principal chama Implementer (Task tool)
   └─ agentId salvo (resume em rejeições)
   └─ validate-implementation.sh + validate-implementer-build.sh
6. Conversa Principal chama Reviewer (Task tool, modelo sonnet)
   └─ Output com Score X/10 + Decisão (validate-review.sh + validate-review-score.sh)
7. Branch:
   └─ APPROVED → passo 8
   └─ NEEDS_CHANGES/REJECTED → resume Implementer (volta passo 6); 3 rejeições → PAUSAR
8. Conversa Principal chama Documenter (Task tool, modelo haiku)
   └─ JSDoc + ROADMAP + CHANGELOG + STATUS + commit (validate-documentation.sh)
9. Conversa Principal entrega report final ao usuário
```

**REGRA:** Nenhum agent invoca outro. Conversa principal é o ÚNICO orquestrador.

---

## DOCUMENTAÇÃO V2 (HIERARQUIA DE LEITURA)

Quando perder contexto, ler nesta ordem:

1. **Este `CLAUDE.md`** (raiz V2 — submissão ao template, regras de ouro, workflow)
2. **`docs/plano/00-PLANO-MESTRE.md`** — bíblia operacional (17 fases, 14 ADRs, seed canônico)
3. **`docs/plano/01-FUNDACAO.md`** a **`04-HARDENING-HANDOFF.md`** — sub-planos detalhados
4. **`docs/auditoria/00-AUDITORIA-CONSOLIDADA.md`** — diagnóstico do que foi corrigido
5. **`.claude/agents/README.md`** — tabela comparativa dos 4 agents
6. **`.claude/agent-memory/<role>/MEMORY.md`** — memória semente do meu papel
7. **`.claude/rules/devari-*.md`** — regras canônicas auto-injetadas

---

## REPOSITÓRIOS DE REFERÊNCIA

| Repo | Localização | Status |
|------|-------------|--------|
| Devari-Core (template) | `/Users/devaritecnologia/Documents/Benedito/Devari-Core/` | Template canônico |
| Scrumban-Backend-V2 (este) | `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/` | Refundação canônica em execução |
| Scrumban-Backend (legado) | `/Users/devaritecnologia/Documents/Benedito/Scrumbam-Backend/` | Referência funcional (escopo Scrumban-hoje) |

**REGRA:** Scrumban-Backend-V2 é repo SEPARADO. NUNCA implementar V2 dentro do Devari-Core.

---

## SUBPROJETO `agent/` (F13 — cliente VPS)

A pasta `agent/` neste mesmo repositório é o código do **scrumban-agent** — binário Node.js+TS que roda na **VPS** e executa `claude -p` localmente sob comando do backend. Decisão de monorepo formalizada em **ADR-V2-036** (versionamento atômico entre backend e agente — mudanças de protocolo `/v1/execute` em PR único).

| Item | Caminho |
|------|---------|
| Código TS | `agent/src/` |
| Testes (Jest) | `agent/__tests__/` |
| Instalador / desinstalador | `agent/install.sh`, `agent/uninstall.sh` |
| systemd unit (hardening) | `agent/systemd/scrumban-agent.service` |
| Template do `CLAUDE.md` global | `agent/CLAUDE-md-template.md` |
| README operacional | `agent/README.md` |
| Runbook de instalação | `docs/automation-agent-install-runbook.md` |

**Build/test/lint isolados** (não é workspace npm):

```bash
cd agent
npm install
npm test          # jest (84 specs ao fim do Task #1)
npm run build     # tsc → dist/
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

`agent/node_modules/` e `agent/dist/` ficam fora de git (`agent/.gitignore`). Bundle de deploy gerado on-demand (`tar czf` → `scp` → VPS — OPÇÃO C, ver runbook).

**ADRs específicos do agente:**

- **ADR-V2-035** — Identidade de projeto via `projectSlug` + `CLAUDE.md` global (elimina path injection).
- **ADR-V2-036** — Monorepo `agent/` (versionamento atômico).
- **ADR-V2-037** — Ponteiro de sessão Claude Code (`claudeSessionId`) — porta aberta para chat-with-VPS.
- **ADR-V2-033** — Contrato `/v1/execute` outbound + `execution-result` inbound.

**REGRA:** o agente NÃO toca banco diretamente — toda persistência atravessa endpoints HTTP do backend (Pilar 1 ATIVADO via `OperacaoExecucaoClaude` em DPedido idClasse=-300..-303).

---

## ELIMINAÇÕES VS LEGADO

Tabelas próprias do legado **eliminadas no V2** (substitutas canônicas):

| Legado | V2 | Como |
|--------|-----|------|
| DProjectMember | DVincula | RBAC duplo via idClasse (-160..-179) |
| DNotification | DEvento | idClasse=-490 NOTIFICATION |
| DWebhook | DTabela + DEvento | Config em DTabela -470 + attempts em DEvento -491 |
| DAgent | DEntidade | idClasse=-156 AGENT |
| DExecution | DPedido | idClasse=-300..-303 EXECUTION (Pilar 1) |

---

## CRONOGRAMA

**24 semanas** (~6 meses) com 1 implementer dedicado + Strategist apoio + Reviewer alocado parcialmente.

Cenário pessimista: 29 semanas. Cenário otimista (com paralelismos F4∥F3, F8∥F7, F10∥F11): 20 semanas.

**Não é corrida — é maratona.** Família depende. Velocidade é consequência de disciplina, não substituto.

---

## APOIO E ESCALAÇÃO

- Conflitos arquiteturais: redigir ADR-V2-XXX (Strategist propõe, Documenter formaliza, CEO aprova se estratégico)
- 3+ rejeições consecutivas em uma task: PAUSAR e consultar usuário
- Build não passa: corrigir ANTES de qualquer outra coisa (hook bloqueia)
- Tabela nova proposta: rejeitar; usar `dados`/`metaDados` Json ou redigir ADR
- Sequestro de DClasse canônica: rejeitar; renumerar para -150..-529

---

**Maintained by:** Devari Tecnologia
**Versão:** 1.0
**Last updated:** 2026-05-08
