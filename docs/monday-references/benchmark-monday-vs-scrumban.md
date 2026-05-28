# Benchmark: Monday.com vs Scrumban-Backend-V2

**Data:** 2026-05-27
**Autor:** Análise técnica e estratégica
**Objetivo:** Entender o Monday.com a fundo (features, background técnico, UI/UX) e comparar com o estado atual do Scrumban

---

## 1. FUNCIONALIDADES PRINCIPAIS DO MONDAY.COM

### 1.1. Estrutura Organizacional (Hierarquia)

O Monday.com organiza dados em 5 níveis hierárquicos:

```
Workspace (espaço de trabalho)
  └── Folder (organização visual)
       └── Board (o "quadro" — unidade central)
            └── Group (agrupamento visual de itens)
                 └── Item (a unidade de trabalho)
                      └── Subitem (até 5 níveis aninhados)
```

- **Workspace**: contêiner de alto nível para separar departamentos, equipes ou clientes
- **Folder / Sub-folder**: organização hierárquica dentro do workspace
- **Board**: tabela rica onde o trabalho é gerenciado — é o coração da plataforma
- **Group**: seções visuais dentro de um board (ex: "To Do", "In Progress", "Done")
- **Item**: uma linha do board — representa uma tarefa, deal, ticket, etc.
- **Subitem**: até 5 níveis de aninhamento (multi-level boards, feature recente)

### 1.2. Colunas (o diferencial do Monday)

O stakeholder tem razão — as colunas 100% editáveis são um dos maiores atrativos. O Monday oferece **40+ tipos de coluna**, que o usuário arrasta e configura sem código:

| Categoria | Tipos de Coluna |
|-----------|----------------|
| **Básico** | Text, Long Text, Numbers, Date, Person, Status, Checkbox |
| **Temporal** | Timeline, Hour, Time Tracking, Creation Log, Last Updated |
| **Comunicação** | Email, Phone, Link, Location |
| **Avançado** | Formula, Mirror (espelho de outra board), Dependency, Connect Boards |
| **Visual** | Rating, Color Picker, Vote, Progress Tracking |
| **Organização** | Dropdown, Tags, Country, World Clock |
| **Combo** | Date+Status, Timeline+Status, Timeline+Numeric |
| **Power-ups** | Button (ações), Auto Number (ID sequencial), Files |

**Destaques técnicos das colunas:**
- **Formula Column**: suporta tipos Number, Text, Date, Status, People, Time Tracking. Funções como IF, CONCATENATE, DAYS, HOURS, ROUND, etc.
- **Mirror Column**: "espelha" dados de outra board conectada — quase todos os tipos podem ser espelhados (exceto Name, outros mirrors e formulas)
- **Connect Boards Column**: cria relações bidirecionais entre boards — mudanças em uma board refletem automaticamente na outra
- **Dependency Column**: define predecessores/successores (crítico para Gantt)

### 1.3. Visualizações (Views)

O Monday transforma os mesmos dados em múltiplas representações visuais:

| View | O Que Mostra | Uso Principal |
|------|-------------|---------------|
| **Main Table** | Tabela editável inline (view padrão) | CRUD do dia-a-dia |
| **Kanban** | Cards em colunas (stages de workflow) | Gestão visual de fluxo |
| **Timeline** | Barras horizontais no tempo | Duração e workload |
| **Gantt** | Timeline avançado com dependências + critical path + milestones | Gestão de projetos complexos |
| **Calendar** | Visualização mensal/semanal/diária | Prazos e agendamento |
| **Workload** | Distribuição de carga por pessoa | Balanceamento de time |
| **Chart** | Gráficos de barra, pizza, linha | Dashboards e reports |
| **Map** | Mapa geográfico com pins | Logística e operações |
| **Files** | Galeria de arquivos anexados | Gestão documental |
| **Form** | Formulário público para captura de dados | Input externo |
| **Dashboard** | Widgets agregados de múltiplos boards | Visão executiva |

### 1.4. Automações

