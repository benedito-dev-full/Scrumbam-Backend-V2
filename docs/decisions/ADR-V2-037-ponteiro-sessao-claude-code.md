# ADR-V2-037 — Ponteiro de sessão Claude Code (`claudeSessionId`) para chat-with-VPS futuro

**Status:** Aceito
**Data:** 2026-05-12
**Decisores:** CEO (requisito 2026-05-12 — porta aberta para chat-with-VPS), Strategist Agent V2 (proposta), Implementer V2 (execução Sub-tarefas 4 do plan-task1 e 2.4/2.5 do plan-task2)
**Tags:** `#V2` `#F13` `#automation` `#claude-code` `#session` `#chat-with-vps` `#future-proofing`

> **Nota de numeração:** este ADR foi planejado como `ADR-V2-032` no `plan-automation-agent-v2-client-task1.md`, mas o número 032 já estava ocupado (`ADR-V2-032-devento-excluido-notifications.md`). Promovido para **037** para preservar unicidade. Referências cruzadas no plano e em commits que mencionam "ADR-V2-032 (ponteiro de sessão)" devem ser lidas como "ADR-V2-037". Documentos derivados (ADR-V2-033 §(c) e §(d), e este ADR) já foram revisados para apontar para o novo número.

---

## Contexto e Problema

O Claude Code CLI (≥ 2.1.139), quando invocado em modo não-interativo (`claude -p "<prompt>" --output-format json`), retorna um objeto JSON com um campo `session_id` (snake_case, UUID v4). A sessão é persistida em disco no host como `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` — formato Newline-Delimited JSON com toda a conversação (prompts, respostas, tool calls).

Spike CLI da Sub-tarefa 4 confirmou esse shape em produção. Documentado em `.claude/agent-memory/implementer/claude_session_extraction.md`.

CEO trouxe requisito adicional em 2026-05-12: **num futuro próximo, o frontend Scrumban deve listar, continuar e streamar sessões Claude Code que rodaram na VPS** (feature interna chamada "chat-with-VPS"). Não vamos implementar a feature agora, mas o **protocolo HTTP+HMAC e o modelo de dados** precisam nascer já com os ganchos certos para evitar refactor.

Decisões técnicas necessárias para a porta aberta:
1. Como o agente extrai `session_id`?
2. Onde o backend persiste o ponteiro?
3. Como o backend pede continuação de uma sessão existente?
4. Como o protocolo HTTP do agente acomoda comandos futuros (`LIST_CLAUDE_SESSIONS`, `READ_CLAUDE_SESSION`, `STREAM_CLAUDE_SESSION`) sem quebrar contrato?
5. O backend deve impor o `session_id` ao Claude Code (passando `--session-id <uuid>`), ou deixar o CLI gerar?

---

## Alternativas Consideradas

### Alternativa A — Backend impõe `session_id` via `--session-id <uuid>` (rejeitada no MVP)

Backend gera UUID v4, persiste em `DPedido.dados.claude.sessionId` ANTES de chamar o agente, e envia `sessionId` no payload. Agente invoca `claude -p "..." --session-id <uuid> --output-format json`.

**Prós:**
- Backend tem o ID antes mesmo do agente responder — DPedido nasce com ponteiro completo.
- Permite reservar pré-execução um identificador único.

**Contras:**
- **Acopla o agente ao formato de UUID do backend.** Se o CLI mudar o formato (improvável, mas possível) ou exigir IDs com prefixo, o backend tem que mudar antes do agente.
- **Risco de colisão com sessões manuais do CEO.** Se o CEO está rodando `claude` interativamente no mesmo `cwd`, e o backend gera UUID que casa com uma sessão manual existente, o `--session-id` força resume de uma sessão errada (ou falha — comportamento CLI não documentado para colisão).
- **Viola a "passividade" do agente.** Agente deveria descobrir o ID, não impô-lo.
- **Sem ganho real no MVP** — DPedido nasce sem o ID e é atualizado em `execution-result`. A latência adicional é irrelevante para os usos atuais.

Rejeitada para MVP. Mantida como opção futura se requisito for criar sessão sem aguardar agente (ex: criar DPedido no banco e ter ID já preenchido antes da execução).

### Alternativa B — Agente extrai ID do output JSON do CLI (escolhida — primária)

