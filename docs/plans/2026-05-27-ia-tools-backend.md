# PLANO — IA Tools Backend: Comentários em Task + Docs CRUD

**Criado por:** Strategist Agent
**Data:** 2026-05-27
**Projeto:** Scrumban-Backend-V2 (NestJS + Prisma, Devari Core)
**Estimativa Total:** 12–16h (com buffer 20%)
**Prioridade:** MUST (bloqueante para feature Nexus/IA do frontend)

---

## 0. Contexto

O frontend Scrumbam-Frontend-V2 implementa o chat assistente "Nexus" com tool
calling (Vercel AI SDK + Gemini/Claude). A IA precisa de dois endpoints hoje
ausentes no backend:

1. `POST /tasks/:id/comments` + `GET /tasks/:id/comments` — comentários textuais
   em tasks (hoje `DEvento` só registra mudanças automáticas de estado).
2. `POST /docs`, `PATCH /docs/:id`, `GET /docs/:id` — criar/editar/ler documentos
   (`DProject idClasse=-353` já existe como leaf, mas os endpoints write estão
   ausentes e o campo de conteúdo rico não foi especificado).

Ambos os gaps foram identificados após análise profunda. 90% das tools de leitura
e escrita já existem; estes são os 2 itens restantes.

---

## 0.1 Atualização 2026-05-27 (pós Fase 1) — Escopo polimórfico e docs deferidos

Após a entrega e aprovação da Fase 1 (seed + event types) com score **8.5/10**, o
escopo foi reavaliado pelo CEO e ajustado:

- **Fase 1 JÁ FOI ENTREGUE E APROVADA (8.5/10).** Não refazer. Seed com `-507
  TASK_COMMENT` e event types (`task.comment.created`, `task.comment.deleted`,
  `doc.created`, `doc.updated`, `doc.deleted`) estão em produção. Os event types
  de doc ficam dormentes até a sprint futura — sem custo manter.

- **Comentários agora são POLIMÓRFICOS.** Em vez de um `TaskCommentsModule`
  específico de task, será implementado um `CommentsModule` genérico que
  funciona em qualquer entidade pertinente: `task`, `project`, `folder`, `list`
  (e fica naturalmente pronto para `doc` quando docs forem implementados).

- **Docs ficam DEFERIDOS para a próxima sprint.** Todas as seções referentes a
  docs (seções 2, 3, 5.2, 7.2, T1.3, T1.4, Fase 3, T4.2 e critérios de docs em
  seção 11) ficam marcadas como `DEFERIDO` mas **não removidas** — a próxima
  sprint reaproveita o trabalho de análise.

- **Gate Reviewer especial: ≥ 8.0** (não 7.0) em todas as fases desta sprint.
  Padrão de qualidade da entrega de comentários polimórficos exige maior
  rigor por ser fundação reutilizada.

- **DClasse `-507` mantém o nome `TASK_COMMENT`** semanticamente serve como
  "comentário em qualquer alvo". O nome é histórico — débito de naming aceito
  conscientemente para evitar retrabalho no seed já aprovado. Documentar no
  commit e no README do módulo `comments/`.

- **`targetType` suportados na v1:** `task`, `project`, `folder`, `list`. `doc`
  fica pronto pra entrar sem refactor quando docs vierem (basta adicionar o
  enum + uma entrada na tabela do resolver).

- **Nova rota:** `POST /comments/:targetType/:targetId` e
  `GET /comments/:targetType/:targetId` (substitui `/tasks/:id/comments`).

- **Padrão arquitetural novo:** `CommentTargetResolver` — pequena abstração que,
  dado `targetType`, sabe (a) confirmar existência do alvo e (b) validar acesso
  do requester. Cada tipo tem sua regra (ver seção 6.1.1).

---

## 1. Gap 1 — Comentários em Task

### 1.1 Análise do estado atual

- `DEvento` (`src/eventos/`) já persiste audit trail polimórfico com
  `idClasse + idEntidade + descricao + metaDados`.
- Existem DEventos semânticos: `-497 TASK_CREATED`, `-498 TASK_STATUS_CHANGED`.
- O `EventProducerService` exige que o tipo esteja em `ALL_EVENT_TYPES_SET`
  (validação em `addInternalEvent`). Tipos novos precisam de entrada em
  `event-types.ts` + `audit-log.consumer.ts`.
- Não existe endpoint `GET /tasks/:id/comments` nem `POST /tasks/:id/comments`.
- `DTask` tem `idCreator → DEntidade` e `idAssignee → DEntidade` — relação com
  autores já existe na tabela.

### 1.2 Decisão Arquitetural — Comentários

**Alternativa A: `DEvento` polimórfico com nova DClasse `-507 TASK_COMMENT`**

- Pros:
  - Zero mudança de schema Prisma (tabela canônica, ADR-V2-001).
  - Reutiliza infraestrutura de audit (`EventProducerService`, `audit-log.consumer`).
  - Herda `idEntidade → DEntidade (autor)`, `criadoEm` e `descricao` nativamente.
  - Listagem por `GET /tasks/:id/comments` = `prisma.dEvento.findMany({ where: { idClasse: -507, identificadorExterno: taskId } })`.
  - Consistente com padrão existente: `DEvento -498` já usa `identificadorExterno`
    como referência ao objeto-alvo.
  - Cursor pagination trivial pela chave BigInt.

- Contras:
  - `DEvento` não tem `atualizadoEm` — edição de comentário não é possível
    sem campo extra em `metaDados` (aceitável na v1).
  - Soft-delete de comentário individual requer `DEvento.excluido = true`
    (já existe o campo no schema).
  - `descricao` é `Text` — suporta markdown longo sem problema.

**Alternativa B: Nova tabela `DTaskComment`**

- Pros:
  - Schema limpo, índices dedicados, `atualizadoEm` nativo.
  - Mais fácil de evoluir (edição, reações, threads).

- Contras:
  - **Viola ADR-V2-001** (hook `enforce-canonical-tables.sh` bloquearia o
    merge). Seria necessário abrir um ADR de exceção — overhead desnecessário
    na v1.
  - Duplica o padrão de audit trail que já existe.

**Alternativa C: JSON nested em `DTask.dados.comments[]`**

