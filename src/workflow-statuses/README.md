# Workflow Statuses — Pilar 2 (ADR-V2-009)

Workflow Statuses V3 são `DTabela` idClasse=-441..-449 vinculadas ao projeto.

## Statuses V3 disponíveis

| idClasse | Código | Nome |
|---|---|---|
| -441 | INBOX | Status INBOX |
| -442 | READY | Status READY |
| -443 | EXECUTING | Status EXECUTING |
| -444 | DONE | Status DONE |
| -445 | FAILED | Status FAILED |
| -446 | CANCELLED | Status CANCELLED |
| -447 | DISCARDED | Status DISCARDED |
| -448 | VALIDATING | Status VALIDATING |
| -449 | VALIDATED | Status VALIDATED |

## Usar o endpoint genérico /tabelas

```
# Listar statuses de um projeto
GET /tabelas?idClasse=-440&dEntidadeId={projectId}

# Ou filtrar por status específico
GET /tabelas?idClasse=-441&dEntidadeId={projectId}

# Editar nome de um status
PATCH /tabelas/:id

# Deletar status customizado
DELETE /tabelas/:id
```

## Endpoint de inicialização

```
POST /workflow-statuses/seed-defaults/:projectId
```

Cria os 9 statuses V3 padrão para o projeto se ainda não existirem.
Chamado automaticamente ao criar um projeto via `POST /projects`.

## Por que não há um WorkflowStatusesController completo?

Statuses são `DTabela` polimórfica — o `TabelaController` já suporta todos os filtros.
Criar um controller dedicado seria duplicar lógica (Pilar 2, ADR-V2-001, ADR-V2-009).

## Referências

- ADR-V2-009: Workflow Statuses como wrapper thin
- Seed F1: DClasses -440 a -449 em `prisma/seeds/classes.seed.ts`
- TabelaController: `src/tabelas/tabelas.controller.ts`
