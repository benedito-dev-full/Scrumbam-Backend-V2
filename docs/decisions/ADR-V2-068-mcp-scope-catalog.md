# ADR-V2-068: Catálogo canônico de scopes MCP per-tool (17 tools, 6 scopes)

**Status:** Aceito
**Data:** 2026-06-17
**Decisores:** Strategist Agent V2, CEO (ratificado 2026-06-17)
**Tags:** #V2 #fase-F11 #mcp #scopes #seguranca #rbac #catalogo

---

## Contexto e Problema

A camada MCP do V2 (fases F11–F13) expõe **17 ferramentas** para clientes externos (Claude Desktop, Cursor, Claude Code CLI) — tools para criar/editar/listar tasks, executar IA, gerenciar notificações, etc. Cada ferramenta tem nível de risco e custo distinto:

| Ferramenta | Risco | Custo |
|---|---|---|
| `list_tasks`, `get_task`, `search_tasks`, etc. | Baixo (leitura) | Zero (DB local) |
| `create_task`, `update_task`, `update_status` | Médio (mutação) | Zero (DB local) |
| `execute_task` | **Alto** (dispara IA Claude, queima tokens) | **US$ reais** |

### O bloqueador original

Até a **Fase 1 (F11, DEV-13)**, o backend aceitava MCP keys com campo `scopes: string[]` persistido, mas **nenhuma tool validava o campo**. Toda key MCP válida podia chamar toda ferramenta — sem granularidade.

Consequência: Uma key comprometida para "ler tasks" poderia queimar tokens Anthropic ilimitadamente via `execute_task`.

### O anterior que já existe

- `DTabela` idClasse **-472** (MCP_KEY) já existe e já armazena `dados.scopes` ✅
- Campo é persistido, mas não é validado ❌
- 15 tools antigas **operavam sem nenhuma verificação de scope** ❌
- Fase 1 (F11) **adicionou `requireScope(ctx, scope)` em todas as 17 tools** ✅
- Fase 2 (F11) **adicionou gate em `POST /mcp/keys`** via `RoleResolverService.getAllowedMcpScopes()` ✅
- Fase 3 (F11) **criou script grandfather** (`scripts/mcp-grandfather-scopes.ts`) para keys legadas ✅
- **Fases 1, 2, 3 já estão mergeadas e em produção** ✅

Este ADR **formaliza e ratifica** o que já existe em código funcionando.

---

## Alternativas Consideradas

### Opção A — Genérico: `tools:read` e `tools:call`
Dois scopes genéricos cobrindo "leitura" vs "escrita" de qualquer ferramenta.

**Prós:**
- Simplicidade: 2 escopos cobrem tudo.

**Contras:**
- **Sem granularidade:** toda ferramenta de escrita fica com privilégio idêntico.
- `execute_task` (queima tokens, custo $) = `update_task` (edita metadados, custo zero). **Colapso de risco.**
- Key vazada com `tools:call` pode disparar 1000 execuções antes de ser revogada.
- Não alinha com OAuth/Istio-like systems (que usam `domain:action`).

**Rejeitada** — colapso de capacidades inadequado.

### Opção B — Um scope por ferramenta (17 scopes)
`create_task`, `update_task`, `execute_task`, `list_tasks`, etc.

**Prós:**
- Granularidade máxima.

**Contras:**
- **Explosão de tipos.** 17 novos IDs de scope + mantença complexa.
- `list_tasks`, `get_task`, `search_tasks` fazem a mesma coisa (leitura) — deveriam ter o mesmo scope.
- `create_task`, `update_task` têm risco similar (mutação) — podem compartilhar scope.
- Não escala: quando adicionar a 18ª ferramenta, criar novo scope?

**Rejeitada** — sem padrão de agrupamento semântico.

### Opção C — **Catálogo semântico de 6 scopes (escolhida)**

Agrupar tools por **tipo de ação + domínio**, não por ferramenta individual:

- **`tasks:read`** → ferramentas de LEITURA de tasks e projetos
- **`tasks:write`** → ferramentas de MUTAÇÃO de tasks
- **`notifications:read`** → ferramentas de LEITURA de notificações
- **`notifications:write`** → ferramentas de MUTAÇÃO de notificações
- **`projects:write`** → ferramentas de MUTAÇÃO de projetos
- **`executions:create`** → ferramentas de EXECUÇÃO de IA (dedicado, separado)

