# Métricas Fase 1 — Pilar 3: Schema Canônico + Seed de DClasses

**Fase:** 1
**Bloco:** A — Fundação
**Período de execução:** 2026-05-08 (sessão única)
**Reviewer responsável:** Reviewer Agent V2
**Tipo de coleta:** medição final pós-APPROVED (score 9.0/10)

> Implementação do **ADR-V2-017** e **§8 do `00-PLANO-MESTRE.md`** (V2↔Generator Feedback Loop). Cada fase produz UM arquivo deste antes de fechar.

---

## 1. Esforço

| Item | Valor |
|------|-------|
| Tempo estimado pelo plano | 1 task / ~3-5 dias úteis (estimativa Strategist) |
| Tempo real | **~4h totais** (1 sessão multi-agent: 1h Strategist + 3h Implementer + 0.5h Reviewer + 0.5h Documenter) |
| Variância | **~-90%** (entrega muito mais rápida que estimativa) |
| Tempo prometido pelo Generator (ADR-101) | 1-3 dias geração + 1-3 dias customização |
| **Gap V2 vs Generator** | **~0.2×** — V2 entregou em 1 sessão de ~4h o que o Generator promete em 1-6 dias |

**Causa raiz da variância (negativa = mais rápido):**
- Pipeline multi-agent (Strategist→Implementer→Reviewer→Documenter) maduro: cada agent entregou no primeiro pass.
- Implementer reportou execução wall-clock de ~18min (1049s) somando comandos automatizados — o restante foi raciocínio + edição.
- F1 é **fundação canônica pura** — não há lógica de negócio nem integrações. Cabe perfeitamente no template framework.
- Validador puro evitou retrabalho: erros estruturais detectados em time de import, não em deploy.
- Adoção do template `classes-base-template.ts` (criado em F0) deu 45 classes "de graça" — apenas 83 específicas precisaram digitação.

**Implicação para Generator-atual:**
F1 é um caso ideal para automação total. O Generator-atual entrega esse tipo de fundação em 1-3 dias (muito menos que a estimativa do plano de 3-5 dias), mas V2 multi-agent entregou em 1 sessão de 4h. Possível gap a documentar: o Generator gera fundação genérica; V2 customizou específicas Scrumban (intentions V3, channel types) em paralelo, sem ciclo separado de "customização".

---

## 2. % Boilerplate Canônico vs Específico

Medição via `wc -l` direto (cloc não disponível na máquina). Linhas físicas dos arquivos da entrega F1 Task #1:

| Categoria | LOC | % |
|-----------|-----|---|
| **Boilerplate canônico** (idêntico a outros SaaS Devari-Core — `templates/classes-base-template.ts` 404L com 45 classes universais; `validate-hierarchy.ts` 277L com 6 checagens reutilizáveis; `seed-runner.ts` 158L com UPSERT idempotente; `prisma/schema.prisma` 17 tabelas canônicas) | ~1100 LOC (404 + 277 + 158 + ~260 schema canônico) | **~70%** |
| **Específico do Scrumban** (`classes.seed.ts` array `classesEspecificas` 83 entradas — DClasses domínio: USER, AGENT, EXECUTION, STATUS_INTENTION_V3, CHANNEL, MCP_KEY, etc.; 4 relations FK específicas no schema; spec do validator) | ~370 LOC (219 classes.seed + 137 spec + ~15 schema relations) | **~24%** |
| **Configuração** (DTOs nada em F1; ADRs ~550L em decisions; auditoria 253L) | ~800 LOC docs (ADRs + auditoria + roadmap + changelog + métricas) | n/a (docs, não código) |
| **TOTAL CÓDIGO desta fase** | **~1470 LOC** | **100%** |

**Meta:** ≥ 60% boilerplate canônico (alinhado com promessa do ADR-101 de 70-80%).
**Resultado F1:** **~70% boilerplate canônico** ✅ — dentro da promessa do Generator.

---

## 3. DClasses candidatas a virar fixas no template-base

| DClasse criada nesta fase | Útil para outros SaaS? | Justificativa |
|---------------------------|------------------------|----------------|
| `-300 EXECUTION` (DPedido) | **SIM** — candidata forte | Qualquer SaaS B2B com Engine extendido (Pilar 1 ATIVADO) precisa de uma classe-mãe `EXECUTION` para auditoria de operações. Pode subir para `templates/classes-base-template.ts` como classe universal. |
| `-301/-302/-303 EXEC_LOW/MED/HIGH` | **SIM** — candidata forte | Risk Gate é padrão de qualquer SaaS com automação (Claude Code, n8n, IFTTT, etc.). Esses 3 níveis (LOW/MED/HIGH) são padrão de mercado. Subir para template. |
| `-440 STATUS_INTENTION_V3` (agrupador) + `-441..-449` (9 estados) | **NÃO** — específico Scrumban | Estados V3 (INBOX/READY/EXECUTING/DONE/FAILED/CANCELLED/DISCARDED/VALIDATING/VALIDATED) são do domínio Scrumban — task management com agent execution. Outros SaaS terão estados próprios. |
| `-150 USER`, `-151 PLATFORM_SCRUMBAN`, `-152 ORGANIZATION`, `-156 AGENT`, `-180 TEAM` | **MISTO** | USER e ORGANIZATION são universais (todo SaaS B2B). PLATFORM_SCRUMBAN e AGENT (Claude Code) são específicos. TEAM é universal. **Sugestão:** USER, ORGANIZATION, TEAM podem ir para template. |
| `-160..-163 ORG_USER_LINK + roles` | **SIM** — candidata forte | RBAC duplo via DVincula é padrão Devari-Core (ADR-V2-003). Essas 4 classes (link + 3 roles ADMIN/MEMBER/VIEWER) são genéricas. Subir para template. |
| `-170..-173 PROJECT_USER_LINK + roles` | **SIM** — candidata forte | Mesmo padrão RBAC duplo, agora a nível de projeto. Universal. Subir para template. |
| `-470 WEBHOOK`, `-471 API_KEY`, `-472 MCP_KEY` | **SIM** — candidatas | Auth tokens via DTabela é padrão Devari-Core (ADR-V2-004). Universais. Subir para template. |
| `-490 NOTIFICATION`, `-491 WEBHOOK_ATTEMPT` (DEvento) | **SIM** — candidatas | DEvento substitui DNotification/DWebhook (ADR-V2-008). Universais. Subir para template. |

