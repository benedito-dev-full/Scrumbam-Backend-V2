# Fontes Primárias do Scrumban-Backend-V2

**Versão:** 1.0
**Data:** 2026-05-08
**Status:** Documento normativo — define a hierarquia de fontes da verdade do V2

---

## 0. Por que este documento existe

A auditoria consolidada (`docs/auditoria/00-AUDITORIA-CONSOLIDADA.md` v1.1) detectou que os 4 estrategistas que escreveram o plano original operaram sem hierarquia clara de fontes. Reinventaram decisões, divergiram em DClasses e ignoraram artefatos existentes. Após a recalibração por diretriz do CEO (08/05/2026), a hierarquia de fontes do V2 está reorganizada em três camadas: **escopo do produto**, **arquitetura canônica** e **plano-mestre**. Esta página oficializa quem é fonte primária, quem é histórico e como interpretar conflitos.

---

## 1. Diretriz fundamental do CEO (08/05/2026)

1. **Escopo do V2 = Scrumban HOJE.** O produto evoluiu desde o YAML inicial. Não reduzimos escopo. As 128 rotas, as intentions V3, MCP, Telegram, Voice, Webhooks, Automation, Risk Gate e Approval Flow estão dentro.
2. **Regra do V2 = Devari-Core canônico.** O produto fica intacto; a arquitetura passa a obedecer integralmente as 17 tabelas, os 3 Pilares, os 21 padrões backend e o modelo polimórfico.
3. **O `scrumban-spec.yaml` antigo é IDEIA INICIAL, não fonte primária.** É registro histórico do raciocínio na época da geração inicial; o produto seguiu evoluindo no Scrumbam-Backend.
4. **O Generator atual (PARTE-3) NÃO cobre o escopo moderno.** Channels, MCP, Automation, Voice e PR auto-open não cabem hoje no pipeline `spec-to-yaml + multi-agent`. Isso é descoberta valiosa, não falha do V2: vira insumo para evoluir o template (ver §6 e ADR-V2-017).

---

## 2. Camadas de fontes da verdade

### 2.1. Camada A — ESCOPO/PRODUTO (o QUE o V2 entrega)

**Fontes primárias (autoritativas):**

| Documento | Caminho | Função |
|-----------|---------|--------|
| **SYSTEM-OVERVIEW.md** | `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` (1.659 linhas) | Capacidades atuais a preservar: stack, 14 modelos, 22 módulos, integrações Telegram/Groq/MCP/Argus, fluxos de Risk Gate, Approval Flow, Voice Capture, Webhooks HMAC |
| **API-CONTRACT.md** | `Scrumbam-Backend/docs/API-CONTRACT.md` (1.811 linhas) | 128 endpoints HTTP a manter byte-compatíveis com o legado (ver gate G2→G3 do plano-mestre) |
| **CLAUDE.md (Scrumbam-Backend)** | `Scrumbam-Backend/CLAUDE.md` | Linha do tempo de capacidades entregues (Telegram Fases A–F, Automation Fases 1–3, MCP Fases 1–5, Teams V1, Reports PDF, Search global) |

**Regra de leitura:** quando houver dúvida sobre **o que o V2 precisa fazer**, abrir um destes três antes de qualquer outra coisa.

### 2.2. Camada B — ARQUITETURA CANÔNICA (COMO o V2 deve ser construído)

**Fontes primárias (autoritativas):**

| Documento | Caminho | Função |
|-----------|---------|--------|
| **RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md** | `Devari-Core/RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` (1.816 linhas) | Schema das 17 tabelas, 3 Pilares aplicados, padrões backend, polimorfismo |
| **RELATORIO-DEVARI-PARTE-2-MULTI-AGENT.md** | `Devari-Core/RELATORIO-DEVARI-PARTE-2-MULTI-AGENT.md` (2.605 linhas) | Workflow operacional Strategist → Implementer → Reviewer → Documenter, hooks, score gates, agent memory, slash commands |
| **RELATORIO-DEVARI-PARTE-3-SAAS-GENERATOR.md** | `Devari-Core/RELATORIO-DEVARI-PARTE-3-SAAS-GENERATOR.md` (2.031 linhas) | Pipeline `spec-to-yaml + multi-agent`, Inventory anti-duplicação, templates B2B/B2C/B2B2B |
| **`.claude/rules/*.md`** | `Devari-Core/.claude/rules/` (8 regras canônicas) | Backend patterns (21), 3 Pilares (operacional), polymorphic engine (modelo), event naming, JSDoc templates, conventional commits, migration protocol, SaaS Generator |

