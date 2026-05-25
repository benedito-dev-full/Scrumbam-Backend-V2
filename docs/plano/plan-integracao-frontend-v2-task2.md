# PLANO MACRO DE INTEGRAÇÃO — Backend V2 ↔ Frontend V2

**Criado por:** Strategist Agent V2
**Data:** 2026-05-24
**Módulo:** `core | endpoints | entidades | classes | projects | tasks | engine | seeds | channels | mcp | webhooks | automation | flow-metrics | reports | docs`
**Fase V2:** F5-F17 (integração retroativa + fases pendentes)
**ADRs vinculados:** ADR-V2-001, ADR-V2-002, ADR-V2-003, ADR-V2-005, ADR-V2-007, ADR-V2-008, ADR-V2-009, ADR-V2-015, ADR-V2-047, ADR-V2-051
**Estimativa Total:** 18-24 semanas (com buffer 20%)
**Complexidade:** Alta

---

## SUMÁRIO EXECUTIVO

O backend V2 completou as Fases F0-F8. O frontend V2 está 100% em modo mock —
nenhuma chamada real de API está ativa. Este plano define a integração completa
em 9 Blocos sequenciais, respeitando dependências técnicas e priorizando resultado
visual imediato para o CEO.

**Decisão arquitetural central (ADR-V2-051, NÃO reabrir):**
- `DProject` recebe `idPai BigInt?` (self-referencial) e `privado Boolean @default(false)`
- Hierarquia: `Space (DProject) → Folder (DProject) → List (DProject) → Task (DTask)`
- Space público = org inteira; Space privado = DVincula por membro

---

## 1. GLOSSÁRIO DE EQUIVALÊNCIAS CANÔNICAS

| Conceito Frontend V2 | Equivalente Backend V2 | DClasse | Endpoint Canônico | Status |
|---|---|---|---|---|
| **Space (Espaço)** | DProject `idPai IS NULL` e `idClasse=-350` (SPACE) | -350 SPACE (nova) | `GET /projects?type=space` | REQUER MIGRATION |
| **Folder (Pasta)** | DProject `idPai=spaceId` e `idClasse=-351` (FOLDER) | -351 FOLDER (nova) | `GET /projects?parentId={spaceId}` | REQUER MIGRATION |
| **List (Lista/Board/Backlog)** | DProject `idPai=folderId` e `idClasse=-352` (LIST) | -352 LIST (nova) | `GET /projects?parentId={folderId}` | REQUER MIGRATION |
| **Task (Tarefa)** | DTask `idClasse=-154` (SCRUMBAN_TASK) | -154 SCRUMBAN_TASK | `GET /tasks?projectId={listId}` | ALINHADO |
| **Phase (Fase)** | DTask `idClasse=-200` (PHASE) com `idPai` de task | -200 PHASE | `GET /tasks?idClasse=-200&projectId={id}` | ALINHADO |
| **Sprint** | DTabela `idClasse=-400` (SPRINT) | -400 SPRINT | `GET /sprints` | ALINHADO |
| **Status V3** | DTabela `idClasse=-441..-449` (V3 Intentions) | -441 INBOX .. -449 VALIDATED | `GET /workflow-statuses` | ALINHADO |
| **Membro de Space** | DVincula `idClasse=-171/-172/-173` onde `idLocEscritu=spaceId` | -171 MANAGER, -172 MEMBER, -173 VIEWER | `GET /projects/:id/members` | ALINHADO |
| **Assignee** | DEntidade `idClasse=-150` (USER) via `DTask.idAssignee` | -150 USER | Campo `assigneeId` em TaskResponseDto | ALINHADO |
| **Organização** | DEntidade `idClasse=-152` (ORGANIZATION) | -152 ORGANIZATION | `GET /organizations` | ALINHADO |
| **Team** | DEntidade `idClasse=-180` (TEAM) | -180 TEAM | `GET /teams` | ALINHADO |
| **Agent VPS** | DEntidade `idClasse=-156` (AGENT) | -156 AGENT | `GET /agents` | ALINHADO |
| **Execução** | DPedido `idClasse=-300/-301/-302/-303` | -300 EXECUTION | `GET /executions` | ALINHADO (Pilar 1) |
| **Notificação** | DEvento `idClasse=-490` (NOTIFICATION) | -490 NOTIFICATION | `GET /notifications` | ALINHADO |
| **Doc (documento rico)** | DTabela `idClasse=-353` (DOC) + `dados` JSON | -353 DOC (nova) | `GET /projects/:id/docs` | REQUER MIGRATION |
| **Bookmark** | DVincula `idClasse=-187` (BOOKMARK) | -187 BOOKMARK (nova) | Via DVincula batch | REQUER SEED |
| **Webhook** | DTabela `idClasse=-470` (WEBHOOK) | -470 WEBHOOK | `GET /webhooks` | ALINHADO |
| **MCP Key** | DTabela `idClasse=-472` (MCP_KEY) | -472 MCP_KEY | `GET /mcp/keys` | ALINHADO |
| **Convite** | DTabela `idClasse=-476` (INVITE_TOKEN) | -476 INVITE_TOKEN | `POST /invites` | ALINHADO |

**Mapeamento de status frontend → V3 Intentions:**
```
"em-progresso" → EXECUTING, VALIDATING
"pendente"     → INBOX, READY
"concluido"    → DONE, VALIDATED
"atrasado"     → calculado: task EXECUTING + dados.dueDate < hoje (não é estado)
"bloqueado"    → FAILED (semanticamente próximo — decisão de UX)
```

---

## 2. TABELA DE DCLASSES NOVAS (ADR-V2-051)

| Chave | Código | Nome | idPai | Agrupamento | Justificativa |
|---|---|---|---|---|---|
| -350 | SPACE | Espaço de trabalho | -37 (ENTIDADES) | false | ADR-V2-051: raiz da hierarquia DProject |
| -351 | FOLDER | Pasta agrupadora | -37 (ENTIDADES) | false | ADR-V2-051: nível intermediário Space→Folder→List |
| -352 | LIST | Lista de tasks | -37 (ENTIDADES) | false | ADR-V2-051: container imediato de tasks |
| -353 | DOC | Documento rico | -51 (TABELAS) | false | GAP-04: documentos com conteúdo JSON em `dados` |
| -187 | BOOKMARK | Favorito/Bookmark | -37 (ENTIDADES) | false | GAP-10: favoritos via DVincula |
| -188 | SPACE_PRIVATE_MEMBER | Membro de Space privado | -37 (ENTIDADES) | false | ADR-V2-051 §6: permissão por Space privado |

**Range utilizado:** -187, -188 (domínio entidades), -350, -351, -352, -353 (domínio DProject/DTabela)

**Verificação de colisão:**
- -187, -188: range -180..199 (times e membros), os slots -187 e -188 estão livres (seed atual vai até -186 TELEGRAM_LINK)
- -350, -351, -352: range -300..-399 está ocupado apenas por -300..-303 (EXECUTION). Slots -350..-353 livres.
- -353: encaixa em DTabela (idPai=-51 TABELAS). Sem conflito.

**Total novo:** 143 (atual) + 6 = **149 DClasses**

---

## 3. AVALIAÇÃO DOS 3 PILARES

### Pilar 1 — Engine/Operação
- DProject (Space/Folder/List) é tabela **estrutural** — INSERT via Prisma direto em transaction. NÃO usa Engine.
- DTask permanece tabela estrutural — INSERT via Prisma direto. NÃO usa Engine.
- DPedido (Executions) está correto — Engine `OperacaoExecucaoClaude extends OperacaoPedido` (F6, já implementado).
- **Pilar 1 não violado.** Engine permanece exclusivamente em DPedido.

### Pilar 2 — Endpoints Genéricos
- `GET /entidades?idClasse=-150` → lista usuários (Pilar 2 ativo)
- `GET /tabelas?classe=SPRINT` → lista sprints via wrapper thin (Pilar 2 ativo)
- `GET /tabelas?classe=STATUS_INTENTION_V3` → lista workflow-statuses (Pilar 2 ativo)
- Novos endpoints `/projects?type=space`, `/projects?parentId={id}` são extensões do controller `/projects` existente (exceção autorizada). NÃO criar SpaceController nem FolderController nem ListController.
- Docs via `/projects/:id/docs` — extensão do ProjectsController (rota especializada). Não cria DocController separado.

### Pilar 3 — Seed de Classes
- **6 novas DClasses** (-187, -188, -350, -351, -352, -353)
- Seed PRIMEIRO (Fase 1 = BLOQUEANTE antes de qualquer migration)
- Validação anti-colisão via `validateHierarchy()` já embutida no seed-runner

### Genericidade
- A hierarquia self-referencial em DProject é feature Scrumban-V2 específica.
- A pattern de DProject com `idPai` pode ser contribuída ao template Devari-Core como "projeto hierárquico" (ADR-V2-200 — submissão futura).

---

## 4. VISÃO MACRO DOS BLOCOS

| # | Bloco | Fases | Output Canônico | Estimativa | Prioridade |
|---|---|---|---|---|---|
| **A** | Fundação da Hierarquia (Seed + Migration) | A1-A3 | Seed +6 classes, migration DProject, validação anti-ciclo | 2-3 semanas | CRÍTICO — bloqueia tudo |
| **B** | Autenticação Real | B1-B2 | Frontend conectado a `POST /auth/login`, `POST /auth/register`, refresh automático | 0.5-1 semana | ALTO — resultado visual imediato |
| **C** | Spaces, Folders, Lists | C1-C4 | CRUD completo Space/Folder/List no backend + sidebar frontend real | 3-4 semanas | ALTO — core UX |
| **D** | Tasks e Status V3 | D1-D5 | Tasks reais com dueDate, V3 mapper, Kanban conectado | 2-3 semanas | ALTO — core UX |
| **E** | Teams, Members, Invites | E1-E3 | Páginas `/teams` e membros de Space com dados reais | 1-2 semanas | MÉDIO |
| **F** | Agents e Execuções | F1-F3 | Página `/ia` (aba Agentes) conectada ao backend | 1-2 semanas | MÉDIO |
| **G** | Notificações e Inbox | G1-G2 | `/inbox` com notificações reais, read/unread | 1-1.5 semanas | MÉDIO |
| **H** | Docs, Bookmarks, Sprint Progress | H1-H3 | `/docs`, favoritos, `/sprints` com progresso | 2-3 semanas | BAIXO |
| **I** | Today, Planner, Analytics | I1-I3 | `/today`, `/planner`, `/reports`, `/analytics` reais | 2-3 semanas | BAIXO |

**Critério de priorização aplicado:**
1. Resultado visual imediato para o CEO → Blocos B, C, D primeiro
2. Dependências técnicas → Bloco A é pré-condição de tudo
3. Complexo sem resultado visual → Blocos H, I por último
4. Qualidade mantida — facilidade não justifica gambiarra

---

## 5. BLOCO A — FUNDAÇÃO DA HIERARQUIA (SEED + MIGRATION)

**Objetivo:** Preparar o backend para Space/Folder/List sem quebrar o que já existe.
**Dependências:** Nenhuma (é pré-condição de todos os outros blocos)
**Duração estimada:** 2-3 semanas

### Fase A1 — Seed das 6 novas DClasses (BLOQUEANTE)

**Objetivo:** Adicionar -187, -188, -350, -351, -352, -353 ao `classes.seed.ts`

**Arquivos a modificar:**
- `prisma/seeds/classes.seed.ts` — adicionar 6 entradas no array `classesEspecificas`

**Código a adicionar no seed:**

```typescript
// === DEntidade — vínculos adicionais (Bloco A — ADR-V2-051 + GAP-10) ===
esp(-187, 'BOOKMARK', 'Favorito/Bookmark', -37),
esp(-188, 'SPACE_PRIVATE_MEMBER', 'Membro de Space privado', -37),

// === DProject — hierarquia Space/Folder/List (ADR-V2-051) ===
// Space = DProject raiz de trabalho (idPai IS NULL, idClasse=-350)
// Folder = DProject agrupador dentro de Space (idPai=spaceId, idClasse=-351)
// List = DProject container de tasks (idPai=folderId, idClasse=-352)
// Restrições de negócio (não no schema — validadas no service):
//   - Folder só pode ter Space como pai (não outro Folder)
//   - List só pode ter Folder ou Space como pai (não outra List)
//   - Task só mora em List
//   - Pasta dentro de Pasta: PROIBIDO
//   - Lista dentro de Lista: PROIBIDO
esp(-350, 'SPACE', 'Espaco de trabalho', -37),
esp(-351, 'FOLDER', 'Pasta agrupadora', -37),
esp(-352, 'LIST', 'Lista de tasks (Board/Backlog)', -37),

// === DTabela — documento rico (GAP-04 — CEO decidiu: DTabela + dados JSON) ===
// Doc é DTabela com idClasse=-353, dEntidadeId=listId (ou spaceId),
// conteúdo rico em dados.content (JSON com blocos tipo ProseMirror/Slate).
// Não é tabela nova — cabe em DTabela Pilar 2 ativo.
esp(-353, 'DOC', 'Documento rico (conteudo em dados.content)', -51),
```

**DoD da Fase A1:**
- [ ] `prisma/seeds/classes.seed.ts` tem 6 novas entradas
- [ ] `validateHierarchy()` passa sem erro em tempo de import
- [ ] `COUNTS.especificas` vai de 98 para 104; `COUNTS.total` vai de 143 para 149
- [ ] `npx prisma db seed` executa sem erro
- [ ] Nenhuma chave positiva ou sequestro de canônica (-1..-110)

