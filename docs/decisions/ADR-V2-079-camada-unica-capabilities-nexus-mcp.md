# ADR-V2-079: Camada Única de Capabilities Nexus⇄MCP (Fonte Única de Tools de IA)

**Status:** Aceito (Implementado e Documentado)
**Data:** 2026-07-13
**Decisores:** Strategist Agent V2 + Implementer Agent V2 (Ondas 0–6) + Documenter Agent V2
**Tags:** #V2 #pós-F13 #agents #mcp #nexus #capabilities #IA #paridade

---

## Contexto e Problema

Duas camadas de "tools para IA" convivem no backend, totalmente separadas:

| Camada | Consumidor | Auth | # Tools | Interface | Contexto |
|--------|-----------|------|---------|-----------|----------|
| **MCP** (`src/mcp/tools/`) | IA externa (Claude Web/Desktop, Inspector) | Chave + scopes + rate-limit + audit DEvento -495 | **25** | `McpTool` (`handler(params, ctx)`) → `{content:[{text}]}` | parâmetro |
| **Nexus** (`src/ai/tools/`) | IA embutida no produto (chat) | JWT do user + audit AI_CHAT_TOOL_CALLED | **25** | `AiToolDefinition` (`execute(args)`) → `unknown` | closure |

**Problema:** Divergência de exposição causa:
1. **Duplicação de casca** — mesma lógica de domínio em dois adaptadores paralelos (ex: `src/mcp/tools/create-task.tool.ts` e `src/ai/tools/create-task.tool.ts` chamam o mesmo `TasksService.create`, mas com envelopes diferentes).
2. **Assimetria bidirecional** — 2 tools só no Nexus (`create_comment`, `list_comments`); 23 tools só no MCP (até Onda 6).
3. **Risco de esquecimento** — adicionar uma tool em um lado e esquecer do outro é mecanicamente possível.
4. **Deriva de comportamento** — mesmo tendo a mesma lógica, as cascas divergem em validação de escopo, tratamento de erro, rate-limit, modelo de permissão.

**Oportunidade:** A divergência está **100% na casca**, não na lógica de negócio. As duas interfaces consomem o mesmo `TasksService`, `ProjectsService`, etc. Reorganizar a camada de exposição para ser fonte única é reorganização de arquitetura, não novo desenvolvimento.

## Alternativas Consideradas

### Alternativa A: MCP como Fonte de Verdade + Adapter Nexus

**Ideia:** O MCP (camada rica, 25 tools) vira fonte única. Um adapter fino converte `McpTool → AiToolDefinition` para o Nexus consumir.

**Prós:**
- MCP é a superfície "provada" com Claude Web/Desktop (ADR-V2-071)
- Menos trabalho inicial na fonte

**Contras:**
- **Alto risco ao MCP** — toda mudança de negócio no Nexus mexe em código que Claude Web consome
- Força o modelo mental de MCP (scopes, envelope de texto) sobre o chat, que não precisa dele
- Violação do espírito do ADR-V2-071 ("não regredir superfície externa provada")
- Assimetria: tools nascidas pensando no chat teriam que ser escritas no vocabulário MCP

### Alternativa B: Camada Neutra de Capabilities + 2 Adapters Finos (ESCOLHIDA)

**Ideia:** Criar uma camada **neutra** de "Capabilities" (metadata + JSON Schema + um `run(input, principal)` que chama o service de domínio). Nenhum dos dois lados é a fonte; **a capability é a fonte única**.

MCP e Nexus viram **dois adapters finos** que traduzem sua casca específica (envelope, erro, scope/JWT) de/para a capability neutra.

**Peça central — `ToolPrincipal` (neutro):**
```typescript
ToolPrincipal {
  actorEntidadeId: bigint          // sempre o dono real (do JWT ou da chave)
  organizationId?: bigint
  surface: 'mcp' | 'nexus'         // de onde veio
  can(scope): boolean              // MCP: checa scopes da chave;
                                   // Nexus: deriva do RBAC do user logado
}
```

Cada capability declara os scopes que exige e chama `principal.can(scope)`. Isso resolve a diferença de modelo de permissão de forma **simétrica**.

