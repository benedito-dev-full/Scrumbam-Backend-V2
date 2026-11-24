# Review Report: Task 3 — Esteira headless na VPS com contrato verificável (V2 F13 sobre Engine F6)

**Reviewed by:** Reviewer Agent V2
**Date:** 2026-11-23 (re-review, Ciclo 3 — escopo agent/)
**Module:** agent/ (0.2.0) — redação de segredos e neutralização do envelope

## Resultado Final (atual)

### APPROVED — Score: 9.1/10

N1, N2 e N4 corrigidos e verificados no código e em runtime; N3 cobre os casos pedidos (NFKC, invisíveis Cf, espaços Zs) mas ainda deixa passar variantes (homóglifos, marcas combinantes, travessões). Como a defesa real é o nonce + instrução do comando, é resíduo menor. Nenhum bloqueante.

## Testes Automatizados (Ciclo 3)
- `cd agent && npm test`: 312 passam (25 suites); `npm run build`, `npm run lint`, `npm run typecheck`: PASS
- Backend não tocado neste ciclo (resultados do Ciclo 2 seguem válidos: build OK, tsc 67 = baseline, jest 676/677 com a falha pré-existente de `provision.service.spec`)

## Verificação objetiva

| # | Item | Veredito | Evidência |
|---|---|---|---|
| N1 | Summary/título/corpo do PR redigidos | OK | `pipeline-flow.ts:259` redige o stdout bruto antes do `parseClaudeOutput` (summary nasce limpo); `:301-302` título e corpo do PR passam por `redact` antes do `openDraftPr`; o `slice(0,200/4000)` de `pipeline-git.ts:342-344` vem depois |
| N2 | Redigir antes de truncar | OK | Varri todo `slice/substring/truncate` em `agent/src`: `note()` (`:157` redact→slice), erro do preparo (`:220` truncate(redact)), stdout/stderr dos 2 modos, warm (`:267,281,289,305` redact→corte), `errMsg` sem corte. Os restantes não carregam segredo: `contract clip` (JSON já redigido), `backend-client truncate` (corpo de resposta do backend), parsers de config/CLAUDE.md/HMAC |
| N3 | NFKC + invisíveis | Parcial | `pipeline-flow.ts:106`: `normalize('NFKC')` + remove `\p{Cf}` + `\p{Zs}`→espaço antes dos regex; fullwidth, ZWSP, soft hyphen, BOM, tag chars e NBSP agora neutralizados (testado no build) |
| N4 | Warm-cache | OK | `warm-cache.handler.ts` redige stderr (log e `errorMessage`) e `stdoutPreview` antes do corte |

### Bypasses novos tentados contra `neutralizeEnvelope` (build real)
Passaram intactos (não neutralizados):
1. Marca combinante/variation selector: `CONTROLE\uFE0F-SCRUMBAN`, `CONTROLE\u0301-SCRUMBAN` (categoria Mn, não coberta por `\p{Cf}`).
2. Homóglifo cirílico: `\u0421ONTROLE-SCRUMBAN`, `DADO-N\u0410O-CONFIAVEL` (NFKC não mapeia).
3. Separador não-ASCII: `CONTROLE\u2013SCRUMBAN`, `CONTROLE — SCRUMBAN`, `CONTROLE.SCRUMBAN`; e `DADO\u2011NAO\u2011CONFIAVEL` vira `DADO\u2010NAO\u2010CONFIAVEL` (NFKC mapeia U+2011 para U+2010, que o regex não trata como `-`).
Impacto: baixo — marcador de fechamento sem o nonce correto não é autoritativo, e controle fora do envelope é o único válido (instrução do comando nas 3 cópias).

## Issues (Ciclo 3)

**CRITICAL:** None
**MEDIUM:** None

**MINOR**
- P1 — `neutralizeEnvelope` (`pipeline-flow.ts:106-112`): ampliar a normalização antes dos regex: remover `\p{M}` (marcas combinantes/variation selectors), mapear `\p{Pd}` (U+2010–2015, 2212 etc.) para `-`, e tornar o regex tolerante a `[\s_.\-\p{Pd}]*`; homóglifos cirílicos/gregos exigiriam tabela de confusáveis (opcional — o nonce já cobre).
- P2 — `warm-cache.handler.ts:416-431` (`failed()`): `errorMessage`/log de erro pré-execFile sem `redact`. A mensagem vem de resolução de identidade/allowlist (não do claude), risco prático nulo; por consistência passar por `redact`.
- P3 — Pendências operacionais seguem valendo (Fase 0 na VPS, comando nos repos de clientes, script de slug antes do deploy).

