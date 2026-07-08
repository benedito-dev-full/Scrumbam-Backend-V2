---
name: padroes-aprendidos-por-fase
description: Padrões técnicos aprendidos durante reviews, organizados por fase/task. Consultar ao revisar módulos similares (F13 agente/HMAC, F8 forecast, ADRs, bookmarks, MCP, etc).
metadata:
  type: project
---

## PROMPT BUILDER (2026-05-26)
- `DANGEROUS_CHARS` do CommandValidator é global: prompts de linguagem natural SEMPRE conterão parênteses. Fix: placeholder simbólico `<task-built-prompt>` em vez do prompt real no `args`.
- Mock de CommandValidator em integration test mascara rejeição — sempre incluir 1 cenário com o CommandValidator REAL.
- Anti-enumeration na query de scoping: incluir `idProject` no WHERE do banco para retornar NotFoundException em ambos os casos (existe outra org vs não existe).
- `BigInt("abc")` sem validação = 500 — sempre `@Matches(/^\d+$/)` em campos convertidos com `BigInt()`.
- Prompt completo em `args` do command é arquiteturalmente errado — usar valor simbólico curto sem metacaracteres.

## F13 TASK1 SUB4 (Agente V2 — RUN_CLAUDE_CODE + session extraction)
- `execFile` sem shell é defesa obrigatória para spawn CLI externo (args como array, sem `shell: true`).
- `realpathSync` em AMBOS os lados da comparação de path (workspace E allowedRoots) — canonicalizar só a entrada permite burla via symlink nos roots.
- Mutex em `try/finally` deve ser o bloco MAIS EXTERNO da função async que detém o lock.
- `sendExecutionResult` fire-and-forget precisa `.catch` explícito + `void` — ausência = unhandled rejection potencial.
- Dois UUIDs no output do Claude Code: `session_id` (canônico p/ `--resume`) vs `uuid` (não reaproveitável) — extrair sempre `session_id`.
- `is_error:true` não entra automaticamente em `success` — MEDIUM se não documentado explicitamente.
- Teste com título prometendo comportamento que o assert não verifica = MEDIUM, não CRITICAL, se o comportamento real é razoável para MVP.
- Slug sanitização (`/^[a-zA-Z0-9._-]+$/`) como defesa contra injection em parsers de texto ANTES de usar em busca de seção.

## ENDPOINTS HIERÁRQUICOS (fases-via-dtask-idpai F4, 2026-05-21)
- `@Matches()` obrigatório em DTOs que passam para `BigInt()` — sem isso, string não-numérica = 500 em vez de 400.
- Ordenação de rotas NestJS: `:id/tree` ANTES de `:id` (catch-all captura primeiro se mal ordenado).
- Tenant gate anti-enumeration em stubs: `findOne(id, allowed)` ANTES de chamar o stub, para não distinguir 404 de 501.
- CTE recursiva com cursor pagination: `where.chave = { ...(where.chave as BigIntFilter), in: ids }` (spread preserva ambos).

## ADR REVIEWS (fases-via-dtask-idpai, 2026-05-21)
- CTE recursiva com guardrail de profundidade exige propagar coluna `depth` em AMBOS os branches (âncora `0 AS depth`, recursivo `d.depth + 1`).
- Plano e ADR são par normativo — decisões do plano devem aparecer também no ADR (único documento que chega ao Implementer depois).
- Referências a seções do plano-mestre exigem verificação cruzada (ex: §3.1 vs §3.2 são distintos).
- Reviews de ADR-only: foco em completude estrutural, decisão não-ambígua, anti-padrões ausentes, exemplos técnicos corretos, rastreabilidade. Bug em snippet SQL de ADR = peso HIGH (é referência normativa).
- Gate CEO elevado (>7.0) é correto para ADR fundacional que propaga para N fases sequenciais.

## F13 TASK hmac-alignment (AgentAuthGuard rewrite)
- `timingSafeEqual` com guarda de comprimento dupla: `length !== length || length === 0` ANTES de comparar.
- Regex `/^\/api\/v\d+/` para strip de prefix é frágil se `API_PREFIX` for não-padrão — registrar M1, não bloquear se hardcoded.

## FOLDERS MVP (DEntidade + DVincula, pós-F5)
- DVincula N:1 (cardinalidade única): unicidade via service (`updateMany` + `create` em `$transaction`), não via schema.
- Idempotência de backfill one-shot: N+1 interno é aceitável em scripts `prisma/scripts/` (não roda em runtime).
- Comentário de contagem no seed (`"45 fixas + N = Total"`) é débito recorrente — validar runtime bate com header.
- Rotas literais específicas (`/folders/unassigned`) DEVEM vir antes de `:folderId` no mesmo controller.
- DRY via duplicação privada pequena (~30 linhas) é aceitável quando evita `forwardRef` circular — documentar via JSDoc `@see`.
- `bodyParser:false` + `express.json({verify})` é o padrão correto para HMAC do body — nunca `JSON.stringify(req.body)`.
- Ordem de validações do guard importa por custo: headers → timestamp → nonce Redis → agentId match → load DB+decrypt (mais caro por último).

## F7 — Auditoria/Eventos
- `import type` obrigatório para `IEventProducer` em Engine (evita dependência circular runtime).
- Single point of truth para INSERT em DEvento: apenas AuditLogConsumer, exceto módulos não-migrados documentados.
- `Promise.allSettled` no Producer (aguarda resolução) vs fire-and-forget nos consumers (não bloqueiam caller).

