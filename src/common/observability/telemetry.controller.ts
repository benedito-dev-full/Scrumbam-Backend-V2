import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AuthCompositeGuard } from '../../auth/guards/auth-composite.guard';
import { AllowOrphan } from '../../auth/decorators/allow-orphan.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { SkipTenantCheck } from '../../auth/decorators/skip-tenant-check.decorator';
import { MetricsService, MetricsSnapshot } from './metrics.service';
import { AuthZombieDto } from './dto/auth-zombie.dto';

/** Janela do rate limit do beacon público (ms). */
const BEACON_WINDOW_MS = 60_000;

/** Máximo de beacons aceitos por IP dentro da janela. */
const BEACON_MAX_PER_WINDOW = 20;

/** Teto de IPs rastreados simultaneamente (proteção de memória). */
const BEACON_MAX_TRACKED_IPS = 5_000;

/**
 * Controller de telemetria (F0 — Observabilidade).
 *
 * Duas rotas, nenhuma delas muda comportamento de auth:
 *
 * | Rota | Auth | Uso |
 * |---|---|---|
 * | `POST /telemetry/auth-zombie` | `@Public()` | Beacon do frontend — mede o sintoma A (aba zumbi) |
 * | `GET /telemetry/metrics` | JWT | Snapshot dos contadores deste processo |
 *
 * **Por que o beacon é público:** o usuário no estado zumbi, por definição,
 * **não tem access token** — exigir auth tornaria o contador impossível de
 * coletar justamente no caso que ele existe para medir.
 *
 * **Proteção contra abuso** (o endpoint é anônimo):
 * 1. Payload mínimo — `AuthZombieDto` com um único boolean, e o ValidationPipe
 *    global (`forbidNonWhitelisted`) rejeita qualquer chave extra.
 * 2. Rate limit em memória — 20 beacons/min por IP. Acima disso o request é
 *    descartado silenciosamente (ainda responde 204) e um contador
 *    `telemetry.auth_zombie.rate_limited` registra o excedente.
 * 3. Nada de PII: só `hadRefreshToken`, IP e UA truncado. **Nunca** token.
 *
 * @see MetricsService — emissão e agregação dos contadores
 * @see AuthZombieDto — payload do beacon
 */
@ApiTags('telemetry')
@Controller('telemetry')
@SkipTenantCheck() // ADR-V2-042: telemetria não é recurso tenant-scoped.
export class TelemetryController {
  private readonly logger = new Logger(TelemetryController.name);

  /** Rate limit em memória: IP → { janela, contagem }. */
  private readonly beaconHits = new Map<string, { windowStart: number; count: number }>();

  constructor(private readonly metrics: MetricsService) {}

  /**
   * Recebe o beacon de estado zumbi do frontend.
   *
   * Incrementa `frontend.auth_zombie` — a **medida direta do sintoma A**.
   * Depois da Fase 2 do plano, este contador deve ir a ZERO.
   *
   * Responde 204 sempre (fire-and-forget) — inclusive quando o rate limit
   * descarta o beacon. O frontend nunca deve travar por causa de telemetria.
   *
   * @param dto - `{ hadRefreshToken: boolean }` (payload mínimo)
   * @param req - Request Express (usado só para IP e User-Agent)
   *
   * @example
   * ```bash
   * curl -X POST "https://api.scrumban.com.br/api/v1/telemetry/auth-zombie" \
   *   -H "Content-Type: application/json" \
   *   -d '{"hadRefreshToken":true}'
   * # 204 No Content
   * ```
   */
  @Post('auth-zombie')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Beacon de estado zumbi do frontend (F0 — observabilidade)',
    description:
      'Cookie de sessão presente + accessToken ausente após rehydrate. Público por necessidade: ' +
      'o usuário zumbi não tem token. Rate limit de 20/min por IP; payload mínimo.',
  })
  @ApiResponse({ status: 204, description: 'Beacon registrado (ou descartado por rate limit)' })
  authZombie(@Body() dto: AuthZombieDto, @Req() req: Request): void {
    const ip = this.clientIp(req);

    if (!this.allowBeacon(ip)) {
      this.metrics.increment('telemetry.auth_zombie.rate_limited', { ip }, { silent: true });
      return;
    }

    this.metrics.increment(
      'frontend.auth_zombie',
      {
        hadRefreshToken: dto.hadRefreshToken,
        ip,
        ua: this.userAgent(req),
      },
      { level: 'warn' },
    );
  }

  /**
   * Retorna o snapshot dos contadores **deste processo**.
   *
   * Atalho para extração do baseline. A fonte durável continua sendo o log
   * (o snapshot zera a cada restart e é por réplica — some as réplicas).
   *
   * @returns Contadores acumulados desde o boot do processo
   *
   * @example
   * ```bash
   * curl -s "https://api.scrumban.com.br/api/v1/telemetry/metrics" \
   *   -H "Authorization: Bearer $TOKEN" | jq .counters
   * ```
   */
  @Get('metrics')
  @UseGuards(AuthCompositeGuard)
  @AllowOrphan()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Snapshot dos contadores de observabilidade (por processo)',
    description:
      'Contadores em memória desde o boot. Zeram no restart e são por réplica — ' +
      'a fonte durável do baseline é o log estruturado (campo `metric`).',
  })
  @ApiResponse({ status: 200, description: 'Snapshot de contadores' })
  getMetrics(): MetricsSnapshot {
    return this.metrics.getSnapshot();
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Rate limit de janela fixa por IP (20/min). Em memória e por processo —
   * suficiente para impedir flood de log vindo de um cliente anônimo.
   */
  private allowBeacon(ip: string): boolean {
    const now = Date.now();

    // Poda simples: se estourou o teto de IPs rastreados, limpa janelas velhas.
    if (this.beaconHits.size > BEACON_MAX_TRACKED_IPS) {
      for (const [key, entry] of this.beaconHits) {
        if (now - entry.windowStart > BEACON_WINDOW_MS) {
          this.beaconHits.delete(key);
        }
      }
      // Ainda cheio (ataque distribuído) → derruba tudo e recomeça a janela.
      if (this.beaconHits.size > BEACON_MAX_TRACKED_IPS) {
        this.beaconHits.clear();
        this.logger.warn('Rate limit do beacon: mapa de IPs reiniciado (excesso de origens)');
      }
    }

    const entry = this.beaconHits.get(ip);
    if (!entry || now - entry.windowStart > BEACON_WINDOW_MS) {
      this.beaconHits.set(ip, { windowStart: now, count: 1 });
      return true;
    }

    entry.count += 1;
    return entry.count <= BEACON_MAX_PER_WINDOW;
  }

  /** IP do cliente (respeita proxy reverso via X-Forwarded-For). */
  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = raw?.split(',')[0]?.trim();
    return first || req.ip || 'unknown';
  }

  /** User-Agent truncado (dimensão de log permitida; não é PII sensível). */
  private userAgent(req: Request): string {
    return (req.headers['user-agent'] ?? 'unknown').slice(0, 120);
  }
}