- Pros: Zero infra nova.
- Contras: Cresce indefinidamente no registro pai, sem paginação eficiente,
  sem índice de busca, viola princípio de normalização mínima. Inaceitável para
  uso em produção.

**DECISÃO: Alternativa A — `DEvento` com nova DClasse `-507 TASK_COMMENT`.**

Justificativa: zero alteração de schema, consistente com ADR-V2-001 e com o
padrão já estabelecido de audit trail polimórfico. Edição de comentário é
não-objetivo declarado na v1. A IA só precisa criar e ler.

---

## 2. Gap 2 — Documentos (Criar / Editar / Ler conteúdo) — DEFERIDO próxima sprint

> **DEFERIDO** — Toda esta seção, junto com a 3, 5.2, 7.2, T1.3/T1.4, Fase 3 e
> T4.2, fica preservada para a próxima sprint. Decisões arquiteturais (decisão
> de armazenar `dados.content` em DProject `-353`) continuam válidas.

### 2.1 Análise do estado atual

- `DProject idClasse=-353 DOC` já existe no seed (`GAP-04` no `classes.seed.ts`,
  linha 228): `esp(-353, 'DOC', 'Documento rico (conteudo em dados.content)', -51)`.
- O comentário do seed já indica a estratégia: `dados.content` (campo `Json`
  de `DProject`).
- `GET /projects/:id` (findOne) já retorna o projeto; porém o response DTO
  `ProjectResponseDto` não expõe `dados.content`.
- `POST /projects` já cria DProject com qualquer `idClasse` — logo **criar um DOC
  via `POST /projects` com `idClasse: '-353'` já funciona estruturalmente**,
  mas o `dados.content` não é aceito/exposto pelo DTO atual.
- `PATCH /projects/:id` (update) já existe mas `UpdateProjectDto` não tem campo
  `content`.
- Hierarquia: DOC é filho de LIST (`-352`) ou FOLDER (`-351`) via `DProject.idPai`.
  O validador de hierarquia (`validateHierarchyRule`) em `projects.service.ts`
  precisa reconhecer DOC como filho de LIST/FOLDER/SPACE.
- Não há endpoint dedicado `/docs` — toda lógica pode viver em `ProjectsModule`
  como sub-rota ou em endpoints existentes com campos adicionais.

### 2.2 Decisão Arquitetural — Conteúdo do Documento

**Alternativa A: `DProject.dados.content` (string JSON dentro do campo Json)**

- Pros:
  - Zero mudança de schema Prisma (conforme já indicado no comentário do seed).
  - `dados` já é `Json?` em `DProject` — suporta string longa.
  - `GET /projects/:id` com `select: { dados: true }` já retorna o conteúdo.
  - Consistente com padrão de `DProject.dados` como payload polimórfico
    (já contém `prefix`, `slug`, `automationEnabled`, `color`, `icon`, etc.).
  - Endpoint `GET /docs/:id` pode ser um alias de `GET /projects/:id` com
    campo `content` incluído no response.
  - Markdown é string — cabe perfeitamente em `Text` equivalente dentro de Json.

- Contras:
  - Não há limite nativo de tamanho no Json (mitigado por validação no DTO).
  - Busca full-text futura precisaria de índice GIN específico.

**Alternativa B: Campo dedicado `DProject.conteudo Text?`**

- Pros: Índice GIN separado, limite de tamanho nativo.
- Contras:
  - **Viola ADR-V2-001** (nova coluna = migration = hook rejeita sem ADR de
    exceção).
  - Dobra a complexidade para v1 onde busca full-text não é objetivo.

**Alternativa C: Tabela auxiliar `DProjectContent`**

- Pros: Histórico de versões, blobs grandes separados do row principal.
- Contras: Nova tabela = ADR-V2-001. Over-engineering para v1.

**DECISÃO: Alternativa A — `DProject.dados.content` (string markdown dentro
do campo Json existente).**

Justificativa: zero alteração de schema, já referenciado no comentário do seed
(`GAP-04`), consistente com o padrão estabelecido de payload polimórfico em
`dados`. Para v1 (conteúdo gerado por IA, sem colaboração em tempo real), é
a escolha correta.

**Estratégia de endpoints para Docs:**
- Usar rotas dedicadas `/docs/*` (DocsController separado) para clareza de API,
  mesmo que internamente reutilize `ProjectsService` e `ProjectsModule`.
- `POST /docs` → cria DProject com `idClasse=-353` e popula `dados.content`.
- `PATCH /docs/:id` → atualiza `dados.content` e/ou `nome`.
- `GET /docs/:id` → retorna projeto com `dados.content` exposto + breadcrumb
  calculado via `idPai`.
- `GET /docs` (listar) → thin wrapper sobre `GET /projects?idClasse=-353`.

---

## 3. Mudanças de Schema Prisma — DEFERIDO (parte de docs)

> **DEFERIDO** — Texto preservado para próxima sprint.

**Nenhuma.** Ambas as decisões preservam o schema canônico de 17 tabelas
(ADR-V2-001). O hook `enforce-canonical-tables.sh` não será acionado.

Para a sprint atual (comentários polimórficos): **nenhuma mudança de schema**.
Tudo via `DEvento` existente.

---

## 4. Seed — Novas DClasses (Pilar 3)

### 4.1 Gap 1 — Comentários

Nova classe a adicionar em `prisma/seeds/classes.seed.ts`:

```typescript
// === DEvento — comentários de task (GAP-COMMENT) ===
esp(-507, 'TASK_COMMENT', 'Comentario textual em task', -3),
```

- `idPai: -3` (EVENTOS) — consistente com todos os outros DEventos de audit.
- Folha (`agrupamento: false`).
- ID `-507` — próximo disponível após `-506 AGENT_SESSION_RESUMED`.

**COUNTS atualizados:** `especificas: 105`, `total: 150`.

### 4.2 Gap 2 — Documentos — DEFERIDO próxima sprint

A DClasse `-353 DOC` **já existe** no seed (linha 228, `GAP-04`). Nenhuma nova
DClasse é necessária para Docs.

---

## 5. Novos Event Types

### 5.1 Para comentários

