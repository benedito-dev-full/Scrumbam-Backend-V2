# ADR-V2-017 — V2 como piloto-vivo do Devari-Core: feedback loop V2 → Generator

**Status:** Proposto
**Data:** 2026-05-08
**Decisores:** CEO + Strategist (Bloco 4 da remediação da auditoria)
**Tags:** #strategy #saas-generator #template-evolution #v2-pilot #devari-core-v3
**Substitui:** —
**Substituído por:** —
**Relaciona-se com:** ADR-V2-001 (17 tabelas inviolável), ADR-V2-005 (Pilar 1 ativado via OperacaoExecucaoClaude), ADR-101 (SaaS Generator no Devari-Core), `docs/spec/README.md` (fontes primárias)

---

## 1. Contexto e Problema

A auditoria consolidada (`docs/auditoria/00-AUDITORIA-CONSOLIDADA.md` v1.1) recalibrou o score do Reviewer-3 de 3.5/10 para 6.5/10 após diretriz do CEO em 08/05/2026, que estabeleceu três premissas:

1. O escopo do V2 é o **Scrumban-hoje** (`SYSTEM-OVERVIEW.md`, 128 endpoints, intentions V3, Channels, MCP, Automation), não o `scrumban-spec.yaml` antigo.
2. A regra do V2 é o **Devari-Core canônico** (3 PARTES + 8 rules) aplicado sobre esse escopo.
3. O Generator atual (PARTE-3) **não cobre** o escopo moderno: Channels com voz Groq, MCP Server (5 tools), Automation Claude Code (Risk Gate + Approval Flow + PR auto-open) e Webhooks HMAC outbound não estão no pipeline `spec-to-yaml + multi-agent` hoje.

**Resultado da recalibração:** das 7 lacunas originais do R3, 6 caíram (eram artefatos do escopo antigo). Sobrou **uma única lacuna crítica:**

> **O V2 não tem mecanismo formal de retroalimentar o Devari-Core.** Sem isso, todo o aprendizado da maratona V2 (24 semanas, 17 fases, 5.428 linhas de plano, 14 ADRs prévios) se perde quando o V2 entrar em produção. O CEO perde a chance de capitalizar o V2 como piloto-vivo que evolui o template para gerar SaaS modernos em 1–3 dias (a promessa do ADR-101).

**Risco se nada for feito:** o V2 vira "mais um SaaS", o Generator continua emperrado no escopo de 2026-02 (CRUD de Tasks/Projects), e a próxima maratona (Sermus, próximo cliente, etc.) repete o mesmo retrabalho de 24 semanas — destruindo a tese estratégica do Devari-Core.

---

## 2. Alternativas Consideradas

### Opção 1 — Continuar sem feedback loop (status quo da v1.0 do plano)

**Como funciona:** V2 é tratado como projeto isolado. Ao final, equipe agradece, faz retro e fecha. Conhecimento fica no Scrumban-Backend-V2 e morre lá.

**Pros:**
- Zero overhead operacional durante a maratona.
- Equipe foca 100% em entregar o produto.

**Contras:**
- Aprendizado de 24 semanas evapora.
- Generator continua incapaz de gerar Channels/MCP/Automation.
- Próximo cliente que pedir SaaS de gestão ágil paga novamente o custo de inventar tudo do zero.
- ADR-101 (SaaS Generator com meta 10–12 SaaS/ano) fica em risco — não há evidência de que o Generator escale para escopos modernos.
- Risco mais grave: o Devari-Core como tese fica para trás. Concorrentes (Frappe, Salesforce, Retool) evoluem; nós ficamos parados.

**Veredito:** ❌ Inaceitável estrategicamente.

### Opção 2 — Documentar lições no fim do V2 (retro pontual única)

**Como funciona:** No mês 1 pós-launch (Fase 17), equipe faz uma retro de 1 semana e produz um único documento `lessons-to-template.md` listando o que aprendeu.

**Pros:**
- Algum aprendizado é preservado.
- Baixo overhead — 1 semana de trabalho dedicado.

**Contras:**
- Lições registradas com 6+ meses de defasagem perdem detalhe técnico.
- Sem coleta contínua, esquecemos os "porquês" das decisões intermediárias.
- Sem métricas reais (% reuse, tempo de geração vs prometido), retro vira opinião.
- Sem PRs concretos no Devari-Core, "lições" continuam só em texto — Generator não evolui de fato.

**Veredito:** ⚠️ Insuficiente. Captura sintomas mas não cura a causa.

### Opção 3 — Feedback loop estruturado e contínuo (esta proposta)

**Como funciona:** A cada PR do V2 que implementa funcionalidade FORA do template canônico atual, abre-se uma issue no Devari-Core marcada `evolution-from-v2` contendo:
- (a) o que o V2 implementou,
- (b) por que cabe nas 17 tabelas + 3 Pilares,
- (c) sugestão concreta — novo módulo opt-in / nova classe fixa / nova rule / novo template.

