# ADR-V2-057: Timer manual de tempo por tarefa via dados.telemetry.manualTimers (por usuário, server-side)

**Status:** Aceito
**Data:** 2026-06-01
**Decisores:** Strategist Agent V2 + CEO
**Tags:** #V2 #F5 #tasks #telemetry #frontend-hierarquia

---

## Contexto e Problema

Gestores precisam saber quanto tempo cada humano trabalhou numa task. O backend já abre/fecha
`workSessions` automaticamente atrelado ao status EXECUTING/DONE — mas isso passou a ser
exclusivo do fluxo de IA (ADR-V2-005/006: Engine só em DPedido). É preciso um timer manual
(play/pause/resume/stop), por usuário, sem:

1. Criar tabela nova (ADR-V2-001)
2. Corromper as métricas de cycle-time/lead-time existentes
3. Confiar no relógio do navegador (anti-fraude)

**Motivação:**
- Gesto executivo: "Fulano levou 2h, Beltrano 45min nesta task"
- Entrada diária via sidebar (controle manual)
- Persistência imediata em pause/stop (não acumula no cliente)
- Total computado 100% server-side (impossível falsificar duração)

---

## Alternativas Consideradas

### Alternativa A (ESCOLHIDA): Array dedicado `manualTimers[]` em `DTask.dados.telemetry`

**Prós:**
- Separação total manual × IA — `workSessions[]` fica exclusivamente para IA
- Zero regressão em cycleTime/leadTime (arrays separados, lógica inalterada)
- Zero tabela nova (Json em coluna existente DTask.dados)
- Agregação por usuário trivial (map/reduce do array)
- Portável ao template como padrão de telemetria

**Contras:**
- Dois arrays de sessão coexistem em telemetria (exige JSDoc claro da semântica)

### Alternativa B: Reusar `workSessions[]` com flag `source: 'ai' | 'human'`

**Rejeitada.**

**Razão:** O código em `tasks.service.ts` linhas ~1101–1134 (`updateStatus` ao mover para
EXECUTING/DONE) fecha "a última sessão aberta" sem filtro de origem. Se reutilizasse
`workSessions[]` para humano também, o fechamento automático da IA correria o risco de
fechar uma sessão manual por engano, corrompendo `cycleTime`. Exigiria reescrever
múltiplos pontos do fluxo com filtro `source = 'ai'` — alto risco de regressão.
Impactaria 8 testes de fluxo existentes e criaria dívida técnica.

### Alternativa C: DEvento por start/stop e agregar via query

**Rejeitada para o ESTADO; mantida como audit trail opcional em paralelo.**

**Razão:** Agregação de totais por usuário vira query custom a cada GET de task (risco
N+1 / custo de performance). "Sessão aberta" fica difusa em eventos. Overkill para
1 timer por task (regra de negócio).

**Mantida como:** Emissão de DEvento de auditoria (`timer.paused`/`timer.stopped`) pós-
persistência, reusando classe de audit existente (SHOULD-HAVE, não bloqueante).

---

## Decisão

### 1. Estrutura de Dados (Pilar 1: ZERO tabela nova)

Timer manual vive **exclusivamente** em `DTask.dados.telemetry.manualTimers[]`:

```typescript
// src/tasks/schemas/task-dados.schema.ts
export interface ManualTimerSession {
  userId: string;        // DEntidade.chave (req.user.entidadeId — do JWT, jamais do body)
  startedAt: string;     // ISO, gravado server-side no start
  endedAt?: string;      // ISO, gravado server-side no pause/stop
  durationMs?: number;   // endedAt - startedAt (calculado server-side — anti-fraude)
}

export interface TelemetryData {
  // ... campos existentes (baseFields, customFields, etc.)
  workSessions?: WorkSession[];        // INTOCADO — semanticamente "sessões de IA"
  manualTimers?: ManualTimerSession[]; // NOVO — sessões manuais por humano
}
```

