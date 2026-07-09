---
name: patterns-learned
description: Padrões técnicos aprendidos por fase/módulo durante reviews — o que checar de novo em código similar (F6-F13, DVincula, RBAC, N+1, HMAC).
metadata:
  type: feedback
---

# Padrões Aprendidos por Módulo/Fase (Reviewer)

**Por que:** cada review revela um padrão específico (bom ou ruim) que não é óbvio a partir do código sozinho — vale a pena checar de novo em módulos parecidos.
**Como aplicar:** ao revisar um módulo do mesmo domínio (RBAC, HMAC, seed, N+1, agent/), buscar a seção correspondente abaixo antes de aprovar.

## Prompt Builder (F13, 2026-05-26)
- `DANGEROUS_CHARS` do CommandValidator é global: qualquer texto por `args[]` (inclusive placeholders internos) não pode conter `[|&;\`$()<>]`. Prompts de linguagem natural sempre têm parênteses. Fix: placeholder simbólico `<task-built-prompt>` em vez do prompt real no `args`.
- Mock de CommandValidator em integration test mascara rejeição — sempre incluir 1 cenário com o CommandValidator REAL quando o placeholder gerado pelo sistema é passado.
- Anti-enumeration: diferença NotFoundException vs ForbiddenException vaza existência do recurso. Preferir incluir `idProject` no WHERE do banco.
- `BigInt("abc")` sem validação = 500. Sempre `@Matches(/^\d+$/)` em campos convertidos com `BigInt()`.
- Prompt completo em `args` do command é arquiteturalmente errado — usar placeholder simbólico curto sem metacaracteres.

## Agente V2 — RUN_CLAUDE_CODE + session extraction (F13 Task1 Sub4)
- `execFile` (não `exec`) com args como array, sem `shell:true` — defesa obrigatória contra injection de shell.
- `realpathSync` em AMBOS os lados da comparação de path (workspace E cada allowedRoot) — canonicalizar só a entrada permite burla via symlink nos roots.
- Mutex em `try/finally` deve ser o bloco MAIS EXTERNO da função async que detém o lock.
- `sendExecutionResult` fire-and-forget: sem `await`, com `.catch(err => logger.error(...))` explícito, `void` suprime warning.
- `session_id` (snake_case, canônico p/ `--resume`) vs `uuid` (id de execução, não reaproveitável) — verificar que o parser extrai `session_id`.
- `is_error:true` no output do Claude Code não entra automaticamente em `success` — débito semântico aceitável para MVP se documentado; senão M1.
- Slug sanitização (`/^[a-zA-Z0-9._-]+$/`) ANTES de usar em parser de texto line-by-line — defesa contra injection.

## Endpoints Hierárquicos (fases-via-dtask-idpai F4, 2026-05-21)
- `@Matches()` obrigatório em DTOs que alimentam `BigInt()` — sem isso, string não-numérica = 500 em vez de 400.
- Ordenação de rotas NestJS: `:id/tree` ANTES de `:id` (senão o catch-all captura a string composta).
- Tenant gate anti-enumeration em stubs: `findOne(id, allowed)` ANTES do stub, senão atacante distingue 404 de 501.
- CTE recursiva + cursor pagination: `where.chave = { ...(where.chave as BigIntFilter), in: ids }` — sem spread, cursor é perdido.

## ADR Reviews (fases-via-dtask-idpai, 2026-05-21)
- CTE recursiva com guardrail de profundidade exige propagar coluna `depth` em AMBOS os branches (âncora `0 AS depth`, recursivo `d.depth+1`).
- Plano e ADR são par normativo — decisões do plano devem também aparecer no ADR (único doc que chega ao Implementer de fases posteriores).
- Reviews ADR-only (sem código): focar em (1) completude estrutural, (2) decisão única não-ambígua, (3) anti-padrões ausentes, (4) exemplos técnicos corretos, (5) rastreabilidade. Bug em snippet SQL tem peso HIGH (é referência normativa).
- Gate CEO elevado (>7.0) é correto para ADR fundacional que propaga para N fases sequenciais.

## AgentAuthGuard / HMAC (F13 hmac-alignment)
- `timingSafeEqual` com guarda dupla: `length !== length || length === 0` ANTES da chamada — buffers vazios iguais passariam sem o segundo guard.
- Regex `/^\/api\/v\d+/` para strip de prefix é frágil se `API_PREFIX` for não-padrão (ex: `api/v2beta`) — M1 teórico, não bloqueante enquanto hardcoded.
- Ordem de validações por custo: headers cheap → timestamp cheap → nonce Redis (medium) → agentId match cheap → load DB + decrypt (caro). Decrypt antes do nonce = MAJOR (flood de decifragens via replay).
- `bodyParser:false` + `express.json({verify})` é o padrão correto para HMAC do body — `JSON.stringify(req.body)` reordena campos e invalida qualquer HMAC.

## Folders MVP (DEntidade + DVincula, pós-F5)
- DVincula N:1 (1 project, 1 folder ativo): unicidade via service (`updateMany(excluido=true)` + `create` em `$transaction`), não schema.
- N+1 interno em script de backfill one-shot é aceitável — não é runtime (`prisma/scripts/`, nunca importado de `src/`).
- Comentário JSDoc de contagem no seed (`"45 fixas + N = Total"`) é débito recorrente — validar runtime vs header manualmente.
- Rotas literais específicas (`/folders/unassigned`) DEVEM vir antes de rotas wildcard (`:folderId`) no mesmo controller.
- DRY via duplicate privado (~30 linhas) é aceitável para evitar `forwardRef` circular — documentar via JSDoc `@see` + nota de cleanup futuro.

