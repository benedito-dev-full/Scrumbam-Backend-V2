# ADR-V2-070: Estender `projects:write` para cobrir `create_project` (MCP tool)

**Status:** Aceito
**Data:** 2026-07-03
**Decisores:** Strategist Agent V2, CEO (ratificado 2026-07-03)
**Tags:** #V2 #fase-F11 #mcp #scopes #projects #rbac #catalogo

---

## Contexto e Problema

A tool MCP `create_project` (Task 2 da iniciativa "MCP cria estrutura") expõe a criação de projetos (Space/-350, Folder/-351, List/-352) via MCP. Decisão crítica: qual scope exigir?

### O anterior que já existe

- **ADR-V2-068** (aceito, em produção) define catálogo canônico de 6 scopes MCP:
  - `tasks:read`, `tasks:write`, `notifications:read`, `notifications:write`, **`projects:write`**, `executions:create`
- **`projects:write`** hoje é usado por tool `update_project` — autoriza edição de DProject
- A nova tool **`create_project`** é mutação de projeto (cria DProject + DEntidade-espelho + DVincula MANAGER + seed de statuses)

### O bloqueador

A tool `create_project` efetivamente **amplia a capacidade** de keys com `projects:write` — não apenas editar projetos existentes, mas também criar novos. É uma **widening** (expansão) de escopo.

Decisão: reusar `projects:write` (simples, sem novo scope) vs criar novo scope `projects:create` (granular, fragmentado).

---

## Alternativas Consideradas

### Opção A — Criar novo scope `projects:create`

Novo scope dedicado para criação de projetos, separado de edição.

**Prós:**
- Máxima granularidade: uma key pode ter `projects:write` (edita) sem poder criar (`projects:create`).
- Separação de capacidades (criação vs edição são operações distintas).

**Contras:**
- **Fragmentação de catálogo:** 6 scopes viram 7. Futura `delete_project` seria 8, `archive` seria 9... explosão.
- **Incompatibilidade retroativa:** keys antigas com `projects:write` recebem FORBIDDEN em `create_project`, exigindo nova chave (pior UX que reusar).
- **Preset frontend fica complexo:** `READ_WRITE` preset precisa ser recalculado (inclui `projects:create` ou não?).
- **Sem justificativa semântica:** criação e edição são ambas **mutações de projeto** — mesmo scope.

**Rejeitada** — fragmentação desnecessária sem benefício.

### Opção B — **Reusar `projects:write` (escolhida)**

Estender `projects:write` para cobrir tanto edição quanto criação de projetos.

**Prós:**
- **Semântica unificada:** `projects:write` = "mutar projetos", seja criar ou editar.
- **Zero fragmentação:** catálogo permanece em 6 scopes, escala melhor.
- **Compatibilidade:** keys antigas com `projects:write` já podem criar projetos (sem migração).
- **Simplifica UI:** preset `READ_WRITE` continua oferecendo `projects:write` (agora com capacidade ampliada).
- **RBAC boundado:** widening é limitado por membership (tool valida que o usuário pertence à org; nunca cria em org alheia). Risco controlado.

**Adotada** — praticidade + escala + compatibilidade.

---

## Decisão

### Reusar `projects:write` para `create_project`

A tool `create_project` exige scope `MCP_SCOPES.PROJECTS_WRITE` via `requireScope(ctx, MCP_SCOPES.PROJECTS_WRITE)` como primeira instrução do handler.

**Significado de `projects:write` após esta ADR:**
```
Autoriza: mutações em DProject, incluindo
  - Criar SPACE (-350) numa org à qual o usuário pertence
  - Criar FOLDER (-351) dentro de um projeto existente (via idPai)
  - Criar LIST (-352) dentro de um projeto existente (via idPai)
  - Editar projeto existente (já suportado por update_project)
```

### Mapeamento atualizado

| Scope | Tools (incluindo novas) |
|-------|---|
| **`projects:write`** | `update_project` (15 — já existia) + **`create_project`** (nova — Task 2) |

**Total de tools impactadas:** 1 tool nova consumindo escopo existente.

### RBAC: Autorização por tipo de projeto

A tool `create_project` diferencia autorização por tipo (`idClasse`):

- **SPACE (-350):** autoriza por **membership na org** via `resolveOrgIdsForUser(userEntidadeId)`
  - Paridade HTTP `POST /projects` — qualquer membro da org cria
  - SPACE resolve org automaticamente se usuário pertence a 1; N orgs exigem `orgId` explícito
  - **Decisão aberta ao CEO:** restringir a ORG_ADMIN? Se sim, trocar para `resolveOrgIdsForUser(user, {adminOnly:true})`

