# Sprints — Pilar 2 (ADR-V2-009)

Sprints são `DTabela` idClasse=-400 vinculadas ao projeto via `dEntidadeId`.

## Como usar o endpoint genérico /tabelas

Use o endpoint genérico `/tabelas` — nenhum endpoint `/sprints` existe (intencional).

### Listar sprints de um projeto

```
GET /tabelas?idClasse=-400&dEntidadeId={projectId}
```

### Criar sprint

```
POST /tabelas
{
  "idClasse": "-400",
  "dEntidadeId": "projectId",
  "nome": "Sprint 2"
}
```

### Editar sprint

```
PATCH /tabelas/:id
{
  "nome": "Sprint 2 - Revisado"
}
```

### Deletar sprint

```
DELETE /tabelas/:id
```

## Por que não há SprintsController?

Sprints são `DTabela` polimórfica — o `TabelaController` já suporta todos os
filtros necessários via `?idClasse=-400&dEntidadeId={projectId}`.

Criar um `SprintsController` separado seria duplicar lógica já existente,
violando o Pilar 2 do Devari-Core (ADR-V2-001, ADR-V2-009).

## Sprints padrão por projeto

Ao criar um projeto via `POST /projects`, dois sprints padrão são criados
automaticamente:
- "Sprint 1" (ativo)
- "Backlog" (backlog permanente)

## Referências

- ADR-V2-009: Sprints e Workflow Statuses como wrappers thin sobre /tabelas
- Seed F1: DClasse -400 (SPRINT) em `prisma/seeds/classes.seed.ts`
- TabelaController: `src/tabelas/tabelas.controller.ts`
