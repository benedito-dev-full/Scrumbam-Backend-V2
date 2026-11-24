# PLANO DETALHADO — Task 3: Esteira multi-agent garantida e verificável na VPS (V2 Fase F13)

**Criado por:** Strategist Agent V2
**Data:** 2026-11-23
**Módulo:** executions (toca também `engine`, `automation`, `agent/`, template Devari-Core)
**Fase V2:** F13 (automação Claude Code / agente VPS) sobre o Engine de F6
**ADRs vinculados:** ADR-V2-005, ADR-V2-006, ADR-V2-007, ADR-V2-030, ADR-V2-032, ADR-V2-033, ADR-V2-035, ADR-V2-036, ADR-V2-046 (paridade do warmer), ADR-V2-049 (prompt builder), ADR-V2-081, ADR-V2-082 — **propõe ADR-V2-083** (080 segue reservado; 081/082 usados; 083 livre — conferido em `docs/decisions/`, `workspace/` e `.claude/`)
**Estimativa Total:** ~48h backend+agente+comando (40h + 20% buffer) — frontend à parte (~3h, contrato em §4)
**Complexidade:** Alta (2 processos + repo do cliente + GitHub; contrato entre 3 partes)

---

## 🧭 Visão geral (1 minuto)

```
 HOJE                                           DEPOIS (Task 3)
 ────                                           ───────────────
 backend ─► prompt "siga o CLAUDE.md"           backend ─► ENVELOPE (task + branch + base + exigências)
 agente  ─► --system-prompt <mapa de slugs>     agente  ─► preflight (esteira? gh? base?) ─► git prep
            (SUBSTITUI o prompt do Claude Code)            claude -p "/scrumban-executar <envelope>"
            + "faça branch/commit/PR" colado                --append-system-prompt <contrato curto>
 claude  ─► faz o que achar (fast mode)                    --json-schema <contrato de saída>
 sucesso ─► exit 0 (PR? ninguém sabe)           claude  ─► esteira do REPO (Strategist→Impl→Reviewer→Doc)
 PR URL  ─► perdida no stdout truncado                     termina com JSON {prUrl, branch, score, decisão}
 timeout ─► 30 min (máx 60) mata a esteira      agente  ─► VERIFICA de forma independente (git + gh + subagent_stats)
                                                           ─► callback com `pipeline` estruturado
                                                backend ─► Engine grava dados.git / pullRequest / pipeline
                                                           sucesso = exit 0 + contrato + PR verificado (code/docs)
```

---

## 1. Análise

### Contexto

Objetivo de produto: "Executar" numa task ⇒ na VPS o `claude -p` roda **dentro do repo do cliente**, a esteira multi-agent **do próprio repo** (`.claude/agents` + hooks) executa, e o resultado é **um PR feito pela esteira**, com o backend sabendo URL, branch, commit, nota do Reviewer e decisão. Hoje nada disso é garantido nem verificável.

### Estado Atual — achados do CEO conferidos no código

| # | Achado | Confirmado? | Evidência |
|---|--------|-------------|-----------|
| 1a | `--system-prompt` com o CLAUDE.md global inteiro (mapa de slugs) | ✅ | `agent/src/claude-code/command-builder.ts:80-82`; leitura em `run-claude-code.handler.ts:377-386` |
| 1b | `--system-prompt` **substitui** o prompt padrão; o certo para acrescentar é `--append-system-prompt` | ✅ | `claude --help` (v2.1.330): "`--append-system-prompt` Add text to the end of the default system prompt" |
| 1c | Comentário "em `-p` o Claude não lê o CLAUDE.md" | ❌ **FALSO** | Teste empírico (abaixo): em `-p`, mesmo com `--system-prompt`, o CLAUDE.md do projeto, os `.claude/rules` herdados, o `~/.claude/CLAUDE.md` e os `.claude/agents` foram carregados |
| 2a | Templates só dizem "siga o CLAUDE.md" | ✅ | `src/executions/services/prompt-templates/{code,docs,research,validation,other}.md` |
| 2b | Regras git fixas coladas no prompt; `--base main` e `git checkout main` hardcoded | ✅ | `run-claude-code.handler.ts:388-399` e `:507-521` |
| 3a | `ExecutionResultDto` sem prUrl/branch/commit | ✅ | `src/automation/agents/dto/execution-result.dto.ts:88-228` |
| 3b | Sucesso = exit 0 + session_id, sem PR | ✅ | `run-claude-code.handler.ts:455-456` |
| 3c | `GithubPrService` morto (espera `scrumban/exec-*`), DVFS `pr-auto-open.js` morto | ✅ | `github-pr.service.ts:73,85` (registrado no módulo, nenhum chamador); `pr-auto-open.js:11` sai cedo porque `dados.git.headAfter` nunca é gravado no callback; e roda **depois** do UPDATE em `registrarOutcome` (`OperacaoExecucaoClaude.ts` passo 6) → mesmo se populasse `pullRequest`, não persistiria |
| 3d | `execution.succeeded` com prUrl só no caminho Engine `_executarClaude` | ✅ | `OperacaoExecucaoClaude.ts:497-503` (caminho F6 stub, não usado pelo callback) |
| 4a | Timeout default 1800 / máx 3600 | ✅ | `execution-lifecycle.const.ts:17,23`; `resolveExecutionTimeoutSec` faz clamp em 3600 |
| 4b | Esteira leva 3–4h | ✅ | `.claude/agents/README.md:89` ("3–4h por task") |
| 4c | SIGKILL só no PID principal (L6) | ✅ | `runner.ts:186-202` (`child.kill`) |
| 5 | Slug divergente execução × provisionamento | ✅ (pior que o descrito) | `projects/utils/slugify.ts` (trunca 50 + sufixo de colisão via `deriveUniqueSlug`) × `project-agent-link.service.ts:63-75` (trunca 64, **sem** sufixo) |
| 6 | Repos sem esteira | ✅ | `frontend/.claude/agents` existe (4 papéis) mas **nenhum repo tem um comando de entrada headless**; Devari-Core só tem `/trabalhar` |
| — | `DProject.dados.automation.remoteBranch` já existe como config de base | ✅ | lido por `pr-auto-open.js` e `execution-worktree.service.ts:59` (ambos mortos) — reaproveitar |
| — | `ExecutionResponseDto` **já expõe** `git` e `pullRequest` | ✅ | `execution-response.dto.ts:269,336-337` — só nunca foram preenchidos |
| — | `GITHUB_TOKEN` já chega ao `claude` via env do agente | ✅ | `agent-env.service.ts:315` → `env-file-writer.ts:53` → `EnvironmentFile` do systemd |

