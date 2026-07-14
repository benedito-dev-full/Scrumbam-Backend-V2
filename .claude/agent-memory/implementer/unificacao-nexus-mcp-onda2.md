---
name: unificacao-nexus-mcp-onda2
description: Onda 2 (bidirecionalidade) da unificacao Nexus<->MCP (ADR-V2-079) — create_comment/list_comments nascem no MCP; tools/list 24->26; re-baseline consciente do golden.
metadata:
  type: project
---

# Unificacao Nexus <-> MCP — Onda 2 (bidirecionalidade) concluida

Fonte de verdade do plano: `workspace/plans/plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md` (ADR-V2-079).
Onda 0 (fundacao): [[unificacao-nexus-mcp-onda0]]. Onda 1 (piloto create_task): [[unificacao-nexus-mcp-onda1]].

**Why:** `create_comment`/`list_comments` so existiam no Nexus. Migrar p/ capability
neutra faz elas nascerem TAMBEM no MCP — prova a direcao Nexus->MCP do adapter
(Onda 1 provou a direcao comum, onde a tool ja existia nos dois lados).
**How to apply:** ao pegar Onda 3+ (13 reads so-MCP), o padrao inverso (MCP->Nexus)
ja foi provado na Onda 1; usar esta onda como referencia de "adicionar tool nova
ao tools/list estatico do MCP" quando aplicavel.

## Arquivos-chave criados/alterados

- `src/common/tool-capabilities/capabilities/comments/create-comment.capability.ts` +
  `list-comments.capability.ts` — capabilities neutras, casca fina sobre
  `CommentsService.create`/`findMany` (MESMO service que os wrappers legados
  Nexus `create-comment.tool.ts`/`list-comments.tool.ts` ja chamavam).
  `inputSchema` = copia EXATA do `parameters` dos wrappers legados (paridade
  total, zero ganho/perda de capacidade na migracao). Scope: `tasks:write`
  (create) / `tasks:read` (list) — **reuso deliberado**, NAO scope novo
  `comments:*` (catalogo `MCP_SCOPES` em `src/mcp/constants.ts` nao tem
  scope de comentario; plano recomendou reusar tasks:* p/ nao proliferar).
- `src/common/tool-capabilities/tool-capabilities.module.ts` — registra as
  2 capabilities novas (`registerIfAbsent` generico substituiu o `if` unico
  da Onda 1); importa `CommentsModule` via `forwardRef` (novo import).
- `src/mcp/schemas/tools.schema.json` — **tools/list cresce 24->26**: as 2
  tools novas foram ANEXADAS AO FINAL do array `tools` (apos
  `create_from_template`), com `inputSchema` identico ao das capabilities.
  GOTCHA: `tools/list` do MCP vem deste JSON estatico via
  `cachedToolDefinitions` (NAO do `CapabilityRegistry` — so muda na Onda 5).
  Por isso a Onda 1 nao precisou tocar aqui (create_task ja estava no JSON);
  a Onda 2 precisa, porque as 2 tools NUNCA existiram no MCP.
- `src/mcp/services/mcp-router.service.ts` — NOVO metodo privado
  `resolveCapabilityOnlyTool(name, adapter)`: diferente de
  `resolveCreateTaskTool` (que tem fallback pro wrapper legado), este NAO TEM
  fallback — sem adapter/capability, a tool fica `undefined` e some do
  `tools/call` (mas continua no `tools/list` estatico, que e independente).
  Usado para `create_comment`/`list_comments` (27o e 28o params, mas
  `capabilityAdapter` continua sendo o 26o — os 2 novos NAO sao parametros do
  constructor, so chamadas internas ao metodo dentro do array `tools`).
- `src/ai/tools/tool-registry.ts` — `createCommentTool`/`listCommentsTool`
  REMOVIDOS do constructor e do array `buildAll` (arquivos
  `create-comment.tool.ts`/`list-comments.tool.ts` continuam no repo, so nao
  rodam mais no fluxo — aposentadoria formal fica p/ Onda 5, MESMA disciplina
  da Onda 1 com `create-task.tool.ts`). Agora as 3 capabilities migradas
  (create_task, create_comment, list_comments) vem TODAS de
  `capabilityAdapter.buildAll(ctx, scopeResolver)` — nao precisa de wiring
  individual por capability nova, o `CapabilityRegistry` ja cobre.
- `src/ai/system-prompt.ts` — `createComment`/`listComments` ->
  `create_comment`/`list_comments` na lista de tools (mesmo motivo da Onda 1
  com `createTask`).