**Score Final:** 9.1/10

## Decisão: APPROVED

**Justificativa:** vazamentos residuais do Ciclo 2 fechados com redação na fonte e "redigir antes de cortar" em todos os pontos; resíduos de Unicode são defesa em profundidade.

**Próximo:** Documenter (P1/P2 opcionais, sem bloquear).

---

## Histórico — Ciclo 2 (re-review anterior, mantido para rastreio)

### APPROVED — Score: 8.9/10

Correções M1, M2 e M4 verificadas por completo; M3 e M5 funcionam nos caminhos principais, com resíduos menores (defesa em profundidade) listados abaixo. Nenhum bloqueante.

## Testes Automatizados (Ciclo 2)
- Build backend: PASS
- TypeScript: 67 erros = baseline; 0 em arquivos tocados
- ESLint (arquivos tocados em src/): 0 erros; 1 warning pré-existente (`agents.service.ts:583`, linha não tocada)
- Jest `src/executions src/automation src/engine --runInBand`: 676 passam, 1 falha pré-existente (`provision.service.spec`, depende de env)
- Agente: `npm test` 307 passam (25 suites) + build + lint + typecheck: PASS

## Verificação objetiva das correções

| # | Item | Veredito | Evidência |
|---|---|---|---|
| M1 | Paridade `isApprovalVerified` agente × Engine | OK | `agent/src/claude-code/pipeline-contract.ts:287`: prRequired ⇒ reviewer>0 E implementer>0, `subagents` nulo ⇒ false; idêntico ao R1 do Engine; usada no passo "nada mergeável"; tabela de paridade testada |
| M2 | Não-prRequired exige ≥1 subagente | OK | Engine (`OperacaoExecucaoClaude.ts` ~880, `Object.values(subagents ?? {}).some(n => n>0)`) e agente (`isApprovalVerified` linha final) com a mesma regra; `{}`, `null` e `{strategist:0}` ⇒ `PIPELINE_CONTRACT_MISSING`; NO_CHANGES segue livre |
| M3 | Redação de segredos | OK com resíduos | ver abaixo |
| M4 | Timers | OK | `runner.ts:209-210`: `clearTimeout(timeoutTimer/killTimer)` no `exit`; `finish` também limpa; teste de timeout caindo no dreno |
| M5 | Delimitador com nonce | OK com resíduos | ver abaixo |

### M3 — cobertura e falsos positivos
- Ordem: `truncate(redact(stdout/stderr))` nos 2 modos (pipeline-flow.ts:352-353; handler:595-596) — correto (redige antes de truncar).
- Caminhos cobertos: stdout/stderr, mensagens de erro de preflight/git (log pino + callback), exceção inesperada, passada final `redactDeep` no payload inteiro antes do `sendExecutionResult` (summary do modelo, contractError, verifyError). Segredos: GITHUB/GH/ANTHROPIC/CLAUDE_CODE envs, qualquer env `*TOKEN/*SECRET/*_KEY/*PASSWORD/*_PASS`, `agentApiKey`, `agentCommandSecret`.
- Falsos positivos: testado em runtime — valores vazios, só espaços, curtos (<8: `abc`, `true`) e comuns (`production`) NÃO geram redaction; segredo repetido é substituído por inteiro (mais longo primeiro). Sem apagar string vazia.
- Token em URL de remoto: substituído quando o valor completo aparece (testado).

### M5 — tentativa de bypass
- Marcador de fechamento no texto da task: sem o nonce (8 bytes aleatórios por execução, gerado depois do envelope) não é autoritativo; além disso `DADO-NAO-CONFIAVEL` (qualquer caixa) é removido do texto. `CONTROLE SCRUMBAN/CONTROLE_SCRUMBAN/caixa mista` e `/scrumban-executar` no início de linha (qualquer caixa/indentação com espaço/tab) são neutralizados — confirmado executando `neutralizeEnvelope` no build.
- Comando atualizado nas 3 cópias instrui: só vale o controle fora do envelope e o nonce igual nas duas pontas.