### Verificação empírica do CLI (`claude` 2.1.330, rodado por este Strategist, modelo haiku, ~US$ 0,03)

| Pergunta | Resultado | Como |
|---|---|---|
| `-p` carrega CLAUDE.md do projeto (cwd)? | ✅ SIM, **inclusive com `--system-prompt`** | Rodado no próprio `scrumban/backend`: listou `backend/CLAUDE.md`, rules do ancestral e `~/.claude/CLAUDE.md` |
| `-p` carrega `.claude/agents` do repo? | ✅ SIM | `strategist/implementer/reviewer/documenter` listados; em dir de teste, `revisor-teste` listado e **spawnado** |
| Hooks de `.claude/settings.json` rodam em `-p` + `--dangerously-skip-permissions`? | ✅ SIM | `SessionStart` e `Stop` criaram arquivos-marcador (dir não confiado) |
| Slash command do repo funciona em `-p`? | ✅ SIM | `claude -p "/eco-teste banana"` → `COMANDO-OK banana` |
| `--json-schema` dá saída estruturada? | ✅ SIM | JSON final ganha `structured_output` validado |
| Há evidência independente de que subagents rodaram? | ✅ SIM | JSON final traz `subagent_stats.by_type` (ex.: `{"revisor-teste":1}`), `spawned`, `completed`, `failed` |
| Workspace não confiado afeta algo? | ⚠️ | "Ignoring permissions.allow from settings.local.json: workspace not trusted" — irrelevante com bypass; **`env` do settings.local.json pode ser ignorado** (verificar na Fase 0) |
| stdin aberto | ⚠️ | "no stdin data received in 3s" — `execFile` deixa stdin aberto ⇒ 3s perdidos; fechar stdin |
| Subagent em `-p` | ⚠️ | `started_in_background: 1` — o comando deve pedir execução em foreground |
| `--bare` | ❌ não usar | Pula hooks **e** CLAUDE.md (e exige API key) — mataria a esteira |

**Não verificado (Fase 0 na VPS):** hook `PreToolUse` com exit 2 bloqueando sob bypass; `permissionMode` dos subagents sob pai em bypass; comportamento como usuário `scrumban-agent` (systemd) vs `root` (`claudeMdPath` default é `/root/.claude/CLAUDE.md`, `scrumban-agent.service:9` roda como `scrumban-agent`).

### Achados novos (mudam o desenho)

1. **🔴 Slug colidindo = execução no repo errado.** Dois projetos com o mesmo nome: `DProject.dados.slug` vira `foo` e `foo-2`, mas o `DVincula.metaDados.projectSlug` dos dois vira `foo`. O provisionamento do 2º faz upsert de `## foo` no CLAUDE.md da VPS ⇒ o projeto A passa a executar no clone de B (ou o clone falha). É isolamento entre clientes, não só confiabilidade ⇒ **entra nesta task**.
2. **🔴 Esteira de 4h × 409 PROJECT_BUSY de ~41 min (decisão P2 da Task 2).** Uma 2ª execução no mesmo projeto durante a esteira esgota as 10 tentativas e vira `PROJECT_BUSY_EXHAUSTED`. Precisa de janela por tempo (P-CEO 4).
3. **🔴 Netos seguram o stdout.** A esteira roda `npm run build`, jest, hooks, `gh`. `execFile` só chama o callback no `close` dos pipes; um neto vivo (dev server, watcher) segura o pipe ⇒ callback nunca chega ⇒ mutex preso. L6 vira **obrigatório**.
4. **🟠 `forbidNonWhitelisted: true`** (`src/main.ts:56-59`): agente novo mandando campo `pipeline` para backend antigo ⇒ 400 ⇒ resultado de 4h perdido (4xx não tem retry). **Backend sobe antes do agente** (Fase 13).
5. **🟠 Janela de retry do callback (~65s)** é pequena demais para perder o resultado de 4h por uma queda curta do túnel.
6. **🟡 O template do CLAUDE.md global da VPS (`agent/CLAUDE-md-template.md`) tem regras git** (`scrumban/auto-*`) que vão conflitar com a branch definida pelo agente. Remover.
7. **🟡 O warmer (ADR-V2-046)** depende do prefixo `--system-prompt`. Com o prompt padrão + CLAUDE.md por repo, o prefixo passa a variar por projeto; `--exclude-dynamic-system-prompt-sections` ajuda o reuso. Paridade precisa ser re-baselineada.

### Decisões Passadas Relevantes (ADRs V2)

- **ADR-V2-005/Pilar 1:** desfecho de DPedido -301/-302/-303 só via `OperacaoExecucaoClaude` → os novos campos entram em `registrarOutcome`.
- **ADR-V2-030/035:** `projectSlug` é identidade técnica e o CLAUDE.md global é o mapa → mantido; muda só **qual** slug é a fonte.
- **ADR-V2-032/033:** contrato `run-claude-code` + callback HMAC → estendido de forma **aditiva** (campos opcionais).
- **ADR-V2-046:** paridade do warmer → re-baseline dos snapshots.
- **ADR-V2-049:** PromptBuilder canônico → passa a gerar o **envelope**, não as regras git.
- **ADR-V2-082:** `dados.timeoutSec` fonte única, sweeper, P1 (callback tardio substitui sintético), lista canônica de motivos → reaproveitados; esta task **acrescenta** motivos à lista e um teto de tempo para o modo esteira.

