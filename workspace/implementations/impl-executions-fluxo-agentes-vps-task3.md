# Implementation: Task 3 — Esteira multi-agent garantida e verificável na VPS (ADR-V2-083)

**Implementer:** Implementer Agent V2
**Data:** 2026-11-23
**Módulo:** executions (+ engine, automation, agent/, comando nos repos)
**Fase V2:** F13 sobre o Engine de F6
**Plano:** `workspace/plans/plan-executions-fluxo-agentes-vps-task3.md` (abordagem B+)
**Decisões CEO aplicadas:** P1 (parar e avisar, todos os tipos), P2 (4h / teto 6h, custo desligado), P3 (PR rascunho + FAILED), P4 (busy por tempo até ~6h05)

---

## 🧭 Visão geral

```
 backend ──► envelope (task + exigências)  +  dados.git {branch: scrumban/exec-<id>, baseBranch}  +  dados.pipeline
    │                                                      (timeout 4h, teto 6h)
    ▼ RUN_CLAUDE_CODE {git, pipeline}  (aditivo)
 agente 0.2.0 ─► preflight síncrono: comando no repo? ── não ──► 422 PIPELINE_NOT_INSTALLED ─► FAILED (<5s)
    │ sim (ACK 200)
    ▼
 gh+token+origin ─► base (config | origin/HEAD) ─► stash de sobras ─► checkout -B scrumban/exec-<id>
    ▼
 claude -p "/scrumban-executar CONTROLE-SCRUMBAN v1 {json}\n\n<envelope>"
        --append-system-prompt <contrato fixo>  --json-schema <schema v1>  (sem --system-prompt, nunca --bare)
    ▼ (processo em GRUPO próprio: timeout/término matam netos — L6)
 verificação independente: HEAD · commits à frente · push (ls-remote) · PR (gh pr list) · subagent_stats
    ▼ rede de segurança: commits sem PR ⇒ PR RASCUNHO · não aprovado ⇒ gh pr ready --undo
 callback {…, pipeline:{mode, declared, verified}} (retry ~8 min)
    ▼
 Engine.avaliarDesfechoEsteira ─► SUCCESS | FAILED + motivo canônico   (mesmo UPDATE CAS da ADR-V2-082)
    ▼
 GET /executions/:id → git · pullRequest · pipeline · outcome.reason
```

---

## O Que Foi Feito

### Backend — arquivos criados

| Arquivo | O quê |
|---|---|
| `src/automation/agents/dto/execution-pipeline-result.dto.ts` | DTOs aninhados do bloco `pipeline` (limites, `prUrl` só github.com, refs seguras, validador `IsSubagentCountMap`) |
| `src/engine/lib/operacao/__tests__/OperacaoExecucaoClaude.esteira.spec.ts` | 1 teste por linha da política + gravação CAS + supersede + pr-auto-open inerte |
| `src/automation/agents/dto/__tests__/execution-result.pipeline.dto.spec.ts` | validação do callback (whitelist, limites, códigos novos) |
| `src/executions/dto/__tests__/execution-response.pipeline.spec.ts` | projeção segura `git`/`pullRequest`/`pipeline` (contrato frontend) |
| `prisma/scripts/detect-project-slug-divergence.ts` | dry-run (só leitura): divergências e **colisões por agente** (exit 2) |
| `docs/decisions/ADR-V2-083-esteira-headless-contrato-verificavel.md` | ADR |
| `.claude/commands/scrumban-executar.md` | comando headless (cópia do template) |

### Backend — arquivos modificados