**Estimativa:** 4-6 horas

---

### Fase A2 — Migration do Schema DProject (ADR-V2-051)

**Objetivo:** Adicionar `idPai BigInt?` e `privado Boolean @default(false)` ao model DProject.

**ATENÇÃO:** Esta fase é o maior risco do projeto. Migration em tabela existente com dados.
Protocolo obrigatório: backup antes, migration down testada, cutover zero-downtime.

**Arquivos a modificar:**
- `prisma/schema.prisma` — adicionar campos ao model DProject
- `prisma/migrations/[timestamp]_add_hierarchy_dproject/migration.sql` — gerado automaticamente

**Alterações no schema:**

```prisma
model DProject {
  chave     BigInt  @id @default(autoincrement())
  idClasse  BigInt
  idEstab   BigInt? // organização pai (tenant)
  nome      String  @db.VarChar(255)
  descricao String? @db.Text
  repoUrl   String? @db.VarChar(512)
  dados     Json?

  // ADR-V2-051: hierarquia self-referencial Space→Folder→List
  // Restrições de profundidade validadas no service (não no schema).
  // CTE anti-ciclo executada ANTES de qualquer UPDATE idPai.
  // Cascade soft-delete: bottom-up em transaction (List → Folder → Space).
  idPai   BigInt?  // FK para DProject pai (Space contém Folders; Folder contém Lists)
  privado Boolean  @default(false) // Space público = org inteira; privado = DVincula -188

  excluido     Boolean  @default(false)
  criadoEm     DateTime @default(now()) @db.Timestamptz(6)
  atualizadoEm DateTime @default(now()) @updatedAt @db.Timestamptz(6)

  // Self-relations
  pai      DProject?  @relation("ProjectHierarchy", fields: [idPai], references: [chave], onDelete: NoAction, onUpdate: NoAction)
  filhos   DProject[] @relation("ProjectHierarchy")

  classe DClasse    @relation(fields: [idClasse], references: [chave], onDelete: NoAction, onUpdate: NoAction)
  estab  DEntidade? @relation("ProjectEstab", fields: [idEstab], references: [chave], onDelete: NoAction, onUpdate: NoAction)
  tasks  DTask[]

  @@index([idClasse])
  @@index([idEstab])
  @@index([idPai])                    // índice novo — queries de filhos
  @@index([excluido, idEstab])
  @@index([excluido, idPai])          // índice novo — queries de filhos ativos
}
```

**Migration SQL (gerada pelo Prisma):**

```sql
-- Migration up
ALTER TABLE "DProject"
  ADD COLUMN "idPai" BIGINT,
  ADD COLUMN "privado" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "DProject"
  ADD CONSTRAINT "DProject_idPai_fkey"
  FOREIGN KEY ("idPai") REFERENCES "DProject"("chave")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "DProject_idPai_idx" ON "DProject"("idPai");
CREATE INDEX "DProject_excluido_idPai_idx" ON "DProject"("excluido", "idPai");
```

**Migration down:**

```sql
-- Migration down
DROP INDEX IF EXISTS "DProject_excluido_idPai_idx";
DROP INDEX IF EXISTS "DProject_idPai_idx";
ALTER TABLE "DProject" DROP CONSTRAINT IF EXISTS "DProject_idPai_fkey";
ALTER TABLE "DProject" DROP COLUMN IF EXISTS "idPai";
ALTER TABLE "DProject" DROP COLUMN IF EXISTS "privado";
```

**Verificação de dados existentes:**
- Projetos existentes: `idPai = NULL` (são "raiz" por padrão — neutros até serem migrados)
- `privado = false` (todos públicos por padrão — sem quebrar RBAC existente)
- Migration é aditiva — não quebra dados existentes

**DoD da Fase A2:**
- [ ] `npx prisma migrate dev` gera a migration sem erro
- [ ] `npx prisma migrate deploy` aplica em banco de test
- [ ] Migration down funciona (rollback restaura estado anterior)
- [ ] Dados existentes não foram alterados (`idPai IS NULL`, `privado = false`)
- [ ] Índices criados (verificar via `\d "DProject"` no psql)
- [ ] `make build` passa sem erro

**Estimativa:** 4-8 horas

---

### Fase A3 — Validação Anti-Ciclo + Cascade Soft-Delete (ADR-V2-051 §12)

**Objetivo:** Implementar as 3 pré-condições não-negociáveis do ADR-V2-051.

**Arquivos a criar/modificar:**
- `src/projects/utils/anti-cycle.util.ts` — função pura de validação CTE
- `src/projects/projects.service.ts` — usar validação no `update()`
- `src/projects/projects.service.ts` — cascade delete atualizado para bottom-up hierárquico

**Anti-ciclo via CTE PostgreSQL:**

```typescript
// src/projects/utils/anti-cycle.util.ts

/**
 * Valida que definir idPai=novoPaiId no projeto targetId não cria ciclo.
 *
 * Usa CTE recursivo do PostgreSQL para traversar a árvore de ancestrais
 * do novoPaiId e verifica se targetId aparece como ancestral (ciclo).
 *
 * Deve ser chamado ANTES de qualquer UPDATE de idPai.
 * Se criar ciclo → lança BadRequestException.
 *
 * @param prisma - PrismaService (ou tx client)
 * @param targetId - projeto sendo movido
 * @param novoPaiId - novo pai proposto (ou null para remover da hierarquia)
 * @throws {BadRequestException} se o novo pai é descendente de targetId
 */
export async function validateNoCycle(
  prisma: PrismaService | Prisma.TransactionClient,
  targetId: bigint,
  novoPaiId: bigint | null,
): Promise<void> {
  if (novoPaiId === null) return; // sem pai = sem ciclo
  if (novoPaiId === targetId) {
    throw new BadRequestException('Um projeto não pode ser pai de si mesmo');
  }

  // CTE recursivo: encontra todos os ancestrais de novoPaiId.
  // Se targetId aparece na lista → ciclo detectado.
  const result = await (prisma as PrismaService).$queryRaw<Array<{ chave: bigint }>>`
    WITH RECURSIVE ancestors AS (
      SELECT "chave", "idPai"
      FROM "DProject"
      WHERE "chave" = ${novoPaiId} AND "excluido" = false

      UNION ALL

      SELECT p."chave", p."idPai"
      FROM "DProject" p
      INNER JOIN ancestors a ON p."chave" = a."idPai"
      WHERE p."excluido" = false
    )
    SELECT "chave" FROM ancestors WHERE "chave" = ${targetId}
  `;

  if (result.length > 0) {
    throw new BadRequestException(
      'Operação criaria ciclo na hierarquia de projetos. ' +
      'O projeto de destino é descendente do projeto sendo movido.',
    );
  }
}
```

**Cascade soft-delete bottom-up:**

```typescript
// Adição ao ProjectsService.delete() — apaga hierarquia bottom-up

private async cascadeDeleteHierarchy(
  tx: Prisma.TransactionClient,
  projectId: bigint,
): Promise<{ tasks: number; members: number; subProjects: number }> {
  // 1. Buscar todos os filhos diretos (Lists se projectId é Folder;
  //    Folders+Lists se projectId é Space)
  const children = await tx.dProject.findMany({
    where: { idPai: projectId, excluido: false },
    select: { chave: true },
  });

  let totalTasks = 0;
  let totalMembers = 0;
  let totalSubProjects = children.length;

  // 2. Recursão: deletar bottom-up
  for (const child of children) {
    const childCounts = await this.cascadeDeleteHierarchy(tx, child.chave);
    totalTasks += childCounts.tasks;
    totalMembers += childCounts.members;
    totalSubProjects += childCounts.subProjects;
  }

  // 3. Deletar tasks do projeto atual
  const tasksResult = await tx.dTask.updateMany({
    where: { idProject: projectId, excluido: false },
    data: { excluido: true },
  });
  totalTasks += tasksResult.count;

  // 4. Deletar memberships (DVincula project roles + SPACE_PRIVATE_MEMBER)
  const membersResult = await tx.dVincula.updateMany({
    where: { idLocEscritu: projectId, excluido: false },
    data: { excluido: true },
  });
  totalMembers += membersResult.count;

  // 5. Soft-delete DVincula de folder/space links (onde projeto é filho)
  await tx.dVincula.updateMany({
    where: { idEntidade: projectId, excluido: false },
    data: { excluido: true },
  });

  // 6. Soft-delete do projeto em si
  await tx.dProject.update({
    where: { chave: projectId },
    data: { excluido: true },
  });

  return { tasks: totalTasks, members: totalMembers, subProjects: totalSubProjects };
}
```

**Pré-condição seedBootstrap condicional (ADR-V2-051 §12):**

```typescript
// SeedBootstrapService — só faz seed para LIST (não para SPACE/FOLDER)
// Motivo: SPACE e FOLDER não têm tasks diretamente; apenas LIST contém tasks.
// Seeds (9 statuses V3 + 1 sprint default) só fazem sentido para LIST.

async seedProject(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  idClasse: bigint,         // -350 SPACE, -351 FOLDER, -352 LIST
): Promise<void> {
  const ID_CLASSE_LIST = BigInt(-352);

  // ADR-V2-051 §12: seed condicional — apenas LIST recebe statuses + sprint
  if (idClasse !== ID_CLASSE_LIST) {
    this.logger.debug(
      `seedBootstrap: projeto ${projectId} idClasse=${idClasse} nao e LIST — skip seed`,
    );
    return;
  }

  // Seed os 9 statuses V3 e 1 sprint default (lógica existente)
  await this.seedStatuses(tx, projectId);
  await this.seedDefaultSprint(tx, projectId);
}
```

**DoD da Fase A3:**
- [ ] `validateNoCycle()` testada com: caso sem ciclo, auto-referência, ciclo profundo (A→B→C→A)
- [ ] `cascadeDeleteHierarchy()` testada com Space com 2 Folders, cada um com 2 Lists
- [ ] `seedBootstrap` condicional: SPACE e FOLDER retornam sem criar DTabela
- [ ] `make build` passa
- [ ] Testes unit cobrindo os 3 cenários

**Estimativa:** 8-12 horas

---

## 6. BLOCO B — AUTENTICAÇÃO REAL

**Objetivo:** Substituir mock de auth no frontend por chamadas reais ao backend.
**Dependências:** Bloco A concluído
**Resultado visual:** Login e register funcionando com dados reais
**Duração estimada:** 0.5-1 semana

### Fase B1 — Conexão do Frontend ao Auth Backend

**Objetivo:** Trocar `NEXT_PUBLIC_MOCK_AUTH=true` por chamadas reais.

**Arquivos a modificar (frontend):**
- `src/lib/api.ts` — verificar base URL e interceptors de JWT
- `src/hooks/use-auth.ts` — remover condicional de mock, usar chamadas reais
- `src/lib/stores/auth.ts` — ajustar persistência de tokens (accessToken, refreshToken, user)
- `.env.local` do frontend — `NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1`

**Contrato de autenticação (backend V2 — não alterar):**

```
POST /auth/login
Body:  { email: string, password: string }
200:   { accessToken: string, refreshToken: string, user: { id, name, email, organizationId, entidadeId } }

POST /auth/register
Body:  { name: string, email: string, password: string, orgName: string }
201:   { accessToken: string, refreshToken: string, user: { ... } }

POST /auth/refresh
Body:  { refreshToken: string }
200:   { accessToken: string, refreshToken: string }

POST /auth/logout
Headers: Authorization: Bearer {token}
200:   { message: "Logout realizado com sucesso" }
```

**Pontos de atenção:**
- O JWT payload do V2 inclui `entidadeId` (DEntidade.chave) e `organizationId` (org ativa)
- O frontend atual pode usar apenas `id` — precisará mapear `entidadeId`
- `organizationId` é crítico para multi-tenant (filtra DProject.idEstab)
- Refresh automático: `api.ts` já tem interceptor para renovar token — verificar se chama `/auth/refresh` corretamente

**DoD da Fase B1:**
- [ ] Login funciona com usuário real do banco local
- [ ] Register cria usuário, org e retorna tokens
- [ ] Logout invalida tokens no backend
- [ ] Refresh automático funciona (token expirado → renova transparente)
- [ ] `organizationId` está no store de auth
- [ ] MOCK_AUTH=false não quebra nada

**Estimativa:** 4-6 horas

---

### Fase B2 — Workspace Switcher e Multi-Org

**Objetivo:** Conectar o seletor de organização ao endpoint de switch-org.

**Contrato (backend V2):**

```
GET /auth/me
Headers: Authorization: Bearer {token}
200: { id, name, email, entidadeId, organizationId, organizations: [{ id, name }] }

POST /auth/switch-org
Body: { organizationId: string }
200: { accessToken: string, refreshToken: string, user: { ..., organizationId: novo } }
```

**Arquivos a modificar (frontend):**
- `src/components/shell/workspace-switcher.tsx` — buscar orgs de `GET /auth/me` e trocar org
- `src/lib/stores/auth.ts` — atualizar `organizationId` ao trocar org

**DoD da Fase B2:**
- [ ] Workspace switcher lista organizações reais do usuário
- [ ] Trocar de org atualiza o token e recarrega dados filtrados pela nova org
- [ ] Segundo login com outro usuário de outra org não vaza dados

**Estimativa:** 3-5 horas

---

## 7. BLOCO C — SPACES, FOLDERS, LISTS