---

## 2. Abordagem Escolhida

### Solução — (B+) Comando padronizado no repo + envelope + contrato JSON verificado pelo agente

1. **O repo é dono da esteira.** Cada repo de cliente ganha um comando headless padronizado, `.claude/commands/scrumban-executar.md` (distribuído pelo template Devari-Core). Ele manda a conversa principal orquestrar Strategist → Implementer → Reviewer → Documenter (com hooks do repo), em **modo autônomo** (sem "PAUSAR e perguntar"), em **foreground**, na branch indicada, e terminar com o JSON do contrato.
2. **O backend manda um envelope**, não instruções git: task (id, nome, descrição, tipo), `git.branch`, `git.baseBranch`, `pipeline.required`, `timeoutSec`.
3. **O agente** faz preflight (comando existe? `gh` + `GITHUB_TOKEN`? base existe?), prepara o git (fetch, base certa, branch `scrumban/exec-<executionId>`), chama `claude -p "/scrumban-executar\n<envelope>" --append-system-prompt <contrato curto> --json-schema <schema>` e, ao fim, **verifica sozinho**: commits em `base..branch`, push no remoto (`git ls-remote`), PR via `gh pr list --head <branch> --state all --json ...`, e `subagent_stats.by_type` para provar que os 4 papéis rodaram.
4. **O callback** leva um bloco `pipeline` estruturado (declarado + verificado). O **Engine** grava `dados.git`, `dados.pullRequest`, `dados.pipeline` e aplica a política de sucesso: `exit 0` **e** contrato válido **e**, quando `pipeline.required`, PR verificado + decisão `APPROVED`.

### Justificativa

- **Verificável por 3 fontes independentes:** o que o modelo **diz** (`structured_output`), o que o **git/GitHub mostram** (agente consulta) e o que o **runtime registrou** (`subagent_stats`). O backend nunca depende só da palavra do modelo.
- **Esteira continua sendo do repo:** o agente não codifica as fases; cada repo evolui a sua (Pilar de genericidade — sobe para o template).
- **Detecção trivial e determinística:** "o arquivo `.claude/commands/scrumban-executar.md` existe?".
- Reaproveita `ExecutionResponseDto.git/pullRequest` (já expostos), `DProject.dados.automation.remoteBranch`, `GITHUB_TOKEN` e o ciclo de vida da ADR-V2-082.

### Alternativas Consideradas (≥2)

| | (A) Só prompt + `--append-system-prompt` | **(B+) Comando no repo + contrato verificado** ✅ | (C) Agente orquestra fase a fase (`claude -p` por etapa) |
|---|---|---|---|
| Como | Templates do backend descrevem a esteira; modelo termina com bloco JSON | Repo expõe `/scrumban-executar`; agente invoca, valida schema e confere git/gh/subagents | Agente chama Strategist, lê plano, chama Implementer, lê score… e decide gates em TS |
| Garante que a esteira rodou? | ❌ Fraco: modelo pode fazer "fast mode" | ✅ `subagent_stats.by_type` + hooks do repo | ✅✅ Forte (o agente é o orquestrador) |
| Respeita a esteira de cada repo? | ⚠️ Prompt genérico, ignora diferenças | ✅ O repo define | ❌ Agente impõe um formato único de fases |
| Mudança nos repos de cliente | Nenhuma | 1 arquivo (via template) | Nenhuma, mas exige convenção rígida de saída por fase |
| Esforço | ~20h | ~40h | ~70h+ (estado entre fases, resume, retries, timeouts por fase) |
| Risco | Alto (PR sem esteira continua possível) | Médio (contrato novo em 3 partes) | Alto (duplica lógica de orquestração; quebra "conversa principal é o único orquestrador") |
| Progresso por fase | Não | Não (COULD: stream-json) | Sim |

**Por que não (A):** é exatamente o estado de hoje com texto melhor — não dá garantia. **Mas** (B+) absorve o melhor de (A): `--append-system-prompt` com o contrato e o `--json-schema`.
**Por que não (C) agora:** custo alto e acopla o agente a um formato de esteira. Fica registrado como evolução se a verificação de (B+) mostrar esteira "pulada" com frequência.

---

## 3. Avaliação dos 3 Pilares

### Pilar 1: Engine/Operação
- **Não há INSERT novo** em DPedido. Há **UPDATE de desfecho** de DPedido -301/-302/-303 → continua **dentro** de `OperacaoExecucaoClaude.registrarOutcome` (CAS existente da ADR-V2-082). Os novos campos (`git`, `pullRequest`, `pipeline`) entram no mesmo `JSON.stringify(this.dados)` do UPDATE — zero Prisma direto no `AgentsService`.
- Política de sucesso da esteira = método puro do Engine `avaliarDesfechoEsteira()` (chamado antes do UPDATE). **DVFS considerado e rejeitado** nesta task: regra curta, testável em unidade, e mudar DVFS exige seed + md5 no deploy (custo maior que o ganho). Registrar como candidata a DVFS se ganhar variação por cliente.
- DVFS chave 7 (`pr-auto-open.js`) **continua no-op** (sem `githubClient` no caminho do callback) — teste de regressão garante que preencher `dados.git` não o ative por acidente.
- Desvio herdado (`markRunning` raw no processor, ADR-V2-082) **não é tocado**.

### Pilar 2: Endpoints Genéricos
- **Zero endpoint novo.** O resultado sai pelo `GET /executions/:id` já existente (`git`, `pullRequest` já no DTO + novo `pipeline`). O callback `POST /agents/:id/execution-result` ganha campos **opcionais**.

### Pilar 3: Seed de Classes
- **Zero DClasse nova, zero tabela, zero migration.** Motivos novos entram na lista canônica `EXECUTION_FAILURE_REASONS` (`execution-lifecycle.const.ts`), como pedido. Slug: correção em código + script dry-run de detecção (DML só se aprovado).

