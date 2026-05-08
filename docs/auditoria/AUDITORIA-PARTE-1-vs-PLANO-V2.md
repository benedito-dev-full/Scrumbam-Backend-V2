# Auditoria — PARTE-1 (Backend Core) vs Plano V2

**Versão:** 1.0
**Data:** 2026-05-08
**Auditor:** Reviewer Devari-Core (Opus 4.7 / 1M context)
**Audiência:** CEO + Tech Lead + Estrategistas (A, B, C, D)
**Status:** APROVAR COM RETRABALHO (ver veredicto §4)

**Escopo:**
- **Referência máxima auditada:** `Devari-Core/RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` (1816 linhas)
- **Plano sob auditoria:** `Scrumban-Backend-V2/docs/plano/{00..04}*.md` (5832 linhas, 5 arquivos)
- **Apoio (rules canônicas):** `devari-3-pilares.md`, `devari-polymorphic-engine.md`, `devari-backend-patterns.md`, `devari-saas-generator.md`

**Convenção de citação:**
- `P1:N` = `RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` linha N
- `P00:N` = `00-PLANO-MESTRE.md` linha N
- `P01:N` = `01-FUNDACAO.md` linha N
- `P02:N` = `02-DOMINIO-ENGINE.md` linha N
- `P03:N` = `03-INTEGRACOES.md` linha N
- `P04:N` = `04-HARDENING-HANDOFF.md` linha N

---

## 0. RESUMO EXECUTIVO (60 segundos)

- **Total de seções/tópicos auditados:** 91
- **Cobertura:**
  - ✅ COBERTO: 51 (56%)
  - ⚠️ PARCIAL: 22 (24%)
  - ❌ AUSENTE: 11 (12%)
  - 🟡 DIVERGÊNCIA EXPLÍCITA: 7 (8%)
- **Score geral consolidado:** **7,4/10**
- **Veredicto:** ⚠️ **APROVAR COM RETRABALHO** — fundação canônica é sólida e fiel ao espírito da PARTE-1 (17 tabelas, 3 Pilares, polimorfismo, Engine OOP), mas há **lacunas estruturais críticas** que precisam ser fechadas no plano antes de iniciar F1, sob pena de propagar dívida técnica desde a primeira linha de código.
- **3 lacunas mais críticas:**
  1. **Bug latente herdado em `_carregaScripts*` (P1:920):** o plano F6 menciona "corrigir" o bug `s.id` vs `s.chave` (P02:1231), mas não codifica isso como teste regressivo bloqueante. Risco de Scrumban V2 nascer com Dimensão 3 quebrada — exatamente como Dinpayz.
  2. **Convenção de chave do template (`?classe=NOME` string vs `?idClasse=N` numérico):** PARTE-1 P1:1376 documenta explicitamente que o `TabelaController` real usa `?classe=NOME`. O plano V2 padronizou em `?idClasse=N` (P01:283, P02:478) — divergência silenciosa do contrato canônico. Decisão precisa ser explícita em ADR.
  3. **Conflito de range de DClasses específicas vs PARTE-1 / regra `devari-3-pilares.md`:** o plano usa `-150..-499` para específicas Scrumban (P00:131-148), mas PARTE-1 P1:245 lista `-110` como teto das fixas e a rule canônica (`devari-3-pilares.md`) recomenda `-150+` por convenção. Já há colisões com classes do legado Dinpayz que estão no seed `src/classes/seeds/classes.ts` (-150 Config Antecipação aparece no Dinpayz; V2 sequestra para USER). O plano não documenta como o `templates/classes-base-template.ts` será higienizado para remover Dinpayz-específicas antes do V2 importar.

---

## 1. ÍNDICE DA PARTE-1 (extraído integralmente)

```
P1:1     # RELATÓRIO TÉCNICO DEVARI CORE — PARTE 1
P1:3     ## Backend Core: Modelo, Engine e Fundamentos Polimórficos
P1:22    ## SUMÁRIO
P1:38    ## 1. SUMÁRIO EXECUTIVO
P1:40       ### 1.1 O que é o "Backend" do Devari Core?
P1:50       ### 1.2 Quais 3 perguntas o template responde?
P1:58       ### 1.3 O que está NO template hoje vs. o que ainda é Dinpayz-específico
P1:69       ### 1.4 O que fica de pé como template universal (mesmo hoje)
P1:81    ## 2. AS 3 DIMENSÕES DE FLEXIBILIDADE
P1:91       ### 2.1 Onde elas se juntam (exemplo concreto)
P1:111      ### 2.2 Resumo executivo das 3 dimensões
P1:119   ## 3. O MODELO POLIMÓRFICO (DIMENSÃO 1)
P1:121      ### 3.1 Visão geral do schema
P1:135      ### 3.2 Tabela por tabela
P1:139         #### 3.2.1 DChave (obsoleta)
P1:156         #### 3.2.2 DClasse — O Sistema de Tipos
P1:251         #### 3.2.3 DEntidade — O Cadastro Universal
P1:293         #### 3.2.4 DTabela — Lookups, Configurações, Catálogos
P1:330         #### 3.2.5 DVincula — Hub de Relações Genéricas
P1:370         #### 3.2.6 DEvento — Audit Trail Universal
P1:402         #### 3.2.7 DPermissao — Permissões por Grupo
P1:421         #### 3.2.8 DUserGroup — Usuários e Grupos
P1:444         #### 3.2.9 DLicense — Licenciamento Multi-Tenant
P1:451         #### 3.2.10 DApiKey — Chaves de API
P1:478         #### 3.2.11 DPedido — Tabela Transacional Central
P1:519         #### 3.2.12 DTitulo — Títulos Financeiros
P1:542         #### 3.2.13 DMovDispo — Ledger Financeiro
P1:570         #### 3.2.14 DVFS — Virtual File System
P1:588         #### 3.2.15 WebhookEndpoint e WebhookDelivery
P1:597      ### 3.3 Padrões de Query Universais
P1:601         #### 3.3.1 idClasse — O determinante universal
P1:617         #### 3.3.2 idEstab — Hierarquia pai-filho
P1:632         #### 3.3.3 idLocEscritu — Local de escrituração
P1:647         #### 3.3.4 DVincula como hub
P1:658         #### 3.3.5 Anti-N+1
P1:679   ## 4. O ENGINE (DIMENSÃO 2)
P1:681      ### 4.1 Mapa de arquivos em src/engine/
P1:711      ### 4.2 Hierarquia OOP completa
P1:732      ### 4.3 Operacao (classe base)
P1:797      ### 4.4 OperacaoPedido (FULL workflow)
P1:999      ### 4.5 OperacaoBaixa
P1:1020     ### 4.6 OperacaoBaixaAutomatica
P1:1059     ### 4.7 OperacaoSaque (Dinpayz-específico)
P1:1074     ### 4.8 OperacaoAntecipacao (Dinpayz-específico)
P1:1095     ### 4.9 OperacaoMovimentacaoDisponivel
P1:1119     ### 4.10 OperacaoComissionamento
P1:1134     ### 4.10bis Auxiliares (PedidoCabecalho, PedidoItens, PedidoNegociacao, MovimentacaoItens)
P1:1211     ### 4.11 Os 4 Padrões de Extensão do Engine
P1:1226  ## 5. DVFS (DIMENSÃO 3)
P1:1228     ### 5.1 A tabela DVFS no schema
P1:1245     ### 5.2 Chaves fixas (3, 4, 5, 6, 7)
P1:1257     ### 5.3 Como o Engine carrega e executa
P1:1281     ### 5.4 Por que viabiliza portabilidade
P1:1308  ## 6. OS 3 PILARES OPERACIONAIS
P1:1312     ### 6.1 Pilar 1: Engine — onde se aplica e onde é violado
P1:1333     ### 6.2 Pilar 2: Endpoints Genéricos — mapa completo
P1:1335        #### 6.2.1 EntidadeController (/entidades)
P1:1356        #### 6.2.2 TabelaController (/tabela)
P1:1378        #### 6.2.3 ClasseController (/classes)
P1:1390        #### 6.2.4 Controllers específicos justificados
P1:1412     ### 6.3 Pilar 3: Seed de Classes
P1:1443  ## 7. ESTRUTURA DE src/ — MÓDULO POR MÓDULO
P1:1447     ### 7.1 src/auth, src/users, src/permissoes
P1:1457     ### 7.2 src/entidades
P1:1467        #### 7.2.1 Constantes hardcoded em entidades.service.ts
P1:1481        #### 7.2.2 Padrão de query polimórfica (count/findEntidades)
P1:1499        #### 7.2.3 Uso (parcial) de DatabaseService deprecated
P1:1505     ### 7.3 src/tabelas, src/classes
P1:1513     ### 7.4 src/eventos
P1:1533     ### 7.5 src/pagamento
P1:1542     ### 7.6 src/common
P1:1551     ### 7.7 src/database, src/prisma.service.ts
P1:1558     ### 7.8 Outros módulos relevantes
P1:1579  ## 8. BUILD E DEVOPS
P1:1581     ### 8.1 package.json
P1:1613     ### 8.2 tsconfig.json
P1:1617     ### 8.3 nest-cli.json
P1:1621     ### 8.4 Dockerfile, docker-compose.yml
P1:1625     ### 8.5 CI (bitbucket-pipelines.yml)
P1:1629     ### 8.6 .env.example
P1:1633     ### 8.7 Comandos de seed
P1:1670  ## 9. O QUE FAZ ESSE BACKEND SER TEMPLATE
P1:1672     ### 9.1 O que MUDA entre projetos
P1:1685     ### 9.2 O que NUNCA muda (estrutura)
P1:1702     ### 9.3 Métricas atuais
P1:1717  ## 10. GLOSSÁRIO
P1:1740  ## 11. APÊNDICE: ÍNDICE POR ARQUIVO
P1:1785  ## NOTAS FINAIS DO STRATEGIST
P1:1787     ### 11.1 O que ficou bem coberto
P1:1795     ### 11.2 Onde faltou tempo / profundidade
P1:1806     ### 11.3 Recomendações de próxima rodada
```

**Total de tópicos H1/H2/H3/H4 mapeados:** 91.

---

## 2. AUDITORIA POR CATEGORIA

A PARTE-1 organiza-se em 11 capítulos. Agrupei a auditoria nas categorias temáticas que tornam a análise mais útil:

- **2.1 Manifesto e Filosofia** (cap. 1, 2, 9)
- **2.2 Modelo Polimórfico — 17 tabelas e schema** (cap. 3.1, 3.2)
- **2.3 Padrões de Query Universais** (cap. 3.3)
- **2.4 Engine (Dimensão 2)** (cap. 4)
- **2.5 DVFS (Dimensão 3)** (cap. 5)
- **2.6 3 Pilares Operacionais** (cap. 6)
- **2.7 Estrutura de `src/` — módulo por módulo** (cap. 7)
- **2.8 Build, DevOps e Seeds operacionais** (cap. 8)
- **2.9 Glossário e Convenções** (cap. 10)

---

### 2.1 Manifesto e Filosofia

#### [1] — Sumário Executivo / Definição de Backend (P1:38-79)

**Referência (P1:38-79):** Backend Devari-Core é (a) sistema NestJS funcional, (b) planta estrutural / template, (c) demonstração viva de 3 ideias arquiteturais (schema polimórfico, Engine OOP, DVFS). NÃO é "API REST com tabelas para Sellers/Marketplaces/Pedidos" — é mecanismo de tipagem em runtime apoiado em DClasse + DEntidade + DTabela + Engine.

**Cobertura no plano V2:** P00:11-22 (Manifesto), P00:24-26 (1 frase do que estamos fazendo), P00:32-34 (eliminações vs legado), P01:12-27 (invariantes não-negociáveis), P01:42 ("disciplina canônica").

**Veredicto:** ✅ COBERTO

**Análise:** O plano V2 internaliza fortemente a tese da PARTE-1. Manifesto canônico no §0.1 (P00:15-22) cita 3 Pilares, 17 tabelas, "Pilar 1 finalmente ATIVADO via OperacaoExecucaoClaude", e cita explicitamente cada uma das 8 rules canônicas como fonte da verdade. P00:13 declara o `00-PLANO-MESTRE.md` como autoridade sobre divergências entre sub-planos.

**Score:** 9/10

**Ação corretiva:** nenhuma. Tese internalizada.

---

#### [2] — As 3 Perguntas que o Template Responde (P1:50-57)

**Referência (P1:50-57):** Tabela com 3 perguntas → resposta no código. Pergunta 1 (modelar dados): 14 tabelas core no schema atual. Pergunta 2 (processamento transacional): hierarquia OOP de 8 classes Engine. Pergunta 3 (customizar regras sem deploy): tabela DVFS com scripts via eval.