**Objetivo:** CRUD completo da hierarquia Space→Folder→List no backend e sidebar real no frontend.
**Dependências:** Bloco A COMPLETO
**Resultado visual:** Sidebar com espaços, pastas e listas reais
**Duração estimada:** 3-4 semanas

### Fase C1 — Extensão do ProjectsService para Hierarquia

**Objetivo:** Adicionar lógica de Space/Folder/List ao `ProjectsService` existente.

**Arquivos a modificar:**
- `src/projects/projects.service.ts` — CRUD com tipo discriminado por `idClasse`
- `src/projects/dto/create-project.dto.ts` — adicionar `type: 'space' | 'folder' | 'list'` e `parentId?`
- `src/projects/dto/project-response.dto.ts` — adicionar `type`, `parentId`, `privado`, `childCount`
- `src/projects/projects.controller.ts` — adicionar query param `?type=space&parentId=X`

**Constantes de DClasse a adicionar no service:**

```typescript
const ID_CLASSE_SPACE  = BigInt(-350);  // ADR-V2-051
const ID_CLASSE_FOLDER = BigInt(-351);  // ADR-V2-051
const ID_CLASSE_LIST   = BigInt(-352);  // ADR-V2-051

/** Mapa string → DClasse para criação tipada */
const PROJECT_TYPE_TO_CLASSE: Record<string, bigint> = {
  space:  ID_CLASSE_SPACE,
  folder: ID_CLASSE_FOLDER,
  list:   ID_CLASSE_LIST,
};

/** Mapa DClasse → string para response */
const CLASSE_TO_PROJECT_TYPE: Record<string, string> = {
  '-350': 'space',
  '-351': 'folder',
  '-352': 'list',
  '-153': 'project', // projetos legados SCRUMBAN_PROJECT
};
```

**Regras de negócio no service (validar antes de qualquer INSERT/UPDATE):**

```typescript
// Validação de hierarquia antes de criar ou mover
private validateHierarchyRule(
  parentType: string | null,
  childType: string,
): void {
  const rules: Record<string, string[]> = {
    space:  ['folder', 'list'],  // Space pode conter Folder ou List diretamente
    folder: ['list'],            // Folder pode conter apenas List
    list:   [],                  // List não pode conter sub-List (apenas Tasks)
  };

  if (parentType === null && childType !== 'space') {
    // Somente Space pode existir na raiz (sem pai)
    // EXCEÇÃO: projetos legados (idClasse=-153) ficam na raiz
    return; // permitir para compatibilidade
  }

  if (parentType && !rules[parentType]?.includes(childType)) {
    throw new BadRequestException(
      `Um ${parentType} não pode conter um ${childType}. ` +
      `Regras: Space→Folder/List; Folder→List; List→(sem filhos de projeto)`,
    );
  }
}
```

**Novos endpoints no ProjectsController:**

```typescript
// Listar espaços do usuário na org
GET /projects?type=space&organizationId={orgId}

// Listar filhos de um projeto (folders de um space, lists de um folder)
GET /projects?parentId={spaceOrFolderId}

// Criar space
POST /projects
Body: { type: 'space', nome: 'Marketing', privado: false, orgId: '...' }

// Criar folder dentro de space
POST /projects
Body: { type: 'folder', nome: 'Q1 2026', parentId: '{spaceId}' }

// Criar list dentro de folder (ou diretamente em space)
POST /projects
Body: { type: 'list', nome: 'Backlog', parentId: '{folderId}' }
```

**DoD da Fase C1:**
- [ ] `POST /projects` com `type=space` cria DProject idClasse=-350 sem pai, com seed condicional=skip
- [ ] `POST /projects` com `type=folder,parentId=X` cria DProject idClasse=-351 com pai=X, seed=skip
- [ ] `POST /projects` com `type=list,parentId=X` cria DProject idClasse=-352 com pai=X, seed=9 statuses + 1 sprint
- [ ] Hierarquia Folder dentro de Folder → `BadRequestException`
- [ ] Lista dentro de Lista → `BadRequestException`
- [ ] `GET /projects?type=space` retorna apenas spaces da org do JWT
- [ ] `GET /projects?parentId={id}` retorna apenas filhos diretos
- [ ] `DELETE /projects/:id` faz cascade bottom-up (usa `cascadeDeleteHierarchy`)
- [ ] Anti-ciclo: `validateNoCycle()` chamada no `update()` quando `parentId` muda
- [ ] Testes unit e integration cobrindo todos os casos

**Estimativa:** 1.5-2 semanas

---

### Fase C2 — Permissões de Space (Público vs Privado)

**Objetivo:** Implementar controle de acesso por Space: público = org inteira; privado = apenas membros explícitos.

**Regras (ADR-V2-051 §6):**
- `Space.privado = false` → qualquer membro da org pode ver o Space e seus conteúdos
- `Space.privado = true` → apenas usuários com DVincula -188 (SPACE_PRIVATE_MEMBER) têm acesso
- Permissões são por Space apenas — Folders e Lists herdam do Space pai

**Arquivos a modificar:**
- `src/auth/guards/project-scope.guard.ts` — verificar privacidade do Space raiz
- `src/projects/project-members.service.ts` — adicionar `addPrivateMember()` e `removePrivateMember()`
- `src/projects/projects.controller.ts` — `GET /projects/:id/private-members` e `POST /projects/:id/private-members`

**Lógica do guard atualizado:**

```typescript
// ProjectScopeGuard — adicionando verificação de Space privado
async canActivate(context: ExecutionContext): Promise<boolean> {
  // ... lógica existente de JWT/ApiKey ...

  // Verificar se o projeto (ou seu Space raiz) é privado
  const rootSpaceId = await this.projectsService.findRootSpace(projectBigInt);
  if (rootSpaceId !== null) {
    const isPrivate = await this.prisma.dProject.findFirst({
      where: { chave: rootSpaceId, privado: true },
      select: { chave: true },
    });

    if (isPrivate) {
      // Space privado: verificar DVincula -188
      const privateMember = await this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: rootSpaceId,
          idEntidade: userId,
          idClasse: BigInt(-188), // SPACE_PRIVATE_MEMBER
          excluido: false,
        },
      });
      if (!privateMember) {
        throw new ForbiddenException('Space privado: acesso restrito a membros');
      }
    }
  }

  // Checar membership no projeto em si (lógica existente)
  // ...
}
```

**DoD da Fase C2:**
- [ ] Space público: qualquer org-member acessa sem DVincula -188
- [ ] Space privado: apenas DVincula -188 acessa
- [ ] `POST /projects/:id/private-members` adiciona membro a Space privado
- [ ] Folders e Lists herdam privacidade do Space raiz

**Estimativa:** 8-12 horas

---

### Fase C3 — Sidebar do Frontend com Dados Reais

**Objetivo:** Conectar a sidebar do frontend à hierarquia real do backend.

**Arquivos a modificar (frontend):**
- `src/components/shell/app-shell.tsx` — trocar mock `entidades` por `useSpaces()`
- `src/hooks/use-spaces.ts` — criar hook (ou rename de `use-projects.ts`)
- `src/lib/types/api.ts` — adicionar tipos `SpaceDto`, `FolderDto`, `ListDto`
- `src/lib/api.ts` — adicionar funções `getSpaces()`, `getFolders(spaceId)`, `getLists(folderId)`

**Estrutura de tipo esperada no frontend:**

```typescript
// src/lib/types/api.ts — novos tipos alinhados com backend
export interface SpaceDto {
  id: string;
  type: 'space';
  nome: string;
  privado: boolean;
  orgId: string;
  childCount: number;
  criadoEm: string;
  atualizadoEm: string;
}

export interface FolderDto {
  id: string;
  type: 'folder';
  nome: string;
  parentId: string; // spaceId
  childCount: number;
  criadoEm: string;
  atualizadoEm: string;
}

export interface ListDto {
  id: string;
  type: 'list';
  nome: string;
  parentId: string; // folderId ou spaceId
  memberCount: number;
  repoUrl?: string | null;
  criadoEm: string;
  atualizadoEm: string;
}
```

**Padrão de fetch lazy (sidebar não carrega tudo de uma vez):**

```typescript
// Sidebar: carrega Spaces ao iniciar; carrega Folders ao expandir Space;
// carrega Lists ao expandir Folder.
// Evita N+1: cada nível faz 1 query apenas quando o nó é expandido.

// Fase 1: GET /projects?type=space  → lista de SpaceDto
// Fase 2: GET /projects?parentId={spaceId} → lista de FolderDto
// Fase 3: GET /projects?parentId={folderId} → lista de ListDto
```

**DoD da Fase C3:**
- [ ] Sidebar exibe Spaces reais da org do JWT
- [ ] Expandir Space carrega Folders reais
- [ ] Expandir Folder carrega Lists reais
- [ ] Criar Space/Folder/List via modal chama o backend real
- [ ] Excluir item faz soft-delete e atualiza sidebar

**Estimativa:** 1-1.5 semanas

---

### Fase C4 — Página de Space e Folder (routes `/spaces/[id]` e `/folders/[id]`)

**Objetivo:** Conectar as páginas de detalhe de Space e Folder ao backend.

**Arquivos a modificar (frontend):**
- `src/app/(app)/spaces/[id]/page.tsx` — carregar dados reais do Space + filhos
- `src/app/(app)/folders/[id]/page.tsx` — carregar dados reais da Folder + listas
- `src/app/(app)/lists/[id]/page.tsx` — carregar tasks da List (ver Bloco D)

**Dados necessários por página:**

```
/spaces/[id]:
  GET /projects/:id                          → SpaceDto
  GET /projects?parentId={id}&type=folder   → FolderDto[]
  GET /projects/:id/members                 → membros
  GET /projects/:id/activity               → timeline

/folders/[id]:
  GET /projects/:id                          → FolderDto
  GET /projects?parentId={id}&type=list     → ListDto[]
  GET /projects/:id/members                 → membros (herdados do Space)
```

**DoD da Fase C4:**
- [ ] `/spaces/[id]` exibe nome, membros, folders reais
- [ ] `/folders/[id]` exibe nome e lists reais
- [ ] Navegação breadcrumb Space → Folder → List funciona
- [ ] Indicador visual de Space privado na sidebar e na página

**Estimativa:** 3-5 dias

---

## 8. BLOCO D — TASKS E STATUS V3

**Objetivo:** Tasks reais com dueDate canônico, Kanban conectado, status V3 mapeado.
**Dependências:** Bloco A + Bloco C (listas precisam existir antes das tasks)
**Resultado visual:** Kanban board funcional com tasks reais
**Duração estimada:** 2-3 semanas

### Fase D1 — Campo `dueDate` Canônico em DTask (GAP-01)

**Objetivo:** Adicionar `dueDate` como campo tipado em DTask (não em `dados` JSON).

**DECISÃO ARQUITETURAL:** `dueDate` vai como coluna tipada `DateTime?` em DTask.
Motivo: campo central de UX (filtragem, ordenação, `/today`, `/planner`).
Colocar em `dados` JSON não permite índice eficiente e quebra queries Prisma.

**Arquivos a modificar:**
- `prisma/schema.prisma` — adicionar `dueDate DateTime? @db.Timestamptz(6)` em DTask
- `prisma/migrations/[timestamp]_add_due_date_dtask/migration.sql`
- `src/tasks/dto/create-task.dto.ts` — adicionar `dueDate?: string` (ISO 8601)
- `src/tasks/dto/update-task.dto.ts` — adicionar `dueDate?: string | null`
- `src/tasks/dto/task-response.dto.ts` — adicionar `dueDate: string | null`
- `src/tasks/tasks.service.ts` — persistir `dueDate` no CRUD
- `src/tasks/dto/list-tasks-query.dto.ts` — adicionar filtros `dueDateFrom`, `dueDateTo`, `dueDateToday`

**Migration SQL:**

```sql
-- Migration up
ALTER TABLE "DTask"
  ADD COLUMN "dueDate" TIMESTAMPTZ;

CREATE INDEX "DTask_dueDate_idx" ON "DTask"("dueDate") WHERE "excluido" = false AND "dueDate" IS NOT NULL;
```

**Migration down:**

```sql
-- Migration down
DROP INDEX IF EXISTS "DTask_dueDate_idx";
ALTER TABLE "DTask" DROP COLUMN IF EXISTS "dueDate";
```

**Query para `/today`:**

```typescript
// src/tasks/tasks.service.ts — método listTodayTasks()
async listTodayTasks(
  userEntidadeId: bigint,
  timezone: string = 'America/Sao_Paulo',
): Promise<ListTasksResponseDto> {
  const now = new Date();

  // Início e fim do dia no timezone do usuário
  const startOfToday = this.timezoneService.toStartOfDayBrazil(now);
  const endOfToday = this.timezoneService.toEndOfDayBrazil(now);

  return this.prisma.dTask.findMany({
    where: {
      idAssignee: userEntidadeId,
      excluido: false,
      OR: [
        // Tasks com dueDate de hoje
        { dueDate: { gte: startOfToday, lte: endOfToday } },
        // Tasks atrasadas (dueDate passado e ainda não concluídas)
        {
          dueDate: { lt: startOfToday },
          idStatus: { notIn: [BigInt(-444), BigInt(-449)] }, // não DONE/VALIDATED
        },
      ],
    },
    // ... include e orderBy
  });
}
```

**DoD da Fase D1:**
- [ ] `dueDate` persiste como DateTime no Prisma (não em `dados` JSON)
- [ ] `POST /tasks` aceita `dueDate` ISO 8601
- [ ] `PATCH /tasks/:id` aceita `dueDate: null` para remover
- [ ] `GET /tasks?dueDateToday=true` retorna tasks de hoje + atrasadas
- [ ] `GET /tasks?dueDateFrom=2026-01-01&dueDateTo=2026-01-31` funciona
- [ ] Índice criado em `DTask.dueDate`