### Genericidade (template vs V2-específico)
- **Volta para o template Devari-Core:** o comando `.claude/commands/scrumban-executar.md` e o schema de contrato (`pipeline-result.schema.json`). Todo SaaS gerado nasce "executável pela VPS".
- **V2-específico:** política de sucesso por `taskType`, motivos canônicos, janela de busy.

---

## 4. Estrutura Técnica

### Contrato de entrada — payload `RUN_CLAUDE_CODE` (aditivo)

```jsonc
{
  "executionId": "4815", "projectSlug": "acme-api", "prompt": "<envelope renderizado>",
  "resumeSessionId": null, "timeoutSec": 14400,
  // NOVOS (opcionais — agente antigo ignora; agente novo sem eles = modo legado)
  "git": { "branch": "scrumban/exec-4815", "baseBranch": "develop" /* null = default do repo */ },
  "pipeline": { "required": true, "taskType": "code" }
}
```
- `git.branch`: o **backend** decide (fonte de verdade). Em `--resume`, reusa `dados.git.branch` da execução de origem.
- `git.baseBranch`: `DProject.dados.automation.remoteBranch` se existir; senão `null` ⇒ agente usa `git symbolic-ref refs/remotes/origin/HEAD` (default do repo). **Fim do `main` fixo.**

### Contrato de saída — o que o `claude` DEVE produzir (`--json-schema`)

Arquivo único versionado: `agent/src/claude-code/pipeline-result.schema.json` (espelhado no template Devari-Core).

```jsonc
{
  "contractVersion": 1,
  "decision": "APPROVED | NEEDS_CHANGES | REJECTED | NO_CHANGES | ABORTED",
  "reviewScore": 9.0,               // null se não houve review
  "reviewFile": "workspace/reviews/review-x.md",   // opcional (agente confere se existe)
  "stages": [ { "name": "strategist|implementer|reviewer|documenter", "status": "done|skipped|failed" } ],
  "branch": "scrumban/exec-4815",
  "commit": "a1b2c3d",              // HEAD da branch
  "prUrl": "https://github.com/acme/api/pull/42",  // null se NO_CHANGES
  "summary": "3-5 linhas"
}
```

### Contrato do callback — `ExecutionResultDto.pipeline` (novo, opcional)

```jsonc
"pipeline": {
  "mode": "pipeline | simple",
  "declared": { /* structured_output acima, ou null se ausente/inválido */ },
  "verified": {
    "branchExists": true, "pushed": true, "commitsAhead": 4, "headSha": "a1b2c3d…",
    "baseBranch": "develop",
    "pr": { "url": "...", "number": 42, "state": "OPEN", "isDraft": false, "baseRefName": "develop", "headRefOid": "a1b2c3d…" } | null,
    "prOpenedBy": "pipeline | agent-fallback | null",
    "subagents": { "strategist": 1, "implementer": 2, "reviewer": 2, "documenter": 1 },
    "contractValid": true
  }
}
```

### Política de sucesso (Engine `avaliarDesfechoEsteira`)

| Situação | `statusCode` | `audit.outcome.reason` |
|---|---|---|
| exit 0 + contrato válido + `required` + PR verificado (`headRefOid == headSha`) + `APPROVED` | -519 SUCCESS | — |
| exit 0 + `NO_CHANGES` + `required` | -520 FAILED | `PR_NOT_CREATED` (*P-CEO 3*) |
| exit 0 + contrato ausente/inválido | -520 FAILED | `PIPELINE_CONTRACT_MISSING` |
| exit 0 + `required` + sem PR verificado | -520 FAILED | `PR_NOT_CREATED` |
| `NEEDS_CHANGES`/`REJECTED` (Reviewer < 8.5 ou 3 ciclos) | -520 FAILED (PR draft visível, *P-CEO 3*) | `PIPELINE_NOT_APPROVED` |
| comando ausente no repo e `required` | -520 FAILED | `PIPELINE_NOT_INSTALLED` (*P-CEO 1*) |
| `gh`/token/base ausentes | -520 FAILED | `PIPELINE_PRECONDITION_FAILED` |
| `pipeline.required=false` (research/validation/other) | regra atual (exit 0) | — |
| `subagents` sem `reviewer` mas declarou `APPROVED` | -520 FAILED | `PIPELINE_CONTRACT_MISSING` (declaração não bate com o runtime) |

`ExecutionOutcomeDto.reason` passa a ser preenchido também com `source='agent'` **quando** o motivo é canônico (hoje é sempre `null` para agent).

### Arquivos a Criar

| Arquivo | O quê |
|---|---|
| `agent/src/claude-code/pipeline-result.schema.json` | Schema do contrato (fonte única, `contractVersion: 1`) |
| `agent/src/claude-code/pipeline-contract.ts` | `parsePipelineOutput(json)` → `declared`; valida schema; lê `subagent_stats.by_type` |
| `agent/src/git/pipeline-git.ts` | `prepareBranch()` (fetch, base, stash de sobras, `checkout -B`), `verifyBranch()` (rev-list, ls-remote), `findPr()` / `openFallbackPr()` via `gh` |
| `agent/src/claude-code/pipeline-preflight.ts` | Existe comando? `gh --version` + `GITHUB_TOKEN`? base existe? |
| `agent/__tests__/pipeline-contract.spec.ts`, `pipeline-git.spec.ts`, `pipeline-preflight.spec.ts`, `runner-process-group.spec.ts` | Jest |
| `src/automation/agents/dto/execution-pipeline-result.dto.ts` | DTOs aninhados (`declared`, `verified`, `pr`) com class-validator + Swagger |
| `src/executions/dto/execution-pipeline.dto.ts` | Projeção segura de `dados.pipeline` na resposta (sem `summary` cru? — ver R8) |
| `templates/.claude/commands/scrumban-executar.md` (Devari-Core) + cópia em `scrumban/backend` e `scrumban/frontend` | Comando headless da esteira |
| `prisma/scripts/detect-project-slug-divergence.ts` | Dry-run: lista DVincula PROJECT_AGENT com `projectSlug` ≠ `DProject.dados.slug` e colisões por agente |
| `docs/decisions/ADR-V2-083-esteira-headless-contrato-verificavel.md` | ADR |