Ao longo das 17 fases, métricas são coletadas (% boilerplate canônico vs específico, tempo real vs prometido pelo Generator, capacidades modernas que viram módulos opt-in propostos). No fim, consolida-se em `docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md` com proposta executiva de evolução do template.

**Pros:**
- Aprendizado capturado com timestamp e detalhe técnico **enquanto a decisão está fresca**.
- Métricas objetivas alimentam evolução baseada em dados reais (não opinião).
- ADR-101 ganha evidência empírica: "X% do V2 é genérico, gera-se em Y dias com o Generator-v3 evoluído".
- Linguagem **construtiva**: "V2 está expandindo o template", não "V2 tem exceção do template".
- Próximo cliente herda evolução automaticamente.

**Contras:**
- Overhead recorrente (~10 min por PR fora-do-pipeline para abrir issue).
- Exige disciplina do Implementer + Documenter (curadoria das issues).
- Requer Reviewer atento ao critério "cabe no Generator atual?" durante revisões.

**Veredito:** ✅ Adotada. Custo operacional pequeno comparado ao retorno estratégico.

### Opção 4 — Reduzir escopo do V2 para caber no Generator atual

**Como funciona:** V2 entrega só CRUD de Tasks/Projects/Sprints (o que o Generator cobre hoje). Channels, MCP, Automation viram backlog pós-launch.

**Pros:**
- V2 vira piloto fiel do Generator, valida ADR-101 em ~3 semanas.

**Contras:**
- **Diretriz CEO veta explicitamente:** "Escopo do V2 = Scrumban HOJE. Não reduzir produto."
- Família Scrumban depende do produto completo. Cortar Channels/MCP/Automation = cortar o que o produto se tornou.

**Veredito:** ❌ Rejeitado por diretriz CEO.

---

## 3. Decisão

**Adotamos a Opção 3 — Feedback loop estruturado e contínuo.**

V2 é tratado oficialmente como **piloto-vivo do Devari-Core**. Cada implementação fora do template canônico atual é documentada como **proposta de evolução do template**, não como exceção do V2.

### 3.1. Mecânica operacional

**Por PR (Implementer + Documenter):**

1. Implementer marca o PR com label `evolution-candidate` quando a feature for fora do escopo coberto por `devari-saas-generator.md` (Channels, MCP, Automation, Voice, Webhooks outbound, PR auto-open, Risk Gate, Approval Flow, etc.).
2. Documenter, ao gerar o commit (Conventional Commits), inclui no body:
   ```
   - Generator-impact: [resumo em 1 linha]
   - Evolution-issue: <link para issue no Devari-Core>
   ```
3. Documenter abre issue no repositório Devari-Core com label `evolution-from-v2` contendo:
   - **Título:** `[V2] <feature> — proposta de evolução do template`
   - **Corpo:**
     - **O que o V2 implementou:** descrição técnica + arquivos relevantes
     - **Por que cabe no Devari-Core:** mapeamento para as 17 tabelas + 3 Pilares (ZERO tabela nova é regra)
     - **Sugestão de evolução:** opções (a) novo módulo opt-in, (b) nova classe fixa no `templates/classes-base-template.ts`, (c) nova rule em `.claude/rules/`, (d) novo template (`channels.yaml`, `mcp.yaml`, `automation.yaml`)
     - **Métricas associadas:** tempo de implementação, linhas geradas vs customizadas, ADRs envolvidos

**Por fase (Strategist + Reviewer):**

4. Reviewer da fase soma as métricas e atualiza `docs/lessons/metrics-fase-NN.md`:
   - % linhas TypeScript boilerplate canônico (idêntico a outros SaaS)
   - % linhas específicas do Scrumban (custom)
   - DClasses candidatas a virar fixas no template
   - Tempo gasto na fase vs estimativa do Generator atual

**Final do V2 (Mês 1 pós-launch — Fase 17):**

5. Strategist + Tech Lead consolidam tudo em `docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md`:
   - Sumário executivo das propostas
   - Top 5 capacidades modernas que viram **módulos opt-in** propostos
   - Top 10 DClasses candidatas a virar **fixas** no template-base
   - Sugestões de **novas rules** em `.claude/rules/`
   - **5–10 PRs concretos** já planejados para abrir no Devari-Core

### 3.2. Métricas a coletar

Durante a maratona V2, as seguintes métricas são coletadas e arquivadas em `docs/lessons/`:

| Métrica | Como coletar | Onde reportar |
|---------|--------------|---------------|
| % linhas boilerplate canônico vs específico | `cloc` + diff vs Devari-Core base por módulo | `metrics-fase-NN.md` (cada fase) |
| Tempo real por fase vs estimativa do Generator atual (1–3 dias geração + 1–3 dias customização do ADR-101) | Cronometragem de fase + retro semanal | `metrics-fase-NN.md` |
| Lista de capacidades modernas (Channels, MCP, Automation, etc.) → módulo opt-in proposto | Issues `evolution-from-v2` agregadas | `EVOLUCAO-DEVARI-CORE-V3.md` |
| DClasses do V2 que poderiam ser fixas no template | Strategist da F1 + ajustes em sub-fases | `EVOLUCAO-DEVARI-CORE-V3.md` |
| Bugs/atritos do template descobertos no V2 (ex.: bug `s.id` vs `s.chave` em DVFS, citado na auditoria PARTE-1) | Reviewer registra durante revisões | Issues no Devari-Core (label `bug-found-by-v2`) |

