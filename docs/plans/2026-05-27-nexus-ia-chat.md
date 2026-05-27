# PLANO — Frente B: Nexus IA Chat (v1)

**Criado por:** Strategist Agent (Scrumban-Backend-V2)
**Data:** 2026-05-27
**Projeto:** Scrumban-Backend-V2 (NestJS + Prisma) + Scrumbam-Frontend-V2 (Next.js)
**Estimativa Total:** 8–10h base, ~12h com buffer 20% (otimista 7h / realista 10h / pessimista 14h)
**Prioridade:** MUST (sprint atual)
**Score Gate Reviewer:** ≥ 7.0 (padrão V2; sem reforço especial nesta sprint)

---

## 0. Contexto e Objetivo Primário

**Palavra do usuário (CEO):** *"pergunta-resposta funcionar"*.

Objetivo único da v1: o usuário abre o chat Nexus no frontend, digita uma
pergunta, a IA responde — usando 4 tools quando relevantes (criar/listar
comentários, criar task, resumir projeto). Histórico persiste entre sessões
(conversa única por user, rolling).

NÃO É objetivo da v1:
- Múltiplas conversas por user (sidebar estilo ChatGPT).
- Streaming de tokens.
- Múltiplos providers (só Gemini).
- Seletor de modelo na UI.
- Tools além das 4 listadas.
- RAG, voice, dashboards.

Tudo o que aparece em "**Categoria de Expansão Futura**" (seção 11) é
EXPLICITAMENTE deferido — listado para rastreabilidade, não para escopo.

---

## 1. Decisões Arquiteturais Fechadas (NÃO REVISITAR)

Sete decisões do usuário, congeladas:

1. **Provider IA:** Gemini único na v1. Arquitetura PREPARADA para adicionar
   Claude/OpenAI depois (interface `AiProvider`), mas v1 só implementa
   `GeminiProvider`. Sem seletor de modelo na UI.
2. **API Key:** backend NestJS é proxy. Strategist decide o storage — ver
   seção 2.3 (decisão: **DTabela canônica ADR-V2-004, idClasse=-481 GEMINI_API_KEY**).
3. **Tools (catálogo v1, mínimo útil):**
   - `createComment(targetType, targetId, texto)` — proxy do CommentsService.
   - `listComments(targetType, targetId, limit?)` — proxy do CommentsService.
   - `createTask(projectId, nome, descricao?, idPai?)` — proxy do POST /tasks.
   - `getProjectSummary(projectId)` — combina GET /projects/:id + GET /projects/:id/stats.
   - PARAR AQUI. v1 não tem mais tools.
4. **Persistência:** PERSISTENTE desde v1 via `DEvento idClasse=-508
   AI_CHAT_MESSAGE`. `identificadorExterno = entidadeId.toString()` do user
   (conversa única). ZERO tabela nova (ADR-V2-001 respeitado).
5. **Modo resposta:** COMPLETA (não streaming). Backend retorna JSON puro
   `{ assistantMessage, toolCalls? }`. Streaming fica na expansão futura.
6. **System prompt:** simples, com personalidade Nexus (ver seção 5.3.4).
7. **Conversa única na v1, múltiplas na v2:** schema já pronto — para v2
   basta trocar `identificadorExterno = entidadeId` por
   `identificadorExterno = uuidConversa` SEM mudança de schema. Documentar
   no seed e no README do módulo.

---

## 2. Investigação Concluída (Estado do Repositório 2026-05-27)

### 2.1 `startTask` — endpoint existe?

**Resposta:** "Iniciar task" no domínio Scrumban significa **criar uma task**
no projeto, que entra no estado `INBOX` (state machine V3). O endpoint canônico
é:

```
POST /tasks
Body: { nome, projectId, idPai?, descricao?, priority?, assigneeId?, ... }
Response: TaskResponseDto { id, identifier: 'DEV-N', status: 'INBOX', ... }
```

Confirmado em `src/tasks/tasks.controller.ts:104-121`. O service injeta
`accessibleProjectIds` via `ProjectsService.findAccessibleProjectIds` —
defesa em profundidade ADR-V2-042 já implementada.

**Decisão da tool:** `createTask` (nome melhor que `startTask` — fiel ao
domínio). O usuário pode pedir "crie uma task para investigar o bug X" e a
IA chama `POST /tasks` com `projectId` derivado do contexto.

> **Não confundir com `POST /executions`** (Claude Code automation, F13).
> Isso é Risk Gate + Engine OperacaoExecucaoClaude e está FORA do escopo
> v1 — fica como tool futura quando o agente VPS estiver operacional.

### 2.2 `getProjectSummary` — endpoint existe?

**Resposta:** Não existe um endpoint único `/summary`, MAS dois endpoints já
existentes cobrem 100% do que a IA precisa, e podem ser combinados pela tool
no servidor SEM criar endpoint novo:

| Endpoint | Retorno |
|----------|---------|
| `GET /projects/:id` | `ProjectResponseDto` — nome, descricao, prefix, slug, color, icon, memberCount, criadoEm, idClasse (SPACE/FOLDER/LIST/DOC), idPai |
| `GET /projects/:id/stats` | `ProjectStatsDto` — contadores de tasks por status V3 (INBOX/READY/EXECUTING/DONE/FAILED/CANCELLED/DISCARDED/VALIDATING/VALIDATED) |

Confirmado em `src/projects/projects.controller.ts:179-187, 270-276`.

**Decisão:** A tool `getProjectSummary` é IMPLEMENTADA NO BACKEND como
**combinação de duas chamadas de service** (`ProjectsService.findOne` +
`ProjectsService.getStats`) embaladas num único retorno conciso para a IA:

```ts
{
  id, nome, descricao, prefix, slug, icon, color, memberCount,
  classe, idPai,  // hierarquia (SPACE/FOLDER/LIST/DOC)
  stats: { total, inbox, ready, executing, done, failed, ... },
  topPendingTasks: TaskBrief[]  // OPCIONAL — primeiras 5 tasks em READY/EXECUTING
}
```

`topPendingTasks` enriquece o sumário com 5 tasks "vivas" via
`TasksService.findMany({ projectId, status: ['READY','EXECUTING'], limit: 5 })`.
Custo: 1 query extra, alto valor para resposta da IA. **NÃO criar endpoint
HTTP novo** — a tool chama os services diretamente dentro do `AiToolsService`
do próprio backend.

### 2.3 Padrão de API Key — DTabela ou env var?