### Arquivos a Modificar

| Arquivo | Mudança |
|---|---|
| `agent/src/claude-code/command-builder.ts` | `--system-prompt` → `--append-system-prompt` (contrato curto fixo, **não** o mapa de slugs); novos campos `jsonSchema`, `maxBudgetUsd`, `excludeDynamicSections`; ordem documentada |
| `agent/src/claude-code/runner.ts` | `spawn` com `detached: true` + kill do **grupo** (`process.kill(-pid)`) SIGTERM→15s→SIGKILL (L6); resolve no `exit` com 5s de dreno; mata o grupo restante após saída normal; fecha stdin; buffer com teto |
| `agent/src/handlers/run-claude-code.handler.ts` | Remove `promptWithGitRules` e `gitPullRebase(main)`; novo fluxo preflight → prepareBranch → run → verify → fallback → callback; aceita `git`/`pipeline` no payload; mantém modo legado se ausentes |
| `agent/src/handlers/warm-cache.handler.ts` + `command-builder.spec.ts` | Re-baseline da paridade (ADR-V2-046) |
| `agent/src/outbound/backend-client.ts` | `ExecutionResultPayload.pipeline?`; execution-result com 10 tentativas, teto 60s (~8 min) |
| `agent/src/config/schema.ts` | `pipelineTimeoutMaxSec` (clamp local), `maxBudgetUsd?`, `prFallback` (bool) |
| `agent/CLAUDE-md-template.md` | Remove bloco "Regras Globais — Git" (o agente controla a branch) |
| `agent/package.json` | 0.1.1 → 0.2.0 (protocolo aditivo) |
| `src/automation/agents/dto/execution-result.dto.ts` | `@ValidateNested() pipeline?`; `EXECUTION_RESULT_ERROR_CODES` + `PIPELINE_NOT_INSTALLED`, `PIPELINE_PRECONDITION_FAILED`, `BASE_BRANCH_NOT_FOUND` |
| `src/automation/agents/agents.service.ts` | Repassa `dto.pipeline` ao Engine; evento `agent.execution.finished` ganha `prUrl`, `decision`, `reviewScore` (aditivo); passa a emitir `execution.succeeded` com prUrl (ver eventos) |
| `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` | `registrarOutcome({ …, pipeline })`; `avaliarDesfechoEsteira()`; grava `dados.git` / `dados.pullRequest` / `dados.pipeline` / `audit.outcome.reason` no mesmo UPDATE CAS |
| `src/engine/lib/interfaces/IExecucaoData.ts` | `pipeline?`, `git.baseBranch`, `git.commitsAhead`, `pullRequest.isDraft/openedBy/state` |
| `src/executions/constants/execution-lifecycle.const.ts` | Motivos novos (5) na lista canônica; `EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC=14400`, `EXECUTION_PIPELINE_TIMEOUT_MAX_SEC=21600`; janela de busy **por tempo** (`EXECUTION_BUSY_MAX_WAIT_SEC`) |
| `src/executions/executions.service.ts` | Decide `pipeline.required` por `taskType`; grava `dados.git.branch` (`scrumban/exec-<chave>` ou da origem no resume), `dados.git.baseBranch`, `dados.pipeline.required`; `timeoutSec` do modo esteira |
| `src/executions/processors/execution-run.processor.ts` | Envia `git`/`pipeline`; slug = `DVincula.metaDados.projectSlug` (fallback `dados.slug`); busy por tempo |
| `src/executions/services/prompt-builder.service.ts` + 5 templates | Viram **envelope** (dados da task + exigências); removem "regras de commit já injetadas" |
| `src/executions/dto/execution-response.dto.ts` | `pipeline?: ExecutionPipelineDto`; `outcome.reason` também para agent |
| `src/automation/project-agent/project-agent-link.service.ts` | Novo link usa `DProject.dados.slug` (remove o 2º slugify) |
| `docs/automation-security-runbook.md` | Runbook do deploy (Fase 13) |

### Endpoints REST
- **Nenhum novo.** `GET /executions/:id` e listagens passam a trazer `git`, `pullRequest`, `pipeline` preenchidos. `POST /agents/:id/execution-result` aceita `pipeline` opcional.

### Queries Prisma (exemplos chave)

```typescript
// Processor: slug que a VPS conhece (1 query, sem N+1)
const link = await this.prisma.dVincula.findFirst({
  where: { idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT, idLocEscritu: BigInt(projectId),
           idEntidade: BigInt(agentId), excluido: false },
  select: { metaDados: true },
});
const slug = asSlug(link?.metaDados?.projectSlug) ?? asSlug(project.dados.slug);

// Resume: branch da execução de origem (já carregada pelo service — reaproveitar o select existente)
```

### Eventos Emitidos
- `agent.execution.finished|failed` — **aditivo**: `prUrl`, `branch`, `decision`, `reviewScore`, `pipelineReason`.
- `execution.succeeded` (`{ executionId, prUrl, branch, reviewScore }`) — passa a sair do caminho real (callback), **após** a persistência; `execution.failed` idem com `reason`. Consumidor existente (`notification.consumer.ts`) já escuta `execution.failed`; checar se `execution.succeeded` tem consumidor antes de emitir (se não tiver, emitir mesmo assim — nome canônico).

### Impacto no Frontend (esteira do frontend — aqui só o contrato)