### 3.3. Entregáveis

- **Por PR fora-do-pipeline:** 1 issue `evolution-from-v2` no Devari-Core (overhead ~10 min).
- **Por fase:** 1 arquivo `metrics-fase-NN.md` em `docs/lessons/` (overhead ~30 min na retro de fase).
- **Final do V2 (Fase 17, mês 1 pós-launch):** `docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md` consolidado + 5–10 PRs reais abertos no Devari-Core.

---

## 4. Consequências

### 4.1. Positivas

- **ADR-101 ganha evidência empírica:** o V2 valida (ou refuta com dados) a tese de SaaS Generator. Métricas reais alimentam decisões futuras.
- **Devari-Core v3.0 nasce com bagagem:** Channels, MCP, Automation deixam de ser custom de cliente e viram módulos opt-in reusáveis em 10+ SaaS futuros.
- **Equipe constrói memória institucional:** issues `evolution-from-v2` ficam públicas e rastreáveis no longo prazo.
- **Próximo cliente herda automaticamente:** se Sermus pedir Channels, eles já estarão no template (ou pelo menos com PR proposto).
- **Linguagem construtiva interna:** "estamos expandindo o template" é narrativa positiva. Engenheiros se sentem contribuindo, não burlando.
- **Custo de implementação adicional pequeno:** ~10 min por PR + 30 min por fase + 1 semana no fim. Em troca de evolução estratégica do produto-mãe.

### 4.2. Negativas

- **Overhead recorrente:** disciplina exigida do Implementer e Documenter durante 24 semanas. Risco de afrouxar nas fases finais (mitigação: hook valida label `evolution-candidate` em PRs que tocam módulos sinalizados como modernos).
- **Curadoria de issues exige esforço:** Tech Lead precisa revisar issues `evolution-from-v2` periodicamente para evitar virar dump-zone (mitigação: review trimestral, fechar/agrupar duplicatas).
- **Risco de "design por comitê":** se cada issue virar discussão filosófica, evolução do Devari-Core trava. Mitigação: critério claro para issue (cabe nas 17 tabelas? sugestão concreta?), Tech Lead tem veto.

### 4.3. Riscos e mitigações

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| Equipe esquece de abrir issue por PR | 🟡 Médio | Hook PreCommit valida presença de `Generator-impact` no body do commit em PRs com label `evolution-candidate` |
| Métricas viram exercício burocrático sem qualidade | 🟡 Médio | Reviewer de fase rejeita `metrics-fase-NN.md` raso. Strategist faz spot-check |
| `EVOLUCAO-DEVARI-CORE-V3.md` final não vira ação real | 🔴 Alto | DoD da Fase 17 exige **5–10 PRs reais abertos** no Devari-Core. Sem PRs, fase não fecha |
| Devari-Core não absorve as evoluções | 🟡 Médio | Cadência trimestral de "absorção" no Devari-Core: Tech Lead aloca 1 semana/trimestre para reviewar e mergear PRs `evolution-from-v2` |

---

## 5. Operacionalização — onde isso aparece nos artefatos do V2

| Artefato | Mudança necessária |
|----------|--------------------|
| `00-PLANO-MESTRE.md` §0.2 | Atualizar para incluir: "V2 também é piloto que documenta gap entre Scrumban-hoje e Generator-atual, gerando proposta consolidada de evolução do Devari-Core" |
| `00-PLANO-MESTRE.md` §6 (tabela ADRs) | Adicionar ADR-V2-017 |
| `00-PLANO-MESTRE.md` §7 (novo) | Detalhar V2↔Generator feedback loop (princípios, métricas, mecânica, entregável final) |
| `00-PLANO-MESTRE.md` §8 (checklist início) | Incluir "F0 cria `docs/lessons/`" |
| `04-HARDENING-HANDOFF.md` Fase 14 | Métricas Generator coletadas durante hardening |
| `04-HARDENING-HANDOFF.md` Fase 17 | Sessão de retro com Devari-Core no mês 1 + abertura de 5–10 PRs |
| `docs/lessons/` (novo diretório) | Criado em F0; populado a cada fase; consolidado em F17 |

---

## 6. Aprovação

- **Proposto por:** Strategist (Bloco 4 da remediação da auditoria)
- **Validado por:** [pendente — CEO + Tech Lead]
- **Implementação inicia em:** F0 (criação do diretório `docs/lessons/` + template `metrics-fase-template.md`)

---

**Fim do ADR-V2-017.**