Agente invoca `claude -p "<prompt>" --output-format json`, captura stdout, faz `JSON.parse`, lê `session_id` (snake_case canônico do CLI). Persistido em variável local, devolvido ao backend via `POST /agents/:id/execution-result`.

**Prós:**
- **Source of truth = CLI.** Agente reflete o que o CLI gerou, sem adivinhação.
- **Resiliente a colisões manuais** — o CLI gerencia conflitos internamente (gera novo UUID se necessário).
- **Compatível com `--resume`** — `claude -p "..." --resume <id>` continua sessão existente; ID novo (que o CLI cria como continuação) pode ou não bater com o original (CLI decide, agente não interfere).

**Contras:**
- **Frágil a mudanças no shape do output JSON.** Se o CLI futuro mudar de `session_id` para `sessionId` (camelCase), parser quebra. Mitigação: parser tolera ambos os formatos e tem fallback FS (Alternativa C abaixo).

### Alternativa C — Fallback filesystem (`~/.claude/projects/<encoded-cwd>/*.jsonl`)

Se Alternativa B falha (output JSON malformado, CLI mudou), agente lista arquivos `.jsonl` em `~/.claude/projects/<encoded-cwd>/`, pega o mais recente (mtime), extrai UUID do nome do arquivo.

**Prós:**
- **Defesa em profundidade** — mesmo que CLI quebre o output, o filesystem ainda revela a sessão.
- **Útil para debugging** — agente loga warning se cair no fallback.

**Contras:**
- **Race condition** se o CLI cria/move arquivos durante a execução. Mitigação aceita: agente espera 100ms após exit antes de listar.
- **Encoded-cwd depende do CWD passado** — agente precisa conhecer o `cwd` que ele mesmo usou. Já tem (via identity-resolver).

**Decisão final:** Alternativas B (primária) + C (fallback). Implementadas em `agent/src/claude-code/session-parser.ts` (Sub-tarefa 4). 29 specs cobrindo ambos os paths.

---

## Decisão

### (1) Extração do `session_id`

Agente invoca:

```bash
claude -p "<prompt>" \
  --output-format json \
  [--resume <resumeSessionId>]
```

com `cwd` resolvido via identity-resolver (ADR-V2-035). Captura stdout, faz `JSON.parse`, lê campo `session_id` (snake_case primário; `sessionId` camelCase como fallback se CLI futuro mudar).

Se parse falhar ou campo ausente, agente lista `~/.claude/projects/<encoded-cwd>/*.jsonl`, pega o mais recente por mtime, extrai UUID do nome do arquivo. Loga warning estruturado `claude_session_parser.fallback=filesystem`.

### (2) Persistência no backend

`POST /agents/:id/execution-result` payload (resposta do agente):

```json
{
  "executionId": "DPedido.chave",
  "exitCode": 0,
  "success": true,
  "durationMs": 12345,
  "claudeSessionId": "550e8400-e29b-41d4-a716-446655440000",
  "claudeSessionPath": "/root/.claude/projects/-home-dev-projetos-scrumban-backend-v2/550e8400-e29b-41d4-a716-446655440000.jsonl",
  "resumedFrom": null,
  "stdoutTruncated": "...",
  "stderrTruncated": "..."
}
```

Backend grava em `DPedido.dados.claude.sessionId` (camelCase no backend, mapeado pelo Engine `OperacaoExecucaoClaude` no DVFS pós-gravação chave 7). `claudeSessionPath` é gravado em `DPedido.dados.claude.sessionPath` para uso INTERNO — NUNCA exposto ao frontend.

`resumedFrom` ecoa o `resumeSessionId` recebido (ou `null`). Permite distinguir sessão nova de continuação no audit trail.

### (3) Continuação de sessão (request)

`POST /v1/execute` payload outbound (backend → agente) ganha campo opcional:

```json
{
  "type": "RUN_CLAUDE_CODE",
  "executionId": "...",
  "projectSlug": "scrumban-backend-v2",
  "idClasseRisk": -301,
  "prompt": "continue a refatoração",
  "resumeSessionId": "550e8400-e29b-41d4-a716-446655440000",
  "timeoutSec": 1800
}
```

