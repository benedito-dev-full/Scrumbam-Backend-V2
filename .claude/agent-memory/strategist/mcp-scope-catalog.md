---
name: mcp-scope-catalog-adr-v2-068
description: Catálogo canônico de 6 scopes MCP (ADR-V2-068) — decisão de design, implementação completa (F1–F5)
metadata:
  type: project
---

# MCP Scope Catalog — ADR-V2-068 (Completo)

## Estado: COMPLETO — Fases 1-5 mergeadas, em produção ✅

**Data de conclusão:** 2026-06-17 (Fase 5 — formalização/ADR)

---

## O que foi decidido

### 6 scopes semânticos (não 2, não 17)

```
tasks:read, tasks:write, notifications:read, notifications:write, projects:write, executions:create
```

Agrupam 17 ferramentas por **tipo de ação + domínio**, não por ferramenta individual.

### Privilege escalation via role

- **Autenticado:** `tasks:read` + `notifications:read` + `notifications:write`
- **MEMBER (-162/-172):** ↑ + `tasks:write`
- **MANAGER (-171)/ADMIN (-161):** ↑ + `projects:write` + `executions:create`

Aplicado em `POST /mcp/keys` (gate 403 se solicitar acima do role).

### Storage: ZERO tabela nova

Persiste em `DTabela -472` (MCP_KEY) — campo `dados.scopes` (JSON array).

### Grandfathering one-shot (não DEvento)

Script `scripts/mcp-grandfather-scopes.ts` reescreve keys legadas para `ACESSO_TOTAL`, auditoria inline em `dados.grandfatheredAt` + `dados.scopesPreviousValue`.

**Não emite DEvento** — fora de escopo, auditoria fica em `dados` (simples, idempotente).

---

## Implementação (estado real)

| Fase | O quê | Status | Commit |
|------|-------|--------|--------|
| **F1** | 6 scopes + `requireScope()` em 17 tools | ✅ DONE | `42b8145` |
| **F2** | Gate `POST /mcp/keys` + `/allowed-scopes` endpoint | ✅ DONE | `50ab41f` |
| **F3** | Script grandfather + auditoria inline | ✅ DONE | `c8924d8` |
| **F4** | Frontend role-aware (presets, checkboxes) | ✅ DONE | `06ecbd8` (Scrumbam-Frontend-V2) |
| **F5** | ADR-V2-068 + docs + atualizar ADR-V2-067 | ✅ DONE | este commit |

---

## Decisões-chave

1. **Separar `executions:create` (queima tokens $) de `tasks:write`** — não colapsar risco.
2. **Não suportar edição in-place de scopes** — revogar + criar nova (força decisão consciente).
3. **Grandfathering via script, não trigger** — idempotente, rodável múltiplas vezes.
4. **Auditoria inline, não DEvento** — simples, sem tabela nova.

---

## Próximos passos (não deste ADR)

- [ ] Aplicar `requireScope` retrocompatível em `update_*` tools (segurança futura)
- [ ] Adicionar a capability ao template Devari-Core (padrão `domain:action`)

---

## Referências

- `docs/decisions/ADR-V2-068-mcp-scope-catalog.md` — decisão formal
- `docs/mcp-setup.md` — operacional (catálogo + regras)
- `src/mcp/constants.ts` — tipo + presets
- `src/auth/services/role-resolver.service.ts` — getAllowedMcpScopes (1 query, ZERO N+1)
- `scripts/mcp-grandfather-scopes.ts` — migração idempotente