- `src/mcp/__tests__/mcp-router.create-task-capability.spec.ts` — assert de
  `tools/list` tinha `toHaveLength(24)` HARDCODED; atualizado p/ 26 (efeito
  colateral esperado da Onda 2, nao regressao).
- `src/ai/tools/tool-registry.spec.ts` — REESCRITO: construtor do
  `ToolRegistry` mudou (sem os 2 tools legados); registry real agora tem 3
  capabilities (create_task + create_comment + list_comments); testes de
  RBAC por capability (cada uma com seu proprio `requiredScopes`).

## GOTCHA critico: tools/list tem DUAS fontes conforme a tool

Diferente do que a doc da Onda 0 sugeria ("so muda na Onda 5"), na pratica:
- Tool que JA EXISTIA no MCP antes da unificacao (ex: `create_task`): o
  `tools.schema.json` ja a continha -> Onda 1 nao precisou tocar o JSON.
- Tool que NUNCA EXISTIU no MCP (ex: `create_comment`/`list_comments`): o
  JSON precisa GANHAR a entrada manualmente, com `inputSchema` copiado 1:1
  da capability. Isso e o "re-baseline consciente" que o golden exige.
- `tools/call` (dispatch por nome) sempre vem do array `this.tools` do
  router, que É derivado do adapter quando a capability existe — aqui SIM
  o `CapabilityRegistry` e a fonte, mesmo hoje (nao so na Onda 5).

## Re-baseline do golden (registrado, ver comentario no proprio spec)

- `tools-list.baseline.json` regenerado via
  `dist/src/mcp/schemas/tools.schema.json` (node script inline, sort NAO
  aplicado — ordem de insercao preservada). Confirmado programaticamente:
  as 24 tools pre-existentes mantiveram ordem+nome+description+inputSchema
  IDENTICOS; so `create_comment` e `list_comments` foram ANEXADAS ao final.
- Hashes recalculados (`canonicalize` + sha256, MESMA funcao do spec):
  `FROZEN_TOOLS_COUNT` 24->26; `FROZEN_TOOLS_LIST_HASH` e
  `FROZEN_TOOL_NAMES_HASH` novos (`FROZEN_INITIALIZE_HASH` NAO mudou —
  `initialize` nao depende de tools). Comentario `RE-BASELINE DA ONDA 2`
  adicionado no topo do spec, documentando o que mudou e por que.
- `tools-list.baseline.json` estava **untracked no git** (nunca foi
  commitado nas Ondas 0/1 anteriores) — nao houve "diff" git tradicional
  p/ mostrar; a prova de nao-regressao foi um script node comparando
  array de nomes old (hardcoded, 24) vs novo (26) posicao a posicao.

## Testes novos desta onda

- `create-comment.capability.spec.ts` / `list-comments.capability.spec.ts` —
  espelham 1:1 os specs conceituais dos wrappers legados Nexus (nunca tiveram
  spec proprio) + casos de tenant (organizationId presente/ausente),
  targetType case-insensitive, INVALID_INPUT por campo.
- `mcp-router.comments-capability.spec.ts` — prova o wire NOVO no MCP (sem
  fallback legado): envelope textResult, gate de scope por capability
  (create=write, list=read), `tools/list` com 26 e as 2 novas presentes,
  `tools/call` sem adapter = METHOD_NOT_FOUND (-32601) pq nunca existiu
  wrapper legado a cair de volta.
- `tool-registry.spec.ts` reescrito cobre as 3 capabilities via Nexus.

## Resultado

- `npm run build` verde (rm -rf dist + rebuild limpo — Windows as vezes da
  `ENOTEMPTY` em rebuild incremental, `rm -rf dist` resolve).
- Golden MCP verde com baseline conscientemente atualizado (26 tools).
- Paridade (`capability-parity.spec.ts`) verde — create_comment/list_comments
  nao estao no manifesto de isencao (nascem parit arias: aparecem nos dois
  adapters desde o registro).
- ESLint 0 errors nos 12 arquivos tocados/criados.
- 81 testes verdes nas suites filtradas por
  `tool-capabilities|mcp-router|comments-capability|tool-registry|golden`.

## Pendencia de doc (nao tocada nesta onda — Documenter formaliza no fim)

- `src/ai/README.md` ainda lista `createComment`/`listComments` (nomes
  antigos) — Documenter atualiza junto do ADR-V2-079, mesma pendencia que
  ficou de `createTask` na Onda 1.