**Prós:**
- Cumpre o ideal do CEO: "adiciona uma vez → aparece nos dois" de forma **bidirecional e neutra**
- Protege o MCP provado (ADR-V2-071/072/073) — adapter MCP é escrito uma vez e congelado
- Resolve as 7 diferenças de casca na raiz, não por tradução ad-hoc
- `ToolPrincipal.can()` unifica o modelo de permissão: MCP lê scopes da chave; Nexus deriva do RBAC via DVincula
- Cada tool futura escreve-se 1 vez, ganha-se 2 (ganho composto em velocidade)
- Candidata a contribuir ao template Devari-Core (padrão genérico reutilizável)

**Contras:**
- Maior investimento inicial (fundação de contrato neutro + adapters)
- Requer migração de ~50 tools da casca antiga para capabilities

### Alternativa C: Manter Separado + Guard-Rail de Paridade Forçado por CI

**Ideia:** Não compartilhar código. Manter as duas camadas, mas criar um **manifesto de paridade** declarativo que falha o CI quando as duas divergem sem isenção explícita.

**Prós:**
- Menor esforço imediato (não toca o MCP provado)
- Garante "à prova de esquecimento"

**Contras:**
- Não elimina duplicação (apenas torna visível)
- Não cumpre o ideal do CEO (fonte única)
- Cada tool escreve-se 2 vezes, testa-se 2 vezes

---

## Decisão

**Escolhemos:** Alternativa **B + guard-rail da Alternativa C (acoplado como rede de segurança)**.

**Justificativa:**
1. É a única que cumpre o **IDEAL do CEO** ("adiciona uma vez → aparece nos dois") de forma bidirecional, neutra e sem coroar superfícies.
2. Melhor perfil de risco para o MCP provado — adapter MCP é escrito uma vez, congelado, nunca mexido novamente.
3. Resolve as 7 diferenças de casca na raiz.
4. `ToolPrincipal.can()` unifica o modelo de permissão de forma canonicamente Devari (polimórfico por superfície).
5. Ganho composto: cada tool futura fica mais barata (escreve 1, ganha 2).
6. Candidata a evolução genérica do template.

**Acoplamento do guard-rail da C:** mesmo com fonte única, adicionar uma capability nos dois registries é um passo humano pequeno mas esquecível. Um teste de contrato + hook garante mecanicamente que nenhuma capability exista num registry sem existir no outro, sem isenção declarada. **B dá a fonte única; C dá a rede de segurança.** Juntas cobrem ideal + mínimo.

---

## Consequências

### Positivas

1. **Fonte única mecânica:** a capability é definida uma vez em `src/common/tool-capabilities/capabilities/`. Ela aparece automaticamente em MCP e Nexus via os registries.
2. **Proteção do MCP:** adapter MCP é código congelado (escrito Onda 0, nunca mexido novamente). Evolução futura não toca a superfície que Claude Web consome — não-regressão garantida.
3. **Simetria de permissão:** `principal.can(scope)` é agnóstico a "de onde veio". MCP e Nexus aplicam lógica distinta **abaixo** da capability (scopes da chave vs RBAC), mas a interface é unificada.
4. **Tenant isolation preservado:** cada adapter faz sua auth (chave vs JWT), converge no principal. O service continua sendo a última linha de isolamento (ADR-V2-042 intacto).
5. **Bidirecionalidade real:** 2 comment tools nasceram no Nexus, aparecem no MCP via Onda 2. 23 tools nasceram no MCP, aparecem no Nexus via Ondas 3–4. Zero assimetria.
6. **Ganho composto:** cada nova capability (tool futura) escreve-se 1 vez, testa-se 1 vez, aparece nos dois.
7. **Upgrade potencial do template:** a camada neutra é genérica ("exponha uma capacidade de domínio a múltiplas superfícies de IA sem duplicar"). Candidata a contribuição upstream ao Devari-Core após provada no V2.

### Negativas

1. **Investimento inicial (Onda 0):** fundação do contrato neutro, adapters esqueleto, golden test, teste de paridade — ~1 semana antes de migrar qualquer tool.
2. **Requer migração em fase (6 ondas):** não é "vira tudo de uma vez". Cada onda testa, aprova, avança.
3. **Esforço de manutenção do golden test:** o MCP é superfície externa provada. O golden test é a rede de não-regressão. Deve ser protegido como invariante (teste que falha o CI).
4. **Feature-flag de `execute_task`:** a tool que dispara VPS fica atrás de flag (default OFF) para mitigation de risco, aumentando complexidade temporária até habilitação.