| Arquivo | Mudança |
|---|---|
| `src/executions/constants/execution-lifecycle.const.ts` | 5 motivos novos; `EXECUTION_PIPELINE_REASON_CODES`; 4h/6h; `EXECUTION_BUSY_MAX_WAIT_SEC=21900`; `resolvePipelineTimeoutSec`, `isBusyWaitExhausted`, `executionBranchName`; envs novas |
| `src/engine/lib/interfaces/IExecucaoData.ts` | tipos `pipeline`, `git.baseBranch/commitsAhead/pushed`, `pullRequest.state/isDraft/openedBy/…`, `dispatch.firstBusyAt` |
| `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` | `static avaliarDesfechoEsteira` (pura); `registrarOutcome({…, pipeline})` grava git/PR/pipeline/`outcome.reason` no MESMO UPDATE CAS; resultado devolve `success`/`reason` finais; `devolverParaFila` grava `firstBusyAt` |
| `src/automation/agents/dto/execution-result.dto.ts` | `pipeline?` (ValidateNested) + 3 `errorCode` novos |
| `src/automation/agents/agents.service.ts` | usa `success` do Engine (task/eventos); eventos aditivos (`prUrl`, `branch`, `decision`, `reviewScore`, `pipelineReason`); `execution.succeeded`/`execution.failed` do caminho real, após persistir (sem re-emitir failed em supersede) |
| `src/executions/executions.service.ts` | modo PROMPT = esteira: `dados.git`, `dados.pipeline`, timeout 4h; base do `DProject.dados.automation.remoteBranch` validada; lifecycle config (envs) passa a valer na criação |
| `src/executions/processors/execution-run.processor.ts` | slug do `DVincula` (fallback `dados.slug`, log de divergência); envia `git`/`pipeline`; busy por tempo; 422 do preflight ⇒ motivo canônico |
| `src/automation/runtime/remote-execution-client.ts` | `git?`/`pipeline?` no payload (só quando presentes) |
| `src/executions/queues/execution-queue.service.ts` | `busySince` no job |
| `src/executions/dto/execution-response.dto.ts` | `pipeline` (ExecutionPipelineDto); `toGit`/`toPullRequest`/`toPipeline` (whitelist); `outcome.reason` também p/ agent (só 5 códigos da esteira) |
| `src/executions/services/prompt-builder.service.ts` + 5 templates | envelope (`{{taskType}}` novo); sem regras de git; frases conferidas contra o Risk Gate (LOW) |
| `src/automation/project-agent/project-agent-link.service.ts` | vínculo novo usa `DProject.dados.slug`; existente mantém o slug provisionado |
| `docs/automation-security-runbook.md` | seção Fase 13 (ordem, envs, **roteiro da Fase 0**, smoke, rollback) |
| `docs/decisions/ADR-V2-082-…md` | emenda P4 (busy por tempo) |
| specs: processor, executions.service.unit, lifecycle.const, outcome, execution-result.service, project-agent-link | re-baseline consciente + casos novos |

### Agente (`agent/`, 0.1.1 → 0.2.0)