| Item | Contrato |
|---|---|
| Link do PR | `execution.pullRequest.url` (+ `number`, `isDraft`, `openedBy`) |
| Branch / commit | `execution.git.branch`, `git.headAfter`, `git.baseBranch` |
| Resultado da esteira | `execution.pipeline.decision`, `reviewScore`, `stages[]` |
| Textos de falha | 5 códigos novos em `outcome.reason` (lista fechada), agora também com `source='agent'` |
| Tempo | execuções de até 6h: o polling de 3s precisa tolerar (ou recuar para 15s após 10 min) e a UI mostrar "em execução há Xh" |

---

## 5. Plano de Implementação

> Ordem pensada para deploy: **backend aceita o contrato antes do agente mandá-lo** (achado 4).

### Fase 0: Spike na VPS (1,5h) — BLOQUEANTE para as fases do agente
- Como usuário `scrumban-agent`, num repo provisionado: `claude -p "/scrumban-executar …" --append-system-prompt … --json-schema … --dangerously-skip-permissions --output-format json < /dev/null`.
- Confirmar: CLAUDE.md do repo + agents carregados; hooks `SubagentStop`/`PreToolUse` (exit 2 bloqueia sob bypass?); subagents em foreground; `gh auth status` com `GITHUB_TOKEN`; `env` de `settings.local.json` ignorado ou não; ferramentas que os hooks usam (`bc`, `jq`, `npm`).
- Saída: anotação no ADR-V2-083 (seção "Fatos verificados").

### Fase 1: ADR-V2-083 + schema do contrato (2h)
- Redigir ADR (alternativas A/B+/C, contrato v1, política de sucesso, ordem de deploy).
- Criar `pipeline-result.schema.json` (fonte única) e o tipo TS gerado/espelhado no backend.

### Fase 2: Comando `/scrumban-executar` (3h)
- Template no Devari-Core + cópias em `scrumban/backend` e `scrumban/frontend`.
- Conteúdo obrigatório: (1) ler o envelope de `$ARGUMENTS`; (2) **modo autônomo**: nunca perguntar ao usuário; "3 rejeições → PAUSAR" vira `decision=NEEDS_CHANGES` + PR draft; (3) orquestrar os 4 papéis via Agent tool **em foreground**; (4) trabalhar **só** na branch do envelope (já criada); Documenter commita; (5) `git push -u origin <branch>` e `gh pr create --base <baseBranch> [--draft]`; (6) responder no schema.

### Fase 3: DTOs do backend (2h)
- `ExecutionPipelineResultDto` (+ aninhados) com `@ValidateNested`, `@Type`, `@IsOptional`, `@MaxLength`, `@IsUrl({ host_whitelist: ['github.com'] })` no prUrl.
- Novos códigos em `EXECUTION_RESULT_ERROR_CODES` e em `EXECUTION_FAILURE_REASONS` (+ spec da lista canônica).

### Fase 4: Engine (4h)
- `registrarOutcome` recebe `pipeline`; `avaliarDesfechoEsteira()` pura (tabela §4); grava `git`/`pullRequest`/`pipeline`/`audit.outcome.reason` no **mesmo** UPDATE CAS.
- Se a política rebaixa sucesso → `success=false` propaga para `transitionLinkedTask` (task FAILED) — ajustar `AgentsService` para usar o resultado do Engine, não `dto.success`.
- Regressão: `pr-auto-open.js` segue no-op com `dados.git` preenchido.

### Fase 5: Envelope, branch, base e política por tipo (3,5h)
- `ExecutionsService.execute`: `pipeline.required = taskType ∈ {code, docs}` (*P-CEO 1*); grava `dados.git.branch`, `dados.git.baseBranch`, `dados.pipeline.required`.
- PromptBuilder: templates viram envelope (dados + exigências por tipo). Remover "regras de commit já injetadas".
- Processor envia `git` e `pipeline`.

### Fase 6: Timeouts e busy (2h)
- Modo esteira: default 14400s, teto 21600s (*P-CEO 2*); modo simples mantém 1800/3600. `resolveExecutionTimeoutSec` ganha o teto por modo; passar `defaultSec` do lifecycle config (hoje a chamada em `executions.service.ts:288` ignora o override de env).
- Busy por **tempo**: desiste quando `now > firstBusyAt + teto + margem` (*P-CEO 4*); mantém backoff 30s→300s. QUEUE_STALE continua seguro porque `dispatch.nextAttemptAt` é atualizado a cada retry (conferir no spec).
- Sweeper: nada muda (deadline já usa `dados.timeoutSec`).

### Fase 7: Slug (2,5h)
- Processor usa `DVincula.metaDados.projectSlug` (o que a VPS conhece), fallback `DProject.dados.slug`.
- `project-agent-link.service.ts`: novos vínculos gravam `DProject.dados.slug`; remove `slugifyProjectName`.
- Script `detect-project-slug-divergence.ts` (dry-run; lista divergências e **colisões por agente**). Correção de colisão existente = re-provisionar (runbook), nunca UPDATE cego.

### Fase 8: Agente — command-builder + runner (5,5h)
- `--append-system-prompt` (contrato curto, fixo, versionado) + `--json-schema` + `--max-budget-usd` (se configurado) + `--exclude-dynamic-system-prompt-sections`; mapa de slugs **sai** do prompt.
- Runner: `spawn(detached)`, kill de grupo (L6), resolve no `exit` + dreno 5s, limpa o grupo após saída normal, fecha stdin, teto de buffer 10MB.
- Re-baseline dos snapshots do warmer (paridade continua: mesma função).

### Fase 9: Agente — preflight, git e verificação (5h)
- Preflight síncrono antes do ACK (só `fs.existsSync`): comando ausente + `required` ⇒ 422 `PIPELINE_NOT_INSTALLED` (backend → FAILED com motivo).
- Fase assíncrona: `gh`/token (`PIPELINE_PRECONDITION_FAILED`), `git fetch`, base (`BASE_BRANCH_NOT_FOUND`), sobras ⇒ `git stash push -u -m scrumban-leftover-<execId>` (nunca `reset --hard`), `checkout -B <branch> origin/<base>` (resume: `checkout <branch>`).
- Pós-execução: `parsePipelineOutput`, `verifyBranch`, `findPr`; fallback (*P-CEO 3*, flag `prFallback`): commits locais sem push/PR ⇒ push + `gh pr create --draft`, `prOpenedBy='agent-fallback'`.
- Callback com `pipeline`; retry 10× (~8 min).