**Pesquisa:** ADR-V2-004 já está em vigor — `src/auth/services/api-key.service.ts`
guarda API keys em **DTabela idClasse=-471** com `dados.hash`, `dados.prefix`,
`dados.createdBy`, `dados.lastUsedAt`. Mesmo padrão para MCP_KEY (-472),
INSTALL_TOKEN (-473), PAIRING_TOKEN (-474), INVITE_TOKEN (-476).

**Decisão:** **DTabela canônica — nova DClasse `-481 GEMINI_API_KEY` filha
de STATUS (-52)**. NÃO usar env var. Razões:

1. **Consistência com ADR-V2-004** — todas as chaves do sistema vivem em
   DTabela. Quebrar o padrão para Gemini cria precedente ruim.
2. **Rotação sem redeploy** — admin pode atualizar a key pelo `/api-keys`
   admin UI (futuro) sem mexer no `.env` do Dokploy.
3. **Multi-tenant futuro** — quando organizações forem trazer suas próprias
   Gemini keys (caso de uso plausível), `dEntidadeId` já vincula à org.
   v1: apenas 1 key global (`dEntidadeId = null`).
4. **Audit trail nativo** — `criadoEm` / `atualizadoEm` da DTabela.

**Schema do registro:**

```ts
DTabela {
  idClasse: -481,            // GEMINI_API_KEY
  nome: 'Gemini API Key (global)',
  codigo: 'gemini-prod',
  dEntidadeId: null,         // v1: global; v2 multi-tenant: org ID
  dados: {
    hash: '<sha256 do plaintext>',     // para verificar match (sanity)
    plaintext: '<key real>',           // NECESSÁRIA aqui — backend chama Gemini
    prefix: 'AIzaSy...',               // primeiros 8 chars
    createdBy: '<entidadeId>',
    lastRotatedAt: '<iso>',
  }
}
```

> **Atenção:** ao contrário das API keys de saída (X-API-Key, MCP-Key) que
> guardamos apenas como hash (validamos por comparação SHA-256), a Gemini
> key é uma chave de SAÍDA — precisa do plaintext em runtime para chamar
> a API do Google. Guardar plaintext criptografado em produção é o ideal
> (Vault/KMS) — para v1, aceitamos plaintext em `dados.plaintext` SEM
> versionamento e SEM expor em endpoint. Aprovação CEO necessária se
> quisermos elevar a barra — ver risco R-2.
>
> **Fallback explícito:** se a DTabela -481 não existir OU `dados.plaintext`
> for nulo, o `GeminiProvider` tenta `process.env.GOOGLE_API_KEY`. Isso
> garante que devs locais (sem rodar seed admin) consigam usar `.env`,
> mantendo o caminho canônico DTabela como preferencial em prod.

### 2.4 AI SDK Frontend — shape esperado do backend

O frontend já depende do **Vercel AI SDK** (`useChat` hook). Investigação:

- `useChat` aceita `api: '/api/ai/chat'` como rota POST.
- Body padrão enviado por `useChat`: `{ messages: Array<{ role, content }> }`.
- Response esperado: **streaming SSE** por padrão (`data: {...}\n\n`).
- Para **resposta completa** (não streaming), o frontend pode usar `fetch`
  direto OU o `useChat` aceita response não-streamed com workaround
  (resposta serializada como single SSE event).

**Decisão (alinhada ao item 5 das decisões fechadas):** v1 = **endpoint
JSON puro** (`POST /ai/chat` retorna `application/json`, não SSE). Frontend
usa `fetch` puro com um hook custom mínimo (`useNexusChat`), NÃO `useChat`
do AI SDK. Razões:

- Compatível com a decisão "modo COMPLETA (não streaming)".
- Evita instalar `ai` no backend.
- Hook custom de 30 linhas (estado: messages, loading, error, sendMessage).
- v2 streaming: trocar endpoint para SSE e migrar para `useChat` (mudança
  isolada no frontend).

### 2.5 Pacote npm Gemini — disponibilidade

**Pesquisa em `package.json` do backend:** `@google/generative-ai` **NÃO está
instalado**. Não é necessário instalar no frontend (chamadas vão pelo
backend).

**Decisão:** instalar `@google/generative-ai` (oficial Google) no backend.
Última versão estável tem suporte completo a function calling (tools).
Adicionado em B.2 (não em B.0/B.1).

---

## 3. Schema e Seed (Pilar 3)

### 3.1 Novas DClasses

Duas DClasses a adicionar em `prisma/seeds/classes.seed.ts`:

```ts
// === IA / Nexus (Frente B — v1) ===
// -481 GEMINI_API_KEY: DTabela com plaintext + hash da chave Gemini global
// (v1: dEntidadeId=null; v2 multi-tenant: dEntidadeId=orgId). Filha de STATUS
// (-52), seguindo padrão das outras keys (-471/-472/-473/-474/-476).
esp(-481, 'GEMINI_API_KEY', 'Chave Gemini (provider IA Nexus)', -52),

// -508 AI_CHAT_MESSAGE: DEvento polimórfico — mensagens do chat IA Nexus.
// identificadorExterno=entidadeId (v1: conversa única por user) ou
// UUID (v2: múltiplas conversas, schema não muda). idEntidade=user logado.
// descricao=texto da mensagem. metaDados={ role, model, tokens?, toolCalls?, ... }.
// Filha de EVENTOS (-3), padrão histórico de DEventos de audit.
esp(-508, 'AI_CHAT_MESSAGE', 'Mensagem do chat IA Nexus (polimorfica user/assistant)', -3),
```

**COUNTS:** atualizar `especificas: 105 → 107`, `total: 150 → 152`.

**Validação:** `validateHierarchy(classes)` roda em time de import. Como
-52 e -3 já existem, nenhuma violação.

### 3.2 Não há ADR nova necessária

A decisão "v1 conversa única / v2 múltiplas via identificadorExterno"
**não** precisa de ADR formal — é uma decisão de produto que não toca
schema. Documentar no **comentário do seed** (acima) + no **README do
módulo `src/ai/`**. Caso o usuário queira ADR mesmo assim, abrir
`ADR-V2-AI-001-conversa-unica-v1.md` no final, mas não bloquear B.2.

ADR **necessária**: nenhuma. Os ADRs vigentes que cobrem este trabalho:

- **ADR-V2-001** — zero tabela nova → respeitado.
- **ADR-V2-004** — API keys via DTabela → reusado para `-481 GEMINI_API_KEY`.
- **ADR-V2-005** — Engine apenas em DPedido idClasse=-300 → DEvento -508
  é audit/structural, Prisma direto, Pilar 1 não se aplica.

### 3.3 Novos Event Types

Em `src/eventos/core/event-types.ts`, adicionar:

```ts
// ============== NEXUS IA CHAT (Frente B — v1) ==============
// Emitidos APÓS persistência da DEvento -508. metaDados carrega role,
// model, tokens, toolCalls — payload completo para audit/webhook futuro.
AI_CHAT_MESSAGE_CREATED: 'ai.chat.message.created',
AI_CHAT_TOOL_CALLED: 'ai.chat.tool.called',
```

Em `src/eventos/consumers/audit-log.consumer.ts`, adicionar em `TYPE_TO_CLASSE`:

```ts
'ai.chat.message.created': BigInt(-508), // AI_CHAT_MESSAGE
'ai.chat.tool.called':     BigInt(-508), // reusa -508 (mesma tabela de audit)
```

---

## 4. Database Migration Obrigatória (Fase B.0)

### 4.1 Justificativa

DEBT-COMMENTS-01 (do ROADMAP) é o índice composto `(idClasse,
identificadorExterno)` em DEvento. **TANTO comentários (-507) QUANTO chat IA
(-508) usam exatamente esse padrão de query:**

```sql
SELECT ... FROM DEvento
WHERE idClasse = -507 AND identificadorExterno = '<taskId>'   -- comments
WHERE idClasse = -508 AND identificadorExterno = '<userEntidadeId>' -- chat
ORDER BY chave DESC;
```

Sem o índice composto, o planner usa o índice existente `(idClasse)` e
filtra `identificadorExterno` em memória — degradação O(N) à medida que o
volume cresce. Com 1k mensagens de chat por user e 100 users = 100k linhas
em DEvento-508; sem índice composto, listagem de histórico vira lenta em
~1-2 semanas de uso.

### 4.2 Mudança no schema Prisma

`prisma/schema.prisma` — adicionar à seção `DEvento`:

```prisma
@@index([idClasse, identificadorExterno])
```

Junto com os 4 índices existentes (`@@index([idClasse])`,
`@@index([idEntidade])`, `@@index([criadoEm])`,
`@@index([idClasse, criadoEm(sort: Desc)])`).

### 4.3 Comando de migration

```bash
npx prisma migrate dev --name add_devento_classe_identificador_externo_idx
```

Nome do diretório resultante: `prisma/migrations/<timestamp>_add_devento_classe_identificador_externo_idx/`.

### 4.4 SQL up esperado (Prisma gera automaticamente)

```sql
CREATE INDEX "DEvento_idClasse_identificadorExterno_idx"
  ON "DEvento"("idClasse", "identificadorExterno");
```

### 4.5 SQL down (rollback)

```sql
DROP INDEX IF EXISTS "DEvento_idClasse_identificadorExterno_idx";
```

(Operação reversível, idempotente, sem perda de dados — é só índice.)

### 4.6 Idempotência e segurança

- `CREATE INDEX IF NOT EXISTS` é equivalente quando o Prisma marca a
  migration como aplicada. Re-rodar `prisma migrate deploy` é seguro.
- **NÃO usa `CONCURRENTLY`** — Prisma `migrate dev` não suporta nativo.
  Em produção (Dokploy), a tabela DEvento pode estar grande; o lock para
  `CREATE INDEX` bloqueia INSERTs durante segundos a minutos. **Mitigação:**
  executar a migration em janela de baixo tráfego OU editar manualmente o
  SQL gerado para usar `CREATE INDEX CONCURRENTLY` ANTES de
  `prisma migrate deploy`. Documentar isso no commit message e no Runbook.
- Backup: snapshot do Postgres em Dokploy ANTES do deploy é prática
  rotineira; nenhum passo extra.

### 4.7 Critério de sucesso B.0

- [ ] `npx prisma migrate dev` cria o diretório com `migration.sql`.
- [ ] Schema Prisma valida (`npx prisma validate`).
- [ ] Migration roda em dev sem erro.
- [ ] `EXPLAIN ANALYZE` em query típica de comentários ANTES vs DEPOIS
      mostra `Index Scan using DEvento_idClasse_identificadorExterno_idx`
      em vez de `Bitmap Heap Scan`.
- [ ] CHANGELOG + ROADMAP atualizados (DEBT-COMMENTS-01 marcada como
      concluída).

### 4.8 Tempo estimado B.0

- 30min implementação + teste local
- 15min documentação + commit

**Total: ~45min.** Implementer pode rodar B.0 sozinho — não exige
Strategist nem Reviewer formais (trivial, mas obrigatório antes de B.2).

---

## 5. Backend — Estrutura de Módulos (Fase B.2)

### 5.1 Diretório do módulo

```
src/ai/
  ai.module.ts
  ai-chat.controller.ts                  # POST /ai/chat, GET /ai/chat/history
  ai-chat.service.ts                     # orquestra: load → call → tools → persist → return
  chat-messages.service.ts               # CRUD DEvento -508 (espelha CommentsService)
  ai-tools.service.ts                    # implementa as 4 tools (server-side)
  gemini.provider.ts                     # implementa AiProvider interface
  gemini-api-key.service.ts              # leitura DTabela -481 + fallback env
  providers/
    ai-provider.interface.ts             # contrato — futuro Claude/OpenAI extendem
  dto/
    chat-message-request.dto.ts          # { messages: ChatMessage[] }
    chat-message-response.dto.ts         # { assistantMessage, toolCalls?, model }
    chat-message.dto.ts                  # { role, content, ... }
    chat-history-query.dto.ts            # { cursor?, limit? }
    chat-history-response.dto.ts         # { items, nextCursor }
  README.md                              # documenta v1 / v2 / decisões
```

### 5.2 `AiProvider` interface (preparação multi-provider)

```ts
export interface AiProviderMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AiProviderResult {
  finalMessage: string;
  model: string;
  toolCallsExecuted: Array<{ name: string; argsHash: string; resultPreview: string }>;
  tokensUsed?: { input?: number; output?: number };
}

export interface AiProvider {
  readonly name: string;
  chat(opts: {
    systemPrompt: string;
    messages: AiProviderMessage[];
    tools: AiToolDefinition[];
    maxToolIterations?: number; // default: 5
  }): Promise<AiProviderResult>;
}
```