| Arquivo | O quê |
|---|---|
| `src/claude-code/pipeline-contract.ts` (novo) | schema v1 (fonte única), contrato `--append-system-prompt` fixo, `parsePipelineOutput` (sanitiza p/ limites do DTO) |
| `src/claude-code/pipeline-preflight.ts` (novo) | `isPipelineInstalled` (síncrono) + `checkPreconditions` (gh, token, origin) |
| `src/git/pipeline-git.ts` (novo) | base (`origin/HEAD` + `set-head --auto`), `prepareBranch` (stash nomeado, resume), `verifyBranch`, `findPr`, `openDraftPr`, `markPrAsDraft`; refs validadas (anti injeção de argumento) |
| `src/claude-code/pipeline-flow.ts` (novo) | orquestração pós-ACK do modo esteira |
| `src/claude-code/command-builder.ts` | sai `--system-prompt`; entram `--append-system-prompt`, `--json-schema`, `--exclude-dynamic-system-prompt-sections`, `--max-budget-usd`; `pipelineSessionFlags` |
| `src/claude-code/runner.ts` | `spawn(detached)` + kill de GRUPO, resolve no `exit` + dreno 5s, SIGKILL do grupo após saída normal, stdin fechado, teto 10MB (L6) |
| `src/handlers/run-claude-code.handler.ts` | valida `git`/`pipeline`; 422 `PIPELINE_NOT_INSTALLED`; 400 `INVALID_GIT_BRANCH`/`MISSING_GIT_BRANCH`; modo simples sem `--system-prompt` e base = default do repo |
| `src/handlers/warm-cache.handler.ts` | paridade re-baselinada (mesmas flags de sessão); não lê CLAUDE.md global; `error_max_turns` com cache = sucesso |
| `src/outbound/backend-client.ts` | `pipeline?` no payload; retry do callback 12× base 2s teto 60s (~8 min) |
| `src/config/schema.ts` | `pipelineTimeoutMaxSec` (21600), `maxBudgetUsd?` (desligado), `prFallback` (true) |
| `CLAUDE-md-template.md`, `README.md`, `package.json`, `src/index.ts` | sem regras git globais; seção da esteira; versão 0.2.0 |
| `templates/scrumban-executar.md`, `templates/pipeline-result.schema.json` (novos) | **conteúdo pronto para o Devari-Core** (não aplicado) |
| specs novos: `pipeline-contract`, `pipeline-git`, `pipeline-preflight`, `run-claude-code.pipeline`; reescritos: `runner`, `command-builder` (+snapshot), ajustes em `warm-cache`, `run-claude-code`, fixtures | |

### Frontend

- `/Users/devaritecnologia/Documents/Benedito/scrumban/frontend/.claude/commands/scrumban-executar.md` — **único arquivo** tocado (cópia idêntica do template; teste anti-drift no agente compara).

---

## 3 Pilares

- **Pilar 1:** zero INSERT novo. Desfecho só via `OperacaoExecucaoClaude.registrarOutcome` (CAS + baixa da ADR-V2-082, assinatura de `_atualizarPedidoCompleto` e CAS intactos — só campos a mais no JSON). Política = método puro do Engine (DVFS avaliado e rejeitado: regra curta, testável, sem seed/md5 no deploy). DVFS 7 segue inerte no callback (teste de regressão). Zonas da Task 1 (calcula/guardas/risk) não tocadas.
- **Pilar 2:** zero endpoint novo. `GET /executions/:id` e `POST /agents/:id/execution-result` (campo opcional).
- **Pilar 3:** zero DClasse, zero tabela, zero migration. Motivos só em `execution-lifecycle.const.ts`.

---

## Testes Realizados (resultados reais)

### Backend
```
npm run build                         → OK (dist + 4 DVFS copiados)
npx tsc --noEmit                      → 67 erros = baseline (mesmos 8 arquivos de spec, mesmas contagens); 0 em arquivos tocados
npx eslint <21 arquivos tocados em src/> --max-warnings 0
                                      → 0 erros; 1 warning PRÉ-EXISTENTE (agents.service.ts:583 `as any`, linha não tocada)
npx eslint prisma/scripts/detect-project-slug-divergence.ts → OK; tsc isolado do script → OK
npx jest src/executions src/automation src/engine --runInBand   (inclui prompt-builder e dvfs)
  Test Suites: 1 failed, 41 passed, 42 total
  Tests:       1 failed, 673 passed, 674 total
  ↳ única falha = provision.service.spec (PRÉ-EXISTENTE, idêntica ao baseline: 597/598 antes)
```
Baseline antes da task: 598 testes (1 falha pré-existente) → agora 674 (+76).

### Agente (`cd agent`)
```
npm test        → Test Suites: 24 passed, 24 total · Tests: 286 passed, 286 total · Snapshots: 2 passed
npm run build   → OK
npm run lint    → OK (0 problemas)
npm run typecheck → OK
```
Baseline: 222 testes → 286 (+64).

### Mutação (correção desligada ⇒ testes falham)
| Mutação | Resultado |
|---|---|
| runner: sem SIGKILL do grupo após `exit` | 4 testes falham (inclui o REAL: neto `sleep 30` herdando stdout) |
| Engine: sem a checagem R1 (reviewer/implementer no runtime) | 2 testes falham |
| agente: sem converter PR não aprovado em rascunho | 2 testes falham |

