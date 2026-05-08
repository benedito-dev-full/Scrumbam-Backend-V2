# Auditoria — PARTE-3 (SaaS Generator) vs Plano V2

**Versão:** 1.0
**Data:** 2026-05-08
**Auditor:** Reviewer Devari-Core
**Status do Veredicto:** REPROVADO COM RESSALVAS — Plano V2 ignora completamente a perspectiva do SaaS Generator (Stage 1 + Stage 2). Score consolidado: **3,5/10**.

---

## 0. Resumo executivo

A `RELATORIO-DEVARI-PARTE-3-SAAS-GENERATOR.md` (2031 linhas) estabelece de forma inequívoca que **o Scrumban é o piloto de validação ponta-a-ponta do SaaS Generator** (ver §5.1 da PARTE-3, ADR-101 §2.3, PRD-SAAS-GENERATOR §4 — UC-001 dedicado ao Scrumban). A Stage 1 do pipeline já foi executada e validada — o `scrumban-spec.yaml` (930 linhas, 85% reuso, 71 classes seed, 2 migrations) é a evidência objetiva. A única peça **pendente de execução** é a Stage 2 (Multi-Agent code-gen consumindo o YAML).

O Plano V2 sob auditoria (5.428 linhas distribuídas em 5 documentos `00-PLANO-MESTRE.md`..`04-HARDENING-HANDOFF.md`) **não menciona uma única vez**:

- O artefato `scrumban-spec.yaml` (que já existe e foi validado);
- A skill `spec-to-yaml` (Stage 1);
- O pipeline Multi-Agent code-gen (Stage 2);
- O `Devari-Core-Inventory.yaml` (1.197L) como fonte anti-duplicação;
- Os templates B2B/B2C/B2B2B;
- ADR-101 (decisão estratégica do Generator);
- ADR-102 (Multi-Agent Modernization que viabiliza Stage 2);
- PRD-SAAS-GENERATOR.md (1.575L) ou PRD-GAP1-MULTI-AGENT-3-PILARES.md (~1.570L);
- Qualquer KPI do Generator (tempo de geração 3-5h, % automação 70-80%, speedup 5-10x).

A única ocorrência da string "saas-generator" no plano é uma referência passageira ao arquivo `.claude/rules/devari-saas-generator.md` na lista de **rules a copiar** (00-PLANO-MESTRE §0.1 item 6 e 01-FUNDACAO §62 linha 75). Trata-se de uma menção burocrática (ancorar a regra para os agents lerem), **não uma adesão arquitetural ao pipeline.**

Em termos diretos: **o Plano V2 é um manifesto de reconstrução manual de 24 semanas (~6 meses), com 1 implementer dedicado, escrito como se o SaaS Generator não existisse.** Isso colide frontalmente com:

1. ADR-101: o Scrumban é o piloto que valida o ROI do Generator (5-10x speedup, 1-3 dias geração, 1-2 dias customização);
2. PARTE-3 §5.3 estado atual: "Stage 1 validada / Stage 2 pendente — invocar `@orchestrator Implementar scrumban-spec.yaml`";
3. PARTE-3 §10.2 expectativa explícita: "Pipeline Stage 2 — Scrumban: aguarda execução";
4. PARTE-3 §1.3 metas de tempo: 1-3 dias geração + 1-3 dias customização vs **24 semanas manuais** propostas no plano.

A PARTE-3 reconhece que algumas adaptações são necessárias — DProject e DTask exigem migrations (§5.2.4 e §5.2.5 do relatório, antecipados pela skill). Algumas das capacidades V3 que o legado entrega (intentions V3, MCP, Telegram+Groq, Automation com Risk Gate) **não estão cobertas** pela skill v2.0 atual. **Mas isso seria caso para iterar a skill (input para v2.1)**, não para abandonar o pipeline. O Plano V2 não declara explicitamente este abandono — ele simplesmente desconhece a existência do pipeline.

**Pior cenário identificado:** se o Plano V2 for executado como escrito, o piloto Scrumban deixa de validar o ADR-101. Sem essa validação, o Devari Core perde a evidência empírica que sustenta a meta de 10-12 SaaS/ano e a economia de R$ 100-200k/ano (PARTE-3 §8.3).

**Veredicto Final:** **REPROVADO COM RESSALVAS**. O plano é tecnicamente consistente em termos de aderência aos 3 Pilares e às 17 tabelas (mérito real), mas falha em sua razão de ser estratégica: ser piloto do Generator. Reescrita parcial necessária — não jogar fora o trabalho dos 4 estrategistas, mas reorientar a sequência operacional para começar pela Stage 2 do Generator e usar o trabalho manual como remediação dos gaps detectados.

**Resposta direta da §6:** **NÃO. O V2, como planejado, não é piloto válido do Generator.** É um build manual paralelo que apenas absorve as regras do Devari-Core como restrição de qualidade. A relação entre V2 e Generator é de paciente passivo (V2 lê regras), não de co-validador (V2 testa pipeline).

---

## 1. Índice da PARTE-3 extraído

Extraído via `grep -n "^#" RELATORIO-DEVARI-PARTE-3-SAAS-GENERATOR.md`. Total de seções: 13 capítulos numerados + 60 sub-seções.