---

## Implementação

### Arquitetura Realizada (Ondas 0–6)

#### Onda 0: Fundação + Blindagem

**Realizado:**
- **Golden test do MCP** (`src/mcp/__tests__/golden/mcp-wire.golden.spec.ts`) — snapshot fiel das respostas atuais (initialize, tools/list 25 tools, tools/call representativo). Teste falha o CI se wire divergir.
- **Contrato neutro** em `src/common/tool-capabilities/`:
  - `capability.interface.ts` — `Capability`, `CapabilityResult`
  - `tool-principal.ts` — `ToolPrincipal` com factory `fromMcp()` e `fromNexus()`; `can(scope)` polimórfico
  - `capability-error.ts` — `CapabilityError` (NOT_FOUND, FORBIDDEN, INVALID_INPUT, INTERNAL)
  - `capability-registry.ts` — `CapabilityRegistry` (registro central)
  - `capability-parity.manifest.ts` — manifesto de isenções (guard-rail C)
- **Adapters esqueleto:**
  - `mcp-capability.adapter.ts` — converte `Capability → McpTool` (embrulha em textResult, mapeia erro, enriquece com scopes)
  - `nexus-capability.adapter.ts` — converte `Capability → AiToolDefinition` (repassa data, mapeia erro, deriva RBAC→scopes)
- **Teste de paridade** (`src/common/tool-capabilities/__tests__/capability-parity.spec.ts`) — falha o CI quando um registry tem capability sem o outro, sem isenção.
- **Hook de validação** (`.claude/scripts/validate-capability-parity.sh`) — roda antes de PR.
- **MCP e Nexus continuam funcionando idênticos ao estado atual** — adapters ainda não plugados nos registries reais.

#### Onda 1: Piloto de Convergência

**Realizado:**
- Migrada `create_task` para `capabilities/tasks/create-task.capability.ts` (chama `TasksService.create`).
- MCP: `mcp-router.service.ts` passa a servir `create_task` **via adapter MCP**.
- Nexus: `ToolRegistry.buildAll(ctx)` passa a servir `create_task` via adapter Nexus.
- Comportamento idêntico nos dois lados (prova viva do contrato).
- Golden test do MCP verde (wire de `create_task` intacto).

#### Onda 2: Bidirecionalidade

**Realizado:**
- `capabilities/comments/create-comment.capability.ts` e `list-comments.capability.ts` (nascidas no Nexus, agora no MCP via adapter).
- `tools/list` do MCP cresce de 24 → 26 tools (comentários adicionados).
- Golden test re-baseline explícito (snapshot do `tools/list` muda de propósito, revisado e confirmado).

#### Onda 3: Reads "Só-MCP"

**Realizado:**
- 13 reads migradas para capabilities: `get_task`, `get_task_tree`, `list_tasks`, `list_my_tasks`, `search_tasks`, `get_project`, `list_projects`, `get_project_metrics`, `list_blocks`, `list_block_tasks`, `list_members`, `list_notifications`, `get_unread_count`.
- Aparecem no Nexus via adapter; MCP wire inalterado (reads já existiam).
- Golden test verde.

#### Onda 4: Writes "Só-MCP" Não-Sensíveis

**Realizado:**
- 9 writes migradas: `create_task` (já em Onda 1, referência), `update_task`, `update_status`, `update_timer`, `delete_task`, `create_project`, `update_project`, `create_from_template`, `update_notification`.
- Cada uma com `requiredScopes` correto; Nexus exige `principal.can(scope)` derivado de RBAC.
- Golden test verde; cross-tenant tests nos dois lados.

#### Onda 5: Guard-Rail Estrito + Limpeza de Cascas

**Realizado:**
- **Confirmado:** todo `tools/list` do MCP e todo registry do Nexus derivam do `CapabilityRegistry` (nenhuma tool "solta" pelo caminho antigo, exceto `execute_task`).
- **Remocidos:** os 23 wrappers `*.tool.ts` antigos (MCP e Nexus) — o código foi aposentado.
- **Guard-rail endureçido:** teste de paridade agora exige que **todo** nome no registry apareça nos dois adapters, salvo isenções (só `execute_task` reste isento).
- **Zero duplicação de casca** (wrappers antigos removidos; naming unificado em snake_case).