- **FOLDER/LIST (-351/-352):** autoriza por **acesso ao projeto pai** via `findOne(idPai, userEntidadeId)`
  - Herda ADR-V2-042/069 (membership direto OU espaço público OU ADMIN herda MANAGER)
  - Mesma autorização que `create_block` (precedente)

**Conclusão:** Widening é **bounded by membership** — tool nunca cria em org que o usuário não pertence. Risco de privilege escalation é zero (gates de membership não mudaram).

### Armazenamento

- **Scope armazenado em:** DTabela idClasse -472 (MCP_KEY), campo `dados.scopes`
- **Ratificação:** Zero tabela nova (ADR-V2-001 respeitado)

### Observação: Restrição futura de SPACE a ORG_ADMIN

**Status atual (HTTP `POST /projects`, paridade com MCP):**
- Qualquer MEMBER da org pode criar SPACE

**Opção futura (decisão do CEO):**
- Restringir SPACE creation a ORG_ADMIN da org
- Alteraria gate via `{adminOnly:true}` em `resolveOrgIdsForUser`
- Seria backward-incompatible: keys antigas com `projects:write` de MEMBERs deixariam de criar SPACE
- **Decisão consciente e explícita do produto** — não é escopo deste ADR

---

## Consequências

### Positivas

- **Compatibilidade retroativa:** Keys antigas com `projects:write` já podem criar projetos. Zero quebra.
- **Semântica unificada:** `projects:write` = "mutar projetos" (criar ou editar). Simples de explicar.
- **Escalável:** Futura `create_board` ou `create_template` reutiliza `projects:write` (não cria novo scope).
- **Alinhado ao template:** Decisão de widening bounded é padrão em OAuth/RBAC (escopos amplos com gates finos no handler).

### Negativos

- **Widening de capacidade:** Chaves antigas _podem_ criar projetos, não apenas editar.
  - Mitigado: gates de membership garantem que nenhuma chave pode criar em org alheia.
  - Mitigado: admin pode revogar key e criar nova com subset de scopes (via Fase 2 gate de `POST /mcp/keys`).

### Riscos residuais

- **R1 — Aplicativo confunde "editar" com "criar" nos logs.** Mitigação: audit trail menciona `action: "create"` vs `action: "update"` explicitamente.
- **R2 — User acredita que `projects:write` é "read-only".** Mitigação: documentação clara em `mcp-setup.md` (scope significa "mutar projetos", criar/editar).

---

## Implementação (Estado atual)

| Item | Status |
|------|--------|
| Tool `create_project` implementada | ✅ DONE — commit task-2 |
| Scope `projects:write` aplicado | ✅ DONE — `requireScope(ctx, MCP_SCOPES.PROJECTS_WRITE)` em handler |
| Tests cobrindo scope ausente → FORBIDDEN | ✅ DONE — `create-project.tool.spec.ts` |
| Documentação (este ADR) | ← AGORA |
| Frontend role-aware atualizado | ✅ DONE (Fase 4 ADR-V2-068) — Frontend-V2 já expõe `projects:write` |

---

## Contribuição ao template Devari-Core

Este padrão — **widening de escopo com gates finos de membership** — é padrão em OAuth/RBAC maduro.

**Sugestão para futuros SaaS gerados:**
- Quando adicionar nova mutação a domínio existente, reusar scope existente se semântica combinar.
- Validar widening com gates de membership/tenant no handler (não confiar só em scope).
- Documentar claramente o que cada scope **autoriza** (criação, edição, deleção) — não apenas "leitura" vs "escrita".

---

## Referências

- [ADR-V2-068 — Catálogo canônico de scopes MCP per-tool](./ADR-V2-068-mcp-scope-catalog.md) (6 scopes, implementação Fases 1–3)
- [ADR-V2-042 — Tenant isolation defense-in-depth](./ADR-V2-042-tenant-isolation-defense-in-depth.md) (gates de membership que mitigam risk)
- [ADR-V2-051 — Hierarquia Space/Folder/List](./ADR-V2-051-projects-hierarchy.md) (`idClasse` -350/-351/-352)
- [ADR-V2-069 — Camada A (espaços públicos) no MCP](./ADR-V2-069-mcp-camada-a-visibilidade-admin.md) (autorização FOLDER/LIST herda via `findOne`)
- **Código:** `src/mcp/tools/create-project.tool.ts`, `src/mcp/constants.ts` (scope definido)
- **Plan:** `workspace/plans/plan-mcp-create-project-task2.md` (detalhe técnico)

---

**Redigido por:** Documenter Agent V2
**Aceito em:** 2026-07-03
**Ratificado em:** 2026-07-03