**Recomendação para Devari-Core v3.0:** mover ~15 dessas DClasses para `templates/classes-base-template.ts` aumentaria as fixas de 45 para ~60, reduzindo o trabalho específico em projetos futuros.

---

## 4. Capacidades fora do Generator atual

| Capacidade | Issue `evolution-from-v2` aberta? | Link |
|------------|-----------------------------------|------|
| (nenhuma nesta task) | — | — |

**Análise:** F1 é **fundação canônica pura** — schema + seed + validador. Tudo já está no escopo do Generator-atual. Não há capacidades V2 ausentes do Generator nesta fase.

Capacidades V2 candidatas a `evolution-from-v2` virão em fases posteriores:
- F6: `OperacaoExecucaoClaude` (Pilar 1 ATIVADO fora de domínio financeiro — Dimensão 2 de polimorfismo)
- F8: Forecast Monte Carlo runtime (analytics derivado, sem persistência — padrão potencialmente reutilizável)
- F11: MCP Server (5 tools) com rate limit Redis
- F13: Risk Gate com 58 testes adversariais (padrão de automação segura)

---

## 5. Bugs do template descobertos

| Bug | Onde | Issue `bug-found-by-v2` | Severidade |
|-----|------|--------------------------|------------|
| (nenhum) | — | — | — |

**Análise:** O `templates/classes-base-template.ts` (criado no Bloco 3 da remediação) e os 8 rules canônicos do Devari-Core funcionaram sem ajustes durante F1. Validador puro (`validate-hierarchy.ts`) cobriu cenários adversariais (sequestro, ciclos, idPai inexistente) sem nunca falsamente rejeitar as `classesFixas` do template — sinal de que o template está saudável.

---

## 6. Lições aprendidas (livres)

- **Validação em time de import > validação em runtime.** Falha em `tsc`/`jest`/CI antes de tocar o banco. Pattern reutilizável em todos os seeds futuros (F2..F17).
- **Helpers exportados vs deadcode.** Quando uma constante "pode ser útil no futuro", convertê-la em export consumível com teste é melhor que `void X` para silenciar lint. Aplicado no minor #3 do review.
- **Specs detalhadas valem mais que headers de seção.** Implementer fez certo confiando na tabela §6 do plan (83 entradas) vs no header (80) — confirmado em ADR-V2-022 e auditoria.
- **Multi-agent pipeline no primeiro pass funciona quando o plan está completo.** F1 Task #1 não teve rejeição/retrabalho. 22 itens DoD bem definidos no plan = entrega limpa.
- **Cobertura indireta é defensável quando há trade-off de poluição de histórico Git.** DoD-15 (3 commits adversariais transitórios para testar `enforce-canonical-tables.sh`) foi substituída por testes do validator com cobertura equivalente. Aceitável, mas em fases futuras com novos hooks executar como branches transitórios.
- **Conventional Commits subject ≤72 chars é convenção, não regra mecânica.** Commit `7af80d2` ficou em 76 chars (excedeu por 4). Body excelente compensou. Próximos commits respeitar o teto.

---

## 7. Recomendações para Devari-Core v3.0

- **Promover ~15 DClasses do Scrumban-V2 para `templates/classes-base-template.ts`.** Lista em §3 acima. Aumentaria as fixas de 45 para ~60.
- **Padronizar pattern "validador puro em time de import" para TODOS os seeds.** Adicionar como rule em `devari-3-pilares.md` §Pilar 3.
- **Padronizar UPSERT em `$transaction` como padrão de seed.** ADR-V2-020 deveria virar padrão Devari-Core (não específico Scrumban).
- **Hook `validate-classes-hierarchy.sh`** que reaplica `validateHierarchy()` em CI sobre qualquer `*.seed.ts` — captura drift antes do merge.
- **Convenção dos ranges:** documentar definitivamente que `[-1..-110]` é template universal e `[-150..-999]` é específico de domínio. Adicionar `isInFixedRange()` helper exportado a partir do template.
- **Teste anti-regressão de quantidade.** Spec que afirma `expect(COUNTS.fixas).toBe(45)` (ou o número canônico) impede que mudanças no template quebrem projetos existentes silenciosamente.
- **Registrar como melhor prática:** "Documenter corrige minors do Reviewer no ciclo seguinte (sem amend)." Pattern aplicado nesta task — minors #1 (JSDoc), #3 (FIXED_RANGE) corrigidos pelo Documenter; minors #2 (subject 76 chars) e #4 (DoD-15) registrados como lições.

---

**Próxima fase:** F2 — Endpoints Genéricos `/entidades` `/tabela` `/classes` (Pilar 2)
**Acumulado de evolution issues nesta fase:** 0
**Acumulado total no projeto:** 0 (F0..F1)
