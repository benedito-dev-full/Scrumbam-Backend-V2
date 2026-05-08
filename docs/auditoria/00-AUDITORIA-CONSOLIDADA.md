# Auditoria CONSOLIDADA — Plano V2 vs Bíblia Devari-Core (3 partes)

**Versão:** 1.1 (recalibrada por diretriz CEO 2026-05-08)
**Data:** 2026-05-08
**Autor:** Conversa Principal (síntese de 3 Reviewers paralelos + diretriz CEO)
**Audiência:** CEO + Tech Lead
**Status:** ⚠️ **APROVAR COM RETRABALHO OBRIGATÓRIO** (~6-8 dias úteis de ajustes ANTES de iniciar F0)

---

## ⚡ ADENDO V1.1 — RECALIBRAÇÃO POR DIRETRIZ CEO (2026-05-08)

Após a entrega da v1.0 desta auditoria, o CEO emitiu diretriz que recalibra a interpretação dos 3 reviewers:

1. **Escopo do V2 = Scrumban HOJE** (`Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md`), não o `scrumban-spec.yaml` antigo. O YAML é ideia inicial; o produto evoluiu. Mantemos o escopo amplo (128 endpoints, V3 intentions, MCP, Telegram, Automation, Webhooks).
2. **Regra do V2 = Devari-Core canônico** (3 PARTES + rules) aplicado SOBRE o escopo de hoje. Não reduzimos o produto; consertamos a arquitetura.
3. **Plano V2 precisa ser retrabalhado** para ficar condizente com os Pilares + 3 PARTES — preservando o que faz, corrigindo como faz.

**Impacto nas auditorias:**

| Auditoria | Score original | Score recalibrado | Por quê |
|-----------|----------------|--------------------|---------|
| R1 — Backend Core | 7.4 | **7.4** (sustentado) | Arquitetura cagada é exatamente o que estamos consertando — todas as lacunas seguem válidas |
| R2 — Multi-Agent | 4.6 | **4.6** (sustentado) | Workflow operacional é canônico, independe de escopo do produto |
| R3 — SaaS Generator | 3.5 | **6.5** (recalibrado) | "V2 não cabe no YAML antigo" deixa de ser falha do V2 e vira input para evoluir o Generator. Único problema real: feedback loop V2→Generator ausente |
| **Consolidado** | 5.2 | **6.2** (recalibrado) | Retrabalho continua obrigatório, mas escopo NÃO reduz |

**Caminho aprovado:** ÚNICO — V2 mantém escopo Scrumban-hoje, arquitetura passa para canônico Devari-Core, gaps com Generator atual viram ADRs de evolução do template.

**Tempo de retrabalho do plano:** ~6-8 dias úteis (era 10-11), ~5 dias com paralelismo. Reduziu porque:
- Bloco 0 (decisão CEO) = resolvido agora.
- Bloco 4 muda de "reduzir escopo ao YAML" para "documentar feedback loop" — bem mais simples.

**Lacunas que CAEM (descartadas pela diretriz):**
- ~~"V2 não cabe no `scrumban-spec.yaml`"~~ — YAML é arquivo histórico, não fonte primária.
- ~~"6 conflitos de DClasse já resolvidos no YAML"~~ — eram resolvidos para escopo antigo. As resoluções do `00-PLANO-MESTRE §3.3` valem para o escopo atual.
- ~~"Tempo 9-12x acima do prometido pelo Generator"~~ — Generator atual não cobre o escopo moderno; gap vira lição, não restrição.

**Lacunas que SUSTENTAM (continuam críticas):**
- Workflow Orchestrator (9 passos) ausente (R2)
- Score gate APPROVED ≥ 7.0 não documentado (R2)
- Agent memory não bootstrapped (R2)
- Bug latente `s.id` vs `s.chave` em DVFS (R1)
- `templates/classes-base-template.ts` declarado inexistente (R1)
- Convenção `?classe=NOME` vs `?idClasse=N` divergente (R1)
- Slash commands ausentes (R2)
- **Feedback loop V2→Generator ausente** (R3 recalibrado — única lacuna remanescente desta auditoria)

A v1.0 abaixo permanece como registro do estado inicial. As decisões abaixo seguem com os ajustes desta seção de recalibração.

---

**Documentos-fonte:**
- `AUDITORIA-PARTE-1-vs-PLANO-V2.md` (1522 linhas — Backend Core)
- `AUDITORIA-PARTE-2-vs-PLANO-V2.md` (1578 linhas — Multi-Agent System)
- `AUDITORIA-PARTE-3-vs-PLANO-V2.md` (966 linhas — SaaS Generator)
- **Total auditado:** 4.066 linhas de revisão sobre 5.832 linhas de plano