Sistema "If This, Then That" sem código:

- **Triggers**: mudança de status, data chegou, item criado, coluna alterada, período recorrente
- **Actions**: notificar pessoa, mover item, criar item, mudar status, enviar email, chamar webhook
- **Cross-board**: automações que conectam boards diferentes
- **Round Robin**: distribuição automática rotativa de tasks
- **Receitas prontas**: 200+ templates de automação pré-configuradas
- **Custom automations**: construção visual de fluxos customizados

### 1.5. Integrações e API

- **Apps Marketplace**: 100+ integrações prontas (Slack, Google, Jira, Salesforce, etc.)
- **GraphQL API**: API expressiva para ler/mutar boards, items, column values, users, workspaces
- **Webhooks**: push real-time para sistemas externos
- **SDKs**: JavaScript/React (principal), Ruby, Kotlin
- **MCP Servers**: 2 servidores MCP para integração com IA (feature recente 2025)
- **Custom Apps**: framework para criar apps privados ou públicos (marketplace)

### 1.6. Outros Recursos

- **monday WorkDocs**: documentos colaborativos integrados ao board
- **monday WorkCanvas**: quadro branco digital com elementos Gantt
- **AI Features**: recomendação de colunas por IA, sugestões de automação, geração de fórmulas
- **Time Tracking**: cronômetro nativo por item
- **Dashboards**: widgets customizáveis agregando dados de múltiplos boards

---

## 2. COMO FUNCIONA POR TRÁS (Background Técnico / Dev Perspective)

### 2.1. mondayDB — O Database Engine Custom

O Monday.com construiu seu próprio engine de banco de dados (mondayDB) em vez de usar soluções existentes. Motivos:

- Dados são **mutáveis** (diferente de analytics onde são append-only)
- Precisam de **inúmeras tabelas** (cada board é efetivamente uma tabela)
- Não sabem de antemão **o que o usuário vai querer filtrar** (schema dinâmico)
- Avaliaram MySQL, ElasticSearch, Apache Pinot, ClickHouse, Apache Druid, CockroachDB, Couchbase — nenhum atendeu completamente

**Arquitetura mondayDB:**

```
┌─────────────────────────────────────────────┐
│              mondayDB Engine                 │
│  Column logic = JavaScript (shared package)  │
│  Runs in hybrid mode (client + server)       │
├──────────────────┬──────────────────────────┤
│   Row Storage    │   Columnar Storage       │
│   (operacional)  │   (analítico)            │
├──────────────────┴──────────────────────────┤
│           Lambda Architecture                │
│  ┌────────────┐  ┌────────────────────┐      │
│  │ Speed Layer│  │    Batch Layer     │      │
│  │  (Redis)   │  │ (Apache Cassandra) │      │
│  └────────────┘  └────────────────────┘      │
└─────────────────────────────────────────────┘
```

- **Row + Columnar dual storage**: queries selecionam o storage ideal conforme o tipo de manipulação
- **Lambda Architecture**: Speed Layer (Redis, real-time) + Batch Layer (Cassandra, pre-calculated)
- **Column logic em JavaScript**: compartilhada entre client e server (mesma validação nos dois lados)
- **Schemaless**: qualquer tipo de dado pode ser armazenado e queryado sem definir schema prévio
- **Alta compressibilidade**: storage columnar comprime valores repetitivos (Status com 5 opções comprime muito)

### 2.2. Infraestrutura

| Componente | Tecnologia |
|-----------|-----------|
| **Orquestração** | Kubernetes (EKS na AWS) — multi-cluster |
| **Arquitetura** | Microserviços — cada app é componente independente |
| **Database per service** | RDS, Redis, SQS, S3 por microserviço |
| **IaC** | Terraform via CDKTF (TypeScript) |
| **Multi-region** | Privacy-first — dados de usuários nunca cruzam regiões |
| **CI/CD** | Continuous Delivery com múltiplos deploys diários |
| **Dev Environment** | Docker-based, replicável em laptop |
| **Gerenciamento infra** | Ensemble (ferramenta interna para gerenciar infra de cada microserviço) |