```
L1    # Relatório Técnico Devari Core — Parte 3
L2    # SaaS Generator: A Pipeline que Transforma Spec Narrativa em Backend
L14   ## Sumário
L32   ## 1. Sumário Executivo — O que é o Devari SaaS Generator
L34   ### 1.1. A Tese em Uma Frase
L40   ### 1.2. Pipeline em 3 Linhas
L58   ### 1.3. Comparativo de Velocidade
L68   ### 1.4. Por que isto é viável
L80   ### 1.5. O que este documento cobre
L99   ## 2. Visão Estratégica
L101  ### 2.1. Origem — Dinpayz Validado em Produção
L114  ### 2.2. ADR-100 — Template Simples (não Framework Complexo)
L140  ### 2.3. ADR-101 — Decisão de Criar SaaS Generator
L175  ### 2.4. ADR-102 — Multi-Agent Workflow Modernization
L197  ### 2.5. Análise de 4 Backends — Validação Empírica do Polimorfismo
L219  ### 2.6. 70-85% Reuse — Confirmado em 3 Specs Distintas
L241  ## 3. A Pipeline End-to-End
L243  ### 3.1. Diagrama Completo
L332  ### 3.2. Stage 1 — Skill spec-to-yaml em Detalhe
L344  #### 3.2.1. Como a skill funciona
L409  #### 3.2.2. Os 5 padrões de extensão de Engine
L422  #### 3.2.3. Validação rigorosa (Step 7.5)
L435  #### 3.2.4. Regra #7 — Perguntar Quando Incerto
L449  ### 3.3. Stage 2 — Multi-Agent Code Generator
L474  ### 3.4. Tempo Total — Quebra Realista
L488  ## 4. Os Artefatos que Viabilizam o Generator
L492  ### 4.1. PRD-SAAS-GENERATOR.md — A Especificação do Produto
L532  ### 4.2. PRD-GAP1-MULTI-AGENT-3-PILARES.md — Resolução do Bloqueio Crítico
L590  ### 4.3. Devari-Core-Inventory.yaml — Anti-Duplicação
L605  #### 4.3.1. polymorphism (linha 13-340)
L641  #### 4.3.2. seed_classes (linha 342-577) — CRÍTICO
L665  #### 4.3.3. engine_operacao (linha 579-767) — CRÍTICO
L671  #### 4.3.4. auth, multi_tenant, integrations, event_driven, optional_features
L675  #### 4.3.5. workflows — Padrões universais
L679  #### 4.3.6. agent_instructions — Como agents devem usar
L683  #### 4.3.7. known_gaps — Componentes que NÃO existem
L694  #### 4.3.8. integration_templates, anti_patterns, agent_checklist
L700  ### 4.4. Templates por Tipo de SaaS
L712  #### 4.4.1. classes-base-template.ts
L759  #### 4.4.2. b2b-multi-tenant.yaml
L823  #### 4.4.3. b2c-individual.yaml
L838  #### 4.4.4. b2b2b-white-label.yaml
L859  ### 4.5. Skill spec-to-yaml — Anatomia Completa
L865  #### 4.5.1. Estrutura interna
L891  #### 4.5.2. Diferenças principais entre v1.0 e v2.0
L909  #### 4.5.3. Output esperado — secções do YAML
L931  #### 4.5.4. Métricas de sucesso da skill (auto-declaradas)
L948  ## 5. Caso Piloto Validado: Scrumban
L950  ### 5.1. O Que Foi Feito
L956  ### 5.2. Análise do scrumban-spec.yaml — Linha por Seção
L963  #### 5.2.1. Metadata (linhas 11-46)
L992  #### 5.2.2. Hierarchy (linhas 50-77) — 3 níveis
L1018 #### 5.2.3. Seed de Classes (linhas 81-344) — 53 fixas + 18 específicas = 71 total
L1054 #### 5.2.4. Schema Status — DProject e DTask Precisam de Migration
L1072 #### 5.2.5. Migrations Required — Models Novos Especificados
L1133 #### 5.2.6. Entities (linhas 426-525) — Mapeamento Completo
L1150 #### 5.2.7. Operations (linhas 530-720) — 22 operações com flags claras
L1192 #### 5.2.8. Integrations (linhas 725-748)
L1217 #### 5.2.9. Engine Usage — Sem Engine para Scrumban (linhas 752-768)
L1238 #### 5.2.10. Reuse Map (linhas 781-799)
L1264 #### 5.2.11. Customization Guide (linhas 803-849)
L1316 #### 5.2.12. Timeline (linhas 854-864)
L1331 #### 5.2.13. Validation Results — Step 7.5 Executado
L1379 ### 5.3. O Que Falta para Validação Completa
L1394 ### 5.4. Riscos Identificados na Pipeline
L1406 ## 6. Mapeamento dos Outros Domínios Analisados
L1410 ### 6.1. VendaBot — B2B Complexo (70% Reuse)
L1451 ### 6.2. Projeto Vida — B2C Médio (75% Reuse)
L1493 ### 6.3. Comparativo de Reuso — Tabela Final
L1513 ## 7. As 3 Dimensões aplicadas ao Generator
L1525 ### 7.1. Dimensão 1 (Dados) — Seeds Gerados via YAML
L1552 ### 7.2. Dimensão 2 (Comportamento) — Engines via YAML ou Heranças
L1585 ### 7.3. Dimensão 3 (Configuração) — Scripts DVFS via YAML
L1604 ### 7.4. Por que as 3 Dimensões são chave para Generator
L1619 ## 8. ROI e Métricas
L1621 ### 8.1. Investimento
L1635 ### 8.2. Retorno
L1651 ### 8.3. Economia de Custo
L1665 ### 8.4. Meta Estratégica
L1669 ### 8.5. KPIs Quantitativos
L1680 ### 8.6. KPIs Qualitativos
L1689 ### 8.7. Validação em 3 Specs Piloto (Critério de Aprovação Final)
L1712 ## 9. Roadmap
L1714 ### 9.1. Quatro Fases do Devari Core
L1723 ### 9.2. Detalhamento da Fase 2 (Foco do Generator)
L1748 ### 9.3. Fases Posteriores
L1762 ### 9.4. Backlog
L1772 ### 9.5. Tasks da Fase 1 (Não Concluídas — Limpeza Pré-Piloto)
L1784 ## 10. Estado Atual (Mapa do que existe vs planejado)
L1788 ### 10.1. Implementado e Funcional
L1810 ### 10.2. Em Especificação (Documentado, Não Executado)
L1822 ### 10.3. Não Iniciado / Gaps Conhecidos
L1842 ### 10.4. Histórico do GAP 1 — A Lição Mais Importante
L1859 ### 10.5. Resumo Executivo do Estado Atual
L1869 ## 11. Limpeza Pendente do Template (pré-piloto Scrumban)
L1875 ### 11.1. Fase 1 — Crítico
L1890 ### 11.2. Fase 2 — Importante
L1905 ### 11.3. Fase 3 — Organização
L1922 ### 11.4. Resumo da Limpeza
L1935 ## 12. Apêndice A — Índice de Arquivos da Pasta SaaS Generator
L1968 ## 13. Apêndice B — Glossário
```

---

## 2. Auditoria por categoria

A auditoria seguirá a metodologia exigida no briefing: cada tópico recebe **Referência (PARTE-3 linha)**, **Cobertura no plano V2**, **Veredicto** (✅ aderente / ⚠️ parcial / ❌ ausente / 🟡 divergente), **Análise**, **Score 1-10** e **Ação corretiva**. O agrupamento segue as 10 categorias do briefing.

### Categoria A — Filosofia do Generator (ADRs 100/101/102, "Template Simples")

#### A.1 — ADR-100 (Template Simples como fundação ideológica)

**Referência (PARTE-3 L114-138):** "ADR-100 é a fundação ideológica do SaaS Generator. Sem 'Template Simples' como princípio, qualquer geração automatizada se transformaria em geração de framework."

**Cobertura no plano V2:** O 00-PLANO-MESTRE §0.1 item 1 afirma "ZERO tabela nova no banco. Apenas as 17 canônicas Devari-Core" — coerente com Template Simples (clone + ajusta seeds). A Filosofia "clone + customize" está presente implicitamente. ADR-100 não é citado nominalmente.

**Veredicto:** ⚠️ parcial.

**Análise:** O plano respeita a doutrina do Template Simples (não criar framework, não criar tabelas novas, polimorfismo via DClasse). Mas a coerência é casual — vem da herança de regras canônicas, não de uma adesão consciente ao ADR-100. Ausência de citação ao ADR-100 é simbólica: o plano se trata como sistema autônomo, não como projeto-filho do template.

**Score:** 6/10

**Ação corretiva:** Adicionar em 00-PLANO-MESTRE §0.1 (Compromisso fundacional) cláusula explícita: "Submissão a ADR-100 (Template Simples — clone + customiza, sem framework). Submissão a ADR-101 (este projeto é o piloto Scrumban do SaaS Generator)."

---

#### A.2 — ADR-101 (Scrumban = piloto do Generator)

**Referência (PARTE-3 L140-174 e L948-955):** "Scrumban: B2B SIMPLES, 85% reuse, é o caso piloto. Stage 1 validada em 17/Mar/2026 (`scrumban-spec.yaml` 930L). Stage 2 pendente."

**Cobertura no plano V2:** Zero. Nenhuma das 5.428 linhas referencia ADR-101.

**Veredicto:** ❌ ausente.

**Análise:** Esta é a omissão estratégica MAIS GRAVE da auditoria. ADR-101 é o ato fundador da pipeline e estabelece que o Scrumban é o piloto que valida (ou refuta) a meta de 5-10x speedup. O Plano V2 redefine implicitamente o papel do Scrumban: deixa de ser "piloto de validação do Generator" e passa a ser "reconstrução de 6 meses do legado". Se o V2 for executado como escrito, ADR-101 nunca terá sua validação canônica.

**Score:** 1/10

**Ação corretiva:** §0.1 do 00-PLANO-MESTRE deve declarar: "V2 é a execução da Stage 2 do SaaS Generator sobre `scrumban-spec.yaml`. O plano-mestre dirige customização (estimada 15-30% segundo PRD-SAAS-GENERATOR §4.1) sobre o output do Multi-Agent code-gen, e iterações da skill v2.x para os gaps que aparecerem (intentions V3, MCP, Telegram+Groq, Automation)." A aceitação do V2 pelo CEO deve formalizar que o caminho é Stage 1 → Stage 2 → customização, não 17 fases manuais.

---

#### A.3 — ADR-102 (Multi-Agent Modernization viabiliza Stage 2)

**Referência (PARTE-3 L175-196):** "ADR-102 é, em essência, a viabilização técnica do Stage 2 do SaaS Generator (Multi-Agent Code Gen). Ele decidiu modernizar completamente o workflow multi-agent em 4 fases."

**Cobertura no plano V2:** 01-FUNDACAO §62-90 cita cópia de `.claude/agents/`, `.claude/rules/`, `.claude/scripts/` do Devari-Core. Aderência operacional ao Multi-Agent System existe (4 agentes copiados, hooks ativos).

**Veredicto:** ⚠️ parcial.

**Análise:** Os agents existem no V2, mas o plano os usa apenas como executores de tarefas individuais — não como pipeline coordenada de geração. ADR-102 permite que o Stage 2 do Generator funcione (Strategist → Implementer → Reviewer → Documenter consumindo um YAML). O V2 reduz isso a "agents executam plans manuais escritos pelos 4 estrategistas". Subutilização severa.

**Score:** 4/10

