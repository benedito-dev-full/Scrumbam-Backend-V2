# ADR-V2-065: Vínculo Bloco↔Task via `dados.idBloco` (campo JSON); `idPai` representa SUBTAREFA exclusivamente

**Status:** Aceito
**Data:** 2026-06-07
**Decisores:** Strategist Agent V2 + Reviewer (8.8/10) + CEO
**Tags:** #V2 #fase-F11 #mcp #bloco #arquitetura

---

## Contexto e Problema

### Evolução Conceitual

No início do V2 (época de Sprints e Fases), o vínculo conceitual **task → agrupador** era expresso via **`DTask.idPai`** — uma tarefa era filha de uma fase/sprint.

Com a evolução para o modelo **PLANO de Blocos** (Bloco C, adotado no Frontend-V2), a estrutura mudou:
- **Blocos** (idClasse=-200) agora são entidades de **agrupamento plano** (não hierárquico).
- Cada task pode pertencer a um bloco via campo JSON **`DTask.dados.idBloco`** (referência simples).
- **`DTask.idPai`** mudou de significado: agora representa exclusivamente **subtarefa** (task filha de outra task — hierarquia de trabalho, não de agrupamento).

### O Erro Corrigido

Duas MCP tools antigas (`get_block_tree` e `list_blocks`) foram escritas na era pré-Bloco C e mantiveram o pressuposto morto:
- **`get_block_tree`** usava `PhaseTreeService.buildTree()`, cuja CTE recursiva descia **SOMENTE por `idPai`** (SQL: `INNER JOIN tree ON c."idPai" = tree.chave`).
- Como as tasks de um bloco se ligam via `dados.idBloco` (não via `idPai`), a árvore **não enxergava as tasks** e retornava métricas zeradas.
- Teste prático: bloco com 10 tasks → retornava vazio.

**Consequência:** O front-end não podia usar `list_block_tasks` (à época `get_block_tree`) para pré-visualizar blocos antes de entrar.

### ADRs Relacionados

- **ADR-V2-047** ("Fases via `DTask.idPai`") — Continua **válido para o uso de `idPai` em hierarquia de subtarefa** (task filha de task). Este ADR **clarifica a fronteira**: `idPai` é **exclusivamente** para subtarefas, não para vínculo bloco↔task.
- **ADR-V2-042** ("Tenant isolation defense-in-depth") — Preservado em ambas as tools MCP (gate RBAC, anti-enumeration).

---

## Alternativas Consideradas

### Opção 1: Manter `get_block_tree` com semântica nova (lista plana)
**Prós:**
- Não quebra clientes MCP que chamem `get_block_tree`.

**Contras:**
- Nome mente sobre o contrato — esperam árvore, recebem lista plana.
- Clientes LLMs escolhem tool pelo nome/descrição; confusão garantida.
- Degradação de contrato sem feedback claro.

**Rejeitada** — semântica divergente demanda novo nome.

### Opção 2: Corrigir a CTE do `PhaseTreeService` para descer por `dados.idBloco`
**Prós:**
- Evita duplicação de query.

**Contras:**
- `PhaseTreeService` serve endpoint HTTP `GET /tasks/:id/tree` (hierarquia por `idPai` — subtarefas).
- Alterar a CTE quebraria esse contrato.
- Árvore recursiva é modelo morto; front quer lista plana com métricas simples.
- Uma CTE não consegue satisfazer dois eixos (idPai e dados.idBloco) sem ficção.

**Rejeitada** — misturaria dois conceitos num componente só.

### **Opção 3: Nova tool `list_block_tasks` com lista plana** ✅ **ESCOLHIDA**
**Prós:**
- Nome claro: `list_*` sinaliza coleção paginada (consistente com `list_tasks`, `list_blocks`, `list_members`).
- Semântica explícita: filtra por `dados.idBloco`, retorna itens com status, métricas opcionais.
- Reutiliza `TasksService.findMany` (Pilar 2 ATIVADO — sem duplicação).
- Métricas em memória sobre a página carregada = custo ZERO query extra.
- Alinhado ao endpoint front `GET /tasks?idBloco=`.

**Contras:**
- Métricas refletem apenas a página (se bloco tem >limit tasks, contagem é parcial) — aceitável com documentação.

