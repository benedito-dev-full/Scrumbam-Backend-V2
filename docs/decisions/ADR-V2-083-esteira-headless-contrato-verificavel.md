# ADR-V2-083: Esteira headless na VPS — comando `/scrumban-executar` no repo, contrato JSON verificado pelo agente, desfecho decidido pelo Engine

**Status:** Aceito (Reviewer APPROVED 9.1/10 em 2026-11-23 após 3 ciclos: 8.6 → 8.9 → 9.1; Fase 0 na VPS e smoke pendentes)
**Data:** 2026-11-23
**Decisores:** Strategist Agent V2 (plano `workspace/plans/plan-executions-fluxo-agentes-vps-task3.md`), Implementer Agent V2, CEO (decisões P1–P4 de 2026-11-23)
**Tags:** #V2 #fase-F13 #F6 #automation #agent #engine
**Relacionados:** ADR-V2-005, ADR-V2-030, ADR-V2-032, ADR-V2-033, ADR-V2-035, ADR-V2-036, ADR-V2-046 (re-baselinada), ADR-V2-049, ADR-V2-081, ADR-V2-082 (emendada — P4)

---

## Contexto e Problema

"Executar" numa task devia resultar num PR feito pela esteira multi-agent do PRÓPRIO repo do cliente,
com o backend sabendo URL, branch, commit, nota e decisão do Reviewer. Nada disso era garantido nem
verificável:

- o agente passava o CLAUDE.md global (mapa de slugs) em `--system-prompt`, que **substitui** o prompt
  padrão do Claude Code, e colava regras git fixas (`--base main`, `git checkout main`);
- o prompt só dizia "siga o CLAUDE.md"; o modelo fazia o que achava (fast mode);
- sucesso = exit 0; PR URL perdida no stdout truncado; `dados.git`/`pullRequest` nunca preenchidos;
- timeout 30 min (máx. 60) matava uma esteira de 3–4h; SIGKILL só no PID principal (netos seguravam o
  stdout ⇒ mutex do slug preso);
- slug do dispatch (`DProject.dados.slug`, com sufixo de colisão) ≠ slug provisionado (`DVincula`, sem
  sufixo) ⇒ dois projetos homônimos executavam no MESMO clone (isolamento entre clientes).

## Alternativas

| | (A) Só prompt + `--append-system-prompt` | **(B+) Comando no repo + contrato verificado** ✅ | (C) Agente orquestra fase a fase |
|---|---|---|---|
| Garante a esteira? | Fraco (modelo pode pular) | `subagent_stats` do runtime + hooks do repo | Forte |
| Respeita a esteira de cada repo? | Não | Sim (o repo define) | Não (formato único) |
| Esforço / risco | ~20h / alto | ~40h / médio | 70h+ / alto |

(B+) absorve o melhor de (A) (`--append-system-prompt` + `--json-schema`). (C) fica como evolução se a
verificação mostrar esteira "pulada" com frequência.

## Decisão

1. **O repo é dono da esteira.** Comando headless padronizado `.claude/commands/scrumban-executar.md`
   (template Devari-Core; cópias em `scrumban/backend` e `scrumban/frontend`): modo autônomo (nunca
   pergunta), papéis em foreground, só na branch indicada, teto de 3 ciclos de revisão, PR `--draft`
   quando não aprovado, termina com o contrato v1.
2. **Backend manda envelope**, não regras git. `PromptBuilder` renderiza dados da task + exigências do
   tipo. Na criação (modo PROMPT) grava `dados.git = { branch: 'scrumban/exec-<chave>', baseBranch }`
   (`baseBranch` = `DProject.dados.automation.remoteBranch` validado ou `null` ⇒ default do repo) e
   `dados.pipeline = { required:true, prRequired: taskType∈{code,docs}, taskType, contractVersion:1 }`.
   COMMAND/HÍBRIDO seguem no modo simples.
