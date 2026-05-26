# Decisão Arquitetural: Modelo de Eventos de Calendário no Planner

**Data:** 2026-05-26  
**Status:** Em análise  
**Contexto:** Integração do módulo Planner (Scrumbam-Frontend-V2) com persistência real no banco de dados

---

## O Problema

O Planner do Scrumbam precisa salvar e recuperar **eventos de agenda** — reuniões, compromissos, blocos de tempo, almoços, ligações. Esses eventos têm características próprias: hora de início, hora de fim, dia inteiro (allDay), link de videoconferência, local, participantes, e futuramente um `googleEventId` para sincronização com Google Calendar.

A regra da empresa (ADR-V2-001) proíbe criar tabelas novas sem justificativa forte. Por isso este documento analisa as **17 tabelas canônicas** do banco polimórfico para verificar se alguma serve — e justifica a decisão final.

---

## Análise: Por que cada tabela NÃO serve

---

### 1. `DClasse` — Taxonomia / Sistema de Tipos

**O que é:** Governa o sistema inteiro. Toda outra tabela aponta para `DClasse` via `idClasse` para saber qual é o seu "tipo real". Funciona como um dicionário central de classificações.

**Por que não serve para guardar eventos de calendário:**  
`DClasse` não guarda dados de negócio — ela guarda *tipos*. Um evento de calendário é um dado ("reunião na sexta às 14h"), não um tipo. Guardar um evento aqui seria como escrever uma nota fiscal dentro da tabela de notas fiscais do contador. O papel dela no evento de calendário seria apenas classificar o tipo do evento (reunião, almoço, etc.) — ela *participa* da solução, mas não *é* a solução.

---

### 2. `DEntidade` — Cadastro Universal Polimórfico

**O que é:** Pessoas, organizações, locais, contas. Qualquer "entidade" com quem o sistema se relaciona. Um usuário, uma empresa, uma cidade, uma conta bancária — tudo entra aqui diferenciado por `idClasse`.

**Por que não serve para guardar eventos de calendário:**  
`DEntidade` representa *quem existe*, não *o que acontece*. Um evento de calendário é uma ocorrência no tempo ("reunião acontece quinta às 10h"), não um cadastro de algo que existe permanentemente. Além disso, os campos da tabela são voltados para cadastro: CPF/CNPJ, endereço, agência bancária, limite de crédito. Nenhum desses campos faz sentido para um evento. O único aproveitamento seria guardar participantes via `idAssignee` em outra tabela, o que é correto — mas `DEntidade` *referencia* participantes, ela não *é* o evento.

---

### 3. `DTabela` — Lookups, Configurações, Catálogos

**O que é:** Tabela de catálogos e configurações. É onde vivem os enums do sistema: status de task, nível de prioridade, tipo de sprint, nome do sprint. Funciona como uma tabela de "opções" que outras tabelas referenciam via FK.

**Por que não serve para guardar eventos de calendário:**  
`DTabela` guarda *opções de catálogo*, não eventos com data e hora. Seria o equivalente a guardar uma reunião no mesmo lugar onde você guarda "Alta", "Média", "Baixa" de prioridade. Os campos que ela tem (`nome`, `codigo`, `descricao`, `percentual`) são de catálogo, não de agendamento. Não tem `startAt`, `endAt`, `idAssignee`, `location` — e não faria sentido ter, porque não é esse o propósito dela. `DTabela` *participa* da solução (os tipos de evento seriam seeds aqui), mas não *é* onde o evento vive.

---

### 4. `DVincula` — Relações Genéricas (N:N, 1:N)

**O que é:** Tabela de vínculos polimórficos. Serve para representar qualquer relação entre entidades que não cabe em uma FK direta: membros de um grupo, documentos associados a um projeto, permissões de acesso a Spaces privados.

**Por que não serve para guardar eventos de calendário:**  
`DVincula` representa *relacionamentos*, não *eventos*. Um vínculo diz "A está ligado a B de tal forma". Um evento diz "isso acontece na quinta às 14h, dura 1 hora, é uma reunião, tem link do Zoom". Os campos que `DVincula` tem são de relacionamento: `idLocEscritu` (dono), `idEntidade` (lado B), `percentual`, `referencia`. Não há nenhum campo de data/hora, nenhum campo de duração, nenhum campo de local de evento. `DVincula` *seria útil* como tabela auxiliar para guardar a lista de participantes de um evento (relação N:N entre evento e entidade), mas ela não pode ser o evento em si.

