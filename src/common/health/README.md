# Health Module

Módulo de health check que fornece endpoint público `GET /api/v1/health` para monitoramento de saúde do sistema. Verifica disponibilidade de dependências críticas: banco de dados, cache Redis e serviço de email.

## Endpoint

```
GET /api/v1/health
```

**Autenticação:** Não requerida (`@Public()`)

**Use cases:**
- Load balancers: verificar readiness antes de rotear tráfego
- Monitoramento (Datadog, New Relic, Prometheus)
- Pipelines de CI/CD: verificar saúde pós-deploy
- Probes Kubernetes: liveness e readiness checks

## Response

### Status 200 OK (Sistema Saudável)

```json
{
  "status": "ok",
  "checks": {
    "db": {
      "status": "ok",
      "latencyMs": 3
    },
    "redis": {
      "status": "ok",
      "latencyMs": 1
    },
    "email": {
      "status": "ok",
      "message": "EMAIL_MOCK=true"
    }
  }
}
```

### Status 200 OK (Degradado)

Sistema está funcionando mas com avisos não-críticos:

```json
{
  "status": "degraded",
  "checks": {
    "db": {
      "status": "ok",
      "latencyMs": 5
    },
    "redis": {
      "status": "degraded",
      "message": "REDIS_URL não configurado — cache desativado"
    },
    "email": {
      "status": "ok",
      "message": "EMAIL_MOCK=true"
    }
  }
}
```

**Nota:** Status 200 mesmo com "degraded" pois o sistema continua operacional. Redis é opcional.

### Status 503 Service Unavailable (Crítico)

Banco de dados indisponível — sistema não pode operar:

```json
{
  "status": "error",
  "checks": {
    "db": {
      "status": "error",
      "message": "Connection refused: server at 127.0.0.1:5432 refused to accept the connection"
    },
    "redis": {
      "status": "ok",
      "latencyMs": 1
    },
    "email": {
      "status": "ok"
    }
  }
}
```

**Status code:** HTTP 503

## Checks Realizados

### Database (Crítico)

- **Teste:** Query `SELECT 1` via Prisma
- **Status:**
  - `ok` — resposta em < 100ms
  - `error` — timeout ou conexão recusada → HTTP 503
- **Latência:** Tempo em millisegundos

Dependência crítica. Falha = HTTP 503 (sistema indisponível).

### Redis (Opcional)

- **Teste:** PING via ioredis (se `REDIS_URL` configurado)
- **Status:**
  - `ok` — PONG recebido em < 50ms
  - `degraded` — URL não configurada (funcionalidade reduzida)
  - `error` — conexão falhou
- **Latência:** Tempo em millisegundos

Opcional para funcionamento. Falha = status "degraded" mas HTTP 200.

### Email (Informativo)

- **Teste:** Valida configuração do provider
- **Status:**
  - `ok` — provider e credenciais configurados
  - `ok + message` — modo mock ativo (`EMAIL_MOCK=true`)
- **Detalhes:** Provider ativo (smtp|sendgrid|resend)

Informativo. Não afeta status geral.

## Usar em Load Balancer

### AWS ALB (Application Load Balancer)

```yaml
TargetGroup:
  HealthCheckPath: /api/v1/health
  HealthCheckProtocol: HTTP
  HealthCheckIntervalSeconds: 30
  HealthyThresholdCount: 2
  UnhealthyThresholdCount: 3
  Matcher:
    HttpCode: "200,503"  # 503 ainda é considerado "unhealthy" por ALB
```

### Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /api/v1/health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/v1/health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2
```

## Com X-Correlation-Id

Health check respeita `X-Correlation-Id` header (se presente) e o ecoa na response:

```bash
curl -H "X-Correlation-Id: health-probe-12345" http://localhost:3000/api/v1/health -i
```

Response inclui header:

```
X-Correlation-Id: health-probe-12345
```

Útil para rastreamento de probes em logs agregados.

## Comportamento em Falhas

### DB indisponível

- Imediatamente retorna HTTP 503 (sem tentar outros checks)
- Status: "error"
- Load balancer remove instância da pool

### Redis indisponível (opcional)

- Retorna HTTP 200
- Status da resposta: "degraded" (não "error")
- Sistema continua funcionando
- Logs alertam mas não bloqueiam

### Email indisponível

- Retorna HTTP 200
- Status: "ok" ou "ok + message"
- Não afeta health check
- Se EMAIL_MOCK=true, mostra explicitamente

## Latências Aceitáveis

| Dependência | Target | Alerta | Crítico |
|------------|--------|--------|---------|
| DB | <10ms | >50ms | >500ms → error |
| Redis | <5ms | >20ms | >100ms → degraded |
| Email | N/A | N/A | N/A |

## Estrutura de Arquivos

```
src/common/health/
├── README.md                      # Este arquivo
├── health.controller.ts           # GET /health endpoint
├── health.service.ts              # Lógica de checks
├── health.service.spec.ts         # Testes unitários
└── dto/
    └── health-status.dto.ts       # DTO de response
```

## Modificar Checks

### Adicionar novo check

Editar `health.service.ts`:

```typescript
async getStatus(): Promise<HealthStatus> {
  const checks = {
    db: await this.checkDb(),
    redis: await this.checkRedis(),
    email: await this.checkEmail(),
    meuServico: await this.checkMeuServico()  // Novo
  };

  const status = Object.values(checks).some(c => c.status === 'error')
    ? 'error'
    : Object.values(checks).some(c => c.status === 'degraded')
    ? 'degraded'
    : 'ok';

  return { status, checks };
}

private async checkMeuServico(): Promise<HealthCheckResult> {
  try {
    const start = performance.now();
    await this.meuService.ping();
    const latencyMs = Math.round(performance.now() - start);
    return { status: 'ok', latencyMs };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}
```

## Perguntas Frequentes

**P: Health check está lento?**

A: Aumentar `Promise.all()` timeout em `health.service.ts` (padrão: 5s).

**P: Redis retorna degraded mas está funcionando?**

A: Verificar `REDIS_URL` em `.env`. Se vazio, serviço Redis é considerado opcional.

**P: Por que 200 quando degraded?**

A: HTTP 200 = sistema operacional. HTTP 503 = sistema crítico indisponível. Redis é cache (não crítico). DB é crítico.

**P: Load balancer remove instância em HTTP 503 — é correto?**

A: Sim. 503 = "Service Unavailable" = remova da pool. A instância não pode servir requisições sem DB.

## Ver Também

- `src/common/` — outros serviços comuns (TimezoneService, AuditService, etc.)
- `src/auth/decorators/public.decorator.ts` — por que `@Public()` é necessário
- Prometheus metrics: TBD em F7 (Eventos)