### Fase 10: Testes (5h)
**agent (jest):**
- `pipeline-contract`: JSON válido, sem `structured_output`, schema inválido, `contractVersion` desconhecida, `subagent_stats` ausente.
- `pipeline-git`: base explícita × `origin/HEAD`; base inexistente; sobras ⇒ stash; resume reusa branch; ls-remote/rev-list mockados.
- `pipeline-preflight`: comando presente/ausente × required.
- `runner-process-group`: neto segurando stdout não trava; SIGTERM ignorado ⇒ SIGKILL no grupo; stdin fechado.
- `command-builder`: novo snapshot (ordem + flags); warmer com a mesma ordem.
- `run-claude-code.handler`: payload sem `git/pipeline` ⇒ modo legado idêntico (compat); fallback de PR.
**backend (jest):**
- `execution-result.dto`: `pipeline` válido/ inválido; prUrl fora do github.com rejeitado; códigos novos aceitos.
- `OperacaoExecucaoClaude.avaliarDesfechoEsteira`: 1 teste por linha da tabela §4.
- `registrarOutcome`: grava `git/pullRequest/pipeline` no UPDATE; supersede (P1) preserva o novo bloco; `pr-auto-open` no-op.
- `execution-result.service.spec`: task vai a FAILED quando a política rebaixa; eventos com prUrl.
- `executions.service`: `required` por tipo; branch `scrumban/exec-<chave>`; resume reusa branch; timeout por modo.
- `processor`: slug do DVincula com fallback; busy por tempo.
- `execution-lifecycle.const.spec`: lista canônica com os 5 novos.
- `serializeExecution`: `pipeline` + `outcome.reason` para agent.

### Fase 11: Smoke na VPS (2h)
- Repo de teste com o comando: task `code` ⇒ PR aberto pela esteira, `GET /executions/:id` com `pullRequest.url`, `pipeline.verified.subagents` com os 4 papéis.
- Repo sem o comando ⇒ FAILED `PIPELINE_NOT_INSTALLED` em < 5s.
- Timeout curto forçado ⇒ grupo inteiro morto, mutex liberado.

### Fase 12: Documentação (1h — Documenter)
- ADR-V2-083 Aceito, CHANGELOG/ROADMAP/STATUS, README do agente, nota no template Devari-Core.

### Fase 13: Deploy conjunto Task 1 + 2 + 3 (runbook — encaixe no plano da Task 2)

```
 Task 2 (já definido)                     Task 3 (acrescenta)
 1. pg_dump DPedido                        —
 2-3. backfill dry-run / apply             3b. detect-project-slug-divergence (dry-run) → revisar colisões
 4-5. seed DVFS + RISK_GATE floor          —
 6. deploy backend (T1+T2)          ──►    6. deploy backend (T1+T2+T3)   ← ANTES do agente (forbidNonWhitelisted)
 7. deploy frontend                        7. frontend com link do PR + 5 motivos novos
 8. bundle do agente (SIGKILL)      ──►    8. agente 0.2.0 (L6 + contrato) + CLAUDE.md global sem regras git
                                           8b. comando /scrumban-executar nos repos (via PR em cada repo)
                                           8c. GITHUB_TOKEN no env do agente (SET_ENV) com escopo repo
 9. smoke Fase 11 (T2)              ──►    9. smoke Fase 11 (T2) + Fase 11 (T3)
```
- Se o comando ainda não estiver num repo e `required`, execuções `code/docs` daquele repo falham com motivo claro — **não** silenciosamente.
- Agente 0.1.x com backend novo: funciona (campos novos são opcionais; backend trata ausência de `pipeline` como modo legado).

---

## 6. Estimativa de Tempo (com buffer 20%)

| Fase | Horas |
|---|---|
| 0 Spike VPS | 1,5 |
| 1 ADR + schema | 2 |
| 2 Comando `/scrumban-executar` | 3 |
| 3 DTOs backend | 2 |
| 4 Engine | 4 |
| 5 Envelope/branch/base/política | 3,5 |
| 6 Timeouts + busy | 2 |
| 7 Slug | 2,5 |
| 8 Agente builder + runner (L6) | 5,5 |
| 9 Agente preflight/git/verificação | 5 |
| 10 Testes | 5 |
| 11 Smoke VPS | 2 |
| 12 Docs | 1 |
| 13 Runbook | 1 |
| **Subtotal** | **40** |
| **+20% buffer** | **48h** |
| Frontend (fora) | ~3h |

---

## 7. Riscos e Mitigações

### Alto
- **R1 — Modelo pula a esteira e declara APPROVED.** Mitigação: `subagent_stats.by_type` precisa conter `reviewer` (e `implementer`) quando `decision=APPROVED`; senão `PIPELINE_CONTRACT_MISSING`. Hooks `SubagentStop` do repo continuam valendo.
- **R2 — Resultado de 4h perdido no callback.** Mitigação: retry ~8 min; backend antes do agente (forbidNonWhitelisted); sweeper + P1 cobrem chegada tardia. COULD: spool em disco.
- **R3 — Custo de 4–6h de `claude` por task.** Mitigação: `--max-budget-usd` configurável (*P-CEO 2*); teto de tempo por modo.
- **R4 — Hooks do repo falham na VPS** (ex.: `validate-implementer-build.sh` precisa de `node_modules`, `bc`). Mitigação: Fase 0 lista dependências; o comando instrui instalar deps antes do Implementer; falha vira `NEEDS_CHANGES` explícito, não loop infinito (teto de 3 ciclos).
- **R5 — Colisão de slug existente em produção.** Mitigação: script de detecção antes do deploy; re-provisionar os pares afetados.

