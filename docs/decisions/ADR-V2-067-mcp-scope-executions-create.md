# ADR-V2-067: Scope MCP dedicado `executions:create` para disparar IA

**Status:** Proposto
**Data:** 2026-06-15
**Decisores:** Strategist Agent V2 + CEO (a ratificar)
**Tags:** #V2 #fase-F11 #mcp #seguranca #scopes #execution

---

## Contexto e Problema

### Estado atual do enforcement de scopes MCP

As MCP keys do V2 já persistem `scopes: string[]` no payload (`src/mcp/services/mcp-key.service.ts:227`). O `McpKeyGuard` (`src/mcp/guards/mcp-key.guard.ts:38`) **lê** os scopes e popula `ctx.scopes`.

Mas — verificado por grep em `src/mcp/` — **nenhuma das 15 tools atuais lê `ctx.scopes`**. O router também não impõe filtragem por scope. **Hoje toda key MCP válida pode chamar toda tool MCP existente.**

O campo existe; o enforcement ainda não.

### Por que `execute_task` é o ponto certo para ativar

Disparar execução de IA tem perfil de risco **qualitativamente distinto** de CRUD de tasks:

| Dimensão | `tasks:write` (CRUD tasks) | `execute_task` (dispara IA) |
|----------|---------------------------|------------------------------|
| Custo financeiro direto | Zero (apenas registro em DB) | **Tokens Anthropic** (US$ reais por chamada) |
| Risco operacional | Edição de metadados | **Acesso a repositório via VPS agent** (clone + checkout + write) |
| Recuperabilidade | Trivial (re-edit) | Custo já incorrido (rollback git + tokens queimados) |
| Granularidade desejada | "quem pode editar" | "quem pode QUEIMAR TOKENS" |

Uma integração de relatório (ex: dashboard externo lendo/criando tasks) **não deveria automaticamente ganhar capacidade de queimar tokens de IA**. Hoje, com scope check inativo, qualquer key vazada pode disparar execuções ilimitadas.

### O dilema retro-compatível

Ativar scope check para as 15 tools antigas seria **breaking change abrangente** — toda key existente em produção precisaria ser reemitida com a lista certa. Risco alto e baixo retorno.

Ativar scope check **apenas para `execute_task`** é fail-safe pragmático: a tool é nova, não há keys em produção que precisem disparar IA via MCP hoje; quem precisar emite key nova ou faz upgrade explícito.

---

## Alternativas Consideradas

### Opção A — Reusar `tasks:write`
Aceitar que quem edita tasks também pode disparar IA.

**Prós:**
- Zero esforço de doc/migration.
- Keys existentes funcionam sem ajuste.

**Contras:**
- **Custo financeiro acoplado a edição** — colapsa duas dimensões de risco diferentes (cf. tabela acima).
- Key vazada com `tasks:write` = gasto ilimitado de tokens Anthropic.
- Não alinha com a granularidade do RBAC duplo do V2 (ADR-V2-003), que distingue dimensões de capacidade.

**Rejeitada** — colapso de capacidades inadequado para o perfil de risco.

### Opção B — Gating por `idClasse` da MCP key (ex: `MCP_KEY_EXECUTION` -485 vs `MCP_KEY` -470)
Diferenciar capacidade por tipo de DTabela da key, não por scope.

**Prós:**
- Reusa modelo polimórfico V2 (idClasse).

**Contras:**
- Granularidade pobre — uma única key precisaria de **um tipo** (executor ou não), perdendo combinabilidade.
- Exige nova DClasse no seed e fragmentaria o catálogo de tipos de key.
- `scopes: string[]` já existe e foi projetado exatamente para combinabilidade.

**Rejeitada** — granularidade insuficiente; redundante com `scopes`.

### Opção C — **Scope dedicado `executions:create` (escolhida)**
Introduzir scope explícito; tool exige; keys existentes **não** ganham auto.

**Prós:**
- Capacidade distinta = scope distinto (alinhado com OAuth `domain:action`).
- Combinável: uma key pode ter `tasks:write` + `executions:create`, outra só `tasks:read`.
- Fail-safe: ausência do scope → `FORBIDDEN` sem chamar service.
- Custo de implementação mínimo (helper `requireScope` + uso em 1 ponto).