### `claude -p` local (scratchpad, haiku, total ≈ US$ 0,03)
- `structured_output` + `subagent_stats.by_type` confirmados (formato completo no ADR).
- Slash command com argumento **multilinha** (bloco JSON) funciona.
- `--json-schema` + `--max-turns=1` ⇒ `error_max_turns`, exit 1, `cache_creation_input_tokens=17446` (justifica a regra do warmer).

### Performance
- Processor: +1 query (`dVincula.findFirst` com `select metaDados`) por dispatch; ExecutionsService: 0 query nova (reusa `project` já carregado). Sem N+1. Não medido com `DATABASE_LOGGING` (sem banco/.env local — proibido conectar).

---

## Decisões Tomadas / Desvios do plano

1. **P1 aplicado a todos os tipos:** `pipeline.required=true` para toda execução em modo PROMPT; o plano previa só code/docs. `prRequired` continua só code/docs (research/validation/other podem terminar `NO_CHANGES` com sucesso).
2. **COMMAND/HÍBRIDO = modo simples** (não há envelope sem task). Modo simples mantém as regras git coladas no prompt (compat), mas sem `--system-prompt` e com base = default do repo.
3. **Compat agente 0.1.x:** callback sem bloco `pipeline` numa execução de esteira ⇒ regra legada (exit 0), como o plano prometeu. Consequência: com agente antigo, P1/P3 não são impostos até o 0.2.0 subir (documentado no runbook).
4. **`subagent_stats` ausente + APPROVED + prRequired ⇒ `PIPELINE_CONTRACT_MISSING`** (estrito). Se a VPS tiver CLI sem o campo, toda execução code/docs falha — conferir na Fase 0.
5. **PR da rede de segurança (`agent-fallback`) nunca conta como sucesso** (P3), mesmo com APPROVED.
6. **Envelope montado em 2 partes:** backend gera o texto da task (risk gate continua varrendo `dados.prompt`); o agente prefixa `/scrumban-executar CONTROLE-SCRUMBAN v1` + JSON (branch/base resolvida). Base só é conhecida no agente quando `null`.
7. **Resume:** não existe produtor de `dados.resumeSessionId` hoje; o agente suporta `resume` (reusa a branch se existir), mas "branch da execução de origem" não foi ligado no backend (sem origem rastreável) — follow-up.
8. **Busy:** `EXECUTION_BUSY_MAX_RETRIES` mantido como `@deprecated` (env legado lido sem erro), não decide mais.
9. **Placeholder `command.timeoutMs` do modo PROMPT** segue 1.800.000 ms (o `CommandValidatorService` limita a 1h); a fonte única é `dados.timeoutSec` (14400).
10. **`ExecutionResponseDto.git`/`pullRequest`** agora são projeções whitelist (antes eram o JSON cru) — campos legados preservados.
11. **Warmer:** paridade agora é com o modo esteira (flags de sessão iguais); modo simples não tem warm correspondente (debug).
12. **`execution.failed` do callback** gera notificação (consumidor existente) — intencional pelo plano; não re-emitido em supersede.

---

## CONTRATO PARA O FRONTEND

`GET /executions/:id` (e listagens que usam `serializeExecution`) — todos os campos **opcionais/aditivos**:

```jsonc
{
  "git": {                        // whitelist de dados.git
    "branch": "scrumban/exec-4815",
    "baseBranch": "develop",       // null = default do repo
    "headAfter": "a1b2c3d…",       // HEAD verificado pelo agente
    "commitsAhead": 3,
    "pushed": true,
    "pushedAt": "2026-11-23T…Z"
  },
  "pullRequest": {                // PR VERIFICADO (gh pr list), não a palavra do modelo
    "url": "https://github.com/acme/api/pull/42",
    "number": 42,
    "state": "OPEN",               // OPEN | CLOSED | MERGED
    "isDraft": false,              // true quando a esteira não aprovou (P3)
    "openedBy": "pipeline",        // "pipeline" | "agent-fallback" (rede de segurança, sempre rascunho)
    "baseRefName": "develop",
    "openedAt": "2026-11-23T…Z"
  },
  "pipeline": {                   // ausente em execuções COMMAND/legadas
    "required": true,
    "prRequired": true,            // code/docs
    "taskType": "code",
    "mode": "pipeline",            // null até o callback
    "decision": "APPROVED",        // APPROVED | NEEDS_CHANGES | REJECTED | NO_CHANGES | ABORTED | null
    "reviewScore": 9.0,            // null sem revisão
    "stages": [{ "name": "reviewer", "status": "done" }],   // done | skipped | failed
    "summary": "3–5 linhas (≤2000)",
    "subagents": { "strategist": 1, "implementer": 2, "reviewer": 2, "documenter": 1 },  // runtime
    "contractValid": true,
    "prOpenedBy": "pipeline",
    "reason": null                 // um dos 5 abaixo quando a política rebaixou
  },
  "outcome": { "reason": "PIPELINE_NOT_APPROVED", "source": "agent" }
}
```

**Motivos novos em `outcome.reason`** (lista fechada, agora 13; os 8 antigos intactos; front já tem fallback):

| Código | `source` | Texto sugerido |
|---|---|---|
| `PIPELINE_NOT_INSTALLED` | system (422 do preflight) ou agent | "O repositório não tem a esteira instalada (/scrumban-executar)." |
| `PIPELINE_PRECONDITION_FAILED` | system ou agent | "A VPS não está pronta (GitHub CLI/token, branch base ou git)." |
| `PIPELINE_CONTRACT_MISSING` | agent | "A esteira terminou sem o resultado esperado (ou sem passar pelo Reviewer)." |
| `PIPELINE_NOT_APPROVED` | agent | "A esteira não aprovou — PR ficou em rascunho." |
| `PR_NOT_CREATED` | agent | "Nenhum PR foi aberto pela esteira." |

**Durações:** execuções de task podem ficar RUNNING **até 6h** (default 4h) e QUEUED **até ~6h05** esperando o projeto liberar. Polling de 3s deve tolerar (sugestão: recuar para 15s após 10 min) e a UI mostrar "em execução há Xh". `outcome.source` continua `agent|system|null`.

---

## Pendências (para o CEO)

1. **Fase 0 na VPS (não executável daqui):** roteiro exato em `docs/automation-security-runbook.md` → "Fase 0 — spike na VPS" (8 verificações como `scrumban-agent`; anotar no ADR-V2-083 "Fatos verificados"). Crítico: `subagent_stats` presente no CLI da VPS (decisão 4), hooks sob bypass, `gh auth` com `GITHUB_TOKEN`.
2. **Devari-Core (não alterado):** copiar `agent/templates/scrumban-executar.md` → `Devari-Core/.claude/commands/scrumban-executar.md` e `agent/templates/pipeline-result.schema.json` → `Devari-Core/templates/` (ou local equivalente).
3. **Comando nos repos de clientes:** backend e frontend do Scrumban já têm a cópia (precisa commit + merge na base de cada repo); demais repos de clientes precisam do PR (runbook 8b) — senão `PIPELINE_NOT_INSTALLED`.
4. **`GITHUB_TOKEN` + `gh`** no ambiente do agente em cada VPS (runbook 8c).
5. **Rodar `detect-project-slug-divergence.ts` (dry-run)** antes do deploy; colisões ⇒ re-provisionar os pares.
6. **Ordem de deploy:** backend → frontend → agente 0.2.0 (+ CLAUDE.md global sem regras git) → comando nos repos (runbook "Esteira headless … Fase 13").
7. **Smoke Task 3** (runbook) e medir `cache_read` (re-baseline do warmer).
8. **Ligar `maxBudgetUsd`** após medir 5–10 execuções reais (P2).
9. **Follow-ups:** resume com branch da execução de origem; `GithubPrService`/`pr-auto-open.js` mortos (limpeza); `markRunning` fora do Engine (herdado); progresso por fase (stream-json, COULD).
10. **Frontend (esteira própria):** link do PR, rascunho, decisão/nota, 5 motivos, durações até 6h.