---

### 5. `DEvento` — Audit Trail

**O que é:** Registro de auditoria do sistema. Toda vez que algo importante acontece no sistema (task mudou de status, usuário fez login, pedido foi aprovado), um registro entra aqui para rastreabilidade.

**Por que não serve para guardar eventos de calendário:**  
Apesar do nome enganoso, `DEvento` é exclusivamente para **trilha de auditoria** — acontecimentos do passado que precisam ser rastreados. Não tem campos de data futura, não tem `startAt`/`endAt`, não tem participantes. É imutável por design: registros de auditoria não são editados. Um evento de calendário é criado, editado, cancelado, compartilhado — o oposto de auditoria. Usar `DEvento` para calendário seria um abuso semântico grave: misturaria "o sistema aprovou um pedido" com "tem reunião às 14h", tornando a auditoria inutilizável.

---

### 6. `DRecurso` — Produtos, Serviços, Ativos

**O que é:** Catálogo de produtos e serviços. Guarda o que pode ser vendido, comprado ou consumido: nome, preço, custo, unidade.

**Por que não serve para guardar eventos de calendário:**  
`DRecurso` é um catálogo de *itens*, não de *ocorrências no tempo*. Os campos são todos de produto: `preco`, `custo`, `unidade`. Não existe nenhuma aproximação possível com eventos de agenda. A única conexão seria se "sala de reunião" fosse modelada como um recurso reservável — mas isso seria uma feature separada de reserva de salas, não o evento de calendário em si.

---

### 7. `DUserGroup` — Usuários e Grupos

**O que é:** Autenticação. Guarda usuários e grupos, diferenciados por `idClasse`. Senhas, tokens de acesso, chaves MCP, estado de MFA.

**Por que não serve para guardar eventos de calendário:**  
`DUserGroup` é exclusivamente para **autenticação e autorização**. Seus campos são: `usuario`, `senha`, `email`, `ativo`, `ultimoLogin`, `dados` (tokens). Nenhum desses campos tem relação com agendamento. O `DUserGroup` do criador do evento seria uma *referência* dentro do evento, mas nunca o lugar onde o evento vive.

---

### 8. `DPermissao` — Permissões por Grupo

**O que é:** Matriz RBAC (controle de acesso baseado em papéis). Define quem pode fazer o quê em qual recurso do sistema.

**Por que não serve para guardar eventos de calendário:**  
`DPermissao` é infraestrutura de segurança pura. Seus campos são: `recurso` (string do recurso), `acao` (string da ação), `permitido` (boolean). É estruturalmente impossível guardar um evento de calendário aqui. Não há campos de tempo, título, participantes, ou qualquer coisa relacionada a agendamento.

---

### 9. `DTask` — Tarefas, Atividades, Etapas

**O que é:** O coração do Scrumban. Tasks polimórficas com state machine V3, hierarquia de fases, identifier DEV-N, métricas de ciclo, telemetria de trabalho.

**Por que não serve para guardar eventos de calendário — análise detalhada:**

Esta é a tabela que mais se aproxima e por isso merece análise mais profunda.

**O que ela tem que parece útil:**
- `nome` → título do evento ✅
- `descricao` → descrição ✅
- `idAssignee` → responsável ✅
- `idPriority` → prioridade ✅
- `dueDate` → data ✅ (parcialmente)
- `dados` (JSON) → poderia guardar `startAt`, `endAt`, `meetLink`, `location`

**Os problemas que ela cria:**

**Problema 1 — Poluição do Kanban.**  
O board Kanban lista tasks por `idProject`, `idStatus`, `idSprint`. Se eventos de calendário vivem em `DTask`, toda listagem do Kanban precisa de um filtro extra `WHERE idClasse != -210` para não mostrar "almoço com cliente" no board de sprints. Hoje esse filtro não existe. Seria adicionado em cascata em todos os endpoints, todos os dashboards, todas as métricas.

**Problema 2 — State machine incompatível.**  
`DTask` tem uma state machine V3 com estados: INBOX → READY → EXECUTING → DONE → FAILED. Uma reunião de calendário não tem esses estados. Forçar um evento de agenda nessa máquina de estados cria registros com estado `INBOX` para sempre, ou exige que a state machine aprenda a ignorar `idClasse = -210` — mais código defensivo.