**Ação corretiva:** Adicionar em 00-PLANO-MESTRE §1 nova fase F-1 (pré-fase): "Executar Stage 2 do Generator sobre `scrumban-spec.yaml` atualizado (regerar com gaps V3+legado)." A saída da F-1 vira input do plano operacional. As 17 fases atuais reorientadas para customizar/preencher gaps, não construir do zero.

---

#### A.4 — Análise empírica de 4 backends (validação do polimorfismo)

**Referência (PARTE-3 L197-218):** "9 padrões CORE presentes nos 4 backends. DProject/DTask validados em GMDimensional. DTabela escala até 326 classes."

**Cobertura no plano V2:** O plano usa o polimorfismo extensivamente (00-PLANO-MESTRE §3 com ~120 DClasses). Não cita ANALISE-4-BACKENDS.md.

**Veredicto:** ⚠️ parcial.

**Análise:** Aderência operacional, ausência de referência. Não bloqueia execução.

**Score:** 7/10

**Ação corretiva:** Adicionar referência em 00-PLANO-MESTRE §7 (Navegação) à análise de 4 backends como fundamento empírico do polimorfismo.

---

### Categoria B — Skill Parse-Spec (Stage 1)

#### B.1 — Skill `spec-to-yaml v2.0` (existência e uso)

**Referência (PARTE-3 L344-447):** "A skill é um documento Markdown extenso que serve como system prompt expandido. Versão atual: 2.0 (revisada em 2026-03-17 para se tornar polymorphic-aware). Tamanho: 1.287 linhas. Tempo: 20-35 minutos. Taxa de sucesso alvo: 90-95%."

**Cobertura no plano V2:** Zero. A skill não é citada em nenhum dos 5 documentos.

**Veredicto:** ❌ ausente.

**Análise:** A skill é o **único caminho documentado** para chegar a um YAML estruturado. O Plano V2 é, em essência, uma tentativa de fazer manualmente o que a skill faria automaticamente em 25 minutos. As decisões que aparecem no 00-PLANO-MESTRE §3 (faixas de DClasses, mapeamento de DProjectMember→DVincula, DAgent→DEntidade, DExecution→DPedido) são **exatamente** o tipo de output que a skill produziria — e que produziu para o Scrumban no v2.0.

**Score:** 0/10 (ausência absoluta de uma peça crítica do pipeline).

**Ação corretiva:** Documentar em 00-PLANO-MESTRE §0 que o ponto de partida obrigatório é regerar `scrumban-spec.yaml` com a skill v2.0+, incluindo agora as capacidades V3 (intentions, MCP, Telegram+Groq, Automation, Webhooks, 128 endpoints) que não estavam na primeira execução. O output ideal seria comparar o YAML novo com as decisões manuais do §3 para detectar divergências.

---

#### B.2 — Receita de mapeamento (árvore de decisão de 14 perguntas)

**Referência (PARTE-3 L352-373):** "Para cada substantivo do domínio, a skill aplica uma árvore de decisão" (lista das 14 perguntas: É pessoa? É lookup? É relação?...).

**Cobertura no plano V2:** O 02-DOMINIO-ENGINE §5.4 e o 00-PLANO-MESTRE §3.2 chegam a mapeamentos consistentes com a receita (DEntidade=USER/AGENT/ORG/TEAM, DTabela=Sprint/Status/Priority/Type, DVincula=memberships, DPedido=EXECUTION). O resultado bate.

**Veredicto:** ✅ resultado equivalente / ❌ procedimento ausente.

**Análise:** A boa notícia: o resultado dos 4 estrategistas é coerente com o que a skill produziria. A má: cada estrategista re-derivou o mapeamento manualmente em vez de invocar a skill. Isso impede aprendizado da skill (cada execução manual é desperdiçada) e força auditoria custosa para detectar conflitos (que de fato apareceram — ver 00-PLANO-MESTRE §3.3 com 6 conflitos resolvidos pós-hoc).

**Score:** 5/10 (resultado funcional, mas processo violado).

**Ação corretiva:** Forçar próxima geração de YAML de Scrumban via skill, comparar com decisões §3, registrar em ADR-V2-001 quaisquer overrides justificados.

---

#### B.3 — Step 6.6 (marcação de Engine — Pilar 1)

**Referência (PARTE-3 L388-407):** "Para CADA operação que faz INSERT em tabela transacional, a skill marca explicitamente qual Engine usar." (exemplo `devari_engine: OperacaoPedido` no YAML).

**Cobertura no plano V2:** 02-DOMINIO-ENGINE Fase 6 detalha `OperacaoExecucaoClaude extends OperacaoPedido` — ADR-V2-005. Cobertura **superior** à do scrumban-spec.yaml original (que marcou `devari_engine: null` por ser Scrumban V1 estrutural).

**Veredicto:** 🟡 divergente justificado.

**Análise:** O scrumban-spec.yaml v2.0 atual diz "Scrumban V1 NAO utiliza Engine/Operacao" (PARTE-3 L1217-1236). Isso é correto para o MVP narrativo do `scrumban_blueprint.pdf`. **Mas o V2 vai além do MVP** — incorpora Automation Claude Code (capacidade do legado) que SIM exige Engine (DPedido idClasse=-300/-301/-302/-303 + DVFS scripts). O plano V2 está certo em ativar Pilar 1; o spec.yaml está desatualizado.

**Score:** 8/10 (decisão arquitetural correta, falta sincronizar spec.yaml).

**Ação corretiva:** Regerar `scrumban-spec.yaml v3.0` cobrindo o escopo expandido (incluindo Automation), com `devari_engine: OperacaoExecucaoClaude` em operações de execução. Esta é uma melhoria valiosa para a skill — V3 é onde o Generator vai além de produtos puramente estruturais.

---

#### B.4 — Step 7.5 (validação rigorosa em 6 grupos)

**Referência (PARTE-3 L422-433):** "Antes de retornar o YAML, a skill executa um checklist executável de 6 grupos: mapeamento 17 tabelas, campos reais, Engine, Endpoints, Seed, Schema awareness."

**Cobertura no plano V2:** 00-PLANO-MESTRE §3 (seed canônico) e 01-FUNDACAO §0 (12 invariantes não-negociáveis) cumprem espírito similar — mas como restrição manual em PR review, não como saída automatizada.

**Veredicto:** ⚠️ parcial.

**Análise:** Os 4 estrategistas chegaram a um seed canônico via consolidação manual com 6 conflitos resolvidos pós-hoc (00-PLANO-MESTRE §3.3). A skill teria evitado todos eles — cada estrategista usaria Inventory + classes-base-template.ts e produziria seeds não-conflitantes na primeira execução.

**Score:** 5/10

**Ação corretiva:** Mesmo se o plano V2 prosseguir como está, executar a validação Step 7.5 da skill sobre o seed §3 e documentar discrepâncias.

---

#### B.5 — Regra #7 ("Perguntar quando incerto")

**Referência (PARTE-3 L435-447):** "REGRA #7: Se tiver dúvida sobre onde classificar um artefato, PERGUNTE AO HUMANO! Melhor perguntar (30 seg) que errar (2-4h retrabalho)."

**Cobertura no plano V2:** Implícita nos riscos top-10 (00-PLANO-MESTRE §5) e nos ADRs (§6) — decisões críticas demandam ADR formal. Espírito coerente.

**Veredicto:** ✅ aderente em espírito.

**Score:** 8/10

**Ação corretiva:** Nenhuma — está coberto.

---

### Categoria C — YAML Structured Spec

#### C.1 — Existência e uso do `scrumban-spec.yaml`

**Referência (PARTE-3 L948-1377):** Toda a §5 detalha o `scrumban-spec.yaml` (930L, 14 seções, 6 validações aprovadas).

**Cobertura no plano V2:** Zero. O artefato não é citado, lido, atualizado, validado ou referenciado.

**Veredicto:** ❌ ausente.

**Análise:** O `scrumban-spec.yaml` é o **artefato canônico de transição entre Stage 1 e Stage 2 do Generator**. PARTE-3 §10.5 declara que sua existência é a evidência de que Stage 1 funciona. Ignorá-lo no V2 é um erro de governança — equivale a refazer a especificação sem reaproveitar o que já está aprovado.

Confirmação de existência: o briefing aponta caminho `docs/01 - Especificação Devari Saas Generator/scrumban-spec.yaml`. PARTE-3 L958 aponta `/Users/devari/Documents/Benedito/devari-backend/scrumban-spec.yaml` (root do repo). Diretório atual `/Users/devaritecnologia/Documents/Benedito/Devari-Core/scrumban-spec.yaml` **não existe** (verificado via ls — `No such file or directory`). Isso indica que o artefato está em outro repositório (devari-backend) ou em pasta não acessível desta auditoria, **mas a PARTE-3 confirma textualmente sua existência** (validação 17/Mar/2026, 930L).