---

## Ciclo 2 — correções M1–M5 (review 8.6/10, `workspace/reviews/review-executions-fluxo-agentes-vps-task3.md`)

| # | Correção | Arquivos | Teste novo | Mutação (correção desligada) |
|---|---|---|---|---|
| M1 | Regra única `isApprovalVerified(contract, prRequired)` no agente, ESPELHO do Engine: prRequired ⇒ `reviewer>0` **e** `implementer>0`; usada no passo "nada mergeável por engano" | `agent/src/claude-code/pipeline-contract.ts`, `pipeline-flow.ts` | tabela de paridade agente×Engine (9 casos) + fluxo "APPROVED + reviewer sem implementer + PR do modelo ⇒ `gh pr ready --undo`" | aceitar só reviewer ⇒ **2 falham** |
| M2 | `avaliarDesfechoEsteira`: APPROVED sem prRequired exige ≥1 subagente com contagem >0, senão `PIPELINE_CONTRACT_MISSING` (agente idem) | `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` | 3 casos (`{}`, `null`, `{strategist:0}`) + paridade | Engine ⇒ **3 falham**; agente ⇒ **2 falham** |
| M3 | Redator `buildRedactor(env, [agentApiKey, agentCommandSecret])`: GITHUB_TOKEN, GH_TOKEN, ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN + qualquer env `*TOKEN/*SECRET/*_KEY/*PASSWORD` (≥8 chars) ⇒ `[REDACTED]`. Aplicado ANTES de truncar stdout/stderr (2 modos), nas mensagens de erro do git/preflight (logs e callback) e numa passada profunda (`redactDeep`) em todo o payload (summary do modelo, contractError, verifyError) | `agent/src/security/redact.ts` (novo), `run-claude-code.handler.ts`, `pipeline-flow.ts` | `redact.spec.ts` (6) + fluxo esteira (stdout/summary e token na URL do remoto no erro do `fetch`) + modo simples | redator identidade ⇒ **7 falham** |
| M4 | `clearTimeout(timeoutTimer)` + `clearTimeout(killTimer)` no `exit` do runner | `agent/src/claude-code/runner.ts` | exit em 1,5s, timeout em 2s caindo no dreno ⇒ `timedOut=false`, sem SIGTERM | **1 falha** |
| M5 | Envelope dentro de `<<<DADO-NAO-CONFIAVEL id=<nonce aleatório 16 hex>` … `DADO-NAO-CONFIAVEL id=<nonce>>>>`; texto da task neutralizado (`CONTROLE-SCRUMBAN`, `/scrumban-executar` no início de linha, marcador `DADO-NAO-CONFIAVEL`); comando instrui a tratar o envelope como dado e ignorar controles/instruções conflitantes dentro dele | `agent/src/claude-code/pipeline-flow.ts` (`neutralizeEnvelope`, `buildPipelinePrompt`), `agent/templates/scrumban-executar.md` + cópias `backend/.claude/commands/` e `frontend/.claude/commands/` (anti-drift garante igualdade) | task imitando `CONTROLE-SCRUMBAN v1` + JSON de controle + falso fechamento ⇒ 1 só controle real, 2 marcadores (abre/fecha com o mesmo nonce) | sem neutralização ⇒ **1 falha** |

**Nota M3:** `errMsg` do `pipeline-git.ts` continua devolvendo o stderr do git; a redação é aplicada em TODOS os consumidores (log + callback) e na passada final do payload — ponto único, testado com o token na URL do remoto.