**Problema 3 — Identifier DEV-N obrigatório.**  
Toda `DTask` gerada pelo sistema recebe um identifier atômico: DEV-47, DEV-48, DEV-49. Um "almoço às 13h" não deveria ter o identifier DEV-312. Isso polui o sequence de identifiers, que é usado para rastrear o histórico de trabalho da equipe.

**Problema 4 — Sem `startAt`, sem duração.**  
`DTask` só tem `dueDate` — uma data de vencimento. Um evento de calendário precisa de `startAt` (quando começa) e `endAt` (quando termina) para ser posicionado como bloco no grid horário. Guardar esses campos em `dados` JSON resolve tecnicamente, mas cria dados críticos sem indexação, sem constraint de banco, sem validação nativa. Filtrar "eventos entre 09h e 17h de quinta" via JSON é lento e frágil.

**Problema 5 — Integração Google Calendar futura.**  
O Google Calendar retorna eventos com `eventId`, `start.dateTime`, `end.dateTime`, `attendees[]`, `conferenceData`. Para sincronizar bidireccionalmente, esses campos precisam ser colunas indexáveis — especialmente `googleEventId` (para detectar duplicatas) e `startAt`/`endAt` (para queries de período). Em JSON, uma query de "todos os eventos da semana" vira um full table scan com filtro de JSON, impossível de indexar corretamente no PostgreSQL sem extensões específicas.

**Veredicto:** `DTask` é o "menos pior" das 17 tabelas, mas os 5 problemas acima são dívidas técnicas reais que crescem com o tempo, especialmente o Problema 5 quando o Google Calendar entrar.

---

### 10. `DProject` — Projetos, Boards, Spaces

**O que é:** Container de tasks. Representa um Space, Folder, List ou Board. Hierarquia self-referencial: Space → Folder → List.

**Por que não serve para guardar eventos de calendário:**  
`DProject` é um *container*, não um *evento*. Seus campos são de projeto: `nome`, `descricao`, `repoUrl`, `privado`. Um evento de calendário não é um projeto — é uma ocorrência pontual no tempo. O que faz sentido é que um evento *pertença* a um projeto (via `idProject` em uma futura tabela de evento), não que ele *seja* um projeto.

---

### 11. `DPedido` — Transacional (Compras, Vendas, Execuções)

**O que é:** Motor de pedidos transacionais. Compras, vendas, PIX, e execuções de Claude Code. Tem um workflow obrigatório: nova → calcula → aprova → grava, executado pelo Engine.

**Por que não serve para guardar eventos de calendário:**  
`DPedido` é um **motor transacional com workflow obrigatório**. Criar um evento de calendário passaria obrigatoriamente pelo Engine (preCalc → calc → posCalc → preGrav → posGrav), o que é um overhead arquitetural absurdo para "criar uma reunião". Além disso, os campos são financeiros: `valor`, `desconto`, `valorTotal`, `dataAprovacao`, `dataBaixa`. Um evento de agenda não tem valor financeiro, não precisa de aprovação, não é baixado. A semelhança termina em `dataEmissao` (quando foi criado) — que é o `criadoEm` de qualquer tabela.

---

### 12. `DTitulo` — Financeiro (Contas a Pagar/Receber)

**O que é:** Faturas e títulos financeiros. Contas a pagar e receber com datas de vencimento e pagamento.

**Por que não serve para guardar eventos de calendário:**  
`DTitulo` é exclusivamente financeiro. Campos: `tipo` (PAG | REC), `valor`, `valorPago`, `dataVencimento`, `dataPagamento`, `baixado`. A única semelhança superficial com eventos de calendário é que `dataVencimento` é uma data importante que apareceria no planner — e isso de fato seria útil *renderizar* no planner (mostrar vencimentos como marcadores), mas renderizar não é o mesmo que *armazenar* eventos de calendário aqui.

---

### 13. `DMovDispo` — Ledger Financeiro (Extrato)

**O que é:** Registro imutável de movimentações financeiras. Créditos e débitos em contas bancárias/caixas.

**Por que não serve para guardar eventos de calendário:**  
Ledger financeiro é imutável por design — registros não são editados, apenas acrescentados. Um evento de calendário é editável, cancelável, remarcável. Além disso, campos como `idDisponivel` (conta bancária), `tipo` (CRED | DEB), `valor`, `saldoApos` não têm nenhuma relação com agendamento.

---

### 14. `DMovDepos` — Movimentação de Estoque

**O que é:** Registro de entradas e saídas de estoque em almoxarifados.