**Prós:**
- Semântica clara: `domain:action` (padrão OAuth/RBAC/Istio).
- Escala: novas ferramentas se encaixam em scopes existentes (não precisa novo scope).
- Combinável: uma key pode ter `tasks:read` + `notifications:read`, outra tem `tasks:write` + `notifications:write`.
- Risco granular: `executions:create` é separado porque queima tokens (custo financeiro distinto).
- Alinha com RBAC duplo do V2 (ADR-V2-003): capacidades separadas por dimensão.

**Adotada** — praticidade + escala + semântica.

---

## Decisão

### Catálogo canônico de 6 scopes

Declarado em `src/mcp/constants.ts`:

```typescript
export const MCP_SCOPES = {
  TASKS_READ: 'tasks:read',
  TASKS_WRITE: 'tasks:write',
  NOTIFICATIONS_READ: 'notifications:read',
  NOTIFICATIONS_WRITE: 'notifications:write',
  PROJECTS_WRITE: 'projects:write',
  EXECUTIONS_CREATE: 'executions:create',
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];
export const ALL_MCP_SCOPES: McpScope[] = Object.values(MCP_SCOPES);

export const MCP_SCOPE_PRESETS = {
  READ_ONLY: [MCP_SCOPES.TASKS_READ, MCP_SCOPES.NOTIFICATIONS_READ],
  READ_WRITE: [
    MCP_SCOPES.TASKS_READ,
    MCP_SCOPES.TASKS_WRITE,
    MCP_SCOPES.NOTIFICATIONS_READ,
    MCP_SCOPES.NOTIFICATIONS_WRITE,
  ],
  FULL_ACCESS: ALL_MCP_SCOPES,
} as const;
```

### Mapeamento: 17 tools → scope

| Scope | Tools (e número) |
|-------|---|
| **`tasks:read`** (7 tools) | `list_tasks` (3), `get_task` (4), `search_tasks` (5), `list_projects` (10), `get_project` (11), `list_blocks` (8), `list_block_tasks` (9) |
| **`tasks:write`** (4 tools) | `create_task` (1), `update_task` (2), `update_status` (6), `update_timer` (7) |
| **`notifications:read`** (2 tools) | `list_notifications` (12), `get_unread_count` (13) |
| **`notifications:write`** (1 tool) | `update_notification` (14) |
| **`projects:write`** (1 tool) | `update_project` (15) |
| **`executions:create`** (1 tool) | `execute_task` (16) |
| **Observação** | Tool `list_members` (17) → reutiliza `tasks:read` (leitura de projeto) |

**Total: 17 tools** cobertos por 6 scopes semânticos.

### Regra de privilege escalation (gate em `POST /mcp/keys`)

Implementada em `RoleResolverService.getAllowedMcpScopes(userEntidadeId)`:

```
Todo usuário autenticado pode solicitar:
  - tasks:read
  - notifications:read
  - notifications:write
  (notificações são sempre próprias do usuário)

MEMBER de organização (-162) OU MEMBER de projeto (-172):
  + tasks:write

MANAGER de projeto (-171) OU ADMIN de organização (-161):
  + projects:write
  + executions:create
```

**Implementação (1 query, ZERO N+1):**
```typescript
async getAllowedMcpScopes(userEntidadeId: bigint): Promise<Set<McpScope>> {
  const vinculos = await this.prisma.dVincula.findMany({
    where: {
      idEntidade: userEntidadeId,
      idClasse: { in: [ORG_ADMIN, ORG_MEMBER, ORG_VIEWER, PROJECT_MANAGER, PROJECT_MEMBER, PROJECT_VIEWER] },
      excluido: false,
    },
    select: { idClasse: true },
  });

  const idClasses = new Set(vinculos.map((v) => v.idClasse));
  const isMember = idClasses.has(ORG_MEMBER) || idClasses.has(PROJECT_MEMBER);
  const isManagerOrAdmin = idClasses.has(PROJECT_MANAGER) || idClasses.has(ORG_ADMIN);

  const allowed = new Set<McpScope>([
    MCP_SCOPES.TASKS_READ,
    MCP_SCOPES.NOTIFICATIONS_READ,
    MCP_SCOPES.NOTIFICATIONS_WRITE,
  ]);

  if (isMember || isManagerOrAdmin) {
    allowed.add(MCP_SCOPES.TASKS_WRITE);
  }
  if (isManagerOrAdmin) {
    allowed.add(MCP_SCOPES.PROJECTS_WRITE);
    allowed.add(MCP_SCOPES.EXECUTIONS_CREATE);
  }

  return allowed;
}
```

