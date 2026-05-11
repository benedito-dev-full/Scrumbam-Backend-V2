export type ProductionReadinessSeverity = 'error' | 'warning';

export interface ProductionReadinessIssue {
  key: string;
  severity: ProductionReadinessSeverity;
  message: string;
}

const MIN_STRONG_SECRET_LENGTH = 32;
const WEAK_SECRET_PATTERNS: RegExp[] = [
  /^change[-_ ]?me/i,
  /^replace[-_ ]?me/i,
  /^changeme/i,
  /^secret$/i,
  /^password$/i,
  /^example$/i,
  /^dev[-_ ]?secret/i,
  /^test[-_ ]?secret/i,
  /^default$/i,
  /^1234+$/,
];

function isBlank(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

function isWeakSecret(value: string | undefined): boolean {
  if (isBlank(value)) {
    return true;
  }

  const normalized = (value ?? '').trim();
  if (normalized.length < MIN_STRONG_SECRET_LENGTH) {
    return true;
  }

  return WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isUnsafeLocalEndpoint(value: string | undefined): boolean {
  if (isBlank(value)) {
    return true;
  }

  const normalized = (value ?? '').trim().toLowerCase();
  return (
    normalized.includes('localhost') ||
    normalized.includes('127.0.0.1') ||
    normalized.includes('0.0.0.0') ||
    normalized.includes('change-me')
  );
}

function pushRequired(
  issues: ProductionReadinessIssue[],
  key: string,
  value: string | undefined,
  message: string,
): void {
  if (isBlank(value)) {
    issues.push({ key, severity: 'error', message });
  }
}

function pushWeakSecret(
  issues: ProductionReadinessIssue[],
  key: string,
  value: string | undefined,
): void {
  if (isWeakSecret(value)) {
    issues.push({
      key,
      severity: 'error',
      message: `${key} ausente, fraco ou placeholder. Use um segredo forte e unico em producao.`,
    });
  }
}

function pushUnsafeEndpoint(
  issues: ProductionReadinessIssue[],
  key: string,
  value: string | undefined,
  message: string,
): void {
  if (isBlank(value)) {
    return;
  }

  if (isUnsafeLocalEndpoint(value)) {
    issues.push({ key, severity: 'error', message });
  }
}

function formatIssues(issues: ProductionReadinessIssue[]): string {
  return issues.map((issue) => `- [${issue.severity}] ${issue.key}: ${issue.message}`).join('\n');
}

export function validateProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ProductionReadinessIssue[] {
  if (env.NODE_ENV !== 'production') {
    return [];
  }

  const issues: ProductionReadinessIssue[] = [];

  pushRequired(issues, 'DATABASE_URL', env.DATABASE_URL, 'DATABASE_URL e obrigatoria em producao.');
  pushRequired(issues, 'CORS_ORIGIN', env.CORS_ORIGIN, 'CORS_ORIGIN e obrigatoria em producao.');
  pushRequired(issues, 'REDIS_URL', env.REDIS_URL, 'REDIS_URL e obrigatoria em producao.');

  pushWeakSecret(issues, 'JWT_SECRET', env.JWT_SECRET);
  pushUnsafeEndpoint(
    issues,
    'DATABASE_URL',
    env.DATABASE_URL,
    'DATABASE_URL nao pode apontar para localhost/127.0.0.1 em producao.',
  );
  pushUnsafeEndpoint(
    issues,
    'CORS_ORIGIN',
    env.CORS_ORIGIN,
    'CORS_ORIGIN nao pode apontar para localhost/127.0.0.1 em producao.',
  );
  pushUnsafeEndpoint(
    issues,
    'REDIS_URL',
    env.REDIS_URL,
    'REDIS_URL nao pode apontar para localhost/127.0.0.1 em producao.',
  );

  if (env.EMAIL_ENABLED === 'true') {
    pushRequired(
      issues,
      'EMAIL_PROVIDER',
      env.EMAIL_PROVIDER,
      'EMAIL_PROVIDER e obrigatorio quando EMAIL_ENABLED=true.',
    );

    switch ((env.EMAIL_PROVIDER ?? '').toLowerCase()) {
      case 'sendgrid':
        pushRequired(
          issues,
          'SENDGRID_API_KEY',
          env.SENDGRID_API_KEY,
          'SENDGRID_API_KEY e obrigatoria quando EMAIL_PROVIDER=sendgrid.',
        );
        break;
      case 'resend':
        pushRequired(
          issues,
          'RESEND_API_KEY',
          env.RESEND_API_KEY,
          'RESEND_API_KEY e obrigatoria quando EMAIL_PROVIDER=resend.',
        );
        break;
      case 'smtp':
        pushRequired(
          issues,
          'SMTP_HOST',
          env.SMTP_HOST,
          'SMTP_HOST e obrigatorio quando EMAIL_PROVIDER=smtp.',
        );
        pushUnsafeEndpoint(
          issues,
          'SMTP_HOST',
          env.SMTP_HOST,
          'SMTP_HOST nao pode apontar para localhost/127.0.0.1 em producao com EMAIL_ENABLED=true.',
        );
        break;
      default:
        issues.push({
          key: 'EMAIL_PROVIDER',
          severity: 'error',
          message: 'EMAIL_PROVIDER deve ser smtp, sendgrid ou resend.',
        });
        break;
    }
  }

  if (env.TELEGRAM_ENABLED === 'true') {
    pushRequired(
      issues,
      'TELEGRAM_BOT_TOKEN',
      env.TELEGRAM_BOT_TOKEN,
      'TELEGRAM_BOT_TOKEN e obrigatorio quando TELEGRAM_ENABLED=true.',
    );
    pushRequired(
      issues,
      'TELEGRAM_WEBHOOK_SECRET',
      env.TELEGRAM_WEBHOOK_SECRET,
      'TELEGRAM_WEBHOOK_SECRET e obrigatorio quando TELEGRAM_ENABLED=true.',
    );
  }

  if (env.AUTOMATION_ENABLED === 'true') {
    pushRequired(
      issues,
      'GITHUB_APP_ID',
      env.GITHUB_APP_ID,
      'GITHUB_APP_ID e obrigatorio quando AUTOMATION_ENABLED=true.',
    );
    pushRequired(
      issues,
      'GITHUB_APP_PRIVATE_KEY',
      env.GITHUB_APP_PRIVATE_KEY,
      'GITHUB_APP_PRIVATE_KEY e obrigatoria quando AUTOMATION_ENABLED=true.',
    );
    pushRequired(
      issues,
      'GITHUB_INSTALLATION_ID',
      env.GITHUB_INSTALLATION_ID,
      'GITHUB_INSTALLATION_ID e obrigatorio quando AUTOMATION_ENABLED=true.',
    );
  }

  if (env.MCP_ENABLED === 'true') {
    pushWeakSecret(issues, 'MCP_KEY', env.MCP_KEY);
  }

  return issues;
}

export function assertProductionReady(env: NodeJS.ProcessEnv = process.env): void {
  const issues = validateProductionEnvironment(env);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length === 0) {
    return;
  }

  const message =
    'Ambiente de producao nao esta pronto:\n' +
    formatIssues(errors) +
    '\nCorrija as variaveis acima antes de iniciar a aplicacao.';

  throw new Error(message);
}
