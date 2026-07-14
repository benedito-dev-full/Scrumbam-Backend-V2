# ADR-V2-073: Trava de Concorrência MCP por workSession

**Status:** Aceito
**Data:** 2026-07-10
**Decisores:** Strategist Agent V2 + CEO Roberio (decisões 2026-07-10)
**Tags:** #V2 #F8-mcp #F11-hardening #task-794-DEV-123

---

## Contexto e Problema

**Incidente real (2026-07-07):** Dois agentes MCP tentaram trabalhar a mesma task simultaneamente, causando race conditions e estado inconsistente. A aplicação não tinha mecanismo para evitar ou detectar essa situação.

**Requisito:** Impedir que DOIS ATORES diferentes trabalhem a mesma task pelo MCP simultaneamente, enquanto permite que o MESMO ator retome sua própria task de forma legítima. Humanos continuam podendo trabalhar via UI sem bloqueio (MCP-only).

**Escopo:** 5 tools MCP de escrita que podem mover a task: `update_task`, `update_status`, `update_timer` (com exceção), `execute_task`, `delete_task`.

---

## Alternativas Consideradas

### Opção A — Trava no Engine (rejeita HTTP+MCP)
Implementar bloqueio diretamente em `TasksService.updateStatus()` ou `updateTask()`.

**Prós:**
- Consistência absoluta (ninguém trabalha a task, humano ou máquina)

**Contras:**
- Afeta HUMANOS via UI (bloquearia um usuário legítimo retomando sua própria task)
- Viola escopo ("apenas MCP não pode"; UI humana deve permanecer livre)
- Blast radius alto (mudança central vs periférica)
- Contradiz ADR-V2-057 (timer manual humano continuaria sendo bloqueado)

**Decisão:** Rejeitada (escopo incompatível).

### Opção B — Trava no Guard MCP (escolhida ✓)
Implementar bloqueio como `TaskConcurrencyGuard` — função/serviço chamado PELOS tools MCP, não central no Engine.