v1: única implementação = `GeminiProvider`. v2: `ClaudeProvider`,
`OpenAiProvider`, com seletor no `AiChatService` por flag/config.

### 5.3 Componentes principais

#### 5.3.1 `ChatMessagesService` (espelho do `CommentsService`)

Responsabilidade única: CRUD de mensagens em `DEvento` -508.

```ts
@Injectable()
export class ChatMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationId: CorrelationIdService,
  ) {}

  /** Insere uma DEvento -508. Retorna o registro persistido. */
  async appendMessage(opts: {
    conversationId: string;       // v1: entidadeId; v2: uuid
    userEntidadeId: bigint;       // sempre o user que iniciou a conversa
    role: 'user' | 'assistant';
    content: string;
    metadata?: Record<string, unknown>; // model, tokens, toolCalls, etc.
  }): Promise<DEvento>;

  /** Lista últimas N mensagens (cursor DESC, retorna em ordem cronológica). */
  async listMessages(opts: {
    conversationId: string;
    limit?: number;     // default: 50
    cursor?: string;
  }): Promise<{ items: ChatMessageDto[]; nextCursor: string | null }>;
}
```

Padrão idêntico ao `CommentsService.create / findMany` —
**zero N+1** (não precisa join de autor, pois `metadata.role` discrimina).

#### 5.3.2 `AiToolsService` (4 tools)

```ts
@Injectable()
export class AiToolsService {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /** Devolve o array de tools no contrato AiToolDefinition. */
  buildTools(ctx: { userEntidadeId: bigint; organizationId?: string }): AiToolDefinition[] {
    return [
      this.createCommentTool(ctx),
      this.listCommentsTool(ctx),
      this.createTaskTool(ctx),
      this.getProjectSummaryTool(ctx),
    ];
  }

  private createCommentTool(ctx): AiToolDefinition { /* ... */ }
  // ...
}
```

**Pilar 2 — endpoints reutilizados:** as 4 tools são CHAMADAS DE SERVICE
(in-process), não HTTP. O Pilar 2 vale para evitar duplicar **controllers**;
chamar `CommentsService.create(...)` diretamente do `AiToolsService` é o
padrão correto, mais rápido e idiomático em NestJS.

**Schemas das tools (function declarations Gemini):**

```ts
// createComment
{
  name: 'createComment',
  description: 'Cria um comentário num alvo (task/project/folder/list).',
  parameters: {
    type: 'object',
    properties: {
      targetType: { type: 'string', enum: ['task','project','folder','list'] },
      targetId:   { type: 'string', description: 'ID do alvo' },
      texto:      { type: 'string', description: 'Conteúdo do comentário' },
    },
    required: ['targetType','targetId','texto'],
  },
}

// listComments
{
  name: 'listComments',
  description: 'Lista comentários de um alvo (mais recentes primeiro).',
  parameters: {
    type: 'object',
    properties: {
      targetType: { type: 'string', enum: ['task','project','folder','list'] },
      targetId:   { type: 'string' },
      limit:      { type: 'number', minimum: 1, maximum: 50 },
    },
    required: ['targetType','targetId'],
  },
}

// createTask
{
  name: 'createTask',
  description: 'Cria uma task no projeto. Estado inicial: INBOX.',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      nome:      { type: 'string', minLength: 1 },
      descricao: { type: 'string' },
      idPai:     { type: 'string', description: 'Task pai (opcional, para fases)' },
    },
    required: ['projectId','nome'],
  },
}

// getProjectSummary
{
  name: 'getProjectSummary',
  description: 'Retorna resumo do projeto: dados básicos + contadores de status + top 5 tasks ativas.',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
    },
    required: ['projectId'],
  },
}
```

**Tenant isolation crítico:** TODA tool chama o service correspondente
passando `userEntidadeId` + `organizationId` do JWT. Se o user pedir
`getProjectSummary("999")` e 999 estiver em outra org, o service lança
`NotFoundException` — mensagem padrão "Project not found" (anti-enumeration).
A IA recebe o erro, informa o user. **NUNCA passar IDs raw da IA direto pro
Prisma — sempre pelos services que já têm o gate.**

#### 5.3.3 `GeminiProvider`

```ts
@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';

  constructor(private readonly keyService: GeminiApiKeyService) {}

  async chat(opts) {
    const apiKey = await this.keyService.getActiveKey(); // DTabela -481 ou env
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',  // v1: flash (rápido + barato)
      systemInstruction: opts.systemPrompt,
      tools: [{ functionDeclarations: opts.tools.map(toGeminiDecl) }],
    });

    const chat = model.startChat({
      history: toGeminiHistory(opts.messages),
    });

    let iterations = 0;
    const max = opts.maxToolIterations ?? 5;
    let result = await chat.sendMessage(/* last user message */);
    const executed = [];

    while (iterations < max) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) break;

      const responses = await Promise.all(calls.map(async (c) => {
        const tool = opts.tools.find(t => t.name === c.name);
        if (!tool) return { name: c.name, response: { error: 'unknown tool' } };
        try {
          const out = await tool.execute(c.args);
          executed.push({ name: c.name, argsHash: hash(c.args), resultPreview: preview(out) });
          return { name: c.name, response: out };
        } catch (err) {
          return { name: c.name, response: { error: err.message } };
        }
      }));

      result = await chat.sendMessage(responses.map(r => ({
        functionResponse: { name: r.name, response: r.response },
      })));
      iterations++;
    }

    return {
      finalMessage: result.response.text(),
      model: 'gemini-1.5-flash',
      toolCallsExecuted: executed,
      tokensUsed: extractTokens(result),
    };
  }
}
```

**Limites duros (defesa):**
- `maxToolIterations = 5` (loop infinito mata após 5 idas/voltas).
- timeout por chamada Gemini: 30s (configurar no SDK).
- Se Gemini retornar 429/5xx: 1 retry com backoff 1s, então falha clean.

#### 5.3.4 System prompt

```
Você é o Nexus, assistente do Scrumban. Ajuda usuários a gerenciar tasks,
projects, folders, listas e comentários. Use as tools disponíveis quando
fizer sentido:

- createComment: registrar um comentário num alvo (task/project/folder/list).
- listComments: ler comentários existentes de um alvo.
- createTask: criar uma nova task num projeto (estado inicial INBOX).
- getProjectSummary: obter resumo + contadores + top 5 tasks ativas de um projeto.

Regras:
- Responda sempre em português brasileiro.
- Seja conciso e prático. Sem floreio.
- Se faltar contexto (qual projeto? qual task?), pergunte antes de chamar
  tools.
- NÃO invente IDs. Se o usuário não passar um ID, peça ou use
  getProjectSummary primeiro pra descobrir.
- Se uma tool retornar erro de permissão (403/404), informe o usuário em
  linguagem natural — não exiba stack trace.
```