**Estimativa:** 6-10 horas

---

### Fase D2 — Mapper V3 Intentions → StatusTarefa Frontend (GAP-02)

**Objetivo:** Criar camada de mapeamento no frontend para traduzir V3 Intentions.

**Arquivos a criar/modificar (frontend):**
- `src/lib/mappers/task-status.mapper.ts` — funções de mapeamento bidireccional
- `src/lib/types/api.ts` — adicionar tipo `V3Intention` e `StatusTarefaUX`
- `src/lib/types/tarefa.ts` — substituir por `TaskResponseDto` do backend

**Mapper canônico:**

```typescript
// src/lib/mappers/task-status.mapper.ts

export type V3Intention =
  | 'INBOX' | 'READY' | 'EXECUTING' | 'DONE'
  | 'FAILED' | 'CANCELLED' | 'DISCARDED' | 'VALIDATING' | 'VALIDATED';

export type StatusTarefaUX = 'em-progresso' | 'pendente' | 'concluido' | 'atrasado' | 'bloqueado';

/**
 * Mapeia V3 Intention do backend para StatusTarefa da UX do frontend.
 * "atrasado" é calculado externamente (depende de dueDate), não retornado aqui.
 */
export function v3ToUx(intention: V3Intention): StatusTarefaUX {
  const map: Record<V3Intention, StatusTarefaUX> = {
    INBOX:      'pendente',
    READY:      'pendente',
    EXECUTING:  'em-progresso',
    VALIDATING: 'em-progresso',
    DONE:       'concluido',
    VALIDATED:  'concluido',
    FAILED:     'bloqueado',
    CANCELLED:  'concluido',  // UX: aparece como concluído negativo (cor diferente)
    DISCARDED:  'concluido',  // UX: aparece como concluído negativo
  };
  return map[intention];
}

/**
 * Mapeia prioridade do backend para label da UX.
 */
export function priorityToUx(priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'): string {
  const map = { LOW: 'baixa', MEDIUM: 'media', HIGH: 'alta', URGENT: 'urgente' };
  return map[priority];
}

/**
 * Verifica se task está atrasada (calculado em runtime).
 */
export function isOverdue(dueDate: string | null, intention: V3Intention): boolean {
  if (!dueDate) return false;
  const terminalStates: V3Intention[] = ['DONE', 'VALIDATED', 'CANCELLED', 'DISCARDED', 'FAILED'];
  if (terminalStates.includes(intention)) return false;
  return new Date(dueDate) < new Date();
}
```

**DoD da Fase D2:**
- [ ] `task-status.mapper.ts` implementado e com testes
- [ ] Todos os componentes de task usam o mapper (não string hardcoded)
- [ ] "atrasado" é calculado via `isOverdue()` — não vem do backend
- [ ] Kanban board aceita todas as 9 V3 Intentions (não apenas 5)

**Estimativa:** 4-6 horas

---

### Fase D3 — Tasks Reais em `/tasks/*` e Kanban

**Objetivo:** Substituir mocks de tasks por dados reais do backend.

**Arquivos a modificar (frontend):**
- `src/lib/mocks/tarefas.ts` — marcar como deprecated, não usar em prod
- `src/hooks/use-tasks.ts` — conectar a `GET /tasks?projectId=X&assigneeId=Y`
- `src/components/tasks/kanban-board.tsx` — usar TaskResponseDto real
- `src/app/(app)/tasks/page.tsx` — trocar store por hook de API
- `src/app/(app)/tasks/in-progress/page.tsx` — filtrar por EXECUTING/VALIDATING
- `src/app/(app)/tasks/pending/page.tsx` — filtrar por INBOX/READY
- `src/app/(app)/tasks/done/page.tsx` — filtrar por DONE/VALIDATED

**Contrato TaskResponseDto (backend V2 — não alterar):**

```typescript
interface TaskResponseDto {
  id: string;             // DTask.chave
  identifier: string;     // DEV-N
  title: string;          // DTask.titulo
  description?: string;   // DTask.descricao
  status: string;         // nome do status (ex: 'INBOX')
  statusId: string;       // DTabela.chave do status (runtime)
  priority?: string;      // 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  priorityId?: string;    // DTabela.chave da priority (runtime)
  projectId: string;      // DProject.chave (deve ser LIST)
  assigneeId?: string;    // DEntidade.chave do responsável
  idPai?: string;         // DTask.chave da fase pai (ADR-V2-047)
  dueDate?: string;       // ISO 8601 (Fase D1)
  criadoEm: string;
  atualizadoEm: string;
}
```

**Fluxo de criação de task (frontend → backend):**

```
1. Usuário abre List (/lists/[id])
2. Clica "Nova Task"
3. Frontend chama POST /tasks:
   Body: {
     titulo: "Implementar auth",
     idProject: "{listId}",       // sempre LIST
     priority: "HIGH",
     dueDate: "2026-06-15",
     assigneeId: "{userId}"
   }
4. Backend cria DTask com idClasse=-154 (SCRUMBAN_TASK)
5. Backend gera identifier DEV-N atômico
6. Backend emite DEvento -497 (TASK_CREATED)
7. Frontend recebe TaskResponseDto e atualiza o kanban
```

**DoD da Fase D3:**
- [ ] `/tasks` lista tasks reais onde `assigneeId = user.entidadeId`
- [ ] Filtros por status funcionam (INBOX, READY, EXECUTING, etc.)
- [ ] Kanban exibe colunas por V3 Intention (9 colunas ou agrupadas em UX)
- [ ] Drag-and-drop no kanban chama `PATCH /tasks/:id/status`
- [ ] Criar task no kanban chama `POST /tasks` com `idProject = listId`
- [ ] Task com `dueDate` passado exibe badge "atrasado"

**Estimativa:** 1-1.5 semanas

---

### Fase D4 — Detalhe de Task e Edição Inline

**Objetivo:** Modal/drawer de task com edição de todos os campos conectados ao backend.

**Arquivos a modificar (frontend):**
- `src/components/tasks/task-detail.tsx` (ou equivalente) — conectar aos endpoints PATCH
- `src/components/tasks/task-assignee-picker.tsx` — buscar membros de `GET /projects/:id/members`
- `src/components/tasks/task-status-picker.tsx` — buscar statuses de `GET /workflow-statuses?projectId=X`
- `src/components/tasks/task-priority-picker.tsx` — usar enum hardcoded (LOW/MEDIUM/HIGH/URGENT)

**Contrato de atualização:**

```
PATCH /tasks/:id
Body: {
  titulo?: string,
  descricao?: string,
  assigneeId?: string | null,
  dueDate?: string | null,
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
}

PATCH /tasks/:id/status
Body: { status: 'EXECUTING' | 'DONE' | ... }
```

**DoD da Fase D4:**
- [ ] Clicar na task abre drawer com dados reais
- [ ] Editar título, descrição, assignee, dueDate salva no backend
- [ ] Mudar status via dropdown respeita state machine V3 (transitions válidas)
- [ ] Delete de task faz soft-delete e remove do kanban
- [ ] Atribuir a si mesmo funciona (`assigneeId = req.user.entidadeId`)

**Estimativa:** 1 semana

---

### Fase D5 — `/lists/[id]` — View da List

**Objetivo:** Página de List com Kanban e List view toggling.

**Arquivos a modificar (frontend):**
- `src/app/(app)/lists/[id]/page.tsx` — carregar List info + tasks reais
- `src/components/tasks/list-view.tsx` (se existir) — usar dados reais
- Breadcrumb: Space → Folder → List

**Dados necessários:**

```
GET /projects/:listId                    → ListDto (nome, membros)
GET /tasks?projectId={listId}            → TaskResponseDto[]
GET /workflow-statuses?projectId={listId} → colunas do kanban
```

**DoD da Fase D5:**
- [ ] `/lists/[id]` exibe kanban com tasks reais da List
- [ ] Toggle entre Kanban view e List view funciona
- [ ] Breadcrumb navega corretamente

**Estimativa:** 3-5 dias

---

## 9. BLOCO E — TEAMS, MEMBERS, INVITES

**Objetivo:** Página `/teams` e gestão de membros de Space conectados ao backend.
**Dependências:** Bloco B (auth) + Bloco A (seed)
**Resultado visual:** Times com membros reais
**Duração estimada:** 1-2 semanas

### Fase E1 — Página `/teams` com Dados Reais

**Objetivo:** Substituir carousel estático de times por dados reais.

**Arquivos a modificar (frontend):**
- `src/app/(app)/teams/page.tsx` — trocar mock por `useTeams()`
- `src/hooks/use-teams.ts` — criar hook conectado a `GET /teams`
- `src/components/teams/team-card.tsx` — usar TeamDto real

**Contrato:**

```
GET /teams?organizationId={orgId}
200: [{ id, nome, memberCount, leadId, criadoEm }]

GET /teams/:id/members
200: [{ userId, entidadeId, nome, email, cargo: 'LEAD' | 'MEMBER' }]
```

**DoD da Fase E1:**
- [ ] `/teams` lista times reais da org ativa
- [ ] Expandir time mostra membros reais
- [ ] Criar time via modal chama `POST /teams`
- [ ] Adicionar membro ao time chama `POST /teams/:id/members`

**Estimativa:** 3-5 dias

---

### Fase E2 — Membros de Space e Convites

**Objetivo:** Gestão de membros de Space + Invites via email.

**Arquivos a modificar (frontend):**
- `src/app/(app)/spaces/[id]/page.tsx` — tab de membros do Space
- `src/components/invites/invite-modal.tsx` — trocar mock por `POST /invites`

**Contrato:**

```
GET /projects/:id/members
200: [{ userId, entidadeId, nome, email, role: 'MANAGER' | 'MEMBER' | 'VIEWER' }]

POST /invites
Body: { email: string, orgId: string, projectId?: string, role: 'MEMBER' | 'VIEWER' }
201: { inviteId, token, expiresAt }

POST /invites/:token/accept
200: { message: 'Convite aceito' }
```

**DoD da Fase E2:**
- [ ] Tab membros do Space exibe membros reais com roles
- [ ] Botão "Convidar" abre modal e envia convite real por email
- [ ] Email de convite chega com link funcional
- [ ] Aceitar convite cria DVincula e redireciona para o Space

**Estimativa:** 4-6 dias

---

### Fase E3 — Sprint Progress Calculado (GAP-05)

**Objetivo:** `/sprints` com status calculado e progresso de tasks.

**Arquivos a modificar:**
- `src/sprints/sprints.service.ts` — adicionar contagem de tasks por sprint
- `src/sprints/dto/sprint-response.dto.ts` — adicionar `taskCount`, `doneCount`, `progress`

**Query de progresso:**

```typescript
// SprintsService — adicionando progresso calculado
async findManyWithProgress(
  projectId: bigint,
): Promise<SprintResponseDto[]> {
  const [sprints, taskCounts] = await Promise.all([
    this.prisma.dTabela.findMany({
      where: { idClasse: BigInt(-400), dEntidadeId: projectId, excluido: false },
    }),
    this.prisma.dTask.groupBy({
      by: ['idSprint'],
      where: { idProject: projectId, excluido: false },
      _count: { chave: true },
    }),
    // ... separar DONE/VALIDATED por sprint
  ]);
  // ... buildResponse com progress
}
```

**DoD da Fase E3:**
- [ ] `GET /sprints?projectId=X` retorna `{ ..., taskCount: N, doneCount: M, progress: 0.75 }`
- [ ] `/sprints` exibe barra de progresso real
- [ ] Sprint "ativo" é inferido via `metaDados.active = true` ou `metaDados.status`

**Estimativa:** 4-6 horas

---

## 10. BLOCO F — AGENTS E EXECUÇÕES

**Objetivo:** Página `/ia` (aba Agentes) conectada ao backend real.
**Dependências:** Bloco B (auth)
**Resultado visual:** Lista de agents VPS com status real
**Duração estimada:** 1-2 semanas

### Fase F1 — Hook `useAgents` Real (trocar localStorage)

**Objetivo:** Substituir mock de localStorage por chamadas reais a `/agents`.

**Arquivos a modificar (frontend):**
- `src/hooks/use-agents.ts` — trocar mock por `api.get('/agents')`
- `src/components/ia/agents-tab.tsx` — usar AgentListItemDto real
- `src/lib/types/api.ts` — atualizar `AgentDto` para espelhar `AgentListItemDto`

**Contrato (backend V2):**

```
GET /agents?organizationId={orgId}
200: [AgentListItemDto]

AgentListItemDto {
  id: string;            // DEntidade.chave
  name: string;          // DEntidade.nome
  hostname?: string;     // dados.hostname
  status: 'online' | 'offline' | 'pending_install' | 'never_connected';
  lastHeartbeat?: string;  // ISO 8601
  projectId?: string;    // DVincula PROJECT_AGENT
  orgId?: string;
  repoUrl?: string;
  criadoEm: string;
  atualizadoEm: string;
}

POST /agents/install-token
Body: { name: string, orgId: string }
201: { token: string, expiresAt: string, installCommand: string }
```

**DoD da Fase F1:**
- [ ] Aba Agentes lista agents reais do banco
- [ ] Status é calculado em runtime (heartbeat < 90s = online)
- [ ] "Instalar agente" gera token real e exibe `installCommand`
- [ ] Heartbeat indicator atualiza a cada 30s (polling ou WebSocket)