**Invariante crítica:** `workSessions[]` continua sendo aberto/fechado **APENAS** pelo
fluxo IA em `updateStatus` (EXECUTING → DONE). **NUNCA é tocado pelo timer manual.**
`cycleTime`/`leadTime` derivam **SÓ** de `workSessions[]` + timestamps de transição de status.

### 2. Endpoints REST (Pilar 2: Reuso de controller)

Sob `/tasks` (controller próprio já autorizado — zero novo controller):

| Método | Rota | Efeito |
|--------|------|--------|
| `POST` | `/tasks/:id/timer/start` | Abre `manualTimers` para `req.user.entidadeId`. 409 se já há sessão aberta (1-timer-por-task). |
| `POST` | `/tasks/:id/timer/pause` | Fecha sessão aberta: grava `endedAt` + `durationMs` server-side. Persiste imediato. |
| `POST` | `/tasks/:id/timer/resume` | Abre nova sessão (alias semântico de start; explícito para clareza de UI). |
| `POST` | `/tasks/:id/timer/stop` | Fecha sessão aberta (igual pause). Semanticamente "encerrei o trabalho agora". |

**Resposta de todos:** `TaskResponseDto` atualizado com `timer` agregado.

**Tenant gate:** Igual a `updateStatus` (resolveScopedProjectIds + 404 anti-enumeration).

**Validações:**
- 409 Conflict: já há sessão aberta do mesmo user (bloqueio 1-timer-por-task)
- 409 Conflict: não há sessão aberta do user (pause/resume/stop sem start)
- 404 Not Found: task fora de scope ou não existe (tenant isolation)

### 3. DTOs de Resposta (Pilar 2: Sem novo endpoint)

Adicionado a `TaskResponseDto`:

```typescript
export class TaskTimerStateDto {
  running: boolean;                   // há sessão aberta?
  runningUserId: string | null;       // quem está com o timer aberto
  runningStartedAt: string | null;    // ISO — front usa para cronômetro visual (offset)
  totalsByUser: TaskTimerUserTotalDto[];  // agregação por usuário (somatório durationMs)
}

export class TaskTimerUserTotalDto {
  userId: string;         // DEntidade.chave
  userName: string | null;  // hidratado de DEntidade.nome (batch — ZERO N+1)
  totalMs: number;        // soma server-side de durationMs (sessões fechadas)
}

// Em TaskResponseDto:
timer: TaskTimerStateDto | null;  // null se nunca houve timer
```

### 4. Serviço (TaskTimerService)

Lógica isolada em `src/tasks/services/task-timer.service.ts`:

- `start()`: abre sessão, bloqueia 2ª sessão simultânea
- `pause()`: fecha, grava `durationMs = now - startedAt` (server-side)
- `resume()`: abre nova (idêntico a start)
- `stop()`: fecha (idêntico a pause)
- Agregação batch de nomes (`DEntidade.findMany` para N usuários — ZERO N+1)

**Pilar 1 — Engine NÃO se aplica:**
DTask é tabela estrutural (cadastro). Persistência via Prisma direto + Service.
Engine (`OperacaoExecucaoClaude`) permanece exclusivo de DPedido idClasse=-300..-303.
Timer manual nunca cria DPedido.

**Anti-fraude:**
- `userId` vem **SEMPRE** do JWT (`req.user.entidadeId`), **NUNCA** do body
- `durationMs` calculado com `Date` do servidor no pause/stop — cliente nunca envia duração
- `runningStartedAt` devolvido permite cronômetro visual, mas o `totalMs` gravado é server-side

### 5. Regra: 1 Timer Aberto por Task

Uma task pode ter no máximo 1 sessão de timer aberta em qualquer momento. Se Fulano
abre o timer às 14h e não fecha, Beltrano que tenta abrir às 15h recebe 409:

```
409 Conflict: Já existe um timer em andamento nesta task
```