Em `src/eventos/core/event-types.ts`, adicionar:

```typescript
// ============== TASK COMMENTS (GAP-COMMENT) ==============
TASK_COMMENT_CREATED: 'task.comment.created',
TASK_COMMENT_DELETED: 'task.comment.deleted',
```

Em `src/eventos/consumers/audit-log.consumer.ts`, adicionar em `TYPE_TO_CLASSE`:

```typescript
'task.comment.created': BigInt(-507), // TASK_COMMENT
'task.comment.deleted': BigInt(-507), // TASK_COMMENT
```

### 5.2 Para documentos — DEFERIDO próxima sprint

> Event types `doc.*` JÁ FORAM adicionados na Fase 1 aprovada (8.5/10) — ficam
> dormentes até a sprint de docs. Sem custo manter.

Em `src/eventos/core/event-types.ts`, adicionar:

```typescript
// ============== DOCS (GAP-DOC) ==============
DOC_CREATED: 'doc.created',
DOC_UPDATED: 'doc.updated',
DOC_DELETED: 'doc.deleted',
```

Em `audit-log.consumer.ts`:

```typescript
'doc.created': BigInt(-499),  // reusa PROJECT_LIFECYCLE (doc é DProject)
'doc.updated': BigInt(-499),
'doc.deleted': BigInt(-499),
```

---

## 6. Estrutura de Módulos NestJS

### 6.1 Gap 1 — CommentsModule polimórfico (novo)

```
src/comments/
  comments.module.ts
  comments.controller.ts
  comments.service.ts
  comment-target.resolver.ts          # peça central — abstração de alvo
  dto/
    comment-target-type.enum.ts       # enum CommentTargetType
    create-comment.dto.ts
    comment-response.dto.ts
    list-comments-response.dto.ts
    list-comments-query.dto.ts
```

**Por que módulo polimórfico e não específico de task?**
O domínio "comentário" é genérico — task, project, folder, list (e doc futuro)
compartilham 100% do payload e do storage (DEvento `-507`). Um único módulo
elimina duplicação e prepara naturalmente o terreno para `doc` quando docs
forem implementados. SRP preservado: `CommentsService` cuida de comentários;
`CommentTargetResolver` cuida de regras de alvo (acoplamento isolado).

#### 6.1.1 `CommentTargetResolver` — peça central

Pequena abstração que, dado `targetType`, sabe (a) confirmar existência do
alvo e (b) validar acesso do requester. Implementado como um único provider
com `switch` interno (mais simples que strategy pattern para 4 tipos, e
extensível para `doc` adicionando uma nova entrada).

**Tabela de regras de acesso por tipo:**

| targetType | Como achar o alvo | Como validar acesso |
|------------|-------------------|---------------------|
| `task`     | `prisma.dTask.findFirst({ where: { chave, excluido: false } })` | `projectsService.findAccessibleProjectIds(requester, orgId)` deve conter `task.idProject` |
| `project`  | `prisma.dProject.findFirst({ where: { chave, excluido: false } })` | `projectMembersService.getMembership(projectId, requester)` retorna `MANAGER` / `MEMBER` / `VIEWER` (qualquer um basta para ler/comentar) |
| `folder`   | `prisma.dProject.findFirst({ where: { chave, idClasse: BigInt(-351), excluido: false } })` | mesma regra de project (folder é DProject) |
| `list`     | `prisma.dProject.findFirst({ where: { chave, idClasse: BigInt(-352), excluido: false } })` | mesma regra de project (list é DProject) |

**Erros padrão (definidos no resolver):**
- alvo não existe → `NotFoundException` (HTTP 404)
- requester sem acesso → `ForbiddenException` (HTTP 403)
- `targetType` inválido → `BadRequestException` (HTTP 400) — validado pelo
  enum no DTO antes de chegar ao service, mas o resolver também valida
  defensivamente.

**Assinatura sugerida:**

```typescript
export interface ResolvedTarget {
  targetType: CommentTargetType;
  targetId: string;        // sempre string para serializar
  exists: true;            // sempre true se chegou aqui (senão lançou 404)
}

@Injectable()
export class CommentTargetResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly projectMembersService: ProjectMembersService,
  ) {}

  async resolveAndAuthorize(
    targetType: CommentTargetType,
    targetId: string,
    requesterEntidadeId: bigint,
    orgId: string | null,
  ): Promise<ResolvedTarget> {
    // switch(targetType) com a tabela acima — lança 404/403 conforme o caso.
  }
}
```

#### 6.1.2 Enum `CommentTargetType`

```typescript
// src/comments/dto/comment-target-type.enum.ts
export enum CommentTargetType {
  TASK    = 'task',
  PROJECT = 'project',
  FOLDER  = 'folder',
  LIST    = 'list',
  // DOC = 'doc'  ← deixar comentado, pronto para a próxima sprint
}
```

DTO usa `@IsEnum(CommentTargetType)` no `targetType` (do param) — validação
automática retorna 400 para valores inválidos.

#### 6.1.3 Storage em `DEvento`

Service cria DEvento com:
- `idClasse: BigInt(-507)`
- `idEntidade: requesterEntidadeId` (autor)
- `identificadorExterno: targetId` (mantém compatibilidade com cursor pagination
  existente)
- `descricao: dto.texto`
- `metaDados: { targetType: dto.targetType, targetId, autorId: requesterEntidadeId.toString() }`

O campo `targetType` em `metaDados` permite filtragem futura por tipo se
necessário (ex: "listar todos os comentários do usuário X em projects").

**Listagem:** `WHERE idClasse = -507 AND identificadorExterno = :targetId AND
excluido = false` — cursor pagination DESC pela `chave`.

### 6.2 Gap 2 — DocsModule (novo) — DEFERIDO próxima sprint

```
src/docs/
  docs.module.ts
  docs.controller.ts
  docs.service.ts
  dto/
    create-doc.dto.ts
    update-doc.dto.ts
    doc-response.dto.ts
    list-docs-query.dto.ts
```

**Por que módulo separado e não sub-route em ProjectsController?**
A API `/docs` tem semântica diferente de `/projects` para o frontend e para
a IA. O DocsService delega internamente ao `ProjectsService` para operações
de CRUD mas adiciona lógica específica de docs (conteúdo markdown, breadcrumb).