3. **Agente 0.2.0**: preflight síncrono antes do ACK (comando ausente ⇒ 422 `PIPELINE_NOT_INSTALLED`);
   depois do ACK: `gh` + token + origin, base (`origin/HEAD` com `set-head --auto`), stash nomeado de
   sobras (nunca `reset --hard`), `checkout -B <branch> origin/<base>`; roda
   `claude -p "/scrumban-executar CONTROLE-SCRUMBAN v1 <json>\n\n<envelope>"` com
   `--append-system-prompt <contrato curto fixo> --json-schema <schema v1> --exclude-dynamic-system-prompt-sections`
   (sem `--system-prompt`, nunca `--bare`); verifica **independente do modelo**: HEAD, commits à frente,
   push (`ls-remote`), PR (`gh pr list --head`), `subagent_stats.by_type`. Rede de segurança (P3): commits
   sem PR ⇒ push + `gh pr create --draft` (`prOpenedBy='agent-fallback'`); sem aprovação verificável ⇒
   `gh pr ready --undo`.
4. **Callback aditivo** `pipeline: { mode, declared, verified }` (DTO com limites; `forbidNonWhitelisted`
   ⇒ backend sobe antes do agente). Retry do callback: 12 tentativas, ~8 min.
5. **Desfecho pelo Engine (Pilar 1).** `OperacaoExecucaoClaude.avaliarDesfechoEsteira()` (pura) decide;
   `registrarOutcome` grava `dados.git`, `dados.pullRequest`, `dados.pipeline`, `audit.outcome.reason` no
   MESMO UPDATE CAS da ADR-V2-082. `AgentsService` usa o `success` do Engine (task, eventos).

| Situação | Resultado | `outcome.reason` |
|---|---|---|
| sem `dados.pipeline.required` / callback sem `pipeline` (agente 0.1.x) | regra legada (exit 0) | — |
| comando ausente | FAILED | `PIPELINE_NOT_INSTALLED` |
| gh/token/origin/base/preparo do git | FAILED | `PIPELINE_PRECONDITION_FAILED` |
| contrato ausente/inválido | FAILED | `PIPELINE_CONTRACT_MISSING` |
| `NEEDS_CHANGES`/`REJECTED`/`ABORTED` | FAILED (PR rascunho) | `PIPELINE_NOT_APPROVED` |
| `NO_CHANGES` + prRequired | FAILED | `PR_NOT_CREATED` |
| `APPROVED` + prRequired sem reviewer/implementer no runtime | FAILED | `PIPELINE_CONTRACT_MISSING` |
| `APPROVED` + prRequired sem PR da esteira com `headRefOid == headSha` e push | FAILED | `PR_NOT_CREATED` |
| `APPROVED` sem prRequired e sem nenhum subagente no runtime (Ciclo 2 / M2) | FAILED | `PIPELINE_CONTRACT_MISSING` |
| `APPROVED` (+ PR verificado se prRequired; ≥1 subagente se não) / `NO_CHANGES` sem prRequired | SUCCESS | — |

6. **Motivos novos** só na lista canônica `EXECUTION_FAILURE_REASONS` (5 códigos; total 13).
   `ExecutionResponseDto.outcome.reason` passa a vir também com `source='agent'`, restrito a esses 5.
   Zero DClasse, zero tabela, zero endpoint novos.
7. **Tempo (P2):** modo esteira default 4h (`EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC`), teto 6h; modo
   simples segue 30 min/1h. `--max-budget-usd` existe mas fica desligado.
8. **Busy por tempo (P4 — emenda à ADR-V2-082):** 409 `PROJECT_BUSY` re-enfileira (30 s→300 s) enquanto
   `now − firstBusyAt ≤ EXECUTION_BUSY_MAX_WAIT_SEC` (21900 s ≈ 6h05 = teto da esteira + margem);
   depois ⇒ `PROJECT_BUSY_EXHAUSTED`. `firstBusyAt` no job (`busySince`) e em `dados.dispatch`.
9. **L6:** runner com `spawn(detached)` + kill do GRUPO (SIGTERM → 15 s → SIGKILL), resolve no `exit`
   com dreno de 5 s, mata o grupo restante após saída normal, stdin fechado, buffer 10 MB.
10. **Slug:** dispatch usa `DVincula(PROJECT_AGENT).metaDados.projectSlug` (o que a VPS conhece; fallback
    `DProject.dados.slug`); vínculo novo nasce com `DProject.dados.slug`. Script dry-run
    `prisma/scripts/detect-project-slug-divergence.ts` lista divergências e colisões por agente.
11. **Warmer (ADR-V2-046 re-baselinada):** mesmas flags de sessão da task real; não lê mais o CLAUDE.md
    global; `error_max_turns` com cache criado conta como warm bem-sucedido.