---

## 0. VEREDITO PARA QUEM TEM 60 SEGUNDOS

**O plano V2 cobre razoavelmente a arquitetura canônica (PARTE-1: 7.4/10), trata mal a operação multi-agent (PARTE-2: 4.6/10) e ignora quase completamente o pipeline SaaS Generator (PARTE-3: 3.5/10).** Score consolidado **~5,2/10**.

**Não é um plano ruim — é um plano incompleto e isolado.** Cobre o "o quê" arquitetural com bom rigor, mas falha em três frentes que decidem se a maratona termina:

1. **Como vai ser implementado** (workflow Strategist→Implementer→Reviewer→Documenter, hooks, agent-memory) — quase ausente
2. **Por que existe** (V2 É o piloto que valida o SaaS Generator — 9-12x mais lento que o prometido pelo Generator no escopo atual) — completamente ignorado
3. **De onde vem o conhecimento** (existe um `scrumban-spec.yaml` de 930 linhas, validado em 17/Mar/2026, que documenta as decisões do Scrumban como SaaS — **os 4 estrategistas reinventaram tudo do zero sem sequer abrir esse arquivo**)

**A boa notícia:** todas as lacunas são corrigíveis. **Não temos que jogar o plano fora.** Precisamos de **10-11 dias úteis de retrabalho do plano** (não da implementação) para fechar as lacunas. Em 1-2 desses dias o CEO decide o Caminho A/B/C de relação V2↔Generator (impacta tempo, escopo e métricas).

**A má notícia:** se passarmos esse retrabalho à frente "pra começar a implementar logo", repetimos o erro do legado. A causa raiz é exatamente isso: tomar decisões no calor do código em vez de no plano. Família depende. **Fechar o plano agora vai economizar 2-3 meses depois.**

---

## 1. PLACAR CONSOLIDADO

| Auditoria | Referência (Devari-Core) | Linhas analisadas | Score | Veredito | Retrabalho |
|-----------|--------------------------|-------------------|-------|----------|------------|
| R1 — Backend Core | PARTE-1 (1816) | 91 tópicos auditados | **7.4/10** | ⚠️ APROVAR COM RETRABALHO | 5.5 dias |
| R2 — Multi-Agent | PARTE-2 (2605) | — | **4.6/10** | 🔧 RETRABALHO OBRIGATÓRIO | 3 dias |
| R3 — SaaS Generator | PARTE-3 (2031) | — | **3.5/10** | ❌ REPROVADO COM RESSALVAS | 1-2 dias + 1 decisão CEO |
| **Consolidado** | — | — | **~5.2/10** | **⚠️ APROVAR COM RETRABALHO OBRIGATÓRIO** | **~10-11 dias úteis** (com paralelismo: 7 dias) |

**Cobertura estatística agregada (das 91 + N + N seções):**

| Veredicto | PARTE-1 | PARTE-2 | PARTE-3 | Consolidado (ponderado) |
|-----------|---------|---------|---------|--------------------------|
| ✅ COBERTO | 56% | ~30% | ~20% | ~37% |
| ⚠️ PARCIAL | 24% | ~30% | ~20% | ~25% |
| ❌ AUSENTE | 12% | ~30% | ~50% | ~28% |
| 🟡 DIVERGÊNCIA | 8% | ~10% | ~10% | ~10% |

Em palavras: **só 37% do que a Bíblia do Devari-Core estabelece está coberto no plano V2 com qualidade**. Outros 25% estão parcialmente cobertos. **38% está ausente ou diverge.**

---

## 2. CAUSA RAIZ TRANSVERSAL (a descoberta dolorosa)

Os 3 reviewers, trabalhando independentemente, convergiram para o mesmo diagnóstico de causa: **os 4 estrategistas que escreveram o plano operaram sem briefing completo de contexto**. Especificamente:

1. **Não foram informados que V2 É o piloto do SaaS Generator** — então planejaram como projeto isolado, ignorando o pipeline.
2. **Não foram informados da existência de `scrumban-spec.yaml`** (930 linhas, validado em 17/Mar/2026) — então reinventaram cada decisão do zero. Os 6 conflitos de DClasse que apareceram pós-hoc no §3.3 do plano-mestre? Todos já estavam resolvidos no YAML que ninguém abriu.
3. **Não foram informados do workflow multi-agent operacional** — então não desenharam delegação Strategist→Implementer→Reviewer→Documenter, score-gates, agent-memory bootstrapping.

