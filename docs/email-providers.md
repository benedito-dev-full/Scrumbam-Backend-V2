# Configuração de Email Providers

Guia completo para configurar cada provider de email no Scrumban-Backend-V2.

## Índice

1. [SMTP (Desenvolvimento)](#smtp-desenvolvimento)
2. [SendGrid (Produção)](#sendgrid-produção)
3. [Resend (Alternativa Moderna)](#resend-alternativa-moderna)
4. [Mock (CI/CD)](#mock-cicd)
5. [Tabela Comparativa](#tabela-comparativa)

---

## SMTP (Desenvolvimento)

### Setup Local com MailHog

**MailHog** é um servidor SMTP de desenvolvimento que captura emails em uma UI web.

#### Iniciar MailHog via Docker

```bash
docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

- **Porta SMTP:** 1025 (recebe emails)
- **UI Web:** http://localhost:8025 (acesso aos emails capturados)

#### Configurar Variáveis de Ambiente

Criar `.env` (ou `.env.local`):

```bash
# Email Provider
EMAIL_PROVIDER=smtp
EMAIL_FROM=dev@example.com

# SMTP Configuration
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=           # (vazio para MailHog)
SMTP_PASS=           # (vazio para MailHog)
SMTP_TLS=false       # MailHog não usa TLS
EMAIL_MOCK=false
```

#### Testar

```bash
npm run start:dev
```

Enviar um email (via endpoint ou direto no service):

```typescript
await this.emailService.sendTemplate(
  'welcome',
  { name: 'Teste', loginUrl: 'http://localhost:3000' },
  'test@example.com'
);
```

Verificar em http://localhost:8025 — email deve aparecer instantaneamente.

---

### SMTP Produção (Gmail, SendGrid SMTP, etc.)

Se usar SMTP em produção (não recomendado para escala, mas possível):

#### Gmail (com App Password)

1. Ativar 2FA em https://myaccount.google.com/security
2. Criar App Password em https://myaccount.google.com/apppasswords
3. Configurar `.env`:

```bash
EMAIL_PROVIDER=smtp
EMAIL_FROM=seu-email@gmail.com

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-app-password    # (16 caracteres gerada pelo Gmail)
SMTP_TLS=true
```

#### AWS SES (SMTP)

1. Criar credenciais SMTP em AWS SES console
2. Configurar `.env`:

```bash
EMAIL_PROVIDER=smtp
EMAIL_FROM=seu-email@example.com

SMTP_HOST=email-smtp.us-east-1.amazonaws.com  # Trocar region
SMTP_PORT=587
SMTP_USER=AKIAIOSFODNN7EXAMPLE               # Credential username
SMTP_PASS=BIje7...+Fc7bIje7...+Fc7bIje7     # Credential password (copiar completo)
SMTP_TLS=true
```

**Nota:** AWS SES requer verificação de domínio ou sender address.

---

## SendGrid (Produção)

**SendGrid** é o padrão recomendado para produção. Oferece ótima entregabilidade, webhooks de delivery, e suporte 24/7.

### Setup

#### 1. Criar Conta SendGrid

1. Acessar https://app.sendgrid.com/
2. Registrar conta (free tier: 100 emails/dia)
3. Confirmar email de verificação

#### 2. Gerar API Key

1. Menu: Settings → API Keys → Create API Key
2. Selecionar "Full Access" ou permissões específicas
3. Copiar chave (salvar em local seguro)

#### 3. Verificar Sender Address

1. Menu: Sender Verification (ou Sender Authentication)
2. Adicionar email que será remetente
3. Confirmar via link no email enviado

**Importante:** Sem sender verificado, emails não são entregues.

#### 4. Configurar Variáveis de Ambiente

```bash
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxo   # (sua chave)
EMAIL_FROM=noreply@empresa.com                                              # (sender verificado)
```

#### 5. Testar

```bash
curl -X POST https://api.sendgrid.com/v3/mail/send \
  -H "Authorization: Bearer $SENDGRID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "personalizations": [{"to": [{"email": "seu-email@example.com"}]}],
    "from": {"email": "noreply@empresa.com"},
    "subject": "Teste SendGrid",
    "content": [{"type": "text/plain", "value": "Teste"}]
  }'
```

Resposta `202 Accepted` = email foi aceito pela SendGrid.

Verificar caixa de entrada (pode levar alguns segundos).

### Webhooks de Delivery (Opcional)

Para rastrear bounces, spam complaints e delivery:

1. Menu: Settings → Mail Send → Event Webhook
2. URL de webhook: `https://seu-dominio.com/api/v1/email/webhooks/sendgrid`
3. Eventos: `Delivered`, `Bounce`, `Spam Report`, `Unsubscribe`

**Nota:** Implementação de webhook é feature future (F7).

---

## Resend (Alternativa Moderna)

**Resend** é uma alternativa moderna ao SendGrid, com setup mais simples e ótima experiência de dev.

### Setup

#### 1. Criar Conta Resend

1. Acessar https://resend.com/
2. Registrar via GitHub ou email
3. Confirmar email

#### 2. Gerar API Key

1. Dashboard → API Keys → Create
2. Copiar chave (começa com `re_`)

#### 3. Configurar Domínio (Produção)

Para produção, verificar domínio:

1. Dashboard → Domains → Add Domain
2. Adicionar DNS records conforme instruções
3. Esperar validação (5-30 minutos)

Para desenvolvimento, usar sender `onboarding@resend.dev` (temporário).

#### 4. Configurar Variáveis de Ambiente

Desenvolvimento:

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxo
EMAIL_FROM=onboarding@resend.dev   # (temporário, para desenvolvimento)
```

Produção:

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxo
EMAIL_FROM=noreply@seu-dominio.com  # (seu domínio verificado)
```

#### 5. Testar

```bash
npm install resend
```

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const response = await resend.emails.send({
  from: process.env.EMAIL_FROM,
  to: 'seu-email@example.com',
  subject: 'Teste Resend',
  html: '<p>Teste</p>'
});

console.log(response);
```

---

## Mock (CI/CD)

Para testes e pipelines de CI, ativar modo mock:

```bash
EMAIL_MOCK=true
```

### Comportamento

- **Nenhum email é enviado** — requisições para provider são ignoradas
- **Logs estruturados** — mensagens são logadas via `LoggingInterceptor`
- **Auditoria normal** — eventos ainda são registrados em `DEvento`
- **Ideal para** — testes de integração, GitHub Actions, CI/CD sem custos

### Logs

Com `EMAIL_MOCK=true`, todo envio é logado:

```
[EmailService] Mock email: { to: 'test@example.com', subject: 'Welcome', template: 'welcome' }
```

Capturar em testes:

```typescript
import { spyOn } from 'jest';

it('deve enviar email de boas-vindas', async () => {
  const logSpy = spyOn(console, 'log');
  
  await service.sendTemplate('welcome', { name: 'João' }, 'joao@example.com');
  
  expect(logSpy).toHaveBeenCalledWith(
    expect.stringContaining('Mock email')
  );
});
```

---

## Tabela Comparativa

| Aspecto | SMTP (MailHog) | SendGrid | Resend | Mock |
|--------|--------|----------|--------|------|
| **Setup** | 1 comando Docker | 5 min (criar API key) | 5 min (criar API key) | Variável ENV |
| **Custo** | Grátis | Grátis (100/dia), $9/mês (1k/dia) | Grátis (100/dia), $20/mês (unlimited) | Grátis |
| **Entregabilidade** | N/A (local) | Excelente (maior provider) | Excelente (novo, moderno) | N/A (teste) |
| **Webhooks** | Não | Sim (delivery, bounce, spam) | Sim (delivery, bounce) | Não |
| **Domínio próprio** | N/A | Sim (SPF, DKIM, CNAME) | Sim (SPF, DKIM) | N/A |
| **Suporte** | Community | 24/7 email/chat | Email, Slack | N/A |
| **Melhor para** | Desenvolvimento local | Produção de escala | Produção moderna | CI/CD, testes |

---

## Recomendações por Ambiente

### Desenvolvimento Local

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_MOCK=false
```

Usar com `docker run mailhog/mailhog`.

### Staging / CI

```bash
EMAIL_PROVIDER=sendgrid  # ou resend
SENDGRID_API_KEY=...     # chave de teste/staging
EMAIL_MOCK=false
```

Usar conta SendGrid/Resend de staging (domínio de teste).

### Produção

```bash
EMAIL_PROVIDER=sendgrid  # recomendado
SENDGRID_API_KEY=...     # chave de produção
EMAIL_FROM=noreply@seu-dominio.com
```

Com domínio verificado, webhooks ativados, monitoria de bounce/complaint.

### CI/CD Pipeline

```bash
EMAIL_MOCK=true
```

Sem custos, sem I/O externo, testes rápidos.

---

## Troubleshooting

### "Provider not configured" error

Verificar `EMAIL_PROVIDER` em `.env` e variáveis do provider:

```bash
# SMTP
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS

# SendGrid
SENDGRID_API_KEY

# Resend
RESEND_API_KEY
```

### Emails não estão sendo entregues (SendGrid/Resend)

1. Verificar **sender** — precisa estar verificado/autenticado
2. Verificar **destinatário** — existe e está correto
3. Verificar **spam folder** — pode estar lá
4. Ver logs de **bounce/complaint** no dashboard

### MailHog não está recebendo emails

1. Verificar `SMTP_HOST=localhost` e `SMTP_PORT=1025`
2. Verificar container Docker rodando: `docker ps | grep mailhog`
3. Verificar UI em http://localhost:8025

### Erros de conexão SMTP

- **"Connection refused"** — container SMTP não está rodando ou porta errada
- **"Authentication failed"** — credenciais SMTP incorretas
- **"TLS error"** — `SMTP_TLS=false` para MailHog, `SMTP_TLS=true` para Gmail/AWS SES

---

## Próximos Passos

- **F7 (Eventos):** Integrar BullMQ para fila de emails e retry automático
- **Webhooks:** Implementar listener para eventos de delivery (bounce, complaint, unsubscribe)
- **Templates HTML:** Adicionar templates com CSS inlined para melhor compatibilidade
- **Rate Limiting:** Implementar rate limit por usuário/domínio

---

Ver também: `src/email/README.md` — guia operacional do módulo email