**Mitigação para sessão fantasma:** O painel exibe "timer aberto por Fulano desde X",
deixando explícito quem tem a sessão aberta. Resume está disponível para retomar.
Auto-close por TTL fica fora de escopo (WILL-NOT-HAVE — reavaliar depois).

### 6. Fases de Entrega

**Fase 1 — Backend (BLOQUEANTE para Fase 2):**
- Schema: `ManualTimerSession` + `manualTimers?` em `TelemetryData` (JSDoc semântica IA × humano)
- Service: `TaskTimerService` com Prisma direto, tenant gate, 1-timer, agregação batch
- DTOs: `TaskTimerStateDto`, `TaskTimerUserTotalDto`, `timer` em `TaskResponseDto`
- Controller: 4 handlers (`/timer/start|pause|resume|stop`) com Swagger
- Tests: unit (aritmética, 1-timer, 409s) + integração (endpoints + tenant)
- **Teste de regressão obrigatório:** criar timer manual aberto, mover task EXECUTING→DONE,
  assertar que `cycleTime`/`leadTime` derivam SÓ de `workSessions[]` e timer fica intacto
- `make build` verde + lint 0 warnings
- **DoD:** endpoints funcionais, total server-side correto, Reviewer ≥8.0, aval CEO

**Fase 2 — Frontend (painel no sidebar):**
- `use-task-timer.ts`: mutations (4) + cronômetro visual via `setInterval`
- `task-timer-panel.tsx`: painel reusando padrão `AiExecutionPanel`
- `<TaskTimerPanel />` montada no drawer
- Verificação manual: play/pause/resume/stop → total persiste após refresh
- **DoD:** botões funcionam, cronômetro fluido, total bate com servidor, design coerente, Reviewer ≥8.0, **aval visual CEO**

**Fase 3 — Coluna "Tempo gasto" na grade Blocos (builtin read-only):**
- 7ª coluna builtin `timeSpent` (read-only, computada server-side)
- Materializada por `mergeBuiltinColumns` sem quebrar reorder
- Exibe total agregado por task; clicar não abre editor
- Flag `readOnly?: boolean` em `ColumnDefDto` (novo flag, não novo ColumnType)
- **DoD:** coluna aparece na grade, merge/reorder preservados, sem editor, sem gravação em `dados.fields`, Reviewer ≥8.0, **aval visual CEO**

---

## Consequências

### Positivas
- **Zero tabela nova** (Json em coluna existente de DTask — ADR-V2-001 respeitado)
- **Métricas de IA intactas** (workSessions[] + fluxo EXECUTING/DONE inalterado)
- **Tempo per-usuário** auditável e à prova de fraude (server-side 100%)
- **Reuso de estrutura** (não cria controller novo, reutiliza /tasks)
- **Portável ao template** como padrão de telemetria (conceito genérico)
- **Simples de estender** (nova ação = novo handler + método no service)

### Negativas
- **Dois arrays na telemetria** (workSessions + manualTimers) — exige JSDoc claro e
  disciplina do dev (MITIGADO: comentários extensos no schema e nas queries)
- **Sessão "fantasma" possível** (usuário fecha aba sem stop) — bloqueia novo start do mesmo
  user até close manual. Painel deixa explícito quem tem aberto. Auto-close fica fora de
  escopo (WILL-NOT-HAVE) — reavaliar em fase futura com TTL ou política de limpeza

---

## Implementação

### Fase 1 (Backend) — Concluída (2026-06-01, Score 8.7/10 APPROVED)

**Arquivos criados:**
- `src/tasks/services/task-timer.service.ts` — lógica de start/pause/resume/stop
- `src/tasks/dto/task-timer-response.dto.ts` — DTOs do timer
- `src/tasks/__tests__/task-timer.service.spec.ts` — testes unitários (aritmética, 1-timer, 409s)
- `src/tasks/__tests__/task-timer.integration.spec.ts` — integração HTTP dos 4 endpoints

