import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Services do projeto
import { PrismaService } from '../../prisma.service';

/**
 * Status de um check individual.
 */
export interface HealthCheck {
  /** Status: 'ok' = saudável, 'degraded' = parcialmente disponível, 'error' = indisponível. */
  status: 'ok' | 'degraded' | 'error';
  /** Latência em milissegundos (disponível apenas para checks de conectividade). */
  latencyMs?: number;
  /** Mensagem descritiva (especialmente em caso de erro). */
  message?: string;
}

/**
 * Resultado agregado do health check do sistema.
 */
export interface HealthStatus {
  /** Status geral: 'ok' (tudo OK), 'degraded' (alguns serviços indisponíveis), 'error' (crítico). */
  status: 'ok' | 'degraded' | 'error';
  /** Checks individuais de cada dependência. */
  checks: {
    db: HealthCheck;
    redis: HealthCheck;
    email: HealthCheck;
  };
}

/**
 * Serviço de health check do Scrumban-Backend-V2.
 *
 * Verifica a saúde das dependências críticas:
 * - **DB**: `SELECT 1` via Prisma (verifica conectividade com PostgreSQL)
 * - **Redis**: `PING` via ioredis (verifica conectividade com Redis/BullMQ)
 * - **Email**: verificação de configuração do provider
 *
 * Lógica de status agregado:
 * - `ok` — todos os checks retornam 'ok'
 * - `degraded` — Redis não configurado (aviso, não crítico) ou email em mock
 * - `error` — DB indisponível (crítico — sistema não funciona sem DB)
 *
 * @example
 * ```typescript
 * const status = await healthService.getStatus();
 * // {
 * //   status: 'ok',
 * //   checks: {
 * //     db: { status: 'ok', latencyMs: 5 },
 * //     redis: { status: 'ok', latencyMs: 2 },
 * //     email: { status: 'ok' }
 * //   }
 * // }
 * ```
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verifica a conectividade com o banco de dados PostgreSQL.
   *
   * Executa `SELECT 1` via Prisma e mede a latência.
   * Check crítico — se falhar, o sistema está inoperante.
   *
   * @returns Promise com status e latência em ms
   *
   * @example
   * ```typescript
   * const dbCheck = await healthService.checkDb();
   * // { status: 'ok', latencyMs: 5 }
   * ```
   */
  async checkDb(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - start;
      return { status: 'ok', latencyMs };
    } catch (error) {
      this.logger.error('DB health check falhou', error instanceof Error ? error.message : String(error));
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : 'Falha ao conectar com o banco de dados',
      };
    }
  }

  /**
   * Verifica a conectividade com o Redis.
   *
   * Tenta enviar um PING ao Redis. Se `REDIS_URL` não estiver configurado,
   * retorna 'degraded' (aviso — Redis é usado pelo BullMQ mas não é crítico
   * para operação básica do sistema).
   *
   * @returns Promise com status e latência em ms
   *
   * @example
   * ```typescript
   * // Com Redis disponível
   * const redisCheck = await healthService.checkRedis();
   * // { status: 'ok', latencyMs: 2 }
   *
   * // Sem Redis configurado
   * // { status: 'degraded', message: 'REDIS_URL não configurado' }
   * ```
   */
  async checkRedis(): Promise<HealthCheck> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      return {
        status: 'degraded',
        message: 'REDIS_URL não configurado — filas BullMQ indisponíveis',
      };
    }

    const start = Date.now();
    try {
      // Importação dinâmica para evitar erro se ioredis não estiver disponível
      const { default: Redis } = await import('ioredis');
      const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 3000 });
      await redis.connect();
      await redis.ping();
      const latencyMs = Date.now() - start;
      await redis.disconnect();
      return { status: 'ok', latencyMs };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : 'Falha ao conectar com Redis',
      };
    }
  }

  /**
   * Verifica a configuração do provider de email.
   *
   * Em dev/CI com `EMAIL_MOCK=true`, retorna 'ok' sem verificação real.
   * Em prod, verifica se as variáveis do provider estão configuradas.
   *
   * @returns Promise com status do email provider
   *
   * @example
   * ```typescript
   * const emailCheck = await healthService.checkEmail();
   * // { status: 'ok' }
   * // ou { status: 'degraded', message: 'EMAIL_MOCK=true (não envia em prod)' }
   * ```
   */
  async checkEmail(): Promise<HealthCheck> {
    const isMock = this.config.get<string>('EMAIL_MOCK', 'false') === 'true';
    if (isMock) {
      return {
        status: 'ok',
        message: 'EMAIL_MOCK=true — emails logados, não enviados',
      };
    }

    const provider = this.config.get<string>('EMAIL_PROVIDER', 'smtp').toLowerCase();
    switch (provider) {
      case 'sendgrid': {
        const hasKey = !!this.config.get<string>('SENDGRID_API_KEY');
        return hasKey
          ? { status: 'ok' }
          : { status: 'degraded', message: 'SENDGRID_API_KEY não configurado' };
      }
      case 'resend': {
        const hasKey = !!this.config.get<string>('RESEND_API_KEY');
        return hasKey
          ? { status: 'ok' }
          : { status: 'degraded', message: 'RESEND_API_KEY não configurado' };
      }
      case 'smtp':
      default: {
        const host = this.config.get<string>('SMTP_HOST', 'localhost');
        return { status: 'ok', message: `SMTP host: ${host}` };
      }
    }
  }

  /**
   * Agrega os resultados de todos os health checks.
   *
   * Lógica de status agregado:
   * - Se DB em 'error' → status geral = 'error' (crítico)
   * - Se qualquer check em 'degraded' → status geral = 'degraded'
   * - Se todos 'ok' → status geral = 'ok'
   *
   * @returns Promise com status geral e checks individuais
   *
   * @example
   * ```typescript
   * const status = await healthService.getStatus();
   * if (status.status === 'error') {
   *   // Responder com HTTP 503
   * }
   * ```
   */
  async getStatus(): Promise<HealthStatus> {
    const [db, redis, email] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkEmail(),
    ]);

    const checks = { db, redis, email };
    const statuses = Object.values(checks).map((c) => c.status);

    let overallStatus: 'ok' | 'degraded' | 'error';
    if (statuses.includes('error')) {
      overallStatus = 'error';
    } else if (statuses.includes('degraded')) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'ok';
    }

    return { status: overallStatus, checks };
  }
}