**Regra de leitura:** quando houver dúvida sobre **como construir uma feature**, abrir as PARTES + as regras correspondentes ANTES de codificar. As 8 rules são injetadas automaticamente nos agents (já copiadas em `Scrumban-Backend-V2/.claude/rules/`).

### 2.3. Camada C — PLANO E DECISÕES DO V2 (como o produto será entregue)

**Fontes primárias (autoritativas):**

| Documento | Caminho | Função |
|-----------|---------|--------|
| **00-PLANO-MESTRE.md** | `Scrumban-Backend-V2/docs/plano/00-PLANO-MESTRE.md` | Bíblia operacional. Inclui §3 (seed canônico DClasses), §6 (ADRs), §7 (a ser criado: V2↔Generator feedback loop) |
| **01–04 sub-planos** | `Scrumban-Backend-V2/docs/plano/0X-*.md` | Detalhamentos por bloco (Fundação, Domínio+Engine, Integrações, Hardening+Handoff). Subordinados ao plano-mestre quando houver conflito |
| **ADRs do V2** | `Scrumban-Backend-V2/docs/decisions/ADR-V2-*.md` | Decisões arquiteturais não-triviais. Inclui ADR-V2-017 (feedback loop com Generator) |

**Regra de leitura:** todo PR do V2 referencia plano-mestre + ADRs aplicáveis. Quando um sub-plano divergir do plano-mestre, **plano-mestre prevalece** (ver §0 do `00-PLANO-MESTRE.md`).

---

## 3. Fontes históricas (NÃO autoritativas)

Estes documentos NÃO são fonte primária. Servem como referência histórica de raciocínio passado, e podem ser úteis para anti-duplicação técnica, mas **não vinculam decisões do V2**.

| Documento | Status | Uso permitido |
|-----------|--------|---------------|
| `scrumban-spec.yaml` (antigo) | NÃO LOCALIZADO FISICAMENTE no Devari-Core (citado nas auditorias). Era a IDEIA INICIAL gerada pela skill `spec-to-yaml` em 17/Mar/2026 (~930 linhas, 85% reuse declarado) | Apenas como referência histórica caso alguém o encontre. NÃO trazer para `docs/spec/` como autoritativo. NÃO usar para validar DClasses do V2 — usar §3 do plano-mestre |
| `Devari-Core-Inventory.yaml` (606 linhas) | NÃO LOCALIZADO no Devari-Core. Era mapa anti-duplicação do Inventory | Se localizado, usar APENAS como referência técnica de "o que existe no template" (anti-duplicação). NÃO usar para escopo do V2 |
| Templates `b2b-multi-tenant.yaml`, `b2c-individual.yaml`, `b2b2b-white-label.yaml` | Templates do Generator, em `Devari-Core/docs/01 - Especificacao Devari Saas Generator/templates/` | Referência conceitual sobre tipos de SaaS suportados pelo Generator. V2 NÃO encaixa em nenhum dos três como blueprint puro — é caso para evoluir o template (ver §6) |
| `Scrumban-Backend-V2/docs/spec/historico/` | Pasta vazia preparada para abrigar arquivos históricos quando recuperados | Repositório de documentos históricos, claramente segregados |

**Regra dura:** se um arquivo aparece em `docs/spec/historico/`, ele é histórico. Ninguém puxa decisão dele sem antes confrontar com Camadas A/B/C.

---

## 4. Como interpretar conflito entre fontes

A hierarquia opera assim:

```
Camada A (SYSTEM-OVERVIEW + API-CONTRACT) define O QUE
   │
   └── Camada B (PARTES 1/2/3 + .claude/rules) define COMO
          │
          └── Camada C (plano-mestre + sub-planos + ADRs) materializa em fases e decisões
                 │
                 └── Camada Histórica é apenas memória — nunca decide
```

**Regras práticas de resolução:**

1. **Camada A vs Camada B** → não há conflito real: A diz "o V2 captura voz via Telegram", B diz "como persistir, padrões, polimorfismo". Ambas se reforçam. Se aparentar conflito, é sinal de que a feature não cabe nas 17 tabelas como pensado — abrir ADR e escalar para o CEO.
2. **Plano-mestre §3 (DClasses)** é a **fonte normativa do seed canônico do V2**. Sub-planos que divergiram durante a escrita paralela já foram conciliados em §3.3. Qualquer DClasse nova depois daqui exige ADR + atualização do §3 + propagação ao seed.
3. **Generator (PARTE-3) vs escopo moderno do V2** → o Generator NÃO cobre Channels, MCP, Automation, Voice, PR auto-open. Isso NÃO é falha do V2 — é gap do Generator atual. V2 documenta cada peça fora-do-pipeline como **proposta de evolução do Devari-Core** (ver §6, ADR-V2-017, `docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md`).
4. **Sub-plano vs plano-mestre** → plano-mestre prevalece. Sub-plano deve ser ajustado.
5. **Diretriz pontual do CEO** → sobreescreve qualquer fonte. Registrar imediatamente como ADR para preservar rastreabilidade.

---

## 5. Mapa rápido — onde achar o quê

| Pergunta | Abrir |
|----------|-------|
| "Quais features o V2 precisa preservar do legado?" | `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` |
| "Que rotas HTTP precisam continuar funcionando byte-compatíveis?" | `Scrumbam-Backend/docs/API-CONTRACT.md` |
| "Que capacidades já foram entregues no Scrumbam-Backend?" | `Scrumbam-Backend/CLAUDE.md` (timeline) |
| "Como o V2 representa Channels, MCP, Automation nas 17 tabelas?" | Plano-mestre §3 (seed) + sub-plano `03-INTEGRACOES.md` |
| "Como funciona o Engine, DVFS, herança OOP?" | `.claude/rules/devari-polymorphic-engine.md` + `devari-3-pilares.md` |
| "Que ADRs já existem para o V2?" | `Scrumban-Backend-V2/docs/decisions/` |
| "Como o Strategist/Implementer/Reviewer trabalham?" | PARTE-2 + sub-plano `01-FUNDACAO.md` (F0) |
| "O Generator cobre essa feature?" | Plano-mestre §7 (a criar) + ADR-V2-017 + `docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md` |

---

## 6. Princípio do feedback loop V2 → Generator (resumo executivo)

Detalhe completo em **ADR-V2-017** e **plano-mestre §7**. Resumo:

- O V2 é **piloto vivo** que mede o gap entre **Scrumban-hoje** e o **Generator-atual**.
- A cada feature implementada FORA do escopo coberto pelo `devari-saas-generator.md`, o V2 abre uma **issue de evolução** no Devari-Core, propondo:
  - novo módulo opt-in,
  - nova classe fixa,
  - nova rule canônica,
  - ou novo template (Channels, MCP, Automation podem virar templates próprios no v3.0).
- Saída ao final do V2: **`docs/lessons/EVOLUCAO-DEVARI-CORE-V3.md`** consolidando todas as propostas, métricas e PRs sugeridos.
- Linguagem é **construtiva, não defensiva**: V2 não está "fora do template" — está **expandindo o que o template precisa cobrir** para gerar SaaS modernos.

---

## 7. Manutenção desta página

- Esta página é **versionada**. Mudanças exigem PR + revisão.
- Se uma nova fonte primária surgir (ex.: PARTE-4, novo manual canônico do Devari-Core), atualizar a tabela correspondente.
- Se um documento histórico for recuperado fisicamente, mover para `docs/spec/historico/` com nota de proveniência.
- Se o CEO emitir nova diretriz que altere hierarquia, registrar como ADR e referenciar aqui.

---

**Fim do documento.**
