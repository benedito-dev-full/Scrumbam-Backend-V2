# Agents do Scrumban-Backend-V2

Os 4 agents formam o **workflow operacional** do V2. Toda task substantiva passa pela cadeia
**Strategist → Implementer → Reviewer → Documenter**, sob governança da fábrica multi-agent
herdada do Devari-Core.

**REGRA INVIOLÁVEL:** **Nenhum agent invoca outro agent.** A conversa principal (Orchestrator)
é a ÚNICA que orquestra. Todos os agents têm `disallowedTools: [Task]`.

---

## Tabela Comparativa

| Aspecto | Strategist | Implementer | Reviewer | Documenter |
|---------|-----------|------------|---------|-----------|
| **Cor** | 🔵 azul | 🟢 verde | 🟡 amarelo | 🟣 roxo |
| **Modelo** | inherit | inherit | **sonnet** (custo) | **haiku** (mecânica) |
| **Tempo target** | 15–30min | 1–4h | 30–40min | 20–30min |
| **Bash** | ❌ não (puro planejador) | ✅ sim (build, tests) | ✅ sim (testes, grep) | ✅ sim (git, grep) |
| **Task tool** | ❌ NÃO INVOCAR OUTRO AGENT | ❌ NÃO | ❌ NÃO | ❌ NÃO |
| **memory** | project (MEMORY.md) | project | project | project |
| **Skills auto-injetadas** | backend-patterns, 3-pilares, polymorphic-engine, event-naming, saas-generator | backend-patterns, 3-pilares, polymorphic-engine, event-naming, jsdoc-templates | backend-patterns, 3-pilares, polymorphic-engine | jsdoc-templates, conventional-commits, migration-protocol |
| **Hook Stop** | `validate-plan.sh` (60s) | `validate-implementation.sh` (180s) | `validate-review.sh` + `validate-review-score.sh` (30s) | `validate-documentation.sh` (60s) |
| **Hook SubagentStop** | `update-status-after-agent.sh` | `validate-implementer-build.sh` + `update-status-after-agent.sh` | `update-status-after-agent.sh` | `update-status-after-agent.sh` |
| **Output canônico** | `workspace/plans/plan-*-task[N].md` | `workspace/implementations/impl-*-task[N].md` + código | `workspace/reviews/review-*-task[N].md` | JSDoc + ROADMAP + CHANGELOG + STATUS + commit |
| **Score gate** | — | build PASS + 0 TS + 0 ESLint | **APPROVED requer ≥ 7.0/10** (hook bloqueia) | STATUS.md atualizado |
| **Quem chama** | Conversa principal (Orchestrator) | Conversa principal | Conversa principal | Conversa principal |

---

## Quando usar cada um

### Strategist
- Task com **>2h** ou que envolve **mudança estrutural**
- **3 Pilares envolvidos** (Engine, Endpoints, Seed) → SEMPRE Strategist
- **Migrations** (Prisma) → SEMPRE Strategist
- **>3 arquivos** afetados
- Múltiplas abordagens viáveis (precisa trade-off)
- Decisão arquitetural que merece ADR-V2-XXX
- **Em F1, F2, F3, F5, F6, F7, F13, F15** → SEMPRE Strategist (estas fases são pesadas)

**Decisão tree:** Na dúvida, Strategist. Pular Strategist é EXCEÇÃO.

### Implementer
- **Sempre depois do Strategist** ter criado o plan
- **Fast Mode (sem Strategist):** apenas em F0 (setup), F4 (email simples), F11 (config), F16 (doc) — e mesmo assim Reviewer + Documenter rodam.
- Implementa código, services, controllers, DTOs, processors, BullMQ workers, testes

### Reviewer
- **SEMPRE roda** após Implementer (gate obrigatório)
- Score numérico mandatório
- **APPROVED ≥ 7.0** (regra mecânica via hook)
- F13 (Risk Gate / RCE): rodar 58 testes adversariais + checagem extra de Pilar 1