Quando `resumeSessionId` preenchido, agente invoca `claude -p "..." --resume <id>`. Quando `null`/ausente, sessão nova.

### (4) Endpoint genérico `/v1/execute` com `type` discriminator

Endpoint do agente é desenhado como `POST /v1/execute` (HMAC validado) com `type` discriminator no body:

**MVP (Task #1):**
- `"type": "PING"` — liveness check.
- `"type": "RUN_CLAUDE_CODE"` — execução com extração de session.

**Porta aberta (NÃO implementado, design preserva o caminho):**
- `"type": "LIST_CLAUDE_SESSIONS"` — agente lista `*.jsonl` em `~/.claude/projects/<encoded-cwd>/` para um slug e devolve metadata (UUIDs, mtime, tamanho, primeiro/último prompt).
- `"type": "READ_CLAUDE_SESSION"` — agente faz `cat <uuid>.jsonl` e devolve conteúdo paginado.
- `"type": "STREAM_CLAUDE_SESSION"` — agente abre `tail -f` no `.jsonl` ativo e devolve eventos via Server-Sent Events ou WebSocket sobre o tunnel (modelagem futura).

Adicionar novos `type` no futuro **não requer novo path, middleware HMAC, ou redesenho de protocolo** — apenas novo handler interno em `dispatcher.ts`. É o "ganho da porta aberta" exigido pelo CEO.

### (5) NÃO no MVP

Explicitamente fora do escopo desta porta aberta:

- **Backend impondo `--session-id` ao Claude Code** (ver Alternativa A rejeitada).
- **Listagem de sessões via API** (`LIST_CLAUDE_SESSIONS`) — design preserva, implementação fica para feature de chat-with-VPS.
- **Leitura de `.jsonl` (`READ_CLAUDE_SESSION`)** — mesmo.
- **Streaming em tempo real (`STREAM_CLAUDE_SESSION`)** — mesmo. Não foi feito ATTACH/tail nos handlers do MVP; primeiro chamado `accepted/executionId` síncrono, depois `execution-result` async com saída truncada.
- **Frontend chat UI** — depende dos 3 comandos acima + backend endpoints que exponham `DPedido.dados.claude.sessionId` (mas NUNCA `sessionPath`).
- **Política de retenção** de `~/.claude/projects/` na VPS — débito documentado abaixo.

---

## Consequências

### Positivas

- **Future-proofing barato.** Adicionar `claudeSessionId` ao payload e ao Engine custa ~50 LOC; permite chat-with-VPS futuro sem refactor de protocolo.
- **Audit trail completo:** DEvento `agent.session.created` (idClasse=-505) e `agent.session.resumed` (idClasse=-506) são emitidos pelo backend ao processar `execution-result`. Permite consultar "quantas sessões resumed teve este projeto este mês?" via DEvento query.
- **`/v1/execute` é genérico** — adicionar comandos futuros não quebra HMAC, rate limit, nonce store ou clientes existentes.
- **`claudeSessionPath` permanece INTERNAL** — frontend nunca vê o caminho do filesystem da VPS. Apenas o `sessionId` opaco.
- **Compatibilidade com Claude Code CLI:** agente usa apenas APIs públicas do CLI (`-p`, `--output-format`, `--resume`). Nenhuma flag interna ou hack.

### Negativas (e mitigações)

- **Crescimento ilimitado de `~/.claude/projects/`** na VPS. Débito documentado:
  - **Risco:** disk full no /root partition após meses.
  - **Mitigação MVP:** logger emite warning quando diretório > N entries (não implementado ainda — Sub-tarefa 4 não cobre, mas plan-task1 §6 lista como débito).
  - **Mitigação futura:** política de retenção (ex: cron que move `.jsonl` > 90 dias para S3 frio e remove). ADR futuro quando dor surgir.
- **Fallback FS depende de mtime confiável.** Se filesystem da VPS tem clock skew ou mtime suprimido (algumas configs de NFS), fallback fica frágil. Mitigação: parser primary (Alternativa B) é o caminho de produção; fallback é raro.
- **Resume de sessão antiga pode falhar** se o CLI tiver expirado/movido o `.jsonl`. Mitigação: agente retorna `RESUME_FAILED` no `execution-result`; backend pode decidir refazer como sessão nova (UI futura).
- **`claudeSessionPath` exposto em logs do backend** se não filtrado. Mitigação: redaction explícita em `agent.execution.finished` (idClasse=-516) — DEvento payload omite `sessionPath`, mantém apenas `sessionId`.

### Neutras

- **Sem nova DClasse necessária** — DEvento -505/-506 já reservadas (Sub-tarefa 2.1 do plan-task2, ADR-V2-033 esqueleto).
- **Sem nova tabela** — ADR-V2-001 preservado. Ponteiro cabe em `DPedido.dados` (JSON).
- **Sem novo endpoint backend** — `POST /agents/:id/execution-result` já existe (criado na Sub-tarefa 2.4 do plan-task2). Apenas o shape do payload evoluiu para incluir `claudeSessionId/Path`.

---

## Validação

### Hooks de validação acionados

- `__tests__/run-claude-code.spec.ts` (Sub-tarefa 4) — 29 specs cobrindo:
  - Parse de `session_id` snake_case (caminho primário).
  - Parse de `sessionId` camelCase (fallback se CLI mudar).
  - Fallback filesystem quando JSON quebra (sem `session_id`, JSON malformado, exit code zero mas sem stdout).
  - Captura de `claudeSessionPath` (encoded-cwd correto, mtime mais recente vence empate).
  - Resume com `resumeSessionId`: agente passa `--resume <id>` para o execFile, `resumedFrom` ecoado.
- Sub-tarefa 2.4 backend (plan-task2): cenário #5 testa idempotência (`execution-result` com mesmo `executionId` repetido → 409, não duplica DPedido.dados.claude.sessionId).
- Sub-tarefa 2.5 backend: Engine `OperacaoExecucaoClaude.processarExecucaoResult()` grava `dados.claude.sessionId` em transaction; DVFS pós-gravação chave 7 confirmado.
- Audit DEvento -505/-506 confirmado emitido após gravação (não antes — ADR-V2-008 preservado).

### Gatilho de revisão

Reavaliar este ADR se:
1. **Chat-with-VPS for priorizado** — implementar `LIST_CLAUDE_SESSIONS`, `READ_CLAUDE_SESSION`, `STREAM_CLAUDE_SESSION` força revisitar política de retenção, paginação, autorização (RBAC para ler sessões de outros usuários do mesmo projeto), e expor `sessionId` no frontend.
2. **CLI mudar shape de output JSON** — atualizar parser; manter fallback FS como rede de segurança.
3. **Sessions órfãs acumularem na VPS** ao ponto de causar disk warning — política de retenção (ADR futuro).
4. **Surgir requisito de `claudeSessionId` reservado antes da execução** (ex: DPedido nasce com ID já preenchido para UI mostrar "sessão #X criada"). Reavaliar Alternativa A.

---

## Referências

- `workspace/plans/plan-automation-agent-v2-client-task1.md` §1 (requisito CEO 2026-05-12), §4 (payload RUN_CLAUDE_CODE), §5 Sub-tarefa 4 (session parser).
- `workspace/plans/plan-automation-backend-side-task2.md` §5 Sub-tarefa 2.4 (`/agents/:id/execution-result` endpoint), Sub-tarefa 2.5 (Engine `processarExecucaoResult`).
- `agent/src/claude-code/session-parser.ts` — implementação primary + fallback.
- `agent/src/claude-code/runner.ts` — invocação do CLI com `--output-format json` + `--resume`.
- `agent/src/server/dispatcher.ts` — `/v1/execute` com `type` discriminator.
- `.claude/agent-memory/implementer/claude_session_extraction.md` — spike CLI e shape do output.
- ADR-V2-001 (zero tabela nova — `sessionId` em `DPedido.dados`).
- ADR-V2-005 (Engine `OperacaoExecucaoClaude` — local de gravação).
- ADR-V2-008 (DEvento substitui DNotification — `-505/-506` para session lifecycle).
- ADR-V2-033 (contrato `/v1/execute` outbound + `execution-result` inbound — define a forma do request/response).
- ADR-V2-035 (identidade `projectSlug` + `CLAUDE.md` global — define o `cwd` que o CLI usa, que vira `encoded-cwd` no caminho do `.jsonl`).
- ADR-V2-036 (monorepo `agent/` — atomicidade backend/agente para evolução do protocolo).