### Médio
- **R6 — Paridade do warmer quebra (ADR-V2-046).** Mitigação: mesma função `buildClaudeArgs` nos dois; snapshot novo; medir `cache_read` no smoke.
- **R7 — Base branch errada** (repo sem `origin/HEAD`). Mitigação: `git remote set-head origin --auto` no preflight; `BASE_BRANCH_NOT_FOUND` explícito.
- **R8 — `summary`/`stages` do modelo vazarem conteúdo sensível na resposta.** Mitigação: limitar tamanho (`@MaxLength(2000)`), sem stdout cru; projeção segura no DTO (mesmo cuidado da ADR-V2-081).
- **R9 — Sobras de execução abortada no clone.** Mitigação: stash nomeado + log; nunca `reset --hard`.
- **R10 — Snapshot do system prompt em `--resume`** (CLI reusa o prompt gravado da sessão antiga). Mitigação: aceitar; resumes de sessões antigas seguem o prompt antigo até compactar.

### Baixo
- **R11 — `execution.succeeded` sem consumidor.** Mitigação: emitir mesmo assim (nome canônico), sem efeito colateral.
- **R12 — Subagent em background em `-p`.** Mitigação: comando exige foreground; `subagent_stats.completed == spawned` verificado.

---

## 8. Critérios de Sucesso

### MUST HAVE
- [ ] Task `code` executada num repo com o comando ⇒ PR aberto **pela esteira**, `GET /executions/:id` com `pullRequest.url`, `git.branch`, `pipeline.decision`, `pipeline.reviewScore`.
- [ ] `pipeline.verified.subagents` mostra os papéis que rodaram (fonte: runtime, não o modelo).
- [ ] Sucesso de `code/docs` exige PR verificado (`headRefOid == headSha`) + `APPROVED`; senão FAILED com motivo canônico.
- [ ] `--system-prompt` removido; `--append-system-prompt` só com o contrato curto.
- [ ] Base branch = config do projeto ou default do repo (zero `main` fixo).
- [ ] Timeout do modo esteira coerente (default 4h / teto 6h, sujeito a P-CEO 2) e busy por tempo.
- [ ] L6: kill do grupo de processos; neto segurando stdout não trava o mutex.
- [ ] Slug do dispatch = slug provisionado; novos vínculos usam `DProject.dados.slug`.
- [ ] Zero tabela, zero DClasse, zero endpoint novo; desfecho via Engine (Pilar 1).
- [ ] Agente 0.1.x + backend novo continua funcionando (compat).
- [ ] Testes: agent jest 100%; backend jest relevante verde; build e lint OK nos dois.

### SHOULD HAVE
- [ ] Fallback de PR pelo agente (draft, `openedBy='agent-fallback'`) se P-CEO 3 = sim.
- [ ] Callback com retry ~8 min.
- [ ] `--max-budget-usd` configurável.
- [ ] Template Devari-Core com o comando.

### COULD HAVE
- [ ] `--output-format stream-json` para progresso por fase (exige canal de progresso — sem endpoint novo, via heartbeat).
- [ ] Spool em disco do resultado para reenviar após restart do agente.
- [ ] Mover o mapa de slugs para fora de um `CLAUDE.md` (hoje vira contexto de todo repo).

### WILL NOT HAVE
- Abordagem (C) (agente orquestrando fase a fase).
- Execuções paralelas no mesmo projeto (worktrees) — `ExecutionWorktreeService` segue morto.
- Remover `GithubPrService` / `pr-auto-open.js` (follow-up de limpeza; aqui só garantimos que seguem inertes).
- Tabela/DClasse/endpoint novos.

---

## ❓ Perguntas para o CEO (só as necessárias)

| # | Pergunta | Recomendação |
|---|---|---|
| **P1** | Repo **sem** `/scrumban-executar`: falhar ou cair numa execução simples? | **Falhar** (`PIPELINE_NOT_INSTALLED`, mensagem "instale o comando") para `code` e `docs`; execução simples segue permitida para `research/validation/other` (sem PR exigido). Fallback silencioso traria de volta o "PR sem esteira" que esta task quer eliminar. |
| **P2** | Limites do modo esteira | **Default 4h, teto 6h**; `--max-budget-usd` desligado no início e ligado após medir 5–10 execuções reais. |
| **P3** | Esteira termina sem aprovação (Reviewer < 8.5 após 3 ciclos) ou o modelo esquece o PR | **PR em draft** (aberto pela esteira, ou pelo agente como rede de segurança, marcado `agent-fallback`) + execução **FAILED** com `PIPELINE_NOT_APPROVED`/`PR_NOT_CREATED`. Nenhum trabalho perdido, nada mergeável por engano. |
| **P4** | 2ª execução no mesmo projeto durante uma esteira de horas (revê P2 da Task 2: 10 tentativas ≈ 41 min) | **Esperar por tempo** (até teto + margem, ~6h05) em vez de 10 tentativas — mantém 1 esteira por projeto por vez, sem falha artificial. |

---

**Handoff para Implementer:**

1. **Pré-requisito:** respostas P1–P4 (defaults acima se o CEO aprovar as recomendações) e Fase 0 feita na VPS.
2. Ordem: Fases 1 → 3 → 4 → 5 → 6 → 7 (backend, deployável sozinho) → 8 → 9 (agente) → 2 (comando nos repos) → 10 → 11.
3. Não alterar a assinatura de `_atualizarPedidoCompleto` nem o CAS de `registrarOutcome` (só acrescentar campos ao JSON).
4. Comandos:
```bash
# backend
npx jest src/executions src/automation/agents src/engine --runInBand
npm run build && npm run lint
# agente
cd agent && npm test && npm run build && npm run lint
# detecção de slug (dry-run)
npx ts-node prisma/scripts/detect-project-slug-divergence.ts
```
5. Commit: `feat(executions): esteira headless com contrato verificável (ADR-V2-083)` + `feat(agents): agente 0.2.0 ...` (PR único — ADR-V2-036).
