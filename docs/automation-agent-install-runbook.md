# Automation Agent Install Runbook

## Pre-requisitos

- VPS Linux com Node.js, git e Claude Code CLI instalados.
- Agent escutando apenas em loopback local.
- Reverse tunnel expondo `127.0.0.1:<tunnelPort>` no backend.
- Projeto com `dados.automation.remotePath` absoluto e isolado.
- `AGENT_KEY_PEPPER` e `AGENT_COMMAND_SECRET_ENCRYPTION_KEY` configurados no backend.

## Instalacao

1. Gerar token:

```bash
POST /agents/install-token
```

2. Instalar agent na VPS:

```bash
scrumban-agent install --backend=https://api.scrumban.app --token=<tokenPlain>
```

3. Confirmar retorno do backend:

- `agentId`
- `agentApiKey`
- `agentCommandSecret`
- `tunnelPort`

Os segredos aparecem uma unica vez e devem ser gravados localmente com permissao `0600`.

4. Confirmar heartbeat:

```bash
POST /agents/:id/heartbeat
```

5. Confirmar status:

```bash
GET /projects/:id/agent/status
```

## Revogacao

1. Remover vinculo:

```bash
DELETE /projects/:id/agent/:agentId
```

2. Encerrar tunnel e processo local na VPS.
3. Remover config local do agent.

O backend rejeita remocao quando ha execution ativa (`QUEUED`, `APPROVED`, `AWAITING_APPROVAL`, `RUNNING`).

## Rotacao de chave

Rotacao automatica fica fora da F13. Processo manual recomendado:

1. Revogar agent antigo.
2. Gerar novo install token.
3. Reinstalar agent.
4. Validar heartbeat e tunnel.

## Troubleshooting

- `401`: conferir `X-Agent-Id`, `X-Agent-Key`, timestamp e clock da VPS.
- `409`: nonce repetido; revisar retry do agent para gerar novo UUID.
- `429`: agent excedeu 30 req/min.
- `TUNNEL_UNAVAILABLE`: conferir reverse tunnel e porta alocada.
- `WORKSPACE_OUTSIDE_ALLOWED_ROOT`: conferir `dados.automation.remotePath` e `cwd`.
