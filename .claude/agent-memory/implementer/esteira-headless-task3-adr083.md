# Esteira headless na VPS — ADR-V2-083 (Task 3, 2026-11-23)

- Modo esteira = execução criada em modo PROMPT (taskId). COMMAND/HÍBRIDO seguem modo simples. P1: TODOS os tipos
  exigem `/scrumban-executar`; `prRequired` só code/docs. `dados.git.branch = scrumban/exec-<chave>` (chave de `op.nova()`).
- Desfecho: `OperacaoExecucaoClaude.avaliarDesfechoEsteira` (static pura) + `_aplicarResultadoEsteira` no MESMO UPDATE CAS.
  `RegistrarOutcomeResult` ganhou `success`/`reason` — callers usam o do Engine, NUNCA `dto.success`.
- Callback sem bloco `pipeline` (agente 0.1.x) ⇒ regra legada (compat prometida no plano).
- `toOutcome`: system ⇒ 13 códigos; agent ⇒ só os 5 PIPELINE_*/PR_NOT_CREATED (teste antigo "agent+TIMEOUT ⇒ null" intacto).
- Busy por TEMPO: `busySince` no job + `dispatch.firstBusyAt`; fallback agora. `isBusyWaitExhausted`.
- Slug do dispatch = DVincula(-185).metaDados.projectSlug (precisa `dVincula` no mock do processor spec).
- GOTCHA: `forbidNonWhitelisted` não desce em mapa livre ⇒ validador custom `IsSubagentCountMap`.
- GOTCHA: risk gate NL HIGH casa "de produção" — envelope não pode ter "(de|da|em) produção", "credenciais", "refactor", "migration".
- Agente: runner virou `spawn(detached)` + `spawnInProcessGroup` exportado (teste REAL com /bin/sh: neto + pgrep).
  Mutação do SIGKILL pós-exit derruba 4 testes. Fixtures `AgentConfig` precisam `pipelineTimeoutMaxSec` + `prFallback`.
- CLI 2.1.330: `--json-schema` + `--max-turns=1` ⇒ `error_max_turns` exit 1 COM cache ⇒ warmer conta sucesso.
- Template `agent/templates/` (schema JSON gerado do TS via dist + `$comment`); teste anti-drift compara backend/frontend.
- Pré-existentes: provision.service.spec (1 falha), tsc 67 em specs, warning any em agents.service.ts:583.
- Ciclo 2 (review 8.6): M1 regra única `isApprovalVerified` (paridade com Engine), M2 APPROVED sem PR exige ≥1 subagente,
  M3 `security/redact.ts` (redigir ANTES de truncar + `redactDeep` no payload), M4 clearTimeout no exit, M5 envelope em
  bloco DADO-NAO-CONFIAVEL com nonce + `neutralizeEnvelope`. Script de mutação reaproveitável: muta→jest→restaura.
- Ciclo 3: REDIGIR ANTES DE CORTAR em todo lugar (note/errMsg/truncate); redigir stdout bruto antes do parse (summary limpo
  na fonte, vai p/ corpo de PR); envelope NFKC + strip \p{Cf} + \p{Zs}→espaço antes dos regex; warm-cache com redator.
  GOTCHA teste: posicionar o token cruzando o corte (índice 294 p/ corte 300) senão a mutação não pega o vazamento parcial.