### Validação ao criar key (`POST /mcp/keys`)

3 etapas sequenciais em `McpKeyService.generate()`:

1. **Lista vazia?** → `BadRequestException` ("Pelo menos 1 scope é obrigatório")
2. **Scope fora do catálogo?** → `BadRequestException` com `{ invalidScopes, validScopes }`
3. **Scope acima do role?** → `ForbiddenException` com `{ deniedScopes, allowedScopes }`

```typescript
const allowed = await this.roleResolver.getAllowedMcpScopes(userId);
const denied = scopes.filter(s => !allowed.has(s));
if (denied.length > 0) {
  throw new ForbiddenException({
    message: `Scope(s) não permitido(s) para seu nível: ${denied.join(', ')}`,
    deniedScopes: denied,
    allowedScopes: [...allowed],
  });
}
```

### Endpoint novo: `GET /mcp/keys/allowed-scopes`

Frontend role-aware usa este endpoint para **habilitar/desabilitar presets** no modal de criação de key:

```bash
GET /mcp/keys/allowed-scopes

Response:
{
  "allowedScopes": ["tasks:read", "tasks:write", "notifications:read", "notifications:write"]
}
```

User com MEMBER pode ver/habilitar `tasks:write`; user com VIEWER não pode.

### Armazenamento: `DTabela.dados.scopes`

- **Tabela:** DTabela
- **idClasse:** -472 (MCP_KEY)
- **Campo:** `dados.scopes` (JSON array de strings)
- **Storage:** Zero tabela nova (ZERO violação de ADR-V2-001)

Exemplo:
```json
{
  "prefix": "scrumban_mcp",
  "hash": "sha256...",
  "scopes": ["tasks:read", "tasks:write", "notifications:read"],
  "disabled": false,
  "createdAt": "2026-06-17T10:30:00Z",
  "lastUsedAt": "2026-06-17T14:30:00Z",
  "grandfatheredAt": "2026-06-17T00:00:00Z",
  "scopesPreviousValue": ["tools:read", "tools:call"]
}
```

### Grandfathering de keys legadas (Fase 3)

**Script:** `scripts/mcp-grandfather-scopes.ts`

**Ação:** Reescreve `dados.scopes` de TODAS as MCP keys (inclusive revogadas) de valores legados (`tools:read`, `tools:call`, ou vazio) para `ACESSO_TOTAL` (os 6 scopes completos).

**Auditoria em-place (zero tabela nova):**
- `dados.grandfatheredAt` → ISO timestamp da migração
- `dados.scopesPreviousValue` → array de scopes antigos

**Idempotente:** Keys já com o catálogo completo são puladas (não duplica auditoria).

**Execução:**
```bash
DRY_RUN=1 npm run script:mcp-grandfather     # simula
npm run script:mcp-grandfather               # grava
```

**Decisão de design:** Não emite `DEvento` de auditoria. A auditoria fica inline em `dados` (mais simples, sem criar registros órfãos). Para trilha de auditoria completa, admin pode consultar histórico de DTabela (snapshot antes/depois).

### Edição in-place de scopes: NÃO é suportada

**Decisão CEO:** UI oferece apenas "revogar key" + "criar key nova".

Alternativas (editar scopes de key existente) são:
1. Revogar key antiga
2. Gerar key nova com novo scope set

**Razão:** Simplifica lógica (escrever `dados.scopes` é operação de criação, não de mutação); evita histórico confuso (qual versão teve qual scope?); força decisão consciente do admin (gerar key nova = custo de tempo, incentiva pensar bem).

---

## Consequências

### Positivas

- **Menor privilégio em produção:** Uma key para "ler tasks" não pode queimar tokens de IA. Admin precisa aprovar explicitamente.
- **UI role-aware (Fase 4):** Frontend sabe quais presets oferecer por role. VIEWER vê leitura; MEMBER vê leitura + escrita; ADMIN vê tudo.
- **Trilha de auditoria:** Campo `grandfatheredAt` + `scopesPreviousValue` registra migração. Backend pode consultar histórico.
- **Escalável:** Novas ferramentas se encaixam em scopes existentes (não precisa novo scope).
- **Alinhado ao template:** Padrão `domain:action` alinha com OAuth, Istio, e convenções da indústria.