### 2.3. Complexidade de Implementação (Análise para Dev)

| Feature | Complexidade | O Que Envolve |
|---------|-------------|---------------|
| **Colunas dinâmicas** | **Altíssima** | Schema-on-read, validação client+server, serialização custom, indexação dinâmica |
| **Formula Column** | **Altíssima** | Parser de expressões, DAG de dependências, avaliação lazy, cache de resultados |
| **Mirror Column** | **Alta** | Resolução cross-board em real-time, subscription WebSocket, invalidação de cache |
| **Connect Boards** | **Alta** | Relações bidirecionais, consistência eventual, propagação de updates |
| **Gantt + Dependencies** | **Alta** | Topological sort, critical path algorithm, drag-and-drop com constraints |
| **Automações** | **Alta** | Event bus, avaliação de condições, execution engine, rate limiting, retry |
| **Multi-level subitems** | **Média-Alta** | Árvore recursiva até 5 níveis, flatten para API, reconstituição no client |
| **Real-time collaboration** | **Alta** | WebSocket/SSE, CRDT ou OT para conflitos, presence indicators |
| **Dashboards** | **Média** | Agregação cross-board, widgets customizáveis, cache com TTL |
| **Views (Kanban/Timeline)** | **Média** | Transformação de dados, drag-and-drop, persistência de view state |
| **Permissions** | **Média** | Board-level, workspace-level, column-level, row-level ACL |

**Ponto crucial**: o mondayDB custom é o que permite que as colunas dinâmicas funcionem com performance. Sem ele, usar um banco relacional tradicional para 40+ tipos de coluna com schema dinâmico seria extremamente custoso em queries de filtragem e ordenação.

---

## 3. IDENTIDADE VISUAL E UI/UX

### 3.1. Design System: Vibe

O Monday.com criou o **Vibe Design System** — um sistema de design open-source:

- **Repositório**: `github.com/mondaycom/monday-ui-style`
- **Storybook**: `vibe.monday.com` (componentes interativos documentados)
- **Framework-agnostic**: pacote de estilos separado do framework (cores, sombras, dimensões, ícones)
- **Acessibilidade**: guidelines de acessibilidade integradas em cada componente
- **Motion guidelines**: animações padronizadas como parte da linguagem visual

### 3.2. Paleta de Cores e Identidade

| Elemento | Cor / Estilo |
|----------|-------------|
| **Cores primárias** | Mirage (escuro), White, Cornflower Blue |
| **Cores de energia** | Vermelho, Amarelo, Azul, Verde (status, prioridades, categorias) |
| **Logo** | Formas verticais arredondadas em cores distintas — representam tasks em movimento |
| **Tipografia** | Sans-serif minúscula — approachable e moderna |
| **Design agency** | Sagmeister & Walsh (rebrand 2019) |

### 3.3. Princípios de UX que Vendem

| Princípio | Como o Monday Aplica |
|-----------|---------------------|
| **Instant feedback** | Ações completam em 0.5–1s; progress visual se demorar mais |
| **Edit-in-place** | Clique em qualquer célula e edite diretamente (zero modais desnecessários) |
| **Drag and drop** | Reordenar items, mover entre groups, ajustar timeline — tudo arrastável |
| **Visual first** | Status com cores, prioridades com ícones, progresso com barras — reduz texto |
| **Progressive disclosure** | Detalhes aparecem conforme necessário (expand row, side panel, modal) |
| **Consistency** | Vibe Design System garante aparência uniforme em toda a plataforma |
| **Zero learning curve** | Board parece uma planilha — qualquer pessoa entende imediatamente |
| **Customization** | Cores de status, ícones de grupo, background de board — o usuário personaliza tudo |

### 3.4. Por Que Vende Tão Bem

1. **Parece uma planilha turbinada**: o modelo mental de "tabela com colunas" é universalmente compreendido. O Monday não força o usuário a aprender conceitos novos — ele turbina algo que todos já conhecem.