**Adotada**.

---

## Decisão

**Escolhemos Opção 3:** Substituir `get_block_tree` por `list_block_tasks` (nova MCP tool).

### Regra Arquitetural

```
┌─────────────────────────────────────────────────────────────┐
│ EIXOS INDEPENDENTES:                                         │
│                                                               │
│ 1. AGRUPAMENTO (bloco):    DTask.dados.idBloco (JSON field) │
│    → Vínculo plano task ↔ bloco                              │
│    → MCP tool: list_block_tasks (lista + métricas opcionais) │
│                                                               │
│ 2. HIERARQUIA (subtarefa): DTask.idPai (FK)                 │
│    → Vínculo pai-filho task ↔ task                           │
│    → HTTP endpoint: GET /tasks/:id/tree (CTE recursiva)      │
│    → MCP tool: nenhuma (relação está em /tasks/:id/tree)     │
│                                                               │
│ NÃO MISTURAR — são dimensões ortogonais.                    │
└─────────────────────────────────────────────────────────────┘
```

### Implicações

1. **`dados.idBloco` é a fonte canônica** de vínculo task ↔ bloco no V2.
2. **`idPai` é EXCLUSIVAMENTE** para hierarquia de subtarefa (task filha de task).
3. **`list_block_tasks`** substitui `get_block_tree` no MCP server.
4. **`PhaseTreeService`** permanece intacto (serve `/tasks/:id/tree` para hierarquia por `idPai`).

---

## Consequências

### Positivas

- **Correção do modelo:** Alinha MCP tools à semântica real do V2 (Bloco C já implementado).
- **Clareza de contrato:** Nome novo sinaliza semântica nova.
- **Reutilização Pilar 2:** `list_block_tasks` reusa `TasksService.findMany` + tenant gate existente.
- **Custo zero de query:** Métricas em memória sobre itens já carregados.
- **Consistência:** Alinhado ao padrão das outras tools (`list_*` = coleção paginada).

### Negativas

- **Breaking change para MCP:** Clientes que chamem `get_block_tree` receberão `METHOD_NOT_FOUND`.
  - **Mitigação:** Front-end usa `GET /tasks?idBloco=`, não a tool (risco baixo).
  - **Documentação:** CHANGELOG com nota de breaking change.
- **Métricas parciais:** Se bloco tem >limit tasks, métricas refletem apenas a página.
  - **Mitigação:** Documentar em JSDoc/descrição que métricas são da página.
  - **Evolução futura:** 2ª query agregada SQL FILTER por idClasse de status (fora escopo).

---

## Implementação

### Arquivos Modificados/Criados

**Criar:**
- `src/mcp/tools/list-block-tasks.tool.ts` — nova tool MCP.
- `src/mcp/__tests__/mcp-tools.list-block-tasks.spec.ts` — testes.

**Deletar:**
- `src/mcp/tools/get-block-tree.tool.ts` — tool antiga.
- `src/mcp/__tests__/mcp-tools.get-block-tree.spec.ts` — testes antigos.

**Atualizar:**
- `src/mcp/services/mcp-router.service.ts` — trocar import/registro de tool.
- `src/mcp/mcp.module.ts` — trocar provider.
- `src/mcp/schemas/tools.schema.json` — substituir entrada, ajustar descrições.
- `src/mcp/tools/list-blocks.tool.ts` — remover flag `includeMetrics` (era no-op).
- `src/mcp/tools/list-tasks.tool.ts` — trocar "PHASE" por "Bloco" em descrição/schema.
- Testes MCP correlatos (schema-consistency, router, etc.).

### Contrato MCP Novo

```typescript
// list_block_tasks
input: { blockId: string, includeMetrics?: boolean, limit?: 1..50, cursor?: string }
output: {
  blockId: string,
  items: TaskResponseDto[],
  pagination: { hasMore: boolean, nextCursor?: string },
  metrics?: {
    total: number,
    done: number,      // status ∈ {DONE, VALIDATED, CANCELLED}
    failed: number,    // status ∈ {FAILED, DISCARDED}
    inProgress: number, // status ∈ {EXECUTING, VALIDATING}
    percent: number    // Math.round(done / total * 100)
  }
}
```