**Score:** 0/10

**Ação corretiva:**
1. Localizar `scrumban-spec.yaml` (devari-backend root ou docs/01...) e copiá-lo para `Scrumban-Backend-V2/docs/spec/scrumban-spec.yaml`.
2. Comparar com decisões manuais do plano §3 e registrar divergências.
3. Iterar para v3.0 (incluindo Automation, MCP, Telegram, Webhooks, 128 endpoints).
4. Fazer do YAML a fonte da verdade do plano-mestre, não os 4 sub-planos.

---

#### C.2 — 14 seções obrigatórias do YAML

**Referência (PARTE-3 L909-929):** "metadata, seed_classes, schema_status, migrations_required, entities, operations, integrations, engine_usage, transactional_flow, vincula_relations, reuse_map, customization_guide, timeline, validation_results, notes."

**Cobertura no plano V2:** Documenta seed_classes (§3) e migrations_required (implicitamente em F1). As 12 outras seções não têm contraparte estruturada — informação dispersa pelos 5 documentos.

**Veredicto:** ❌ ausente como estrutura.

**Score:** 2/10

**Ação corretiva:** Mesmo se o V2 não gere o backend pelo Multi-Agent, manter `scrumban-spec.yaml v3.0` como SSOT do que está sendo construído. Cada PR referencia uma seção do YAML.

---

#### C.3 — Schema awareness (existing vs needs_migration)

**Referência (PARTE-3 L1054-1131):** "DProject e DTask não existem no schema atual — needs_migration. Skill gerou definições completas dos models Prisma."

**Cobertura no plano V2:** 01-FUNDACAO §148 menciona "O Devari-Core atual tem 14 modelos no schema (faltam DRecurso, DTask, DProject; faltam transacionais DMovDepos, DSolicita, DRequisic). V2 adota a doutrina das 17 e implementa todas." Plano vai **além** do scrumban-spec.yaml (que só identificou DProject/DTask como gaps relevantes para Scrumban).

**Veredicto:** 🟡 divergente expansivo.

**Análise:** O plano V2 implementa as 17 tabelas inteiras, incluindo as que não são usadas no Scrumban (DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic). Isso é **mais ambicioso** que o YAML, mas potencialmente desperdício para o piloto (PARTE-3 §11 lista limpeza de Dinpayz como pré-requisito, e implementar DMovDispo/DMovDepos é parte do gap conhecido — esforço 2 semanas que o plano V2 não alocou explicitamente).

**Score:** 6/10 (excede escopo, falta dimensionamento de tempo).

**Ação corretiva:** Limitar o V2 a implementar as tabelas necessárias para Scrumban (DEntidade, DTabela, DVincula, DEvento, DUserGroup, DPermissao, DClasse, DProject, DTask, DPedido, DVFS = 11 tabelas). Documentar dormência explícita das 6 restantes. Implementar todas as 17 vira escopo de Devari-Core (não V2).

---

#### C.4 — Operations (controller: SKIP vs GENERATE)

**Referência (PARTE-3 L1150-1191):** "7 operações com controller: SKIP (reusam endpoints genéricos), 15 operações com controller: GENERATE (controllers específicos justificados)."

**Cobertura no plano V2:** 02-DOMINIO-ENGINE Fase 5 implementa Pilar 2 corretamente — Sprints/Statuses/Priorities/Types reusam `/tabelas`, Projects/Tasks têm controllers próprios. Aderência conceitual.

**Veredicto:** ✅ aderente.

**Score:** 8/10

**Ação corretiva:** Documentar explicitamente quais dos 128 endpoints do legado caem em SKIP vs GENERATE (estimativa atual: 30-40 SKIP + 90 GENERATE — mas precisa validar).

---

#### C.5 — Reuse Map (devari_core_100 / partial / custom_generate)

**Referência (PARTE-3 L1238-1262):** "85% reuse total, 15% custom (OpenAI 15% + Dashboards 15% + Status transition 5%) — totais bate com PRD."

**Cobertura no plano V2:** Zero menção a "reuse map", "% reuso", "% customização". Plano apresenta-se como construção integral.

**Veredicto:** ❌ ausente.

**Análise:** Sem reuse_map, é impossível medir a métrica chave do Generator (% automação 70-80%). O V2 não permite avaliar se o Generator atingiu sua meta no piloto.

**Score:** 1/10

**Ação corretiva:** Adicionar em 00-PLANO-MESTRE §2 (Cronograma) tabela "Reuse map V2 vs Generator target":
- Esperado pelo Generator: 85% reuse, 15% custom, 1-3 dias geração + 1-3 dias customização.
- V2 atual: 0% Generator, 100% manual, 24 semanas.
- Gap: 5-10x mais lento. Justificativa? Se a Stage 2 não existe mais, ADR-101 precisa ser revisado.

---

#### C.6 — Customization Guide (15% explícito)

**Referência (PARTE-3 L1264-1314):** "OpenAI Adapter (15%, 4-6h), Dashboards (15%, 4-6h), Status Transitions (5%, 1-2h). already_done_by_generator inclui CRUD completo, Auth, Multi-tenant, 71 seeds, DTOs, etc."

**Cobertura no plano V2:** Zero. O V2 trata tudo (CRUD, Auth, Multi-tenant, seeds, DTOs) como trabalho a fazer manualmente, ignorando que a skill marca isso como `already_done_by_generator`.

**Veredicto:** ❌ ausente.

**Score:** 1/10

**Ação corretiva:** Reorientar o V2 para ser "customization guide expanded" — assumir que CRUD/Auth/Multi-tenant/Seeds vêm da Stage 2, e que as 17 fases tratam de capacidades V3 (intentions, MCP, Telegram, Automation, Webhooks). Reestimativa de tempo: provavelmente 6-10 semanas, não 24.

---

### Categoria D — Inventory anti-duplicação

#### D.1 — `Devari-Core-Inventory.yaml` (1.197L)

**Referência (PARTE-3 L590-699):** "FONTE ÚNICA DA VERDADE. Agents consultam ANTES de gerar código (evitar duplicação). 9 polymorphism components, seed_classes range strategy, engine_operacao hierarchy, agent_instructions com regra #7, known_gaps explícitos."

**Cobertura no plano V2:** Zero menção. Os 4 estrategistas reinventam decisões que o Inventory já documenta (range -150+, allocation_strategy, anti-patterns, known_gaps DMovDepos/DRequisicao/Gamification/WebSocket).

**Veredicto:** ❌ ausente.

**Análise:** Os conflitos do §3.3 (`-152` AGENT vs ORGANIZATION, `-491` triple conflict, etc.) NÃO TERIAM EXISTIDO se cada estrategista tivesse consultado o Inventory antes. Inventory existe exatamente para evitar isto.

**Score:** 0/10

**Ação corretiva:**
1. Referenciar Inventory em 00-PLANO-MESTRE §7 e em cada DoD.
2. Adicionar invariante: "Toda nova DClasse passa por allocation_strategy do Inventory antes de entrar no seed."
3. Atualizar Inventory com lições aprendidas do V2 (ex: AGENT em -156 vira padrão para SaaS de automation).

---

#### D.2 — Faixas de chaves (-150+ vs ranges sequestrados -47/-49/-50)

**Referência (PARTE-3 L992-1017 e L644-657):** "scrumban-spec.yaml usou IDs -150, -151, -152 ao invés dos sugeridos pelo template B2B (-49, -45, -47). Por quê? Porque a skill v2.0 sabe que -47, -49 NÃO estão nas 53 fixas — são Dinpayz-específicas." Inventory `allocation_strategy.ranges`: `system_core: -1 a -99, domain_payment: -100 a -199, domain_projects: -200 a -299, ...`

**Cobertura no plano V2:** 00-PLANO-MESTRE §3.1 define faixas claras: `-150..-159` Pessoa, `-160..-179` vínculos, `-300..-319` execuções, `-400..-499` lookups, etc. Adesão à doutrina é concreta.

**Veredicto:** ✅ aderente.

**Análise:** Aqui o V2 acertou — explicita que "-47 USER" é sequestro do template e corrige. ADR-V2-002 ("Renumeração de DClasses sequestradas") é exatamente o que o Inventory pede. **MAS** observe que a faixa em uso (`-150..-509`) é mais ampla que `domain_scrumban: -400..-499` do Inventory. Ou o V2 está estourando o range do Inventory ou o Inventory precisa atualizar.