2. **Status coloridos**: cada status tem uma cor forte e distinta. O cérebro processa cores antes de texto — em um board com 50 items, você "vê" o progresso instantaneamente.

3. **Edição inline sem fricção**: não há formulários separados. Clicar → editar → Tab para próxima coluna. É a mesma fluidez de uma planilha Google.

4. **Automações acessíveis**: linguagem natural ("When status changes to Done, notify someone") em vez de código. Non-devs configuram fluxos complexos.

5. **Branding emocional**: cores vibrantes, linguagem casual, animações suaves. O Monday vende a ideia de que trabalho pode ser "divertido" — contraste com a seriedade de Jira/Asana.

---

## 4. COMPARATIVO SCRUMBAN vs MONDAY.COM

### 4.1. Mapa de Features

| Feature | Monday.com | Scrumban-Backend-V2 | Status |
|---------|-----------|-------------------|--------|
| **Hierarquia organizacional** | Workspace > Folder > Board > Group > Item > Subitem (5 níveis) | Org > Space > Folder > List > Task > Phase (6 níveis via DProject + DTask) | **Paridade** — hierarquia Space/Folder/List (ADR-V2-051) + Phases (ADR-V2-047) cobrem |
| **CRUD de tasks** | Create, read, update, delete inline | POST/GET/PUT/DELETE /tasks com V3 state machine | **Paridade** (backend) |
| **State machine** | Status column livre (qualquer label) | 9 estados V3: INBOX→READY→EXECUTING→DONE→FAILED→CANCELLED→DISCARDED→VALIDATING→VALIDATED | **Scrumban superior** — state machine formal com transições validadas |
| **Colunas dinâmicas (40+ tipos)** | Core feature — schema-on-read, cada board tem colunas únicas | DTabela com `tableFields` Json em DClasse + campo `dados` Json em DTask | **Monday superior** — colunas dinâmicas são o DNA do Monday. Scrumban pode emular via `dados` Json mas sem tipagem client-side nativa |
| **Formula Column** | Parser nativo com 30+ funções | Não implementado | **Monday superior** |
| **Mirror/Connect Boards** | Relação bidirecional entre boards | Não implementado diretamente (DVincula pode modelar relações, mas sem UI nativa) | **Monday superior** |
| **Visualizações** | 11 views (Table, Kanban, Gantt, Timeline, Calendar, Workload, Chart, Map, Files, Form, Dashboard) | Backend serve dados para frontend renderizar (Kanban confirmado no frontend) | **Monday superior** em quantidade — Scrumban depende do frontend implementar views |
| **Drag and drop** | Nativo em todas as views | Feature de frontend (backend serve dados via API) | **N/A** (frontend concern) |
| **Automações** | 200+ receitas no-code, custom triggers/actions | Automation module com Claude Code agent (agente IA na VPS executa prompts, Risk Gate com 3 níveis LOW/MED/HIGH) | **Abordagem diferente** — Monday: automação visual no-code; Scrumban: automação inteligente via IA |
| **IA / AI Chat** | Recomendação de colunas, sugestões | Nexus IA Chat com Gemini + 4 tools polimórficas (getProjectSummary, getTasksByStatus, searchTasks, getFlowMetrics) | **Scrumban superior** — IA conversacional com tools que acessam dados reais |
| **Flow Metrics** | Não nativo (via apps terceiros ou dashboards manuais) | 6 métricas nativas: Cycle Time, Lead Time, Throughput, WIP Age, CFD, Dashboard consolidado (com percentis p50/p75/p90) | **Scrumban muito superior** — flow metrics é core, não add-on |
| **Forecast Monte Carlo** | Não nativo | Planejado (Fase 8 do plano-mestre) | **Scrumban planejado** |
| **Sprints** | Não nativo no work management (existe no monday dev) | Sprints como DTabela com gestão completa | **Scrumban superior** para Scrum/Kanban |
| **Webhooks outbound** | Integração webhook + API | Webhooks HMAC com retry e auto-disable (DTabela -470 + DEvento -491) | **Paridade** |
| **MCP Server** | 2 MCP servers (Platform + GraphQL) | MCP Server com 5 tools | **Paridade** |
| **Telegram** | Não nativo (via integração terceira) | Canal Telegram nativo com voz Groq Whisper | **Scrumban superior** |
| **Notificações** | Sistema robusto multi-canal | DEvento -490 NOTIFICATION | **Monday superior** em canais; Scrumban adequado |
| **Comments** | Updates com menções e rich text | Comentários polimórficos via DEvento -507 (task, project, folder, list) | **Paridade** |
| **Bookmarks/Favoritos** | Não é feature destacada | DVincula -187 BOOKMARK em qualquer entidade | **Scrumban superior** |
| **Multi-tenant** | Workspace isolation | Org > Team isolation com JWT + OrgTenantGuard + defense-in-depth (ADR-V2-042) | **Paridade** |
| **RBAC** | Board-level, workspace-level permissions | RBAC duplo: Org (ADMIN/MEMBER/VIEWER) + Project (MANAGER/MEMBER/VIEWER) via DVincula | **Paridade** |
| **Audit trail** | Activity log por board | DEvento polimórfico com 16+ tipos de audit (login, lifecycle, status change, etc.) | **Scrumban superior** em granularidade |
| **Search** | Global search | Search module (full-text) | **Paridade** |
| **API** | GraphQL API madura | REST API (128 endpoints planejados) com Swagger completo | **Monday superior** em maturidade; Scrumban crescendo |
| **Time Tracking** | Nativo por item | Work sessions em telemetria (dados.telemetry.workSessions) | **Monday superior** em UX; Scrumban tem dados equivalentes |
| **Documentos** | monday WorkDocs (colaborativo) | DTabela -353 DOC (conteúdo rico em dados.content) | **Monday superior** em colaboração real-time |
| **Apps/Marketplace** | 100+ apps, framework de extensão | Modelo extensível via DClasse polimórfica | **Monday superior** em ecossistema; Scrumban superior em flexibilidade arquitetural |
| **Pricing** | $0-$19/seat/month (4 planos) | Self-hosted / custom | **Scrumban superior** em custo para escala |
| **Agent/Automation IA** | AI features básicas | Agente Claude Code em VPS com install/heartbeat/execution result, multi-project linking, HMAC bilateral | **Scrumban muito superior** — automação IA enterprise-grade |