**Estimativa:** 4-6 horas

---

### Fase F2 — Execuções Reais

**Objetivo:** Conectar o painel de execuções ao backend (DPedido idClasse=-300/-303).

**Arquivos a modificar (frontend):**
- `src/app/(app)/ia/page.tsx` — aba de execuções
- `src/hooks/use-executions.ts` — criar hook conectado a `GET /executions`

**Contrato:**

```
GET /executions?projectId={listId}&status=RUNNING&limit=20
200: [ExecutionResponseDto]

ExecutionResponseDto {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'APPROVED' | 'REJECTED';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  command: string;         // dados.command
  stdout?: string;
  exitCode?: number;
  agentId?: string;
  projectId: string;
  criadoEm: string;
  atualizadoEm: string;
}

POST /executions
Body: { command: string, projectId: string, riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' }
// Dispara OperacaoExecucaoClaude (Pilar 1)
```

**DoD da Fase F2:**
- [ ] Lista de execuções exibe dados reais do banco
- [ ] Execução HIGH mostra badge "requer aprovação"
- [ ] Aprovar/Rejeitar execução HIGH chama endpoint correto
- [ ] Log de stdout exibido em tempo real (polling ou SSE)

**Estimativa:** 4-8 horas

---

### Fase F3 — Indicador Visual de Agent por Nível de Hierarquia

**Objetivo:** Mostrar ícone de agent na sidebar para Spaces, Folders e Lists vinculados a agent.

**Regra de precedência (ADR-V2-051):**
`List → Folder → Space` (agent vinculado a List prevalece sobre Folder que prevalece sobre Space)

**Arquivos a modificar (frontend):**
- `src/components/shell/app-shell.tsx` — buscar DVincula PROJECT_AGENT para cada nó da sidebar
- `src/hooks/use-agent-links.ts` — resolver agentId por projectId (batch query)

**Contrato:**

```
GET /agents/by-project?projectIds=1,2,3,4
200: { "1": { agentId: "5", level: "list" }, "3": { agentId: "5", level: "space" } }
```

**DoD da Fase F3:**
- [ ] Sidebar exibe ícone de robot ao lado de Space/Folder/List com agent
- [ ] Hover no ícone mostra nome e status do agent

**Estimativa:** 4-6 horas

---

## 11. BLOCO G — NOTIFICAÇÕES E INBOX

**Objetivo:** `/inbox` com notificações reais, read/unread, tipos categorizados.
**Dependências:** Bloco B (auth)
**Resultado visual:** Inbox funcional com notificações reais
**Duração estimada:** 1-1.5 semanas

### Fase G1 — Endpoint `/notifications` e Tipos (GAP-06)

**Objetivo:** Verificar e completar o schema de DEvento -490 com tipos de notificação.

**Tipos de notificação esperados pelo frontend:**
- `comentario` — alguém comentou em uma task
- `mencao` — alguém mencionou `@user`
- `atribuicao` — task foi atribuída ao usuário
- `status` — status de task mudou
- `convite` — convite de org/projeto recebido
- `aprovacao` — execução requer aprovação do usuário

**Contrato de DEvento -490:**

```typescript
// DEvento.metaDados para NOTIFICATION
{
  type: 'task_comment' | 'task_mention' | 'task_assigned' | 
        'task_status_changed' | 'invite_received' | 'execution_approval_needed',
  read: boolean,
  taskId?: string,
  projectId?: string,
  actorId?: string,   // quem gerou a notificação
  actorName?: string,
  message: string,    // texto legível
}
```

**Arquivos a verificar/modificar no backend:**
- `src/eventos/core/event-producer.service.ts` — verificar se `type` está em `metaDados`
- `src/notifications/notifications.service.ts` — garantir que `metaDados.read` existe
- `GET /notifications` — verificar query com filtro `metaDados.read = false`

**DoD da Fase G1:**
- [ ] `GET /notifications?read=false` retorna apenas não-lidas
- [ ] `metaDados.type` está em todas as notificações
- [ ] `PATCH /notifications/:id/read` marca como lida
- [ ] EventProducer emite NOTIFICATION com o formato acima em: task_assigned, task_status_changed, invite_received, execution_approval_needed

**Estimativa:** 6-8 horas

---

### Fase G2 — Frontend `/inbox` com Dados Reais

**Objetivo:** Substituir mock de inbox por notificações reais.

**Arquivos a modificar (frontend):**
- `src/app/(app)/inbox/page.tsx` — trocar mock por `useNotifications()`
- `src/hooks/use-notifications.ts` — criar hook conectado a `GET /notifications`
- `src/components/notifications/notification-item.tsx` — usar NotificationDto real

**Contrato:**

```
GET /notifications?assigneeId={me}&read=false&limit=50
200: [NotificationDto]

NotificationDto {
  id: string;
  type: string;
  message: string;
  read: boolean;
  taskId?: string;
  projectId?: string;
  actorName?: string;
  criadoEm: string;
}

PATCH /notifications/:id/read
200: { id, read: true }

POST /notifications/read-all
200: { updated: N }
```

**DoD da Fase G2:**
- [ ] `/inbox` exibe notificações reais categorizadas por tipo
- [ ] Badge de "não lidas" no header atualiza em tempo real (polling 30s)
- [ ] Clicar em notificação navega para o item relacionado (task, projeto)
- [ ] "Marcar todas como lidas" funciona

**Estimativa:** 4-6 horas

---

## 12. BLOCO H — DOCS, BOOKMARKS, SPRINT PROGRESS

**Objetivo:** Features secundárias sem bloqueio de UX principal.
**Dependências:** Blocos A, C (para Docs dentro de espaços)
**Duração estimada:** 2-3 semanas

### Fase H1 — Docs como DTabela -353 (GAP-04)

**Objetivo:** Implementar documentos ricos usando DTabela idClasse=-353 com conteúdo em `dados.content`.

**Decisão CEO:** DTabela com `dados.content` (JSON ProseMirror-compatível). Não é tabela nova.

**Arquivos a criar/modificar (backend):**
- `src/docs/docs.service.ts` — CRUD de DTabela idClasse=-353
- `src/docs/docs.controller.ts` — `GET/POST/PATCH/DELETE /projects/:id/docs`
- `src/docs/dto/create-doc.dto.ts` — `{ titulo: string, content: object | null }`
- `src/docs/dto/doc-response.dto.ts` — `{ id, titulo, content, spaceId, criadoEm }`

**Contrato:**

```
GET /projects/:spaceOrListId/docs
200: [DocListItemDto] // sem content (preview)

GET /projects/:id/docs/:docId
200: DocDto // com content completo

POST /projects/:id/docs
Body: { titulo: string, content?: object }
201: DocDto

PATCH /projects/:id/docs/:docId
Body: { titulo?: string, content?: object }
200: DocDto

DELETE /projects/:id/docs/:docId
200: { deleted: true }
```

**Schema de `dados.content` (compatível com editores JSON — ProseMirror/Tiptap):**

```typescript
// dados.content é um JSON schema flexível
// Exemplo mínimo compatível com Tiptap:
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Olá mundo" }]
    }
  ]
}
```

**DoD da Fase H1:**
- [ ] `POST /projects/:id/docs` cria DTabela idClasse=-353 com `dados.content`
- [ ] `GET /projects/:id/docs` retorna lista (sem `content` pesado)
- [ ] `GET /projects/:id/docs/:docId` retorna com `content` completo
- [ ] `PATCH /projects/:id/docs/:docId` persiste conteúdo do editor
- [ ] Frontend `/docs` e `/docs/[id]` conectados ao backend
- [ ] Editor Tiptap/Slate lê e salva `content` via API

**Estimativa:** 1 semana (backend) + 1 semana (frontend editor)

---

### Fase H2 — Bookmarks via DVincula -187 (GAP-10)

**Objetivo:** Favoritar Spaces, Folders, Lists e Tasks via DVincula.

**Arquivos a criar/modificar (backend):**
- `src/bookmarks/bookmarks.service.ts` — CRUD via DVincula idClasse=-187
- `src/bookmarks/bookmarks.controller.ts` — `GET/POST/DELETE /bookmarks`

**Schema DVincula para Bookmark:**

```
DVincula {
  idClasse: -187 (BOOKMARK),
  idLocEscritu: userEntidadeId,  // DONO do favorito
  idEntidade: targetId,           // Space, Folder, List ou Task
  metaDados: { targetType: 'space' | 'folder' | 'list' | 'task' }
}
```

**Contrato:**

```
GET /bookmarks?assigneeId={me}
200: [{ id, targetId, targetType, targetName, criadoEm }]

POST /bookmarks
Body: { targetId: string, targetType: 'space' | 'folder' | 'list' | 'task' }
201: BookmarkDto

DELETE /bookmarks/:id
200: { deleted: true }
```

**DoD da Fase H2:**
- [ ] Favoritar/desfavoritar um item cria/remove DVincula -187
- [ ] `GET /bookmarks` retorna lista de favoritos do usuário
- [ ] Seção "Bookmarks" em `/spaces/[id]` exibe favoritos reais

**Estimativa:** 4-6 horas

---

### Fase H3 — Sprints com Progress Completo

(Já detalhado na Fase E3 — mover para cá se equipe preferir agrupar por complexidade)

---

## 13. BLOCO I — TODAY, PLANNER, ANALYTICS

**Objetivo:** Views de data e analytics conectadas ao backend.
**Dependências:** Bloco D (dueDate), Bloco C (listas)
**Duração estimada:** 2-3 semanas

### Fase I1 — `/today` com Dados Reais

**Objetivo:** View "Hoje" com tasks com vencimento hoje + atrasadas.

**Arquivos a modificar (frontend):**
- `src/app/(app)/today/page.tsx` — trocar mock por `useTodayTasks()`
- `src/hooks/use-today-tasks.ts` — criar hook conectado a `GET /tasks?dueDateToday=true&assigneeId={me}`

**DoD da Fase I1:**
- [ ] `/today` exibe tasks com `dueDate = hoje` (ou atrasadas não concluídas)
- [ ] Tasks agrupadas por projeto/lista
- [ ] Contador de tasks atrasadas no header

**Estimativa:** 3-4 horas

---

### Fase I2 — `/planner` como Calendário de Tasks

**Objetivo:** View Planner com tasks dispostas em calendário/Gantt por dueDate.

**Arquivos a modificar (frontend):**
- `src/app/(app)/planner/page.tsx` — carregar tasks por range de datas
- `src/hooks/use-planner.ts` — criar hook com query `GET /tasks?dueDateFrom=X&dueDateTo=Y&assigneeId={me}`

**Contrato:**

```
GET /tasks?assigneeId={me}&dueDateFrom=2026-06-01&dueDateTo=2026-06-30&limit=200
200: TaskResponseDto[] com dueDate
```

**DoD da Fase I2:**
- [ ] `/planner` exibe tasks com dueDate em vista calendário/timeline
- [ ] Navegar para mês anterior/próximo carrega tasks do período
- [ ] Arrastar task no calendário atualiza `dueDate`

**Estimativa:** 4-8 horas (muito depende da lib de calendário usada)

---

### Fase I3 — Reports e Analytics Reais

**Objetivo:** Conectar dashboards de analytics ao backend.

**Arquivos a modificar (frontend):**
- `src/app/(app)/reports/page.tsx` (se existir) — conectar a `GET /reports` e `GET /analytics`

**Contrato:**

```
GET /flow-metrics?projectId={listId}&period=30d
200: FlowMetricsDto

GET /forecast?projectId={listId}&simulations=1000
200: ForecastDto

GET /reports?organizationId={orgId}&period=monthly
200: ReportDto[]
```

**DoD da Fase I3:**
- [ ] Métricas de fluxo (lead time, cycle time, throughput) exibidas com dados reais
- [ ] Forecast Monte Carlo exibido com histograma de probabilidades
- [ ] Relatório mensal de tasks concluídas

**Estimativa:** 4-8 horas (endpoints já existem no backend)

---

## 14. MATRIZ DE GAPS VS FASES

| Gap | Descrição | Bloco/Fase | Status após o bloco |
|---|---|---|---|
| GAP-01 | `dueDate` não tipado | D1 | RESOLVIDO |
| GAP-02 | Status 5 vs 9 V3 | D2 | RESOLVIDO |
| GAP-03 | Space/Folder/List não existem | A1+A2+C1 | RESOLVIDO |
| GAP-04 | Docs sem tabela canônica | H1 | RESOLVIDO |
| GAP-05 | Sprint sem progresso calculado | E3 | RESOLVIDO |
| GAP-06 | Notificações sem tipos | G1 | RESOLVIDO |
| GAP-07 | Chat IA / Nexus sem backend | NÃO incluso (V3) | PENDENTE |
| GAP-08 | Forms sem backend | NÃO incluso (V3) | PENDENTE |
| GAP-09 | Planner sem datas | I2 (depende D1) | RESOLVIDO |
| GAP-10 | Bookmarks sem backend | H2 | RESOLVIDO |

---

## 15. TABELA DE EQUIVALÊNCIAS DE MIGRATIONS

| Migration | Fase | Tabela | Campos | Risco |
|---|---|---|---|---|
| `add_hierarchy_dproject` | A2 | DProject | `idPai BigInt?`, `privado Boolean` | MÉDIO — dados existentes OK (NULL/false) |
| `add_due_date_dtask` | D1 | DTask | `dueDate DateTime?` | BAIXO — aditivo, nullable |