**Cobertura no plano V2:** P00:14-22 (3 Pilares ativos), P02:6.1 (Engine + DVFS), P01 todo (schema 17 tabelas), F1 P01:250 (Pilar 3).

**Veredicto:** ✅ COBERTO

**Análise:** Plano cobre as 3 perguntas, mas ELEVA a aposta: usa **17 tabelas** (não 14 como template atual) e PRETENDE usar DVFS de verdade (não dormente como Dinpayz). Isso é positivo — V2 é mais ambicioso que o estado atual do template. Risco: PARTE-1 P1:1279 alerta que DVFS está dormente no template; o plano V2 promete DVFS ativo (P02:1057, P02:1241). Validar maturidade do mecanismo.

**Score:** 8/10

**Ação corretiva:** Adicionar em F0/F1 ADR explícito: "V2 ativa DVFS (Dimensão 3) que está dormente no template atual. Riscos: bug do `s.id` vs `s.chave` (P1:920), eval() em runtime, falta de testes do mecanismo." — para que o time saiba que está sendo pioneiro.

---

#### [3] — O que está NO template hoje vs Dinpayz-específico (P1:58-67)

**Referência (P1:58-67):** Template ainda carrega 817 referências "Dinpayz" em 181 arquivos. `package.json:2` diz `devari-pay-banking-backend`. `src/main.ts:117` tem header X-Auth-Service Dinpayz. Módulos `pagamento/`, `antecipacao/`, `reconciliacao/` são fintech-específicos. OperacaoSaque + OperacaoAntecipacao são extensões Dinpayz. Plano de limpeza: 26 itens em 3 fases.

**Cobertura no plano V2:** P00:32-34 (eliminações vs legado, mas focado em Scrumban-legado, não em Dinpayz no template), P01:104-106 (eliminações no V2: DProjectMember, DNotification, DWebhook, DAgent, DExecution).

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** O plano V2 endereça muito bem o legado Scrumban (V1), mas **silencia sobre as 26 dívidas técnicas Dinpayz no Devari-Core** (P1:60-67, P1:1702-1713). Como o V2 vai *clonar* `Devari-Core/`, vai herdar essas dívidas. Por exemplo: `templates/classes-base-template.ts` referenciado em P01:301 e P02:300 — esse arquivo HOJE está misto (template + Dinpayz, conforme P1:245). O plano V2 importa do template canônico, mas não declara como esse template foi/será higienizado.

**Score:** 5/10

**Ação corretiva:**
1. Adicionar **F0.5** (entre F0 e F1) chamada **"Higienização de classes-base-template.ts"** — purga Dinpayz-específicas (-21 a -27 ped trans fintech, -12 a -19 títulos cartão, -150 Config Antecipação, etc.) deixando apenas as ~50 fixas verdadeiramente universais (-1 a -110 do canônico).
2. Adicionar ADR-V2-000 declarando que V2 NÃO clonará Devari-Core na sua forma atual — clonará apenas estruturas verdadeiramente universais.
3. Listar explicitamente quais módulos do template NÃO entram no V2 (`pagamento/`, `antecipacao/`, `reconciliacao/`, `OperacaoSaque`, `OperacaoAntecipacao`, `CardBrandDetectorService`).

---

#### [4] — As 3 Dimensões de Flexibilidade (P1:81-115)

**Referência (P1:81-115):** Tabela canônica das 3 dimensões. Dimensão 1 = Dados (DClasse + 17 tabelas com idClasse). Dimensão 2 = Comportamento (hierarquia OOP do Engine). Dimensão 3 = Configuração (DVFS scripts persistidos). Exemplo concreto Dinpayz vs pet shop. Maioria dos novos domínios precisa só da D1; alguns da D3; poucos da D2 (OperacaoSaque, OperacaoAntecipacao).

**Cobertura no plano V2:** P00:18-20 ("Pilar 1 finalmente ATIVADO via OperacaoExecucaoClaude — coração técnico do V2 que valida a Dimensão 2"), P02:6.1-6.2, P02:6.7 (esqueleto de OperacaoExecucaoClaude estendendo OperacaoPedido), P02:6.8 (DVFS scripts).

**Veredicto:** ✅ COBERTO

**Análise:** Plano V2 é o **caso de uso oficial de validação das 3 dimensões fora do domínio fintech**. P00:19 declara isso explicitamente. F6 toda materializa as 3 dimensões: D1 (DClasse -300/-301/-302/-303), D2 (OperacaoExecucaoClaude estende OperacaoPedido), D3 (4 scripts DVFS canônicos: risk-gate, command-validator, pr-auto-open, notification-dispatcher). É exatamente o que a PARTE-1 antecipa em P1:101-107 (exemplo pet shop) — só que mais ambicioso.

**Score:** 10/10

**Ação corretiva:** nenhuma. Aplicação exemplar da doutrina.

---

#### [5] — O que MUDA entre projetos (P1:1672-1684)

**Referência (P1:1672-1684):** Tabela com o que muda: seed DClasse, seeds DTabela, scripts DVFS, Engines extra, endpoints específicos (raros), módulos opcionais (`pagamento/`, `antecipacao/`, `reconciliacao/` ficam fora se não-fintech), DTOs/validações, enums.

**Cobertura no plano V2:** P00:38-68 (mapa de 17 fases — implicitamente cobre o que muda), P01:300-340 (lista de DClasses específicas Scrumban), P02:565-575 (DClasses específicas Engine), P03:108-122 (DClasses específicas integrações).

**Veredicto:** ✅ COBERTO

**Análise:** Plano segue o playbook canônico — muda DClasses (90+), muda alguns seeds DTabela (Sprints, Statuses, Priorities), inclui DVFS específicos (4 novos), CRIA Engine novo (OperacaoExecucaoClaude — Dimensão 2 ativada), mantém endpoints genéricos.

**Score:** 9/10

**Ação corretiva:** nenhuma significativa.

---

#### [6] — O que NUNCA muda (P1:1685-1701)

**Referência (P1:1685-1701):** Schema das 14 (sic — 17 conforme rule) tabelas core, hierarquia DClasse, convenção chave negativa = seed, idClasse/idEstab/idLocEscritu, Operacao base, OperacaoPedido workflow, OperacaoMovimentacaoDisponivel, endpoints genéricos `/entidades`, `/tabela`, `/classes`, sequence chcriacao_seq, padrões PrismaService/BigInt/Decimal/Transaction/Timezone.

**Cobertura no plano V2:** P00:17 (17 tabelas zero novas), P01:12-27 (12 invariantes), P02:283-307 (21 padrões obrigatórios consolidados), P02:G.1 (sequence chcriacao_seq).

**Veredicto:** ✅ COBERTO

**Análise:** Plano consagra TODOS os invariantes do template como "não-negociáveis". P00:15-22 + P01:12-27 são versões expandidas e mais explícitas que P1:1685-1701. Rigor enterprise.

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [7] — Métricas atuais do template (P1:1702-1713)

**Referência (P1:1702-1713):** 817 ocorrências Dinpayz, 15+ console.logs, 15+ TODO/FIXME, 16 READMEs em src/, 71 imports DatabaseService deprecated. Conclusão: template "funciona, mas tem dívida técnica significativa".

**Cobertura no plano V2:** P14 (hardening) — coverage ≥80%, eslint no-console error, no DatabaseService desde F0.

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano V2 começa do zero (greenfield), não herda essas dívidas. Mas como cita explicitamente que copia `templates/classes-base-template.ts` (P01:122), e como toda referência canônica do plano vem do Devari-Core misto, há risco de propagação silenciosa de Dinpayz-específicos. Ver ação corretiva do tópico [3].

**Score:** 6/10

**Ação corretiva:** Cruzar checklist do plano de limpeza (26 itens citados em P1:67) com os checks de F0 (P01:194-213). Certificar que os 26 itens estão cobertos, deferidos com ADR, ou explicitamente fora de escopo.

---

**Score consolidado da Categoria 2.1 — Manifesto e Filosofia:** **8,1/10**

**3 ações corretivas mais críticas da categoria:**
1. **Higienizar `templates/classes-base-template.ts`** antes da F1 (atualmente está misto template + Dinpayz).
2. **ADR-V2-000** declarando que V2 NÃO clona o template em sua forma atual — clona apenas o que é universal.
3. **Cruzar 26 itens do plano de limpeza Dinpayz** com os checks de F0 do V2.

---

### 2.2 Modelo Polimórfico — 17 tabelas e schema

#### [8] — Visão geral do schema: 14 vs 17 tabelas (P1:121-134)

**Referência (P1:121-134):** Template real tem 14 modelos no schema (10 estruturais, 3 transacionais, 1 infra) + 2 webhooks + 1 enum. **Faltam DRecurso, DTask, DProject, DMovDepos, DSolicita, DRequisic** vs canônico de 17. Doutrina é 17, prática é 14. Documentado como GAP CRÍTICO em `schema_vs_model_gap.md`.