## Eventos Canônicos (F7)
- `import type { IEventProducer }` é o padrão correto para evitar dependência circular runtime — grep `from.*eventos` em `src/engine/` deve mostrar só `import type`.
- DEvento deve ter APENAS 1 ponto de INSERT (`AuditLogConsumer`) — qualquer `prisma.dEvento.create` fora disso (exceto módulos não-migrados pré-F7) é REJEITAR.
- `Promise.allSettled` no Producer é o padrão correto — consumers não bloqueiam o caller.

## Flow Metrics / Forecast (F8)
- N+1 em loop de sprints: usar `groupBy(['idSprint'])` + `_count`, não loop com `count()`/`findMany()` por sprint.
- Filtrar por `doneAt` (telemetry em JS), NUNCA por `criadoEm`, quando a intenção é "concluídas no período".
- PeriodResolver obrigatório em qualquer módulo read-only com filtro de período — nenhum service deve usar `new Date()` direto em filtros.
- CFD via replay DEvento -498: buscar taskIds → eventos até fim do período → filtro em memória por taskIdSet → transições por dia. Filtro em memória é aceitável (sem FK DEvento→DProject).
- Monte Carlo: (1) filtro throughput<=0 antes do resample, (2) guard contra loop infinito, (3) seed determinístico para teste. Faltar 1 = MAJOR.

## Search (F8 Task#2)
- DVincula→DEntidade em 2 queries sequenciais (não N+1): findMany IDs → findMany IN. Total 2, não N.
- Promise.all com branches de N queries é OK se total ≤5 e sem loop com await individual.
- Search controller próprio é sempre justificado quando acessa 3+ tabelas com resultado categorizado — não penalizar Pilar 2.
- `MinLength(2)` obrigatório em campo de busca — sem isso, ILIKE '%a%' = full-table scan.

## RemoteExecutionClient / Execution callback (F13 Task2 Sub2.2-2.4)
- Specs de stubs são responsabilidade do Implementer na mesma sub-tarefa que muda a interface.
- Fallback de compatibilidade implícito viola decisão explícita de "quebra controlada" no plano.
- Isolation dupla camada obrigatória em callback inbound de agente: (1) `dados.audit.agentId` vs path/header, (2) sanity check adicional. Falta da camada 2 = MINOR; falta da 1 = MAJOR.
- `claudeSessionPath` é campo de ENTRADA — presença em qualquer DTO de response ao frontend é MAJOR (vazamento).
- Idempotência via sentinel (`dados.audit.outcome.recordedAt`): checar ANTES de instanciar Engine; retorno idempotente não deve mutar nem emitir eventos.

## Agente V2 — HTTP Server + HMAC (F13 Task1 Sub2)
- Bind deve ser string literal `'127.0.0.1'` hardcoded no `listen()` — variável ou ausência = REJEITAR.
- Canonical string HMAC: `[method, path, timestamp, nonce, sha256(rawBody)].join('\n')` — verificar paridade exata client/server.
- Nonce registrado APÓS HMAC válido, nunca antes (nonce em falha de HMAC = vetor DoS no LRU).
- Build pré-existente com erros: confirmar via `git stash` + `npm run build` que não é introduzido pela task.
- Scope creep: diretórios de sub-tarefas futuras devem conter só `.gitkeep`.

## Slug Derivation (F13 Task2 Sub2.3)
- Backfill `onModuleInit` sequencial (`for...of` com `await`) é correto — `Promise.all` seria race condition interna.
- Fallback `untitled-<timestamp-base36>` para slugify()='' é pragmático — não bloqueia cadastro, índice unique resolve colisão.
- Race P2002 entre `findFirst` e `create` é MINOR (baixa probabilidade, degrada para 500 controlado), não MAJOR.
- `Prisma.AnyNull` (path ausente) vs `Prisma.JsonNull` (campo null) — combinação `OR` captura todos os casos de ausência.

## Bookmarks / DVincula (Task D1/D2, 2026-05-27)
- `@IsNumberString()` obrigatório em todo campo alimentando `BigInt()` — `@IsString()` sozinho permite SyntaxError (500).
- Bug clássico de paginação: `hasMore` sobre array pós-filtro-em-memória (`filtered.length`) mente sobre o banco. Mover filtro para WHERE Prisma (`metaDados: {path:[...], equals:...}`) ou ajustar lógica.
- Dedup upsert-safe: 1 `findMany` sem filtro `excluido` (ativos + soft-deleted) é mais eficiente que 2 queries.
- `$transaction` desnecessário em write único (create/update simples) — só multi-tabela ou write dependente exige.

## Agente V2 — install.sh + systemd + CLAUDE.md (F13 Task1 Sub6)
- `agent/.claude/` fora da localização canônica: memória do Implementer deve estar SEMPRE em `.claude/agent-memory/implementer/` na raiz — subprojeto monorepo não deve ter `.claude/` próprio.
- Service systemd com user dedicado + CLI externo autenticado (claude/gh/aws): precisa de um dos 3 caminhos claros para a API key chegar ao processo — ausência de todos = MEDIUM bloqueante.
- `ssh-keyscan 2>/dev/null` descarta fingerprint TOFU — operador perde única chance de verificar. MEDIUM, não CRITICAL.
- `shellcheck -x` (segue source) obrigatório ao revisar bash com includes.
- Idempotência de instalador via sentinel `config.json` (não flag/diretório) é o padrão correto.
- `ProtectHome=read-only` + `chmod 0644` em `/root/.claude/CLAUDE.md` permanece legível pelo service user — válido para trade-off CEO-usa-root.