### Semântica de Métricas

Baseada em [ADR-V2-057](./ADR-V2-057-timer-manual-tempo-por-tarefa.md) e alinhada ao frontend:
- **done:** tasks completadas ou validadas ou canceladas (sem retrabalho).
- **failed:** tasks falhadas ou descartadas (não são deliverables).
- **inProgress:** tasks em execução ou validação (ainda em voo).
- **total:** contagem de items retornados.
- **percent:** progresso = `done / total * 100` (ou 0 se vazio).

### Fases de Implementação

**Fase 1 — Nova tool (1h30):**
- Criar `list-block-tasks.tool.ts` com tenant gate + findMany + métricas em memória.
- JSDoc completo (template devari-jsdoc).

**Fase 2 — Wire-up (40min):**
- Registrar em `mcp.module.ts` e `mcp-router.service.ts`.
- Deletar `get-block-tree.tool.ts`.

**Fase 3 — Schema + vocabulário (50min):**
- Substituir entrada schema, limpar descrições, "PHASE" → "Bloco".

**Fase 4 — Testes (1h20):**
- Criar spec nova, remover spec antiga, atualizar correlatos.

**Fase 5 — Build + smoke (30min):**
- `npm run build` verde, `npm test -- src/mcp` verde.

---

## Critérios de Sucesso

### MUST HAVE
- ✅ `list_block_tasks` retorna tasks com `dados.idBloco === blockId` (sem filtro por `idPai`).
- ✅ `get_block_tree` removido do router, schema, tools (`tools/list` não a lista).
- ✅ Métricas com semântica do front (done/failed/inProgress/total/percent) quando `includeMetrics=true`.
- ✅ Tenant isolation ADR-V2-042 preservado (scope + anti-enumeration).
- ✅ `PhaseTreeService` **intacto** e `/tasks/:id/tree` continua funcionando.
- ✅ Build verde, testes MCP verdes (155/155 specs).

### SHOULD HAVE
- ✅ `list_blocks` descrição limpa, `includeMetrics` removido.
- ✅ "PHASE" → "Bloco" em `list_tasks` (descrição, schema).
- ✅ JSDoc completo em `list-block-tasks`.

### COULD HAVE
- ✅ Nota em CHANGELOG sobre breaking change para MCP.

---

## Notas

### Compatibilidade com ADR-V2-047

ADR-V2-047 ("Fases via `DTask.idPai`") **permanece vigente**. Este ADR **NÃO o revoga**, mas **clarifica o escopo**:

- **ADR-V2-047 cobre:** Hierarquia de subtarefa (task filha de task) via `idPai`.
  - Use case: task "Implementar X" → subtarefas "Escrever testes", "Code review", etc.
  - Endpoint: `GET /tasks/:id/tree` (CTE recursiva).
  - Ferramenta: `PhaseTreeService` (intacta).

- **ADR-V2-065 cobre:** Agrupamento plano de tasks em blocos via `dados.idBloco`.
  - Use case: organizar tasks em blocos kanban (Backlog, Ready, Doing, Done).
  - MCP tool: `list_block_tasks` (nova).
  - Endpoints front: `GET /tasks?idBloco=X` (listagem, não hierarquia).

**Fronteira clara:** são dimensões ortogonais.

### Candidato Upstream

Padrão genérico "agrupamento via campo JSON vs hierarquia via FK" é reutilizável no template Devari-Core para outros agregados (sub-recursos dentro de um container).

---

## Referências

- [ADR-V2-042 — Tenant isolation defense-in-depth](./ADR-V2-042-tenant-isolation-defense-in-depth.md)
- [ADR-V2-047 — Fases via DTask.idPai](./ADR-V2-047-fases-via-dtask-idpai.md)
- [ADR-V2-057 — Timer manual (semântica de métricas)](./ADR-V2-057-timer-manual-tempo-por-tarefa.md)
- Plan: `workspace/plans/plan-mcp-polir-block-tools-task1.md`
- Spec implementação: `src/mcp/__tests__/mcp-tools.list-block-tasks.spec.ts`

---

**Redigido por:** Documenter Agent V2
**Revisado por:** Reviewer (8.8/10)
**Aceito em:** 2026-06-07