**Protocolo de migration obrigatório (devari-migration-protocol.md):**
1. Strategist planeia migration up + down (feito acima)
2. Implementer cria via `npx prisma migrate dev` em dev
3. Testa down (rollback)
4. Reviewer valida idempotência
5. NÃO executar em prod sem backup documentado

---

## 16. ORDEM DE INTEGRAÇÃO DO FRONTEND (por prioridade visual)

| Prioridade | Rota Frontend | Endpoint Backend | Bloco | Status atual |
|---|---|---|---|---|
| 1 | `/login` | `POST /auth/login` | B1 | MOCK → REAL |
| 2 | `/register` | `POST /auth/register` | B1 | MOCK → REAL |
| 3 | Sidebar (Spaces) | `GET /projects?type=space` | C3 | MOCK → REAL |
| 4 | Sidebar (Folders) | `GET /projects?parentId={id}` | C3 | MOCK → REAL |
| 5 | Sidebar (Lists) | `GET /projects?parentId={id}` | C3 | MOCK → REAL |
| 6 | `/lists/[id]` (Kanban) | `GET /tasks?projectId={listId}` | D3+D5 | MOCK → REAL |
| 7 | `/tasks` | `GET /tasks?assigneeId={me}` | D3 | MOCK → REAL |
| 8 | `/spaces/[id]` | `GET /projects/:id` | C4 | MOCK → REAL |
| 9 | `/folders/[id]` | `GET /projects/:id` + filhos | C4 | MOCK → REAL |
| 10 | `/ia` (Agentes) | `GET /agents` | F1 | localStorage → REAL |
| 11 | `/teams` | `GET /teams` | E1 | MOCK → REAL |
| 12 | `/inbox` | `GET /notifications` | G2 | MOCK → REAL |
| 13 | `/today` | `GET /tasks?dueDateToday=true` | I1 | MOCK → REAL |
| 14 | `/sprints` | `GET /sprints` com progresso | E3 | PARCIAL → REAL |
| 15 | `/docs` | `GET /projects/:id/docs` | H1 | MOCK → REAL |
| 16 | `/planner` | `GET /tasks?dueDateFrom=X&dueDateTo=Y` | I2 | MOCK → REAL |
| 17 | `/ia` (Execuções) | `GET /executions` | F2 | MOCK → REAL |
| 18 | Reports/Analytics | `GET /flow-metrics`, `GET /forecast` | I3 | MOCK → REAL |

---

## 17. ESTIMATIVA DE TEMPO DETALHADA (COM BUFFER 20%)

| Bloco | Fases | Esforço Base | Buffer 20% | Total |
|---|---|---|---|---|
| **A** — Fundação | A1, A2, A3 | 2 semanas | +4 dias | **2.5 semanas** |
| **B** — Auth Real | B1, B2 | 0.5 semana | +1 dia | **0.7 semanas** |
| **C** — Spaces/Folders/Lists | C1, C2, C3, C4 | 3 semanas | +4 dias | **3.5 semanas** |
| **D** — Tasks e Status V3 | D1, D2, D3, D4, D5 | 2.5 semanas | +3 dias | **3 semanas** |
| **E** — Teams/Members/Invites | E1, E2, E3 | 1.5 semanas | +2 dias | **1.8 semanas** |
| **F** — Agents e Execuções | F1, F2, F3 | 1 semana | +1.5 dias | **1.3 semanas** |
| **G** — Notificações/Inbox | G1, G2 | 1 semana | +1.5 dias | **1.2 semanas** |
| **H** — Docs/Bookmarks | H1, H2 | 2 semanas | +2 dias | **2.3 semanas** |
| **I** — Today/Planner/Analytics | I1, I2, I3 | 1.5 semanas | +2 dias | **1.8 semanas** |
| **TOTAL** | | **15 semanas** | +3 semanas | **18 semanas** |

**Cenário pessimista (dependências atrasam, bugs de migration):** 22-24 semanas.
**Cenário otimista (paralelismo Backend+Frontend em Blocos C-D):** 14-16 semanas.

---

## 18. RISCOS E MITIGAÇÕES

### Riscos Altos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Migration `DProject.idPai` quebra dados existentes | BAIXA | ALTO | Coluna nullable, default NULL; migration reversível documentada; backup obrigatório antes |
| Ciclo em hierarquia (A→B→C→A em DProject) | BAIXA | ALTO | CTE anti-ciclo obrigatório antes de qualquer UPDATE de `idPai`; testado em unit test |
| Cascade delete apaga hierarquia inteira acidentalmente | MÉDIA | ALTO | Soft-delete bottom-up com transaction; confirmação no frontend ("Você irá deletar X listas, Y tasks") |
| Frontend usa `id` onde backend usa `entidadeId` em JWT | ALTA | MÉDIO | Fase B1 mapeia explicitamente; store de auth atualizado para salvar `entidadeId` separado |
| N+1 queries na sidebar (carrega toda árvore de uma vez) | MÉDIA | MÉDIO | Lazy loading por nível (só carrega filhos ao expandir nó) |

### Riscos Médios

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| `dueDate` em `dados` JSON (legado) conflita com coluna nova | BAIXA | MÉDIO | Migration não migra dados históricos de JSON (campo novo, nullable) |
| Editor de Docs (Tiptap/Slate) incompatível com `dados.content` | MÉDIA | MÉDIO | Schema de `dados.content` definido como ProseMirror-compatível (padrão industrial) |
| Sprint ativo sem campo `metaDados.active` nos dados existentes | MÉDIA | BAIXO | Sprint ativo = primeiro criado + sem `metaDados.completedAt` (fallback defensivo) |
| Mapper V3→UX mostra status "bloqueado" quando deveria ser "cancelado" | BAIXA | BAIXO | Decisão de UX documentada; FAILED → "bloqueado" é escolha explícita, não bug |

### Riscos Baixos

| Risco | Impacto | Mitigação |
|---|---|---|
| Bookmarks: DVincula -187 sem índice eficiente | BAIXO | Índice em `(idLocEscritu, idClasse)` já existe na tabela DVincula |
| Notificações: `metaDados.type` ausente em eventos antigos | BAIXO | `metaDados.type ?? 'sistema'` como fallback |
| Sprint progress: tasks sem `idSprint` quebram groupBy | BAIXO | `WHERE idSprint IS NOT NULL` na query |

---

## 19. CRITÉRIOS DE SUCESSO DO PROJETO

### MUST HAVE (sem estes, integração não está pronta)
- [ ] Login/Register funcionam com dados reais
- [ ] Sidebar exibe Spaces, Folders, Lists reais da org
- [ ] Kanban board mostra tasks reais de uma List
- [ ] Criar/editar/mover task (com status V3) funciona sem mock
- [ ] Anti-ciclo em DProject validado e testado
- [ ] Cascade delete bottom-up funcional
- [ ] seed das 6 DClasses novas passa validação

### SHOULD HAVE (importante para UX completa)
- [ ] `/today` com tasks de vencimento hoje real
- [ ] Notificações reais no `/inbox`
- [ ] Times com membros reais em `/teams`
- [ ] Agentes VPS listados sem mock localStorage
- [ ] Docs criáveis e editáveis por Space

### COULD HAVE (agrega valor mas não bloqueia)
- [ ] `/planner` em calendário
- [ ] Sprint progress calculado
- [ ] Bookmarks funcionais
- [ ] Reports e Analytics reais
- [ ] Indicador visual de agent na sidebar

### WILL NOT HAVE (excluído explicitamente deste ciclo — V3)
- Chat com LLM (GAP-07, /ia aba "Faça uma pergunta")
- Formulários customizados (GAP-08, /forms)
- Real-time (WebSocket) — polling é suficiente por agora
- Offline mode — apenas online com JWT

---

## 20. HANDOFF PARA O IMPLEMENTER

### Sequência de implementação obrigatória

```
1. SEMPRE começar pelo Bloco A (seed + migration)
2. Bloco B (auth) pode ser feito em paralelo ao Bloco A
3. Blocos C, D, E dependem de A completo
4. Blocos F, G dependem apenas de B
5. Blocos H, I dependem de C+D completos
```

### Comandos essenciais

```bash
# 1. Atualizar seed e rodar
npx ts-node prisma/seeds/seed-runner.ts
# ou
npx prisma db seed

# 2. Criar migration do DProject
npx prisma migrate dev --name add_hierarchy_dproject

# 3. Criar migration do DTask
npx prisma migrate dev --name add_due_date_dtask

# 4. Validar build após cada migration
make build

# 5. Rodar testes
npm run test
npm run test:e2e

# 6. Verificar seed anti-colisão
npx tsc --noEmit  # validateHierarchy() roda em import-time
```

### Checklist de DoD global (antes de marcar bloco como concluído)

- [ ] `make build` passa sem warnings
- [ ] Testes unit (≥80% coverage) passam
- [ ] Testes E2E do bloco passam
- [ ] Nenhuma N+1 query (verificar com `DATABASE_LOGGING=true`)
- [ ] Migration up E down testadas
- [ ] Backup documentado antes de migration em banco não-vazio
- [ ] `npx prisma validate` sem erros
- [ ] Reviewer aprova com score ≥ 7.0 (ADR-V2-015)
- [ ] Documenter registra no CHANGELOG e ROADMAP

### Convenção de Commits para este bloco

```
feat(seeds): adiciona DClasses SPACE/FOLDER/LIST/DOC/BOOKMARK ao seed canônico
feat(projects): migration DProject.idPai self-referencial (ADR-V2-051)
feat(projects): validação anti-ciclo CTE PostgreSQL
feat(projects): cascade soft-delete bottom-up hierárquico
feat(tasks): migration DTask.dueDate tipado (GAP-01)
feat(projects): CRUD Space/Folder/List com hierarquia validada
feat(auth): integração frontend auth real (login/register/refresh)
feat(sidebar): Spaces/Folders/Lists reais via GET /projects?type=
feat(tasks): mapper V3 Intentions ↔ StatusTarefa frontend (GAP-02)
feat(notifications): tipos de notificação em metaDados.type (GAP-06)
feat(docs): CRUD documentos ricos via DTabela -353 (GAP-04)
feat(bookmarks): favoritos via DVincula -187 (GAP-10)
```

---

## 21. APÊNDICE — REVISÃO DOS ADRs ATIVOS NESTE PLANO

| ADR | Título | Papel neste plano |
|---|---|---|
| ADR-V2-001 | Zero tabela nova | Guia todas as decisões — DTabela -353 para Docs em vez de nova tabela |
| ADR-V2-002 | Renumeração de DClasses | Chaves -350, -351, -352 não conflitam com canônicas -1..-110 |
| ADR-V2-003 | RBAC duplo via DVincula | Permissões de Space via DVincula -188 (SPACE_PRIVATE_MEMBER) |
| ADR-V2-005 | Engine em DPedido | Blocos F2/F3 (execuções) respeitam Pilar 1 — DPedido via Engine |
| ADR-V2-007 | DVFS para portabilidade | Scripts DVFS usados nas execuções (F2) — não alterar |
| ADR-V2-008 | DEvento substitui DNotification | Bloco G usa DEvento -490 exclusivamente |
| ADR-V2-009 | Sprints como wrappers thin | Sprint permanece DTabela -400 (wrapper GET /sprints) |
| ADR-V2-015 | Score gate ≥ 7.0 | Cada fase passa pelo Reviewer antes de avançar |
| ADR-V2-047 | Hierarquia DTask via idPai | Tasks dentro de List com idPai para fases (PHASE -200) |
| ADR-V2-051 | Hierarquia DProject Space/Folder/List | ADR fundacional deste plano — NÃO reabrir |

**ADRs a ratificar durante implementação:**
- ADR-V2-052 — `dueDate` como coluna tipada em DTask (vs `dados.dueDate` JSON) — Fase D1
- ADR-V2-053 — Doc como DTabela -353 + `dados.content` ProseMirror-compatível — Fase H1
- ADR-V2-054 — Bookmark como DVincula -187 — Fase H2

---

## 22. APÊNDICE — CÓDIGO DE REFERÊNCIA COMPLETO

### Seed atualizado (6 novas DClasses — adicionar ao classes.seed.ts)

```typescript
// Inserir DEPOIS dos vínculos existentes (-186 TELEGRAM_LINK)
// e ANTES dos DPedido (-300)

// === DVincula adicionais — Bloco A ===
esp(-187, 'BOOKMARK', 'Favorito/Bookmark', -37),
esp(-188, 'SPACE_PRIVATE_MEMBER', 'Membro de Space privado (ADR-V2-051)', -37),

// === DProject hierarquia (ADR-V2-051) — inserir no bloco DEntidade ===
// Localização no seed: após SCRUMBAN_PROJECT (-153) e SCRUMBAN_TASK (-154)
// Chaves -350..-352: Space/Folder/List (DProject self-referencial)
esp(-350, 'SPACE', 'Espaco de trabalho (raiz da hierarquia)', -37),
esp(-351, 'FOLDER', 'Pasta agrupadora (Folder dentro de Space)', -37),
esp(-352, 'LIST', 'Lista de tasks (Board ou Backlog dentro de Folder)', -37),

// === DTabela — documento rico (GAP-04 resolvido em H1) ===
// Inserir no bloco DTabela principal, após ISSUE_COUNTER (-475)
esp(-353, 'DOC', 'Documento rico (conteudo ProseMirror em dados.content)', -51),
```