**Score:** 7/10 (decisão correta, leve discrepância de range vs Inventory).

**Ação corretiva:** Sincronizar Inventory `allocation_strategy.domain_scrumban` para `-150 a -529` ou justificar override no ADR-V2-002.

---

#### D.3 — Known gaps explícitos

**Referência (PARTE-3 L683-693):** "DMovDepos, DRequisicao, Gamification System, WebSocket Real-time — 4 gaps documentados. WebSocket parcial (BullMQ existe), 2-3 dias para boards colaborativos."

**Cobertura no plano V2:** O V2 implementa DMovDepos/DRequisic/DSolicita (completar 17 tabelas — ver C.3) mas não usa. Gamification: irrelevante para Scrumban. WebSocket: 03-INTEGRACOES F10 cobre Channels (Telegram), mas WebSocket real-time para boards colaborativos não é claramente abordado (PARTE-3 indica esse gap).

**Veredicto:** ⚠️ parcial.

**Score:** 6/10

**Ação corretiva:** Adicionar fase ou bloco no 03-INTEGRACOES tratando WebSocket real-time para drag-drop de cards (gap reconhecido pelo Inventory, esforço 2-3 dias).

---

### Categoria E — Templates B2B/B2C/B2B2B

#### E.1 — Escolha de template

**Referência (PARTE-3 L759-857 e L965-991):** "scrumban-spec.yaml metadata: type B2B_MULTI_TENANT, template_used b2b-multi-tenant.yaml. Hierarquia 3 níveis (Platform → Organization → User=Member)."

**Cobertura no plano V2:** 00-PLANO-MESTRE §3.2 implicitamente assume B2B_MULTI_TENANT (PLATFORM_SCRUMBAN -151 → ORGANIZATION -152 → TEAM -180 → USER -150). Hierarquia consistente com o template.

**Veredicto:** ✅ aderente em substância / ❌ ausente em referência.

**Análise:** Plano não cita "b2b-multi-tenant.yaml" nem "ADR-101 escolha de template". Aderência casual.

**Score:** 6/10

**Ação corretiva:** Adicionar em 00-PLANO-MESTRE §0.1 referência explícita: "V2 usa template B2B Multi-Tenant — hierarquia 3-4 níveis (Platform → Organization → Team → User)."

---

#### E.2 — concept_mapping do template B2B

**Referência (PARTE-3 L789-822):** "actors: Organization=DEntidade(COMPANY), User=DEntidade(USER), Team=DEntidade(TEAM) ou DTabela. project_management: Project=DProject, Sprint=DTabela ou DProject, Task=DTask."

**Cobertura no plano V2:** Aderente (DEntidade para todos os atores; DTabela para Sprints; DProject/DTask próprios).

**Veredicto:** ✅ aderente.

**Score:** 8/10

**Ação corretiva:** Nenhuma.

---

#### E.3 — Custom 20-30% expected pelo template B2B

**Referência (PARTE-3 L763-764):** "Reusability avg: 75%. Custom esperado: 20-30%."

**Cobertura no plano V2:** Não dimensiona % custom. Trata como construção integral.

**Veredicto:** ❌ ausente.

**Score:** 2/10

**Ação corretiva:** Estabelecer meta: V2 deve atingir ≤30% custom (medido por linhas custom / linhas totais).

---

### Categoria F — Multi-Agent code-gen pipeline (Stage 2)

#### F.1 — Workflow Strategist→Implementer→Reviewer→Documenter

**Referência (PARTE-3 L449-473):** "Strategist (`workspace/plans/...`) → Implementer (código + impl notes) → Reviewer (score + APPROVED/REJECTED) → Documenter (commits, ROADMAP). Tempo: 2-4 horas para geração completa."

**Cobertura no plano V2:** 01-FUNDACAO §62-90 e §170-179 mantém os 4 agents copiados, hooks ativos. Plano-mestre referencia continuamente Strategist+Implementer+Reviewer.

**Veredicto:** ⚠️ parcial — agents existem, pipeline coordenada não.

**Análise:** O V2 usa agents em modo "tarefa-a-tarefa" com plans escritos manualmente pelos 4 estrategistas. Isso NÃO é o Stage 2 do Generator. Stage 2 é "input YAML → output backend completo", não "input plan manual → output PR específica".

**Score:** 4/10

**Ação corretiva:** Definir explicitamente em 00-PLANO-MESTRE: a primeira execução do V2 é `@orchestrator Implementar scrumban-spec.yaml` (Stage 2). Plans manuais só entram para customização (gap V3, MCP, Automation).

---

#### F.2 — Quality gates (Build TS 0 errors, N+1=0, Reviewer >7/10)

**Referência (PARTE-3 L466-472):** "Build TypeScript 0 errors / N+1 queries = ZERO / Seed correto / Engine usado / Endpoints reusados / Score Reviewer >7/10."

**Cobertura no plano V2:** 00-PLANO-MESTRE §2.3 (gates) e §4.2 (21 padrões obrigatórios) cobrem todos os gates. Adequado.

**Veredicto:** ✅ aderente.

**Score:** 9/10

**Ação corretiva:** Nenhuma.

---

#### F.3 — Outputs por agent (workspace/...)

**Referência (PARTE-3 L460-463):** "Strategist: workspace/plans/plan-[modulo]-task[N].md. Implementer: workspace/implementations/. Reviewer: workspace/reviews/. Documenter: ROADMAP+CHANGELOG+STATUS+git."

**Cobertura no plano V2:** 01-FUNDACAO §11 e §168 cobrem nomenclatura workspace e validação via hooks. Aderente.

**Veredicto:** ✅ aderente.

**Score:** 9/10

**Ação corretiva:** Nenhuma.

---

### Categoria G — Piloto Scrumban (objetivo central)

#### G.1 — Status atual do piloto (Stage 1 ✅, Stage 2 ⏳)

**Referência (PARTE-3 L1379-1392):** "Stage 1 VALIDADA (yaml gerado, 85% reuse). GAP 1 RESOLVIDO. Aguarda: aplicar migrations, executar Stage 2, build verification, score Reviewer, customização dev. Status: ~50%."

**Cobertura no plano V2:** Plano V2 trata Scrumban como "começar do zero" — desconhece os 50% já conquistados.

**Veredicto:** ❌ ausente / 🟡 retrocesso.

**Análise:** Esta é uma observação central da auditoria. Existem 50% de progresso documentados (Stage 1 validada, GAP 1 resolvido, scrumban-spec.yaml v2.0 com 6 validações aprovadas), e o Plano V2 zera esse progresso ao prescrever 24 semanas de manualidade.

**Score:** 2/10

**Ação corretiva:** Reescrever 00-PLANO-MESTRE §1 para começar de F-1 (Stage 2) e progredir da customização. Aproveitar o `scrumban-spec.yaml` como input.

---

#### G.2 — DProject + DTask migrations (pendência declarada)

**Referência (PARTE-3 L1383-1390):** "Aplicar migrations (criar DProject e DTask no schema Prisma)."

**Cobertura no plano V2:** 01-FUNDACAO §148 declara: "V2 implementa todas as 17 tabelas — incluindo DProject, DTask, DRecurso, DMovDepos, DSolicita, DRequisic." Resolve a pendência (com escopo expandido).

**Veredicto:** ✅ aderente.

**Score:** 9/10

**Ação corretiva:** Limitar a Scrumban (ver C.3).

---

#### G.3 — Customização 15% (OpenAI Adapter, Dashboards, Status Transitions)

**Referência (PARTE-3 L1264-1314):** "OpenAI 15% (4-6h), Dashboards 15% (4-6h), Status Transitions 5% (1-2h). Total customização: 1-2 dias."

**Cobertura no plano V2:** 02-DOMINIO-ENGINE Fase 8/9 cobre forecast/Monte Carlo (alinhado a OpenAI estimativa). Dashboards: 02-DOMINIO-ENGINE Fase 9. Status transitions: Fase 5. Cobertura conceitual.

**Veredicto:** ✅ aderente.

**Score:** 7/10 (cobre, mas em escala muito maior — semanas vs horas).

**Ação corretiva:** Verificar se a expansão de escopo (Monte Carlo vs OpenAI simples) é justificada para o piloto.

---

#### G.4 — Critérios de sucesso ADR-101 (>7/10, build OK, custom <30%, tempo <50% manual)

