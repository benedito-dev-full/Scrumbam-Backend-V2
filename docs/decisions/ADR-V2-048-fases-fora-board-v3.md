# ADR-V2-048: Fases (DTask idClasse=-200) ficam FORA do board V3 — status é derivado

**Status:** Proposed
**Data:** 2026-05-21
**Decisores:** CEO + Strategist Agent V2 + Implementer Agent V2 (F9a)
**Tags:** #V2 #pós-F8 #tasks #v3-intentions #hierarquia #ADR-V2-047

---

## Contexto e Problema

ADR-V2-047 introduziu Fases/Blocos como `DTask` com `idClasse=-200` e self-FK `idPai`. Toda DTask possui campos `idStatus` (FK para DTabela) e `dados.v3.state` (estado canônico do board V3 INBOX..VALIDATED). Isso cria uma ambiguidade semântica:

- **Tasks-folha** (`idClasse=-154` SCRUMBAN_TASK): têm `state` próprio. Frontend e MCP movem entre INBOX → READY → EXECUTING → DONE/FAILED/CANCELLED/DISCARDED/VALIDATING/VALIDATED.
- **Fases** (`idClasse=-200` PHASE): NÃO têm state próprio. Conceitualmente, o "status" de uma fase é **derivado da agregação** de tasks-folha descendentes (`percent` calculado por `PhaseMetricsService.compute`, F5).

Se o backend permitir `PATCH /tasks/:id/status` em um registro PHASE, criamos 3 problemas:

1. **Inconsistência semântica:** o `dados.v3.state` da fase divergiria do `percent` agregado (ex.: fase com 100% das filhas DONE poderia ter `state='INBOX'`).
2. **Emissão indevida de `phase.completed`:** o detector idempotente da F8 (`TasksService.detectPhaseCompletion`) só dispara quando uma TASK FOLHA cruza DONE; mas se a fase aceitasse status, alguém poderia "completar a fase" sem nenhuma filha pronta.
3. **Confusão do frontend recursivo:** componente único que renderiza Fase + Task polimorficamente precisa distinguir "tem status próprio?" — se backend silenciosamente aceita PATCH, FE acaba duplicando lógica.

Hoje (`tasks.service.ts:646-799`), `updateStatus` NÃO verifica `task.idClasse`. Roda normalmente em PHASE, escrevendo `dados.v3.state` e atualizando `idStatus`. Não há nenhuma guard contra esse uso indevido.

## Decisão

**Bloquear `PATCH /tasks/:id/status` quando `task.idClasse === -200` (PHASE)** com `BadRequestException`.

Mensagem clara: `"Fase não tem status próprio — use GET /tasks/:id/metrics para consultar percent agregado."`

Frontend deve renderizar:
- **Fase:** `percent` agregado (PhaseMetricsService.compute) — barra de progresso, NÃO badge de status.
- **Task-folha:** `dados.v3.state` — board V3 normal.

### Por que bloquear (e não tolerar)

| Alternativa | Avaliação |
|-------------|-----------|
| Tolerar (deixar como está) | **Rejeitado.** Vetor de bug futuro: FE recursivo pode chamar por engano em nó PHASE. Inconsistência silenciosa entre `state` e `percent`. |
| Bloquear no service (✅ escolhido) | Defensivo, barato (1 condição), reversível, mensagem clara guia o FE. |
| Bloquear no controller (DTO/validation) | Custo equivalente, mas service é o ponto canônico de regra de domínio. Tests cobrem service primeiro. |
| Permitir mas sobrescrever (ex.: PHASE sempre INBOX) | Confusão maior — `state` mentiroso. Pior que erro explícito. |

## Conformidade com Pilares Devari-Core

- **Pilar 1 (Engine):** N/A — não toca DPedido.
- **Pilar 2 (Endpoints genéricos):** preservado — sem novo controller. Apenas guard no service existente.
- **Pilar 3 (Seed):** preservado — sem nova DClasse, sem nova DTabela.

## Cross-link

- **ADR-V2-047 (Fases via DTask.idPai)** — define `idClasse=-200` PHASE e a regra "% conclusão é derivada". Esta ADR formaliza a consequência operacional no board V3.
- **F5 (ADR-V2-047)** entregou `GET /tasks/:id/metrics` — endpoint canônico de consulta do percent. Mensagem de erro do `BadRequestException` aponta para ele.
- **F8 (ADR-V2-047)** entregou o detector idempotente `phase.completed`. Esta guard reforça que `phase.completed` só nasce do agregado, nunca de mutação direta.

## Impacto no Frontend

**Breaking change:** se algum cliente HTTP/MCP hoje chamar `PATCH /tasks/:id/status` em PHASE, passará a receber `400 BadRequest`. Mitigação:

1. Mensagem aponta para `/tasks/:id/metrics`.
2. MCP `update_status` (Block D) já assume "task" — sem chamada conhecida sobre fase.
3. Frontend recursivo da F9b deve renderizar fase com barra de progresso, não dropdown de status.

Status code documentado em Swagger (`@ApiResponse({status: 400})`).

## Pendente para v2

- Permitir "cancelar fase inteira" via endpoint próprio (`PATCH /tasks/:id/cancel-phase`) que faz soft-delete em cascata. Hoje, cancelamento usa `DELETE /tasks/:id?cascade=true` (F3).

---

**Maintained by:** Devari Tecnologia
**Versão:** 1.0
**Última atualização:** 2026-05-21