#### 5.3.5 `AiChatService` — orquestrador

```ts
@Injectable()
export class AiChatService {
  constructor(
    private readonly chatMessages: ChatMessagesService,
    private readonly aiTools: AiToolsService,
    private readonly gemini: GeminiProvider,
    private readonly eventProducer: EventProducerService,
    private readonly correlationId: CorrelationIdService,
  ) {}

  async handleMessage(dto: ChatMessageRequestDto, userEntidadeId: bigint, orgId?: string) {
    const conversationId = userEntidadeId.toString(); // v1: conversa única
    const lastUser = dto.messages[dto.messages.length - 1];

    // 1. Persistir user message ANTES da chamada (idempotência se Gemini falhar)
    await this.chatMessages.appendMessage({
      conversationId,
      userEntidadeId,
      role: 'user',
      content: lastUser.content,
    });

    // 2. Carregar histórico (últimas 30 mensagens — janela conservadora)
    const history = await this.chatMessages.listMessages({
      conversationId,
      limit: 30,
    });

    // 3. Chamar Gemini
    const tools = this.aiTools.buildTools({ userEntidadeId, organizationId: orgId });
    const result = await this.gemini.chat({
      systemPrompt: SYSTEM_PROMPT_NEXUS,
      messages: history.items.map(toProviderMsg),
      tools,
    });

    // 4. Persistir assistant message APÓS sucesso
    const assistantEvento = await this.chatMessages.appendMessage({
      conversationId,
      userEntidadeId,
      role: 'assistant',
      content: result.finalMessage,
      metadata: {
        model: result.model,
        tokens: result.tokensUsed,
        toolCalls: result.toolCallsExecuted,
      },
    });

    // 5. Eventos (audit)
    await this.eventProducer.addInternalEvent(
      EVENT_TYPES.AI_CHAT_MESSAGE_CREATED,
      { messageId: assistantEvento.chave.toString(), conversationId, role: 'assistant', model: result.model },
      this.correlationId.getOrGenerate(),
    );
    for (const call of result.toolCallsExecuted) {
      await this.eventProducer.addInternalEvent(
        EVENT_TYPES.AI_CHAT_TOOL_CALLED,
        { conversationId, tool: call.name, argsHash: call.argsHash },
        this.correlationId.getOrGenerate(),
      );
    }

    return {
      assistantMessage: result.finalMessage,
      model: result.model,
      toolCallsCount: result.toolCallsExecuted.length,
    };
  }
}
```

#### 5.3.6 `AiChatController`

```ts
@ApiTags('ai-chat')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller('ai/chat')
export class AiChatController {
  constructor(private readonly aiChat: AiChatService, private readonly chatMessages: ChatMessagesService) {}

  /** POST /ai/chat — envia mensagem, recebe resposta da IA. */
  @Post()
  async sendMessage(@Body() dto: ChatMessageRequestDto, @Request() req): Promise<ChatMessageResponseDto> {
    return this.aiChat.handleMessage(dto, BigInt(req.user.entidadeId), req.user.organizationId);
  }

  /** GET /ai/chat/history — histórico da conversa única do user. */
  @Get('history')
  async history(@Query() query: ChatHistoryQueryDto, @Request() req): Promise<ChatHistoryResponseDto> {
    return this.chatMessages.listMessages({
      conversationId: req.user.entidadeId,
      limit: query.limit ?? 50,
      cursor: query.cursor,
    });
  }
}
```

---

## 6. Backend — Integração Gemini + Tool Calling

### 6.1 Pacote npm

```bash
npm install @google/generative-ai
```

Versão alvo: latest minor estável. Adicionar a `dependencies` (não dev).

### 6.2 Fluxo completo (já descrito no 5.3.3)

User → AiChatController → AiChatService → ChatMessagesService.append(user)
→ ChatMessagesService.list(history) → AiToolsService.build(tools) →
GeminiProvider.chat() loop até final → ChatMessagesService.append(assistant)
→ eventProducer (audit) → response JSON ao cliente.

### 6.3 Tratamento de erros

| Erro | Comportamento |
|------|---------------|
| Gemini 429 (rate limit) | 1 retry com backoff 1s; se persistir, 503 + "Limite de uso da IA atingido. Tente em alguns segundos." |
| Gemini 401 (key inválida) | Log error com prefix da key; 500 + "Configuração da IA com problema. Contate o suporte." |
| Gemini timeout | 504 + "A IA demorou demais para responder. Tente novamente." |
| Tool execute → 403 | Retorna `{ error: 'forbidden' }` para a IA; ela explica ao user |
| Tool execute → 404 | Idem; IA explica que o recurso não existe ou está fora do escopo |
| Loop infinito (>5 iters) | Para; retorna última mensagem text() do modelo |

---

## 7. Frontend — Integração Nexus (Fase B.3)

### 7.1 Arquivos a tocar

```
src/lib/api/ai-chat.ts                # client REST: sendMessage, fetchHistory
src/hooks/use-nexus-chat.ts           # hook custom (useState + useCallback)
src/app/(workspace)/ia/page.tsx       # já existe; trocar o stub pelo chat real
src/components/ia/chat-window.tsx     # UI principal — lista de mensagens
src/components/ia/chat-input.tsx      # textarea + send button
src/components/ia/message-bubble.tsx  # bolha user/assistant
```

### 7.2 Hook `useNexusChat`

```ts
type ChatMessage = { role: 'user'|'assistant'; content: string; createdAt?: string };

export function useNexusChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Hidrata histórico ao montar
  useEffect(() => {
    fetchHistory().then(setMessages).catch(...);
  }, []);

  // 2. Envia nova mensagem
  const sendMessage = async (content: string) => {
    setIsLoading(true);
    setError(null);
    setMessages(m => [...m, { role: 'user', content }]); // optimistic

    try {
      const res = await sendChatMessage({ messages: [...messages, { role: 'user', content }] });
      setMessages(m => [...m, { role: 'assistant', content: res.assistantMessage }]);
    } catch (e) {
      setError(e.message);
      setMessages(m => m.slice(0, -1)); // rollback optimistic
    } finally {
      setIsLoading(false);
    }
  };

  return { messages, isLoading, error, sendMessage };
}
```

