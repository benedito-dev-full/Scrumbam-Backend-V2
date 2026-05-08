# Auditoria — PARTE-2 (Multi-Agent System) vs Plano V2

**Versão:** 1.0
**Data:** 2026-05-08
**Auditor:** Reviewer Devari-Core (Sonnet model — escopo PARTE-2)
**Status:** RETRABALHO OBRIGATÓRIO (score 4.6/10)

---

## 0. Resumo Executivo

### 0.1. Escopo

Este relatório audita, seção a seção, a cobertura do plano de refundação do
Scrumban Backend V2 (5 arquivos em `Scrumban-Backend-V2/docs/plano/`, 5832
linhas) contra o `RELATORIO-DEVARI-PARTE-2-MULTI-AGENT.md` (2605 linhas) que
descreve a "fábrica" multi-agent embutida em `.claude/`. O outros dois
auditores estão tratando da PARTE-1 (Backend Core) e PARTE-3 (SaaS Generator).
Este escopo é **infraestrutura multi-agent**: agents especializados, hooks,
skills/rules, agent-memory, slash commands, workflow Orchestrator, audit
trail, workspace.

### 0.2. Conclusão antecipada

O plano V2 é **forte em arquitetura backend** (3 Pilares, 17 tabelas,
DClasses) mas **frágil em infraestrutura multi-agent**. Trata `.claude/` como
diretório que se "copia do Devari-Core" e adiciona apenas **um hook novo**
(`enforce-canonical-tables.sh`). Praticamente todas as 14 categorias
relevantes da PARTE-2 (workflow Orchestrator, memory persistente, slash
commands, audit trail de 8 artefatos, score gates do Reviewer, nomenclatura
de workspace, fast mode, resume de subagent, hierarquia de skills via
`paths:`, etc.) estão **AUSENTES ou apenas mencionadas en passant**.

### 0.3. Score global por categoria (1-10)

| # | Categoria | Score | Veredicto |
|---|-----------|:-----:|-----------|
| A | Filosofia multi-agent (template como fábrica) | 4/10 | PARCIAL |
| B | Especificação dos 4 agents (frontmatter, modelo, skills, hooks) | 2/10 | AUSENTE |
| C | Hooks/automação (3 camadas, `settings.json`) | 6/10 | PARCIAL |
| D | `.claude/rules/` (skills auto-injetadas) | 4/10 | PARCIAL |
| E | Agent memory persistente (`MEMORY.md`) | 1/10 | AUSENTE |
| F | Slash commands (`.claude/commands/`) | 0/10 | AUSENTE |
| G | Workflow Orchestrator (9 passos) | 1/10 | AUSENTE |
| H | Audit trail (8 documentos por task) | 2/10 | AUSENTE |
| I | Workspace (nomenclatura, regex, STATUS.md) | 2/10 | AUSENTE |
| J | Hierarquia CLAUDE.md (raiz vs `.claude/`) | 5/10 | PARCIAL |
| K | Score gates / decisão APPROVED/REJECTED | 2/10 | AUSENTE |
| L | Resume de subagent / loop de correção | 0/10 | AUSENTE |
| M | Skill `spec-to-yaml` (Parte 3 dentro da fábrica) | 0/10 | AUSENTE |
| N | Estado atual / gaps conhecidos / SaaS herda fábrica | 3/10 | PARCIAL |
| **MÉDIA PONDERADA** | | **2.6/10** | **REJEITAR** |

**Média geral (igual peso):** 4.6/10 → **RETRABALHO**.

### 0.4. Em uma frase

> O plano sabe que existe uma fábrica multi-agent, sabe que ela vem do
> Devari-Core, mas **não a opera, não a estende, e não a adapta** ao caso de
> uso V2 — onde Engine + Risk Gate + 58 testes adversariais (F6/F13)
> *exigem* multi-agent maduro com gates, memory, score, audit trail.

---

## 1. Índice da PARTE-2 extraído (referência da auditoria)

Linhas 1-2605 do `RELATORIO-DEVARI-PARTE-2-MULTI-AGENT.md`. Estrutura
hierárquica completa:

```
1.  SUMÁRIO EXECUTIVO ............................................. L35
    1.1. O que é a infraestrutura multi-agent .................... L37
    1.2. Por que isso é diferencial .............................. L67
    1.3. Por que é parte do template ............................. L91

2.  ANATOMIA DA PASTA `.claude/` .................................. L113
    2.1. Mapa completo ........................................... L115
    2.2. Função de cada subpasta ................................. L183

3.  OS 4 AGENTS ESPECIALIZADOS .................................... L206
    3.1. Strategist (`strategist.md`, 438L) ...................... L212
        3.1.1. Frontmatter (YAML) ................................ L216
        3.1.2. Responsabilidades ................................. L271
        3.1.3. Avaliação obrigatória dos 3 Pilares ............... L280
        3.1.4. Template do plan (8 seções) ....................... L305
        3.1.5. Quando criar ADR .................................. L318
    3.2. Implementer (`implementer.md`, 500L) .................... L333
        3.2.1. Frontmatter ...................................... L337
        3.2.2. Responsabilidades ................................. L389
        3.2.3. Os 3 Pilares no código ............................ L399
        3.2.4. Build dinâmico .................................... L446
        3.2.5. Erros comuns documentados ......................... L464
    3.3. Reviewer (`reviewer.md`, 392L) .......................... L480
        3.3.1. Frontmatter ...................................... L484
        3.3.2. Responsabilidades ................................. L524
        3.3.3. Validação dos 3 Pilares (bloqueante) .............. L533
        3.3.4. Score Guidelines .................................. L557
        3.3.5. Checklist 12 itens ................................ L571
    3.4. Documenter (`documenter.md`, 326L) ...................... L590
        3.4.1. Frontmatter ...................................... L594
        3.4.2. Responsabilidades ................................. L646
        3.4.3. Formato do commit ................................. L658
    3.5. Tabela comparativa dos 4 agents ......................... L686

4.  SKILLS/RULES INJETADAS AUTOMATICAMENTE ........................ L714
    4.1. O que são skills ....................................... L716
    4.2. Mapa completo .......................................... L738
    4.3. devari-3-pilares.md (557L) ............................. L751
    4.4. devari-polymorphic-engine.md (1.173L) .................. L789
    4.5. devari-backend-patterns.md (885L) ..................... L799
    4.6. devari-conventional-commits.md (257L) ................. L829
    4.7. devari-event-naming.md (304L) ......................... L850
    4.8. devari-jsdoc-templates.md (640L) ...................... L867
    4.9. devari-saas-generator.md (151L) ....................... L896
    4.10. devari-migration-protocol.md (40L) ................... L907
    4.11. Como rules são injetadas no system prompt ............ L920

5.  HOOKS AUTOMÁTICOS — 3 CAMADAS DE PROTEÇÃO ..................... L946
    5.1. Visão geral ............................................ L948
    5.2. Camada 1 — Preventiva ................................. L986
        5.2.1. block-destructive-commands.sh ..................... L988
        5.2.2. session-setup.sh ................................. L1045
    5.3. Camada 2 — Pós-Agent (Stop hooks) ..................... L1087
        5.3.1. validate-plan.sh (Strategist) ................... L1092
        5.3.2. validate-implementation.sh (Implementer) ........ L1126
        5.3.3. validate-review.sh (Reviewer) ................... L1170
        5.3.4. validate-documentation.sh (Documenter) .......... L1204
    5.4. Camada 3 — SubagentStop (gate de saída) ............... L1228
        5.4.1. validate-implementer-build.sh ................... L1234
        5.4.2. update-status-after-agent.sh .................... L1279
    5.5. PostToolUse (Lint inline) .............................. L1316
    5.6. settings.json — mapeamento completo ................... L1344

6.  AGENT MEMORY PERSISTENTE ..................................... L1390
    6.1. Como funciona .......................................... L1392
    6.2. Estrutura padrão ....................................... L1404
    6.3. Strategist memory (resumo) ............................. L1423
    6.4. Implementer memory (resumo) ........................... L1451
    6.5. Reviewer memory (resumo) ............................... L1487
    6.6. Documenter memory (resumo) ............................ L1522
    6.7. Memórias secundárias por arquivo ...................... L1541
    6.8. Crescimento orgânico ................................... L1581

7.  SLASH COMMANDS CUSTOM (`.claude/commands/`) .................. L1598
    7.1. O que são slash commands ............................... L1600
    7.2. /trabalhar (322L) ...................................... L1606
    7.3. Como invocar ........................................... L1646

8.  HIERARQUIA DE INSTRUÇÕES (CLAUDE.md raiz e .claude/) ......... L1654
    8.1. Arquivos carregados automaticamente ................... L1656
    8.2. CLAUDE.md raiz (~250L) ................................. L1677
    8.3. .claude/CLAUDE.md (~970L) .............................. L1700
    8.4. Hierarquia de prioridade ............................... L1734

9.  WORKFLOW ORCHESTRATOR (9 PASSOS) ............................. L1761
    9.1. Diagrama do fluxo ...................................... L1763
    9.2. Decision tree para delegar Strategist ................. L1877
    9.3. Resume de subagent (loop de correção) ................. L1892
    9.4. Fast Mode (tasks simples <2h) ......................... L1927
    9.5. Edge case: rejeição 3+ vezes ........................... L1948
    9.6. Auto-validação do Orchestrator ........................ L1965
    9.7. Proibições explícitas .................................. L1975

10. AUDIT TRAIL (8 DOCUMENTOS POR TASK) ......................... L1998
    10.1. Exemplo real (Task 1) ................................. L2028
    10.2. Por que 8 artefatos? .................................. L2047

11. WORKSPACE STRUCTURE ......................................... L2061
    11.1. Estrutura flat com prefixo de módulo ................. L2063
    11.2. Nomenclatura obrigatória .............................. L2081
    11.3. Hooks que validam nomenclatura ....................... L2122
    11.4. STATUS.md como timeline visual ....................... L2136
    11.5. workspace/messages/ — comunicação inter-agent ....... L2206

12. COMO TUDO ISSO GARANTE QUALIDADE ENTERPRISE ................ L2256
    12.1. Garantias mecânicas ................................... L2258
    12.2. Garantias por skills (3 Pilares aplicados) ........... L2290
    12.3. Garantias por memória ................................. L2308
    12.4. Garantias por audit trail ............................. L2325
    12.5. Resultado: qualidade que escala ...................... L2341

13. ESTADO ATUAL E GAPS CONHECIDOS ............................. L2368
    13.1. O que está funcionando ............................... L2370
    13.2. Gaps conhecidos ....................................... L2383 (10 gaps)
    13.3. Backlog técnico documentado .......................... L2431

14. APÊNDICE: CHEAT SHEET ...................................... L2441
```