### Negativas

- **Edição de scopes requer revogação + recriação.** Mitigado pela UI (2 cliques em vez de 1).
- **Admins precisam aprender novo catálogo.** Mitigado por documentação operacional (runbook, CHANGELOG).
- **Keys legadas precisam migração via script.** Mitigado pela idempotência (rodar script 2x é seguro) e suporte DRY_RUN.

### Riscos residuais

- **R1 — Script grandfather não rodar antes do enforcement.** Se Fase 1 (enforcement) for deployada sem Fase 3 (grandfather), keys legadas receberão FORBIDDEN até migration. **Mitigação:** Fases 1+2+3 deployam no mesmo release.
- **R2 — Convenção de separador divergir.** (`:` vs `.` vs `/`) **Mitigação:** Este ADR fixa `:` como padrão. Futuras tools respeitam padrão.
- **R3 — Tools antigas ficarem sem scope check.** (Intencionalmente deixamos 15 tools em Fase 1; Fase 2 adicionou gate; Fase 3 grandfather; Fase 4 frontend.) **Mitigação:** Roadmap de segurança (aplicar `requireScope` retrocompatível em `update_*` tools) registrado para follow-up.

---

## Implementação (Estado atual)

### Fases 1, 2, 3 — COMPLETAS ✅

| Fase | O quê | Status |
|------|-------|--------|
| **F1 (DEV-13 Task 412)** | Catálogo (6 scopes) + enforcement (17 tools) | ✅ DONE — commit `42b8145` |
| **F2 (DEV-13 Task 412)** | Gate em `POST /mcp/keys` + endpoint `/mcp/keys/allowed-scopes` | ✅ DONE — commit `50ab41f` |
| **F3 (DEV-13 Task 412)** | Script grandfather + auditoria in-place | ✅ DONE — commit `c8924d8` |
| **F4 (Frontend V2)** | UI role-aware (presets, checkboxes habilitados/desabilitados) | ✅ DONE — commit `06ecbd8` no repo Scrumbam-Frontend-V2 |
| **F5 (Este ADR)** | Documentação + ratificação | **← AGORA** |

---

## Contribuição ao template Devari-Core

Este padrão (catálogo semântico de scopes + gate de privilege escalation no CREATE) é candidato a capacidade padrão do template Devari-Core.

**Sugestão para futuros SaaS gerados:**
- Usar `domain:action` como convenção para scopes (não reinventar a roda).
- Implementar `requireScope(ctx, scope)` em tools sensíveis (não "tudo permitido").
- Resolver scopes dinamicamente via role (não hardcode).

**Não promover agora** — fora do escopo deste ADR. Registrar para roadmap do template.

---

## Referências

- [ADR-V2-001 — 17 tabelas canônicas, zero tabela nova](./ADR-V2-001-17-tabelas-canonicas.md) (armazenamento em DTabela -472)
- [ADR-V2-003 — RBAC duplo via DVincula + idClasse](./ADR-V2-003-rbac-duplo.md) (roles que determinam allowed scopes)
- [ADR-V2-004 — API/MCP keys via DTabela](./ADR-V2-004-api-mcp-keys-dtabela.md) (persistência de MCP_KEY)
- [ADR-V2-042 — Tenant isolation defense-in-depth](./ADR-V2-042-tenant-isolation-defense-in-depth.md) (camada complementar de proteção)
- [ADR-V2-066 — MCP `execute_task` assíncrono fire-and-poll](./ADR-V2-066-mcp-execute-task-async.md) (ferramenta sensível que motivou `executions:create`)
- [ADR-V2-067 — Scope `executions:create` dedicado](./ADR-V2-067-mcp-scope-executions-create.md) (escopo específico para queimar tokens)
- **Código:** `src/mcp/constants.ts`, `src/mcp/services/mcp-key.service.ts`, `src/auth/services/role-resolver.service.ts`, `src/mcp/mcp-keys.controller.ts`, `scripts/mcp-grandfather-scopes.ts`
- **Plan:** `workspace/plans/plan-mcp-scope-catalog.md` (detalhe técnico das 3 fases)

---

**Redigido por:** Documenter Agent V2
**Aceito em:** 2026-06-17
**Ratificado em:** 2026-06-17 (em produção desde commits anteriores)
