---
name: F5 Domain Structural — Score e Padrões Identificados
description: Score histórico e patterns encontrados no review de F5 (Orgs, Teams, Projects, Tasks, Sprints/WF wrapper thin)
type: project
---

# F5 — Domínio Estrutural Scrumban-V2

**Data do review:** 2026-05-09
**Score:** 8.0/10
**Decisão:** APPROVED

## O que estava correto

- 3 Pilares respeitados integralmente
- Engine ZERO em F5 (100% estrutural — DProject, DTask, DEntidade, DVincula)
- Seed correto: 130 classes (45 fixas + 85 específicas), todas negativas, validateHierarchy em import time
- DClasses corretas: -153 em projects.service, -154 em tasks.service
- $transaction em todos os creates multi-tabela
- Eventos (auditService.log) APÓS commit
- TeamRolesGuard funcional via DVincula -181 (não stub)
- State machine V3 com 9 estados + 50 cenários testados
- Identifier atômico DEV-N via DTabela -475 dentro de $transaction
- Wrapper thin correto: SprintsModule = zero controller, só README + módulo thin
- WorkflowStatusesController = apenas POST /seed-defaults/:projectId
- 189/189 testes passando

## Issues encontrados (desconto)

- **parseInt(limit, 10)** em 4 controllers (organizations, teams x2, projects) para limit de paginação — padrão deve ser `Number()` ou DTO com @Type(() => Number). Desconto -0.5
- **seed-bootstrap.service.ts** usa for...of com await individual para 9 INSERTs (createMany seria mais eficiente). Desconto -0.5
- **TeamsService** não injeta AuditService — operações de time não geram DEvento audit (inconsistente com orgs e projects). Desconto -0.5
- **Testes de concorrência** do identifier usam mock local, não banco real. Aceitável para unit, mas não cobre race condition real. Desconto -0.5

## Padrões a verificar em futuras fases

1. Quando controllers recebem query params numéricos (limit, page), verificar se usam DTO com @Type(() => Number) em vez de parseInt inline
2. createMany é preferível a for...of com awaits individuais em seed bootstraps
3. Todos os services devem injetar AuditService se a funcionalidade gera eventos auditáveis

**Why:** F5 é a primeira fase com domínio estrutural complexo (RBAC multi-nível, state machine, identifier atômico). Score 8.0 é sólido — issues são de qualidade, não de integridade.
**How to apply:** Em F6 (Engine + DVFS), verificar que OperacaoExecucaoClaude NÃO aparece em módulos estruturais. Em F7+ verificar padrão parseInt vs Number para query params de paginação.