### Resultados reais (Ciclo 2)
```
backend  npm run build                         → OK
backend  npx tsc --noEmit                      → 67 = baseline (mesmos arquivos/contagens)
backend  eslint (arquivos tocados no ciclo 2)  → OK (0 problemas)
backend  jest src/executions src/automation src/engine --runInBand
           Test Suites: 1 failed, 41 passed, 42 total
           Tests:       1 failed, 676 passed, 677 total   (falha = provision.service.spec, pré-existente)
agent    npm test       → Test Suites: 25 passed · Tests: 307 passed, 307 total
agent    npm run build / lint / typecheck → OK / OK / OK
```
Sem banco, sem commit, sem `claude -p` neste ciclo.

---

## Ciclo 3 — vazamentos residuais N1–N4 (re-review 8.9/10)

| # | Correção | Arquivo | Teste novo | Mutação |
|---|---|---|---|---|
| **N1** | Redação na FONTE: o stdout bruto do `claude` é redigido ANTES do parse (o `structured_output`/`summary` já nasce limpo; tokens são `[A-Za-z0-9_-]`, o JSON segue válido). Além disso, título e corpo do PR rascunho aberto pelo agente passam por `redact` antes do `gh pr create` (defesa dupla). O agente não cria commits nem comentários | `agent/src/claude-code/pipeline-flow.ts` | summary com `GITHUB_TOKEN=<valor>` + fallback de PR ⇒ argv do `gh pr create` sem o valor e com `[REDACTED]` | desligar as 2 camadas ⇒ **1 falha** |
| **N2** | `errMsg` (pipeline-git) não corta mais; `note()` redige o texto INTEIRO e só depois corta em 300; erro do preparo do git: `truncate(redact(texto))` | `agent/src/git/pipeline-git.ts`, `pipeline-flow.ts` | 2 testes com o token começando no índice 294 (corte em 300 deixaria `ghp_PR`): erro do `gh pr list` e stderr do `fetch` | `note` cortando antes ⇒ **1 falha**; `errMsg` com `slice(0,300)` ⇒ **1 falha** |
| **N3** | `neutralizeEnvelope`: `normalize('NFKC')` + remove `\p{Cf}` (zero-width, BOM, bidi) + `\p{Zs}` → espaço (NBSP etc.) ANTES dos regex | `pipeline-flow.ts` | `CONTROLE<ZWSP>-SCRUMBAN`, `C` fullwidth, `CONTROLE<NBSP>SCRUMBAN`, `<BOM>/scrumban-executar`, `DADO-NAO<ZWSP>-CONFIAVEL` ⇒ 1 controle real, 2 marcadores, sem invisíveis | sem normalização ⇒ **1 falha** |
| **N4** | Warm-cache com redator (`env` + `agentApiKey`/`agentCommandSecret`): `stderr` do log, `errorMessage` e `stdoutPreview` redigidos antes do corte | `agent/src/handlers/warm-cache.handler.ts` | stderr com `ANTHROPIC_API_KEY` ⇒ `errorMessage = 'auth falhou key=[REDACTED]'` | sem redator ⇒ **1 falha** |

Pontos de corte revisados (todos agora redigem antes): `note()`, erro do preparo do git, stdout/stderr (2 modos), `stdoutPreview`/`errorMessage` do warm, `contractError` (o JSON de origem já vem redigido), título/corpo do PR (`openDraftPr` corta 200/4000 depois do `redact`).

### Resultados reais (Ciclo 3)
```
agent  npm test       → Test Suites: 25 passed, 25 total · Tests: 312 passed, 312 total
agent  npm run build  → OK · npm run lint → OK · npm run typecheck → OK
backend → não tocado neste ciclo (resultados do Ciclo 2 seguem válidos: build OK, tsc 67 = baseline, jest 676/677 c/ falha pré-existente)
```
Sem banco, sem commit, sem `claude -p`.

**Pronto para Review!**