---

## 7. Contratos Detalhados (DTOs + Payloads)

### 7.1 Comentários (polimórfico)

**`CreateCommentDto`**
```typescript
class CreateCommentDto {
  @IsString() @MinLength(1) @MaxLength(10000)
  texto: string;
}
```

> `targetType` e `targetId` vêm dos `@Param()` da rota, não do body.

**`CommentResponseDto`**
```typescript
class CommentResponseDto {
  id: string;          // DEvento.chave.toString()
  targetType: CommentTargetType;  // ecoa o tipo do alvo
  targetId: string;    // ecoa o id do alvo
  texto: string;       // DEvento.descricao
  autorId: string;     // DEvento.idEntidade.toString()
  autorNome: string;   // DEntidade.nome (join — zero N+1)
  createdAt: string;   // DEvento.criadoEm.toISOString()
}
```

**`ListCommentsResponseDto`**
```typescript
class ListCommentsResponseDto {
  items: CommentResponseDto[];
  nextCursor: string | null;
}
```

**`ListCommentsQueryDto`**
```typescript
class ListCommentsQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
}
```

Endpoints:
- `POST /comments/:targetType/:targetId` → `201` com `CommentResponseDto`
- `GET /comments/:targetType/:targetId?cursor=&limit=20` → `200` com `ListCommentsResponseDto`

### 7.2 Documentos — DEFERIDO próxima sprint

**`CreateDocDto`**
```typescript
class CreateDocDto {
  @IsString() @MinLength(1) @MaxLength(255)
  titulo: string;

  @IsOptional() @IsString() @MaxLength(500000)
  conteudo?: string;  // markdown, default ''

  @IsOptional() @IsString()
  idPai?: string | null;  // DProject.chave de LIST/FOLDER/SPACE pai

  @IsOptional() @IsString()
  orgId?: string;  // DProject.idEstab

  @IsOptional() @IsBoolean()
  privado?: boolean;
}
```

**`UpdateDocDto`**
```typescript
class UpdateDocDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255)
  titulo?: string;

  @IsOptional() @IsString() @MaxLength(500000)
  conteudo?: string;
}
```

**`DocResponseDto`**
```typescript
class DocResponseDto {
  id: string;
  titulo: string;
  conteudo: string;        // dados.content ?? ''
  idPai: string | null;
  breadcrumb: BreadcrumbItemDto[];  // [{id, nome, idClasse}] da raiz ao doc
  criadoPor: string;       // DProject.dados.createdBy (entidadeId do criador)
  criadoEm: string;
  atualizadoEm: string;
  privado: boolean;
  orgId: string | null;
}

class BreadcrumbItemDto {
  id: string;
  nome: string;
  idClasse: string;
}
```

Endpoints:
- `POST /docs` → `201` com `DocResponseDto`
- `PATCH /docs/:id` → `200` com `DocResponseDto`
- `GET /docs/:id` → `200` com `DocResponseDto`
- `GET /docs` → `200` com `{ items: DocResponseDto[], nextCursor: string|null }`

---

## 8. Plano de Implementação (Fases e Tasks)

### Fase 1 — Seed e Event Types — ENTREGUE E APROVADA (8.5/10)

> **JÁ FEITA.** Não refazer.
>
> - `-507 TASK_COMMENT` adicionado em `prisma/seeds/classes.seed.ts`, COUNTS atualizado.
> - `task.comment.created`, `task.comment.deleted` em `event-types.ts`.
> - `doc.created`, `doc.updated`, `doc.deleted` adicionados (dormentes até próxima sprint).
> - Mapeamentos em `audit-log.consumer.ts` (TYPE_TO_CLASSE).
> - Build OK. Score Reviewer: 8.5/10.

---

### Fase 2 — CommentsModule polimórfico (4–5h)

> Renomeação de escopo: era `TaskCommentsModule` (3–4h); agora `CommentsModule`
> polimórfico (4–5h). +1h pelo `CommentTargetResolver` e DTOs do enum.

**T2.1 — DTOs e enum** (45min)

Criar `src/comments/dto/`:
- `comment-target-type.enum.ts` — `enum CommentTargetType { TASK='task', PROJECT='project', FOLDER='folder', LIST='list' }`
- `create-comment.dto.ts` — `CreateCommentDto` (apenas `texto`)
- `comment-response.dto.ts` — `CommentResponseDto`
- `list-comments-response.dto.ts` — `ListCommentsResponseDto`
- `list-comments-query.dto.ts` — `ListCommentsQueryDto`

**T2.2 — CommentTargetResolver** (1h)

Criar `src/comments/comment-target.resolver.ts`:

```typescript
@Injectable()
export class CommentTargetResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly projectMembersService: ProjectMembersService,
  ) {}

  async resolveAndAuthorize(
    targetType: CommentTargetType,
    targetId: string,
    requesterEntidadeId: bigint,
    orgId: string | null,
  ): Promise<ResolvedTarget> {
    const chave = BigInt(targetId);

    switch (targetType) {
      case CommentTargetType.TASK: {
        const task = await this.prisma.dTask.findFirst({
          where: { chave, excluido: false },
          select: { chave: true, idProject: true },
        });
        if (!task) throw new NotFoundException(`Task ${targetId} not found`);
        const accessible = await this.projectsService.findAccessibleProjectIds(
          requesterEntidadeId, orgId,
        );
        if (!accessible.includes(task.idProject)) {
          throw new ForbiddenException('No access to this task');
        }
        break;
      }
      case CommentTargetType.PROJECT:
      case CommentTargetType.FOLDER:
      case CommentTargetType.LIST: {
        const expectedIdClasse =
          targetType === CommentTargetType.PROJECT ? null   // qualquer DProject não-folder/list
          : targetType === CommentTargetType.FOLDER ? BigInt(-351)
          : BigInt(-352);
        const where: Prisma.DProjectWhereInput = { chave, excluido: false };
        if (expectedIdClasse !== null) where.idClasse = expectedIdClasse;
        const proj = await this.prisma.dProject.findFirst({ where, select: { chave: true } });
        if (!proj) throw new NotFoundException(`${targetType} ${targetId} not found`);
        const membership = await this.projectMembersService.getMembership(
          proj.chave, requesterEntidadeId,
        );
        if (!membership) throw new ForbiddenException(`No access to this ${targetType}`);
        break;
      }
      default:
        throw new BadRequestException(`Invalid targetType: ${targetType}`);
    }

    return { targetType, targetId, exists: true };
  }
}
```

