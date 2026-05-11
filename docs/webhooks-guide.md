# Guia de Webhooks Outbound — Scrumban V2

Os webhooks do Scrumban V2 permitem que seu sistema receba notificações em tempo real quando eventos ocorrem. Cada webhook é assinado digitalmente para garantir autenticidade e integridade.

## Configuração via API

Para criar um novo webhook, utilize o endpoint `POST /webhooks`:

```bash
curl -X POST http://localhost:3000/webhooks \
  -H "Authorization: Bearer <seu-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "123",
    "url": "https://seu-servidor.com/webhook",
    "events": ["task.created", "task.status_changed"]
  }'
```

**Importante:** O `secret` plaintext é retornado apenas uma vez no momento da criação. Você deve armazená-lo com segurança para validar as assinaturas.

## Validação de Assinatura

Toda entrega de webhook contém o header `X-Webhook-Signature` no formato `sha256=<hex-digest>`.

### Exemplo em Node.js

```javascript
const crypto = require('crypto');

function verifyWebhook(req, secret) {
  const signature = req.headers['x-webhook-signature'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  // O payload deve ser a string bruta do body (raw body)
  const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}
```

## Headers Enviados

| Header | Descrição |
|--------|-----------|
| `Content-Type` | Sempre `application/json` |
| `X-Webhook-Signature` | Assinatura HMAC-SHA256 do payload |
| `X-Webhook-Event` | Tipo do evento que disparou o webhook |
| `X-Webhook-Delivery` | UUID único da entrega (útil para idempotência) |
| `User-Agent` | `Scrumban-Webhooks/1.0` |

## Ciclo de Vida e Resiliência

1. **Retentativas:** Em caso de falha (timeout ou status diferente de 2xx), o Scrumban tentará entregar novamente 3 vezes com intervalos exponenciais (1min, 5min, 30min).
2. **Auto-disable:** Se um webhook falhar consecutivamente por 10 eventos diferentes (após todas as retentativas de cada evento se esgotarem), ele será desabilitado automaticamente.
3. **Redrive:** Você pode reabilitar um webhook desabilitado através do endpoint `/redrive`.

## Teste e Monitoramento

- Use `POST /webhooks/:id/test` para enviar um payload sintético e validar sua integração.
- Use `GET /webhooks/:id/attempts` para listar o histórico recente de entregas e erros.