### 7.3 Cliente REST (`src/lib/api/ai-chat.ts`)

Espelha o padrão dos outros clients (`comments.ts`, `tasks.ts`): usa o
`apiFetch` central com Bearer token. Endpoints:

```ts
export async function sendChatMessage(body: ChatMessageRequest): Promise<ChatMessageResponse>
export async function fetchHistory(limit = 50): Promise<ChatMessage[]>
```

### 7.4 UI shadcn

- Aproveitar componentes existentes do design system.
- Layout simples: header "Nexus", lista de mensagens com scroll, input fixo
  no rodapé, loading dots durante chamada.
- Render markdown nas respostas da IA (já temos `react-markdown` no projeto?
  Se sim, reusar; se não, instalar — adicionar no escopo B.3).

### 7.5 Auth

Hook usa o store Zustand do auth (`useAuthStore`) para enviar `Authorization: Bearer <token>`.
Padrão Bearer já estabelecido (vide `auth_pattern_v2.md` na memória do
projeto).

---

## 8. Plano de Implementação por Fases

| Fase | Descrição | Otimista | Realista | Pessimista | Notas |
|------|-----------|----------|----------|------------|-------|
| **B.0** | Migration `(idClasse, identificadorExterno)` em DEvento (DEBT-COMMENTS-01) | 30min | 45min | 1.5h | BLOQUEANTE pra B.2; rodar antes |
| **B.1** | Strategist plano (este arquivo) | — | — | — | em execução |
| **B.2** | Backend: seed + module + 4 tools + Gemini + tests | 5h | 7h | 10h | núcleo do trabalho |
| **B.3** | Frontend: hook + cliente + UI | 1.5h | 2.5h | 4h | UI shadcn + markdown |
| **B.4** | Smoke test + Documenter + Deploy | 30min | 1h | 2h | end-to-end real |
| **Total** | | **7h** | **10.5h** | **17.5h** | base 8-10h + buffer 20% |

**Estimativa entregável: ~12h realista (com buffer).** Bate com o "8-10h
base" do usuário + buffer 20%.

### 8.1 Ordem obrigatória (Pilar 3 primeiro)

1. **B.0** — migration DEvento (índice composto). Sem isso, B.2 não roda
   em performance aceitável.
2. **B.2 — Fase Seed (Pilar 3):** adicionar `-481` e `-508` em
   `classes.seed.ts`, atualizar COUNTS, adicionar event types em
   `event-types.ts` + audit-log-consumer. `npm test` deve passar (testes
   anti-regressão de COUNTS).
3. **B.2 — Fase Provider:** `AiProvider` interface + `GeminiProvider` +
   `GeminiApiKeyService`. Instalar `@google/generative-ai`.
4. **B.2 — Fase ChatMessages:** `ChatMessagesService` (espelhar
   `CommentsService`).
5. **B.2 — Fase Tools:** `AiToolsService` com as 4 tools. Tests unitários:
   cada tool monta args válidos, chama service mockado, valida shape do
   retorno.
6. **B.2 — Fase Orchestrator:** `AiChatService` + `AiChatController`.
   Tests de integração: envio de mensagem simples (sem tool), com 1 tool,
   com loop de 3 tools, com erro de tool.
7. **B.2 — Fase Module:** `AiModule` + registrar em `AppModule`.
   Build + smoke local com `.env` GOOGLE_API_KEY.
8. **B.3 — Frontend** (paralelizável com B.2 final).
9. **B.4 — Smoke + Documenter + Deploy.**

### 8.2 O que NÃO está incluído (será reagendado se sobrar tempo)

- Admin UI para gerenciar Gemini Key (DTabela -481). v1 = seed manual via
  `psql` ou `prisma studio` quando deploy em prod.
- Métricas/dashboard de uso da IA (tokens/mês, tools mais chamadas).
- Rate limiting por user (assumir Gemini Free Tier ou plano pago global).

---

## 9. Critérios de Sucesso

### 9.1 Endpoint `POST /ai/chat`

- [ ] Autenticado via `AuthCompositeGuard` (JWT obrigatório; ApiKey/MCP
      bloqueados pois conversa é por user, não por integração — validar).
- [ ] Body aceita `{ messages: [{role,content}, ...] }`.
- [ ] Persiste DEvento -508 com `role=user` ANTES de chamar Gemini.
- [ ] Persiste DEvento -508 com `role=assistant` APÓS Gemini responder
      com sucesso.
- [ ] Tool calls executam via services internos (CommentsService,
      TasksService, ProjectsService) — tenant isolation natural.
- [ ] Retorna 200 com `{ assistantMessage, model, toolCallsCount }`.
- [ ] Erro Gemini → 502/503/504 com mensagem amigável.
- [ ] Build passa, lint passa.

### 9.2 Endpoint `GET /ai/chat/history`

- [ ] Lista as últimas 50 mensagens do user logado, ORDEM CRONOLÓGICA
      (DESC interno + reverse no DTO de saída, ou ORDER BY chave ASC com
      LIMIT — escolha do Implementer, documentar).
- [ ] Inclui `metadata.toolCalls` no DTO para o frontend exibir badge "IA
      usou tool X" (opcional v1).
- [ ] Cursor pagination funciona para histórico longo.
- [ ] Zero N+1.

### 9.3 Tools

- [ ] `createComment` cria DEvento -507 corretamente; falha 403/404 se
      user não tem acesso ao alvo.
- [ ] `listComments` retorna lista; sempre escopado.
- [ ] `createTask` cria DTask em INBOX; falha se `projectId` fora do
      `accessibleProjectIds` do user.
- [ ] `getProjectSummary` retorna `{ id, nome, ..., stats, topPendingTasks }`
      em UMA chamada server-side (2 queries internas: findOne + getStats
      + 1 opcional findMany top tasks).

### 9.4 Frontend

- [ ] Página `/ia` mostra histórico ao carregar.
- [ ] Input + Send funciona; durante chamada, mostra loading.
- [ ] Bolhas user (direita) e assistant (esquerda) com markdown render.
- [ ] Erro de rede / 503 → toast.
- [ ] Mobile-friendly (textarea cresce sem quebrar layout).

### 9.5 Persistência

- [ ] Recarregar a página = histórico hidrata corretamente.
- [ ] Logout + login = mesmo histórico aparece (porque
      `identificadorExterno=entidadeId`).