> Nota: para `PROJECT`, decidir se vale filtrar `idClasse` explicitamente
> (-350 SPACE? -355 PROJECT genérico?) — Implementer alinha com a hierarquia
> atual de DProject ao implementar. Default: aceitar qualquer DProject que não
> seja FOLDER/LIST/DOC, mas validar com o schema do seed.

**T2.3 — CommentsService** (1.5h)

Criar `src/comments/comments.service.ts`:

```typescript
@Injectable()
export class CommentsService {
  // Dependências:
  //   PrismaService, EventProducerService, CorrelationIdService,
  //   CommentTargetResolver

  async create(
    targetType: CommentTargetType,
    targetId: string,
    dto: CreateCommentDto,
    autorEntidadeId: bigint,
    orgId: string | null,
  ): Promise<CommentResponseDto>
  // 1. await resolver.resolveAndAuthorize(targetType, targetId, autorEntidadeId, orgId)
  //    → lança 404/403 conforme o caso
  // 2. Criar DEvento (Prisma direto — DEvento é audit, não Pilar 1):
  //    prisma.dEvento.create({
  //      data: {
  //        idClasse: BigInt(-507),
  //        idEntidade: autorEntidadeId,
  //        identificadorExterno: targetId,
  //        descricao: dto.texto,
  //        metaDados: { targetType, targetId, autorId: autorEntidadeId.toString() }
  //      }
  //    })
  // 3. Buscar DEntidade do autor (nome) — uma única query
  // 4. Emitir evento APÓS persistência:
  //    eventProducer.addInternalEvent('task.comment.created', { targetType, targetId, ... })
  //    (event type já existe na Fase 1; reusamos para todos os tipos na v1.
  //     Próxima sprint pode introduzir 'comment.created' genérico se quiser.)
  // 5. Retornar CommentResponseDto

  async findMany(
    targetType: CommentTargetType,
    targetId: string,
    query: ListCommentsQueryDto,
    requesterEntidadeId: bigint,
    orgId: string | null,
  ): Promise<ListCommentsResponseDto>
  // 1. await resolver.resolveAndAuthorize(...)
  // 2. Cursor pagination:
  //    prisma.dEvento.findMany({
  //      where: {
  //        idClasse: BigInt(-507),
  //        identificadorExterno: targetId,
  //        excluido: false,
  //        ...(cursor ? { chave: { lt: BigInt(cursor) } } : {})
  //      },
  //      include: { entidade: { select: { chave: true, nome: true } } },  // zero N+1
  //      take: limit + 1,
  //      orderBy: { chave: 'desc' }
  //    })
  // 3. Calcular nextCursor (se items.length > limit, retirar último e retornar cursor)
  // 4. Mapear para CommentResponseDto[] (incluir targetType eco)
}
```

**T2.4 — CommentsController** (45min)

Criar `src/comments/comments.controller.ts`:

```typescript
@ApiTags('comments')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller('comments')
export class CommentsController {
  @Post(':targetType/:targetId')
  @ApiOperation({ summary: 'Adicionar comentário a um alvo (task/project/folder/list)' })
  async create(
    @Param('targetType', new ParseEnumPipe(CommentTargetType)) targetType: CommentTargetType,
    @Param('targetId') targetId: string,
    @Body() dto: CreateCommentDto,
    @Request() req: JwtRequest,
  ): Promise<CommentResponseDto>

  @Get(':targetType/:targetId')
  @ApiOperation({ summary: 'Listar comentários de um alvo (cursor pagination DESC)' })
  async findMany(
    @Param('targetType', new ParseEnumPipe(CommentTargetType)) targetType: CommentTargetType,
    @Param('targetId') targetId: string,
    @Query() query: ListCommentsQueryDto,
    @Request() req: JwtRequest,
  ): Promise<ListCommentsResponseDto>
}
```

> `ParseEnumPipe` garante que `targetType` inválido retorna 400 antes de chegar
> ao service.

**T2.5 — CommentsModule** (15min)

Criar `src/comments/comments.module.ts`:

```typescript
@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => ProjectsModule),   // ProjectsService + ProjectMembersService
  ],
  controllers: [CommentsController],
  providers: [CommentsService, CommentTargetResolver],
  exports: [CommentsService],
})
export class CommentsModule {}
```

Registrar em `AppModule`.

**T2.6 — Integração, README e build** (30min)

- Verificar que `ProjectsModule` exporta `ProjectsService` e
  `ProjectMembersService`.
- Adicionar README curto em `src/comments/README.md` explicando o débito de
  naming: DClasse `-507 TASK_COMMENT` é usada polimorficamente — nome
  histórico, mantido para evitar retrabalho no seed aprovado.
- `npm run build` — zero erros.

---

### Fase 3 — DocsModule (4–5h) — DEFERIDO próxima sprint

> Toda a Fase 3 abaixo fica preservada para a próxima sprint. Análise e DTOs
> continuam válidos. Não implementar agora.

**T3.1 — DTOs** (45min)

Criar `src/docs/dto/`:
- `create-doc.dto.ts` — `CreateDocDto`
- `update-doc.dto.ts` — `UpdateDocDto`
- `doc-response.dto.ts` — `DocResponseDto`, `BreadcrumbItemDto`, `ListDocsResponseDto`
- `list-docs-query.dto.ts` — `ListDocsQueryDto` (cursor, limit, idPai, orgId)

**T3.2 — DocsService** (2h)

Criar `src/docs/docs.service.ts`:

```typescript
/** idClasse DOC no seed */
const ID_CLASSE_DOC = BigInt(-353);

@Injectable()
export class DocsService {
  // Dependências: PrismaService, ProjectsService, EventProducerService, CorrelationIdService

  async create(dto: CreateDocDto, creatorEntidadeId: bigint): Promise<DocResponseDto>
  // 1. Validar hierarquia: se idPai informado, buscar pai e validar que
  //    idClasse ∈ [-350, -351, -352] (SPACE/FOLDER/LIST)
  // 2. Validar acesso ao pai (se privado, verificar membership via DVincula)
  // 3. Dentro de prisma.$transaction:
  //    a. prisma.dProject.create({
  //         data: {
  //           idClasse: ID_CLASSE_DOC,
  //           nome: dto.titulo,
  //           ...(dto.idPai ? { idPai: BigInt(dto.idPai) } : {}),
  //           ...(dto.orgId ? { idEstab: BigInt(dto.orgId) } : {}),
  //           privado: dto.privado ?? false,
  //           dados: {
  //             content: dto.conteudo ?? '',
  //             createdBy: creatorEntidadeId.toString(),
  //             slug: await deriveDocSlug(tx, dto.titulo)  // reutilizar lógica de slugify
  //           }
  //         }
  //       })
  //    b. DVincula -171 MANAGER para o criador (reutilizar ProjectMembersService.createManagerLink)
  // 4. Emitir 'doc.created' APÓS commit
  // 5. Calcular breadcrumb (recursivo máx 5 níveis — não usar CTE, itens pequenos)
  // 6. Retornar DocResponseDto

  async update(id: string, dto: UpdateDocDto, requesterEntidadeId: bigint, orgId?: string): Promise<DocResponseDto>
  // 1. Buscar doc: prisma.dProject.findFirst({ where: { chave, idClasse: -353, excluido: false } })
  // 2. Se não existe: NotFoundException
  // 3. Verificar que requester é MANAGER (DVincula -171) ou MEMBER (-172)
  //    usando ProjectMembersService.getMembership
  // 4. Construir dadosAtualizados: { ...dadosExistentes, content: dto.conteudo ?? dadosExistentes.content }
  // 5. prisma.dProject.update({ where: { chave }, data: { nome: dto.titulo, dados: dadosAtualizados } })
  // 6. Emitir 'doc.updated' APÓS persistência
  // 7. Retornar DocResponseDto

  async findOne(id: string, requesterEntidadeId: bigint, orgId?: string): Promise<DocResponseDto>
  // 1. Buscar doc com validação de acesso
  // 2. Calcular breadcrumb
  // 3. Retornar DocResponseDto com conteúdo completo

  async findMany(requesterEntidadeId: bigint, query: ListDocsQueryDto, orgId?: string): Promise<ListDocsResponseDto>
  // Thin wrapper sobre ProjectsService.findMany com idClasse='-353'

  private async buildBreadcrumb(docId: bigint): Promise<BreadcrumbItemDto[]>
  // Iterar via idPai, máx 5 saltos (SPACE > FOLDER > LIST > DOC = 4 níveis)
  // 1 query por nível = máx 4 queries — aceitável dado o volume pequeno
  // Para v2 considerar CTE recursiva se profundidade crescer
}
```

**T3.3 — DocsController** (45min)

Criar `src/docs/docs.controller.ts`:

```typescript
@ApiTags('docs')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller('docs')
export class DocsController {
  @Post()
  @ApiOperation({ summary: 'Criar documento (DProject idClasse=-353)' })
  async create(@Body() dto: CreateDocDto, @Request() req: JwtRequest): Promise<DocResponseDto>

  @Get()
  @ApiOperation({ summary: 'Listar documentos (cursor pagination)' })
  async findMany(@Query() query: ListDocsQueryDto, @Request() req: JwtRequest): Promise<ListDocsResponseDto>

  @Get(':id')
  @ApiOperation({ summary: 'Ler documento com conteúdo completo e breadcrumb' })
  async findOne(@Param('id') id: string, @Request() req: JwtRequest): Promise<DocResponseDto>

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar título e/ou conteúdo do documento (MANAGER ou MEMBER)' })
  async update(@Param('id') id: string, @Body() dto: UpdateDocDto, @Request() req: JwtRequest): Promise<DocResponseDto>

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete do documento (MANAGER)' })
  async delete(@Param('id') id: string, @Request() req: JwtRequest): Promise<{ deleted: true, id: string }>
}
```

**T3.4 — DocsModule** (15min)

Criar `src/docs/docs.module.ts`:

```typescript
@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => ProjectsModule)],
  controllers: [DocsController],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule {}
```

Registrar em `AppModule`.

**T3.5 — Atualizar `validateHierarchyRule` em `ProjectsService`** (30min)

O método `validateHierarchyRule` em `projects.service.ts` valida hierarquia
para SPACE/FOLDER/LIST. Precisa aceitar DOC (-353) como filho de
LIST (-352), FOLDER (-351) ou SPACE (-350):

```typescript
// Regra atual (simplificada):
// SPACE → sem pai
// FOLDER → pai deve ser SPACE
// LIST → pai deve ser FOLDER ou SPACE
// DOC (novo) → pai deve ser LIST, FOLDER ou SPACE
```

Alternativa: a lógica fica no DocsService (não no ProjectsService), pois
`POST /docs` nunca passa pelo `ProjectsController`. Isso é mais limpo — cada
módulo valida sua própria hierarquia.

**T3.6 — Build e smoke test** (30min)

- `npm run build` — zero erros.
- Verificar Swagger UI em `GET /api` — endpoints aparecem.

---

### Fase 4 — Testes de Integração (1.5–2h)

**T4.1 — Testes de comentários polimórficos** (1.5–2h)

Arquivo: `src/comments/comments.service.spec.ts`

Cenários obrigatórios (mínimo 9, cobrindo os 4 tipos):

- [ ] **#1** — POST comentário em `task` — sucesso (retorna DTO com `targetType='task'`, `targetId`, `texto`, `autorId`, `autorNome`, `createdAt`).
- [ ] **#2** — POST comentário em `project` — sucesso.
- [ ] **#3** — POST comentário em `folder` (DProject idClasse=-351) — sucesso.
- [ ] **#4** — POST comentário em `list` (DProject idClasse=-352) — sucesso.
- [ ] **#5** — POST retorna 404 se `targetType=task` e task não existe.
- [ ] **#6** — POST retorna 404 se `targetType=project` e project não existe.
- [ ] **#7** — POST retorna 403 se usuário sem acesso ao alvo (testar pelo menos `task` e `project`).
- [ ] **#8** — POST retorna 400 se `targetType` inválido (ex: `"foo"`) — garantido pelo `ParseEnumPipe`.
- [ ] **#9** — GET retorna `items` com cursor pagination correto + não retorna excluídos (`excluido=true`) + zero N+1 (join `DEntidade` para nome do autor na mesma query).