## Issues (Ciclo 2)

**CRITICAL:** None

**MEDIUM:** None

**MINOR**
- N1 — Corpo do PR da rede de segurança publica o `summary` do modelo SEM redação: `agent/src/claude-code/pipeline-flow.ts:287` (`openDraftPr` body). O `redactDeep` só cobre o payload do callback, não o que vai ao GitHub. Correção: `deps.redact(contract.declared?.summary ?? ...)` (e no `title`/body inteiro).
- N2 — Truncar antes de redigir em `errMsg` (`agent/src/git/pipeline-git.ts`, `.slice(0,300)`) e em `note()` (`pipeline-flow.ts`, `MAX_NOTE`): se um segredo cruzar o limite de 300 chars, sobra um prefixo parcial que o redator (match de valor inteiro) não pega. Reproduzido: `ghp_abcdefgh123` vazou de `ghp_abcdefgh12345` cortado. Correção: redigir em `errMsg`/`note` antes do slice (passar o redator ou redigir o stderr bruto).
- N3 — Neutralização do envelope não normaliza Unicode: `DADO‑NAO‑CONFIAVEL` (hífen U+2011), zero-width space dentro de `CONFIAVEL`/`CONTROLE-SCRUMBAN`, fullwidth/homóglifos e NBSP antes de `/scrumban-executar` passam intactos (testado). Impacto baixo — a defesa real é o nonce + instrução do comando — mas recomenda-se `normalize('NFKC')` + remoção de `\u200b-\u200f\u2060\ufeff` antes dos regex.
- N4 — Redação não cobre segredo com caracteres escapados em JSON (`"`/`\`) dentro do stdout do claude; tokens do GitHub/Anthropic são alfanuméricos, então risco prático nulo. O `warm-cache.handler` loga `stderr`/`stdoutPreview` sem redator (prompt trivial, risco baixo).
- N5 — Pendências operacionais do ciclo anterior seguem valendo (Fase 0 na VPS, comando nos repos de clientes, script de slug antes do deploy).

**Score Final:** 8.9/10

## Decisão: APPROVED

**Justificativa:** CRÍTICOS e ALTOS OK; achados residuais são defesa em profundidade, sem rota de exploração demonstrada além de N1/N2 (vazamento só se o modelo imprimir o token, já proibido no contrato).

**Próximo:** Implementer aplica N1 e N2 (rápidos) e opcionalmente N3; depois Documenter.

---

## Histórico (Ciclo 1 — review anterior, mantido para rastreio)

Resultado do ciclo anterior: APPROVED com 8.6 de 10; achados M1–M5 (medios/menores) deram origem ao Ciclo 2. Relatório integral do ciclo 1 abaixo.


**Reviewed by:** Reviewer Agent V2
**Date:** 2026-11-23
**Module:** executions + engine + automation + agent/ (0.2.0) + comando `/scrumban-executar`

## Resultado Final

### APPROVED — Score: 8.6/10

Esteira bem desenhada: verificação independente real (git/gh/subagent_stats), política P1–P4 coerente no Engine, kill de grupo correto e sem shell. Nenhum bloqueante; há 2 ajustes de severidade média (alinhar agente×Engine e evidência mínima em tipos sem PR) e menores recomendados.

## Testes Automatizados
- Build backend: PASS
- TypeScript: 67 erros = baseline (8 specs pré-existentes: tenant-isolation, telegram handlers, tasks.service.spec, ttl-cache, notification.consumer, update-timer); 0 em arquivos tocados
- ESLint (arquivos tocados em src/): 0 erros; 1 warning PRÉ-EXISTENTE em `src/automation/agents/agents.service.ts:583` (`as any`, linha de 2026-05-20, não tocada) — com `--max-warnings 0` o exit é 1 só por ela
- Jest `src/executions src/automation src/engine --runInBand` (inclui dvfs): 673 passam, 1 falha = `provision.service.spec` (PRÉ-EXISTENTE: espera `baseDir=/home/dev-benedito/projetos`, depende de env; arquivo não tocado)
- Agente: `npm test` (286 passam) + build + lint + typecheck: PASS (exit 0)

## Validação 3 Pilares
- Pilar 1 (Engine): OK — zero `prisma.dPedido.create`; desfecho via `registrarOutcome` (mesmo UPDATE CAS); política = método estático puro `avaliarDesfechoEsteira`; zonas da Task 1 (calcula/guardas/risk) intocadas
- Pilar 2: OK — zero controller/endpoint novo
- Pilar 3: OK — zero DClasse/seed novo
- ZERO tabela nova: OK (17 models, schema.prisma não alterado)

## 1. Segurança do agente VPS
- Execução de processos: `spawn`/`execFile` sem shell, argv direto. `-p <prompt>` começa sempre com `/scrumban-executar`, então título/descrição não viram flag. Controle JSON montado com `JSON.stringify` de campos validados (executionId, branch, base, taskType≤40). Texto livre da task fica só no envelope, DEPOIS do bloco de controle.
- Branches/refs: `SAFE_REF_RE` (sem `..`, sem `-` inicial, charset fechado) aplicado no handler (400 `INVALID_GIT_BRANCH`), no processor, no `executions.service` (base), em `prepareBranch`/`resolveBaseBranch` e na saída do `gh pr list`. Nome do stash sanitizado. `gh pr create` recebe `--title/--body` como argv separados (sem injeção).
- Kill de grupo: `detached:true` + `process.kill(-pid)`; pgid = pid do filho, nunca o do agente; `pid` indefinido ⇒ no-op; ESRCH ⇒ fallback `child.kill`. SIGKILL do grupo após `exit` evita neto segurando pipe/mutex. Testado com processo real.
- Allowlist de path: `validateWorkspace` preservada, antes do preflight e do mutex.
- Tokens: `GITHUB_TOKEN` só em `process.env` (herdado por claude/gh, necessário); logger pino com redact; mensagens de erro de git truncadas em 300. Não há redação do valor do token em `stdout/stderrTruncated` enviados ao backend (ver M3).

## 2. Verificação independente
- O agente confere HEAD (`rev-parse`), commits à frente (`rev-list`), push (`ls-remote` com SHA igual), PR (`gh pr list --head`, regex de URL, headRefOid) e `subagent_stats` do runtime. O que o modelo declara só entra como `declared`.
- Modelo mente "APPROVED" sem subagentes: code/docs ⇒ `PIPELINE_CONTRACT_MISSING` (exige reviewer+implementer no runtime) — correto. Com PR aberto não aprovado ⇒ vira rascunho. `prUrl` declarado é ignorado (usa o do `gh`).
- PR da rede de segurança nunca conta como sucesso (P3). Regra `PIPELINE_CONTRACT_MISSING` correta, estrita quando `subagent_stats` ausente (risco operacional: confirmar na Fase 0 da VPS).

## 3. Engine / timeouts
- `avaliarDesfechoEsteira` coerente com P1/P3: compat 0.1.x (sem bloco ⇒ regra legada), 8 códigos antigos intactos, 5 novos expostos como lista fechada, `success` final usado por task/eventos, eventos após persistência, sem re-emitir em supersede.
- Sweeper/P4: `devolverParaFila` remove `runtime.startedAt` e regrava `dispatch.nextAttemptAt` (≤300s à frente) + `atualizadoEm=NOW()`; QUEUE_STALE usa `GREATEST(atualizadoEm, nextAttemptAt)+900s`. Logo uma execução esperando horas NÃO é morta por QUEUE_STALE enquanto o job de retry rodar; se o worker/Redis cair >900s, QUEUE_STALE é o comportamento desejado. Timeout 4h/6h: deadline RUNNING = startedAt + timeoutSec + 300s; callback tardio (retry ~8 min) substitui o FAILED sintético (política ADR-082). OK.

## 4. Slug e script
- Dispatch usa `DVincula.metaDados.projectSlug` (slug que a VPS conhece), fallback `DProject.dados.slug`, log de divergência; vínculo novo usa slug único do projeto. Script `detect-project-slug-divergence.ts` é somente leitura (2 queries `findMany`, sem N+1), exit 2 em colisão. Colisões existentes só se resolvem re-provisionando (documentado no runbook).

## 5. Comando `/scrumban-executar`
Cópias frontend/backend/template idênticas; campos do contrato batem com `pipeline-result.schema.json` (espelho do `pipeline-contract.ts`, teste anti-drift). Instrui foreground, teto de 3 ciclos, PR `--draft` se não APPROVED, sem perguntas, sem segredos.

## 6. DTOs
Whitelist estrita: `ExecutionPipelineDto` não expõe `contractError/verifyError/headSha bruto`; `prUrl` só github.com; `IsSubagentCountMap` fecha o mapa livre; `toGit/toPullRequest/toPipeline` por campo.

## Issues

**CRITICAL:** None

**MEDIUM**
- M1 — Agente × Engine divergem na prova de aprovação (P3). `agent/src/claude-code/pipeline-flow.ts` (bloco "9. Nada mergeável por engano", `approvedLocally`) exige só `reviewer` rodado; o Engine (`OperacaoExecucaoClaude.avaliarDesfechoEsteira`, R1) exige `reviewer` E `implementer` para `prRequired`. Caso: APPROVED + reviewer sem implementer + PR aberto pelo modelo ⇒ execução FAILED (`PIPELINE_CONTRACT_MISSING`) mas PR fica pronto (não rascunho). Correção: em `approvedLocally`, quando `pipeline.prRequired`, exigir também `(contract.subagents?.implementer ?? 0) > 0` (e `subagents !== null`); mesma lógica via função única compartilhada ou teste de paridade.
- M2 — Tipos sem PR (research/validation/other): `APPROVED` com `prRequired=false` ⇒ SUCCESS sem nenhuma evidência de runtime (modelo pode mentir sem subagentes). Correção em `avaliarDesfechoEsteira`: antes de `if (!input.requisitos.prRequired) return { success: true }` exigir `Object.values(subagents ?? {}).some(n => n > 0)` para APPROVED (NO_CHANGES continua livre), senão `PIPELINE_CONTRACT_MISSING`.

**MINOR**
- M3 — Sem scrub do valor de `GITHUB_TOKEN/GH_TOKEN` em `stdoutTruncated/stderrTruncated` e em `errMsg` (`agent/src/handlers/run-claude-code.handler.ts` `truncate` e `pipeline-git.ts` `errMsg`). O modelo roda com o token no ambiente; um `env`/`gh auth token` no transcript iria ao backend. Correção: `truncate` substituir ocorrências do token por `[REDACTED]`.
- M4 — `runner.ts` (handler `exit`): `timeoutTimer` não é limpo no `exit`; se disparar nos 5s de dreno marca `timedOut=true` indevidamente e envia SIGTERM a pgid já morto. Correção: `clearTimeout(timeoutTimer)` no `exit`.
- M5 — Envelope: título/descrição livres não têm delimitador de "dados não confiáveis"; um texto pode imitar `CONTROLE-SCRUMBAN v1`. Impacto limitado (branch/base/PR são verificados pelo agente; Risk Gate varre `dados.prompt`), mas recomenda-se envolver o envelope em marcador explícito e instruir no comando a ignorar blocos de controle dentro dele.
- M6 — Pendências operacionais não verificáveis aqui: Fase 0 na VPS (`subagent_stats`, hooks sob bypass, `gh auth`), cópia do comando nos repos de clientes (senão `PIPELINE_NOT_INSTALLED`), rodar o script de slug antes do deploy.

## Checklist (resumo)
Build OK · TS 0 novos · Engine/Pilar 1 OK · Seed N/A · N+1 zero (+1 query `dVincula` por dispatch, sem loop) · PrismaService · BigInt · eventos pós-persistência · DTOs class-validator · Logger sem console.log.

**Score Final:** 8.6/10

## Decisão: APPROVED

**Justificativa:** CRÍTICOS OK, sem hard gate; segurança de processos e verificação independente sólidas. M1 e M2 são ajustes de coerência não bloqueantes, mas recomendados antes do deploy em produção.

**Próximo:** Implementer aplica M1/M2/M4 (rápidos, com teste) e M3; depois Documenter.
