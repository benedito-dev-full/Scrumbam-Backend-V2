# ADR-V2-032: DEvento.excluido para soft delete de notifications

**Status:** Aceito
**Data:** 2026-05-10
**Decisores:** CEO/usuario na conversa principal, Strategist Agent V2, Reviewer Agent V2
**Tags:** #V2 #fase-F7 #notifications #eventos #schema-exception

---

## Contexto e Problema

F7 Task #3 expos endpoints `/notifications/*` para leitura e mutacao de notificacoes in-app persistidas como `DEvento.idClasse=-490`, conforme ADR-V2-008.

O contrato de produto exige que o usuario possa excluir uma notificacao da UI sem apagar o historico estrutural de eventos. O model `DEvento` original nao tinha campo `excluido`, enquanto as queries de notifications precisam de um soft delete claro e consistente:

- `DELETE /notifications/:id` nao deve fazer hard delete de `DEvento`.
- `GET /notifications` e `GET /notifications/unread-count` devem ignorar notificacoes excluidas.
- `PATCH /notifications/:id/read` e `PATCH /notifications/read-all` nao devem operar sobre registros excluidos.
- `NotificationConsumer` precisa permitir recriar uma notificacao equivalente se a anterior foi excluida logicamente.

A conversa principal autorizou explicitamente em 2026-05-10 uma excecao pontual para adicionar somente `DEvento.excluido Boolean @default(false)`.

## Alternativas Consideradas

### Opcao 1: Nao implementar delete nesta task

**Pros:** zero alteracao de schema.
**Contras:** deixa incompleto o contrato `/notifications/*` planejado para a UI e empurra uma decisao simples para task futura.

### Opcao 2: Hard delete de `DEvento`

**Pros:** simples de implementar.
**Contras:** perde trilha estrutural de notificacoes, cria risco operacional e conflita com o papel de `DEvento` como registro canonico de eventos.

### Opcao 3: Soft delete em `metaDados.deletedAt`

**Pros:** zero migration.
**Contras:** cria semantica de delete escondida em JSON, dificulta filtros consistentes e torna idempotencia dependente de convencao de payload.

### Opcao 4: Adicionar `DEvento.excluido Boolean @default(false)`

**Pros:** soft delete explicito, filtros simples, alinha `DEvento` ao padrao estrutural usado em outras tabelas canonicas e resolve a idempotencia pos-delete.
**Contras:** altera schema; exige autorizacao explicita e registro de nao-precedente.

## Decisao

**Escolhemos:** Opcao 4 - adicionar `DEvento.excluido Boolean @default(false)`.

Esta e uma excecao pontual autorizada pelo usuario na conversa principal em 2026-05-10. A autorizacao vale somente para esta coluna em `DEvento` e somente para suportar soft delete dos endpoints de notifications.

Esta ADR nao altera a regra geral do V2:

- zero tabela nova continua inviolavel;
- qualquer nova coluna futura ainda exige plano, ADR e autorizacao explicita;
- seeds e DClasses continuam fora do escopo desta decisao.

## Consequencias

**Positivas:**

- `DELETE /notifications/:id` passa a ser soft delete por `DEvento.excluido=true`.
- Listagem, contagem, mark-read, mark-all-read e delete filtram `excluido=false`.
- `NotificationConsumer` filtra `excluido=false` no lookup de idempotencia, permitindo recriacao quando a notificacao anterior foi excluida.
- A migration e pequena e sem quebra: registros existentes recebem `false` por default.

**Negativas:**

- O schema deixa de ser estritamente imutavel nesta task.
- Reviews futuros precisam impedir que esta excecao vire precedente informal para novas colunas sem ADR.

## Implementacao

- Fase V2: F7
- Task: F7 Task #3 - Notifications endpoints `/notifications/*`
- Migration: `prisma/migrations/20260510120000_add_devento_excluido/migration.sql`
- Schema: `prisma/schema.prisma`, model `DEvento`
- Campo: `excluido Boolean @default(false)`
- Controller: `src/notifications/notifications.controller.ts`
- Service: `src/notifications/notifications.service.ts`
- Consumer ajustado: `src/eventos/consumers/notification.consumer.ts`

Migration autorizada:

```sql
ALTER TABLE "DEvento" ADD COLUMN "excluido" BOOLEAN NOT NULL DEFAULT false;
```

## Referencias

- Plano: `workspace/plans/plan-notifications-endpoints-f7-task3.md`
- Impl notes: `workspace/implementations/impl-notifications-endpoints-f7-task3.md`
- Review: `workspace/reviews/review-notifications-endpoints-f7-task3.md`
- Migration: `prisma/migrations/20260510120000_add_devento_excluido/migration.sql`
- ADR relacionada: ADR-V2-008 (`DEvento` substitui `DNotification`/`DWebhook`)
- ADR relacionada: ADR-V2-029 (idempotencia de notificacoes antes desta excecao)