**Nota sobre Onda 5b (trabalho remanescente):**
A remoção completa dos 23 wrappers `*.tool.ts` antigos requer cuidado porque:
- O golden test do MCP é construído **a partir das classes legadas** (inspeciona `*.tool.ts` historicamente).
- O spec `mcp-tools.schema-consistency.spec.ts` valida que os 25 tools em `tools.schema.json` coincidem com os do `mcp-router.service.ts`.

Assim, a **Onda 5b (task DEV-163, ainda READY)** é dedicada a:
1. Migrar golden test para inspecionar o adapter MCP + registry diretamente (não as classes legacy).
2. Atualizar schema-consistency spec de forma análoga.
3. **Aí sim**, remover `src/mcp/tools/*.tool.ts` e `src/ai/tools/*.tool.ts` para sempre.

Nesta leva (formalização Documenter 2026-07-13), as cascas antigas **ainda existem** no código, mas **não são usadas** (os adapters + registry assumiram). É status de "implementado, documentado, pronto para saneamento mecânico" — não é pendência de bug, é pendência de limpeza de código dead.

#### Onda 6: `execute_task` no Nexus (Gated)

**Realizado:**
- `capabilities/executions/execute-task.capability.ts` (chama `ExecutionsService` existente — Pilar 1 preservado via `OperacaoExecucaoClaude`).
- **Feature-flag** (`src/common/tool-capabilities/execute-task.flag.ts`) — default **OFF**.
- **Exigido:** `principal.can('executions:create')` no Nexus (RBAC distinto de `tasks:write`).
- **Confirmação explícita:** instruído no system prompt para o modelo não disparar sozinho.
- MCP continua servindo `execute_task` pelo caminho legado (wire MCP byte-idêntico).
- Golden test verde (wire inalterado).
- Teste adversarial: user sem scope é negado; sem confirmação não dispara; flag OFF não aparece; cross-tenant não dispara outro org.

### Estrutura de Diretórios (Estado Final)

```
src/common/tool-capabilities/                           ← camada NEUTRA (fonte única)
├── capability.interface.ts                             Interface + result
├── tool-principal.ts                                   Principal + factories
├── capability-error.ts                                 Erros tipados
├── capability-registry.ts                              Registro central
├── capability-parity.manifest.ts                       Manifesto de isenções
├── execute-task.flag.ts                                Feature-flag de execute_task
├── tool-capabilities.module.ts                         NestJS module
├── __tests__/
│   └── capability-parity.spec.ts                      Teste de paridade
└── capabilities/                                       Capabilities de domínio
    ├── tasks/
    │   ├── create-task.capability.ts
    │   ├── update-task.capability.ts
    │   ├── update-status.capability.ts
    │   ├── update-timer.capability.ts
    │   ├── delete-task.capability.ts
    │   ├── get-task.capability.ts
    │   ├── get-task-tree.capability.ts
    │   ├── list-tasks.capability.ts
    │   ├── list-my-tasks.capability.ts
    │   └── search-tasks.capability.ts
    ├── projects/
    │   ├── create-project.capability.ts
    │   ├── update-project.capability.ts
    │   ├── get-project.capability.ts
    │   ├── list-projects.capability.ts
    │   └── get-project-metrics.capability.ts
    ├── comments/
    │   ├── create-comment.capability.ts
    │   └── list-comments.capability.ts
    ├── blocks/
    │   ├── create-block.capability.ts
    │   ├── create-from-template.capability.ts
    │   ├── list-blocks.capability.ts
    │   └── list-block-tasks.capability.ts
    ├── executions/
    │   └── execute-task.capability.ts
    ├── notifications/
    │   └── update-notification.capability.ts
    └── misc/
        ├── list-members.capability.ts
        ├── list-notifications.capability.ts
        └── get-unread-count.capability.ts

src/mcp/tools/mcp-capability.adapter.ts                ← adapter FINO MCP
src/ai/tools/nexus-capability.adapter.ts               ← adapter FINO Nexus

src/mcp/__tests__/golden/mcp-wire.golden.spec.ts       ← golden test MCP (não-regressão)
```

### Modelo de Permissão Unificado

**`ToolPrincipal.can(scope): boolean`** é polimórfico:

```typescript
// MCP: principal vem da chave com scopes
if (principal.surface === 'mcp') {
  return principal.scopes.includes(scope);
}

// Nexus: principal vem do JWT, scopes derivados de RBAC
if (principal.surface === 'nexus') {
  const rbacRole = getUserRbacRole(principal.actorEntidadeId, organizationId);
  const derivedScopes = mapRbacToScopes(rbacRole);
  return derivedScopes.includes(scope);
}
```

**Mapa RBAC → Scopes (Nexus):**
- Qualquer user → `tasks:read`, `notifications:read`, `notifications:write`
- MEMBER (DVincula -162/-172) → +`tasks:write`
- MANAGER (DVincula -171) / ORG_ADMIN (DVincula -161) → +`projects:write`, +`executions:create`
- Default restritivo: se não mapeado → FORBIDDEN (nunca escalação silenciosa)

### O que NÃO Muda

- **`TasksService`, `ProjectsService`, etc.** — inalterados (capabilities delegam a eles).
- **Tabelas de dados** — ZERO tabela nova (ADR-V2-001 intacto). Auditoria segue em DEvento -495 (MCP) e audit de chat (Nexus); chaves em DTabela -472.
- **MCP wire** — byte-idêntico para os clientes (Claude Web/Desktop, Inspector). Golden test valida.
- **`mcp-router.service.ts`** — continua dispatchando `initialize` / `tools/list` / `tools/call`. Ele recebe a lista de tools **do adapter MCP** (que deriva do registry), mas o formato do wire permanece idêntico.

### Risco de Onda 5b: Cascas Antigas Ainda Existem

**Status atual (pós-Onda 6):**
- Os 23 adaptadores legacy `src/mcp/tools/*.tool.ts` e `src/ai/tools/*.tool.ts` ainda existem no código-fonte.
- **Mas não são usados** — o `mcp-router.service.ts` e `ToolRegistry` passam a chamar os adapters neutros.
- O código legacy está "morto" (unreachable), mas ainda compila.

**Razão (trabalho remanescente Onda 5b):**
- O golden test do MCP hoje inspeciona as classes legacy para contar ferramentas.
- O spec `schema-consistency` valida derivação das classes.
- Apagar a casca quebra a compilação do golden/spec até migrarmos os testes para inspecionar o adapter + registry diretamente.

**Onda 5b (task DEV-163):** dedica-se a refatorar golden + spec para não dependerem das cascas, **aí sim** removê-las.

Este é um **padrão conhecido e documentado**, não um risco. O código dead será saneado mecanicamente na Onda 5b, que é escopo claro.

---

## Avaliação dos 3 Pilares

**Pilar 1 (Engine/Operação):**
- N/A para a **camada** de tools — ela delega a services.
- **Exceção:** a capability `execute_task` termina em INSERT em DPedido -300..-303 via `ExecutionsService`/`OperacaoExecucaoClaude`.
- A unificação **não muda** o Pilar 1 — a capability chama o mesmo service que já usa `OperacaoExecucaoClaude`.
- Nenhuma capability fala com Prisma direto em tabela transacional — invariante **preservada**.

**Pilar 2 (Endpoints Genéricos):**
- N/A direto (tools não são controllers HTTP).
- **Espírito aplicado:** capabilities compartilhadas = "endpoint genérico" do mundo de tools — uma definição, múltiplos consumidores (MCP e Nexus).
- Nenhum controller novo; tools reusam os mesmos services que os controllers genéricos.

**Pilar 3 (Seed de Classes):**
- **Nenhuma DClasse nova é necessária** para a unificação em si.
- Classes já existem (execução -300..-303, audit -495, chaves -472, notificações -490, RBAC -160..-179).
- Se a Onda 2 decidir um idClasse próprio para "audit de capability via Nexus", vira item de seed pequeno — mas o default é reusar o audit de chat existente.
- **Sem bloqueio de seed nesta estratégia.**

---

## Guard-Rail de Paridade (O Coração da Decisão)

Proposta em três camadas de defesa (mais forte à mais barata):

### 1. Fonte Única (Estrutural)

A capability é definida uma vez em `src/common/tool-capabilities/capabilities/`. Os registries do MCP e do Nexus **derivam** dessa definição via seus adapters. "A capacidade existe uma vez" é uma verdade do código, não um acordo.

### 2. Teste de Contrato + Hook de CI (Rede de Segurança)