> Mocking: `PrismaService`, `ProjectsService.findAccessibleProjectIds`,
> `ProjectMembersService.getMembership`, `EventProducerService.addInternalEvent`.
> O resolver é testado indiretamente pelos cenários #5/#6/#7/#8 — não exige
> spec dedicado (mas se o Implementer preferir, fica autorizado um
> `comment-target.resolver.spec.ts` adicional).

**T4.2 — Testes de documentos** (1.5h) — DEFERIDO próxima sprint

Arquivo: `src/docs/docs.service.spec.ts`

Cenários obrigatórios:
- [ ] POST /docs — cria doc com dados.content correto
- [ ] POST /docs — retorna 404 se idPai não existe
- [ ] POST /docs — retorna 400 se idPai não é SPACE/FOLDER/LIST
- [ ] PATCH /docs/:id — atualiza conteúdo preservando outros campos de dados
- [ ] PATCH /docs/:id — retorna 403 se requester é VIEWER (sem permissão de escrita)
- [ ] GET /docs/:id — retorna breadcrumb correto (SPACE > FOLDER > LIST > DOC)
- [ ] GET /docs/:id — não retorna doc com excluido=true
- [ ] GET /docs — filtra por idClasse=-353 e orgId corretamente

---

## 9. Estimativa de Tempo (sprint atual — só comentários polimórficos)

| Fase | Descrição | Otimista | Realista | Pessimista |
|------|-----------|----------|----------|------------|
| F1 | Seed + Event Types | — | — | — (já entregue, 8.5/10) |
| F2 | CommentsModule polimórfico (com resolver) | 3h | 4.5h | 6h |
| F4 | Testes de integração (T4.1, 9 cenários) | 1.5h | 2h | 3h |
| **Total sprint atual** | | **4.5h** | **6.5h** | **9h** |

**Com buffer 20%:** ~8h realista, ~11h pessimista.

> Fase 3 (DocsModule) e T4.2 ficam fora do orçamento desta sprint —
> reagendar quando docs forem retomados.

---

## 10. Riscos e Mitigações

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| `validateHierarchyRule` de `ProjectsService` rejeita DOC como filho de LIST | M | M | Adicionar `-353` à whitelist de filhos de LIST no método. Ou não passar pelo `ProjectsController` (usar `DocsService` direto). |
| `ProjectMembersService.createManagerLink` não aceita `PrismaTransactionClient` | B | A | Verificar assinatura atual — se precisa da `tx`, passar corretamente. Se não, usar fora da transaction (membership pode ser eventual-consistent na v1). |
| `DEvento.identificadorExterno` VARCHAR(255) — IDs grandes (BigInt como string) cabem? | B | B | BigInt como string = máx 20 chars. Sem problema. |
| Conteúdo markdown muito grande (>500KB) — timeout na transaction | B | M | Validação no DTO (`@MaxLength(500000)`). Aviso no README para uso com IA. |
| `validateHierarchy` em `classes.seed.ts` rejeita novo `-507` em time de import | B | A | Verificar que `-3 EVENTOS` existe nas classes fixas do template. É filho de `-3` — já é pai de `-489..-506`, logo aceita `-507`. |
| Tenant isolation: DocsService expõe doc de outra org | M | A | Sempre cruzar `DProject.idEstab` com `JWT.organizationId` (mesmo padrão de `ProjectsService.findOne`). Fase 4 testa isso. |
| `COUNTS` em `classes.seed.ts` desatualizado gera erro em testes anti-regressão | M | B | Atualizar `especificas: 105, total: 150` em T1.1. |
| DClasse `-507` nomeada `TASK_COMMENT` mas usada polimorficamente | M | B | Débito de naming aceito conscientemente para evitar retrabalho do seed já aprovado (8.5/10). Documentar no commit (`feat(comments): ...`) e no `src/comments/README.md` — o nome é histórico, semanticamente serve como "comentário em qualquer alvo". |
| Hierarquia de validação de acesso para `folder`/`list` reusa regras de `project` — `getMembership` pode não retornar corretamente para `idClasse=-351/-352` | M | M | Verificar em T2.2 que `ProjectMembersService.getMembership` aceita qualquer `DProject` independente de `idClasse` (folder/list são DProject também). Se a implementação atual filtrar só "projects de verdade", abrir issue paralela e ajustar o filtro — ou herdar membership do ancestral via `idPai` recursivamente. Cobrir nos testes #3 e #4. |

---

## 11. Critérios de Sucesso por Endpoint

### POST /comments/:targetType/:targetId (polimórfico)
- [ ] Funciona para os 4 tipos: `task`, `project`, `folder`, `list`.
- [ ] Retorna `201` com `id`, `targetType`, `targetId`, `texto`, `autorId`, `autorNome`, `createdAt`.
- [ ] `DEvento` criado com `idClasse=-507`, `idEntidade=autorId`, `identificadorExterno=targetId`, `metaDados.targetType=targetType`.
- [ ] Evento `task.comment.created` emitido APÓS persistência (event type reusado para todos os tipos na v1).
- [ ] Retorna `404` se alvo não existe / excluído (validado pelo resolver para cada `targetType`).
- [ ] Retorna `403` se usuário sem acesso ao alvo (regras por tipo conforme tabela 6.1.1).
- [ ] Retorna `400` se `targetType` inválido (`ParseEnumPipe`).
- [ ] Build passa, lint passa.

