# DCalendarEvent — Como Adicionar e Como Remover

**Data:** 2026-05-27  
**Contexto:** Módulo Planner do Scrumbam. Exceção documentada ao ADR-V2-001 (17 tabelas canônicas).  
**Status:** Pendente de decisão — este documento existe para que a decisão seja reversível com custo conhecido.

---

## Por que este documento existe

Adicionar `DCalendarEvent` ao banco exige uma exceção ao ADR-V2-001, que é protegida por hook automatizado (`enforce-canonical-tables.sh`). Este documento descreve os dois caminhos completos — como entrar e como sair — para que a reversão não seja uma surpresa.

---

## Parte 1 — Schema da Tabela

```prisma
// =====================================================================
// 18. DCalendarEvent — EVENTOS DE AGENDA (exceção ADR-V2-001)
// =====================================================================
// Eventos do módulo Planner: reuniões, compromissos, blocos de tempo.
// Separado de DTask por isolamento semântico: tasks do Kanban nunca
// aparecem no calendário e vice-versa.
// Exceção aprovada em: docs/decisions/CALENDAR-EVENT-DECISION.md
// =====================================================================

model DCalendarEvent {
  chave      BigInt  @id @default(autoincrement())
  idClasse   BigInt  // tipo: -210=reunião, -211=almoço, -212=ligação, etc.
  idProject  BigInt? // Space/List ao qual pertence (nullable = calendário pessoal)
  idCreator  BigInt? // → DEntidade (quem criou)
  idAssignee BigInt? // → DEntidade (responsável principal)
  idPriority BigInt? // → DTabela (prioridade)

  nome      String  @db.VarChar(512) // título do evento
  descricao String? @db.Text

  // Campos temporais — colunas reais para indexação (não JSON)
  startAt DateTime  @db.Timestamptz(6)         // início (obrigatório)
  endAt   DateTime? @db.Timestamptz(6)         // fim (null = sem hora de fim)
  allDay  Boolean   @default(false)

  // Campos de localização e videoconferência
  meetLink String? @db.VarChar(512) // Zoom, Meet, Teams
  location String? @db.VarChar(512) // endereço ou sala

  // Sincronização futura com Google Calendar — indexável
  googleEventId String? @db.VarChar(255)

  // Campos futuros (recorrência, timezone, cor, etc.)
  dados Json?

  excluido     Boolean  @default(false)
  criadoEm     DateTime @default(now()) @db.Timestamptz(6)
  atualizadoEm DateTime @default(now()) @updatedAt @db.Timestamptz(6)

  // Relations
  classe    DClasse    @relation(fields: [idClasse], references: [chave], onDelete: NoAction, onUpdate: NoAction)
  project   DProject?  @relation(fields: [idProject], references: [chave], onDelete: NoAction, onUpdate: NoAction)
  creator   DEntidade? @relation("CalendarEventCreator", fields: [idCreator], references: [chave], onDelete: NoAction, onUpdate: NoAction)
  assignee  DEntidade? @relation("CalendarEventAssignee", fields: [idAssignee], references: [chave], onDelete: NoAction, onUpdate: NoAction)

  // Índices críticos para queries de período e sincronização
  @@index([startAt, endAt])
  @@index([idAssignee, startAt])
  @@index([idProject, startAt])
  @@index([googleEventId])
  @@index([idClasse, excluido])
  @@index([excluido, startAt])
}
```

### Seeds de DClasse necessárias

Adicionar no seed canônico (chaves negativas = seeds):

```typescript
// Tipos de evento de calendário
{ chave: -210n, nome: 'Reunião',         idPai: -209n } // -209 = agrupador "Eventos"
{ chave: -211n, nome: 'Almoço',          idPai: -209n }
{ chave: -212n, nome: 'Ligação',         idPai: -209n }
{ chave: -213n, nome: 'Tarefa de Agenda',idPai: -209n }
{ chave: -214n, nome: 'Outro',           idPai: -209n }

// DVincula: participantes de evento (N:N)
{ chave: -215n, nome: 'Participante de Evento', idPai: -1n }
```

---

## Parte 2 — Como Adicionar (Passo a Passo)

### Pré-requisito: atualizar o hook

O hook `enforce-canonical-tables.sh` bloqueia qualquer escrita fora das 17 canônicas. **Antes de qualquer outro passo**, editar a linha 18:

```bash
# Arquivo: .claude/scripts/enforce-canonical-tables.sh — linha 18
# ANTES:
CANONICAL_TABLES="DClasse|DEntidade|DTabela|DVincula|DEvento|DRecurso|DUserGroup|DPermissao|DTask|DProject|DPedido|DTitulo|DMovDispo|DMovDepos|DSolicita|DRequisic|DVFS"

# DEPOIS:
CANONICAL_TABLES="DClasse|DEntidade|DTabela|DVincula|DEvento|DRecurso|DUserGroup|DPermissao|DTask|DProject|DPedido|DTitulo|DMovDispo|DMovDepos|DSolicita|DRequisic|DVFS|DCalendarEvent"
```

### Passos de implementação

