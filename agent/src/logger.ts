/**
 * Logger estruturado (pino) compatível com journalctl / Loki.
 *
 * Redaction de campos sensíveis é obrigatória — qualquer valor em
 * `REDACT_PATHS` é substituído por `[REDACTED]` antes de serializar.
 *
 * Levels suportados: 'error' | 'warn' | 'info' | 'debug'.
 */
import pino, { Logger, LoggerOptions } from 'pino';

/**
 * Caminhos (paths) de campos sensíveis que NUNCA podem aparecer em log.
 *
 * Inclui variações comuns: top-level, dentro de `config`, dentro de `body`,
 * dentro de `headers` (HMAC), e dentro de `payload`. Cobertura defensiva —
 * mesmo que o desenvolvedor esqueça de redactar manualmente, pino remove.
 */
const REDACT_PATHS = [
  'agentCommandSecret',
  'agentApiKey',
  'installToken',
  'signature',
  'password',
  '*.agentCommandSecret',
  '*.agentApiKey',
  '*.installToken',
  '*.signature',
  '*.password',
  'config.agentCommandSecret',
  'config.agentApiKey',
  'body.installToken',
  'body.password',
  'headers["x-signature"]',
  'headers.x-signature',
  'payload.installToken',
  'payload.password',
];

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Cria um logger pino com redaction de secrets aplicada.
 *
 * @param level Nível de log mínimo (default: 'info').
 * @returns Instância de Logger pino pronta para uso.
 *
 * @example
 *   const logger = createLogger('info');
 *   logger.info({ agentId: '123' }, 'agente iniciado');
 *   logger.info({ agentApiKey: 'segredo' }, 'config carregada');
 *   // → "agentApiKey":"[REDACTED]"
 */
export function createLogger(level: LogLevel = 'info'): Logger {
  const options: LoggerOptions = {
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    base: {
      service: 'scrumban-agent',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return pino(options);
}

/**
 * Lista de paths redactados, exportada para inspeção em testes.
 */
export const REDACTED_PATHS = REDACT_PATHS;