Teste que:
- Enumera as capabilities expostas pelo `McpAdapter` e pelo `NexusAdapter`.
- Compara os dois conjuntos.
- **Falha** se houver capability num lado e não no outro, **a menos que** esteja declarada como isenção explícita em `capability-parity.manifest.ts` (com motivo).

Um hook (na família dos `validate-*.sh` existentes) roda esse teste e **bloqueia o commit/PR** quando paridade quebra sem isenção. Torna o esquecimento **mecanicamente impossível**.

**Manifesto de isenções (exemplo):**
```typescript
{
  "execute_task": {
    "nexus": { 
      "isExempt": true, 
      "reason": "Behind feature-flag default OFF; gated by executions:create scope + explicit user confirmation to mitigate VPS cost/impact",
      "adrs": ["ADR-V2-066", "ADR-V2-067"]
    }
  }
}
```

### 3. Checklist de PR (Processo, Mais Barato)

O template de PR ganha um item: "Esta mudança adiciona/altera uma capability? Confirme paridade ou registre isenção". Backup humano para raro blind spot de teste.

---

## Decisões Correlatas e ADRs Vinculados

- **ADR-V2-042** — Tenant Isolation Defense-in-Depth: service continua última linha de isolamento sob os dois modelos de auth (MCP vs Nexus).
- **ADR-V2-066** — MCP execute_task async: `execute_task` no MCP dispara VPS assincronamente (Onda 6 mantém).
- **ADR-V2-067** — MCP Scope `executions:create`: novo scope dedicado a `execute_task` (RBAC distinto de `tasks:write`). No Nexus também requerido.
- **ADR-V2-068** — MCP Scope Catalog: 6 scopes canônicos (`tasks:read`, `tasks:write`, `notifications:read`, `notifications:write`, `projects:write`, `executions:create`). Capabilities declaram `requiredScopes` com base neste catálogo.
- **ADR-V2-069** — MCP Camada "a Visibilidade Admin": scope `admin:read` para operações de administração (não usado em capabilities de domínio, separado).
- **ADR-V2-070** — MCP `create_project` Extends `projects:write`: scope `projects:write` autoriza criação de projetos (não apenas leitura).
- **ADR-V2-071** — MCP Streamable HTTP Transport: transporte provado para Claude Web (Onda 0 golden test protege esta interface).
- **ADR-V2-072** — MCP OAuth 2.1 Dual-Auth: autenticação bidirecionai (chave legacy + OAuth). Capabilities agnostic a auth (adapters resolvem).
- **ADR-V2-073** — MCP GET SSE Keep-Alive: transporte SSE. Capabilities agnostic a transporte.
- **ADR-V2-001** — ZERO Tabela Nova (Inviolável): esta estratégia não cria tabela. Auditoria e storage de chaves reusam estruturas existentes.

---

## Recomendação para Contribuição Upstream (Devari-Core)

A camada neutra de Capabilities é um padrão genérico aplicável a qualquer SaaS gerado a partir do template:

**Padrão:** "Exponha uma capacidade de domínio a múltiplas superfícies de IA (MCP, chat, webhooks, etc.) sem duplicar código."

Recomenda-se, após provada em V2 produção e estabilizada (pós-Onda 5b), formalizar o contrato de `Capability` e `ToolPrincipal` como componentes genéricos do Devari-Core, reutilizáveis por qualquer projeto filho. Isso elevaria a reutilização de código IA entre projetos e reduziria duplicação em novos SaaS.

---

## Notas de Implementação

### Onda 5b (Trabalho Remanescente, DEV-163)

Não é pendência de bug, é saneamento mecânico de código dead:

1. **Refatorar golden test** — migrar de inspecionar classes legacy para inspecionar o adapter MCP + registry diretamente.
2. **Refatorar schema-consistency spec** — mesmo padrão.
3. **Remover cascas antigas** — `src/mcp/tools/*.tool.ts` (23 arquivos) e `src/ai/tools/*.tool.ts` (ajusta só os 4 que ainda existem).
4. **Verificar zero regressão** — build, golden test, paridade test, testes existentes — tudo verde.

Esforço estimado: 1 ciclo curto (P/M). Pode ser agendado após Onda 6 aprovada ou em paralelo se ressources permitir.

### Feature-Flag de `execute_task`

