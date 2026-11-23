# Risk Gate avalia o prompt (modo PROMPT) — ADR-V2-081 (2026-11-23)

- Validador DVFS chave 3 v2 (`src/engine/dvfs/risk-gate-validator.js`): fontes command+prompt; legados no texto bruto,
  NL PT/EN no texto normalizado (NFD). Contrato: `scannedSources:['command','prompt']`, `validatorVersion: 2`,
  `matchedPatterns[].source`. Nunca grava o trecho casado (prompt não vaza na resposta).
- Engine `OperacaoExecucaoClaude._aplicarGuardasModoPrompt()`: dados.prompt presente + script sem 'prompt' em
  scannedSources → ≥MEDIUM (drift DVFS). Env `RISK_GATE_PROMPT_FLOOR=MEDIUM|HIGH` = piso de emergência. Só eleva.
- GOTCHA: qualquer mock de risk script em teste de modo PROMPT precisa declarar `scannedSources` com 'prompt',
  senão a guarda eleva para MEDIUM e "LOW → enfileira" quebra.
- GOTCHA: DvfsLoaderHelper não filtra `versao` — NUNCA bumpar versao no dvfs.seed (2 linhas ativas). Seed não roda no boot.
- GOTCHA: force push NL precisa `--force(?![-\w])` senão `prisma db push --force-reset` (MEDIUM dos 58) vira HIGH.
- Pré-existente (2026-11): specs com drift de construtor (ExecutionsService 9 params / ApprovalFlow 5 / processor 6)
  não compilam; tsc --noEmit tinha 80 erros em specs; hook usa `eslint --ext` (inválido em flat config → no-op).
- Sem node_modules na máquina: `npm ci` + `npx prisma generate` (sem postinstall que toque banco); sem backend/.env.
- Ciclo 2 (M1/M2): clean() = NFKC + strip invisíveis antes de TODO padrão; norm() = clean + lower + NFD.
- GOTCHA FERRAMENTA: Write/Edit/Bash convertem a sequência barra-u-XXXX em caractere literal. Para escapes Unicode
  em .js/.ts gerar via python com chr(92)+'u'+hex; em testes usar String.fromCharCode. Há teste que barra literais.
- GOTCHA: teste de tempo (<50ms) flaky com workers paralelos do jest — usar melhor-de-N (bestOfMs).
- Ciclo 3: INVISIBLE_RE = \p{Cf} + fillers Hangul (flag u ok: loader faz eval("("+conteudo+")") em Node 20).
  norm(): LF simples→espaço (lookahead [ \t]{0,64}, NUNCA \s* — O(n²)); ". minúscula"→espaço; parágrafo/lista/". Maiúscula" = barreira.
- Prática que o Reviewer cobra: teste de mutação (desligar a correção → testes falham) e citar no relatório.