**Contras:**
- Admins precisam reemitir/upgrade keys que queiram disparar IA (efeito intencional).

**Adotada**.

---

## Decisão

### Scope canônico

```
executions:create
```

**Convenção:** `domain:action` com `:` (dois-pontos) como separador. Alinha com OAuth-like systems e com nomenclatura REST do módulo `executions/`.

### Enforcement

- **`execute_task` exige `executions:create` no ctx.scopes.** Ausência → `MCP error FORBIDDEN` (código `-32003` ou equivalente em `MCP_ERROR_CODES`).
- Check via novo helper genérico `requireScope(ctx, scope)` em `src/mcp/tools/tool-params.ts` (Fase 3 do plan).
- Validação acontece **antes** de qualquer Service call — `executionsService.execute` nunca é chamado sem o scope.

### Backward compatibility

- **As 15 tools antigas continuam sem scope check.** Esta decisão é explícita e documentada aqui.
- Keys existentes **não ganham `executions:create` automaticamente**. Admin emite key nova ou faz upgrade explícito (operação de admin via endpoint `/mcp/keys`).
- Ativar scope check para as 15 tools antigas é trabalho separado (não escopo deste ADR — registrar como follow-up de segurança).

### Helper

```ts
export function requireScope(ctx: McpUserContext, scope: string): void {
  if (!ctx.scopes?.includes(scope)) {
    throw new McpToolError({
      code: MCP_ERROR_CODES.FORBIDDEN ?? -32003,
      message: 'Forbidden',
      data: { requiredScope: scope }
    });
  }
}
```

Reutilizável para futuras tools sensíveis sem retrabalho.

---

## Consequências

### Positivas
- **Mitiga risco de key vazada queimar tokens** — capacidade não-óbvia exige decisão explícita do admin.
- **Granularidade combinável** — keys podem ter qualquer subset de scopes.
- **Ativa um eixo de segurança dormente** — `ctx.scopes` finalmente cumpre o propósito para o qual foi modelado.
- **Helper reutilizável** — abre caminho para gradualmente proteger outras tools sensíveis (`update_project`, `update_status` no futuro).

### Negativas
- **Admins precisam aprender o novo scope** — mitigado via doc operacional (Documenter Fase 7).
- **Keys que queiram disparar IA precisam upgrade explícito** — intencional (fail-safe), não bug.
- **Incoerência transitória** — 15 tools sem scope check + 1 tool com check. Aceitável; tornar todas com check é roadmap separado.

### Riscos residuais
- **R1 — Convenção de separador divergir no futuro** (`:` vs `.` vs `/`). Mitigação: este ADR fixa `:` como padrão; documentar em `docs/SYSTEM-OVERVIEW.md` ou equivalente.
- **R2 — Tools antigas continuarem expostas sem scope check.** Mitigação: registrar follow-up de segurança ("aplicar `requireScope` retrocompatível em update_*"); fora deste escopo.

---

## Política operacional (não-escopo deste ADR, registrado para Documenter)

- Endpoint `/mcp/keys` (criação) deve listar `executions:create` entre os scopes disponíveis (UI/admin).
- Documentar no runbook de operações: "para habilitar disparo de IA via MCP, emita key com `scopes: [..., 'executions:create']`".
- CHANGELOG nota: novo scope MCP introduzido; keys antigas continuam funcionando para as 15 tools existentes; apenas `execute_task` exige o scope novo.

---

## Referências

- [ADR-V2-003 — RBAC duplo via DVincula](./ADR-V2-003-rbac-duplo.md) (granularidade de capacidades por dimensão)
- [ADR-V2-004 — MCP/API keys via DTabela](./ADR-V2-004-mcp-keys-dtabela.md) (onde `scopes` é persistido)
- [ADR-V2-042 — Tenant isolation defense-in-depth](./ADR-V2-042-tenant-isolation-defense-in-depth.md) (camada complementar de proteção)
- [ADR-V2-066 — MCP `execute_task` modo assíncrono fire-and-poll](./ADR-V2-066-mcp-execute-task-async.md) (ADR-irmão desta task)
- Plan: `workspace/plans/plan-mcp-execute-task.md` §2.3 Alternativa B

---

**Redigido por:** Implementer Agent V2
**Aceito em:** _pendente CEO_