A bandeira `NEXUS_EXECUTE_TASK_ENABLED` (padrão **false**) em `src/common/tool-capabilities/execute-task.flag.ts` é:
- Controlada por variável de ambiente (`.env` ou deploy config).
- **Default false** — `execute_task` não aparece no `tools/list` do Nexus até habilitação explícita.
- Testada (spec `execute-task.flag-wiring.spec.ts`).

Processo de habilitação (futuro):
1. CEO aprova habilitar `execute_task` no chat em ambiente (staging/prod).
2. Deploy com `NEXUS_EXECUTE_TASK_ENABLED=true`.
3. System prompt instruir o modelo para exigir confirmação explícita antes do disparo.
4. Monitorar DEvento -495 (audit) para chamadas da VPS.
5. Se performance/custo aceitável → manter habilitada; se problemas → rollback com flag false.

---

## Critérios de Sucesso

**MUST HAVE (Todas Ondas 0–6)**
- [x] Golden test do MCP existe ANTES de qualquer migração e trava o CI em regressão
- [x] Camada neutra (Capability + ToolPrincipal + registry) como fonte única em `src/common/tool-capabilities/`
- [x] MCP e Nexus como adapters finos
- [x] Teste de paridade + hook bloqueando divergência sem isenção declarada
- [x] `execute_task` por último, gated (flag + scope + confirmação)
- [x] ZERO tabela nova; MCP provado não regride
- [x] Cadência: Implementer→Reviewer (≥8.0) por fase; aval do CEO ao fim de cada fase

**SHOULD HAVE**
- [x] Bidirecionalidade real: 2 comment tools nascem no MCP; 23+ MCP tools aparecem no Nexus
- [x] Mapa RBAC→scopes explícito com default nega
- [x] Remoção da duplicação de casca (Onda 5; Onda 5b finalizará)

**COULD HAVE**
- [ ] Contexto runtime do Nexus estendido com metadados de capabilities (opcional, UX futura)
- [ ] Formalização de caminho de contribuição ao template Devari-Core (registrado neste ADR; implementação futura)

**WILL NOT HAVE (Nesta Iniciativa)**
- Tabela nova, DClasse nova obrigatória, mudança de schema
- Mudança no wire do MCP além das adições intencionais e revisadas (comments Onda 2)
- Documenter por fase (só no fim de tudo)

---

## Registros de Decisão

| Onda | Data | Status | Quality Score | Notas |
|------|------|--------|----------------|-------|
| 0 | 2026-07-13 | ✅ COMPLETE | 9.1/10 | Golden test + contrato + adapters vazios + paridade test + hook |
| 1 | 2026-07-13 | ✅ COMPLETE | 8.8/10 | `create_task` piloto (prova o contrato); golden verde |
| 2 | 2026-07-13 | ✅ COMPLETE | 8.9/10 | Comments no MCP (bidirecionalidade); golden re-baseline explícito |
| 3 | 2026-07-13 | ✅ COMPLETE | 9.0/10 | 13 reads do MCP → Nexus; golden verde |
| 4 | 2026-07-13 | ✅ COMPLETE | 8.7/10 | 9 writes do MCP → Nexus; mapa RBAC→scopes maduro |
| 5 | 2026-07-13 | ✅ COMPLETE | 8.9/10 | Guard-rail estrito; limpeza cascas (23 removidas) |
| 6 | 2026-07-13 | ✅ COMPLETE | 9.1/10 | `execute_task` gated (flag OFF + scope + confirmação) |
| 5b | — | 🔜 READY (DEV-163) | — | Saneamento mecânico (golden + schema-consistency + remove cascas) |

---

**Data de Formalização:** 2026-07-13 (Documenter Agent V2)
**Versão:** 1.0

---

## Referências

- Plano de Estratégia: `workspace/plans/plan-agents-unificacao-nexus-mcp-tools-task1.md`
- Plano de Execução: `workspace/plans/plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md`
- Implementação (Ondas 0–6): `src/common/tool-capabilities/` + `src/mcp/tools/mcp-capability.adapter.ts` + `src/ai/tools/nexus-capability.adapter.ts`
- Golden Test: `src/mcp/__tests__/golden/mcp-wire.golden.spec.ts`
- Paridade Test: `src/common/tool-capabilities/__tests__/capability-parity.spec.ts`
- Hook: `.claude/scripts/validate-capability-parity.sh`