**Arquivos modificados:**
- `src/tasks/schemas/task-dados.schema.ts` — `ManualTimerSession` + `manualTimers?` em `TelemetryData`
- `src/tasks/dto/task-response.dto.ts` — adicionado `timer: TaskTimerStateDto | null`
- `src/tasks/tasks.service.ts` — `buildResponse` popula `timer` (agregação batch, **sem tocar EXECUTING/DONE**)
- `src/tasks/tasks.controller.ts` — 4 handlers `/timer/{start,pause,resume,stop}` + Swagger
- `src/tasks/tasks.module.ts` — registrado `TaskTimerService`

**Validações (commit 2026-06-01):**
- `npm test` — 14 unit + 6 integration PASS
- `npm run build` — tsc 0 errors, eslint 0 warnings
- Teste de regressão: cycleTime/leadTime inalterado quando há timer manual aberto durante EXECUTING→DONE
- Hook `validate-documentation.sh` — JSDoc completo, status atualizado

**Score:** 8.7/10 (Reviewer aprovado, aval CEO 2026-06-01)

### Fases 2 e 3 — Pendentes (parágrafo abaixo do ADR)

Agenda conforme plano. Não iniciar sem aval de Fase 1.

---

## Validação (Enforçamentos)

| Validação | Hook / Teste | Status |
|-----------|-------------|--------|
| ZERO tabela nova (ColumnDef DTask.dados.telemetry) | `enforce-canonical-tables.sh` | ✅ Sem migration |
| workSessions + manualTimers separados (invariante) | `task-timer.integration.spec.ts` | ✅ 6 testes PASS |
| durationMs calculado server-side (anti-fraude) | `task-timer.service.spec.ts` | ✅ 14 testes PASS |
| cycleTime/leadTime inalterados com timer aberto | Regressão integração | ✅ PASS |
| JSDoc de separação IA × humano | `validate-documentation.sh` | ✅ Completo |
| Scope `/tasks` reutilizado (Pilar 2) | Reviewer manual | ✅ Aprovado |

---

## Notas Adicionais

### Sobre Fase 3 (coluna na grade)

A Fase 3 introduz uma **coluna builtin read-only** que EXIBE o total já computado na Fase 1.
A decisão de reuse `type: 'text'` + `readOnly: true` (vs criar novo ColumnType `duration`)
pertence ao **ADR-V2-056-delta** (extensão ao mecanismo de colunas builtin), não aqui.
Este ADR governa APENAS a camada DADO (manualTimers[], agregação, anti-fraude).

**Cross-link:** ADR-V2-057 (timer DADO) ← → ADR-V2-056-delta (timer VISUAL em coluna).

### Sobre Audit Trail (SHOULD-HAVE)

Emissão de DEvento `timer.paused`/`timer.stopped` é SHOULD-HAVE, não bloqueante:
- Reusar classe de audit existente (idClasse=-489 AUDIT_GENERIC via ADR-V2-026)
- Payload: `{ taskId, userId, durationMs }`
- Ordem crítica: persistir timer → emitir evento (devari-backend-patterns §7)
- Implementável post-Fase 1 sem risco

---

## Referências

- **Plan:** `workspace/plans/plan-tasks-timer-tempo-por-tarefa-task57.md`
- **Review:** Score 8.7/10 APPROVED (Reviewer Agent V2, 2026-06-01)
- **ADRs correlatos:**
  - ADR-V2-001 (zero tabela nova — respeitado)
  - ADR-V2-005/006 (Engine exclusivo DPedido — timer não toca)
  - ADR-V2-047 (soft-delete + event audit — padrão dEvento)
  - ADR-V2-056-delta (coluna builtin read-only — Fase 3)
- **Pilares V2:**
  - Pilar 1 (Engine): N/A — DTask é estrutural
  - Pilar 2 (Endpoints): Reutiliza `/tasks`
  - Pilar 3 (Seed): Zero DClasse nova

---

**Status:** Aceito (CEO 2026-06-01, após review 8.7/10)
**Próximo passo:** Iniciar Fase 2 após aval visual do CEO na Fase 1
