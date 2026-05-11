# Automation Security Runbook

## Principios

- Fail closed em runtime remoto.
- Sem shell string livre.
- Sem rollback destrutivo na branch principal.
- Segredos nunca devem aparecer em logs, eventos ou responses depois do install.

## Comandos

Executions aceitam somente comando estruturado validado por `CommandValidatorService`.

Proibido:

- `sh -c`
- pipe, redirect, subshell
- path absoluto ou `..` em `cwd`
- env com nomes ou valores aparentando segredo

## Replay e rate limit

Requests do agent exigem:

- `X-Agent-Nonce`
- `X-Agent-Timestamp`
- janela maxima de 5 minutos
- nonce unico por agent por 10 minutos
- 30 req/min por agent

Redis e usado quando `REDIS_URL` esta configurado. Sem Redis, ha fallback in-memory por processo para dev/test.

## Sanitizacao

Campos redigidos automaticamente em eventos/logs:

- `token`
- `apiKey`
- `secret`
- `key`
- `password`
- `authorization`
- `privateKey`
- `ssh`

Verificacao local:

```bash
rg -n "agentApiKey|agentCommandSecret|installToken|authorization|privateKey|password" logs dist src
```

## Rollback

Rollback automatico so roda dentro do `RollbackService` e apenas quando:

- a execution usou worktree isolada;
- a branch tem prefixo `scrumban/exec-*`;
- `rollbackOnFailure=true`.

Rollback manual legado em `/executions/:id/rollback` falha fechado.

## GitHub App

Antes de habilitar PR automatico:

1. Configurar `GITHUB_APP_ID`.
2. Configurar `GITHUB_APP_PRIVATE_KEY`.
3. Configurar `GITHUB_INSTALLATION_ID`.
4. Confirmar que `dados.automation.remoteRepoUrl` aponta para o repo esperado.
5. Confirmar que PR so abre para `head=scrumban/exec-*` e base nao usa esse prefixo.

Falha do GitHub nao apaga logs nem altera branch principal; vira auditoria em `DEvento -496`.

## Incidentes

Se suspeitar de vazamento de agent key:

1. Parar o processo do agent.
2. Remover vinculo project-agent se nao houver execution ativa.
3. Reinstalar agent com token novo.
4. Auditar `DEvento -496` e `/automation/metrics`.
