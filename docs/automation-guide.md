# Automation Guide - F13

## Endpoints

- `POST /agents/install-token`: gera token one-shot para instalar agent.
- `POST /agents/install`: consome token e retorna `agentApiKey` e `agentCommandSecret` uma unica vez.
- `POST /agents/:id/heartbeat`: heartbeat autenticado com `X-Agent-*`.
- `GET /projects/:id/agent/status`: status operacional dos agents vinculados.
- `POST /projects/:id/execute`: cria execution via `OperacaoExecucaoClaude`.
- `GET /executions`: lista executions com cursor e filtros.
- `POST /executions/:id/approve`: aprova MEDIUM/HIGH em `awaiting_approval`.
- `POST /executions/:id/reject`: rejeita execution pendente.
- `GET /automation/metrics`: resumo operacional da automacao.

## Seguranca

- Nenhuma API aceita shell string livre.
- Runtime remoto usa payload estruturado: `executable`, `args`, `cwd`, `env`, `timeoutMs`.
- `AgentAuthGuard` valida agent id, key HMAC, timestamp de 5 minutos, nonce anti-replay e rate limit de 30 req/min.
- Logs e eventos passam por sanitizacao de chaves sensiveis: `token`, `apiKey`, `secret`, `key`, `password`, `authorization`, `privateKey`, `ssh`.
- Output de runtime e limitado a 1MB em `DEvento` e em `DPedido.dados.claude`.

## Estados

- `-514`: queued
- `-515`: awaiting approval
- `-516`: approved
- `-518`: running
- `-519`: success
- `-520`: failed
- `-521`: expired
- `-522`: rolled back

## Observabilidade

`GET /automation/metrics` retorna:

- agents online/offline;
- ultimo heartbeat;
- contagem de executions por status;
- p95 de fila e runtime;
- falhas por agent.

O dashboard de Flow Metrics tambem inclui o resumo `automation` para leitura operacional sem chamadas extras da UI.