**Isso é EXATAMENTE o vício que você apontou no início desta conversa:** "afrouxar a corda", "reinventar em vez de reusar", "deixar o engenheiro tomar decisões no calor do código". Aconteceu **dentro do próprio plano que deveria evitar isso**. A diferença é que aconteceu cedo, num documento, e dá para corrigir antes de virar código.

**Eu falhei aqui.** Quando lancei os 4 estrategistas em paralelo para escrever o plano, **eu deveria ter:** (a) lido as 3 PARTES da Bíblia primeiro, (b) localizado e anexado o `scrumban-spec.yaml`, (c) instruído cada estrategista a partir do YAML como fonte primária. Não fiz. Fiz prompts ricos, mas com referências indiretas (rules, RELATORIO-DEVARI-PARTE-1) em vez do contexto **completo e específico do piloto**. Resultado: 5.832 linhas de plano que reinventam coisas resolvidas e ignoram a infraestrutura operacional.

**A correção desta vez é: trazer todo esse contexto para a próxima rodada de planejamento e não delegar até estar tudo ancorado.**

---

## 3. TOP 10 LACUNAS CONSOLIDADAS (ordenadas por criticidade)

| # | Lacuna | Origem | Severidade | Impacto se não fechada | Onde corrigir |
|---|--------|--------|------------|------------------------|----------------|
| 1 | **`scrumban-spec.yaml` (930L) jamais referenciado, decisões reinventadas e em conflito** | R3 | 🔴 CRÍTICO | Plano contém decisões já invalidadas pelo YAML; 6 conflitos pós-hoc; tempo desperdiçado reinventando | Trazer YAML para `Scrumban-Backend-V2/docs/spec/` + reescrever §3 do plano-mestre alinhado |
| 2 | **V2 não está dimensionado como piloto do Generator** | R3 | 🔴 CRÍTICO | 24 sem vs 1-3 dias prometidos = 9-12x. Sinal de escopo incompatível. Não valida ADR-101 | CEO decide Caminho A (validar), B (escopar piloto mínimo), C (separar V2-produto de V2-piloto) |
| 3 | **Workflow Orchestrator (9 passos) ausente** | R2 | 🔴 CRÍTICO | F6 (Engine — coração) e F13 (Automation — RCE) operariam sem governança | Adicionar §3 ao plano-mestre: workflow Strategist→Implementer→Reviewer→Documenter com decision tree |
| 4 | **Score gate APPROVED ≥ 7.0 não documentado** | R2 | 🔴 CRÍTICO | Reviewer poderia aprovar comando perigoso com score 6 em F13. Defesa do RCE quebrada | ADR-V2-016 + hook `validate-review-score.sh` bloqueador |
| 5 | **Bug latente `s.id` vs `s.chave` em `_carregaScripts*`** | R1 | 🔴 CRÍTICO | V2 nasce com Dimensão 3 metade quebrada (DVFS chaves 5,6 silenciosamente NULL). Risk Gate compromete | F6 DoD obrigatório com 2 testes regressivos adversariais bloqueantes |
| 6 | **Agent memory não bootstrapped** | R2 | 🟠 ALTO | Implementer chega em F6 sem saber `OperacaoExecucaoClaude extends OperacaoPedido`. Conhecimento crítico perdido | F0 cria 4 MEMORY.md populados (não vazios) com herança, DVFS, regras V2 |
| 7 | **Convenção `?classe=NOME` vs `?idClasse=N` divergente sem ADR** | R1 | 🟠 ALTO | Frontend, MCP, integrações externas quebram entre paridade golden-test (F14) | ADR-V2-015 antes de F2 + decisão única no plano-mestre |
| 8 | **`templates/classes-base-template.ts` declarado inexistente** | R1 | 🟠 ALTO | F0 quebra na hora que tentar clonar. ~50 classes fixas precisam ser separadas das Dinpayz-específicas | F0.5 (nova) — criar template-base separando universais (-1..-110) de fintech-específicas (-21..-27, -150) |
| 9 | **Slash commands ausentes (`/trabalhar`, etc.)** | R2 | 🟠 ALTO | Ironia: V2 É o Scrumban e não tem comando para gerenciar tasks. Workflow operacional incompleto | F4 inclui slash commands canônicos do Devari-Core + `/trabalhar` específico do V2 |
| 10 | **Métricas Generator (% reuse, tempo de geração) não constam** | R3 | 🟠 ALTO | V2 não pode validar Generator se não mede o que o Generator promete | F14 + F17 incluem métricas: % linhas geradas vs customizadas, tempo de geração, ROI vs manual |