**Prós:**
- MCP-only: humanos via UI não são afetados
- Blast radius mínimo: política isolada na camada MCP
- Retomada legítima (mesmo ator) funciona
- Fácil de ativar/desativar por tool (ex: `update_timer` isento, decisão #3)

**Contras:**
- TOCTOU possível entre dois callers MCP simultâneos (risco residual de ms)
  → **Aceito:** incidente real foi minutos, não milissegundos; mutex transacional seria overhead

**Decisão:** Escolhida.

### Opção C — Mutex Transacional ACID
Usar `SELECT ... FOR UPDATE` ou advisory locks PostgreSQL para garantir atomicidade.

**Prós:**
- Elimina TOCTOU completamente

**Contras:**
- Complexidade: requer mudar `updateStatus` para transação com lock
- Overhead de lock sobre DTask a cada escrita (impacto de performance)
- Incidente real foi humano em escala de minutos — overhead não é justificado

**Decisão:** Rejeitada como default; documentada como risco residual aceito.

---

## Decisão

**Escolhemos:** Opção B — Guard MCP com TTL de sesão órfã + retomada legítima permitida.

**Implementação:**

1. **Fonte única de extração de sessão:** `resolveActiveWorkSession(telemetry, status, nowMs?)`
   - Função pura em `src/tasks/work-session.util.ts`
   - Retorna `{ startedAt, agentId } | null`
   - Aplicado tanto pelo badge (read-path) quanto pelo guard (write-path)
   - TTL de 2h: sessão mais antiga que 2h é considerada órfã (permite retomada)

2. **Guard de bloqueio:** `assertTaskNotLockedByOther(task, callerId)`
   - Função em `src/mcp/tools/task-concurrency.guard.ts`
   - Lança `McpToolError(INVALID_PARAMS, reason='task_locked')` quando travada
   - Carrega erro com: `{ lockedBy: { agentId, agentName }, since: startedAt }`
   - Chamado APÓS `projectsService.findOne()` (gate de tenant) nos 5 tools

3. **Regras de desbloqueio (decisões do CEO Roberio 2026-07-10):**
   - **Decisão #1 — TTL de sessão órfã:** TTL = 2h. Passado isso, outro caller pode assumir.
   - **Decisão #2 — agentId nulo:** Bloqueia CONSERVADOR. Mesmo sem dono identificado, há trabalho ativo.
   - **Decisão #3 — `update_timer` isento:** Timer manual (ADR-V2-057) permanece livre. Trava cobre: `update_task`, `update_status`, `execute_task`, `delete_task`.
   - **Decisão #4 — Código de erro:** `INVALID_PARAMS (-32602)` com `reason='task_locked'` (reutilizar erro existente, não adicionar novo `-32004`).
   - **Decisão #5 — Backend hidrata nome:** `ActiveWorkSessionDto` carrega `agentName` do backend em batch (padrão "backend formata", zero N+1).

---

## Consequências

### Positivas
✓ **Bloqueio MCP sem afetar humanos** — UI livre, política isolada  
✓ **Badge consistente com trava** — mesma fonte de dados (`workSessions[]`)  
✓ **Retomada legítima funciona** — mesmo ator passa automaticamente  
✓ **Zero query extra** — decisão lê `dados.telemetry` em memória, nome reusa hidratação do findOne  
✓ **Sessão órfã expira** — TTL 2h evita bloqueio permanente  

### Negativas
✗ **TOCTOU residual** — dois callers MCP quase simultâneos antes de qualquer sessão aberta passam ambos. Risco de ms. **Aceito:** incidente real foi minutos  
✗ **Sem revogação de sessão** — se agente cai sem fechar, trava persiste até TTL expirar (2h esperando para retomar, ou admin força limpeza manual — futuro)  

### Neutras
— **Complexidade incremental** — guard é função pura simples, easy to reason  
— **Manutenibilidade** — fonte única (`resolveActiveWorkSession`) compartilhada by badge + guard  

---

## Implementação

### Arquivos Criados
- `src/tasks/work-session.util.ts` — `resolveActiveWorkSession()` + `WORK_SESSION_STALE_MS`
- `src/mcp/tools/task-concurrency.guard.ts` — `assertTaskNotLockedByOther()`
- `src/tasks/work-session.util.spec.ts` — 9 testes puros
- `src/mcp/tools/task-concurrency.guard.spec.ts` — 8 testes de guard + bloqueio

### Arquivos Modificados
- `src/tasks/dto/task-response.dto.ts` — novo `ActiveWorkSessionDto { agentId, agentName, startedAt }`
- `src/tasks/tasks.service.ts` — `buildWorkSessionMap()` + `buildResponse()` hidrata `activeWorkSession`
- `src/mcp/tools/{update-status,execute-task,delete-task}.tool.ts` — inserir `assertTaskNotLockedByOther()` após `projectsService.findOne()`
- `src/mcp/tools/update-task.tool.ts` — `findOne()` no início + guard, antes da mutação

### Contagem de Tools MCP
**Antes:** 24 tools  
**Depois:** 24 tools (invariante mantida — guard é função pura, não tool nova)  

---

## Riscos e Mitigações

### ALTO — Sessão órfã (agente cai sem fechar workSession)
Uma task `EXECUTING` cujo dono travou fica permanentemente bloqueada via MCP.

**Mitigação:** TTL de 2h (decisão #1). Passado isso, outro caller assume. Se 2h é insuficiente, futuro: admin força limpeza manual ou sistema auto-revoga com base em heartbeat de agente.

### MÉDIO — `agentId` nulo
Sessão aberta sem dono identificável. Guard não consegue atribuir "QUEM".

**Mitigação:** Bloqueia conservador (decisão #2). Mensagem de erro: "em andamento (autor não identificado)".

### MÉDIO — TOCTOU (corrida entre 2 callers)
Guard é read-then-act. Dois MCP calls quase simultâneos (antes de qualquer sessão aberta) passam ambos.

**Mitigação:** **Aceito como risco residual** (decisão CEO 2026-07-10). Incidente real foi minutos, não ms. Se rigor ACID for exigido: mover gate para transação `updateStatus()→EXECUTING` com `SELECT ... FOR UPDATE` (overhead não justificado agora).

### BAIXO — Sinalização de bloqueio
Caller não sabe se foi bloqueado pelo guard vs erro de negócio. 

**Mitigação:** Erro inclui `lockedBy: { agentId, agentName, since: startedAt }` — MCP caller vê claramente que a task está sendo trabalhada por outro ator.

### BAIXO — Contagem de tools (regressão)
Adicionar guard não deve alterar contagem de tools (24→24 invariante).

**Mitigação:** Guard é função pura (não @Injectable), não mexe em mcp.module, router ou specs de contagem. Confirmado: `tools.schema.json` + router specs intactos.

---

## ADRs Vinculados

- **ADR-V2-057** (timer manual): `update_timer` é isento (fluxo humano, ADR-V2-057 separação manual ÷ IA)
- **ADR-V2-042** (tenant MCP): Guard herda gate de tenant (`projectsService.findOne`)
- **ADR-V2-068** (scopes per-tool): Guard não mexe em scopes (ortogonal)
- **ADR-V2-001** (zero tabela nova): Zero tabela nova (usa `workSessions[]` JSON)
- **ADR-V2-005/006** (Engine): Engine NÃO é usado (badge/lock não tocam DPedido)

---

## Decisões Abertas (Futuro)

1. **Heartbeat de agente:** Guardar `lastActivity` timestamp em `workSessions[]` + auto-revoga se agente sem heartbeat >1h (vs 2h duro)?
2. **Admin revoga manual:** Endpoint para admin forçar fechamento de `workSessions` órfã?
3. **Auditoria:** Emitir `DEvento` quando bloqueio ocorre (-495 MCP_CALL já registra, mas dedicado seria -489 AUDIT_GENERIC)?
4. **TOCTOU ACID:** Se incidentes repetidos com callers simultâneos, mover guard para transação com `SELECT ... FOR UPDATE`?

---

## Critérios de Aceitação

- ✓ GET `/tasks` e GET `/tasks/:id` retornam `activeWorkSession` (agentId + agentName + startedAt) quando EXECUTING com sessão aberta; `null` senão
- ✓ ZERO N+1 em badge (batch de nomes — `buildWorkSessionMap`)
- ✓ 5 tools MCP recusam quando task EXECUTING+sessão de OUTRO ator; erro carrega QUEM e DESDE QUANDO
- ✓ Mesmo ator passa (retomada legítima)
- ✓ Task fora de EXECUTING passa (sem lock)
- ✓ `update_timer` isento (decisão #3)
- ✓ Frontend exibe badge "em trabalho por Fulano desde X" no card + linha + tela de abertura
- ✓ ZERO tabela/coluna/DClasse nova
- ✓ Contagem de tools MCP = 24 (invariante)
- ✓ Build passa + testes pass

---

## Referências

- `workspace/plans/plan-794-badge-mcp-lock.md` — plano detalhado
- `workspace/implementations/impl-mcp-badge-worksession-lock-task794.md` — notas de implementação
- `src/tasks/schemas/task-dados.schema.ts` — definição de `WorkSession`
- `src/tasks/work-session.util.ts` — fonte única `resolveActiveWorkSession`
- `src/mcp/tools/task-concurrency.guard.ts` — guard de bloqueio
- Task #794 (DEV-123) / Incidente 2026-07-07 — origem

---

**Maintained by:** Documenter Agent V2  
**Versão:** 1.0  
**Last updated:** 2026-07-10