**Referência (PARTE-3 L1701-1709):** "1. Score Reviewer >7/10 / 2. Build TS 0 errors / 3. Custom <30% / 4. Tempo gerado <50% do tempo manual."

**Cobertura no plano V2:** §2.3 gates cobre score implícito (build verde, ≥80% coverage), 17 fases cobrem build TS, mas custom <30% e tempo <50% manual: ausentes (plano declara 24 semanas explicitamente, sem comparação).

**Veredicto:** ⚠️ parcial.

**Score:** 4/10

**Ação corretiva:** Adicionar gate G-101: "Confirmar critérios ADR-101 ao final do V2. Se custom >30% ou tempo >12 semanas, ADR-101 precisa revisão."

---

### Categoria H — Métricas e ROI do Generator

#### H.1 — Tempo geração 1-3 dias / ROI 5-10x

**Referência (PARTE-3 L58-67 e L1631-1664):** "Manual: 2-3 semanas. Generator: 1-3 dias geração + 1-3 dias customização. Speedup 5-10x. Payback 3 meses. Economia R$100-200k/ano."

**Cobertura no plano V2:** 00-PLANO-MESTRE §2 estima 24 semanas, ~6 meses. Sem comparação ao Generator. Sem ROI.

**Veredicto:** ❌ ausente / 🟡 incompatível.

**Análise:** 24 semanas é **9-12x** o tempo previsto pelo Generator (3 semanas equivalentes em geração+customização). Isso significa que o V2 ou (a) não está usando o Generator, (b) está gerando algo muito além do escopo de Scrumban (p. ex., implementando todas as 17 tabelas e 128 endpoints + Automation completa), ou (c) ambos. **Confirma-se nas 5.428 linhas: ambos.**

**Score:** 1/10 (se Generator é o caminho); 6/10 (se V2 é build paralelo intencional, mas então perde o piloto).

**Ação corretiva:** CEO precisa decidir explicitamente: (1) V2 valida o Generator (curto, 3-5 semanas, customização mínima) ou (2) V2 é refundação extensa do Scrumban+Automation (24 semanas, mas então o piloto ADR-101 fica para outro projeto). **Não pode ser os dois.**

---

#### H.2 — KPIs quantitativos (% automação, score, build, coverage)

**Referência (PARTE-3 L1669-1678):** "Tempo 3-5h, % Automação 70-80%, Score >7/10, Build 100%, Coverage >70%."

**Cobertura no plano V2:** Coverage ≥80% (00-PLANO-MESTRE §2.3 G4) — bate. Build 100% — bate. Score: implícito. % Automação: ausente.

**Veredicto:** ⚠️ parcial.

**Score:** 5/10

**Ação corretiva:** Adicionar KPI "% Automação Generator: medido como linhas geradas pelo Multi-Agent / linhas totais. Meta: ≥70%."

---

#### H.3 — Validação 3 specs piloto (critério ADR-101)

**Referência (PARTE-3 L1689-1709):** "Scrumban (>8/10, custom 15%, 1-2 dias), Projeto Vida (>7/10, 25%, 2-3 dias), VendaBot (>7/10, 30%, 3-4 dias). Se QUALQUER spec falhar 2+ critérios, iterar 1-2 semanas."

**Cobertura no plano V2:** Plano V2 trata só Scrumban — sem visão de validação dos outros 2 specs. Esperado para um plano dedicado, mas significa que o V2 não está sob a métrica do "piloto múltiplo".

**Veredicto:** ❌ ausente.

**Score:** 3/10

**Ação corretiva:** Reconhecer em 00-PLANO-MESTRE §0 que o sucesso do V2 é prerequisito para validar ADR-101 (apenas 1/3 specs); Projeto Vida e VendaBot virão depois.

---

### Categoria I — Roadmap (4 fases Devari Core)

#### I.1 — Fase 2 Devari Core (SaaS Generator) onde V2 cabe

**Referência (PARTE-3 L1714-1747):** "Fase 2 (3-4 semanas): SaaS Generator (Inventory + Skill + Piloto Scrumban). Status atual: parcialmente concluída — Stage 1 OK, GAP 1 OK, Stage 2 pendente."

**Cobertura no plano V2:** Plano V2 não posiciona o V2 dentro do roadmap Devari Core (Fase 1/2/3/4). Trata-se como projeto independente.

**Veredicto:** ❌ ausente.

**Score:** 2/10

**Ação corretiva:** Adicionar §0.0 em 00-PLANO-MESTRE: "V2 é parte da Fase 2 do Devari Core (SaaS Generator), atuando como piloto de Stage 2. Sem o V2, Fase 2 não fecha. Sucesso do V2 destrava Fase 3 (Validação com 3-5 projetos)."

---

#### I.2 — Limpeza Dinpayz (Fase 1 do roadmap, pré-piloto)

**Referência (PARTE-3 L1869-1932):** "26 itens em 3 fases. Fase 1 (1-2 dias) é pré-piloto Scrumban — sem isso, template tem 817 referências Dinpayz que contaminam o piloto. ESTES ITENS SÃO CRÍTICOS PRÉ-PILOTO."

**Cobertura no plano V2:** Plano V2 não trata da limpeza Dinpayz. Como V2 é repo novo (não clone do devari-backend contaminado — confirmar?), pode contornar parte do problema. **Mas a herança do template canônico (rules, agents, hooks) vem do Devari-Core, que ainda não foi limpo.**

**Veredicto:** 🟡 desconhecimento.

**Análise:** V2 está em pasta separada (`Scrumban-Backend-V2/`), não é clone do `Devari-Core`. A contaminação Dinpayz é menos provável, mas as rules copiadas (que mencionam DEntidades do Dinpayz como exemplos) propagam vocabulário.

**Score:** 5/10

**Ação corretiva:** Validar se o V2 herda alguma referência Dinpayz dos arquivos copiados. Se sim, fazer limpeza local ou esperar Fase 1 do Devari-Core.

---

#### I.3 — Fase 3 (validação com 3-5 projetos) e Fase 4 (escala 10-12 SaaS/ano)

**Referência (PARTE-3 L1748-1761):** "Fase 3: VendaBot e Projeto Vida candidatos. Fase 4: 10-12 SaaS/ano."

**Cobertura no plano V2:** Plano V2 não considera essa visão. Subutilizado.

**Veredicto:** ❌ ausente.

**Score:** 3/10

**Ação corretiva:** Adicionar nota em 00-PLANO-MESTRE §9 (Recomendação ao CEO): "Sucesso do V2 destrava Fase 3 (VendaBot + Projeto Vida). Falha do V2 = revisão completa do Generator."

---

### Categoria J — Outputs gerados (estrutura backend NestJS)

#### J.1 — Output esperado do Generator (backend NestJS 70-85% pronto)

**Referência (PARTE-3 L313-323):** "Saída: Backend NestJS 70-85% pronto + commits estruturados. DEV CUSTOMIZA 15-30%: integrações externas, lógica de negócio específica, UI/dashboards customizados. Tempo: 1-3 dias."

**Cobertura no plano V2:** Plano V2 produz backend NestJS via fases manuais. Stack idêntico (NestJS, Prisma, BullMQ, Redis, PostgreSQL). Output funcional similar.

**Veredicto:** ✅ aderente em forma / ❌ ausente em método.

**Análise:** O backend final será similar ao que o Generator produziria. Mas o caminho é manual — perdendo o speedup 5-10x.

**Score:** 5/10

**Ação corretiva:** Aceitar que o "output esperado" se mantém, mas reorientar como chegar lá.

---

#### J.2 — Conventional Commits + JSDoc (auto pelo Documenter)

**Referência (PARTE-3 L460-463 e devari-conventional-commits.md):** "Documenter: Conventional Commits + JSDoc 100%."

**Cobertura no plano V2:** 01-FUNDACAO §0 item 9 ("Conventional Commits + JSDoc 100%") + §17 (Husky+commitlint). Aderente.

**Veredicto:** ✅ aderente.

**Score:** 9/10

**Ação corretiva:** Nenhuma.

---

### Tabela consolidada: scores por categoria

