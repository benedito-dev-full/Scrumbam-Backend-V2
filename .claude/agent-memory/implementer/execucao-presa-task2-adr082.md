# Execuções presas em RUNNING — ADR-V2-082 (Task 2, 2026-11-23)

- Desfecho terminal SEMPRE via Engine com CAS + `baixado=true`: `registrarOutcome` (aceita sem outcome OU
  outcome.source='system'; supersedes calculado NO SQL via CASE), `encerrarPorFalhaSistemica`, `devolverParaFila`,
  `static encerrarVencidas` (UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED) RETURNING), `static sqlDadosFalhaSistemica`.
- Use `dados->'audit'->'outcome' IS NULL` em raw SQL (evita operador `?` do jsonb).
- GOTCHA: HttpExceptionFilter global DESCARTA campos extras do body — só statusCode/code/message/error + `details`
  (objeto, adicionado na Task 2). Contrato estruturado de erro → `code` + `details`.
- GOTCHA: HttpException tem `status` privado → subclasse não pode declarar `status` (usei `httpStatus`).
- GOTCHA zsh: `$FILES` não faz word-split no zsh → `xargs npx eslint`.
- Status V3 da task = `dados.v3.state` (leitura batch via prisma.dTask.findMany).
- Mock de execute modo PROMPT sobe p/ MEDIUM (guarda ADR-V2-081) — não asserte enqueue nesse caso.
- Mutação com remoção de linha costuma virar erro TS (noUnusedLocals) → mutar com `&& Date.now() < 0`.
- Pré-existentes: execute-task.integration (2 testes stale pós-ad7590b), provision.service.spec (baseDir), tsc 67 em specs.
- Backfill: prisma/scripts/ fora do tsconfig include → typecheck com tsconfig isolado (erros PDFKit são artefato).
- Ciclo 2: anti-duplicata com `pg_advisory_xact_lock(hashtext('exec-task:<id>'))` em $transaction (markRunning e
  execute/withTaskLock — lock segura 1 conexão, Engine usa outras e commita antes do lock soltar). Mocks de
  $transaction precisam `tx.$executeRaw`. Marcador `v3.movedBy=system:execution-<id>` = prova de origem do FAILED
  sintético (promoção FAILED→DONE só com ele). Sweeper cobre QUEUED/APPROVED órfãs (QUEUE_STALE, 900s).
- Mutação no zsh: passar múltiplos specs com `${=VAR}`; método privado sem uso vira TS6133 (mutar o corpo, não a chamada).
- Teste de tempo <50ms do risk-gate oscila em paralelo → validar `--runInBand`.