### 4.2. Onde o Monday Ganha (e o que Aprender)

| Aspecto | O Que o Monday Faz Melhor | Lição para o Scrumban |
|---------|--------------------------|----------------------|
| **Colunas dinâmicas** | 40+ tipos tipados com UI inline | Investir em `tableFields` do DClasse para definir colunas custom por board/list, com validação tipada no `dados` Json |
| **Edit-in-place** | Zero modais — tudo editável na tabela | Frontend deve priorizar edição inline como first-class UX |
| **Visualizações** | 11 views prontas (Gantt é killer feature) | Gantt/Timeline como views do frontend consumindo dados da API de tasks + sprints |
| **Automações no-code** | 200+ receitas visuais | Complementar o agente IA com builder visual de automações simples |
| **Design System** | Vibe é polido, documentado, open-source | Criar design system consistente para o frontend do Scrumban |
| **Onboarding** | "Parece planilha" — zero learning curve | A table view do Scrumban deve ser o default — familiar para qualquer usuário |

### 4.3. Onde o Scrumban Ganha (Diferencial Competitivo)

| Aspecto | Diferencial | Por Que Importa |
|---------|------------|-----------------|
| **Flow Metrics nativos** | Cycle Time, Lead Time, Throughput, WIP Age, CFD com percentis p50/p75/p90 — tudo built-in, por projeto E por fase | Monday não tem isso nativamente. Para equipes Lean/Kanban, isso é decisivo |
| **State Machine formal** | 9 estados V3 com transições validadas (não é label livre) | Garante integridade do workflow — impossível colocar task em estado inválido |
| **Agente IA autônomo** | Claude Code rodando em VPS com Risk Gate (LOW/MED/HIGH), 58 testes adversariais, HMAC bilateral | Nível enterprise de automação IA que Monday não oferece |
| **Nexus IA Chat** | Chat com Gemini + tools que consultam dados reais do projeto (tasks, métricas, resumos) | IA que "entende" o projeto, não apenas sugere colunas |
| **Telegram nativo + voz** | Canal Telegram com Groq Whisper para transcrição de áudio | Acessibilidade mobile sem app dedicado |
| **Modelo polimórfico** | 17 tabelas canônicas servem QUALQUER domínio via DClasse | Extensibilidade infinita sem schema changes — Monday precisa do mondayDB custom para isso |
| **Self-hosted** | Deploy próprio, dados sob controle total | Compliance e soberania de dados (crítico para gov/enterprise BR) |
| **Custo** | Sem per-seat pricing | Para times 50+, Monday fica caro ($950+/mês no Pro) |
| **Hierarquia Space/Folder/List** | Modelagem similar ao Monday mas nativa no DProject polimórfico | Organizacional flexível sem tabelas extras |