- [ ] User A vê seu histórico; User B vê o seu; nunca cruzam.

---

## 10. Riscos e Mitigações

| ID | Risco | Prob | Impacto | Mitigação |
|----|-------|------|---------|-----------|
| R-1 | Gemini retorna respostas com prompt injection que tenta chamar tools com IDs forjados | M | A | Tenant isolation no service (não na tool): qualquer `projectId`/`taskId` passa pelos services existentes que validam membership. IA não consegue "escapar" o escopo do user. |
| R-2 | Plaintext da Gemini key em DTabela.dados.plaintext (sem KMS) | M | M | Aceito conscientemente na v1. v2: Vault/AWS KMS via env `GEMINI_KEY_SOURCE=vault`. Documentar no README. CEO informado nesta seção. |
| R-3 | Custo Gemini foge do controle (user mal-intencionado spamming) | M | M | Limite duro `maxToolIterations=5`. Logger registra cada chamada; alarmar se >100 msgs/user/dia (futuro). v1: assumir cap natural da UI (1 msg por vez). |
| R-4 | Migration DEvento bloqueia INSERTs em prod por minutos | M | A | Em prod, editar SQL gerado para `CREATE INDEX CONCURRENTLY` antes do deploy. Documentar no commit. |
| R-5 | Tool calling loop infinito (Gemini insiste em chamar tool com erro) | B | M | `maxToolIterations=5` mata o loop e retorna última text(). |
| R-6 | Histórico grande estoura context window do Gemini Flash (1M tokens — improvável) | B | B | Janela limitada a 30 últimas msgs no AiChatService. Suficiente pra v1. Sumarização: expansão futura. |
| R-7 | Frontend `useNexusChat` perde mensagens em refresh durante envio | B | B | Mensagem do user já foi persistida no backend ANTES de chamar Gemini; refresh hidrata o estado correto via `GET /ai/chat/history`. |
| R-8 | Conflito de versão `@google/generative-ai` com Node 20 | B | B | SDK oficial Google suporta Node 18+. Verificar no `package.json`. |
| R-9 | `descricao` da DEvento é `Text` — mensagens enormes do user (>1MB) podem estourar | B | M | DTO `ChatMessageDto.content` com `@MaxLength(50000)`. Mensagens maiores rejeitadas em 400. |
| R-10 | DEBT-COMMENTS-01 já estava pendente — esquecemos de aplicar antes | M | A | B.0 é Fase BLOQUEANTE; sem migration, B.2 não merge. Reviewer verifica que B.0 está em main antes de aprovar B.2. |

**Alerta especial pré-implementação (R-2 + R-3):** o usuário deve ser
informado que (a) o plaintext da Gemini key vai em DTabela sem
encriptação na v1, e (b) não há rate limit por user na v1. Ambos são
trade-offs aceitos para entregar "pergunta-resposta funcionar" rápido.

---

## 11. Categoria de Expansão Futura (rastreamento — NÃO implementar agora)

> Lista canônica de evoluções planejadas. Cada item é candidato a uma
> sprint própria. Ao implementar qualquer um, abrir ADR-V2-AI-XXX se
> mexer em schema/contrato.

1. **Múltiplas conversas por user (v2 chat sidebar)**
   - Trocar `identificadorExterno = entidadeId` por
     `identificadorExterno = uuidConversa`.
   - Nova DTabela (ou reusar DProject idClasse nova) para listar conversas
     do user com título.
   - UI sidebar estilo ChatGPT/Claude (Nova conversa, listar, renomear, deletar).

2. **Título automático da conversa**
   - Após a 1ª resposta, segunda chamada à IA pedindo título curto.
   - Persistir em `metaDados.title` da primeira DEvento da conversa, ou
     em registro pai dedicado.

3. **Streaming (SSE)**
   - Trocar `POST /ai/chat` para retornar `text/event-stream`.
   - Migrar frontend para `useChat` do AI SDK (Vercel).
   - Persistir mensagem assistant ao final do stream.

4. **Múltiplos providers (Claude, OpenAI)**
   - Implementar `ClaudeProvider`, `OpenAiProvider`.
   - Seletor de modelo na UI (dropdown).
   - Config por user (preferência salva em DTabela).

5. **Tools adicionais**
   - `updateTaskStatus(taskId, status)` — mover task no kanban.
   - `assignTask(taskId, userId)` — atribuir task.
   - `searchTasks(q, filters)` — full-text search.
   - `getDashboardMetrics()` — flow metrics / forecast.
   - `listProjects()` — quando user não sabe o `projectId`.
   - `createDoc()` — quando docs entrarem (sprint de docs deferida).

6. **Sumarização de histórico longo**
   - Quando histórico > 30 msgs, sumarizar as antigas via IA secundária
     e substituir por system message resumida.
   - Reduz custo de tokens.

7. **RAG sobre conteúdo do projeto**
   - Embeddings das tasks/docs/comments num vector store.
   - Tool `searchRelevant(q)` que retorna chunks relevantes.
   - DTabela polimórfica para guardar embeddings? Ou serviço externo (Pinecone, etc.)?

8. **Voice input (reaproveitar Groq Whisper do Telegram)**
   - Botão mic na UI → captura áudio → backend transcreve via Groq →
     manda como mensagem normal.

9. **Persistência de uso/tokens (billing futuro)**
   - Já guardamos `metadata.tokens` por mensagem; agregar mensalmente
     numa view materializada para dashboard de custos.

10. **Análise de produtividade via IA**
    - "Como foi minha semana?" → IA chama tools de stats + flow metrics
      e devolve análise narrativa.

11. **Admin UI para gerenciar Gemini Key**
    - `/admin/ai-providers` — listar, criar, rotacionar, desativar.
    - Multi-tenant: org admin gerencia sua própria key.

12. **Encriptação da plaintext key (R-2)**
    - Integrar com Vault/AWS KMS/Doppler.
    - Env `GEMINI_KEY_SOURCE=vault` → SDK do Vault busca em runtime.

13. **Rate limit por user (R-3)**
    - Throttler do Nest aplicado ao `POST /ai/chat`: 10/min por user.
    - Quota mensal por org (config em DTabela).

14. **Migration `CREATE INDEX CONCURRENTLY` (R-4)**
    - Script customizado de deploy: rodar manualmente em janela de baixo
      tráfego.

---

## 12. Handoff para o Implementer