**Total:** 14 capítulos / ~80 sub-seções / 2605 linhas.

---

## 2. Auditoria por categoria

A auditoria abaixo é organizada por **categoria temática** (não estritamente
por seção da PARTE-2), agrupando sub-seções relacionadas. Cada item segue o
formato:

> **Referência (PARTE-2 linha X-Y):** [síntese]
> **Cobertura no plano V2:** [arquivo:linha ou "AUSENTE"]
> **Veredicto:** ✅ COBERTO / ⚠️ PARCIAL / ❌ AUSENTE / 🟡 DIVERGÊNCIA
> **Análise:** [observação]
> **Score:** N/10
> **Ação corretiva:** [imperativa, concreta]

---

### CATEGORIA A — FILOSOFIA MULTI-AGENT (template como fábrica)

#### A.1 — A fábrica multi-agent é parte do template (PARTE-2 §1.3, L91-110)

**Referência (L91-110):** A infraestrutura `.claude/` faz parte do template
e é **clonada junto com o código**. SaaS gerados (Scrumban inclusive)
**herdam os mesmos 4 agents, hooks, memórias semente**. Decisão
estratégica explícita. Resultado: "stdlib de governança" embarcada.

**Cobertura no plano V2:**
- `00-PLANO-MESTRE.md:20` ("Toda regra do `.claude/rules/` do Devari-Core é
  puxada em cada PR")
- `01-FUNDACAO.md:65-92` (estrutura de pastas inclui `.claude/agents`,
  `.claude/rules`, `.claude/scripts`, `.claude/agent-memory`)
- `01-FUNDACAO.md:162` ("Copiar `.claude/` do Devari-Core para
  Scrumban-Backend-V2 preservando estrutura")

**Veredicto:** ⚠️ PARCIAL

**Análise:** O plano reconhece que a fábrica é herdada, mas trata como
"copiar pasta" — não declara explicitamente que (a) o V2 está sob o regime
de governança da fábrica, (b) toda task do V2 vai passar pelo workflow
Strategist→Implementer→Reviewer→Documenter, (c) os 4 gates (plan, impl,
review, doc) são obrigatórios em cada PR. ADR-200 ("Submissão ao template")
é mencionado em `01-FUNDACAO.md:171,206` mas seu conteúdo não é elaborado.

**Score:** 5/10

**Ação corretiva:** Redigir ADR-200 explicitando: "Toda task no V2 passa
por Strategist→Implementer→Reviewer→Documenter conforme PARTE-2 §9. Pular
qualquer gate exige ADR de exceção. Hook `validate-*.sh` é a fronteira
mecânica — não há override humano."

---

#### A.2 — Modo "assistente livre" vs Modo Devari (PARTE-2 §1.2, L67-90)

**Referência (L73-82):** Tabela "Modo assistente livre vs Modo Devari".
Inversão crítica: humano não valida output, hook valida. Humano não roda
build, hook valida. Humano não lembra de padrão, skill é injetada.

**Cobertura no plano V2:** AUSENTE como conceito explícito.

**Veredicto:** ❌ AUSENTE

**Análise:** O plano fala em "hooks" mas como **mecanismo isolado** (impedem
console.log, prisma direto, tabela nova), não como **inversão filosófica do
modo de operação**. Não há nenhum trecho equivalente a "validação humana é
substituída por gates mecânicos". Risco: equipe interpreta os 4 agents como
"opcionais" ou "para tasks complexas".

**Score:** 3/10

**Ação corretiva:** Acrescentar seção `00-PLANO-MESTRE.md §0.4` —
"Filosofia operacional: gates mecânicos, não disciplina humana" replicando
a tabela L73-82 da PARTE-2.

---

#### A.3 — 3 camadas de proteção + 4 níveis de injeção (PARTE-2 §1.2, L83-89)

**Referência:** "3 camadas de proteção (preventiva, pós-agent, gate de
saída) e 4 níveis de injeção de contexto (CLAUDE.md raiz → .claude/CLAUDE.md
→ agent frontmatter → skill via path matching → MEMORY.md)".

**Cobertura no plano V2:**
- `01-FUNDACAO.md:91,164-168` lista hooks por evento (PreToolUse,
  PostToolUse, SubagentStop, Stop)

**Veredicto:** ⚠️ PARCIAL

**Análise:** O plano enumera os hooks mas não articula que formam **3
camadas de defesa em profundidade**. Não distingue Preventiva (PreToolUse,
SessionStart) vs Pós-agent (Stop) vs Gate de saída (SubagentStop). Tampouco
descreve os **4 níveis de injeção de contexto**. Implementer pode quebrar
algo em cada camada se não entender por que cada uma existe.

**Score:** 4/10

**Ação corretiva:** Adicionar diagrama ASCII equivalente ao L953-973 da
PARTE-2 em `00-PLANO-MESTRE.md §0` (3 camadas: Preventiva → Pós-Agent →
Gate de Saída).

---

### CATEGORIA B — ESPECIFICAÇÃO DOS 4 AGENTS

#### B.1 — Strategist (PARTE-2 §3.1, L212-332)

**Referência:** 438 linhas de especificação. Frontmatter com `model:
inherit`, `permissionMode: acceptEdits`, `memory: project`,
`disallowedTools: [Bash, Task]` (puro planejador!), 4 skills injetadas,
hook Stop com timeout 60s. 8 seções obrigatórias no plan. Avaliação
obrigatória dos 3 Pilares.

**Cobertura no plano V2:**
- Menções genéricas a "Strategist" como ator no time (`00-PLANO-MESTRE.md:104,
  111, 396` etc.)
- `01-FUNDACAO.md:67` (apenas listagem de `strategist.md` na estrutura de
  arquivos)

**Veredicto:** ❌ AUSENTE

**Análise:** O plano **NUNCA** cita: que Strategist tem `disallowedTools:
[Bash, Task]`; que é puro planejador; que produz `plan-*.md` em formato
canônico de 8 seções; que tem que avaliar os 3 Pilares no plan; que cria
ADRs em decisões arquiteturais; que tem hook Stop bloqueante. Como o V2
tem 14 ADRs propostos (`00-PLANO-MESTRE.md §6`), o Strategist será
fortemente acionado — mas não há instrução de como ele deve operar.

**Score:** 2/10

**Ação corretiva:** Incluir em `01-FUNDACAO.md` (Fase 0) seção dedicada
"Como o Strategist trabalha no V2" — ou referenciar explicitamente
`Devari-Core/.claude/agents/strategist.md` linha-a-linha. Deixar claro:
todo plan do V2 segue formato canônico (8 seções) com avaliação dos 3
Pilares.

---

#### B.2 — Implementer (PARTE-2 §3.2, L333-479)

**Referência:** 500 linhas. `model: inherit`, pode `Bash` (precisa rodar
build), `disallowedTools: [Task]`, 4 skills (sem SaaS Generator, com
JSDoc), hook Stop timeout 180s (build + tsc + eslint). Build dinâmico
(`make build` se Makefile, senão `npm run build`). 8 anti-padrões
documentados em L468-478.

**Cobertura no plano V2:**
- Menções a "Implementer dedicado" em estimativas
  (`00-PLANO-MESTRE.md:111`)
- `01-FUNDACAO.md:165` (PostToolUse roda prettier+eslint+tsc)

**Veredicto:** ❌ AUSENTE

**Análise:** Plano não detalha como Implementer trabalha no V2: não diz
que produz `impl-*-task[N].md`, não explica build dinâmico, não lista os 8
anti-padrões que ele deve evitar (todos relevantíssimos para V2:
DatabaseService, parseInt, setHours, N+1, eventos antes de persistir,
prisma.dPedido direto = violação Pilar 1, controller duplicado = violação
Pilar 2, seed esquecido = violação Pilar 3). F6 (`OperacaoExecucaoClaude`)
e F13 (Automation Claude Code) são justamente os pontos onde o
Implementer **mais precisa** dessas guardrails — e o plano não as cita.

**Score:** 2/10

**Ação corretiva:** Em `02-DOMINIO-ENGINE.md §6.9` (tarefas detalhadas do
Implementer para `OperacaoExecucaoClaude`), explicitar: "Implementer
seguirá formato `impl-engine-operacao-execucao-claude-task[N].md`. Hook
`validate-implementation.sh` rodará após cada Stop. Anti-padrões a evitar:
[lista completa da PARTE-2 L468-478]."

---

#### B.3 — Reviewer (PARTE-2 §3.3, L480-589)

**Referência:** 392 linhas. **`model: sonnet` HARDCODED** (não inherit) —
decisão de custo. Apenas 1 skill (`devari-backend-patterns`) — não precisa
de JSDoc, Event Naming, SaaS Generator. Hook Stop timeout 30s. Score
guidelines 4 tiers (9-10/7-8/5-6/<5). **Coerência score↔decisão** (L569):
APPROVED requer score >=7.0. Validação dos 3 Pilares com greps específicos
(L538-554). Checklist 12 itens (5 críticos + 5 altos + 2 médios).

**Cobertura no plano V2:**
- Menções a "Reviewer" como ator (`00-PLANO-MESTRE.md:316-326`)
- `02-DOMINIO-ENGINE.md:409` ("Reviewer reject score <5")
- `02-DOMINIO-ENGINE.md:1356, 1383` ("Reviewer rejeita", "Reviewer confirma")

**Veredicto:** ⚠️ PARCIAL (apenas reconhece que existe, sem operacionalizar)

**Análise:** O plano usa "Reviewer" como **substantivo abstrato** ("Reviewer
rejeita") mas nunca explicita: (a) hook bloqueia review sem score numérico,
(b) APPROVED com score <7 é REJEITADO mecanicamente, (c) Reviewer roda 12
checks específicos, (d) modelo é Sonnet (não Opus). Para F6 e F13
(comandos críticos com Risk Gate), a regra "APPROVED ⇒ score>=7" é
fundamental — não pode ser implícita.

**Score:** 3/10

**Ação corretiva:** Em `00-PLANO-MESTRE.md §4` (Pilares e padrões),
adicionar sub-seção "Score gates do Reviewer V2" com:
1. Score range obrigatório `[0.0, 10.0]`
2. Threshold APPROVED: score >= 7.0 (regra mecânica)
3. Threshold NEEDS_CHANGES: 5.0-6.9
4. Threshold REJECT: < 5.0
5. Ações em rejeição: voltar para Implementer via `resume`, não criar novo
6. Ação em 3 rejeições: PAUSAR e consultar usuário

---

#### B.4 — Documenter (PARTE-2 §3.4, L590-685)

**Referência:** 326 linhas. **`model: haiku`** (mais barato, doc é
mecânica). Tools restritivos (Read/Write/Edit/Bash/Glob/Grep, sem Task,
WebFetch, WebSearch). 2 skills (JSDoc + Conventional Commits). 5 outputs
obrigatórios: JSDoc, ROADMAP, CHANGELOG, STATUS.md, git commit.

**Cobertura no plano V2:**
- `04-HARDENING-HANDOFF.md:567-781` (Fase 16 — Documentação) trata de
  documentação como FASE no projeto, não como ação do Documenter por task
- Menções a Conventional Commits (`04-HARDENING-HANDOFF.md:583, 728`)

**Veredicto:** 🟡 DIVERGÊNCIA grave

**Análise:** O plano mistura **dois conceitos diferentes**:
1. **Documenter agent** (PARTE-2): roda **após cada task** para gerar
   JSDoc/CHANGELOG/STATUS por task, em workflow contínuo.
2. **Fase 16 — Documentação** (`04-HARDENING-HANDOFF.md`): trata
   documentação como **fase final** do projeto.

Esses são conceitos **complementares mas diferentes** (Fase 16 é doc
arquitetural — Swagger, ADRs, RUNBOOK; Documenter é doc por task —
JSDoc, ROADMAP entry, commit). O plano só fala da Fase 16 e parece
**ignorar o Documenter por task**. Resultado: por 24 semanas de V2 não
haverá CHANGELOG nem ROADMAP atualizado — só na fase final.

**Score:** 2/10

**Ação corretiva:** Distinguir explicitamente em `00-PLANO-MESTRE.md`:
- **Documenter agent**: roda após cada Reviewer APPROVED, gera JSDoc +
  ROADMAP entry + CHANGELOG entry + STATUS.md entry + git commit.
- **Fase 16**: documentação **arquitetural** consolidada (RUNBOOK, ADRs
  finalizados, Swagger, MIGRATION-GUIDE, vídeo).

---

#### B.5 — Tabela comparativa dos 4 agents (PARTE-2 §3.5, L686-712)

**Referência:** Tabela canônica resumindo cor, modelo, tempo target, Bash,
Task, memory, skills, hook Stop, SubagentStop, output, localização, who
calls. **Decisão crítica** (L704-711): nenhum agent pode invocar outro
agent (`disallowedTools: [Task]`).

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Análise:** O plano não tem **nenhuma** tabela comparativa dos 4 agents.
A regra "nenhum agent pode invocar outro" é **fundamental** para evitar
ciclos — Reviewer NÃO pode chamar Implementer; quem orquestra é a
conversa principal. Sem essa regra explícita, a equipe pode tentar
"agent-zilla" (cadeia de chamadas).

**Score:** 1/10

**Ação corretiva:** Anexar tabela comparativa (formato L688-703) ao
`00-PLANO-MESTRE.md §0.5`. Incluir nota explícita: "Nenhum agent invoca
outro. Conversa principal é o único orquestrador."

---

### CATEGORIA C — HOOKS / AUTOMAÇÃO

#### C.1 — block-destructive-commands.sh (PARTE-2 §5.2.1, L988-1043)

**Referência:** 67 linhas, PreToolUse(Bash). Bloqueia: `--accept-data-loss`,
`--force-reset`, `prisma migrate reset`, `prisma db push`, `DROP TABLE/DB`,
`TRUNCATE`, `rm -rf` em paths críticos. Exit code 2.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:164` ("PreToolUse → block-destructive-commands.sh +
  enforce-canonical-tables.sh")
- `00-PLANO-MESTRE.md:376` (checklist Fase 0)

**Veredicto:** ✅ COBERTO

**Análise:** Hook é citado nominalmente, mantido como herança. O conteúdo
não é re-explicado, mas isso é aceitável (vem do template). Plano até
**estende** este hook adicionando `enforce-canonical-tables.sh` para
bloquear modelos novos no `schema.prisma`.

**Score:** 9/10

**Ação corretiva:** Nenhuma significativa.

---

#### C.2 — session-setup.sh (PARTE-2 §5.2.2, L1045-1086)

**Referência:** 110 linhas, SessionStart. 8 checks: Node, node_modules,
Prisma client, .env, branch, uncommitted, workspace/, skill spec-to-yaml.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:168` ("SessionStart → session-setup.sh adaptado (verifica
  docker-compose up, prisma generate, seed roda)")

**Veredicto:** ⚠️ PARCIAL

**Análise:** Plano menciona adaptação mas **não detalha quais checks**.
A versão V2 deveria também checar: docker-compose status (Postgres+Redis),
seed roda sem erro, contagem de DClasses ≥ 90 (canônico V2). Sem
especificação, equipe pode quebrar checks importantes herdados.

**Score:** 6/10

**Ação corretiva:** Em `01-FUNDACAO.md:168` substituir por: "Adaptar
session-setup.sh herdado: manter os 8 checks da PARTE-2 §5.2.2 + adicionar
checks V2 (a) docker-compose ps mostra postgres+redis up; (b)
`SELECT count(*) FROM DClasse` ≥ 90 (canônico V2); (c) seed roda sem
falhar."

---

#### C.3 — validate-plan.sh (PARTE-2 §5.3.1, L1092-1125)

**Referência:** 154 linhas, Stop hook do Strategist. 11 validações
incluindo nomenclatura via regex
`^plan-[a-z]+-[a-z0-9-]+-task[0-9]+\.md$`, plano ≥50 linhas, menções a
"alternativa", "risco", "fase", "estimativa". Lista whitelisted de módulos:
`engine|seeds|endpoints|core|auth|eventos|entidades|pagamento|common`.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:84,167,192` (citações nominais)

**Veredicto:** ⚠️ PARCIAL

**Análise:** Hook é mencionado mas **lista de módulos válidos** está
desatualizada para V2. O V2 não terá `pagamento` (financeiro), terá
`channels`, `mcp`, `webhooks`, `automation`, `agents`, `executions`,
`flow-metrics`. Sem ajustar o regex, **todo plano V2 com módulo
"channels" será rejeitado pelo hook**.

**Score:** 5/10

**Ação corretiva:** Adicionar tarefa explícita em F0 (`01-FUNDACAO.md`):
"Atualizar `validate-plan.sh:75` (regex de módulos) para incluir os
módulos V2: `engine|seeds|endpoints|core|auth|eventos|entidades|common|
channels|mcp|webhooks|automation|executions|flow-metrics|reports|email`.
Idem para `validate-implementation.sh` e `validate-review.sh`."

---

#### C.4 — validate-implementation.sh (PARTE-2 §5.3.2, L1126-1169)

**Referência:** 187 linhas, Stop hook do Implementer. 6 validações: build
(make/npm auto-detect), tsc 0 errors, impl notes existe + nomenclatura,
ESLint 0 errors. Build broken bloqueia retorno.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:84` (listagem)
- `01-FUNDACAO.md:632` (controller duplicado dispara hook)

**Veredicto:** ⚠️ PARCIAL

**Análise:** Hook citado mas o plano deveria explicitar: para o V2, este
hook é a **última linha de defesa antes do Reviewer** — se Implementer
afrouxar (e.g., escrever `// @ts-ignore`), o hook captura. Plano não
adverte explicitamente.

**Score:** 6/10

**Ação corretiva:** Em `02-DOMINIO-ENGINE.md §6.9` (Engine), adicionar
nota: "Stop hook `validate-implementation.sh` será executado ao fim de
cada Implementer. Build/tsc/eslint zero erros mandatório."

---

#### C.5 — validate-review.sh (PARTE-2 §5.3.3, L1170-1202)

**Referência:** 193 linhas. **Score numérico obrigatório** (regex
`[0-9]+\.?[0-9]*/10`). **Decisão obrigatória** (APPROVED|REJECTED|NEEDS_CHANGES).
**Coerência crítica**: APPROVED com score <7.0 = exit 2.

**Cobertura no plano V2:** AUSENTE como conceito. Apenas
`02-DOMINIO-ENGINE.md:409` ("Reviewer reject score <5").

**Veredicto:** ❌ AUSENTE

**Análise:** Score gates é uma das **garantias mecânicas** mais
importantes da fábrica. Para F13 (Automation Claude Code com Risk Gate),
um Reviewer que aprovasse com score 6 introduziria **risco de RCE em
produção**. Plano não cita o gate score>=7 para APPROVED.

**Score:** 2/10

**Ação corretiva:** Em `00-PLANO-MESTRE.md §0`, declarar: "Reviewer V2
opera sob a regra mecânica: APPROVED requer score numérico >= 7.0.
APPROVED com score < 7 é bloqueado por hook." Replicar em `02-DOMINIO-ENGINE.md
§6.12` e `03-INTEGRACOES.md §13` (DoD).

---

#### C.6 — validate-documentation.sh (PARTE-2 §5.3.4, L1204-1227)

**Referência:** 235 linhas. 6 validações: ROADMAP marcado com Task ✅,
CHANGELOG seção [Unreleased], STATUS.md entry COMPLETE, git commit segue
Conventional Commits regex `^[a-f0-9]+ (feat|fix|docs|...)\([a-z]+\):`,
JSDoc nos `.ts` modificados.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:86` (listagem nominal)

**Veredicto:** ❌ AUSENTE como semântica

**Análise:** Plano não cita que **toda task V2** vai exigir entry em
ROADMAP + CHANGELOG + STATUS + commit Conventional. Sem isso, hook
falhará repetidamente. Pior: F0 não cria os arquivos
`docs/ROADMAP.md` (cria mas vazio), `docs/CHANGELOG.md` (NÃO MENCIONADO!),
`workspace/STATUS.md` (NÃO MENCIONADO!) — gaps na própria F0.

**Score:** 2/10

**Ação corretiva:** Adicionar à `01-FUNDACAO.md §0.6 (estrutura de pastas)`:
- `docs/CHANGELOG.md` (Keep a Changelog format, seção [Unreleased] vazia)
- `workspace/STATUS.md` (template inicial conforme PARTE-2 L2141-2152)
- `workspace/{plans,implementations,reviews,messages}/` (pastas vazias)

---

#### C.7 — validate-implementer-build.sh (PARTE-2 §5.4.1, L1234-1278)

**Referência:** 83 linhas. SubagentStop double-check do build. Output
JSON estruturado para bloqueio.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:87,166` (listagem nominal)

**Veredicto:** ✅ COBERTO (parcial)

**Análise:** Hook é citado nominalmente; espera-se herança literal.

**Score:** 7/10

**Ação corretiva:** Nenhuma material. Confirmar herança no smoke test F0.

---

#### C.8 — update-status-after-agent.sh (PARTE-2 §5.4.2, L1279-1314)

**Referência:** 134 linhas. Roda para os 4 agents. Fingerprint dedup HTML
comment. Append entry em STATUS.md.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:88,166` (listagem nominal)

**Veredicto:** ⚠️ PARCIAL

**Análise:** Citado mas plano nunca cria `workspace/STATUS.md` na F0.
Hook roda mas escreve em arquivo inexistente — falhará silenciosamente
ou criará arquivo sem template.

**Score:** 5/10

**Ação corretiva:** Já incluído em C.6 — F0 deve criar
`workspace/STATUS.md` com template inicial.

---

#### C.9 — PostToolUse (Lint inline) (PARTE-2 §5.5, L1316-1343)

**Referência:** 3 hooks: Prettier (async), ESLint (sync, exit 2 com errors,
**`--max-warnings 0`** crítico), Typecheck (async).

**Cobertura no plano V2:**
- `01-FUNDACAO.md:165` ("PostToolUse (Edit/Write em *.ts) → prettier +
  eslint + tsc --noEmit")

**Veredicto:** ✅ COBERTO

**Análise:** Cobertura adequada.

**Score:** 8/10

**Ação corretiva:** Confirmar que `--max-warnings 0` é mantido (PARTE-2
L1328). Sem isso, perde-se rigor.

---

#### C.10 — settings.json mapeamento completo (PARTE-2 §5.6, L1344-1387)

**Referência:** 116 linhas. Mapeia todos eventos para hooks.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:91,163-168` (lista eventos)

**Veredicto:** ⚠️ PARCIAL

**Análise:** Plano lista eventos, mas não menciona que `settings.json`
existe e é o ponto único de configuração. Nem fala de
`settings.local.json` (env vars locais — referenciado para `/trabalhar`).

**Score:** 6/10

**Ação corretiva:** Adicionar a F0 tarefa: "Validar `.claude/settings.json`
herdado tem mapeamento idêntico ao Devari-Core (PARTE-2 L1349-1369). Criar
`.claude/settings.local.json` com placeholders das env vars (sem
secrets)."

---

### CATEGORIA D — `.claude/rules/` (SKILLS AUTO-INJETADAS)

#### D.1 — O que são skills + ativação dupla (PARTE-2 §4.1, L716-737)

**Referência:** Skills ativadas via (a) `skills:` no frontmatter (sempre)
ou (b) `paths:` no frontmatter (quando arquivo edit bate). Otimização de
contexto.

**Cobertura no plano V2:** AUSENTE.

**Veredicto:** ❌ AUSENTE

**Análise:** Plano cita skills nominalmente (`devari-3-pilares`,
`devari-event-naming` etc.) mas nunca explica o **mecanismo de
injeção dupla**. Implicação: equipe pode pensar que skills só são
carregadas via `skills:` e quebrar a otimização.

**Score:** 3/10

**Ação corretiva:** Adicionar nota em `00-PLANO-MESTRE.md §4`: "Skills
do Devari-Core são injetadas no system prompt do agent **automaticamente**
via dois mecanismos (PARTE-2 §4.1): (a) listadas em `skills:` no
frontmatter; (b) `paths:` glob bate com arquivo aberto. Equipe NÃO copia
conteúdo de skills em prompts — confiar na injeção."

---

#### D.2 — Mapa das 8 skills (PARTE-2 §4.2-4.10, L738-919)

**Referência:** 8 skills com tamanhos: backend-patterns (885L),
polymorphic-engine (1.173L), 3-pilares (557L), jsdoc-templates (640L),
conventional-commits (257L), event-naming (304L), saas-generator (151L),
migration-protocol (40L). Cada com função e gatilho de carregamento.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:71-79` (lista 8 arquivos)
- `00-PLANO-MESTRE.md:22` ("Toda regra do `.claude/rules/` é puxada")
- `00-PLANO-MESTRE.md:282-308` (matriz de 21 padrões)

**Veredicto:** ⚠️ PARCIAL

**Análise:** Plano lista os 8 arquivos, conhece os 21 padrões de
`backend-patterns`, mas (a) não cita os **paths gatilho** (qual skill
carrega quando), (b) não distingue skills de "rules listadas em
frontmatter" vs "rules path-triggered". Skill `devari-event-naming` é
crítica para F7 (eventos canônicos) — só carrega se arquivo aberto está em
`src/eventos/**/*.ts`. Sem essa estrutura V2, agent não tem o skill na
F7.

**Score:** 5/10

**Ação corretiva:** Em `00-PLANO-MESTRE.md §4`, adicionar tabela de
skills com colunas (skill, linhas, gatilho) — espelhando PARTE-2
§4.2 L740-749. Confirmar em F0 que `paths:` frontmatter é preservado
nas skills herdadas.

---

#### D.3 — `devari-saas-generator.md` no contexto V2 (PARTE-2 §4.9, L896-906)

**Referência:** 151 linhas. Resumo do pipeline SaaS Generator. Triggered
em `docs/01*/**`, `templates/**`, `*-spec.yaml`.

**Cobertura no plano V2:** AUSENTE explicitamente.

**Veredicto:** ❌ AUSENTE

**Análise:** O Scrumban-Backend-V2 é **piloto do SaaS Generator** (vide
`Devari-Core/.claude/CLAUDE.md` — "Piloto Scrumban"). Logo, o plano V2
deveria considerar: o V2 é gerado a partir de `scrumban-spec.yaml` ou é
escrito manualmente? Há plano para integrar com SaaS Generator? O plano
silencia totalmente.

**Score:** 2/10

**Ação corretiva:** ADR explicitando: "V2 é refundação manual (não via
SaaS Generator). SaaS Generator será usado em projetos futuros (Devari
post-V2). V2 vira referência de qualidade que SaaS Generator deve
emular."

---

#### D.4 — `devari-migration-protocol.md` (PARTE-2 §4.10, L907-919)

**Referência:** 40 linhas. Triggered em `prisma/migrations/**/*.sql`,
`prisma/schema.prisma`. Define checklist por agent (up+down+backup).

**Cobertura no plano V2:**
- `01-FUNDACAO.md:172` ("Criar `docs/MIGRATION-PROTOCOL.md` — cópia
  adaptada de devari-migration-protocol.md")

**Veredicto:** ✅ COBERTO

**Análise:** Cobertura adequada. Plano até cria cópia local em `docs/`.

**Score:** 8/10

**Ação corretiva:** Confirmar que cópia local não diverge da skill
canônica (drift risk).

---

### CATEGORIA E — AGENT MEMORY PERSISTENTE

#### E.1 — `memory: project` injeta MEMORY.md (PARTE-2 §6.1, L1392-1403)

**Referência:** Cada agent tem `memory: project` no frontmatter, instrui
SDK a injetar `agent-memory/<agent>/MEMORY.md` no system prompt. Memory
é específica por agent (não compartilhada).

**Cobertura no plano V2:**
- `01-FUNDACAO.md:90` ("agent-memory/{strategist,implementer,reviewer,
  documenter}/MEMORY.md")
- `01-FUNDACAO.md:162` ("(vazios)")

**Veredicto:** ❌ AUSENTE como mecanismo

**Análise:** Plano cria pastas vazias mas não explica:
1. Por que cada agent tem MEMORY.md próprio
2. Como memory é injetada no system prompt
3. Que cresce organicamente com cada task
4. Limite ~200 linhas (soft, manual)
5. Como migrar conteúdo antigo para memórias secundárias por arquivo

**Score:** 1/10

**Ação corretiva:** Adicionar em `01-FUNDACAO.md` Fase 0 sub-seção
"Bootstrap das memórias V2": criar 4 MEMORY.md com **conteúdo semente**
do V2 (não vazios) — incluir as REGRAS CRÍTICAS herdadas + ADRs vigentes
no V2. Modelo: replicar PARTE-2 L1409-1421.

---

#### E.2 — Memórias de cada agent (PARTE-2 §6.3-6.6, L1423-1540)

**Referência:** Strategist memory inclui ADRs vigentes, REGRA CRÍTICA
(SaaS = repo separado), patterns que funcionaram, riscos materializados.
Implementer memory inclui codepaths (PrismaService, Engine, EventProducer),
gotchas (ScheduleModule, DUserGroup vs DEntidade), schema real vs
conceitual. Reviewer memory inclui scores históricos. Documenter memory
inclui paths de docs.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Análise:** O V2 herda fábrica do Devari-Core mas as **memórias semente**
para o V2 não estão definidas. O Implementer V2 precisa **saber desde já**:
que `OperacaoExecucaoClaude` herda de `OperacaoPedido`, que DVFS scripts
chave 3/4/5/6/7 são pre-calc/calc/pos-calc/pre-grav/pos-grav, que F6 é
o ponto onde Pilar 1 é ATIVADO pela primeira vez (não em F1-F5 nem
F7+). O Reviewer V2 precisa **saber desde já**: critérios específicos do
V2 (e.g., "Engine só em DPedido idClasse=-300"), threshold de score
APPROVED >=7.

**Score:** 1/10

**Ação corretiva:** Em F0 (`01-FUNDACAO.md`), criar tarefa "Bootstrap
de memórias V2":
- `agent-memory/strategist/MEMORY.md`: ADRs V2 (ADR-V2-001 a ADR-V2-014),
  17 tabelas canônicas, 14 ADRs propostos, F6 é coração técnico
- `agent-memory/implementer/MEMORY.md`: codepaths V2 (engine/, dvfs/,
  17 módulos), gotchas (jsonb_set para DEV-N, command injection F13)
- `agent-memory/reviewer/MEMORY.md`: critérios V2 (Engine só em DPedido,
  Risk Gate fail-safe, 58 testes adversariais)
- `agent-memory/documenter/MEMORY.md`: paths V2 (`docs/ROADMAP.md`,
  `docs/CHANGELOG.md`, `workspace/STATUS.md`, `docs/decisions/`)

---

#### E.3 — Memórias secundárias por arquivo (PARTE-2 §6.7, L1541-1580)

**Referência:** Formato `name: <id>; description: <regra>; type: feedback`.
Estrutura "Why: ... How to apply: ...". Captura razão da regra (incidente
concreto) + aplicação mecânica.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Análise:** Não cita nem a convenção. V2 terá pelo menos 14 ADRs +
incidentes (ex: bug `s.id vs s.chave` em `02-DOMINIO-ENGINE.md:1349`).
Cada um deveria virar memory file por arquivo.

**Score:** 1/10

**Ação corretiva:** Adicionar em F0: "Estabelecer convenção de memórias
secundárias V2 conforme PARTE-2 §6.7. Toda lição aprendida durante o V2
gera arquivo separado em `agent-memory/<agent>/<topic>.md` com YAML
frontmatter (name, description, type) + Why + How to apply."

---

#### E.4 — Crescimento orgânico (PARTE-2 §6.8, L1581-1595)

**Referência:** Memory cresce: 50→100→200 linhas (limite). Quando estoura,
mover conteúdo antigo para arquivos secundários.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Score:** 1/10

**Ação corretiva:** Documentar regra "Max 200 linhas por MEMORY.md" como
norma V2 + processo de migração.

---

### CATEGORIA F — SLASH COMMANDS

#### F.1 — `.claude/commands/` (PARTE-2 §7, L1598-1651)

**Referência:** Slash commands `/<nome>` digitados na conversa principal.
Cada um é Markdown em `.claude/commands/<nome>.md`. Único comando atual:
`/trabalhar` (322 linhas) — orquestra uso do Scrumban como gestor de
tarefas via API REST.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE TOTAL

**Análise:** Plano não cria pasta `.claude/commands/`, não cita
`/trabalhar` (irônico — V2 É O SCRUMBAN!), não considera comandos V2.

**Score:** 0/10

**Ação corretiva:** Em F0 (`01-FUNDACAO.md`), adicionar:
1. Criar pasta `.claude/commands/`
2. **Manter `/trabalhar`** herdado do Devari-Core (V2 será o servidor que
   `/trabalhar` consome — coerência fundamental)
3. Atualizar `commands/trabalhar.md` para apontar para a API V2 (mesmos
   endpoints; auth via API Key V2)
4. Avaliar criar comandos V2-específicos (e.g., `/checagem-pilares`,
   `/risk-gate-test`)

---

### CATEGORIA G — WORKFLOW ORCHESTRATOR (9 PASSOS)

#### G.1 — Diagrama do fluxo (PARTE-2 §9.1, L1763-1875)

**Referência:** Fluxo de 9 passos: Usuário → Análise Orchestrator → (decision
tree complexidade) → Strategist (15-30min) → Implementer (2-4h, com
agentId salvo) → Reviewer (30-40min, gate) → REJECTED/NEEDS_CHANGES (resume
Implementer) ou APPROVED → Documenter (20-30min, gate) → Report final.
Tempo total: 3-4h por feature.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Análise:** O plano fala em 24 semanas, mas **nunca explica como o tempo
se decompõe por task** (3-4h × N tasks = 24 sem). Não explica que cada
task tem 4 gates. Não explica que workflow é série (não paralelo) por
task. F6 e F13 (críticas) precisam desse rigor.

**Score:** 1/10

**Ação corretiva:** Adicionar em `00-PLANO-MESTRE.md §0.7` o diagrama
ASCII completo (PARTE-2 L1765-1875) ou link/referência. Toda fase do V2
opera sob esse fluxo de 9 passos.

---

#### G.2 — Decision tree para delegar Strategist (PARTE-2 §9.2, L1877-1890)

**Referência:** Tabela de fatores: 3 Pilares envolvidos OBRIGATÓRIO,
Migrations OBRIGATÓRIO, >3 files, >2h, multiple approaches. "Na dúvida,
Strategist!"

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Score:** 1/10

**Ação corretiva:** Replicar tabela em `00-PLANO-MESTRE.md`. Para o V2, a
maioria das fases (F1, F2, F3, F5, F6, F7, F13, F15) é **obrigatoriamente
Strategist** (3 Pilares + migrations + multi-file). Só F0, F4, F11, F16
poderiam usar Fast Mode.

---

#### G.3 — Resume de subagent (PARTE-2 §9.3, L1892-1926)

**Referência:** Quando Reviewer rejeita, NÃO criar novo Implementer —
usar `resume: <agentId>`. Continua de onde parou, mantém contexto mental.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Análise:** Mecanismo crítico para custo (não desperdiça 15-20min de
re-leitura) e qualidade (não reintroduz bugs corrigidos). Sem documentar,
equipe pode criar novo Implementer cada rejeição = 4× custo + risco de
regressão.

**Score:** 0/10

**Ação corretiva:** Adicionar em `00-PLANO-MESTRE.md §0.7`: "Após
NEEDS_CHANGES/REJECTED, Implementer é resumido (não recriado). Salvar
`agentId` retornado pela primeira `Task({subagent_type: implementer})`."

---

#### G.4 — Fast Mode (PARTE-2 §9.4, L1927-1946)

**Referência:** Tasks <2h podem pular Strategist. Reviewer + Documenter
SEMPRE rodam (gates obrigatórios). NUNCA Fast Mode em Engine, Seed,
Migrations, Services com lógica complexa, Controllers múltiplos.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Score:** 1/10

**Ação corretiva:** Especificar para o V2 quais fases podem Fast Mode (F0
setup, F4 email simples, F16 doc) e quais NUNCA (F1, F2, F3, F5, F6, F7,
F13, F15). Lista em `00-PLANO-MESTRE.md`.

---

#### G.5 — Edge case rejeição 3+ vezes (PARTE-2 §9.5, L1948-1963)

**Referência:** Após 3ª rejeição: PAUSAR, consultar usuário com 4 opções
(simplificar, relaxar padrões, revisar manualmente, novo Implementer).

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Análise:** Crítico em F6/F13. Se Risk Gate é rejeitado 3x, equipe deve
parar, não forçar.

**Score:** 0/10

**Ação corretiva:** Replicar regra. Adicionar a riscos R1 e R2 do
`00-PLANO-MESTRE.md §5` a mitigação "se 3 rejeições consecutivas, escalar
ao CTO".

---

#### G.6 — Auto-validação do Orchestrator (PARTE-2 §9.6, L1965-1973)

**Referência:** Checklist de 5 pontos pós-delegação.

**Cobertura no plano V2:** AUSENTE

**Score:** 1/10

**Ação corretiva:** Replicar em CLAUDE.md raiz do V2.

---

#### G.7 — Proibições explícitas (PARTE-2 §9.7, L1975-1994)

**Referência:** "NUNCA Bash para criar artefatos workspace; NUNCA pular
Reviewer/Documenter; NUNCA fazer trabalho dos agents; NUNCA agents se
chamam."

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Score:** 0/10

**Ação corretiva:** Replicar como regras-CEO em
`00-PLANO-MESTRE.md §0.8`.

---

### CATEGORIA H — AUDIT TRAIL (8 DOCUMENTOS POR TASK)

#### H.1 — Os 8 artefatos (PARTE-2 §10, L1998-2058)

**Referência:** Cada task gera 8 artefatos: plan-*.md, impl-*.md, review-*.md,
msg-*.md (opcional), ROADMAP, CHANGELOG, STATUS.md, git commit. **Compliance
e auditabilidade** — cliente recebe SaaS gerado e pode auditar gates.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:99-100` (cria `docs/ROADMAP.md` + `docs/DECISIONS.md`)
- `04-HARDENING-HANDOFF.md:613,728` (CHANGELOG.md mencionado para Fase 16)

**Veredicto:** ⚠️ PARCIAL

**Análise:** Plano cria 2 dos 8 artefatos como pasta (ROADMAP, DECISIONS),
**não cria CHANGELOG nem STATUS.md em F0**, **não cria pasta workspace/**,
**não cita formato `plan-*.md` ou `impl-*.md`**. Pior: trata CHANGELOG
como artefato de Fase 16 (final) em vez de incremental por task.

**Score:** 2/10

**Ação corretiva:** Em F0 (`01-FUNDACAO.md §0.6`), criar:
- `docs/CHANGELOG.md` (Keep a Changelog format, [Unreleased] vazio)
- `workspace/{plans,implementations,reviews,messages}/` (pastas vazias)
- `workspace/STATUS.md` (template inicial)
- README em cada uma referenciando PARTE-2 §10-11.

---

### CATEGORIA I — WORKSPACE STRUCTURE

#### I.1 — Estrutura flat com prefixo de módulo (PARTE-2 §11.1, L2063-2079)

**Referência:** Flat (não nested). Pastas: plans, implementations, reviews,
messages, STATUS.md.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Score:** 1/10

**Ação corretiva:** Já incluído em H.1 acima.

---

#### I.2 — Nomenclatura obrigatória `[tipo]-[modulo]-[descricao]-task[N].md` (PARTE-2 §11.2, L2081-2120)

**Referência:** Lowercase, hífens, prefixo módulo, sufixo task[N].
Whitelist de módulos: engine|seeds|endpoints|core|auth|eventos|entidades|
pagamento|common.

**Cobertura no plano V2:** AUSENTE.

**Veredicto:** ❌ AUSENTE

**Análise:** Equipe não sabe que arquivos workspace seguem regex específica.
V2 também precisa **estender o whitelist** para módulos novos (channels,
mcp, webhooks, automation, executions, flow-metrics, etc.).

**Score:** 2/10

**Ação corretiva:** Em `00-PLANO-MESTRE.md §0`, adicionar tabela
"Nomenclatura workspace V2" com módulos válidos (lista expandida) +
exemplos corretos/proibidos (formato L2105-2120).

---

#### I.3 — Hooks que validam nomenclatura (PARTE-2 §11.3, L2122-2134)

**Referência:** Regex idêntica em 3 hooks (validate-plan, validate-impl,
validate-review).

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Score:** 2/10

**Ação corretiva:** Em F0, validar que regex foi atualizada para módulos
V2 (já ação corretiva C.3).

---

#### I.4 — STATUS.md como timeline visual (PARTE-2 §11.4, L2136-2204)

**Referência:** Template inicial + formato de entry com Quality Score,
Agents Performance table, Pilares aplicados, Deliverables, Metrics.

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Score:** 2/10

**Ação corretiva:** Em F0, criar `workspace/STATUS.md` com template inicial
exato da PARTE-2 L2141-2152.

---

#### I.5 — workspace/messages/ (PARTE-2 §11.5, L2206-2253)

**Referência:** Padrão `msg-[from]-to-[to]-task[N].md`. Para handoffs
volumosos.

**Cobertura no plano V2:** AUSENTE

**Score:** 1/10

**Ação corretiva:** Mencionar em `00-PLANO-MESTRE.md §0` como
recurso disponível.

---

### CATEGORIA J — HIERARQUIA DE INSTRUÇÕES (CLAUDE.md raiz vs `.claude/`)

#### J.1 — Arquivos auto-carregados em ordem (PARTE-2 §8.1, L1656-1675)

**Referência:** Ordem: ~/.claude/CLAUDE.md → repo/CLAUDE.md → repo/.claude/CLAUDE.md
→ agent system prompt → skills → MEMORY.md.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:138` (cria `CLAUDE.md` raiz)

**Veredicto:** ⚠️ PARCIAL

**Análise:** Plano cria CLAUDE.md raiz mas **não cria `.claude/CLAUDE.md`**.
PARTE-2 §8.3 explica que `.claude/CLAUDE.md` (970L) contém os 3 Pilares
detalhados — copiar como semente.

**Score:** 5/10

**Ação corretiva:** Adicionar em F0 tarefa: "Criar
`Scrumban-Backend-V2/.claude/CLAUDE.md` com (a) referência ao
`Devari-Core/.claude/CLAUDE.md` (3 Pilares), (b) sub-seção V2-específica
com decisões locais (ADR-V2-001..014), (c) memória de fase atual."

---

#### J.2 — CLAUDE.md raiz (~250L) (PARTE-2 §8.2, L1677-1698)

**Referência:** 9 seções: Idioma, Contexto, 3 Pilares, Segurança,
Padrões, **Sistema Multi-Agent (Workflow Orchestrator de 9 passos —
coração)**, Workspace, Documentação, Regras críticas.

**Cobertura no plano V2:**
- `01-FUNDACAO.md:170` ("Criar `CLAUDE.md` raiz declarando: (a) submissão
  ao template; (b) 17 tabelas; (c) eliminações vs legado")

**Veredicto:** ⚠️ PARCIAL

**Análise:** O plano lista 5 seções mas **omite as principais** (Workflow
Orchestrator de 9 passos! O coração do CLAUDE.md raiz!). Sem isso, a
fábrica V2 não opera — agents não sabem como ser invocados.

**Score:** 4/10

**Ação corretiva:** Substituir tarefa em `01-FUNDACAO.md:170` por:
"Criar CLAUDE.md raiz V2 espelhando estrutura do Devari-Core/CLAUDE.md
(PARTE-2 §8.2): seções 1-9. **Seção 6 (Sistema Multi-Agent — Workflow
Orchestrator) é OBRIGATÓRIA** — replicar os 9 passos da PARTE-2 §9."

---

#### J.3 — `.claude/CLAUDE.md` (~970L) (PARTE-2 §8.3, L1700-1732)

**Referência:** Contém os 3 Pilares completos (~578L). Estrutural ("o
sistema é").

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Score:** 4/10

**Ação corretiva:** Já em J.1 acima.

---

#### J.4 — Hierarquia de prioridade em conflito (PARTE-2 §8.4, L1734-1758)

**Referência:** Ordem: system-reminder > CLAUDE.md raiz > .claude/CLAUDE.md
> agent system prompt > skills > MEMORY.md > docs/.

**Cobertura no plano V2:** AUSENTE

**Score:** 3/10

**Ação corretiva:** Replicar em `00-PLANO-MESTRE.md §0` ou no novo
CLAUDE.md raiz V2.

---

### CATEGORIA K — SCORE GATES E DECISÕES

(Já coberto principalmente em B.3 e C.5. Resumindo aqui para registro.)

#### K.1 — Score numérico obrigatório com regex (PARTE-2 §3.3.4, L557-569)

**Score:** 2/10 (cobertura V2)

**Ação corretiva:** Já em B.3.

---

#### K.2 — Decisão APPROVED/REJECTED/NEEDS_CHANGES (PARTE-2 §3.3.2, L529)

**Cobertura no plano V2:**
- `02-DOMINIO-ENGINE.md:409,1356,1383` (Reviewer rejeita, Reviewer confirma)

**Veredicto:** ⚠️ PARCIAL — usa decisão como conceito; não como output
mecânico de hook.

**Score:** 3/10

**Ação corretiva:** Em todo DoD V2, adicionar item: "Reviewer emite
decisão APPROVED/NEEDS_CHANGES/REJECTED com score numérico obrigatório."

---

### CATEGORIA L — RESUME / LOOP DE CORREÇÃO

(Já coberto em G.3.)

---

### CATEGORIA M — SaaS GENERATOR DENTRO DA FÁBRICA

#### M.1 — Skill `spec-to-yaml` invocada na fábrica (PARTE-2 §1.3 Connection, L105-110)

**Referência:** "A skill spec-to-yaml roda DENTRO desta fábrica multi-agent
— é invocada na conversa principal e seu output é processado pela mesma
cadeia Strategist → Implementer → Reviewer → Documenter."

**Cobertura no plano V2:** AUSENTE

**Veredicto:** ❌ AUSENTE

**Análise:** Já discutido em D.3.

**Score:** 0/10

**Ação corretiva:** Já em D.3 (ADR explicitando V2 manual vs SaaS Gen).

---

### CATEGORIA N — ESTADO ATUAL E GAPS

#### N.1 — Gaps conhecidos (PARTE-2 §13.2, L2383-2429)

**Referência:** 10 gaps explícitos: duplicação CLAUDE.md, Reviewer sem
skill migrations no frontmatter, Documenter falha sem CHANGELOG, agent
memory sem rotação automática, /trabalhar exige settings.local.json,
hooks são bash (não Windows nativo), spec-to-yaml em skills/ (não rules/),
sem testes dos hooks, Reviewer model: sonnet hardcoded, TASK_NUM=UNKNOWN.

**Cobertura no plano V2:**
- `00-PLANO-MESTRE.md §5` (10 riscos) — mas **riscos do V2**, não da
  fábrica.

**Veredicto:** ⚠️ PARCIAL

**Análise:** Plano tem riscos próprios mas **não herda os 10 gaps da
fábrica**. Para V2 ser robusto, precisa:
- Decidir como mitigar gap #2 (Reviewer sem skill migrations) — F15
  (migration) é ALTA criticidade
- Decidir gap #3 (Documenter sem CHANGELOG) — já incluído em H.1
- Decidir gap #6 (hooks bash) — V2 está em macOS/Linux, ok
- Decidir gap #8 (sem testes de hooks) — F14 hardening deveria incluir

**Score:** 3/10

**Ação corretiva:** Em F0 (`01-FUNDACAO.md`), adicionar tarefa:
"Auditar os 10 gaps da PARTE-2 §13.2 e decidir mitigação V2-específica
para cada (ADR ou aceite documentado)."

---

#### N.2 — Resultado: qualidade que escala (PARTE-2 §12.5, L2341-2364)

**Referência:** Propagação para SaaS gerados garante qualidade em todos
os filhos. V2 herda mesmos 4 agents, 8 hooks, 7 skills.

**Cobertura no plano V2:**
- `00-PLANO-MESTRE.md:20` (regras puxadas em todo PR)

**Veredicto:** ⚠️ PARCIAL

**Score:** 5/10

**Ação corretiva:** Não material adicional.

---

## 3. Top 10 Lacunas / Divergências

Ordenadas por **impacto + criticidade × probabilidade de causar dano em
F6 ou F13** (fases mais arriscadas do V2):

### #1 — Workflow Orchestrator (9 passos) AUSENTE
- **Impacto:** CRÍTICO. V2 tem 17 fases e 14 ADRs — sem workflow definido,
  cada implementação será improviso.
- **PARTE-2 §9** (143 linhas).
- **Plano V2:** zero menção dos 9 passos, decision tree, resume, fast
  mode, edge case 3 rejeições.
- **Ação:** REDIGIR `00-PLANO-MESTRE.md §0.7` antes de F0.

### #2 — Score gate APPROVED >= 7 NÃO documentado
- **Impacto:** CRÍTICO em F13 (Risk Gate, comandos podendo causar RCE).
  Reviewer aprovar com score 6 = liberar comando perigoso.
- **PARTE-2 §3.3.4 L557-569.**
- **Plano V2:** apenas "Reviewer rejeita score <5" sem threshold
  explícito.
- **Ação:** Adicionar regra mecânica em todo DoD F6/F13.

### #3 — Agent memory NÃO bootstrapped
- **Impacto:** ALTO. Em F6 (Engine), Implementer chega "do zero" sem
  saber que `OperacaoExecucaoClaude` herda de `OperacaoPedido` e que
  DVFS scripts têm chaves específicas.
- **PARTE-2 §6 toda (211 linhas).**
- **Plano V2:** "MEMORY.md (vazios)" — `01-FUNDACAO.md:90`.
- **Ação:** Bootstrap de 4 MEMORY.md com conteúdo semente V2 em F0.

### #4 — Slash commands AUSENTE (irônico — V2 É O SCRUMBAN)
- **Impacto:** ALTO. `/trabalhar` é o command que conecta a fábrica
  Devari-Core ao Scrumban como gestor de tarefas. V2 É o servidor que
  `/trabalhar` consome — não citar é incoerência arquitetural.
- **PARTE-2 §7 (53 linhas).**
- **Plano V2:** zero menção.
- **Ação:** F0 cria `.claude/commands/trabalhar.md` apontando para a
  API V2.

### #5 — Audit trail (8 artefatos) NÃO definido
- **Impacto:** ALTO em F15 (migration de produção) e F17 (cutover).
  Compliance exige rastreabilidade. Sem 8 artefatos por task, auditoria
  pós-launch é impossível.
- **PARTE-2 §10 (62 linhas) + §11 (193 linhas).**
- **Plano V2:** apenas ROADMAP + DECISIONS criados em F0.
- **Ação:** Em F0, criar pasta `workspace/{plans,impl,review,msg}/` +
  `STATUS.md` template + `CHANGELOG.md` template.

### #6 — Especificação dos 4 agents (frontmatter, modelo, hooks) AUSENTE
- **Impacto:** ALTO. Sem saber que Reviewer é Sonnet (não Opus), que
  Documenter é Haiku, que Strategist NÃO pode usar Bash, equipe pode
  configurar errado e quebrar gates.
- **PARTE-2 §3 toda (508 linhas).**
- **Plano V2:** apenas listagem nominal dos 4 arquivos.
- **Ação:** Tabela comparativa em `00-PLANO-MESTRE.md §0.5`.

### #7 — Documenter por task vs Fase 16 (DIVERGÊNCIA)
- **Impacto:** ALTO. Plano trata documentação como "fase 16" (final),
  ignorando o Documenter por task que mantém ROADMAP/CHANGELOG/STATUS
  vivos durante 24 semanas.
- **PARTE-2 §3.4 + §10.**
- **Plano V2:** `04-HARDENING-HANDOFF.md` Fase 16 trata doc como artefato
  consolidado final.
- **Ação:** Distinguir Documenter por task (gates) vs Fase 16
  (consolidação arquitetural).

### #8 — Nomenclatura workspace e regex de validação NÃO atualizada
- **Impacto:** MÉDIO. Hook `validate-plan.sh:75` regex de módulos é
  `engine|seeds|endpoints|core|auth|eventos|entidades|pagamento|common`
  — não inclui módulos V2 (channels, mcp, webhooks, automation,
  executions, flow-metrics). Todo plano V2 com esses módulos será
  rejeitado pelo hook.
- **PARTE-2 §11.2-11.3.**
- **Ação:** Em F0, atualizar regex em validate-plan/impl/review.

### #9 — `.claude/CLAUDE.md` NÃO criado
- **Impacto:** MÉDIO. Sem o documento estrutural (~970L com 3 Pilares
  detalhados), agents não recebem injeção completa de contexto.
- **PARTE-2 §8.3.**
- **Ação:** Em F0, criar `.claude/CLAUDE.md` V2.

### #10 — Skills `paths:` (path-triggered) NÃO conhecida
- **Impacto:** MÉDIO. `devari-event-naming.md` só carrega quando
  `src/eventos/**/*.ts` aberto. F7 (eventos canônicos) precisa estar
  em `src/eventos/` — não em outro path — ou skill não carrega.
- **PARTE-2 §4.1.**
- **Ação:** Documentar mecanismo em `00-PLANO-MESTRE.md §4`. Confirmar
  que F7 cria `src/eventos/`.

---

## 4. Veredicto Final

### 4.1. Decisão

> **🟡 RETRABALHO OBRIGATÓRIO — Score 4.6/10**

O plano tem qualidade arquitetural sólida no domínio backend (3 Pilares,
17 tabelas, DClasses, Engine F6, Risk Gate F13) mas é **gravemente
deficiente** na infraestrutura multi-agent que **executa** essas decisões.

A maratona V2 (24 semanas, 17 fases, 14 ADRs, RCE crítico em F13) **não
pode operar** com este nível de cobertura de fábrica. Em particular,
F6 (Engine) e F13 (Automation) — as fases de maior risco — precisam de
gates score, audit trail e memory bootstrapped que estão ausentes.

### 4.2. Não é REJEITAR — porque o plano não é pior do que a média

Os 4 estrategistas do plano produziram trabalho denso (5832 linhas) e,
**dentro do escopo de domínio backend**, estão alinhados com PARTE-1.
O problema é que **PARTE-2 (multi-agent) ficou de fora do briefing**.
Isso é corrigível em ~5-7 dias de retrabalho focado.

### 4.3. Não é APROVAR — porque os gaps são bloqueantes

Sem workflow Orchestrator, sem audit trail, sem score gate, sem agent
memory, a fábrica não opera. Pular esses gaps em troca de "começar logo"
materializa exatamente o risco anti-padrão que o V2 jura combater
(`00-PLANO-MESTRE.md §0.1.5`: "atalho técnico é dívida acumulada que
mata o produto").

### 4.4. Estimativa de retrabalho

| Tarefa | Estimativa |
|--------|:----------:|
| Adicionar `00-PLANO-MESTRE.md §0.4-0.8` (filosofia, agents tabela, workflow 9 passos, score gates, proibições) | 4h |
| Atualizar `01-FUNDACAO.md` Fase 0 com (a) bootstrap memórias V2, (b) workspace/+ CHANGELOG + STATUS.md, (c) regex módulos V2, (d) `.claude/commands/trabalhar.md`, (e) `.claude/CLAUDE.md` V2 | 6h |
| Adicionar nota em `02-DOMINIO-ENGINE.md` F6 sobre validate-implementation, score>=7, anti-padrões | 2h |
| Adicionar nota em `03-INTEGRACOES.md` F13 sobre rejeição 3+ vezes, audit, score gate | 2h |
| Distinguir Documenter por task vs Fase 16 em `04-HARDENING-HANDOFF.md` | 2h |
| ADR-V2 sobre relação V2 ↔ SaaS Generator | 2h |
| ADR-V2 sobre auditoria dos 10 gaps da PARTE-2 §13.2 | 2h |
| Revisão consolidada (peer-review pelos 4 estrategistas) | 4h |
| **TOTAL** | **24h (3 dias úteis)** |

### 4.5. Condição para APROVAR

O plano será aprovado quando:

1. ✅ Score consolidado por categoria média ≥ 7.0 (atualmente 4.6)
2. ✅ Todas as 10 lacunas top do §3 resolvidas com texto específico no
   plano
3. ✅ `00-PLANO-MESTRE.md` tem seção dedicada à fábrica multi-agent
   (§0.4-0.8 sugeridos)
4. ✅ F0 cria todos os artefatos `.claude/` + `workspace/` + `docs/`
   conforme PARTE-2 §10-11
5. ✅ ADRs V2 sobre relação com SaaS Generator e gaps da fábrica
   herdados
6. ✅ Memórias semente V2 escritas (não vazias)

---

## 5. Plano de Remediação (priorizado)

### 5.1. Bloco SEM-RETARDO (D+0 a D+3)

Tarefas que devem ser feitas **ANTES de iniciar F0**:

1. **[CEO + 4 estrategistas]** Sessão 2h de re-briefing: cada estrategista
   lê PARTE-2 do RELATORIO-DEVARI e produz mini-checklist de quais
   sub-seções afetam seu sub-plano.

2. **[Estrategista A — Fundação]** Atualizar `01-FUNDACAO.md` Fase 0:
   - Adicionar tarefas para criar `workspace/`, `STATUS.md`,
     `CHANGELOG.md`, `.claude/CLAUDE.md`, `.claude/commands/trabalhar.md`
   - Bootstrap de 4 MEMORY.md V2 (conteúdo semente, não vazios)
   - Atualizar regex de módulos em validate-plan/impl/review
   - Documentar 8 anti-padrões da PARTE-2 L468-478 nos critérios de
     review

3. **[CEO]** Aprovar/rever CLAUDE.md raiz V2 com 9 seções (PARTE-2
   §8.2). Em particular, **Seção 6 (Workflow Orchestrator)** deve ser
   replicada literalmente da PARTE-2 §9.

4. **[Estrategista A]** Criar tabela comparativa dos 4 agents
   (`00-PLANO-MESTRE.md §0.5`).

### 5.2. Bloco D+3 a D+7

5. **[Estrategista B]** Em F6 (`02-DOMINIO-ENGINE.md`), explicitar:
   - Strategist produz `plan-engine-operacao-execucao-claude-task[N].md`
   - Implementer produz `impl-engine-operacao-execucao-claude-task[N].md`
   - Score gate APPROVED >= 7.0 mecânico

6. **[Estrategista C]** Em F13 (`03-INTEGRACOES.md`):
   - Score gate (idem)
   - Edge case "rejeição 3+ vezes" → escalar ao CTO
   - 58 testes adversariais antes do código (já estava — manter)

7. **[Estrategista D]** Em `04-HARDENING-HANDOFF.md`, distinguir:
   - "Documenter agent por task" (gates F0-F17)
   - "Fase 16 — Documentação consolidada" (handoff arquitetural)

8. **[Strategist Devari-Core]** Redigir 2 ADRs:
   - ADR-V2-015: V2 é refundação manual (não via SaaS Generator)
   - ADR-V2-016: V2 herda 10 gaps da PARTE-2 §13.2 — mitigação por gap

### 5.3. Bloco D+7 a D+10

9. **[Reviewer + CEO]** Re-auditar plano consolidado conforme estes 6
   critérios da §4.5. Score consolidado ≥ 7.0 = APROVAR.

10. **[Documenter Devari-Core]** Atualizar
    `Devari-Core/.claude/agent-memory/strategist/MEMORY.md` com lição:
    "Próximo SaaS gerado: estrategistas devem ler PARTE-2 ANTES de
    escrever sub-planos."

---

**Fim da auditoria.**

> Família depende. Disciplina antes de velocidade. A fábrica vem antes
> do produto.