### Documenter
- **SEMPRE roda** após Reviewer APPROVED (gate obrigatório)
- Atualiza JSDoc, ROADMAP, CHANGELOG, STATUS, commit
- Redige ADR-V2-XXX se Strategist marcou
- Modelo Haiku (mais barato — doc é mecânica)

---

## Fluxo padrão (9 passos do Workflow Orchestrator)

```
1. Usuário entrega task → Conversa Principal
2. Conversa Principal analisa: precisa Strategist?
   └─ SIM: passo 3 (3 Pilares OU migration OU >3 files OU >2h)
   └─ NÃO: Fast Mode → passo 5 direto
3. Conversa Principal chama Strategist (Task tool)
   └─ Output: workspace/plans/plan-*-task[N].md
   └─ Hook: validate-plan.sh
4. Conversa Principal lê o plan e gera mensagem clara para Implementer
5. Conversa Principal chama Implementer (Task tool)
   └─ agentId salvo (para resume em caso de NEEDS_CHANGES)
   └─ Hooks: validate-implementation.sh + validate-implementer-build.sh
6. Conversa Principal chama Reviewer (Task tool)
   └─ Output: workspace/reviews/review-*-task[N].md com Score X/10 + Decisão
   └─ Hooks: validate-review.sh + validate-review-score.sh (bloqueia APPROVED < 7.0)
7. Branch:
   └─ APPROVED → passo 8
   └─ NEEDS_CHANGES / REJECTED → resume Implementer (mesmo agentId) com feedback do Reviewer; volta ao passo 6 (limite: 3 rejeições, depois PAUSAR e consultar usuário)
8. Conversa Principal chama Documenter (Task tool)
   └─ Atualiza JSDoc + ROADMAP + CHANGELOG + STATUS + commit
   └─ Hook: validate-documentation.sh
9. Conversa Principal entrega report final ao usuário
```

**Tempo total típico:** 3–4h por task (planning 30min + impl 2h + review 30min + doc 25min).

---

## Edge cases

| Caso | Tratamento |
|------|------------|
| Reviewer rejeita 3+ vezes | **PAUSAR, consultar usuário.** Opções: (a) simplificar, (b) relaxar padrões, (c) revisar manualmente, (d) novo Implementer. |
| Hook `validate-implementer-build.sh` retorna `decision: block` | Implementer NÃO retorna; corrige build/TS antes |
| Hook `validate-review-score.sh` retorna exit 2 (APPROVED < 7.0) | Reviewer corrige decisão (REJECTED ou NEEDS_CHANGES) ou aumenta score (se justificado) |
| Strategist propõe tabela nova | Hook `enforce-canonical-tables.sh` bloqueia. Plano REJEITADO no Stop. |
| Implementer sequestra DClasse canônica (-40, -45, -47, -49, -50) | Reviewer rejeita score < 5. Implementer corrige seed. |
| Documenter falha no STATUS.md | Hook `validate-documentation.sh` exit 2. Documenter corrige. |

---

## Proibições explícitas

- **NUNCA** usar `Bash` para criar artefatos do workspace (use Write/Edit).
- **NUNCA** pular Reviewer ou Documenter (gates obrigatórios).
- **NUNCA** fazer trabalho dos agents na conversa principal (delegação OBRIGATÓRIA).
- **NUNCA** agents se chamam (`disallowedTools: [Task]` em todos).
- **NUNCA** `git push --force` sem aprovação CEO.
- **NUNCA** `prisma migrate reset`, `prisma db push --accept-data-loss`, `DROP TABLE`, `TRUNCATE` (hook `block-destructive-commands.sh` bloqueia).

---

**Para detalhes operacionais de cada agent, ver `strategist.md`, `implementer.md`, `reviewer.md`, `documenter.md`.**

**Para skills auto-injetadas, ver `../rules/devari-*.md`.**

**Para hooks, ver `../scripts/*.sh` e `../settings.json`.**