### 4.4. Lacunas Críticas para Fechar

Funcionalidades que o Monday tem e o Scrumban precisa priorizar para competir:

| Prioridade | Feature | Esforço | Como Resolver no Scrumban |
|-----------|---------|---------|--------------------------|
| **P0** | Table view com edição inline | Frontend | View padrão tipo spreadsheet consumindo GET /tasks + PUT /tasks/:id |
| **P0** | Colunas customizáveis por list/board | Backend + Frontend | Expandir `tableFields` no DClasse da List (-352) para definir schema de colunas custom |
| **P1** | Kanban view (drag and drop) | Frontend | Consumir GET /tasks + PUT /tasks/:id/status com drag entre colunas |
| **P1** | Automações visuais (no-code) | Backend + Frontend | Builder visual tipo "When X then Y" mapeando para DEvento triggers + actions |
| **P2** | Gantt / Timeline view | Frontend | Consumir tasks com dates + dependencies para renderizar barras |
| **P2** | Calendar view | Frontend | Consumir tasks com due dates para renderizar em calendário |
| **P2** | Formula columns | Backend | Evaluator de expressões sobre campos do `dados` Json |
| **P3** | Real-time collaboration | Backend | WebSocket/SSE para push de updates (presença, edições simultâneas) |
| **P3** | Workload view | Frontend | Consumir tasks agrupadas por assignee + timeline |

---

## 5. CONCLUSÃO EXECUTIVA

### O Monday.com é excelente em:
- **UX de planilha turbinada**: familiar, zero learning curve, edição inline
- **Flexibilidade visual**: 40+ tipos de coluna, 11 views, cores customizáveis
- **Automações acessíveis**: non-devs configuram fluxos complexos
- **Ecossistema**: 100+ integrações, marketplace de apps, GraphQL API madura

### O Scrumban já é superior em:
- **Profundidade de métricas**: Flow Metrics nativos (Cycle Time, Lead Time, CFD, etc.) são diferencial real para times ágeis sérios
- **Automação IA**: Agente Claude Code + Nexus IA Chat estão anos à frente do que Monday oferece em AI
- **Integridade de workflow**: State machine V3 com 9 estados garante consistência que labels livres não podem
- **Arquitetura extensível**: modelo polimórfico de 17 tabelas permite crescer sem limites estruturais
- **Custo e soberania**: self-hosted, sem per-seat, dados sob controle total

### Estratégia recomendada:
1. **Não tentar ser o Monday** — tentar copiar 40+ tipos de coluna é uma corrida perdida contra uma empresa de $10B+ de valuation
2. **Investir no diferencial**: Flow Metrics, IA (Nexus + Agent), State Machine V3 — features que o Monday não tem e não terá facilmente
3. **Importar os acertos de UX**: table view com edição inline, status coloridos, drag-and-drop — são padrões de indústria, não IP do Monday
4. **Posicionar como "Monday para times de engenharia"**: onde métricas de fluxo, automação IA e integridade de processo importam mais do que colunas coloridas