## F8 — Flow Metrics / Forecast / Search
- N+1 em loop de sprints: usar `groupBy(['idSprint'])` + `_count`, nunca `count()`/`findMany()` por sprint em loop.
- Filtrar por `doneAt` (não `criadoEm`) quando a intenção é "concluídas no período".
- PeriodResolver obrigatório em módulos read-only com filtro de período — nunca `new Date()` direto.
- CFD via replay DEvento -498: filtro em memória por taskIdSet é aceitável (sem FK DEvento→DProject).
- Monte Carlo exige: filtro throughput<=0, guard maxPeriods, seed determinístico.
- DVincula→DEntidade em 2 queries sequenciais NÃO é N+1 (é o padrão correto quando vínculo é via DVincula).
- Search controller próprio é sempre justificado quando acessa 3+ tabelas com resultado categorizado.
- `MinLength(2)` obrigatório em campo de busca (evita full scan com ILIKE '%a%').

## F13 TASK2 SUB2.2/2.3/2.4 (RemoteExecutionClient, slug, execution-result)
- Specs de stubs são responsabilidade do Implementer na mesma sub-tarefa (interface mudou = specs devem mudar).
- Fallback de compat implícito viola "quebra controlada" quando o plano explicita ausência de backward-compat.
- HMAC preservado: verificar canonical string + headers via `git diff` linha a linha.
- Backfill `onModuleInit` sequencial (`for...of` com await) é correto — `Promise.all` seria race condition interna.
- Fallback `untitled-<timestamp-base36>` para slugify()='' é pragmático para MVP.
- `slug` em `dados` Json não exposto no response DTO = débito MINOR se usado por sistemas externos.
- Pilar 1 em UPDATE de DPedido via callback: `OperacaoExecucaoClaude.registrarOutcome()` deve ser o único caminho — `findFirst` é SELECT permitido.
- Isolation dupla camada obrigatória em callback inbound: (1) dados.audit.agentId vs path/header, (2) sanity check adicional.
- Idempotência via sentinel `dados.audit.outcome.recordedAt` checado ANTES de instanciar Engine.

## F13 TASK1 SUB2 (Agente V2 — HTTP Server + HMAC)
- Bind `127.0.0.1` deve ser string literal hardcoded no `listen()`, nunca variável.
- HMAC: comparar canonical string `[method,path,timestamp,nonce,bodyHash].join('\n')` byte-a-byte entre agente e backend.
- Nonce registrado APÓS HMAC validar — nunca antes (evita DoS no LRU).
- Build pré-existente com erros: confirmar via `git stash` + rebuild se já existiam antes da task.
- Scope creep: diretórios de sub-tarefas futuras devem ter só `.gitkeep`.

## BOOKMARKS/DVincula (Task D1, 2026-05-27)
- `@IsNumberString()` obrigatório em todo campo que vai para `BigInt()` (não apenas `@IsString()`).
- Bug de paginação: `hasMore` sobre array pós-filtro JS é errado — mover filtro para WHERE Prisma (JSON path) ou ajustar lógica sobre dados pré-filtro.
- DVincula com filtro em `metaDados` Json: `{ path: ['targetType'], equals: value }` é suportado e correto.
- `$transaction` desnecessário em operações atômicas únicas (create/update simples de 1 tabela).

## AGENTE V2 — install.sh + systemd + CLAUDE.md (F13 TASK1 SUB6)
- `agent/.claude/` fora da localização canônica é MEDIUM — memória do Implementer deve estar sempre em `.claude/agent-memory/` na raiz.
- Serviço systemd com user dedicado invocando CLI que requer auth (claude/gh/aws) deve resolver explicitamente como a API key chega ao processo.
- `ssh-keyscan 2>/dev/null` descarta fingerprint TOFU — logar em vez de silenciar.
- `shellcheck -x` (segue source) obrigatório para scripts que incluem outros arquivos.
- Idempotência de instalador via sentinel `config.json` (não flag/diretório).
- `ProtectHome=read-only` + `chmod 0644` permite leitura cross-user do CLAUDE.md — válido para trade-off CEO-usa-root.

## PADRÕES VIOLADOS RECORRENTES

| Padrão | Frequência | Como abordar |
|--------|------------|--------------|
| Acoplamento horizontal via DTO compartilhado | F2 | Mover DTOs compartilhados para `src/common/dto/` |
| Acesso a campo privado via bracket notation em Controller | F3 | Expor método público no Service |
| N+1 em write path (loop com await em UPDATE/DELETE bulk) | F3 | Usar updateMany/deleteMany com where |
| parseInt(param) para query params numéricos | F5 | Number(param) ou @Type(() => Number) |
| for...of com await individual em seed bootstrap | F5 | Preferir createMany para batch INSERTs |
| Service sem AuditService quando deveria auditar | F5 | Todo service que cria/deleta deve injetar AuditService |
| ScheduleModule.forRoot() duplicado | F6 | Feature modules usam forFeature(), nunca forRoot() |
| Testes de integração ausentes quando plano exige | F6 | Unit tests não substituem integração com banco real quando plano é explícito |
| (op as any).campo acesso a campo protegido do Engine | F6 | Engine deve expor getter público |
| @IsString() onde deveria @IsNumberString() | D1 | Padrão do projeto para todo campo de ID numérico como string |
| hasMore sobre array pós-filtro em memória | D1 | Mover filtro para WHERE Prisma ou recalcular sobre dados pré-filtro |
| Gate que testa classe MATERIALIZADA (pós-remap) em vez de ORIGINAL | Task7 (promote-to-template) | Ver [[bug-pattern-gate-testa-classe-materializada-pos-remap]] |