**ATENÇÃO:** Atualizar o comentário do array `classesEspecificas` de 98 para 104 entradas,
e o comentário da composição do seed de 8 para 9 no bloco DEntidade (agora inclui -350/-351/-352),
e atualizar COUNTS.especificas de 98 para 104.

### Schema DProject atualizado (prisma/schema.prisma)

Ver Fase A2 para o schema completo com self-relation.

### Função anti-ciclo (src/projects/utils/anti-cycle.util.ts)

Ver Fase A3 para o código completo.

### Cascade soft-delete (método privado no ProjectsService)

Ver Fase A3 para o código completo.

### Mapper V3 → UX (src/lib/mappers/task-status.mapper.ts)

Ver Fase D2 para o código completo.

---

## 23. APÊNDICE — DETALHAMENTO DO PROJECTSSERVICE APÓS ADR-V2-051

Esta seção documenta todas as alterações que o `ProjectsService` precisará receber
para suportar a hierarquia Space→Folder→List sem quebrar os testes e funcionalidades
existentes de projetos (idClasse=-153 SCRUMBAN_PROJECT).

### 23.1 — Constantes de idClasse (adicionar ao topo do service)

```typescript
// src/projects/projects.service.ts — adicionar às constantes existentes

/** idClasse para hierarquia ADR-V2-051 */
const ID_CLASSE_SPACE  = BigInt(-350);  // Espaço de trabalho
const ID_CLASSE_FOLDER = BigInt(-351);  // Pasta agrupadora
const ID_CLASSE_LIST   = BigInt(-352);  // Lista de tasks (Board/Backlog)

/** Classes que participam da hierarquia Space/Folder/List */
const HIERARCHY_CLASSES = [ID_CLASSE_SPACE, ID_CLASSE_FOLDER, ID_CLASSE_LIST];

/** Mapa tipo string → DClasse para criação */
const PROJECT_TYPE_TO_CLASSE: Record<string, bigint> = {
  space:   ID_CLASSE_SPACE,
  folder:  ID_CLASSE_FOLDER,
  list:    ID_CLASSE_LIST,
  project: BigInt(-153),  // compat com código legado
};

/** Mapa DClasse string → tipo string para response */
const CLASSE_TO_PROJECT_TYPE: Record<string, string> = {
  '-350': 'space',
  '-351': 'folder',
  '-352': 'list',
  '-153': 'project',
};
```

### 23.2 — DTO de criação atualizado

```typescript
// src/projects/dto/create-project.dto.ts — campos novos

export class CreateProjectDto {
  @ApiProperty({ example: 'Marketing Q1' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nome: string;

  // ADR-V2-051: tipo discriminador
  @ApiPropertyOptional({
    enum: ['space', 'folder', 'list', 'project'],
    default: 'project',
    description: 'Tipo do projeto na hierarquia. Omitir = comportamento legado (project)',
  })
  @IsOptional()
  @IsIn(['space', 'folder', 'list', 'project'])
  type?: string = 'project';

  // ADR-V2-051: pai na hierarquia
  @ApiPropertyOptional({
    description: 'ID do projeto pai (Space para Folder; Folder para List)',
    example: '42',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  // ADR-V2-051: visibilidade de Space
  @ApiPropertyOptional({
    description: 'Space privado = apenas membros explícitos (DVincula -188)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  privado?: boolean = false;

  // campos existentes mantidos
  @IsOptional() @IsString() orgId?: string;
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsString() prefix?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() repoUrl?: string;
  @IsOptional() @IsBoolean() automationEnabled?: boolean;
}
```

### 23.3 — DTO de response atualizado

```typescript
// src/projects/dto/project-response.dto.ts — campos novos

export class ProjectResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() nome: string;

  // ADR-V2-051: tipo na hierarquia
  @ApiProperty({ enum: ['space', 'folder', 'list', 'project'] })
  type: string;

  // ADR-V2-051: pai na hierarquia (null = raiz)
  @ApiPropertyOptional({ nullable: true })
  parentId: string | null;

  // ADR-V2-051: flag de privacidade (apenas para type=space)
  @ApiProperty({ default: false })
  privado: boolean;

  // ADR-V2-051: quantidade de filhos diretos (Folders de um Space; Lists de um Folder)
  @ApiProperty({ default: 0 })
  childCount: number;

  // campos existentes
  @ApiPropertyOptional({ nullable: true }) prefix: string | null;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiPropertyOptional({ nullable: true }) orgId: string | null;
  @ApiProperty() memberCount: number;
  @ApiPropertyOptional({ nullable: true }) repoUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) teamId: string | null;
  @ApiPropertyOptional({ nullable: true }) folderId: string | null;  // legado — deprecated após C3
  @ApiProperty() criadoEm: string;
  @ApiProperty() atualizadoEm: string;
}
```

### 23.4 — Query atualizada do `findMany()` com suporte a `type` e `parentId`

```typescript
// src/projects/projects.service.ts — interface FindManyProjectsOptions atualizada

export interface FindManyProjectsOptions {
  cursor?: string;
  limit?: number;
  teamId?: string;
  organizationId?: string;

  // ADR-V2-051: filtros de hierarquia
  type?: 'space' | 'folder' | 'list' | 'project';
  parentId?: string;   // filtra DProject.idPai = parentId (filhos diretos)
  rootOnly?: boolean;  // filtra DProject.idPai IS NULL (apenas raízes)
}
```

**Lógica do `findMany()` atualizada:**

```typescript
// Dentro de findMany() — adicionar à construção do where de DProject.findMany

const hierarchyFilter: Prisma.DProjectWhereInput = {};

if (opts.type && PROJECT_TYPE_TO_CLASSE[opts.type]) {
  hierarchyFilter.idClasse = PROJECT_TYPE_TO_CLASSE[opts.type];
}

if (opts.parentId) {
  hierarchyFilter.idPai = BigInt(opts.parentId);
} else if (opts.rootOnly) {
  hierarchyFilter.idPai = null;
}

// merge com filtros existentes
const projects = await this.prisma.dProject.findMany({
  where: {
    chave: { in: projectIds },
    excluido: false,
    ...(orgIdBig !== undefined ? { idEstab: orgIdBig } : {}),
    ...hierarchyFilter,
  },
  orderBy: { chave: 'desc' },
});
```

### 23.5 — Controller com novos query params

```typescript
// src/projects/projects.controller.ts — novos ApiQuery para hierarquia

@Get()
@ApiQuery({
  name: 'type',
  required: false,
  enum: ['space', 'folder', 'list', 'project'],
  description: 'Filtrar por tipo na hierarquia (ADR-V2-051)',
})
@ApiQuery({
  name: 'parentId',
  required: false,
  description: 'Filtra filhos diretos de um projeto (spaceId para Folders, folderId para Lists)',
  example: '42',
})
async findMany(
  @Request() req: JwtRequest,
  @Query() query: ListProjectsQueryDto,
): Promise<ListProjectResponseDto> {
  return this.projectsService.findMany(BigInt(req.user.entidadeId), {
    cursor: query.cursor,
    limit: query.limit ?? 20,
    teamId: query.teamId,
    organizationId: req.user.organizationId,
    type: query.type as 'space' | 'folder' | 'list' | 'project' | undefined,
    parentId: query.parentId,
    rootOnly: query.type === 'space', // spaces são sempre raízes
  });
}
```

### 23.6 — BuildResponse atualizado

```typescript
// ProjectsService.buildResponse() — adicionar type, parentId, privado, childCount

private buildResponse(
  project: {
    chave: bigint;
    idClasse: bigint;
    idPai?: bigint | null;
    privado?: boolean;
    nome: string;
    descricao?: string | null;
    idEstab?: bigint | null;
    dados?: unknown;
    repoUrl?: string | null;
    criadoEm: Date;
    atualizadoEm: Date;
  },
  memberCount: number,
  teamId: string | null,
  folderId: string | null = null,
  childCount: number = 0,
): ProjectResponseDto {
  const dados = project.dados as Record<string, unknown> | null;
  const type = CLASSE_TO_PROJECT_TYPE[project.idClasse.toString()] ?? 'project';

  return {
    id: project.chave.toString(),
    nome: project.nome,
    type,
    parentId: project.idPai?.toString() ?? null,
    privado: project.privado ?? false,
    childCount,
    prefix: (dados?.prefix as string | null) ?? 'DEV',
    description: (dados?.description as string | null | undefined) ?? project.descricao ?? null,
    orgId: project.idEstab?.toString() ?? null,
    memberCount,
    repoUrl: project.repoUrl ?? null,
    teamId,
    folderId,           // legado — mantido para compat
    criadoEm: project.criadoEm.toISOString(),
    atualizadoEm: project.atualizadoEm.toISOString(),
  };
}
```

---

## 24. APÊNDICE — QUERY DE ÁRVORE COMPLETA (CTE RECURSIVO PARA SIDEBAR)

O frontend pode precisar carregar a árvore completa de um usuário em uma única
chamada para pre-popular a sidebar. Embora o padrão recomendado seja lazy loading
(nível por nível), este endpoint de "árvore completa" é útil para exports e
navegação offline.

**Endpoint opcional (não obrigatório para o MVP):**

```
GET /projects/tree?organizationId={orgId}
```

**Implementação via CTE recursivo PostgreSQL:**

```typescript
// src/projects/projects.service.ts — método findProjectTree()

/**
 * Retorna a árvore completa de projetos acessíveis ao usuário,
 * usando CTE recursivo para resolver a hierarquia em uma única query.
 *
 * Uso: sidebar lazy-load completo (optional — lazy é preferido).
 * N+1 ZERO: 1 query para a árvore + 1 para contagem de filhos.
 *
 * @param userEntidadeId - Chave da DEntidade do usuário
 * @param organizationId - Org ativa do JWT
 * @returns Árvore de SpaceDto com filhos aninhados
 */
async findProjectTree(
  userEntidadeId: bigint,
  organizationId: string,
): Promise<ProjectTreeDto[]> {
  const orgIdBig = BigInt(organizationId);

  // 1. IDs de projetos acessíveis ao usuário na org
  const accessibleIds = await this.findAccessibleProjectIds(
    userEntidadeId,
    organizationId,
  );

  if (accessibleIds.length === 0) return [];

  // 2. CTE recursivo para montar a árvore completa
  const tree = await this.prisma.$queryRaw<Array<{
    chave: bigint;
    idClasse: bigint;
    idPai: bigint | null;
    nome: string;
    privado: boolean;
    depth: number;
  }>>`
    WITH RECURSIVE project_tree AS (
      -- Raízes: Spaces acessíveis (idPai IS NULL)
      SELECT chave, "idClasse", "idPai", nome, privado, 0 AS depth
      FROM "DProject"
      WHERE chave = ANY(ARRAY[${Prisma.join(accessibleIds.map(id => BigInt(id)))}])
        AND "idPai" IS NULL
        AND excluido = false
        AND "idEstab" = ${orgIdBig}

      UNION ALL

      -- Filhos: Folders e Lists cujo pai está na árvore
      SELECT p.chave, p."idClasse", p."idPai", p.nome, p.privado, pt.depth + 1
      FROM "DProject" p
      INNER JOIN project_tree pt ON p."idPai" = pt.chave
      WHERE p.excluido = false
        AND pt.depth < 2  -- Limite de profundidade: Space(0)→Folder(1)→List(2)
    )
    SELECT * FROM project_tree ORDER BY depth, nome
  `;

  // 3. Montar estrutura aninhada em memória
  return this.buildTreeStructure(tree);
}

private buildTreeStructure(
  flat: Array<{ chave: bigint; idClasse: bigint; idPai: bigint | null; nome: string; privado: boolean; depth: number }>,
): ProjectTreeDto[] {
  const map = new Map<string, ProjectTreeDto>();
  const roots: ProjectTreeDto[] = [];

  // Primeira passagem: criar nós
  for (const row of flat) {
    const node: ProjectTreeDto = {
      id: row.chave.toString(),
      nome: row.nome,
      type: CLASSE_TO_PROJECT_TYPE[row.idClasse.toString()] ?? 'project',
      parentId: row.idPai?.toString() ?? null,
      privado: row.privado,
      children: [],
    };
    map.set(node.id, node);
  }

  // Segunda passagem: montar árvore
  for (const row of flat) {
    const node = map.get(row.chave.toString())!;
    if (row.idPai === null) {
      roots.push(node);
    } else {
      const parent = map.get(row.idPai.toString());
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  return roots;
}
```

---

## 25. APÊNDICE — TESTES OBRIGATÓRIOS POR FASE

Esta seção lista os testes mínimos que o Implementer deve criar para cada fase.
O Reviewer rejeita qualquer fase sem cobertura de testes nos cenários listados.

### Testes da Fase A1 (Seed)

```typescript
// prisma/seeds/__tests__/classes.seed.spec.ts
describe('Seed ADR-V2-051: novas DClasses', () => {
  it('deve conter SPACE (-350), FOLDER (-351), LIST (-352), DOC (-353)', () => {
    const chaves = classes.map(c => c.chave);
    expect(chaves).toContain(-350);
    expect(chaves).toContain(-351);
    expect(chaves).toContain(-352);
    expect(chaves).toContain(-353);
    expect(chaves).toContain(-187);
    expect(chaves).toContain(-188);
  });

  it('COUNTS.total deve ser 149 (143 + 6)', () => {
    expect(COUNTS.total).toBe(149);
  });

  it('não deve ter chaves em range canônico reservado (-1..-110)', () => {
    const specificChaves = classesEspecificas.map(c => c.chave);
    const reserved = specificChaves.filter(c => c >= -110 && c <= -1);
    expect(reserved).toHaveLength(0);
  });

  it('validateHierarchy não lança em tempo de import', () => {
    // O simples import já executa validateHierarchy()
    expect(() => require('../classes.seed')).not.toThrow();
  });
});
```