---

## 4. PLANO DE REMEDIAÇÃO PRIORIZADO (10-11 dias úteis, ~7 com paralelismo)

> **Premissa:** todo este retrabalho é do PLANO, não da implementação. F0 só inicia depois que essas remediações estiverem fechadas.

### Bloco 0 — Decisão estratégica (CEO) — 1 dia

**Antes de qualquer retrabalho técnico, o CEO precisa decidir o Caminho do V2 (R3 §5.2):**

| Caminho | Descrição | Tempo V2 | V2 valida Generator? | Recomendação Reviewer |
|---------|-----------|----------|----------------------|------------------------|
| **A — Piloto fiel** | V2 estritamente do que cabe no `scrumban-spec.yaml` (930L). MCP, Telegram, Automation viram fases pós-launch | 1-3 dias geração + 1-2 sem custom = ~3 sem | ✅ SIM — valida ADR-101 | **Recomendado se prazo crítico** |
| **B — Piloto expandido** | V2 inclui MCP+Telegram+Automation mas reusa Generator para cada peça (gerar, customizar, gerar próximo) | ~8-12 sem | ⚠️ PARCIAL | Caminho do meio |
| **C — V2 produto + V2 piloto separados** | V2-piloto valida Generator em ~3 sem; V2-produto continua plano atual de 24 sem como produto independente | 24 sem (produto) + 3 sem (piloto paralelo) | ✅ SIM | **Recomendado se quer ambos** |

**Esta decisão é pré-requisito para tudo que vem.** Sem ela, fechamos o plano para o escopo errado.

### Bloco 1 — Reancoragem documental — 1 dia

1. Copiar `scrumban-spec.yaml` (Devari-Core) para `Scrumban-Backend-V2/docs/spec/scrumban-spec.yaml`
2. Copiar `Devari-Core-Inventory.yaml` para `Scrumban-Backend-V2/docs/spec/Devari-Core-Inventory.yaml`
3. Copiar templates B2B/B2C/B2B2B do Devari-Core para `Scrumban-Backend-V2/docs/spec/templates/`
4. Adicionar seção 0.4 ao `00-PLANO-MESTRE.md`: "Esses 3 arquivos são fonte primária. Plano deriva deles, não os contraria."
5. Atualizar §3 (seed canônico) do plano-mestre validando contra o YAML — onde divergir, ajustar plano (não YAML)

### Bloco 2 — Multi-Agent System (R2) — 3 dias (paraleliza com Bloco 3)

1. **Adicionar §3 ao plano-mestre — Workflow Orchestrator (9 passos)** com decision tree, resume de subagent, fast mode, edge case "3 rejeições"
2. **ADR-V2-015 — Score gate APPROVED ≥ 7.0** + hook `validate-review-score.sh` (PreCommit)
3. **F0 cria 4 MEMORY.md populados:**
   - `strategist/MEMORY.md`: 3 Pilares, 17 tabelas, scrumban-spec.yaml, conflitos resolvidos
   - `implementer/MEMORY.md`: hierarquia OperacaoExecucaoClaude extends OperacaoPedido, DVFS chaves 3-7, padrões V2
   - `reviewer/MEMORY.md`: critérios de rejeição, score gates, 58 testes adversariais
   - `documenter/MEMORY.md`: 14 ADRs a redigir, JSDoc templates, conventional commits scope V2
4. **Slash commands** em `.claude/commands/`: `/trabalhar`, `/auditoria`, `/seed-validate`, `/dvfs-test`
5. **Tabela comparativa dos 4 agents** em `.claude/agents/README.md` (quando usar cada, escopo, ferramentas)
6. **Audit trail por task (8 artefatos):** plan, implementation, review, documentation, status, commit-msg, smoke-test, validator-output — definir paths e hooks
7. **Atualizar regex de `validate-*.sh`** para reconhecer módulos V2: channels, mcp, webhooks, automation, engine
8. **Criar `.claude/CLAUDE.md` do V2** declarando submissão ao template e linkando para cada rule canônico

### Bloco 3 — Backend Core (R1) — 3-4 dias (paraleliza com Bloco 2)

