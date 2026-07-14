---
name: mcp-create-from-template-tool
description: Tool MCP create_from_template (materializa template -401/-402) — wrapper fino de ProjectsService.createFromTemplate, resolução de org por presença de idPai
metadata:
  type: project
---

# MCP tool `create_from_template` (ADR-V2-061/069/070, 2026-07-03)

Última das 3 tasks "MCP cria estrutura" (após create_project/create_block). Fecha o ciclo: agente materializa molde pronto (DClasse -401 TEMPLATE_LIST / -402 TEMPLATE_SPACE) numa árvore real via 1 comando.

**Why:** MCP não tem org de token; `ProjectsService.createFromTemplate(id, userEntidadeId, organizationId, dto)` LANÇA BadRequest se `organizationId` vazio (linha ~2013-16). O crux da tool é SEMPRE resolver uma org concreta e passá-la no 3º arg — nunca `undefined`.

**How to apply:**
- Wrapper fino de `createFromTemplate` (Pilar 2): ZERO duplicação de cloneTree/remap/seed/RBAC. Autorização da ORIGEM (template) vem de graça do service: usável se `idEstab===org resolvida` (org-scoped) OU `idEstab===null` (global); org alheia→404 leak-free. cloneTree PULA RBAC de origem (usar≠gerenciar, NÃO exige MANAGER na origem). A tool NÃO valida origem.
- **Org de DESTINO ramifica pela PRESENÇA de `idPai`** (não pela classe do template — service é a autoridade classe↔idPai): idPai presente → `findOne(idPai, ctx.dEntidadeId).orgId` (herda+autoriza acesso ao pai; orgId input IGNORADO); idPai ausente → `resolveOrgIdsForUser(ctx.dEntidadeId)` com as 4 regras copiadas de create-project (1→auto / orgId valida membership→FORBIDDEN se alheia / N→INVALID_PARAMS ambíguo / 0→INVALID_PARAMS sem org). Para LIST-template com idPai, a org de findOne bate com `destino.idEstab` que o service revalida.
- inputSchema PLANO (sem anyOf/oneOf na raiz): required só `templateId`; opcionais idPai/orgId/novoNome(255)/novoIcone(50)/includeTasks. templateId passado como STRING ao service (parseBigIntParam só VALIDA, service faz BigInt interno). dto = spread condicional `{...(includeTasks!==undefined?{includeTasks}:{}), ...(novoNome?{novoNome}:{}), ...(novoIcone?{novoIcone}:{}), ...(idPai?{idPai}:{})}` — includeTasks ausente → dto sem a chave, service aplica default true.

**Registro (4 pontos) — cardinalidade 23→24:**
- `tools.schema.json` (espelho byte-a-byte da description da classe), `mcp-router.service.ts` (param posicional `createFromTemplateTool?` ANTES de configService → índice 23; import + push no array), `mcp.module.ts` (import + provider).
- `mcp-tools.schema-consistency.spec.ts` (`new CreateFromTemplateTool(noop)` no buildRegisteredTools), `mcp-block-d.spec.ts` (23→24 + append 'create_from_template' na lista de nomes NA ORDEM do JSON).
- Spec buildRouter: `new Array(23).fill(undefined)` então push(tool) → índice 23; configService(24) undefined.

**GOTCHA hook eslint:** o PostToolUse eslint roda por-Edit e reporta "defined but never used" no estado INTERMEDIÁRIO (import antes do uso ser adicionado no edit seguinte). Falso positivo — reconfirmar com `npx eslint` sobre o arquivo final (exit 0). Não refazer edits.

**Baseline MCP:** 4 suites SEMPRE falhando (não regressão, listadas no DoD): update-timer.tool, update-timer.integration (TS2352), execute-task.integration, mcp-block-d (fake-timer timeout — teste DIFERENTE do de cardinalidade que eu editei). `npx jest src/mcp` = 4 failed/32 passed suites, 3 failed/338 passed tests. Meu spec 18 verdes + consistency verde. Gate build = `npm run build` (`make` não existe neste repo; exit 0).