| Categoria | Itens auditados | Média | Status |
|-----------|-----------------|-------|--------|
| A. Filosofia Generator | 4 | 4,5 | ⚠️ parcial |
| B. Skill Parse-Spec | 5 | 5,2 | ⚠️ parcial (B.1=0/10 crítico) |
| C. YAML Structured Spec | 6 | 3,7 | ❌ predominantemente ausente |
| D. Inventory anti-duplicação | 3 | 4,3 | ⚠️ parcial |
| E. Templates B2B/B2C/B2B2B | 3 | 5,3 | ⚠️ parcial |
| F. Multi-Agent code-gen Stage 2 | 3 | 7,3 | ⚠️ infraestrutura ok, uso errado |
| G. Piloto Scrumban | 4 | 5,5 | ⚠️ regressão na G.1 |
| H. Métricas e ROI | 3 | 3,0 | ❌ predominantemente ausente |
| I. Roadmap Devari Core | 3 | 3,3 | ❌ predominantemente ausente |
| J. Outputs gerados | 2 | 7,0 | ✅ similar em substância |
| **CONSOLIDADO** | **36 itens** | **~3,5/10** | **REPROVADO COM RESSALVAS** |

---

## 3. Top 10 Lacunas/Divergências

Em ordem de criticidade (1 = mais grave):

### 1. Plano ignora completamente o pipeline SaaS Generator (Stage 1 + Stage 2)