1. **F0.5 (nova) — Criar `templates/classes-base-template.ts`** separando ~50 universais de fintech-específicas (-21..-27, -150 Config Antecipação) — isso conserta o fato de o template referenciado no R1:1439 não existir como arquivo
2. **ADR-V2-015 — Convenção de query: `?idClasse=N` (numérica) prevalece** sobre `?classe=NOME`. Wrapper de compatibilidade aceita ambos por 2 sprints, depois deprecated
3. **F6 DoD adicional — 2 testes regressivos adversariais bloqueantes** para `s.id` vs `s.chave` em `_carregaScriptsCalc()` e `_carregaScriptsGrav()`. Sem estes, F6 não fecha
4. **Auditar 7 lacunas restantes do R1** (ler §3 e §5 da auditoria PARTE-1) e fazer ajustes pontuais nos 5 sub-planos
5. **Validar todas as DClasses do plano-mestre §3 contra o `scrumban-spec.yaml`** — onde divergir, escolher fonte e documentar

### Bloco 4 — SaaS Generator integration (R3) — 1-2 dias (sequencial após Bloco 0)

1. Anexar `ADR-101-SaaS-Generator.md` e `PRD-SAAS-GENERATOR.md` em `Scrumban-Backend-V2/docs/decisions/` (cópia leve)
2. Adicionar **Fase 0.6 — Run Skill `spec-to-yaml` se necessário** (caso CEO escolha Caminho A ou B)
3. Adicionar **F14 + F17 — Métricas Generator:** % linhas geradas, % linhas customizadas, tempo de geração, ROI vs manual, comparação com promessa do ADR-101
4. Adicionar **§7 ao plano-mestre — V2↔Generator feedback loop:** o que o V2 ensina ao Generator que vira evolução do template (lições aprendidas → nova rule, novo template, novo pattern)
5. Atualizar `00-PLANO-MESTRE.md` §0.2 com: "V2 é piloto do SaaS Generator. Não é projeto isolado."

### Bloco 5 — Validação final do plano — 1 dia

1. Reviewer (você ou agente) faz auditoria final dos 5 sub-planos pós-remediação
2. Score deve subir para ≥ 8.0 em cada uma das 3 dimensões
3. Veredicto unânime ✅ APROVAR antes de F0
4. Fechar o plano e iniciar F0

**Total realista:** 10-11 dias úteis em série. Com paralelismo (Bloco 2 ∥ Bloco 3): **~7 dias úteis**. Bloco 0 (decisão CEO) é pré-requisito de todo o resto.

---

## 5. RECOMENDAÇÃO FINAL AO CEO

**Faça isso ANTES de iniciar implementação:**

1. **Hoje:** revise os 3 relatórios de auditoria (4.066 linhas) ou pelo menos os resumos executivos de cada um
2. **Amanhã:** reunião de 1h para decidir Caminho A/B/C do Bloco 0 (R3 §5.2). Trago a decisão pra cá
3. **Próxima semana:** retrabalho dos 5 sub-planos conforme Blocos 1-5 (com paralelismo)
4. **Semana seguinte:** auditoria final + aprovação + início F0

**Não inicie F0 sem fechar isso.** O custo de 7-11 dias de retrabalho de plano agora é trivial comparado ao custo de descobrir essas lacunas em F6 (3 meses de implementação) ou F13 (5 meses) ou pior, em produção.

**O que eu peço de você:**
- Decisão sobre o Caminho A/B/C (1 hora de reunião)
- Aprovação para fazer o retrabalho do plano nos próximos 7-11 dias
- Confirmação de que F0 só inicia depois disso

**O que eu vou fazer:**
- Conduzir o retrabalho com agentes adequadamente briefados (com YAML, com PARTE-1/2/3, com workflow multi-agent completo)
- Trazer o `scrumban-spec.yaml` para a base canônica do V2
- Documentar cada decisão do retrabalho como ADR
- No fim, apresentar plano remediado com score ≥8.0 em cada dimensão

A corda não pode afrouxar nem uma vez — e a primeira tentativa de afrouxar acabou de ser detectada **dentro do próprio plano**. Foi cara em horas, mas barata em dano. Vamos consertar agora.

---

## 6. ARQUIVOS GERADOS NESTA AUDITORIA

```
Scrumban-Backend-V2/docs/auditoria/
├── 00-AUDITORIA-CONSOLIDADA.md          ← este documento (~400L)
├── AUDITORIA-PARTE-1-vs-PLANO-V2.md     ← 1522L (Backend Core, score 7.4)
├── AUDITORIA-PARTE-2-vs-PLANO-V2.md     ← 1578L (Multi-Agent, score 4.6)
└── AUDITORIA-PARTE-3-vs-PLANO-V2.md     ← 966L  (SaaS Generator, score 3.5)

Total: 4.466 linhas de revisão sobre 5.832 linhas de plano (~76% de cobertura)
```

---

**Fim do veredicto consolidado.**
