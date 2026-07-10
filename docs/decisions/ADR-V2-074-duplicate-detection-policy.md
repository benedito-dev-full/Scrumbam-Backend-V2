# ADR-V2-074: Política de Detecção de Duplicata na Criação de Task

**Status:** Aceito
**Data:** 2026-07-10
**Decisores:** Strategist Agent V2 + CEO Roberio (decisões 2026-07-10)
**Tags:** #V2 #F8-F11 #task-799-DEV-128 #dedup-detection

---

## Contexto e Problema

**Incidente real (2026-07-07):** Uma task foi criada duplicada às cegas — o autor não percebeu que o mesmo título já existia na Lista. O trabalho foi perdido/duplicado, impactando a produtividade.

**Requisito:** Exibir um AVISO com possíveis duplicatas ANTES de criar, reduzindo acidentes sem NUNCA bloquear a criação (comportamento informativo apenas). Implementar reuso máximo de busca existente (#791) e garantir portabilidade do mecanismo.

**Escopo:** Dois caminhos de criação:
1. **UI (modal de criação):** passo intermediário — "encontramos tarefas parecidas" — antes de confirmar.
2. **MCP (`create_task`):** retorna `possibleDuplicates[]` anexado ao resultado, informativo, cria normal.

---

## Alternativas Consideradas

### Opção A — Bloqueio de Criação (Rejeita quando há duplicata exata)
Retorna 409 Conflict se título idêntico existe; obriga o usuário a escolher a existente.

**Prós:**
- Eliminaria 100% das duplicatas não-intencionais

**Contras:**
- Viola requisito: "NUNCA bloqueia"
- Casos legítimos (dois projetos diferentes com tarefas "Setup") seriam bloqueados injustamente
- Dificulta workflows legítimos de split/dedup
- Experiência UX péssima (obriga cancelar, navegar, etc.)

**Decisão:** Rejeitada (violaria especificação).

### Opção B — Informativo Puro com UI Intermediária (Escolhida ✓)
Método único `findPossibleDuplicates()` reusa busca tokenizada (#791), retorna candidatas COM matchType (exact vs similar). UI exibe passo intermediário quando há resultados; MCP anexa ao retorno. Nunca bloqueia.

**Prós:**
- Atende requisito: SEMPRE informativo
- Reuso máximo de código: reutiliza `buildTokenizedTextFilter` (#791)
- Portabilidade: método genérico, não hardcoded em UI ou MCP
- UX fluida: modal flui, pode-se ignorar aviso se quiser (botão "Criar mesmo assim")
- Escalável: decisão #1-5 deixam abertos cenários futuros (org-wide, criteria customizadas)

**Contras:**
- Não é bloqueio — atrito consciente menor
- Depende da UX respeitar o comportamento (nada técnico força o bloqueio)

**Decisão:** Escolhida.

### Opção C — Detecção Async Pós-Criação (com Merge Automático)
Cria a task imediatamente, depois busca duplicatas async, e faz merge automático no background.

**Prós:**
- Criação rápida (sem latência de busca síncrona)

**Contras:**
- Operação destruidora (merge) sem consentimento explícito → risco de perda de dados
- Requer gestão de estado "merging" na task
- Não resolve o problema (duplicata ainda foi criada por milissegundos)

**Decisão:** Rejeitada (destruidor, não resolve problema original).

---

## Decisão

**Escolhemos:** Opção B — Método único `findPossibleDuplicates()` informativo, consumido por UI e MCP, nunca bloqueante.

### As 5 Decisões Travadas (CEO Roberio 2026-07-10)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | **Limiar de similaridade** | Reusar AND-flexível tokenizado (#791) sobre TÍTULO apenas; marcar `matchType: 'exact' \| 'similar'`; exatos primeiro |
| 2 | **Escopo da busca** | **Default:** mesma lista/projeto (`idProject=X`); `scope='org'` opcional (iteração futura) |
| 3 | **Top N de candidatas** | **5** (balanço entre visibilidade e não-spam) |
| 4 | **Incluir tasks DONE/arquivadas?** | **SIM** — exibindo `idStatus` — evita recriar algo já feito |
| 5 | **Outras superfícies de criação** | **Modal agora**; quick-add inline em kanban/lista em iteração seguinte |

---

## Implementação

### 1. Backend — Método Único

**`SearchService.findPossibleDuplicates(params)`** em `src/search/search.service.ts`:

```typescript
async findPossibleDuplicates(params: {
  nome: string;                    // Título proposto
  projectId: string;               // Lista-alvo
  scope?: 'project' | 'org';       // default 'project' (decisão #2)
  organizationId?: string;         // Org (HTTP path)
  accessibleProjectIds?: string[]; // Projetos (MCP path)
  excludeTaskId?: string;          // Exclusão (edição)
  limit?: number;                  // default 5, cap 20 (decisão #3)
}): Promise<TaskDuplicateDto[]>
```

**Características:**

- Reusa `buildTokenizedTextFilter(nome, ['nome'])` — TÍTULO APENAS (decisão #1)
- Busca `excluido=false` SEM filtro de `idStatus` (decisão #4)
- Ordem: `criadoEm DESC`; buffer +5; reordena exatos primeiro; retorna top `limit`
- Tenant isolation: caller valida `projectId ∈ accessibleProjectIds` (HTTP) ou passa via `accessibleProjectIds` (MCP)
- 1 query, ZERO N+1, ZERO $queryRaw (consistente com F8 read-only, #791)

**Queries:** 1 paralela (ZERO N+1).

### 2. HTTP Endpoint

**`GET /tasks/check-duplicates`** em `TasksController`:

- Query params: `nome` (obr), `projectId` (obr), `excludeTaskId?`, `limit?`
- Guard: `AuthCompositeGuard` (mesmo que `POST /tasks`)
- Autorização: `projectId ∈ accessibleProjectIds` (404 anti-enumeration idêntico ao create)
- Delega: `searchService.findPossibleDuplicates({ nome, projectId, scope: 'project' })`
- Response: `TaskDuplicateDto[]` (vazio quando não há candidatas — fluxo direto sem atrito, decisão #5)

### 3. MCP Tool Update

**`CreateTaskTool`** em `src/mcp/tools/create-task.tool.ts`:

- ANTES de `tasksService.create()`: chama `searchService.findPossibleDuplicates({ nome: titulo, projectId, scope: 'project' })`
- Anexa `possibleDuplicates` ao objeto retornado (sem bloquear create)
- Descrição da tool atualizada: "... O retorno inclui `possibleDuplicates[]`: tasks com título parecido (informativo — nunca bloqueia)."

### 4. Frontend UI

**`create-task-modal.tsx`:**

- `handleCriar()` fluxo:
  1. Se não checou: `setChecking(true)`, `checkDuplicates(nome, projectId)`
  2. Se `candidates.length > 0`: abre passo intermediário `DuplicateWarningStep` (antes de persistir)
  3. Se vazio: cria direto — **ZERO atrito** ✓ (decisão #5)
- "Criar mesmo assim" button (bypass do passo)

**`duplicate-warning-step.tsx`:**

- Exibe candidatas em lista (identifier + nome + status + link para abrir)
- Dois botões: "Criar mesmo assim" (continua criação) + "Cancelar"
- Estilo espelhando `TakeoverConfirmDialog`

**Hook `useCheckDuplicates`:**

- `async checkDuplicates(nome, projectId): Promise<TaskDuplicateResult[]>`
- Query key: `qk.tasks.duplicates(projectId, nome)` (cacheable)

### Contrato `TaskDuplicateDto`

```json
{
  "chave": "1234",
  "identifier": "DEV-87",
  "nome": "Corrigir login OAuth",
  "idProject": "352",
  "projectNome": "Backend Core",
  "idStatus": "-443",
  "matchType": "exact",
  "criadoEm": "2026-07-05T12:00:00.000Z"
}
```

---

## Consequências

### Positivas

✓ **Informativo puro:** Nunca bloqueia — autoridade de criação permanece com o usuário/agente  
✓ **Reuso máximo:** Reutiliza `buildTokenizedTextFilter` (#791) — ZERO duplicação de busca  
✓ **Genérico:** Método em `SearchService` pode ser reutilizado por qualquer domínio futuramente (portabilidade)  
✓ **UX fluida:** Modal flui sem atrito; passo intermediário aparece quando relevante (candidatas > 0)  
✓ **MCP friendly:** Retorna dados estruturados; agente decide o que fazer  
✓ **Performance:** 1 query por criação, escalável (mesmo perfil de #791 — escopo por lista é pequeno)  
✓ **Tenant-safe:** Autorização delegada ao caller (HTTP anti-enumeration idêntica ao create)  

### Negativas

- Atrito mínimo (consciente) — usuários ainda podem criar duplicatas se insistirem (aceitável por design)
- Reordernação em memória (buffer +5 para garantir exatos primeiro) — overhead negligenciável

### Riscos Residuais e Mitigações

| Risco | Severidade | Mitigação |
|-------|------------|-----------|
| Matches fracos/falsos (resultado com pouco relevância) | Baixa | Escopo default = lista-alvo (amostra pequena). Limiar é AND-flexível tokenizado (confiável). |
| Latência extra por criação | Baixa | Query indexada, escopo por lista (pequeno). Mesmo perfil #791. |
| UI ignora passo (bypass silent) | Baixa | Implementação UI segue padrão; revisão Implementer valida. |
| Muitas sugestões (spam de aviso) | Baixa | Top 5 (decisão #3), exatos destacados. UX responsável. |

---

## Decisões Futuras Deixadas Abertas

1. **Escopo org-wide:** `scope='org'` expandir para buscar em TODO o workspace (iteração futura)
2. **Critério customizado:** Permitir cliente definir limiar de similaridade (regex, fuzzy, etc.)
3. **Quick-add inline:** Verificação no blur do título em kanban/inline edit (fora escopo hoje)
4. **Merge inteligente:** Sugerir merge explícito de duas tarefas (fluxo de dedup pós-criação)

---

## Referências Relacionadas

- **Task #799 (DEV-128):** Detecção de duplicata — plano original
- **Task #791 (DEV-120):** SearchService com busca tokenizada AND-flexível — REUTILIZADO
- **ADR-V2-001:** Zero tabela nova (DVFS apenas) — RESPEITADO
- **ADR-V2-042:** Tenant isolation por membership — APLICADO
- **ADR-V2-051:** Public space access — N/A
- **Pilar 2 (Endpoints Genéricos):** Reuso SearchService (não controller novo)
- **F8 (Read-Only Cross-Entity Search):** Consistente com read-only puro

---

## Critério de Sucesso (DoD)

- [ ] Método `findPossibleDuplicates()` implementado em `SearchService`, reutilizando `buildTokenizedTextFilter` (#791)
- [ ] Endpoint `GET /tasks/check-duplicates` exposto em `TasksController` com autorização idêntica ao `POST /tasks`
- [ ] MCP `create_task` anexa `possibleDuplicates[]` ao retorno, nunca bloqueia criação
- [ ] Frontend: passo intermediário quando há candidatas; fluxo direto quando vazio (ZERO atrito)
- [ ] 1 query por criação, ZERO N+1
- [ ] Tenant isolation garantida (anti-enumeration + idProject fixo)
- [ ] ADR-V2-074 documentado e linkado em ROADMAP/CHANGELOG/STATUS
- [ ] Testes: unit (searchService), integration (endpoint + MCP tool), smoke UI

---

**Maintained by:** Devari Tecnologia / Scrumban Backend V2
**Status:** Aceito (2026-07-10)