**Evidência:** Zero menções a `spec-to-yaml`, `scrumban-spec.yaml`, `Multi-Agent code gen`, ADR-101 nas 5.428 linhas dos sub-planos.
**Severidade:** 🔴 CRÍTICA.
**Impacto:** Se o V2 prosseguir como está, perde o piloto Scrumban do Generator (PARTE-3 §1.4 evidência #3 e §10.5 estado atual). ADR-101 fica sem validação empírica.
**Remediação:** Reescrever 00-PLANO-MESTRE §0 e §1 para começar pela Stage 2 sobre `scrumban-spec.yaml v3.0`.

### 2. Tempo estimado 9-12x acima do prometido pelo Generator

**Evidência:** 24 semanas (V2) vs 1-3 dias geração + 1-3 dias customização (PARTE-3 §1.3 / ADR-101).
**Severidade:** 🔴 CRÍTICA (questiona viabilidade econômica do Generator).
**Impacto:** ROI 5-10x do PRD-SAAS-GENERATOR §6 fica refutado por contraposição implícita.
**Remediação:** CEO decide entre (a) Stage 2 + customização ≤ 6-10 semanas ou (b) abandono explícito do Generator (com revisão de ADR-101).

### 3. `scrumban-spec.yaml` não é referenciado, copiado, atualizado ou usado

**Evidência:** Artefato de 930 linhas (validado 17/Mar/2026) está completamente ausente do plano. A pasta auditoria/spec do V2 está vazia.
**Severidade:** 🔴 CRÍTICA.
**Impacto:** As decisões manuais §3 do plano-mestre (DClasses, mapeamentos) reinventaram o que já estava no spec.yaml — gerando 6 conflitos pós-hoc (§3.3) que NÃO existiriam.
**Remediação:** Localizar `scrumban-spec.yaml` (devari-backend root ou similar), copiá-lo em `Scrumban-Backend-V2/docs/spec/scrumban-spec.yaml`, regerar v3.0 incluindo capacidades V3+legado.

### 4. `Devari-Core-Inventory.yaml` não é consultado, gerando 6 conflitos no seed

**Evidência:** §3.3 do 00-PLANO-MESTRE documenta 6 conflitos de chaves entre os 4 estrategistas — todos preveníveis pela `allocation_strategy` do Inventory.
**Severidade:** 🟡 ALTA.
**Impacto:** Custo de retrabalho na consolidação. Risco de novos conflitos ao adicionar DClasses futuras.
**Remediação:** Tornar consulta ao Inventory obrigatória em todo PR que altere seed; adicionar invariante em 01-FUNDACAO §0 item 13.

### 5. ADR-101 (decisão fundadora) não é citado nem honrado

**Evidência:** Nenhuma menção a ADR-101 nas 5.428 linhas. ADR-V2-* listados (§6 do plano-mestre) não fazem ponte com o ADR-101.
**Severidade:** 🟡 ALTA.
**Impacto:** Decisão estratégica do Devari-Core fica órfã.
**Remediação:** Adicionar em 00-PLANO-MESTRE §6 um ADR-V2-000: "Posicionamento do Scrumban-V2 como execução do ADR-101 (piloto Stage 2)."

### 6. Customização %, Reuse Map e KPIs Generator ausentes

**Evidência:** Plano V2 não dimensiona quanto é reuso vs custom; não estabelece meta de % automação; não cita KPI tempo gerado.
**Severidade:** 🟡 ALTA.
**Impacto:** Sem essas métricas, é impossível medir se o V2 valida ou refuta o Generator.
**Remediação:** Adicionar tabela de KPIs em §2 do plano-mestre comparando V2 vs Generator target.

### 7. Plano expande escopo para 17 tabelas + 128 endpoints + Automation no piloto

**Evidência:** 01-FUNDACAO §148 implementa as 17 tabelas (incluindo DTitulo/DMovDispo desnecessárias para Scrumban). Plano cobre 128 endpoints do legado + Automation Claude Code (gap conhecido com risco RCE — 58 testes adversariais).
**Severidade:** 🟡 ALTA.
**Impacto:** Piloto deveria validar 85% reuse em escopo MVP (PARTE-3 §5.2.10). Em vez disso, V2 trata Scrumban como produto enterprise completo + features V3 do legado (intentions, MCP, Telegram+Groq, Webhooks, Automation).
**Remediação:** Separar V2 em:
- **V2-piloto** (4-6 semanas): Stage 2 + customização básica = validação ADR-101.
- **V2-completo** (mais 18-20 semanas): adiciona Automation, MCP, Telegram, etc. Não é parte do piloto.

### 8. Skill `spec-to-yaml v2.0` não é usada para regerar com escopo expandido

**Evidência:** PARTE-3 §3.2.3 Step 7.5 valida YAML em 6 grupos. Plano V2 (escopo expandido) jamais foi processado pela skill.
**Severidade:** 🟡 ALTA.
**Impacto:** Skill perde input crítico de melhoria (capacidades V3, Automation, MCP). Nunca evolui para v2.1+.
**Remediação:** Antes de iniciar V2, regerar `scrumban-spec.yaml` com escopo V3 completo, validar Step 7.5, e enviar feedback para a skill.

### 9. Templates B2B/B2C/B2B2B não são citados como base do plano

**Evidência:** scrumban-spec.yaml usa `b2b-multi-tenant.yaml`. Plano V2 chega no mesmo desenho hierárquico (Platform → Org → Team → User), mas via dedução autônoma.
**Severidade:** 🟢 MÉDIA.
**Impacto:** Sem esses guardrails, qualquer reuso futuro do plano (outros SaaS) precisa redescobrir os mesmos princípios.
**Remediação:** Adicionar §0.4 "Template fonte: b2b-multi-tenant.yaml — aderência consciente aos guardrails de hierarquia, concept_mapping e custom 20-30%."

### 10. Limpeza Dinpayz (PARTE-3 §11) não é coordenada com V2

**Evidência:** PARTE-3 §11 declara 26 itens em 3 fases como **pré-requisito** ao piloto Scrumban. Plano V2 não trata.
**Severidade:** 🟢 MÉDIA.
**Impacto:** Mesmo que V2 esteja em repo novo, a herança via rules+agents+templates pode propagar vocabulário Dinpayz. Resultado: SaaS gerado começa com referências erradas.
**Remediação:** Validar se o conteúdo das rules+templates copiadas ainda contém "Dinpayz". Se sim, esperar limpeza Fase 1 do Devari-Core (1-2 dias) ou fazer sanitização local em Fase 0 do V2.

---

## 4. Veredicto Final

### REPROVADO COM RESSALVAS — Score 3,5/10

**Justificativa:**

O Plano V2 é tecnicamente competente em **forma** (estrutura, 3 Pilares, 21 padrões, hooks, gates, ADRs internos) mas **fracassa em propósito**. PARTE-3 estabelece de modo inequívoco que o Scrumban-Backend-V2 deveria ser a Stage 2 do SaaS Generator executada sobre `scrumban-spec.yaml`. O plano sob auditoria, em contraste, é uma reconstrução manual de 24 semanas que ignora o pipeline e seus artefatos.

Tem mérito técnico real:
- 3 Pilares respeitados (especialmente Pilar 2 — endpoints genéricos);
- 17 tabelas canônicas, ZERO tabela nova (regra inviolável);
- Pilar 1 corretamente ativado via `OperacaoExecucaoClaude` — superior ao spec.yaml v2.0 (que marcou Scrumban como sem Engine, mas estava certo para o MVP narrativo);
- ADR-V2-* internos coerentes (renumeração de DClasses sequestradas, RBAC duplo via DVincula);
- Estimativa realista para o escopo expandido (24 semanas para 128 endpoints + Automation + Telegram+MCP+Webhooks).

Mas tem 4 falhas estratégicas inaceitáveis:
1. Não usa o Generator pipeline (Stage 1 + Stage 2);
2. Não referencia o `scrumban-spec.yaml` já validado;
3. Expande escopo do piloto para uma reconstrução completa (descalibrando o sentido do "piloto");
4. Não dimensiona Reuse Map, % Customização, % Automação, tempo gerado vs manual — KPIs essenciais para validar ADR-101.

O caminho de remediação é executável (ver §5) e não exige descartar todo o trabalho. Mas exige que CEO + Tech Lead decidam **explicitamente** o papel do V2: piloto do Generator (curto, focado) ou refundação de Scrumban+Automation (extenso, autônomo). **Não é compatível ser os dois.**

---

## 5. Plano de remediação

### 5.1. Remediação imediata (1-2 dias)

1. **Localizar `scrumban-spec.yaml`** — verificar `devari-backend` root, `docs/01 - Especificação Devari Saas Generator/`, ou solicitar ao mantenedor PARTE-3.
2. **Copiar artefato** para `Scrumban-Backend-V2/docs/spec/scrumban-spec.yaml`.
3. **Comparar com decisões §3** do 00-PLANO-MESTRE — registrar divergências em `docs/auditoria/COMPARATIVO-YAML-vs-PLAN.md`.
4. **Ler PRD-SAAS-GENERATOR.md, PRD-GAP1-MULTI-AGENT-3-PILARES.md, ADR-101** e adicionar a §7 do 00-PLANO-MESTRE como bibliografia obrigatória.

### 5.2. Decisão estratégica (1 reunião com CEO)

Apresentar 3 caminhos:

**Caminho A — V2 = Piloto Generator (recomendado pela PARTE-3):**
- 4-6 semanas total.
- Regerar `scrumban-spec.yaml v3.0` (incluir Automation, MCP, Telegram, Webhooks).
- Aplicar migrations.
- Executar Stage 2 (`@orchestrator Implementar scrumban-spec.yaml`).
- Customizar 15-30% (OpenAI, Dashboards, capacidades V3 ainda não cobertas pela skill).
- Validar critérios ADR-101 (>7/10, build OK, custom <30%, tempo <50% manual).
- **Resultado: ADR-101 validado, Fase 3 destravada.**

**Caminho B — V2 = Refundação extensa (atual plano-mestre):**
- 24 semanas total.
- Reconhece que ADR-101 fica sem piloto neste ciclo (precisará outro projeto).
- Mantém os 4 sub-planos como estão.
- Adiciona ADR-V2-000 declarando explicitamente o desvio do ADR-101.
- **Resultado: V2 funciona, mas Generator perde validação.**

**Caminho C — Híbrido (mais arriscado):**
- 8-12 semanas total.
- Stage 2 sobre spec v3.0 cobrindo 80% Scrumban MVP.
- Customização paralela cobre intentions V3, MCP, Telegram, Webhooks, Automation.
- Validação parcial do ADR-101 (com asterisco).
- **Resultado: meio-termo — pode validar Generator parcialmente e entregar V2 parcialmente.**

### 5.3. Caso CEO escolha Caminho A (recomendado)

Reescrita parcial do plano:
- **00-PLANO-MESTRE §0:** novo §0.0 declara V2 como piloto Stage 2.
- **00-PLANO-MESTRE §1:** mapa de fases reduzido — F0 (setup, 1 sem), F-Generator (Stage 2 + migrations, 1 sem), F-Custom (OpenAI/Dashboards/V3 features, 2-3 sem), F-Hardening (1 sem). Total 5-6 semanas.
- **00-PLANO-MESTRE §2:** cronograma 5-6 semanas, não 24.
- **00-PLANO-MESTRE §6:** novos ADRs V2-100 (escopo piloto), V2-101 (gaps cobertos por customização).
- Os 4 sub-planos atuais viram **insumo de customização** — não plano operacional principal.

### 5.4. Caso CEO escolha Caminho B

- Manter sub-planos como estão.
- Adicionar ADR-V2-000 explicitando desvio do ADR-101.
- Comunicar Devari-Core que piloto do Generator precisará de outro projeto (sugestão: Projeto Vida ou VendaBot, conforme PARTE-3 §6).

### 5.5. Itens não-negociáveis em qualquer caminho

1. **Hooks `enforce-canonical-tables.sh`** já planejado — manter (excelente).
2. **3 Pilares + 17 tabelas + 21 padrões** — manter (excelente).
3. **OperacaoExecucaoClaude (Pilar 1 ativado)** — manter (decisão técnica superior à do spec.yaml v2.0).
4. **Renumeração de DClasses sequestradas (-47/-49/-50)** — manter (correção alinhada com Inventory).
5. **Inventory consultado em todo PR de seed** — adicionar.

---

## 6. Diagnóstico especial: V2 é piloto válido do Generator?

### Resposta direta: NÃO.

### Evidências objetivas:

| Critério | PARTE-3 prescreve | V2 prescreve | Compatível? |
|---------|--------------------|--------------|-------------|
| Pipeline Stage 1 (Skill spec-to-yaml) | Obrigatório | Não usa | ❌ |
| Pipeline Stage 2 (Multi-Agent code-gen) | Obrigatório | Não usa | ❌ |
| `scrumban-spec.yaml` como input | Obrigatório | Não referencia | ❌ |
| `Devari-Core-Inventory.yaml` como anti-duplicação | Obrigatório | Não consulta | ❌ |
| Tempo geração 1-3 dias | Métrica chave | 24 semanas | ❌ |
| Custom <30% | Critério ADR-101 | Não dimensiona | ❌ |
| Reuse map 70-85% | KPI obrigatório | Não calcula | ❌ |
| Validar ADR-101 | Propósito do piloto | Não declara | ❌ |
| 3 Pilares respeitados | Sim | Sim | ✅ |
| 17 tabelas, zero nova | Sim | Sim | ✅ |
| OOP polimorfismo (DClasse, idEstab, idLocEscritu) | Sim | Sim | ✅ |
| Output backend NestJS funcional | Sim | Sim | ✅ |

### Análise:

O V2 atende **4 de 12 critérios** (33%) — todos relativos à doutrina canônica do Devari-Core. Em **8 de 12 critérios estratégicos** (todos os que tornariam o V2 efetivamente um piloto do Generator), falha por ausência ou incompatibilidade.

A relação atual entre V2 e Generator é **paciente passivo**: V2 lê as rules do Devari-Core (`devari-3-pilares.md`, `devari-polymorphic-engine.md`, `devari-saas-generator.md`) como restrições de qualidade. Não é **co-validador** (executor da Stage 2) nem **fornece feedback** para a skill.

### Sintoma diagnóstico:

Se o V2 prosseguir com o plano atual, em 24 semanas teremos:
- ✅ Backend Scrumban-V2 funcional;
- ✅ 3 Pilares respeitados, 17 tabelas, regras canônicas;
- ❌ ADR-101 SEM VALIDAÇÃO EMPÍRICA (Stage 2 não foi exercitada);
- ❌ Skill `spec-to-yaml` SEM FEEDBACK V3 (intentions, MCP, Automation);
- ❌ Inventory desatualizado (lições aprendidas do V2 não propagadas);
- ❌ Meta 10-12 SaaS/ano fica adiada para outro projeto.

### Causa raiz:

Os 4 estrategistas trabalharam em paralelo seguindo a doutrina canônica do Devari-Core (rules, agents, hooks), mas **sem o briefing explícito** "este é o piloto do Generator". Cada um produziu seu sub-plano como se construir Scrumban-V2 fosse um fim em si, e não o exercício validador de uma decisão estratégica maior (ADR-101). A consolidação pelo 00-PLANO-MESTRE perpetuou essa premissa incorreta.

### Conclusão:

**V2 não é piloto válido do Generator.** Pode se tornar — com 1-2 dias de remediação imediata (§5.1) e 1 reunião de decisão estratégica (§5.2). Mas como está, executa a doutrina sem cumprir o propósito.

---

**Fim da auditoria PARTE-3 vs Plano V2.**

**Auditor:** Reviewer Devari-Core
**Data:** 2026-05-08
**Revisão recomendada:** após decisão de Caminho (A/B/C) no §5.2.
