# ADR-V2-023 — Ajustes pre-F1 ao schema canonico (relations FK em DTask/DProject/DPedido)

**Status:** Aceito
**Data:** 2026-05-08
**Decisores:** Strategist (Plano F1, §5 Fase 0.1) e Implementer (executor)
**Tags:** `#fundacao` `#schema` `#prisma` `#integridade-referencial`

---

## Contexto e Problema

A auditoria do schema F0 (commit 690d7c1) identificou que 3 colunas
referenciais em tabelas canonicas estavam declaradas como `BigInt?`
sem `@relation` correspondente — ou seja, FKs implicitas sem
integridade referencial enforced no banco:

1. **DTask.idAssignee** → DEntidade (User) — sem FK.
2. **DTask.idCreator** → DEntidade (User) — sem FK.
3. **DProject.idEstab** → DEntidade (Organizacao) — sem FK.
4. **DPedido.idLocEscritu** → DEntidade — sem FK.

Sem FK, o banco aceita IDs invalidos (entidades inexistentes), o Prisma
client nao gera tipos relacionais, e queries com `include` ficam
incompletas. Para o Scrumban-V2 isso e regressao silenciosa: a primeira
implementacao que tentar `include: { assignee: true }` em DTask
descobrira que a relation nao existe.

---

## Alternativas Consideradas

### Alternativa A — Adicionar 3 relations explicitas ANTES da migration inicial F1

Editar `prisma/schema.prisma` em Fase 0.1 da Task #1 para adicionar:

- `DTask.assignee  DEntidade? @relation("TaskAssignee", fields: [idAssignee], references: [chave], ...)`
- `DTask.creator   DEntidade? @relation("TaskCreator",  fields: [idCreator],  references: [chave], ...)`
- `DProject.estab  DEntidade? @relation("ProjectEstab", fields: [idEstab],   references: [chave], ...)`
- `DPedido.locEscritu DEntidade? @relation("PedidoLocEscritu", fields: [idLocEscritu], references: [chave], ...)`

Mais relations reversas em `DEntidade` (`tasksAssigned`, `tasksCreated`,
`projetos`, `pedidosAsLocEscritu`).

**Pros:**
- Integridade referencial completa em todas as colunas que devem ser FK.
- Prisma client gera tipos relacionais (`include: { assignee: true }`).
- F2 e F5 ja recebem schema completo — sem retrabalho.
- 4 alteracoes mecanicas em ~1h trabalho.

**Contras:**
- Adiciona 3 alteracoes ao schema antes do seed.

### Alternativa B — Adiar relations para F2/F5 quando services consumirem

**Pros:**
- F1 menor.

**Contras:**
- Reviewer pode rejeitar por inconsistencia (DEntidade tem relation com
  DUserGroup, mas DTask nao tem com DEntidade).
- FKs viram ponto de bug futuro.
- Migration F2 vira ALTER TABLE com riscos (vs CREATE TABLE limpo).

### Alternativa C — Reescrever schema do zero

Descartada de imediato — F0 ja entregou schema validado em commit 690d7c1.
Descartar trabalho aprovado e arriscado e desnecessario.

---

## Decisao

**Adotada Alternativa A.** 4 alteracoes (3 do plano + 1 reversa para
DPedido) aplicadas em commit isolado antes da geracao da migration
`initial_canonical`.

---

## Consequencias

**Positivas:**
- Schema canonico do V2 nasce com integridade referencial completa.
- Prisma client gera tipos prontos para F2/F5.
- Migration `<ts>_initial_canonical` ja inclui as constraints FK.

**Negativas:**
- Nenhuma identificada — alteracoes sao mecanicas e nao afetam
  comportamento de inserts existentes.

**Implementacao:**
- `prisma/schema.prisma` editado em 4 lugares (DEntidade reverse,
  DTask, DProject, DPedido).
- `npx prisma format && npx prisma validate` passou sem warning.
- `npx prisma migrate dev --name initial_canonical` gerou migration limpa
  com `FOREIGN KEY` para as 4 colunas.

**Comandos validados:**
```bash
npx prisma format    # ok
npx prisma validate  # ok (apos DATABASE_URL setado)
npx prisma generate  # ok
npx prisma migrate dev --name initial_canonical  # aplicada
```