**Por que não serve para guardar eventos de calendário:**  
Mesma natureza de ledger imutável que `DMovDispo`, aplicado a estoque. Campos: `idDeposito`, `idRecurso`, `quantidade`, `custo`. Nenhuma relação semântica ou estrutural com eventos de calendário.

---

### 15. `DSolicita` — Solicitações de Transferência

**O que é:** Solicitações de transferência de itens entre depósitos. Workflow PEND → APROV → BAIX.

**Por que não serve para guardar eventos de calendário:**  
`DSolicita` é logística de estoque com workflow. Campos: `idOrigem` (depósito origem), `idDestino` (depósito destino), `status` (PEND | APROV | BAIX). Não existe nenhuma aproximação possível com agendamento de eventos.

---

### 16. `DRequisic` — Requisições Internas

**O que é:** Requisições internas de consumo de recursos em centros de custo.

**Por que não serve para guardar eventos de calendário:**  
Mesma natureza de `DSolicita` — logística interna. Campos: `idDeposito`, `idCentroCusto`, `status` (PEND | APROV | BAIX). Nenhuma relação com calendário.

---

### 17. `DVFS` — Virtual File System (Scripts dos Engines)

**O que é:** Scripts JavaScript/TypeScript executáveis que customizam o comportamento dos Engines (DPedido) sem alterar o código. Permite injetar lógica de negócio por projeto.

**Por que não serve para guardar eventos de calendário:**  
`DVFS` é infraestrutura de execução de código, não de dados de negócio. Campos: `chaveScript` (3..7 = etapas do Engine), `conteudo` (código JS), `versao`, `ativo`. Guardar um evento de calendário aqui seria como guardar uma reunião dentro de um arquivo `.js`. Não faz sentido nenhum.

---

## Conclusão

Das 17 tabelas canônicas do banco Devari-Core:

- **16 tabelas** têm zero encaixe semântico com eventos de calendário
- **1 tabela** (`DTask`) tem encaixe parcial (~50%) mas gera 5 problemas técnicos graves que crescem com o tempo, especialmente quando a integração com Google Calendar for implementada

**Nenhuma das 17 tabelas foi projetada para eventos de calendário.** O banco polimórfico foi desenhado para cobrir qualquer domínio, mas a cobertura se dá via *composição* de tabelas — e para eventos de calendário, a composição ideal é:

| Responsabilidade | Tabela canônica que cobre |
|---|---|
| Tipo do evento (reunião, almoço...) | `DClasse` (seed nova `-210`) |
| Responsável / criador | `DEntidade` (via FK) |
| Participantes N:N | `DVincula` (com `idClasse` próprio) |
| O evento em si (startAt, endAt, allDay...) | **Não coberto** — precisa de tabela nova |

---

## Recomendação

Abrir **exceção documentada ao ADR-V2-001** para criar `DCalendarEvent` com os seguintes campos mínimos:

```sql
chave        BigInt PK
idClasse     BigInt FK → DClasse   -- tipo do evento (-210=reunião, -211=tarefa, etc.)
idProject    BigInt FK → DProject  -- space/calendário a que pertence
idCreator    BigInt FK → DEntidade -- quem criou
idAssignee   BigInt FK → DEntidade -- responsável principal
nome         VARCHAR(512)          -- título
descricao    TEXT
startAt      TIMESTAMPTZ NOT NULL  -- obrigatório: quando começa
endAt        TIMESTAMPTZ           -- quando termina (null = allDay sem hora fim)
allDay       BOOLEAN DEFAULT false
meetLink     VARCHAR(512)          -- Zoom, Meet, Teams
location     VARCHAR(512)          -- endereço ou sala
googleEventId VARCHAR(255)         -- para sincronização futura (indexado)
dados        JSON                  -- campos extras futuros
excluido     BOOLEAN DEFAULT false
criadoEm     TIMESTAMPTZ
atualizadoEm TIMESTAMPTZ
```

**Justificativa da exceção:**
1. Nenhuma das 17 tabelas cobre este domínio sem causar dívida técnica mensurável
2. Integração futura com Google Calendar requer `googleEventId` indexável — impossível em JSON de forma performática
3. Queries de período (`startAt BETWEEN ? AND ?`) precisam de índice de coluna real
4. Separação semântica limpa: tasks do Kanban nunca aparecem no calendário e vice-versa
5. A exceção é pontual, documentada e tecnicamente justificada — não é proliferação arbitrária de tabelas

---

*Documento gerado em 2026-05-26 para subsidiar decisão arquitetural do Scrumbam-Backend-V2.*