**Cobertura no plano V2:** P01:14 (invariante #1: 17 tabelas), P01:280-296 (tabela das 17 com uso V2), P01:367-371 (REMOVER: DProjectMember etc.; ADICIONAR: DRecurso, DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS — "faltavam no template Devari-Core e no legado"), ADR-206 (P01:378).

**Veredicto:** ✅ COBERTO (e excede)

**Análise:** Plano V2 corrige a divergência da PARTE-1 implementando a **doutrina das 17** mesmo que algumas fiquem dormentes no V2 (DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic — P01:291-295). Isso é **rigoroso** — o V2 sai mais correto que o template-pai. Decisão arquitetural superior, embora aceitável apenas se o time absorve o custo de manter código que não usa.

**Score:** 9/10

**Ação corretiva:** Adicionar nota explícita em ADR-206 reconhecendo o trade-off: "V2 paga custo de manter 6 tabelas dormentes em troca de canonicidade. Decisão validada por CEO." Sem essa nota, há risco do trade-off ser questionado em fases futuras.

---

#### [9] — DChave (obsoleta) (P1:139-155)

**Referência (P1:139-155):** Tabela legacy. Sequence agora é `nextval('chcriacao_seq')` direto no PostgreSQL via `getNextSequenceKey()`. **Conclusão: ignorar em projetos novos.**

**Cobertura no plano V2:** P02:G.1 ("Seed da Fase 1 deve criar `CREATE SEQUENCE IF NOT EXISTS chcriacao_seq START WITH 1`"), P01:280 (DChave NÃO aparece na tabela das 17 do V2).

**Veredicto:** ✅ COBERTO

**Análise:** Plano elimina DChave corretamente. Sequence helper canônico em F6. P01 não inclui DChave nas 17 tabelas — alinhado.

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [10] — DClasse — Sistema de Tipos (P1:156-250)

**Referência (P1:156-250):** Tabela mais importante. Hierarquia em árvore via idPai. Convenção `chave < 0` = seed (dev, pre-deploy), `chave > 0` = runtime. Hierarquia das classes-base no template atual. Implementação seed em `src/classes/seeds/classes.seed.ts:14-68` (upsert idempotente).

**Cobertura no plano V2:** P01:380-431 (seed + validate-hierarchy.ts), P00:130-241 (mapa canônico de DClasses normalizadas), P01:300-340 (mapeamento legado→V2 com renumeração explícita).

**Veredicto:** ✅ COBERTO

**Análise:** Plano V2 trata DClasse com rigor profundo: validate-hierarchy.ts com 4 testes (P01:382-389), idempotência via upsert (P01:391-395), faixas reservadas explícitas (P00:131-148), renumeração corretiva (P01:306-340, ADR-201). Excede o padrão da PARTE-1.

**Score:** 9/10

**Ação corretiva:** P01:300-340 e P00:152-240 listam classes específicas mas há leve discrepância nos números (P00 lista ~70 específicas; P01:341 diz "~40 específicas"). Reconciliar a contagem antes de iniciar F1.

---

#### [11] — DEntidade — Cadastro Universal (P1:251-292)

**Referência (P1:251-292):** Tabela mais "gorda" (~50 campos). Polimorfismo via idClasse. Auto-relacionamentos (idEstab, idLocEscritu, idBanco, idIndicador). `piiEncrypted: Json?` é exceção legítima ao "não use Json" porque PII precisa de criptografia em camada própria. Usado para Plataforma (-49), Marketplace (-45), Seller (-47), Conta Virtual (-40), Sócio (-156), Usuário (-46).

**Cobertura no plano V2:** P01:281 (DEntidade — Users -150 (não -47!), Organizations -152 (não -50!), Teams -180, Agents -156), P00:155-159 (mapa canônico), P01:21 (não sequestrar canônicas -40, -45, -47, -49, -50).

**Veredicto:** 🟡 DIVERGÊNCIA EXPLÍCITA (mas justificada)

**Análise:** Plano V2 **renumera** as classes do legado (USER de -47 para -150, ORGANIZATION de -50 para -152, PLATFORM de -49 para -151) para "não sequestrar canônicas" (P01:304). Isso é correto em princípio (segue regra `devari-3-pilares.md` §"REGRA FUNDAMENTAL"). MAS — a PARTE-1 P1:236-238 cita `-49 Plataforma`, `-45 Marketplace`, `-47 Seller` como "Dinpayz-específico mas presente no seed" (P1:236). A doutrina PARTE-1 é ambígua: trata como Dinpayz-específicas (que poderiam ser limpas) e simultaneamente como reservadas.

A divergência aqui é com o **legado Scrumban V1**, não com a PARTE-1. PARTE-1 não objeta à decisão. Justificada.

**Score:** 8/10

**Ação corretiva:** Adicionar explicação em ADR-V2-002 (P00:336): "PARTE-1 P1:236-238 trata -45/-47/-49 como Dinpayz-específicas mas reservadas. V2 segue interpretação restritiva: reservadas significa 'não tocar em projetos derivados', portanto Scrumban USER/PLATFORM/ORG vai para -150+." Isso fecha possível questionamento futuro.

---

#### [12] — DTabela — Lookups, Configurações (P1:293-329)

**Referência (P1:293-329):** Substitui tabelas de lookup tradicionais. Polimorfismo via idClasse. 2 padrões: catálogo global (`dEntidadeId NULL`) ou config por entidade (`dEntidadeId = chave`). `metaDados: Json?` presente para fallback (fundador rejeita como solução padrão; sobrevive por legado fintech). Vários campos numéricos específicos fintech (mdr, taxaFixaPix, etc.).

**Cobertura no plano V2:** P01:282 (DTabela — Sprints, Statuses, Priorities, Task Types, Channels, Webhooks, Notifications, API Keys, MCP Keys), P02:5.5 (-400, -420, -430, -440, -450, -475 etc.).

**Veredicto:** ✅ COBERTO

**Análise:** Plano usa DTabela exatamente como prescrito — lookups (Statuses V3, Priorities) e configs por entidade (Webhooks, API Keys com `dEntidadeId=projectId`). P01:282 menciona `dados Json` mas a tabela DTabela canônica tem `metaDados` (não `dados`). Verificar consistência terminológica antes de F1.

**Score:** 8/10

**Ação corretiva:**
1. Reconciliar nomenclatura `dados` vs `metaDados` em DTabela. PARTE-1 P1:308 diz "`metaDados (Json?)`". Plano V2 P01:282 mistura "`dados`" e "`metaDados`". Padronizar antes da F1 ou colocar na F1 a tarefa de copiar fielmente do schema canônico.
2. Plano não documenta que DTabela tem ~30 campos fintech (mdr, taxaFixaPix, idAdquirente etc., P1:303-308). Em V2, esses campos ficam vazios mas ocupam espaço. ADR-206 cobre, mas vale explicitar custo de armazenamento.

---

#### [13] — DVincula — Hub de Relações (P1:330-369)

**Referência (P1:330-369):** Viabiliza ZERO tabelas novas. 3 padrões: N:N entidade-entidade (Seller↔Sócio), 1:N com lookup (Seller↔CNAE), Documentos (Seller→S3). Regra universal: `idLocEscritu = DONO do vínculo`. **GAP no schema atual:** canônico cita `idTabela` em DVincula para vínculo com lookup, mas esse campo NÃO EXISTE no `prisma/schema.prisma` atual — só `idEntidade` e `idLocEscritu`.

**Cobertura no plano V2:** P00:161-174 (mapa canônico de DVincula), P01:283 (DVincula — Org-User, Project-User, Project-Team, Team-User, Project-Agent), P02:E.2 (issue counter usa `metaDados` Json em DTabela).

**Veredicto:** ⚠️ COBERTURA PARCIAL — gap não-endereçado

**Análise:** Plano usa DVincula extensivamente para RBAC duplo (Org-User -160, Project-User -170) e excelentemente. **Porém, NÃO endereça o gap do `idTabela` em DVincula citado em P1:368.** Para Scrumban V2 isso pode não ser crítico (não há "Project↔CNAE" tipo lookup). Mas se F12 (Webhooks) ou F11 (MCP) precisarem ligar entidade a lookup, o caminho será via `metaDados.lookupId` em vez de FK tipada — perdendo type safety e índice eficiente.

**Score:** 6/10

**Ação corretiva:**
1. Adicionar em F1 ADR sobre **adicionar coluna `idTabela BigInt?` em DVincula** OU **deferir explicitamente** declarando que V2 não usa esse padrão. Sem decisão explícita, o gap se propaga.
2. Validar com Estrategista C se MCP/Webhook/Telegram-Link tem caso real de Entidade↔Lookup.

---

#### [14] — DEvento — Audit Trail (P1:370-401)

**Referência (P1:370-401):** Audit + eventos. Polimórfico via idClasse. **`idUsuario` aponta para DEntidade, não DUserGroup** (sutil mas crítico). `dados: Json?` é o "metaDados" deste model — usado para info variável. Índice `[identificadorExterno, idClasse]` permite buscar eventos por correlação externa.

**Cobertura no plano V2:** P00:206-219 (mapa canônico de DEvento -490..-501), P01:284 (DEvento — audit trail completo), P02:7 (Eventos canônicos via DEvento + EventProducerService), P03 múltiplos pontos (TELEGRAM_MSG_IN -493, MCP_CALL -495 etc.).

**Veredicto:** ✅ COBERTO

**Análise:** Plano usa DEvento extensivamente, exatamente como prescrito. Padrão #7 (eventos APÓS persistência) consagrado em P02:6.7 OperacaoExecucaoClaude.grava(). DEvento substitui DNotification do legado (P00:342, ADR-V2-008).

**Score:** 9/10

**Ação corretiva:** Validar que o plano adota o padrão `idUsuario → DEntidade` (não DUserGroup) explicitamente. PARTE-1 P1:398 destaca que isso é "diferença sutil mas crítica" — deve aparecer na rule `devari-backend-patterns.md` §5 e ser obrigatório no plano. P02:5.7 menciona `EntidadeService.getEntidadeIdFromUserGroup` mas não verifiquei se DEvento.idUsuario é populado corretamente em todas as fases. Adicionar DoD em F7: "DEvento.idUsuario sempre = DEntidade.chave (jamais DUserGroup.chave). Tests cobrem."

---

#### [15] — DPermissao (P1:402-419)

**Referência (P1:402-419):** Permissões por grupo. Função (string) checada por decoradores hierárquicos.

**Cobertura no plano V2:** P01:286 (DPermissao — permissões além das 3 cargos básicos), P01:786-792 (módulo permissoes/), P01:840-842 (PermissoesService CRUD admin-only).

**Veredicto:** ✅ COBERTO

**Análise:** Plano usa DPermissao para granularidade além dos 3 cargos (ADMIN/MEMBER/VIEWER). RBAC base via DVincula -160/-170 (cargo via idClasse), permissões finas via DPermissao. Coerente.

**Score:** 9/10

**Ação corretiva:** nenhuma.

---

#### [16] — DUserGroup — Usuários e Grupos (P1:421-443)

**Referência (P1:421-443):** Mesma tabela armazena usuários (folhas com usuario+senha) e grupos (nós sem credenciais). idClasse distingue. **Padrão obrigatório:** `EntidadeService.getEntidadeIdFromUserGroup(userId)` para FKs financeiras (DPedido, DTitulo) que esperam DEntidade.chave, não DUserGroup.chave.

**Cobertura no plano V2:** P01:286 (DUserGroup — credenciais + refreshTokenHash + mcpKeyHash em `dados` Json), P01:705-892 (Auth completo F3), P01:807 ("dUserGroupId = newUserGroup.chave"), múltiplas referências a getEntidadeIdFromUserGroup (P01:574, P02:5.7).

**Veredicto:** ✅ COBERTO

**Análise:** Plano segue à risca o padrão. DUserGroup só credenciais; DEntidade-150 USER vinculada via dUserGroupId. JWT carrega ambos os IDs. Excelente.

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [17] — DLicense (P1:444-450)

**Referência (P1:444-450):** Representa licença do sistema (cnpj, razão social, qtdLicencas, expiração, token). Não é polimórfica.

**Cobertura no plano V2:** **AUSENTE** — DLicense não aparece em nenhum dos 5 arquivos do plano V2.

**Veredicto:** ❌ AUSENTE

**Análise:** Plano V2 NÃO menciona DLicense. PARTE-1 lista entre as 14 tabelas reais do schema atual (P1:127). O plano V2 lista 17 tabelas (P01:280-296) e DLicense não está nelas — está implícito porque P00:17 fala de "17 tabelas canônicas" mas a lista de P01:280 só tem 17 sem DLicense (substituída por outras). Hmm, contar:

Tabelas em P01:280: DClasse, DEntidade, DTabela, DVincula, DEvento, DRecurso, DUserGroup, DPermissao, DTask, DProject, DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS = **17 sem DLicense** (e sem DApiKey).

Hmm, a doutrina canônica de `devari-polymorphic-engine.md` Seção 2 lista exatamente essas 17. PARTE-1 P1:127 inclui DApiKey e DLicense entre as 14 reais do schema atual mas elas NÃO estão nas 17 doutrinárias. Há **divergência interna na PARTE-1**.

**Score:** 5/10

**Ação corretiva:**
1. ADR-V2-001 (P00:335) declara explicitamente que V2 segue exatamente as 17 da rule `devari-polymorphic-engine.md` (DClasse, DEntidade, DTabela, DVincula, DEvento, DRecurso, DUserGroup, DPermissao, DTask, DProject, DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS).
2. Documentar destino de **DLicense** e **DApiKey** que existem no template atual (P1:444-477): V2 abandona DLicense (não há licenciamento multi-tenant); V2 usa DTabela -475 para API Keys (P00:198, ADR-V2-004) em vez de DApiKey. Coerente, mas precisa estar explícito no plano.

---

#### [18] — DApiKey (P1:451-477)

**Referência (P1:451-477):** API Keys com rate limit, IP whitelist, expiração, ambiente production/sandbox, permissões em Json. Tabela própria do template atual.

**Cobertura no plano V2:** P00:198 (API_KEY -471 em DTabela), ADR-V2-004 (P00:338): "API Keys e MCP Keys via DTabela (não colunas próprias)".

**Veredicto:** 🟡 DIVERGÊNCIA EXPLÍCITA (justificada)

**Análise:** PARTE-1 mostra DApiKey como tabela existente. V2 substitui por DTabela polimórfica via ADR. Decisão consciente e bem justificada. Coerente com tese "ZERO tabelas novas, máximo polimorfismo".

**Score:** 9/10

**Ação corretiva:** ADR-V2-004 deve documentar trade-off: perde-se rate limit em coluna dedicada, ipWhitelist, expiração — tudo passa para `dados` Json. Validar em F3 que `dados` cobre todos os campos relevantes.

---

#### [19] — DPedido — Tabela Transacional Central (P1:478-518)

**Referência (P1:478-518):** Tabela central. Estados PENDENTE → APROVADO → BAIXADO. **Crítico:** template NÃO permite `prisma.dPedido.create()` direto. Sempre via Engine. Reviewer rejeita. Campos fintech-pesados (idAdquirente, splitRules, taxaadquirente etc.) — em template genérico ficariam vazios.

**Cobertura no plano V2:** P01:290 (DPedido — Pilar 1 ativado: cada execução de Claude Code = 1 DPedido idClasse=-491 EXECUCAO_CLAUDE), P02 toda fase 6 (OperacaoExecucaoClaude estende OperacaoPedido), P02:6.7 (esqueleto completo).

**Veredicto:** ✅ COBERTO (e excede)

**Análise:** Plano V2 é o caso paradigmático de uso de DPedido fora de fintech. Engine workflow (nova/calcula/aprova/grava) preservado. Risk Gate é DVFS chave 3. Beautiful adoption.

**Score:** 10/10

**Ação corretiva:** nenhuma. (Mas — pequeno detalhe: P00:340 ADR-V2-005 fala em -300 EXECUTION mas P01:290 fala -491. Conflito interno do plano. P00:251 admite que "Execution sai do range -49X; vai para -300..-303 (Pedidos)". P01:336 ainda lista -491 EXECUCAO_CLAUDE. **Reconciliar antes da F1.** Já listado em §3.3 como conflito resolvido em P00:243-256, mas P01 não foi atualizado em consonância.)

---

#### [20] — DTitulo (P1:519-541)

**Referência (P1:519-541):** Contas a pagar e a receber **na mesma tabela**, diferenciadas por idClasse. Gerada via baixa de DPedido. Estados análogos. Conta dupla (`idContaOrigem`, `idContaDestino`).

**Cobertura no plano V2:** P01:291 ("DTitulo — Reservada — não usada hoje, schema disponível"), P01:295-296 idem.

**Veredicto:** ✅ COBERTO (decidido como dormente)

**Análise:** Plano explicitamente reserva DTitulo no schema mas não usa. Coerente com doutrina das 17 + ADR-206. Custo de manter código não-usado, ganho de canonicidade.

**Score:** 8/10

**Ação corretiva:** nenhuma significativa.

---

#### [21] — DMovDispo — Ledger Financeiro (P1:542-569)

**Referência (P1:542-569):** Cada registro = lançamento no extrato. valor positivo = entrada, negativo = saída. Saldo = SUM(valor). **Princípio da partida dobrada** enforced pelo Engine.

**Cobertura no plano V2:** P01:292 ("DMovDispo — Reservada — saldo/extrato financeiro futuro"), idem para DMovDepos, DSolicita, DRequisic.

**Veredicto:** ✅ COBERTO (dormente)

**Análise:** Idem [20]. Schema implementado, uso futuro.

**Score:** 8/10

**Ação corretiva:** nenhuma.

---

#### [22] — DVFS — Virtual File System (P1:570-587)

**Referência (P1:570-587):** Esta é a Dimensão 3. Tabela armazena scripts JS executados pelo Engine via eval() em momentos específicos. **Estado atual: dormente** — chamadas comentadas em OperacaoPedido (P1:1279).

**Cobertura no plano V2:** P02:1057-1213 (4 scripts canônicos completos: risk-gate-validator, command-validator, pr-auto-open, notification-dispatcher), P02:H.1-H.3 (DVFS seed), P02:6.7 (OperacaoExecucaoClaude consome scripts).

**Veredicto:** ✅ COBERTO (e ATIVA o que estava dormente)

**Análise:** **Maior contribuição arquitetural do V2 ao Devari-Core.** Plano materializa a Dimensão 3 que está dormente no template há anos. 4 scripts canônicos com lógica real (50+ patterns adversariais para Risk Gate). Excelente.

**Score:** 10/10

**Ação corretiva:** nenhuma. (Mas atenção ao bug `s.id` vs `s.chave` mencionado em [23].)

---

#### [23] — Bug latente em `_carregaScripts*` (P1:920-924, P1:1300-1302)

**Referência (P1:920-924):** Linha 314-316 de `OperacaoPedido.ts` filtra por `script.id` em vez de `script.chave`. Schema não tem coluna `id` (PK é `chave`). **`_funcPosCalculo` provavelmente nunca é carregado**. Mesmo bug em `_carregaScriptsGrav()` (P1:924). Bug latente — vale registrar como dívida técnica. P1:1810 recomenda "validar bug de s.id vs s.chave em OperacaoPedido._carregaScripts*".

**Cobertura no plano V2:** P02:1231 menciona "**CORRIGIR o bug latente identificado no RELATORIO linha 314 (s.id vs s.chave) — usar `s.chave` consistentemente.**"

**Veredicto:** ⚠️ COBERTURA PARCIAL — menciona mas não codifica defesa

**Análise:** Plano reconhece o bug e diz para corrigir. **MAS** não exige teste regressivo bloqueante que prove que `_funcPosCalculo` E `_funcPosGravacao` sejam carregados. Se o Implementer "esquecer" de corrigir (ou corrigir mal), o V2 nasce com Dimensão 3 quebrada exatamente como Dinpayz — pior, com a falsa sensação de funcionamento porque os outros 3 scripts (chaves 3, 4, 7) carregam OK.

**Score:** 5/10

**Ação corretiva:** Adicionar em F6 DoD obrigatório:
- [ ] Teste de integração que cria 5 linhas DVFS (chaves 3, 4, 5, 6, 7), instancia OperacaoPedido, chama nova(), e verifica que op._funcPreCalculo, _funcCalculo, _funcPosCalculo, _funcPreGravacao e _funcPosGravacao são funções (não null).
- [ ] Teste adversarial: linha DVFS chave 5 que faz `op.dados.testFlag = true`. Após op.calcula(), verificar que testFlag === true. Se permanecer undefined, _funcPosCalculo não foi carregado/executado.

---

#### [24] — WebhookEndpoint e WebhookDelivery (P1:588-595)

**Referência (P1:588-595):** Específicos do gateway de pagamento (Dinpayz). **Avaliação:** "Dinpayz-específicos. Em SaaS genérico, manter como módulo opcional. Não são parte do core polimórfico."

**Cobertura no plano V2:** P00:342 ADR-V2-008 ("DEvento substitui DNotification e DWebhook attempts"), P03:519-533 (Webhooks via DTabela -470 + DEvento -491).

**Veredicto:** ✅ COBERTO (e melhora)

**Análise:** Plano V2 ELIMINA WebhookEndpoint/WebhookDelivery do schema, substituindo por DTabela polimórfica + DEvento polimórfico. Coerente com doutrina ZERO tabela nova / ZERO tabela específica. Avanço sobre o template atual.

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

**Score consolidado da Categoria 2.2 — Modelo Polimórfico:** **8,2/10**

**3 ações corretivas mais críticas da categoria:**
1. **Resolver gap `idTabela` em DVincula** (P1:368) — adicionar coluna ou ADR de não-uso.
2. **Reconciliar nomenclatura `dados` vs `metaDados`** entre tabelas (P1:308 vs P01:282).
3. **Codificar teste regressivo do bug `s.id` vs `s.chave`** em F6 (P1:920) com 2 specs adversariais bloqueantes.

---

### 2.3 Padrões de Query Universais

#### [25] — idClasse: O determinante universal (P1:601-616)

**Referência (P1:601-616):** Toda query polimórfica COMEÇA por idClasse. Sem idClasse, não se sabe O QUE se está buscando.

**Cobertura no plano V2:** Universal no plano. P01:564 (ParseBigIntPipe), P01:567 (idClasse obrigatório em listagem), P02:5.7-A.1 (findManyByClasse).

**Veredicto:** ✅ COBERTO

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [26] — idEstab: Hierarquia pai-filho (P1:617-631)

**Referência (P1:617-631):** Cria árvore. Plataforma → Marketplace → Seller. Query: `where: { idEstab: marketplaceId, idClasse: BigInt(-47) }`.

**Cobertura no plano V2:** P01:282-283 (idEstab em hierarquia), P01:567 (filtro idEstab em ListEntidadeQueryDto).

**Veredicto:** ✅ COBERTO

**Score:** 9/10

**Ação corretiva:** nenhuma.

---

#### [27] — idLocEscritu: Local de escrituração (P1:632-646)

**Referência (P1:632-646):** Indica "dono" de algo. Em DEntidade (conta virtual aponta seller), DVincula (dono do vínculo), DPedido/DTitulo.

**Cobertura no plano V2:** P00:163-174 (DVincula com idLocEscritu = org/project/team), P02:5.7-B.1 (createOrganization usa idLocEscritu corretamente).

**Veredicto:** ✅ COBERTO

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [28] — DVincula como hub (P1:647-657)

**Referência (P1:647-657):** Buscar todos os vínculos de um seller em 1 query. Filtrar por tipo no JS. ZERO N+1.

**Cobertura no plano V2:** P02:RoleResolverService (P01:824-828) faz exatamente esse padrão. Cache 5min para evitar N+1.

**Veredicto:** ✅ COBERTO

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [29] — Anti-N+1 (P1:658-676)

**Referência (P1:658-676):** Padrão obrigatório. Reviewer rejeita N+1. Use include/JOIN, não loop.

**Cobertura no plano V2:** P00:293 (Padrão #6), P01:644 (DoD F2 inclui N+1 verificado), P02:E.6 (Tasks include otimizado), P04:14.6.7 (N+1 sweep — top 30 endpoints validados ≤5 queries).

**Veredicto:** ✅ COBERTO (e ENFORÇADO)

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

**Score consolidado da Categoria 2.3 — Padrões de Query:** **9,8/10**

**Ações corretivas:** nenhuma significativa. Categoria 100% coberta.

---

### 2.4 Engine (Dimensão 2)

#### [30] — Mapa de arquivos em src/engine/ (P1:681-710)

**Referência (P1:681-710):** Estrutura `helpers/sequence.helper.ts` (74L) + `lib/auxiliares/{pedido,movimentacao}/` + `lib/operacao/{Operacao,OperacaoPedido,OperacaoBaixa,OperacaoBaixaAutomatica,OperacaoSaque,OperacaoAntecipacao,OperacaoMovimentacaoDisponivel,OperacaoComissionamento}.ts`. **Importante:** OperacaoMovDeposito, OperacaoReprocessaMovDispo não foram localizados no template atual.

**Cobertura no plano V2:** P02:577-627 (estrutura `src/engine/{lib/operacao/{Operacao, OperacaoPedido, OperacaoExecucaoClaude}, lib/auxiliares/{PedidoCabecalho, PedidoItens, PedidoItem}, lib/interfaces/{...}, helpers/{sequence, dvfs-loader, execution-context}, dvfs/{...}}`).

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano cobre a estrutura essencial (Operacao base + OperacaoPedido + OperacaoExecucaoClaude). NÃO inclui OperacaoBaixa/OperacaoBaixaAutomatica/OperacaoMovimentacaoDisponivel/OperacaoComissionamento. Para Scrumban V2 isso é OK (não há lógica financeira). Para Devari-Core como template raiz, isso seria incompleto. O ADR-206 (P01:378) diz "schema inclui as 17 tabelas mesmo as não-usadas (DTitulo, DMovDispo etc.)" — mas o plano NÃO diz que vai incluir os Engines correspondentes mesmo dormentes.

**Score:** 6/10

**Ação corretiva:** Adicionar em F6 ADR explícito: "V2 implementa apenas Operacao (base) + OperacaoPedido + OperacaoExecucaoClaude. NÃO implementa OperacaoBaixa/OperacaoBaixaAutomatica/OperacaoMovimentacaoDisponivel/OperacaoComissionamento porque domínio Scrumban não usa lógica financeira. Engines podem ser implementados em derivações futuras." Sem essa nota, há inconsistência entre 'schema inclui dormentes' e 'engine não inclui dormentes'.

---

#### [31] — Hierarquia OOP completa (P1:711-731)

**Referência (P1:711-731):** Diagrama da árvore Operacao → OperacaoPedido → {OperacaoBaixa → OperacaoBaixaAutomatica, OperacaoSaque, OperacaoAntecipacao} + Operacao → OperacaoMovimentacaoDisponivel + OperacaoComissionamento (standalone).

**Cobertura no plano V2:** P02:6.6 (mostra apenas Operacao + OperacaoPedido + OperacaoExecucaoClaude — subset).

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Idem [30]. Hierarquia minimizada para Scrumban V2.

**Score:** 7/10

**Ação corretiva:** idem [30].

---

#### [32] — Operacao (classe base) (P1:732-796)

**Referência (P1:732-796):** Classe mínima (54 linhas). `IOperacaoConstruct {usuario, classe, bd}`. `erro()`, `nova()`. `nova()` chama `getNextSequenceKey()` via `nextval('chcriacao_seq')`.

**Cobertura no plano V2:** P02:G.2 ("Criar src/engine/lib/operacao/Operacao.ts (classe abstrata, ~80 linhas) seguindo o blueprint do RELATORIO seção 4.3"), P02:G.1 (sequence helper).

**Veredicto:** ✅ COBERTO

**Análise:** Plano replica fielmente a Operacao base. ~80 linhas vs 54 do template — pequeno excesso, talvez por adicionar JSDoc.

**Score:** 9/10

**Ação corretiva:** nenhuma.

---

#### [33] — OperacaoPedido (FULL workflow) (P1:797-998)

**Referência (P1:797-998):** ~1500 linhas. Interface com 12+ services injetáveis (PaymentProcessorService, EventProducer, CardBrandDetector, etc. — fintech-pesado). Atributos: pedidoCab, pedido, negociacaoPedido, _funcPreCalculo etc. Constructor com Proxy de cache invalidation. nova() chama _carregaScripts*. validarCampos. calcula (atualmente comentado). aprova. desaprova/cancela/etc. **grava() é o método mais longo (~300 linhas)** — mistura persistência + payment + settlement + compensation + telemetry. **Ponto-chave:** "este `grava()` é um dos maiores anti-padrões de coupling do template."

**Cobertura no plano V2:** P02:G.3 ("Criar OperacaoPedido (~800 linhas) — seguindo blueprint da seção 4.4 do RELATORIO mas SIMPLIFICADO para Scrumban V2 (remover acoplamento fintech: paymentProcessor, settlement, antifraud — todos opcionais, ausentes no V2). Workflow completo (calcula com DVFS 3,4,5; aprova; grava com DVFS 6,7) deve estar funcional. **CORRIGIR o bug latente identificado** [...]"), P02:6.7 (esqueleto completo de OperacaoExecucaoClaude estendendo).

**Veredicto:** ⚠️ COBERTURA PARCIAL — risco arquitetural

**Análise:** Plano reconhece o problema (acoplamento fintech) e diz para "simplificar". Mas SIMPLIFICAR um arquivo de 1500 linhas é tarefa de pesquisa+desenvolvimento, não de "implementar conforme blueprint". Há risco real de:
- Implementer simplificar de mais e quebrar invariantes do Engine
- Implementer simplificar de menos e arrastar acoplamento fintech (PaymentProcessor injetado mas opcional → ainda assim no construtor → poluição)
- Bug do `s.id` vs `s.chave` (P1:920) — mencionado em P02:1231 mas sem teste

A `grava()` do template tem 300+ linhas misturando responsabilidades — herdar esse design é dívida desde dia 1. Em V2 sem fintech, deveria ser muito menor. Plano não detalha COMO simplificar (que linhas remover, que abstrações criar para PaymentProcessor opcional não poluir o tipo).

**Score:** 5/10

**Ação corretiva:**
1. Adicionar em F6 (subfase) **"Análise de simplificação de OperacaoPedido"** com checklist explícito: quais services injetáveis ficam (eventProducer? telemetry?), quais saem (paymentProcessor, settlement, antifraud, taxationService, cardBrandDetector, autoScaling, circuitBreaker, intelligentRetry, unifiedSettlementTrigger, paymentCompensation), e qual é a interface mínima.
2. Adicionar DoD: "OperacaoPedido em V2 tem ≤500 linhas (vs 1500 do template) e ≤4 services injetáveis (vs 12+)."
3. Tornar explícito: V2 NÃO herda `grava()` de 300 linhas. Reescrever com responsabilidades separadas (persistência via super, eventos via post-hook). Pelo menos um ADR justificando o redesign.

---

#### [34] — OperacaoBaixa (P1:999-1018)

**Referência (P1:999-1018):** 12 linhas — placeholder vazio. Herda 100% de OperacaoPedido. P1:1811 sugere "avaliar se OperacaoBaixa (placeholder vazio) deve ser removido ou se vai ganhar carne."

**Cobertura no plano V2:** AUSENTE (V2 não implementa OperacaoBaixa).

**Veredicto:** ❌ AUSENTE (mas justificado para Scrumban)

**Score:** 7/10

**Ação corretiva:** Conforme [30]: ADR explicitando que V2 não herda OperacaoBaixa por irrelevância para o domínio.

---

#### [35] — OperacaoBaixaAutomatica (P1:1020-1057)

**Referência (P1:1020-1057):** 30 linhas. Override mínimo (`_baixaAutom = true`, `_baixado = null` após aprova). **"É o exemplo 'didático' do que o Engine permite."**

**Cobertura no plano V2:** AUSENTE.

**Veredicto:** ❌ AUSENTE (mas justificado)

**Score:** 7/10

**Ação corretiva:** idem [34].

---

#### [36] — OperacaoSaque (Dinpayz-específico) (P1:1059-1073)

**Referência (P1:1059-1073):** ~880 linhas. Workflow custom de saque PIX. **"NÃO é genérico. 100% fintech. Em template puro, ficaria em módulo opcional pagamento/."**

**Cobertura no plano V2:** AUSENTE — corretamente.

**Veredicto:** ✅ COBERTO (por exclusão deliberada)

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [37] — OperacaoAntecipacao (Dinpayz-específico) (P1:1074-1094)

**Referência (P1:1074-1094):** ~500 linhas. Sobrescreve `_carregaScripts*` para retornar void. Acesso direto ao Prisma (linhas 60-69 de OperacaoAntecipacao) — bypassa Engine parcialmente. **"NÃO genérico. Específico de fintech."**

**Cobertura no plano V2:** AUSENTE — corretamente.

**Veredicto:** ✅ COBERTO (por exclusão deliberada)

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [38] — OperacaoMovimentacaoDisponivel (P1:1095-1118)

**Referência (P1:1095-1118):** ~250 linhas. Estende Operacao direto. **"GENÉRICO. Qualquer SaaS que precise de 'ledger financeiro' usa este Engine sem modificações."** Métodos: calcularSaldo, gerarExtrato, validarSaldoParaDebito etc.

**Cobertura no plano V2:** AUSENTE — Scrumban V2 não tem ledger financeiro.

**Veredicto:** ⚠️ COBERTURA PARCIAL — preocupante para template raiz

**Análise:** Para Scrumban V2 OK (sem dimensão financeira). Mas se V2 também serve de "demonstração canônica" do Devari-Core renovado, fica meia. Decisão depende do escopo de V2: é só Scrumban ou é Devari-Core renovado também?

**Score:** 7/10

**Ação corretiva:** Decidir e documentar: V2 = Scrumban-only OU V2 = Scrumban + nova versão limpa do template. Se a segunda, deve incluir OperacaoMovimentacaoDisponivel mesmo dormente. Se a primeira, deve haver F0 que diferencie "código que vai para V2 prod" de "código que volta para Devari-Core como template renovado".

---

#### [39] — OperacaoComissionamento (P1:1119-1133)

**Referência (P1:1119-1133):** Standalone. Bug latente: `idClasse: '61e64ab2acd9bf3a40a9269e'` — ObjectId Mongo, não BigInt. Possível resíduo de migração Mongo→Postgres.

**Cobertura no plano V2:** AUSENTE.

**Veredicto:** ❌ AUSENTE (mas justificado)

**Score:** 7/10

**Ação corretiva:** Reportar bug ao próprio Devari-Core (separadamente do plano V2).

---

#### [40] — Auxiliares do Engine (P1:1134-1210)

**Referência (P1:1134-1210):** PedidoCabecalho (49 linhas), PedidoItens/PedidoItem, PedidoNegociacao, PedidoSugestao, MovimentacaoItens/MovimentacaoItem. **Importante:** o item carrega `recurso, acrescimoItem, descontoItem, ipi` — campos que NÃO ESTÃO no schema Prisma atual. Resíduo MongoDB.

**Cobertura no plano V2:** P02:G.4 ("Criar auxiliares: PedidoCabecalho.ts, PedidoItens.ts, PedidoItem.ts (versões simplificadas — Execution não tem itens múltiplos, apenas cabeçalho)").

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano simplifica. Para Execution não precisa de itens múltiplos. OK. Mas não menciona o gap identificado em P1:1191 (campos `recurso, acrescimoItem` etc. no item em memória mas ausentes no schema). Se V2 herdar PedidoItens com esses campos, terá os mesmos campos órfãos. Plano ignora.

**Score:** 6/10

**Ação corretiva:** Em F6 G.4: explicitar que PedidoItens/PedidoItem em V2 NÃO terá os campos órfãos (recurso, acrescimoItem, descontoItem, ipi). Lista de campos canônica em ADR.

---

#### [41] — Os 4 Padrões de Extensão do Engine (P1:1211-1223)

**Referência (P1:1211-1223):** Tabela canônica: Full (estende OperacaoPedido), Parcial (override _carregaScripts*), Simplificado (estende Operacao direto), Standalone (sem herança).

**Cobertura no plano V2:** P02:6.7 OperacaoExecucaoClaude usa padrão **Full** (estende OperacaoPedido). P02:1235 cobre.

**Veredicto:** ✅ COBERTO

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

**Score consolidado da Categoria 2.4 — Engine:** **7,3/10**

**3 ações corretivas mais críticas da categoria:**
1. **F6 — Análise de simplificação de OperacaoPedido** com checklist explícito de quais services ficam/saem, alvo ≤500 linhas vs 1500 do template.
2. **F6 DoD — testes regressivos** que provem que `_funcPosCalculo` e `_funcPosGravacao` são carregados (defesa contra bug `s.id` vs `s.chave`).
3. **ADR explícito** sobre quais Engines NÃO entram em V2 (OperacaoBaixa, OperacaoMovimentacaoDisponivel etc.) com justificativa de domínio.

---

### 2.5 DVFS (Dimensão 3)

#### [42] — Tabela DVFS (P1:1228-1244)

**Referência (P1:1228-1244):** Schema simples. Campo `script: String` armazena código JS. Cada linha = um script.

**Cobertura no plano V2:** P01:296 (DVFS — Scripts de Engine, Pilar 1, chaves 3, 4, 5, 6, 7), P02:H.2 (seed dvfs).

**Veredicto:** ✅ COBERTO

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [43] — Chaves fixas 3, 4, 5, 6, 7 (P1:1245-1256)

**Referência (P1:1245-1256):** Hardcoded em OperacaoPedido.ts:294-300, 329-334. Pré-cálculo (3), Cálculo (4), Pós-cálculo (5), Pré-gravação (6), Pós-gravação (7).

**Cobertura no plano V2:** P02:6.8 documenta os 4 scripts canônicos com suas chaves. P02:1245 (seed insere 3, 4, 7 + comentário "5,6 vazios para Scrumban V2 (preparados para extensão)").

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano só usa 3 das 5 chaves (3, 4, 7 — pula 5 pré-cálculo e 6 pré-gravação). É uma decisão consciente (P02:1248 "5,6 vazios"). MAS — se _funcPosCalculo (chave 5) e _funcPreGravacao (chave 6) ficam vazios, o teste regressivo do bug `s.id` vs `s.chave` (ver [23]) NÃO pega o bug — porque chaves 5 e 6 não são exercitadas. Falsa sensação de segurança.

**Score:** 6/10

**Ação corretiva:** Mesmo que Scrumban V2 não use chaves 5 e 6 em produção, F6 DoD deve incluir teste integration que **insere scripts dummy nas 5 chaves (3, 4, 5, 6, 7)** e prova que todos carregam corretamente. Sem isso, V2 nasce com a Dimensão 3 metade quebrada (mesma armadilha do Dinpayz).

---

#### [44] — Como o Engine carrega e executa (P1:1257-1280)

**Referência (P1:1257-1280):** `_carregaScriptsCalc` busca chaves 3, 4, 5. `_carregaScriptsGrav` busca 6, 7. Usa `eval()`. **Estado atual: chamadas comentadas em OperacaoPedido.ts:503-505.**

**Cobertura no plano V2:** P02:G.5 ("Criar dvfs-loader.helper.ts: utilitário centralizado para carregar scripts DVFS por chave (in-memory cache, invalidate via TTL ou flag)"), P02:6.8 (scripts CHAMADOS em calcula() pelo super-class).

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano CRIA `dvfs-loader.helper.ts` (novo, não no template). E PROMETE descomentar as chamadas (`_funcPreCalculo` etc.) em OperacaoPedido.calcula(). Boa decisão. **Mas não menciona explicitamente que vai descomentar.** P1:1279 alerta que o template tem chamadas comentadas em P1:503-505 — V2 precisa descomentar (ou riskar Dimensão 3 dormente).

**Score:** 7/10

**Ação corretiva:** Em F6 G.3 ou G.5, adicionar requisito explícito: "OperacaoPedido.calcula() em V2 EXECUTA `_funcPreCalculo`, `_funcCalculo`, `_funcPosCalculo` (atualmente comentadas no template). Se for null, log warn (não erro). Test integration prova execução end-to-end."

---

#### [45] — Por que viabiliza portabilidade (P1:1281-1304)

**Referência (P1:1281-1304):** Promessa: "Mesmo código Engine + Scripts DVFS diferentes = Comportamento diferente." Convite arquitetural mais que realidade hoje.

**Cobertura no plano V2:** P00:341 ADR-V2-007 ("DVFS scripts como mecanismo de portabilidade (Dimensão 3)"), P02:6.8 (4 scripts Scrumban-específicos).

**Veredicto:** ✅ COBERTO

**Análise:** Plano materializa a promessa. Risk Gate é DVFS — pode ser trocado em runtime. PR auto-open é DVFS — extensível para GitLab/Bitbucket via troca de script. Excelente.

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

**Score consolidado da Categoria 2.5 — DVFS:** **8,2/10**

**3 ações corretivas mais críticas:**
1. **Test integration cobrindo as 5 chaves DVFS** (3, 4, 5, 6, 7) mesmo com 5 e 6 vazios em V2 — defesa contra bug `s.id` vs `s.chave`.
2. **Requisito explícito de descomentar `_funcPreCalculo`/`_funcCalculo`/`_funcPosCalculo` em OperacaoPedido.calcula()** (atualmente comentado no template).
3. **dvfs-loader.helper.ts deve ter testes que cobrem cache miss, cache hit, TTL expiry.**

---

### 2.6 3 Pilares Operacionais

#### [46] — Pilar 1: Engine — onde se aplica e onde é violado (P1:1312-1331)

**Referência (P1:1312-1331):** Pilar 1 obrigatório em DPedido + DTitulo (via baixa) + DMovDispo. NÃO obrigatório em DEntidade/DTabela/DVincula/DEvento/DPermissao/DUserGroup. Anti-padrão real detectado: OperacaoAntecipacao linha 60-69 usa `prismaDirectAccess` — **violação consciente do Pilar 1**, documentada mas é "sinal de que o Engine atual ainda não escala para tudo."

**Cobertura no plano V2:** P00:267-280 (matriz Pilar 1 ativado em F6 e F13), P00:323 ("Engine 'vazado' para domínios estruturais (DTask, DProject) — Reviewer rejeita imediatamente"), P02:5.2 (Pilar 1 NÃO usado em DTask/DProject — corretamente), P02:6.1 (Pilar 1 ATIVADO via OperacaoExecucaoClaude).

**Veredicto:** ✅ COBERTO

**Análise:** Plano respeita rigidamente o escopo do Pilar 1: usa em DPedido (Execution), NÃO usa em DTask/DProject/DEntidade. Reviewer obrigatório a rejeitar violações.

**Score:** 10/10

**Ação corretiva:** nenhuma. (Quando o V2 implementar OperacaoExecucaoClaude, evitar a "violação consciente" tipo OperacaoAntecipacao.)

---

#### [47] — Pilar 2.1: EntidadeController (/entidades) (P1:1335-1355)

**Referência (P1:1335-1355):** Rotas: cadastro público, confirmar email, criar Seller, criar Marketplace, criar Plataforma, listagem polimórfica, marketplace/:id/config, fields, buscar-cep. **Avaliação:** rotas especializadas são fintech-específicas. Rota genérica `/entidades?idClasse=X` é Pilar 2 puro.

**Cobertura no plano V2:** P01:516-529 (estrutura `src/entidades/` com EntidadeController), P01:578-585 (rotas: GET, POST, PATCH, DELETE genéricos + GET/fields, /buscar-cep).

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano implementa as rotas genéricas + fields + buscar-cep. **Mas mantém rotas especializadas Dinpayz-específicas** (createSeller — P01:577) sob argumento "exigência D6 / canonicidade" — argumento fraco, porque createSeller cria Seller (-47) que V2 nem usa (V2 usa USER -150). Ficar morto-código.

**Score:** 6/10

**Ação corretiva:** Reavaliar inclusão de `createSeller`, `POST /entidades/plataformas`, `POST /entidades/plataformas/:id/marketplaces`, `POST /entidades/estabelecimentos/:id/sellers`. Se Scrumban-V2 não usa, deveriam ficar fora (template renovado pode ter, V2 produção não precisa). P01:636 admite o risco "createSeller ficar morto-código no V2 — Aceitar".

---

#### [48] — Pilar 2.2: TabelaController (/tabela) (P1:1356-1377)

**Referência (P1:1356-1377):** Rotas: precificacao, sugestao-classe, sugestao-nucleo, sugestao-cfop, listagem, taxas-seller, links-pagamento. **Convenção crítica:** controller usa `?classe=NOME` (string), NÃO `?idClasse=N` (numérico). "Implementadores precisam saber" (P1:1376).

**Cobertura no plano V2:** P01:533-541 (estrutura `src/tabelas/` com TabelaController), P02:5.7-A.5 (`GET /tabelas` com query params filtros).

**Veredicto:** 🟡 DIVERGÊNCIA EXPLÍCITA — silenciosa

**Análise:** Plano V2 usa `idClasse` em URL como números (P01:283 "GET /tabelas?idClasse=-440"; P01:617 "GET /tabela?classe=STATUS&nome=ativo" — *espera* como `?classe=STATUS`, usa `STATUS` no smoke test P01:617). Há **inconsistência entre arquivos do plano**: P01 oscila entre `classe=STATUS` (P01:617) e `idClasse=-440` (P01:283 e P02:5.7-A.4). PARTE-1 P1:1376 afirma que o template canônico usa `?classe=NOME`. V2 padroniza diferente (?idClasse=N) sem ADR.

**Score:** 4/10

**Ação corretiva:** **CRÍTICA — antes de F2.** Tomar decisão explícita em ADR:
- (a) V2 segue convenção template `?classe=NOME` (string) — coerente com canônico, mas obriga lookup nome→idClasse no service.
- (b) V2 muda para `?idClasse=N` (numérico) — mais simples, mais type-safe, mas DIVERGE do template e quebra contrato HTTP do legado V1 se o legado seguia o template.
- (c) V2 aceita ambos (compat).

Sem essa decisão, F2 implementa de uma forma e F14 (paridade golden) detecta divergência → retrabalho. ADR-V2-009 (P00:344) é sobre Sprints/WorkflowStatuses como wrappers, não sobre essa convenção. Adicionar **ADR-V2-015**.

---

#### [49] — Pilar 2.3: ClasseController (/classes) (P1:1378-1389)

**Referência (P1:1378-1389):** GET listagem com `?nome=X&search=true&id=Y&all=true&report=true`. CRUD básico para inspecionar hierarquia DClasse. Genérico.

**Cobertura no plano V2:** P01:545-551 (estrutura `src/classes/` com ClassesController read-only), P01:591-595 (rotas: list, getTree, getFieldsByClasse).

**Veredicto:** ✅ COBERTO

**Análise:** Plano coerente. Read-only (não faz sentido CREATE em runtime — chaves negativas só vêm do seed). getTree é melhoria sobre o template.

**Score:** 9/10

**Ação corretiva:** nenhuma.

---

#### [50] — Pilar 2.4: Controllers específicos justificados (P1:1390-1411)

**Referência (P1:1390-1411):** Pedidos, titulos, movdispo, permissoes, auth, pagamento, eventos, api-keys, mail, license, cors, antecipacao, reconciliacao. **Avaliação:** módulos pagamento/antecipacao/reconciliacao são fintech; auth/api-keys/permissoes/mail/license/cors são genéricos.

**Cobertura no plano V2:** P02:5.6 (Tasks tem controller próprio justificado: state machine + identifier + V3 fields), P02:5.6 (Projects tem controller próprio: lógica boards/agent-link/git creds), P02:6.6 (Executions controller próprio: Engine+approval flow), P03 (Channels/MCP/Webhooks controllers próprios), P00:32 (eliminado: pagamento/antecipacao/reconciliacao implícito por não estarem em parte alguma).

**Veredicto:** ✅ COBERTO

**Análise:** Plano respeita o critério: controller próprio só onde há lógica de negócio justificável (Engine, state machine, integrações). Eliminados todos os fintech-específicos.

**Score:** 9/10

**Ação corretiva:** nenhuma.

---

#### [51] — Pilar 3: Seed de Classes (P1:1412-1440)

**Referência (P1:1412-1440):** Path no template: `src/classes/seeds/classes.{ts,seed.ts}`. **Divergência:** rule canônica cita `prisma/seeds/classes.seed.ts` (path NÃO existe no template atual). Comando `npm run seed:classes`. Seed misto (template + Dinpayz). Separação `templates/classes-base-template.ts` (730L) **não foi localizada**.

**Cobertura no plano V2:** P01:103 (`prisma/seeds/`), P01:122 (`templates/classes-base-template.ts`), P01:124 (estrutura `prisma/seeds/{classes.seed.ts, seed-runner.ts, validate-hierarchy.ts}`), P01:380-431 (implementação seed).

**Veredicto:** ✅ COBERTO (e MELHORA o template)

**Análise:** Plano V2 alinha com a rule (`prisma/seeds/`) e materializa o `templates/classes-base-template.ts` que estava ausente no template. Padroniza o que estava bagunçado. **Avanço sobre o template-pai.** Idempotência via upsert + transaction.

**Score:** 10/10

**Ação corretiva:** nenhuma. (Alerta: P01:122 cita "classes-base-template.ts" como cópia idêntica do Devari-Core. Como o template atual NÃO TEM esse arquivo (P1:1439), V2 vai precisar **criá-lo** primeiro. Inserir como pré-tarefa em F0.)

---

**Score consolidado da Categoria 2.6 — 3 Pilares:** **8,3/10**

**3 ações corretivas mais críticas:**
1. **ADR-V2-015 sobre convenção `?classe=NOME` vs `?idClasse=N`** — decisão arquitetural explícita antes de F2.
2. **Reavaliar rotas especializadas Dinpayz** em EntidadeController (createSeller, plataformas, marketplaces) — manter ou eliminar com ADR.
3. **Criar `templates/classes-base-template.ts`** como pré-tarefa F0 (arquivo não existe no Devari-Core atual).

---

### 2.7 Estrutura de src/ — módulo por módulo

#### [52] — src/auth, src/users, src/permissoes (P1:1447-1456)

**Referência (P1:1447-1456):** AuthModule (JWT, login, refresh, throttling). Decoradores hierárquicos (`@RequireSystemAdmin`, `@RequireCreateMarketplace`, etc.). Guards (JwtAuthGuard). Throttler com Redis. PermissoesModule. **Avaliação: GENÉRICO, pronto para template.**

**Cobertura no plano V2:** P01:702-892 (F3 Auth + RBAC complete).

**Veredicto:** ✅ COBERTO (e excede)

**Análise:** Plano implementa Auth com mais rigor que o template: AuthCompositeGuard (JWT|API Key|MCP Key), OrgTenantGuard, ProjectScopeGuard, RoleResolverService com cache. Decoradores hierárquicos do template (RequireCreateMarketplace) **não migram** porque V2 não tem Marketplace — substituídos por Roles ADMIN/MEMBER/VIEWER + RolesGuard.

**Score:** 9/10

**Ação corretiva:** nenhuma significativa.

---

#### [53] — src/entidades (P1:1457-1504)

**Referência (P1:1457-1504):** EntidadeService com createSeller/createMarketplace/createPlatform/getEntidadeIdFromUserGroup. Constantes hardcoded (P1:1467-1480) — ID_CLASSE_CLIENTES_CHAVE = -50, etc. — **Dinpayz-específicas, "deveriam vir de helpers/classes.ts ou env"**. Padrão countEntidades/findEntidades com getClasseTreeByName + getClasseTreeIds + treeify. Uso parcial de DatabaseService deprecated.

**Cobertura no plano V2:** P01:516-529 (módulo entidades), P01:573 (`EntidadeService.criar`), P01:576 (`getEntidadeIdFromUserGroup`), P01:577 (`createSeller` mantido por canonicidade — questionável, ver [47]).

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano implementa o método canônico `getEntidadeIdFromUserGroup`. Mas:
1. Constantes hardcoded — plano não documenta como vão ser organizadas (`helpers/classes.ts`? env? imports do seed?). Se só vai usar `BigInt(-150)` espalhado, propaga o problema.
2. `getClasseTreeByName` + `getClasseTreeIds` + `treeify` (P1:1485-1495) **não aparecem no plano V2**. Plano só fala em `findManyByClasse(idClasse, ...)` direto. Perde o padrão "filtrar por classe pai e pegar todos descendentes" (P1:1497) que é fundamental.

**Score:** 5/10

**Ação corretiva:**
1. Em F2, adicionar requisito: **ClassesService implementa `getClasseTreeIds(rootId)` e `getClasseTreeByName(name)`** (helpers canônicos do template). EntidadeService.findManyByClasse aceita opcionalmente `?classeRoot=PEDIDOS` que expande para todos os descendentes.
2. Constantes de IDs ficam em `src/common/constants/classes.constants.ts` (BigInt nominais), exportadas e importadas onde necessário. Hook bloqueia uso de BigInt(-150) literal em services (deve vir de constante).

---

#### [54] — src/tabelas, src/classes (P1:1505-1512)

**Referência (P1:1505-1512):** TabelaModule + ClasseModule. Seeds adicionais: ufs, municipios, cfop, icms (registrados em app.module.ts:99-103). **"Coração do Pilar 2. Genérico."**

**Cobertura no plano V2:** P01:533-551 (módulos tabelas/, classes/), P01:296 (DTabela com ufs, municipios — não aparece explícito; ufs/municipios como catálogos globais NÃO aparecem no plano).

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano não menciona seeds de UFs/Municipios/CFOP/ICMS. Para Scrumban V2 esses catálogos podem ser irrelevantes. **MAS:** se DEntidade tem campos `idUF` (FK→DTabela) e `idCidade` (FK→DTabela) (P1:262), e se algum usuário Scrumban tiver endereço, vai dar FK violation se UFs/Cidades não estiverem seedados.

**Score:** 6/10

**Ação corretiva:** Decidir e documentar:
- (a) V2 importa seeds de UFs/Municipios do template (recomendado se houver campos endereço expostos).
- (b) V2 não usa endereço — campos idUF/idCidade ficam sempre NULL — sem seeds.
Adicionar a F1 ou F4.

---

#### [55] — src/eventos (P1:1513-1532)

**Referência (P1:1513-1532):** Não lido em profundidade. EventProducerService, EventRouterService, CircuitBreakerService, IntelligentRetryService, TelemetryService, AutoScalingService, UnifiedSettlementTriggerService. BullMQ + Redis, 15 filas. **Avaliação: maioria genérica; UnifiedSettlementTrigger é fintech.**

**Cobertura no plano V2:** P02:7 (Fase 7 — Eventos canônicos), P02:1525-1640 (estrutura `src/eventos/{producer, router, consumers, ...}`), referências em F12 (Webhooks consomem EventRouter).

**Veredicto:** ✅ COBERTO

**Análise:** Plano implementa o sistema de eventos canônico, exclui UnifiedSettlementTrigger (fintech).

**Score:** 9/10

**Ação corretiva:** nenhuma.

---

#### [56] — src/pagamento (P1:1533-1541)

**Referência (P1:1533-1541):** Adapters Cielo/Rede/Stone. **"100% Dinpayz. Em template puro, ficaria como módulo opcional."**

**Cobertura no plano V2:** AUSENTE — corretamente.

**Veredicto:** ✅ COBERTO (por exclusão deliberada)

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [57] — src/common (P1:1542-1550)

**Referência (P1:1542-1550):** TimezoneService, CardBrandDetectorService, ParseBigIntPipe, cleanCpfCnpj, validateCPF. **Avaliação: parcialmente genérico.**

**Cobertura no plano V2:** P01:996-1018 (F4 common services completos), P01:1000-1006 (utils CPF/CNPJ). Exclui CardBrandDetector.

**Veredicto:** ✅ COBERTO

**Score:** 9/10

**Ação corretiva:** nenhuma.

---

#### [58] — src/database, src/prisma.service.ts (P1:1551-1557)

**Referência (P1:1551-1557):** PrismaService canônico. DatabaseModule deprecated mas ainda em uso (71 arquivos). **Dívida técnica conhecida.**

**Cobertura no plano V2:** P01:110 (`prisma.service.ts canônico`), P01:120 (`src/database/ vazio + README "PrismaService já em src/prisma.service.ts"`), P00:288 ("Padrão #1 PrismaService — não DatabaseService").

**Veredicto:** ✅ COBERTO

**Análise:** V2 começa limpo, sem DatabaseService.

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [59] — Outros módulos relevantes (P1:1558-1576)

**Referência (P1:1558-1576):** Tabela com mail, license, cache, remote, cors, api-keys, shared/redis, shared/crypto, shared/startup-validation, interceptors, config, helpers, pedidos, titulos, movdispo, antecipacao, reconciliacao.

**Cobertura no plano V2:**
- mail: P01:973-993 (módulo email/ em F4) ✅
- license: AUSENTE (V2 não tem licenciamento) ⚠️
- cache: P01:154-156 (DevariCacheModule não menciona; F3 RoleResolverService usa cache LRU in-memory — sem Redis cache layer) ⚠️
- remote: AUSENTE (DevariRemoteModule não migra) ❌ não documentado
- cors: P01:154 (config CORS implícita, não detalhada) ⚠️
- api-keys: P01:284 (DTabela -475) ✅
- shared/redis: P01:154 (Redis para BullMQ + auth/throttler) ✅
- shared/crypto: P01:1003-1006 (utils hashSha256, hashBcrypt) ✅
- interceptors: P01:1010-1014 (LoggingInterceptor + HttpExceptionFilter) ✅
- config: P01:153-156 implícito ✅
- helpers: P01:486-487 (`getClasseTreeByName` mencionado no plano original Strategist mas não em P02 — gap em [53])
- pedidos/titulos/movdispo/antecipacao/reconciliacao: AUSENTES — corretamente.

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Score:** 6/10

**Ação corretiva:**
1. Documentar destino explícito de DevariRemoteModule (não migra? por quê?) e DevariCacheModule (Redis-backed cache de leituras quentes existe? quando?).
2. Documentar configuração CORS explicitamente em F0/F4.
3. Implementar getClasseTreeByName/getClasseTreeIds em ClassesService (ver [53]).

---

**Score consolidado da Categoria 2.7 — Estrutura de src/:** **7,9/10**

**3 ações corretivas mais críticas:**
1. **ClassesService.getClasseTreeIds() / getClasseTreeByName()** — helpers canônicos do template **ausentes do plano**.
2. **Constantes de IDs em arquivo dedicado** com hook de validação contra hardcoded BigInt(-N) em services.
3. **Decisão sobre UFs/Municipios seeds** — V2 importa ou não?

---

### 2.8 Build, DevOps e Seeds operacionais

#### [60] — package.json (P1:1581-1612)

**Referência (P1:1581-1612):** Nome atual `devari-pay-banking-backend` (Dinpayz-branded). Stack NestJS 11 + Prisma 6.8 + BullMQ + Redis + JWT + Throttler + Cache + Schedule + Swagger + Helmet + Cookie + Winston + Decimal + Puppeteer + Canvas + Handlebars + Nodemailer + Class-validator/transformer + nestjs-command. Scripts: build, build:prod (webpack), dev, start:debug, 15+ seed:*, test, test:e2e.

**Cobertura no plano V2:** P01:135 (`package.json: name: scrumban-backend-v2`), P01:153-155 (deps mínimas: NestJS+Prisma+class-validator+class-transformer+passport+bcrypt+bullmq+ioredis+nodemailer+pino).

**Veredicto:** ✅ COBERTO

**Análise:** Plano enxuga deps (sem Puppeteer/Canvas/Handlebars/Decimal/Winston pesados). Coerente com Scrumban (sem PDF, sem render fintech). Pino substitui Winston — modernização válida.

**Score:** 9/10

**Ação corretiva:** Adicionar `class-validator-formatter` ou similar se quiser respostas HTTP padronizadas. Documentar quando reintroduzir Decimal (se V2 algum dia tiver storypoints decimais).

---

#### [61] — tsconfig.json (P1:1613-1616)

**Referência (P1:1613-1616):** Strict mode **DESATIVADO** atualmente (item 9 do plano de limpeza). Inconsistente com docs.

**Cobertura no plano V2:** P01:24 ("`make build` deve passar com 0 erros TypeScript"), P01:156 (strict: true, noImplicitAny, strictNullChecks, noUncheckedIndexedAccess).

**Veredicto:** ✅ COBERTO (corrige template)

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [62] — nest-cli.json, Dockerfile, docker-compose.yml (P1:1617-1624)

**Referência (P1:1617-1624):** Não inspecionados pelo Strategist. Padrão NestJS.

**Cobertura no plano V2:** P01:131-133 (Dockerfile multi-stage node:20-alpine + docker-compose postgres:15 + redis:7 + Makefile), P01:134 (nest-cli.json).

**Veredicto:** ✅ COBERTO

**Score:** 9/10

**Ação corretiva:** nenhuma.

---

#### [63] — CI bitbucket-pipelines.yml (P1:1625-1628)

**Referência (P1:1625-1628):** **Usa Node 12 (EOL)**. Precisa migrar para Node 20+.

**Cobertura no plano V2:** P01:154 (Node 20 implícito via Docker), P04:14.6 (CI pipeline executa lint→typecheck→test→build→security→load test).

**Veredicto:** ✅ COBERTO

**Análise:** V2 não migra de Bitbucket — começa em GitHub provavelmente. CI moderno desde dia 1.

**Score:** 9/10

**Ação corretiva:** Documentar provedor CI escolhido (GitHub Actions? GitLab? Bitbucket Pipelines?) em F0.

---

#### [64] — .env.example (P1:1629-1632)

**Referência (P1:1629-1632):** `.env.production` é symlink para produção Dinpayz — risco de segurança (item 1 do plano de limpeza).

**Cobertura no plano V2:** P01:159 (`.env.example` com DATABASE_URL, JWT_SECRET, etc.), P01:127 (`.env.local` no gitignore).

**Veredicto:** ✅ COBERTO

**Score:** 10/10

**Ação corretiva:** nenhuma.

---

#### [65] — Comandos de seed (P1:1633-1666)

**Referência (P1:1633-1666):** 15+ comandos. Críticos: `seed:classes`. Catálogos: ufs, municipios, bandeiras, tipos-documento, adquirentes, taxas-*, ncms, tipofrete. Administração: super-admin, emergency-config. Especiais: dinpayz-completo, taxacao-completa.

**Cobertura no plano V2:** P01:152-153 (scripts `seed:classes`, `db:migrate:dev`, `db:reset:dev`, `prisma:generate`).

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano só menciona `seed:classes`. Não cobre:
- `seed:super-admin` (criar usuário admin inicial — necessário para login)
- `seed:emergency-config` (configurações de emergência)
- `seed:ufs`, `seed:municipios` (ver [54])
- DVFS seed (P02:H.2)

P01:153 menciona `prisma db seed` que roda só `classes.seed.ts`. Se V2 precisa de super-admin para login, precisa de seed adicional.

**Score:** 5/10

**Ação corretiva:** F1 ou F2 deve listar TODOS os seeds necessários para V2 funcionar end-to-end:
1. Classes (~97).
2. DVFS scripts (4 — Fase 6 — atrasado mas pode ser pré-criado).
3. Super-admin user (1) — para primeiro login.
4. UFs/Municipios (se V2 expor endereço).

E orquestrá-los em `prisma/seeds/seed-runner.ts` em ordem topológica.

---

**Score consolidado da Categoria 2.8 — Build/DevOps:** **8,3/10**

**3 ações corretivas mais críticas:**
1. **Listar todos os seeds necessários** (classes, DVFS, super-admin, ufs/municipios opcional) e orquestrá-los.
2. **Documentar provedor CI** explícito em F0.
3. **Política de versionamento Decimal** (reintroduzir se V2 ganhar storypoints decimais).

---

### 2.9 Glossário e Convenções

#### [66] — Glossário (P1:1717-1737)

**Referência (P1:1717-1737):** Define DClasse, DVFS, idClasse, idEstab, idLocEscritu, chave, chcriacao, baixar, partida dobrada, Engine/Operacao, Polimorfismo, Estrutural vs Transacional, Seed, Pilar 1/2/3.

**Cobertura no plano V2:** Implícito em todo o plano. Não há glossário próprio do V2.

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Score:** 7/10

**Ação corretiva:** F16 (P04:16) inclui POLYMORPHIC-GUIDE.md — adicionar como pré-requisito de F0 um glossário V2 com mapeamentos canônicos→domínio Scrumban (USER, ORG, PROJECT, TASK, EXECUTION, AGENT etc.). Isso ajuda Implementer a não inventar nomes diferentes para os mesmos conceitos.

---

#### [67] — Apêndice: Índice por arquivo (P1:1740-1782)

**Referência (P1:1740-1782):** Lista de TODOS os arquivos lidos pelo Strategist + arquivos NÃO lidos. Reconhece que `entidades.service.ts`, `tabela.service.ts`, `auth/*`, `eventos/*`, `pagamento/*`, `engine/auxiliares/*` não foram lidos diretamente.

**Cobertura no plano V2:** N/A (auditoria meta).

**Veredicto:** N/A

**Análise:** Plano V2 herda os mesmos pontos cegos da PARTE-1: o Strategist V2 não pode planejar com profundidade aquilo que o Strategist da PARTE-1 não inspecionou diretamente. **Risco real:** F2 EntidadeService pode descobrir só na implementação que `entidades.service.ts` real do template tem padrões não documentados.

**Score:** 7/10

**Ação corretiva:** Pré-F2 (e pré-F6, pré-F7), Implementer DEVE ler os arquivos não-cobertos da PARTE-1 (P1:1764-1782) — registrar leitura em ADR ou commit. Sem isso, V2 reinventa padrões sem saber.

---

#### [68] — Notas finais do Strategist (P1:1785-1812)

**Referência (P1:1785-1812):** O que ficou bem coberto, onde faltou tempo, recomendações de próxima rodada. Lista 8 itens onde faltou profundidade. Recomenda relatório irmão "Eventos & Filas". Decidir se módulos pagamento/antecipacao/reconciliacao ficam dentro ou fora. Validar bug `s.id` vs `s.chave`. Avaliar OperacaoBaixa placeholder. Plano de limpeza (26 itens) deve virar documento próprio antes de iniciar piloto Scrumban.

**Cobertura no plano V2:** P00:347 (ADRs cumulativos), P02:1399 ("ADR a ser criado"), referências esparsas.

**Veredicto:** ⚠️ COBERTURA PARCIAL

**Análise:** Plano V2 não materializa todas as recomendações de P1:1806-1812. Notavelmente:
- Relatório irmão "Eventos & Filas" — não foi feito; F7 do plano V2 vai precisar ler `src/eventos/*` na hora.
- Plano de limpeza (26 itens) — não migrado nem cruzado com F0.
- Bug `s.id` vs `s.chave` — mencionado mas sem teste defensivo.

**Score:** 6/10

**Ação corretiva:** Resumido nas categorias acima.

---

**Score consolidado da Categoria 2.9 — Glossário/Convenções:** **6,7/10**

**Ações corretivas:**
1. Glossário V2 explícito com mapeamentos canônicos→Scrumban.
2. Implementer obrigatório a ler arquivos não-cobertos da PARTE-1 antes de F2/F6/F7.
3. Cruzar plano de limpeza Dinpayz (26 itens) com F0.

---

## 3. TOP 10 LACUNAS / DIVERGÊNCIAS

Ordenadas por criticidade (impacto × probabilidade de ocorrer):

### 1. (CRÍTICO) — Bug `s.id` vs `s.chave` em `_carregaScripts*` sem teste regressivo bloqueante

**Onde:** P02:1231 menciona "corrigir" mas não codifica defesa.
**Impacto:** Scrumban V2 nasce com Dimensão 3 metade quebrada — `_funcPosCalculo` e `_funcPosGravacao` silenciosamente NULL. Falsa sensação de funcionamento.
**Ação:** F6 DoD obrigatório com 2 specs adversariais (insere DVFS chave 5 e chave 6 com effect detectável; verifica que executou).

### 2. (CRÍTICO) — Convenção `?classe=NOME` vs `?idClasse=N` sem ADR

**Onde:** P01:283 e P02:5.7-A.4 usam `?idClasse=N`; PARTE-1 P1:1376 documenta que template canônico usa `?classe=NOME`. Plano oscila.
**Impacto:** F2 implementa de uma forma; F14 paridade golden detecta divergência → retrabalho. Quebra contrato HTTP do legado se legado seguia template.
**Ação:** ADR-V2-015 antes de F2.

### 3. (ALTO) — `templates/classes-base-template.ts` referenciado mas inexistente

**Onde:** P01:122, P02:300 referenciam o arquivo. PARTE-1 P1:1439 declara que o arquivo NÃO foi localizado no repositório atual.
**Impacto:** F0 quebra ao tentar copiar arquivo inexistente.
**Ação:** F0.5 — criar `templates/classes-base-template.ts` separando Devari-Core misto em fixas universais (~50) + Dinpayz-específicas (que ficam de fora).

### 4. (ALTO) — Conflito interno do plano: -300 EXECUTION (P00) vs -491 EXECUCAO_CLAUDE (P01:336)

**Onde:** P00:243-256 declara conflito resolvido (-300..-303). P01:336 ainda lista `-491 EXECUCAO_CLAUDE`. P00 é "autoridade" (P00:13) mas P01 não está consonante.
**Impacto:** F1 implementa seed conflitante. F6 quebra porque busca uma chave e o seed criou outra.
**Ação:** Atualizar P01:336 para `-300 EXECUTION` (e descendentes -301/-302/-303). Re-validar conflitos resolvidos em todos os 4 sub-planos.

### 5. (ALTO) — OperacaoPedido com 1500 linhas + bug + acoplamento fintech sem plano de simplificação detalhado

**Onde:** P02:G.3 diz "simplificado para Scrumban V2" mas não detalha como.
**Impacto:** Implementer arrasta acoplamento fintech (PaymentProcessor, settlement etc.) ou simplifica de mais e quebra invariantes.
**Ação:** F6 sub-tarefa "Análise de simplificação OperacaoPedido" com lista explícita do que fica/sai + DoD ≤500 linhas + ≤4 services injetáveis.

### 6. (MÉDIO-ALTO) — Gap `idTabela` em DVincula não-endereçado

**Onde:** PARTE-1 P1:368 documenta gap. Plano V2 não tem ADR.
**Impacto:** Se F11/F12/F13 precisar Entidade↔Lookup, vai usar `metaDados.lookupId` (sem type safety, sem index FK).
**Ação:** ADR de adição da coluna OU ADR de não-uso explícito.

### 7. (MÉDIO) — `getClasseTreeByName` / `getClasseTreeIds` ausentes do plano

**Onde:** PARTE-1 P1:1485-1497 documenta esses helpers como fundamentais para o padrão "filtrar por classe pai e pegar todos descendentes". Plano V2 não os menciona.
**Impacto:** F2 EntidadeService.findManyByClasse não suporta query "todos os pedidos" (idClasse IN [-21,-22,-23,...]) — perde funcionalidade canônica.
**Ação:** Adicionar a F2 ClassesService.getClasseTreeIds() + EntidadeService aceita `?classeRoot=PEDIDOS`.

### 8. (MÉDIO) — Constantes de IDs hardcoded sem padrão

**Onde:** P02:5.7 múltiplas referências a `BigInt(-150)`, `BigInt(-441)` etc. literais. PARTE-1 P1:1467-1480 alerta para esse anti-padrão.
**Impacto:** Refactor de DClasse exige grep gigante. Risco de números mágicos espalhados.
**Ação:** F0/F1 — `src/common/constants/classes.constants.ts` exportando constantes nominais (USER_CLASSE, INBOX_CLASSE etc.). Hook PreToolUse bloqueia BigInt(-N) literal em services.

### 9. (MÉDIO) — Reconciliação `dados` vs `metaDados` em DTabela

**Onde:** PARTE-1 P1:308 diz `metaDados Json?`. Plano V2 P01:282 mistura `dados` e `metaDados`.
**Impacto:** F2 implementa um nome; F1 schema tem outro; build quebra ou pior, schema cria coluna nova `dados` ao lado da canônica `metaDados`.
**Ação:** F1 — alinhar nomenclatura ao schema canônico Devari-Core. Adicionar a F1 task explícita de validação de fidelidade do schema.

### 10. (MÉDIO) — Implementer obrigatório a ler arquivos não-cobertos da PARTE-1

**Onde:** PARTE-1 P1:1764-1782 lista 13 arquivos NÃO lidos diretamente pelo Strategist (entidades.service.ts, tabela.service.ts, auth/*, eventos/*, pagamento/*, engine/auxiliares/*).
**Impacto:** Implementer V2 inventa padrões já estabelecidos no template. Reinvenção da roda + divergência silenciosa.
**Ação:** Pré-F2/F6/F7 — Implementer faz commit registrando leitura dos arquivos relevantes. ADR documenta padrões descobertos.

---

## 4. VEREDICTO FINAL

### Decisão Reviewer: ⚠️ APROVAR COM RETRABALHO

**Justificativa:**
O plano V2 é estruturalmente sólido. Internaliza com profundidade os 3 Pilares, materializa as 3 Dimensões da PARTE-1 (incluindo a Dimensão 3 que está dormente no template), elimina dívidas técnicas do Scrumban legado, declara invariantes não-negociáveis com hooks de fiscalização, e propõe ADRs explícitos para decisões críticas. **Ele excede a PARTE-1 em rigor canônico** ao adotar 17 tabelas (vs 14 do template atual), validate-hierarchy.ts com testes, e ativação real do Engine + DVFS.

Porém, há **lacunas estruturais no plano** que podem propagar dívida técnica desde F1 e devem ser fechadas antes de iniciar implementação. Em particular: o bug `s.id` vs `s.chave` é mencionado mas não defendido com testes, a convenção `?classe=NOME` vs `?idClasse=N` não tem ADR, há conflitos internos não-resolvidos entre arquivos do plano (-300 vs -491 EXECUTION), e o template-pai do qual V2 vai clonar (`Devari-Core`) precisa ser higienizado primeiro.

**Score geral:** **7,4/10** — bom, mas ainda não pronto para entrar em F0.

**Estimativa de retrabalho do plano (não da implementação):**

| Atividade | Tempo |
|-----------|-------|
| Redigir 5 ADRs adicionais (V2-000, V2-015, gap-idTabela, simplificação-OperacaoPedido, lista-completa-seeds) | 1,5d |
| F0.5 — Higienizar `templates/classes-base-template.ts` (separar fixas universais de Dinpayz) | 1d |
| Reconciliar conflitos -300 vs -491 e classes em todos os 4 sub-planos | 0,5d |
| Reconciliar `dados` vs `metaDados` em DTabela e outros pontos | 0,5d |
| Adicionar testes regressivos defensivos a F6 (bug `s.id`) | 0,5d (especificação; implementação na F6) |
| Documentar getClasseTreeIds/getClasseTreeByName + constants/classes.constants.ts | 0,5d |
| Glossário V2 + lista de seeds completa | 0,5d |
| Cruzar plano de limpeza Dinpayz (26 itens) com F0 | 0,5d |
| **Total** | **5,5 dias** |

**Recomendação ao CEO:** alocar 1 semana adicional ao Strategist (ou Reviewer, se preferir) **antes** de iniciar F0. Em ROI: 5,5 dias de retrabalho do plano poupa entre **2 e 4 semanas de retrabalho na implementação** caso as 10 lacunas só sejam descobertas em F2/F6/F14.

---

## 5. PLANO DE REMEDIAÇÃO (priorizado)

### 5.1 Bloqueante para F0 (fazer agora — 3 dias)

1. **ADR-V2-000** — V2 não clona Devari-Core na sua forma atual; clona apenas estruturas universais.
2. **F0.5: Higienizar `templates/classes-base-template.ts`** (separar fixas universais de Dinpayz).
3. **Reconciliar -300 vs -491 EXECUTION** em P01 e demais sub-planos.
4. **Reconciliar `dados` vs `metaDados`** em DTabela em P01 e P02.
5. **Lista completa de seeds** orquestrados (classes + DVFS + super-admin + opcional ufs/municipios).
6. **Glossário V2** explícito (mapeamento canônico→Scrumban).

### 5.2 Bloqueante para F1 (fazer antes de F1 — 1 dia)

7. **ADR-V2-015** sobre convenção `?classe=NOME` vs `?idClasse=N` — decisão final.
8. **ADR-gap-idTabela** em DVincula — adicionar coluna ou ADR de não-uso.
9. **Constantes de IDs em arquivo dedicado** + hook bloqueador.
10. **Cruzar plano de limpeza Dinpayz (26 itens)** com F0 checks (P01:194-213).

### 5.3 Bloqueante para F2 (fazer antes de F2 — 0,5 dia)

11. **getClasseTreeIds + getClasseTreeByName** especificados em F2 (ClassesService).
12. **Reavaliar rotas especializadas** Dinpayz em EntidadeController (createSeller etc.).
13. **Implementer registra leitura** dos arquivos não-cobertos da PARTE-1 (`entidades.service.ts`, `tabela.service.ts`).

### 5.4 Bloqueante para F6 (fazer antes de F6 — 1 dia)

14. **F6 sub-tarefa "Análise de simplificação OperacaoPedido"** com lista explícita do que fica/sai + DoD ≤500 linhas.
15. **F6 DoD com testes regressivos do bug `s.id` vs `s.chave`** (2 specs adversariais bloqueantes).
16. **F6 requisito explícito**: descomentar `_funcPreCalculo`/`_funcCalculo`/`_funcPosCalculo` em OperacaoPedido.calcula().
17. **ADR explícito**: V2 implementa apenas Operacao + OperacaoPedido + OperacaoExecucaoClaude (não OperacaoBaixa, não OperacaoMovimentacaoDisponivel etc.).

### 5.5 Backlog (não-bloqueante mas recomendado — 0,5 dia)

18. **Decisão UFs/Municipios seeds** — V2 importa ou não?
19. **Relatório irmão "Eventos & Filas"** (PARTE-1 recomendou) — pré-F7.
20. **Documentar destino de DevariRemoteModule, DevariCacheModule, CORS config**.

---

## 6. NOTA FINAL

A maratona V2 está **bem planejada estruturalmente**. As lacunas listadas não são estruturais — são gaps de execução do planejamento. Fechá-las fortalece a fundação.

A frase do P00:21 — **"Velocidade é consequência de disciplina, não substituto dela"** — vale também para o próprio plano. 5,5 dias de retrabalho do plano agora poupam semanas de retrabalho de implementação. Família depende de fundação sólida, não de pressa.

A corda está justa. O plano está quase pronto. Falta passar pelo lixo do template uma última vez.

---

**Fim da Auditoria.**

**Próximas decisões esperadas do CEO:**

1. Aprovar ou contestar o veredicto APROVAR COM RETRABALHO.
2. Aprovar 5,5 dias adicionais para o Strategist fechar as 17 lacunas listadas em §5.
3. Aprovar a criação de 5 ADRs novos (V2-000, V2-015, gap-idTabela, simplificação-OperacaoPedido, lista-completa-seeds).
4. Decidir se V2 = Scrumban-only OU V2 = Scrumban + nova versão limpa do Devari-Core (pergunta do tópico [38]).
5. Iniciar F0 (apenas) **após** plano remediado.