### 12.1 Pré-requisitos OBRIGATÓRIOS antes de começar

1. **B.0 PRIMEIRO.** Sem o índice composto, qualquer benchmark
   posterior fica enviesado e o ROADMAP fica desalinhado. Rodar:
   ```bash
   cd Scrumban-Backend-V2
   npx prisma migrate dev --name add_devento_classe_identificador_externo_idx
   npm test
   git add prisma/ && git commit -m "perf(eventos): índice composto (idClasse, identificadorExterno) — DEBT-COMMENTS-01"
   ```

2. **Ler arquivos críticos** (em ordem):
   - `src/comments/comments.service.ts` — padrão DEvento polimórfico (espelhar)
   - `src/comments/comment-target.resolver.ts` — padrão de autorização
   - `src/auth/services/api-key.service.ts` — padrão DTabela -471 (espelhar pra -481)
   - `src/projects/projects.controller.ts:179-187, 270-276` — findOne + stats
   - `src/tasks/tasks.controller.ts:104-121` — POST /tasks
   - `prisma/seeds/classes.seed.ts` — helper `esp()` e convenção de COUNTS
   - `src/eventos/core/event-types.ts` — formato do EVENT_TYPES
   - `src/eventos/consumers/audit-log.consumer.ts` — TYPE_TO_CLASSE

### 12.2 Ordem de implementação dentro de B.2

Seguir RIGOROSAMENTE a ordem da seção 8.1. Não pular o seed (Pilar 3) —
sem `-481` e `-508` no banco, `validateHierarchy` quebra em qualquer teste
que importe `classes.seed.ts`, e o `event-types.ts` rejeita
`ai.chat.message.created` no `addInternalEvent`.

### 12.3 Pontos de atenção críticos

1. **DEvento é Prisma direto** — Pilar 1 (Engine) NÃO se aplica (idêntico
   ao CommentsService). NUNCA invocar `OperacaoPedido` aqui.
2. **Tools chamam SERVICES, não controllers HTTP** — performance + tenant
   isolation natural.
3. **Validar `organizationId` em TODAS as tools** — passar do JWT pra
   cada service. Se a IA tentar `projectId` de outra org, `NotFoundException`.
4. **Persistir mensagem user ANTES da chamada Gemini** — se Gemini falhar,
   o user vê sua mensagem no refresh; refaz a tentativa.
5. **`maxToolIterations=5` é hard limit** — proteção contra loop infinito.
6. **API key da Gemini:**
   - Em dev local: `.env` com `GOOGLE_API_KEY=...` (fallback do
     `GeminiApiKeyService`).
   - Em prod: usar Prisma Studio (ou seed admin futuro) pra criar a
     DTabela -481 manualmente UMA vez.
   - Documentar o passo no `src/ai/README.md`.
7. **COUNTS no seed:** 105 → 107 (duas DClasses novas). Teste
   anti-regressão valida.
8. **package.json:** novo dep `@google/generative-ai` precisa ser commitado
   junto com `package-lock.json`.

### 12.4 Comandos copiáveis

```bash
# Backend (Scrumban-Backend-V2)
cd /Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2

# B.0 — migration
npx prisma migrate dev --name add_devento_classe_identificador_externo_idx
npm test

# B.2 — install
npm install @google/generative-ai
# seed
npm run seed
# build
npm run build && npm run lint && npm run typecheck
# tests
npm test -- src/ai
npm test -- prisma/seeds

# Frontend (Scrumbam-Frontend-V2)
cd /Users/devaritecnologia/Documents/Benedito/Scrumbam-Frontend-V2
# (ver lib/api padrão e instalar react-markdown se necessário)
npm run build
```

### 12.5 Smoke test end-to-end (B.4)

1. Backend + frontend rodando localmente.
2. Login como user A.
3. Abrir `/ia`. Verificar histórico vazio (primeira vez).
4. "Quais projetos eu tenho?" → IA chama `getProjectSummary` ou pede
   `projectId` (sem `listProjects` na v1, é esperado que pergunte).
5. "Crie uma task chamada 'Teste Nexus' no projeto 1" → IA chama
   `createTask` → confirma na UI.
6. "Liste os comentários da task 5" → IA chama `listComments`.
7. "Adicione um comentário 'feito pelo Nexus' na task 5" → IA chama
   `createComment`.
8. Refresh da página → histórico hidrata com todas as mensagens acima.
9. Logout, login como user B → histórico vazio (isolation OK).
10. user B tenta perguntar sobre task do user A (mesmo ID) → IA recebe
    erro 404 da tool e explica em português.

---

## 13. Confirmações Finais

- [x] **NÃO foi quebrada nenhuma das 7 decisões do usuário.** Todas
      respeitadas literalmente (1=Gemini único; 2=DTabela com fallback
      env; 3=4 tools; 4=DEvento -508 com identificadorExterno=entidadeId;
      5=completa, não streaming; 6=system prompt simples; 7=schema
      pronto pra múltiplas conversas).
- [x] **ZERO tabela nova** (ADR-V2-001 respeitado).
- [x] **3 Pilares avaliados** (1: N/A; 2: services reaproveitados; 3: seed Fase 1).
- [x] **DEBT-COMMENTS-01** virou fase B.0 bloqueante.
- [x] **Categoria de Expansão Futura** com 14 itens rastreáveis.

### 13.1 Alertas críticos que valem comunicar ao usuário antes de iniciar B.2

1. **R-2: plaintext da Gemini key em DTabela na v1.** Decisão CEO esperada
   antes de B.2 (mantém ou eleva a barra?). Default Strategist: manter
   plaintext, documentar, evoluir em sprint futura (item 12 da expansão).
2. **R-4: migration DEvento bloqueia INSERTs.** Janela de deploy
   recomendada: madrugada/fim de semana. Editar SQL gerado para
   `CONCURRENTLY` se a tabela já estiver grande em prod (provavelmente
   ainda pequena no momento, mas vale o cuidado).
3. **R-3: sem rate limit por user na v1.** Custo pode escalar se o user
   abusar. Monitorar via logs nos primeiros dias.

---

_Plano gerado pelo Strategist Agent em 2026-05-27. Espelha o estilo de
`docs/plans/2026-05-27-ia-tools-backend.md`. Implementer: NÃO revisitar
as 7 decisões da seção 1. Em caso de dúvida arquitetural, ler a seção
correspondente; em caso de bloqueio real, pausar e consultar CEO via
mensagem direta no chat principal._
