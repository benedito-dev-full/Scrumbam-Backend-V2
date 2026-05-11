# ADR-V2-012: Webhooks outbound: HMAC-SHA256, retry 3x, auto-disable

**Status:** Aceito (implementado em F12)
**Data:** 2026-05-10
**Decisores:** Implementer Agent V2 + Reviewer Agent V2
**Tags:** #V2 #fase-F12 #webhooks #security #reliability

---

## Contexto e Problema

O Scrumban-Backend-V2 precisa notificar sistemas externos sobre eventos (ex: task criada, status alterado). Isso requer um mecanismo de outbound webhooks que seja:
1. **Seguro:** Garantir que o receptor possa validar a origem (Scrumban) e o conteúdo não tenha sido alterado.
2. **Resiliente:** Lidar com instabilidades no receptor sem perder eventos e sem sobrecarregar o Scrumban.
3. **Escalável:** Processar milhares de eventos de forma assíncrona.
4. **Protegido:** Evitar ataques de SSRF (Server-Side Request Forgery) onde um usuário mal-intencionado configura uma URL interna do Scrumban.

## Alternativas Consideradas

### Opção 1: Dispatch Síncrono (REJEITADA)
- Enviar o HTTP request direto no `EventRouter`.
- **Problema:** Se o receptor estiver lento, trava a thread do worker/servidor. Falhas perdem o evento.
- **Impacto:** Baixa performance e zero confiabilidade.

### Opção 2: BullMQ + Dispatch Direto (REJEITADA)
- Enfileirar e enviar, mas sem assinatura robusta ou proteção SSRF.
- **Problema:** Vulnerável a SSRF e ataques de replay.
- **Impacto:** Risco de segurança alto.

### Opção 3: BullMQ + HMAC + SSRF Guard + Retry Exponencial (ESCOLHIDA)
- Uso de BullMQ para assincronismo.
- HMAC-SHA256 para assinatura.
- `WebhooksSsrfService` para validar URLs.
- Retentativas (3x) com backoff exponencial.
- Auto-desabilitação após 10 falhas consecutivas.
- **Prós:** Segurança máxima, alta resiliência e observabilidade clara.

## Decisão

**Escolhemos:** Opção 3 — BullMQ + HMAC + SSRF Guard + Retry Exponencial

### Componentes de Segurança

| Componente | Mecanismo | Motivação |
|------------|-----------|-----------|
| **Assinatura** | HMAC-SHA256 | Padrão de mercado (GitHub/Stripe). Garante integridade e autenticidade. |
| **Proteção SSRF** | Deny-list + DNS Resolution | Impede chamadas para `localhost`, IPs privados (10.x, 192.168.x) e Cloud Metadata. |
| **Criptografia** | AES-256-GCM | Secrets de webhooks são armazenados criptografados no banco de dados. |
| **Truncamento** | Limite 256KB | Evita estouro de memória no processador e na fila se o payload for excessivo. |

### Política de Resiliência

1. **Retries:** 3 tentativas com delays de 1min, 5min e 30min.
2. **Circuit Breaker (Auto-disable):** Após 10 eventos falharem (esgotando os 3 retries cada), o webhook é marcado como `disabled: true`.
3. **Timeout:** 10 segundos por tentativa.

## Consequências

### Positivas

1. **Segurança:** Proteção robusta contra SSRF e garantia de origem via HMAC.
2. **Estabilidade:** BullMQ isola o tráfego de saída do fluxo principal da aplicação.
3. **Transparência:** Histórico de tentativas gravado em `DEvento` (idClasse=-491).
4. **Auto-cura:** Webhooks mortos param de consumir recursos automaticamente.

### Negativas

1. **Complexidade:** Requer BullMQ/Redis e múltiplos serviços de suporte (Signing, SSRF, Retry).
2. **Diferença de Timezone:** O uso de `new Date().toISOString()` em vez de `TimezoneService` foi notado no review (dívida técnica para F14).

## Implementação

### Fase F12 — Webhooks Outbound

Arquivos criados/modificados:
- `src/webhooks/services/webhooks-hook.service.ts` — Hook dinâmico no EventRouter
- `src/webhooks/processors/webhook-dispatch.processor.ts` — Worker BullMQ com lógica central
- `src/webhooks/services/webhooks-signing.service.ts` — AES-256-GCM + HMAC-SHA256
- `src/webhooks/services/webhooks-ssrf.service.ts` — Validador de URLs e IPs
- `src/webhooks/services/webhooks-retry.service.ts` — Cálculo de delays e threshold
- `docs/webhooks-guide.md` — Documentação técnica para consumidores

### Validação (DoD F12)

- [x] Proteção SSRF bloqueia `http://localhost/` e `169.254.169.254` (Testado via Unit Tests)
- [x] Assinatura HMAC-SHA256 validada com receptor fake
- [x] Retentativas BullMQ agendadas corretamente após falha HTTP
- [x] Auto-disable ativado após 10 falhas consecutivas
- [x] Truncamento de 256KB funciona para payloads grandes

---

## Referências

- **ADR-V2-008:** DEvento substitui DNotification e DWebhook
- **Pilar 2 (Endpoints):** WebhooksController específico
- **Código:**
  - `src/webhooks/processors/webhook-dispatch.processor.ts`
  - `src/webhooks/services/webhooks-ssrf.service.ts`
- **Docs:**
  - `workspace/implementations/impl-webhooks-bloco-d-task12.md`
  - `workspace/reviews/review-webhooks-bloco-d-task12.md`
  - `docs/webhooks-guide.md`
