# Email Module

Módulo de email com abstração de provider para envio de mensagens transacionais. Suporta múltiplos provedores: SMTP (nodemailer), SendGrid e Resend. Modo mock disponível para desenvolvimento e CI/CD.

## Configuração de Provedores

| Variável | Descrição | Padrão | Obrigatório |
|----------|-----------|--------|------------|
| `EMAIL_PROVIDER` | Provider ativo: `smtp` \| `sendgrid` \| `resend` | `smtp` | Não |
| `EMAIL_MOCK` | Se `true`, loga em vez de enviar (dev/CI) | `false` | Não |
| `EMAIL_FROM` | Endereço remetente padrão | — | Sim (se não mock) |
| `SMTP_HOST` | Host SMTP | `localhost` | Não (SMTP) |
| `SMTP_PORT` | Porta SMTP | `587` | Não (SMTP) |
| `SMTP_USER` | Usuário SMTP (pode ser vazio para localhost) | — | Não (SMTP) |
| `SMTP_PASS` | Senha SMTP (pode ser vazio para localhost) | — | Não (SMTP) |
| `SMTP_TLS` | Usar TLS (true/false) | `true` | Não (SMTP) |
| `SENDGRID_API_KEY` | API Key SendGrid | — | Sim (SendGrid) |
| `RESEND_API_KEY` | API Key Resend | — | Sim (Resend) |

## Templates Disponíveis

| Template | Variáveis esperadas | Descrição |
|----------|-------------------|-----------|
| `welcome` | `name`, `loginUrl`, `platformName` | Boas-vindas ao novo usuário |
| `password-reset` | `name`, `resetLink`, `expirationHours` | Redefinição de senha com link temporário |
| `invite` | `invitedName`, `inviterName`, `acceptLink`, `organizationName` | Convite para participar de organização |
| `notification-digest` | `name`, `notifications[]` (array com `{title, message, actionUrl}`) | Digest de notificações do período |

## Uso Básico

### Enviar Email com Template

```typescript
import { EmailService } from './email.service';

constructor(private readonly emailService: EmailService) {}

async sendWelcome(userId: string, email: string) {
  await this.emailService.sendTemplate(
    'welcome',
    {
      name: 'João Silva',
      loginUrl: 'https://app.example.com/login',
      platformName: 'Scrumban'
    },
    email
  );
}
```

### Enviar Email Customizado

```typescript
await this.emailService.send({
  to: 'user@example.com',
  subject: 'Confirmação de Pagamento',
  html: '<h1>Seu pagamento foi processado</h1>',
  replyTo: 'support@example.com'
});
```

### Com Auditoria

Todos os envios são automaticamente registrados em `DEvento` idClasse=-501 (AUDIT_GENERIC) após sucesso:

```json
{
  "type": "email.sent",
  "data": {
    "to": "user@example.com",
    "template": "welcome",
    "provider": "smtp",
    "timestamp": "2026-05-09T10:30:00Z"
  }
}
```

Falhas também são registradas:

```json
{
  "type": "email.failed",
  "data": {
    "to": "user@example.com",
    "template": "welcome",
    "error": "SMTP connection timeout",
    "provider": "smtp",
    "timestamp": "2026-05-09T10:30:00Z"
  }
}
```

## Desenvolvimento com SMTP Local

Para desenvolvimento, use **MailHog** para capturar emails localmente:

```bash
# Iniciar MailHog (HTTP UI em http://localhost:8025)
docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

No `.env`:

```
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_MOCK=false
EMAIL_FROM=dev@example.com
```

Abra http://localhost:8025 para ver todos os emails capturados.

## Modo Mock (CI/CD)

Para testes e pipelines, ative o modo mock:

```
EMAIL_MOCK=true
```

Com `EMAIL_MOCK=true`:
- Nenhum email é enviado
- Mensagens são logadas no console (veja `LoggingInterceptor`)
- Auditoria ainda é registrada em `DEvento`
- Ideal para testes de integração sem provider externo

## Produção

### SendGrid

```bash
npm install @sendgrid/mail
```

No `.env`:

```
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=noreply@empresa.com
```

### Resend (alternativa moderna)

```bash
npm install resend
```

No `.env`:

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=noreply@empresa.com
```

## Estrutura de Arquivos

```
src/email/
├── README.md                    # Este arquivo
├── email.module.ts              # Módulo NestJS
├── email.service.ts             # Lógica principal
├── email.service.spec.ts        # Testes
├── providers/
│   ├── smtp.provider.ts         # Implementação nodemailer
│   ├── sendgrid.provider.ts     # Implementação SendGrid
│   └── resend.provider.ts       # Implementação Resend
├── templates/
│   ├── welcome.template.ts      # Template boas-vindas
│   ├── password-reset.template.ts
│   ├── invite.template.ts
│   └── notification-digest.template.ts
└── dto/
    ├── send-email.dto.ts        # DTO para envio
    └── email-response.dto.ts    # DTO de resposta
```

## Adicionando Novo Template

1. Criar arquivo em `src/email/templates/meu-template.template.ts`:

```typescript
export function renderMeuTemplate(data: {
  name: string;
  customField: string;
}): { subject: string; html: string } {
  return {
    subject: `Título do Email`,
    html: `
      <h1>Olá ${data.name}</h1>
      <p>Seu campo customizado: ${data.customField}</p>
    `
  };
}
```

2. Registrar em `email.service.ts` no método `getTemplate()`:

```typescript
case 'meu-template':
  return renderMeuTemplate(variables);
```

3. Usar:

```typescript
await this.emailService.sendTemplate(
  'meu-template',
  { name: 'João', customField: 'valor' },
  'user@example.com'
);
```

## Dívidas Técnicas

- BullMQ queue para processamento assíncrono (F7 — Eventos)
- Retry automático com exponential backoff (F7)
- Template versioning com migrations (future)
- Webhook de delivery status (future)

## Ver Também

- `docs/email-providers.md` — guia completo de configuração por provider
- `src/common/` — serviços comuns (AuditService para registro de auditoria)
- `.env.example` — exemplo de configuração