### Testes da Fase A2 (Migration)

```typescript
// src/projects/__tests__/projects-hierarchy.spec.ts
describe('DProject hierarquia ADR-V2-051', () => {
  it('deve criar Space sem pai', async () => {
    const space = await prisma.dProject.create({
      data: { idClasse: BigInt(-350), nome: 'Test Space', idPai: null, privado: false },
    });
    expect(space.idPai).toBeNull();
    expect(space.privado).toBe(false);
  });

  it('deve criar Folder com Space como pai', async () => {
    const folder = await prisma.dProject.create({
      data: { idClasse: BigInt(-351), nome: 'Test Folder', idPai: space.chave },
    });
    expect(folder.idPai).toBe(space.chave);
  });

  it('deve criar List com Folder como pai', async () => {
    const list = await prisma.dProject.create({
      data: { idClasse: BigInt(-352), nome: 'Test List', idPai: folder.chave },
    });
    expect(list.idPai).toBe(folder.chave);
  });
});
```

### Testes da Fase A3 (Anti-Ciclo + Cascade)

```typescript
// src/projects/utils/__tests__/anti-cycle.spec.ts
describe('validateNoCycle', () => {
  it('deve passar para pai sem relacionamento', async () => {
    await expect(validateNoCycle(prisma, BigInt(1), BigInt(2))).resolves.not.toThrow();
  });

  it('deve lançar BadRequest quando pai é descendente', async () => {
    // A (1) → B (2) → C (3)
    // Tentativa: mover A para filho de C → CICLO
    await expect(validateNoCycle(prisma, BigInt(1), BigInt(3))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('deve lançar BadRequest quando projeto é pai de si mesmo', async () => {
    await expect(validateNoCycle(prisma, BigInt(1), BigInt(1))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('deve passar quando novoPaiId é null (remover da hierarquia)', async () => {
    await expect(validateNoCycle(prisma, BigInt(1), null)).resolves.not.toThrow();
  });
});

// src/projects/__tests__/cascade-delete.spec.ts
describe('cascadeDeleteHierarchy', () => {
  it('deve deletar Space + 2 Folders + 4 Lists + todas as tasks', async () => {
    // Setup: Space → [Folder1 → [List1, List2], Folder2 → [List3, List4]]
    // List1 tem 3 tasks, List2 tem 2 tasks, List3 tem 0, List4 tem 5 tasks
    const counts = await service.delete(space.chave.toString(), managerId, orgId);
    expect(counts.counts.tasks).toBe(10);
    expect(counts.counts.members).toBeGreaterThan(0);
    // Verificar soft-delete
    const deletedSpace = await prisma.dProject.findFirst({ where: { chave: space.chave } });
    expect(deletedSpace?.excluido).toBe(true);
  });
});
```

### Testes da Fase D1 (dueDate)

```typescript
// src/tasks/__tests__/tasks-due-date.spec.ts
describe('DTask.dueDate', () => {
  it('deve persistir dueDate via POST /tasks', async () => {
    const dto = { titulo: 'Task com prazo', idProject: listId, dueDate: '2026-06-15T00:00:00Z' };
    const task = await service.create(dto, userEntidadeId);
    expect(task.dueDate).toBe('2026-06-15T00:00:00.000Z');
  });

  it('deve filtrar tasks por dueDateToday', async () => {
    // Criar task com dueDate = hoje
    const today = new Date().toISOString();
    await service.create({ titulo: 'Hoje', idProject: listId, dueDate: today }, userId);
    // Criar task com dueDate = amanhã
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    await service.create({ titulo: 'Amanhã', idProject: listId, dueDate: tomorrow }, userId);

    const result = await service.findMany({ dueDateToday: true, assigneeId: userId });
    expect(result.items.some(t => t.title === 'Hoje')).toBe(true);
    expect(result.items.some(t => t.title === 'Amanhã')).toBe(false);
  });

  it('deve incluir tasks atrasadas no /today', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    await service.create({ titulo: 'Atrasada', idProject: listId, dueDate: yesterday }, userId);
    const result = await service.findMany({ dueDateToday: true, assigneeId: userId });
    expect(result.items.some(t => t.title === 'Atrasada')).toBe(true);
  });

  it('deve aceitar dueDate: null para remover prazo', async () => {
    const task = await service.create({ titulo: 'Com prazo', dueDate: '2026-06-15' }, userId);
    const updated = await service.update(task.id, { dueDate: null }, userId);
    expect(updated.dueDate).toBeNull();
  });
});
```

### Testes da Fase D2 (Mapper)

```typescript
// src/lib/mappers/__tests__/task-status.mapper.spec.ts
describe('task-status.mapper', () => {
  it.each([
    ['INBOX', 'pendente'],
    ['READY', 'pendente'],
    ['EXECUTING', 'em-progresso'],
    ['VALIDATING', 'em-progresso'],
    ['DONE', 'concluido'],
    ['VALIDATED', 'concluido'],
    ['FAILED', 'bloqueado'],
    ['CANCELLED', 'concluido'],
    ['DISCARDED', 'concluido'],
  ])('v3ToUx(%s) deve retornar %s', (input, expected) => {
    expect(v3ToUx(input as V3Intention)).toBe(expected);
  });

  it('isOverdue: task EXECUTING com dueDate passado é atrasada', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(isOverdue(yesterday, 'EXECUTING')).toBe(true);
  });

  it('isOverdue: task DONE com dueDate passado NÃO é atrasada', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(isOverdue(yesterday, 'DONE')).toBe(false);
  });

  it('isOverdue: task sem dueDate NÃO é atrasada', () => {
    expect(isOverdue(null, 'EXECUTING')).toBe(false);
  });
});
```

### Testes da Fase G1 (Notificações)

```typescript
// src/eventos/__tests__/notifications.spec.ts
describe('Notificações DEvento -490', () => {
  it('deve emitir NOTIFICATION com metaDados.type ao atribuir task', async () => {
    await tasksService.update(taskId, { assigneeId: userId }, managerId);
    const notification = await prisma.dEvento.findFirst({
      where: { idClasse: BigInt(-490), idEntidade: BigInt(userId) },
      orderBy: { criadoEm: 'desc' },
    });
    expect(notification).toBeDefined();
    const meta = notification!.metaDados as Record<string, unknown>;
    expect(meta.type).toBe('task_assigned');
    expect(meta.read).toBe(false);
    expect(meta.taskId).toBe(taskId);
  });

  it('deve marcar notificação como lida via PATCH /notifications/:id/read', async () => {
    const updated = await notificationsService.markAsRead(notificationId, userId);
    expect(updated.read).toBe(true);
  });
});
```

---

## 26. APÊNDICE — ARQUIVOS IMPACTADOS POR BLOCO

### Bloco A — Arquivos Modificados

**Backend:**
- `prisma/seeds/classes.seed.ts` — +6 DClasses
- `prisma/schema.prisma` — +2 campos em DProject
- `prisma/migrations/[ts]_add_hierarchy_dproject/migration.sql` — gerado
- `src/projects/utils/anti-cycle.util.ts` — criado
- `src/projects/seed-bootstrap.service.ts` — seed condicional por idClasse
- `src/projects/projects.service.ts` — cascade delete atualizado

### Bloco B — Arquivos Modificados

**Frontend:**
- `src/hooks/use-auth.ts`
- `src/lib/stores/auth.ts`
- `src/lib/api.ts` (verificar interceptors)
- `.env.local` (NEXT_PUBLIC_API_URL)
- `src/components/shell/workspace-switcher.tsx`

### Bloco C — Arquivos Modificados

**Backend:**
- `src/projects/projects.service.ts` — findMany com type/parentId, buildResponse com type/childCount
- `src/projects/projects.controller.ts` — novos query params
- `src/projects/dto/create-project.dto.ts` — type, parentId, privado
- `src/projects/dto/update-project.dto.ts` — parentId, privado
- `src/projects/dto/list-projects-query.dto.ts` — type, parentId
- `src/projects/dto/project-response.dto.ts` — type, parentId, privado, childCount
- `src/projects/project-members.service.ts` — addPrivateMember(), removePrivateMember()
- `src/auth/guards/project-scope.guard.ts` — verificar privacidade do Space raiz

**Frontend:**
- `src/hooks/use-spaces.ts` — criado
- `src/hooks/use-space-tree.ts` — criado (GET /projects/tree)
- `src/lib/types/api.ts` — SpaceDto, FolderDto, ListDto
- `src/lib/api.ts` — getSpaces(), getFolders(), getLists(), createSpace()
- `src/components/shell/app-shell.tsx` — sidebar com dados reais
- `src/app/(app)/spaces/[id]/page.tsx`
- `src/app/(app)/folders/[id]/page.tsx`
- `src/app/(app)/lists/[id]/page.tsx`

### Bloco D — Arquivos Modificados

**Backend:**
- `prisma/schema.prisma` — +1 campo dueDate em DTask
- `prisma/migrations/[ts]_add_due_date_dtask/migration.sql` — gerado
- `src/tasks/tasks.service.ts` — dueDate em CRUD + query dueDateToday
- `src/tasks/dto/create-task.dto.ts` — dueDate
- `src/tasks/dto/update-task.dto.ts` — dueDate (nullable)
- `src/tasks/dto/task-response.dto.ts` — dueDate
- `src/tasks/dto/list-tasks-query.dto.ts` — dueDateFrom, dueDateTo, dueDateToday

**Frontend:**
- `src/lib/mappers/task-status.mapper.ts` — criado
- `src/lib/types/tarefa.ts` — substituído por TaskResponseDto
- `src/lib/types/api.ts` — V3Intention, TaskResponseDto atualizado com dueDate
- `src/hooks/use-tasks.ts` — conectado a GET /tasks
- `src/lib/mocks/tarefas.ts` — marcado como deprecated
- `src/components/tasks/kanban-board.tsx`
- `src/app/(app)/tasks/page.tsx`
- `src/app/(app)/tasks/in-progress/page.tsx`
- `src/app/(app)/tasks/pending/page.tsx`
- `src/app/(app)/tasks/done/page.tsx`

### Blocos E-I — Arquivos Principais

**Bloco E:**
- Backend: `src/sprints/sprints.service.ts`, `src/sprints/dto/sprint-response.dto.ts`
- Frontend: `src/hooks/use-teams.ts`, `src/app/(app)/teams/page.tsx`

**Bloco F:**
- Frontend: `src/hooks/use-agents.ts`, `src/components/ia/agents-tab.tsx`

**Bloco G:**
- Backend: `src/eventos/core/event-producer.service.ts` (tipos de notif)
- Frontend: `src/hooks/use-notifications.ts`, `src/app/(app)/inbox/page.tsx`

**Bloco H:**
- Backend: `src/docs/docs.service.ts`, `src/docs/docs.controller.ts` (criados)
- Backend: `src/bookmarks/bookmarks.service.ts`, `src/bookmarks/bookmarks.controller.ts` (criados)
- Frontend: `src/app/(app)/docs/page.tsx`, `src/app/(app)/docs/[id]/page.tsx`

**Bloco I:**
- Frontend: `src/app/(app)/today/page.tsx`, `src/app/(app)/planner/page.tsx`

---

## 27. APÊNDICE — PERGUNTAS ABERTAS PARA O CEO (APROVAÇÃO NECESSÁRIA)

Antes de iniciar o Bloco C (Spaces/Folders/Lists), o CEO deve validar:

**P1 — Projetos legados (idClasse=-153) coexistem com Spaces?**
- Opção A: Manter compat — projetos antigos aparecem como "project" na sidebar
- Opção B: Migrar todos para Space/List na migration (mais limpo, risco maior)
- Recomendação: Opção A (compat) — migrar é ETL para F15

**P2 — Folder pode conter List diretamente (sem aninhamento de Folder)?**
- ADR-V2-051 define: Space→Folder→List E Space→List (sem Folder)
- Confirmado? Ou Space pode conter List diretamente apenas com Folder?
- Recomendação: Manter flexibilidade — Space pode ter Folder OU List diretamente

**P3 — Um Space pode ter mais de um Folder?**
- Sim, conforme ADR-V2-051
- Confirmar que não há limite de filhos

**P4 — Renomear Space/Folder/List no frontend para Espaço/Pasta/Lista?**
- Terminologia no backend: Space, Folder, List (inglês)
- Terminologia no frontend: Espaço, Pasta, Lista (português)
- Mapper de strings necessário?

**P5 — Docs ficam em `/projects/:id/docs` ou endpoint próprio?**
- Recomendação: `/projects/:id/docs` (doc é filho do Space/Folder/List)
- Alternativa: `/docs?projectId={id}` (mais genérico, Pilar 2)

**P6 — Agente pode ser vinculado a Folder ou apenas a Space e List?**
- ADR-V2-051 diz: "Space, Folder ou List"
- DVincula PROJECT_AGENT (-185) funciona para qualquer DProject
- Confirmado?

---

**Fim do Plano Macro de Integração — Backend V2 ↔ Frontend V2**

---

*Gerado por: Strategist Agent V2 em 2026-05-24*
*Próxima revisão: após conclusão do Bloco A (seed + migration validados) e aprovação CEO das P1-P6*
*Aprovação CEO necessária antes de iniciar Bloco C (hierarquia Space/Folder/List em produção)*