12. **DVFS chave 7 (pr-auto-open)** segue inerte no callback (sem `githubClient`) — teste de regressão.
13. **Ciclo 2 (review):** (M1) o agente usa a MESMA regra de aprovação verificável do Engine
    (`isApprovalVerified` — teste de paridade); (M3) valores de segredos do ambiente/config viram
    `[REDACTED]` em todo o callback e nos logs; (M4) o timeout não dispara depois do `exit`;
    (M5) o envelope da task vai num bloco `DADO-NAO-CONFIAVEL` com nonce aleatório, marcadores de
    controle dentro dele são neutralizados e o comando o trata como dado.

## Fatos verificados (local, CLI 2.1.330, 2026-11-23 — ~US$ 0,03)

- `-p` carrega CLAUDE.md do projeto, rules ancestrais, `~/.claude/CLAUDE.md` e `.claude/agents` (mesmo com `--system-prompt`).
- Hooks de `.claude/settings.json` rodam sob `-p --dangerously-skip-permissions`.
- Slash command do repo funciona em `-p`, inclusive com argumento MULTILINHA (bloco JSON + texto).
- `--json-schema` ⇒ `structured_output` validado; `subagent_stats = {spawned, requested{background,foreground,unset}, started_in_background, completed, failed, killed, refused, by_type}`.
- `--json-schema` + `--max-turns=1` ⇒ `subtype=error_max_turns`, exit 1, `cache_creation_input_tokens > 0`.
- **Pendente (Fase 0, como `scrumban-agent` na VPS):** PreToolUse exit 2 sob bypass; `permissionMode` dos subagentes; `gh auth` com `GITHUB_TOKEN`; `env` do `settings.local.json`; `bc`/`jq`/`npm`. Roteiro em `docs/automation-security-runbook.md`.

## Consequências

**Positivas:** sucesso de `code`/`docs` = PR verificado + aprovação com prova do runtime; PR e decisão
visíveis no `GET /executions/:id`; nenhuma esteira morta por timeout curto; nenhum neto segura o mutex;
nada mergeável por engano; isolamento entre projetos homônimos.

**Negativas / riscos aceitos:** custo de horas de `claude` por task (teto de custo desligado até medir);
contrato entre 3 partes (backend, agente, comando no repo) — mudança = bump de `contractVersion`; um
repo sem o comando passa a falhar todas as execuções de task até instalar (P1, intencional); prefixo
de cache varia por projeto; `--resume` de sessões antigas reusa o system prompt gravado (R10).

**Ordem de deploy:** backend → frontend → agente 0.2.0 + comando nos repos + `GITHUB_TOKEN`.

## Decisões do CEO (2026-11-23)

| # | Decisão | Onde está no ADR |
|---|---------|------------------|
| P1 | Repo sem `/scrumban-executar` ⇒ toda execução de task falha (`PIPELINE_NOT_INSTALLED`) até instalar o comando. Intencional: não há esteira "meia" | Decisão 3 (preflight) e Consequências |
| P2 | Modo esteira: timeout default 4h, teto 6h. Modo simples segue 30 min / 1h | Decisão 7 |
| P3 | Rede de segurança: commit sem PR ⇒ push + PR rascunho (`prOpenedBy='agent-fallback'`); sem aprovação verificável ⇒ `gh pr ready --undo` | Decisão 3 |
| P4 | Emenda à ADR-V2-082: 409 `PROJECT_BUSY` re-enfileira até `EXECUTION_BUSY_MAX_WAIT_SEC` (21900 s ≈ 6h05) em vez de contagem fixa | Decisão 8 |

## Follow-ups (LOW do Reviewer, não bloqueantes)

| ID | Tema | Ação |
|----|------|------|
| F1 | `neutralizeEnvelope`: normalização ampliada contra marcas combinantes (`\p{M}`), travessões e separadores (`\p{Pd}`) e homóglifos (ex.: cirílico) | Ampliar normalização antes do regex; testes de bypass do Reviewer como regressão |
| F2 | Redação de segredos no `failed()` do warm-cache | Aplicar `redact` antes de qualquer corte também nesse caminho |
| F3 | Retomada de sessão (`--resume`) sem `resumeSessionId` gravado | Documentar e tratar como nova sessão; medir frequência |
| F4 | `maxBudgetUsd` ainda desligado | Ligar após medir 5–10 execuções reais de esteira (custo por task) |

Os follow-ups de ciclos anteriores (L6–L14 do ADR-V2-082) seguem válidos.