---

## Fontes

### Monday.com — Features e Documentação
- [monday.com Features 2025 — Stackby](https://stackby.com/blog/monday-com-features/)
- [monday.com Features — Advaiya](https://advaiya.com/monday-com-project-management-features/)
- [Complete Guide Monday.com 2025 — Quirk](https://www.quirk.com.au/what-is-monday-com-complete-guide-2025/)
- [Monday Board Features 2026 — Everhour](https://everhour.com/blog/monday-board/)
- [Available Column Types — monday.com Support](https://support.monday.com/hc/en-us/articles/115005310285-Available-column-types-on-monday-com)
- [Column Types API Reference — monday.com Developer](https://developer.monday.com/api-reference/reference/column-types-reference)
- [Formula Column — monday.com Support](https://support.monday.com/hc/en-us/articles/360001235445-The-Formula-Column)
- [Mirror Column — monday.com Support](https://support.monday.com/hc/en-us/articles/360001733859-The-Mirror-Column)
- [19 Types of Views — SimonSezIT](https://www.simonsezit.com/article/types-of-views-on-monday-com/)
- [Structural Hierarchy — monday.com Support](https://support.monday.com/hc/en-us/articles/7278527605906-Understanding-monday-com-s-structural-hierarchy)
- [Multi-Level Boards — monday.com Developer](https://developer.monday.com/api-reference/docs/working-with-multi-level-boards)

### Monday.com — Arquitetura Técnica
- [mondayDB Architecture — monday Engineering](https://engineering.monday.com/nice-to-meet-you-mondaydb-architecture/)
- [mondayDB — Brand New Data Architecture](https://monday.com/w/mondaydb)
- [Multi-Regional Architecture — monday Engineering](https://engineering.monday.com/monday-coms-multi-regional-architecture-a-deep-dive/)
- [Infrastructure Management — monday Engineering](https://engineering.monday.com/how-we-manage-software-infrastructure-at-monday-com/)
- [Kubernetes Multi-Cluster — monday Engineering](https://engineering.monday.com/building-a-resilient-and-scalable-infrastructure-with-kubernetes-multi-cluster/)
- [Why Monday Built mondayDB — TechCrunch](https://techcrunch.com/2023/10/22/monday-mondaydb-new-database/)
- [What is mondayDB for Enterprises — Fruition](https://www.fruitionservices.io/post/what-is-monday-db-for-enterprises)

### Monday.com — Design e UX
- [Vibe Design System — Storybook](https://vibe.monday.com/)
- [Vibe Design System — Design Systems Surf](https://designsystems.surf/design-systems/mondaycom)
- [monday.com Brand Colors — Mobbin](https://mobbin.com/colors/brand/monday-com)
- [UI/UX Guidelines — monday.com Developer](https://developer.monday.com/apps/docs/uiux)

### Monday.com — Pricing e Mercado
- [Pricing Plans 2026 — ShipChain](https://monday.shipchain.io/monday-pricing-plans/)
- [Pricing 2026 — SaaSworthy](https://www.saasworthy.com/blog/monday-com-pricing-plans)
- [Pricing Comparison — SmartSuite](https://www.smartsuite.com/blog/monday-pricing)

### Monday.com — API e Integrações
- [Platform API — monday.com Developer](https://developer.monday.com/api-reference)
- [Build with AI / MCP — monday.com Developer](https://developer.monday.com/api-reference/docs/build-on-monday-with-ai)
- [GraphQL Overview — monday.com Developer](https://developer.monday.com/api-reference/docs/introduction-to-graphql)
- [Webhook Integration — monday.com Support](https://support.monday.com/hc/en-us/articles/360003540679-Webhook-integration)