### GET /comments/:targetType/:targetId (polimórfico)
- [ ] Funciona para os 4 tipos: `task`, `project`, `folder`, `list`.
- [ ] Retorna `200` com `items[]` e `nextCursor`.
- [ ] `items` ordenados por `criadoEm DESC` (chave DESC).
- [ ] Cursor pagination funciona: segundo fetch com `cursor` retorna próxima página.
- [ ] Comentários com `excluido=true` não aparecem.
- [ ] Zero N+1 (join `DEntidade` para nome do autor na mesma query).
- [ ] Mesmas regras de 404/403/400 do POST aplicam-se via resolver.

### POST /docs — DEFERIDO próxima sprint
- [ ] Retorna `201` com todos campos de `DocResponseDto` incluindo `conteudo`
- [ ] `DProject` criado com `idClasse=-353`, `dados.content = dto.conteudo`
- [ ] `DVincula -171` criado para o criador (MANAGER)
- [ ] Evento `doc.created` emitido APÓS commit
- [ ] `idPai` aceito se pai existe e é SPACE/FOLDER/LIST
- [ ] Retorna `400` se idPai aponta para um DOC (ciclo)
- [ ] Build passa, lint passa

### PATCH /docs/:id — DEFERIDO próxima sprint
- [ ] Retorna `200` com conteúdo atualizado
- [ ] `dados.content` atualizado preservando outros campos (`slug`, `createdBy`, etc.)
- [ ] Evento `doc.updated` emitido APÓS persistência
- [ ] Retorna `403` se requester é VIEWER
- [ ] Retorna `404` se doc não existe ou está excluído

### GET /docs/:id — DEFERIDO próxima sprint
- [ ] Retorna `200` com `conteudo` completo (sem truncar)
- [ ] `breadcrumb` correto: array de `{id, nome, idClasse}` da raiz ao doc
- [ ] Retorna `404` se doc excluído
- [ ] Tenant isolation: doc de outra org retorna `404` (não `403` — não revelar existência)

---

## 12. Handoff para o Implementer

### Por onde começar

1. **Fase 1 — JÁ FEITA (8.5/10).** Não tocar.

2. **Fase 2 — comece pelo `CommentTargetResolver` (T2.2).** Ele é a **peça
   central** desta sprint: encapsula toda a lógica de "achar e autorizar alvo"
   por `targetType`. Sem ele rodando, o service vira espaguete de `switch`.
   Implementar o resolver primeiro, testá-lo mentalmente contra os 4 tipos da
   tabela 6.1.1, e só depois escrever o `CommentsService` (que delega tudo a
   ele).

3. **Depois do resolver:** DTOs (T2.1), Service (T2.3), Controller (T2.4),
   Module (T2.5), README+build (T2.6).

4. **Fase 4 (testes) — escrever junto, não depois.** Os 9 cenários de T4.1
   cobrem os 4 tipos × happy path + 404/403/400 + cursor + N+1.

5. **Gate Reviewer: ≥ 8.0** (não 7.0) — padrão de qualidade reforçado nesta
   sprint. Validado pelo hook `validate-review-score.sh` configurado.

6. **Fase 3 (Docs) — NÃO IMPLEMENTAR.** Deferida. A próxima sprint reaproveita
   a análise já feita.

### Arquivos obrigatórios para ler antes de começar

- `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/prisma/schema.prisma`
  — confirmar campos disponíveis em `DEvento` e `DProject`.
- `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/prisma/seeds/classes.seed.ts`
  — entender o helper `esp()` e a convenção de idPai para novos seeds.
- `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/src/eventos/core/event-types.ts`
  — ver o formato exato para adicionar novos tipos.
- `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/src/eventos/consumers/audit-log.consumer.ts`
  — ver o padrão TYPE_TO_CLASSE.
- `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/src/projects/projects.service.ts`
  — entender `findAccessibleProjectIds`, `validateHierarchyRule`, `buildResponse`.
- `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/src/projects/project-members.service.ts`
  — ver `createManagerLink` e `getMembership` para reutilizar em DocsService.
- `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/src/projects/projects.module.ts`
  — ver o padrão de `forwardRef` e exports para espelhar em TaskCommentsModule e DocsModule.

### Pontos de atenção críticos

1. **NUNCA** usar `prisma.dPedido.create()` para comentários ou docs — Pilar 1
   não se aplica (comentário = DEvento, doc = DProject; ambos são estruturais, não
   transacionais financeiros).

2. **DEvento para comentários é INSERT Prisma direto** — sem Engine/Operacao.
   DEvento é tabela de audit, não tabela transacional do Pilar 1.

3. **Validar `organizationId` sempre** — cruzar `DProject.idEstab` com
   `JWT.organizationId` tanto em Docs quanto em Comentários (via task → project).

4. **Cursor pagination em DEvento usa `chave DESC`** (BigInt BIGSERIAL). O cursor
   é a `chave` do último item retornado. Próxima página: `WHERE chave < :cursor`.

5. **`dados.content` em DProject é parte do campo Json** — ao fazer update,
   sempre ler o `dados` atual e fazer merge explícito:
   ```typescript
   const dadosAtuais = (projeto.dados as Record<string, unknown>) ?? {};
   const dadosNovos = { ...dadosAtuais, content: dto.conteudo };
   await prisma.dProject.update({ where: { chave }, data: { dados: dadosNovos } });
   ```
   NUNCA sobrescrever `dados` inteiro sem merge — perda de `slug`, `createdBy`, etc.

6. **COUNTS em `classes.seed.ts`** — ao adicionar `-507`, atualizar a linha do
   `COUNTS` (`especificas: 105, total: 150`) ou o teste anti-regressão falhará.

7. **Registrar módulos em AppModule** — TaskCommentsModule e DocsModule precisam
   estar no `imports: []` do AppModule (ou do módulo raiz do projeto).

### Estimativa de esforço por fase (síntese)

| Fase | Esforço | Risco principal |
|------|---------|-----------------|
| F1 — Seed/Events | — (entregue 8.5/10) | — |
| F2 — Comments polimórfico | 4.5h | Resolver lidando bem com folder/list (membership pode não cobrir) |
| F3 — Docs | DEFERIDO | — |
| F4 — Testes (T4.1) | 2h | Mocking de PrismaService + 4 tipos no resolver |

---

_Plano gerado pelo Strategist Agent em 2026-05-27. Revisar antes de iniciar
implementação caso o schema ou módulos tenham mudado desde a análise._