```
1. [ ] Editar enforce-canonical-tables.sh (linha 18) — adicionar DCalendarEvent
2. [ ] Adicionar model DCalendarEvent em prisma/schema.prisma
3. [ ] Adicionar reverse relations em DEntidade (calendarEventsCreated, calendarEventsAssigned)
4. [ ] Adicionar reverse relation em DProject (calendarEvents)
5. [ ] Adicionar reverse relation em DClasse (calendarEvents)
6. [ ] npx prisma migrate dev --name add_dcalendarevent
7. [ ] Adicionar seeds de DClasse (-209 a -215) no seed canônico
8. [ ] Criar CalendarEventModule (NestJS): module, controller, service, DTOs
9. [ ] Criar endpoints: POST /calendar-events, GET /calendar-events, PATCH /:id, DELETE /:id
10. [ ] Registrar module em AppModule
11. [ ] Testar build: npm run build
```

---

## Parte 3 — Como Remover (Rollback Completo)

> Use este roteiro se a decisão de adicionar a tabela for revertida.  
> Estimativa de esforço: 2–4 horas de trabalho manual coordenado.

### Aviso crítico antes de começar

**Se houver dados reais na tabela em produção**, é necessário exportar ou migrar os eventos antes de dropar. O rollback abaixo assume ambiente de desenvolvimento ou tabela vazia.

```bash
# Verificar se há dados antes de prosseguir
npx prisma studio
# ou:
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"DCalendarEvent\";"
```

---

### Passo 1 — Remover código NestJS

Deletar o módulo inteiro:

```bash
rm -rf src/calendar-event/
# ou equivalente no seu editor
```

Remover o import em `src/app.module.ts`:

```typescript
// Remover esta linha:
import { CalendarEventModule } from './calendar-event/calendar-event.module';

// Remover do array imports:
CalendarEventModule,
```

---

### Passo 2 — Remover reverse relations das tabelas canônicas

Em `prisma/schema.prisma`, remover de **DEntidade**:

```prisma
// Remover estas linhas:
calendarEventsCreated  DCalendarEvent[] @relation("CalendarEventCreator")
calendarEventsAssigned DCalendarEvent[] @relation("CalendarEventAssignee")
```

Remover de **DProject**:

```prisma
// Remover esta linha:
calendarEvents DCalendarEvent[]
```

Remover de **DClasse**:

```prisma
// Remover esta linha:
calendarEvents DCalendarEvent[]
```

---

### Passo 3 — Remover o model do schema

Em `prisma/schema.prisma`, deletar o bloco completo:

```
// Deletar tudo de:
// =====================================================================
// 18. DCalendarEvent — EVENTOS DE AGENDA
// ...
// até o fechamento do model (última linha com })
```

---

### Passo 4 — Criar migration de drop

```bash
npx prisma migrate dev --name remove_dcalendarevent
```

Isso vai gerar uma migration com:

```sql
DROP TABLE "DCalendarEvent";
```

Verificar o arquivo gerado em `prisma/migrations/` antes de aplicar.

---

### Passo 5 — Remover seeds de DClasse

No arquivo de seed canônico, remover as entradas de chave `-209` a `-215` (tipos de evento e participante). Executar seed novamente se necessário:

```bash
npx prisma db seed
```

---

### Passo 6 — Reverter o hook

Editar `.claude/scripts/enforce-canonical-tables.sh` linha 18, removendo `DCalendarEvent`:

```bash
# REVERTER PARA:
CANONICAL_TABLES="DClasse|DEntidade|DTabela|DVincula|DEvento|DRecurso|DUserGroup|DPermissao|DTask|DProject|DPedido|DTitulo|DMovDispo|DMovDepos|DSolicita|DRequisic|DVFS"
```

---

### Passo 7 — Verificação final

```bash
npm run build          # zero erros TypeScript
npm run lint           # zero erros ESLint
npx prisma validate    # schema válido
npx prisma db pull     # confirmar que tabela sumiu do banco
```

---

## Resumo de Arquivos Afetados

| Arquivo | Na adição | Na remoção |
|---|---|---|
| `.claude/scripts/enforce-canonical-tables.sh` | Adicionar `DCalendarEvent` | Remover `DCalendarEvent` |
| `prisma/schema.prisma` | Adicionar model + reverse relations | Remover model + reverse relations |
| `prisma/migrations/` | Nova migration de CREATE | Nova migration de DROP |
| `prisma/seed.ts` (ou equivalente) | Seeds -209 a -215 | Remover seeds -209 a -215 |
| `src/calendar-event/` | Criar diretório e módulo | Deletar diretório inteiro |
| `src/app.module.ts` | Importar CalendarEventModule | Remover import |

---

## Decisão em Aberto

Este documento não toma a decisão — apenas torna o custo de cada caminho transparente:

- **Adicionar e manter:** ~6–10h de implementação. Dívida técnica zero para queries de período e sync futura com Google Calendar.
- **Usar DTask + JSON enquanto decide:** 0h agora, dívida técnica crescente com volume e quando Google Calendar entrar.
- **Adicionar e depois reverter:** ~2–4h de rollback manual, sem risco de perda de dados se feito antes de ter dados em produção.

---

*Documento criado em 2026-05-27. Atualizar se a estrutura do módulo ou os seeds mudarem durante a implementação.*
