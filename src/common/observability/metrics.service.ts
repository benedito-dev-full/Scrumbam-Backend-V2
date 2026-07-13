import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

/** Níveis de log aceitos por {@link MetricsService.increment}. */
export type MetricLevel = 'log' | 'warn' | 'error' | 'debug';

/** Valor permitido em um campo de métrica (nunca objeto — a linha deve ser rasa). */
export type MetricFieldValue = string | number | boolean | null | undefined;

/** Dimensões (labels) de uma métrica. NUNCA inclua token, hash, senha ou PII. */
export type MetricFields = Record<string, MetricFieldValue>;

/** Opções de emissão. `silent: true` conta sem gerar linha de log (alta frequência). */
export interface MetricOptions {
  level?: MetricLevel;
  silent?: boolean;
}

/** Snapshot dos contadores acumulados no processo. */
export interface MetricsSnapshot {
  pid: number;
  uptimeSeconds: number;
  since: string;
  counters: Record<string, number>;
}

/** Intervalo do flush periódico do snapshot agregado (ms). */
const SNAPSHOT_INTERVAL_MS = 60_000;

/** Tamanho máximo de um valor string em um campo de métrica. */
const MAX_FIELD_LENGTH = 200;

/**
 * Fragmentos de nome de campo que NUNCA podem ser logados (defesa em
 * profundidade — o chamador já não deve enviá-los).
 */
const FORBIDDEN_FIELD_FRAGMENTS = [
  'token',
  'hash',
  'senha',
  'password',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
];

/**
 * Serviço de métricas por **log estruturado** (F0 — Observabilidade).
 *
 * O projeto NÃO tem Prometheus/OpenTelemetry (verificado: nenhum `prom-client`
 * nem exporter em `package.json`; o único agregador é o log do container).
 * Portanto a estratégia canônica aqui é: **uma linha JSON por evento**, com o
 * campo `metric` como discriminador — o que torna cada contador consultável por
 * `grep`/`jq` ou por qualquer coletor de log (Dokploy/Loki/CloudWatch).
 *
 * Formato da linha (nível `log`/`warn` conforme criticidade):
 * ```json
 * {"metric":"auth.refresh.revoke_all","count":3,"ts":"2026-07-13T12:00:00.000Z","userGroupId":"42","ip":"1.2.3.4"}
 * ```
 *
 * Dois modos de emissão:
 * - **Evento** (default): incrementa o contador **e** emite a linha. Use em
 *   sinais raros/críticos (`auth.refresh.revoke_all`, `auth.401`, `http.5xx`).
 * - **Silencioso** (`{ silent: true }`): apenas incrementa o contador em memória.
 *   Use em sinais de altíssima frequência (cache hit/miss) — eles aparecem no
 *   snapshot agregado emitido a cada 60 s como `metric: "metrics.snapshot"`.
 *
 * Os contadores em memória são **por processo** e zeram no restart. A fonte de
 * verdade durável para o baseline de 48 h é o **log** — o snapshot é atalho.
 *
 * REGRA DE OURO: esta classe NUNCA pode derrubar um request. Todo call-site usa
 * chamada opcional (`this.metrics?.increment(...)`) e este método não lança.
 *
 * @see TelemetryController — expõe `GET /telemetry/metrics` (snapshot) e
 *   `POST /telemetry/auth-zombie` (beacon do frontend)
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Metrics');

  /** Contadores acumulados desde o boot do processo. */
  private readonly counters = new Map<string, number>();

  /** Instante do boot (usado no snapshot). */
  private readonly startedAt = new Date();

  private snapshotTimer?: NodeJS.Timeout;

  /** `true` quando houve incremento desde o último flush (evita linha inútil). */
  private dirty = false;

  /**
   * Agenda o flush periódico do snapshot agregado.
   *
   * Desativado em `NODE_ENV=test` (evita timer pendurado em Jest) e quando
   * `METRICS_SNAPSHOT=false`.
   */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.METRICS_SNAPSHOT === 'false') {
      return;
    }

    this.snapshotTimer = setInterval(() => this.flush(), SNAPSHOT_INTERVAL_MS);
    // unref: o timer não deve segurar o event loop no shutdown.
    this.snapshotTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  /**
   * Incrementa um contador e (por padrão) emite a linha estruturada.
   *
   * NUNCA lança — falha de observabilidade não pode virar falha de request.
   *
   * @param metric - Nome canônico do contador (ex: `auth.refresh.reuse_detected`)
   * @param fields - Dimensões rasas e não-sensíveis (`userGroupId`, `ip`, `reason`, `code`)
   * @param options - `level` (default `log`) e `silent` (default `false`)
   *
   * @example
   * ```typescript
   * this.metrics?.increment('auth.refresh.revoke_all',
   *   { userGroupId: '42', ip: '1.2.3.4', reason: 'reuse_detected' },
   *   { level: 'warn' },
   * );
   * ```
   */
  increment(metric: string, fields: MetricFields = {}, options: MetricOptions = {}): void {
    try {
      const count = (this.counters.get(metric) ?? 0) + 1;
      this.counters.set(metric, count);
      this.dirty = true;

      if (options.silent) {
        return;
      }

      const line = JSON.stringify({
        metric,
        count,
        ts: new Date().toISOString(),
        ...this.sanitize(fields),
      });

      switch (options.level ?? 'log') {
        case 'warn':
          this.logger.warn(line);
          break;
        case 'error':
          this.logger.error(line);
          break;
        case 'debug':
          this.logger.debug(line);
          break;
        default:
          this.logger.log(line);
      }
    } catch {
      // Observabilidade jamais derruba o request. Silêncio intencional.
    }
  }

  /**
   * Retorna os contadores acumulados neste processo.
   *
   * Atenção: **por processo**. Com múltiplas réplicas, some os snapshots de
   * cada uma (ou use o log, que é a fonte durável).
   *
   * @returns Snapshot com pid, uptime e mapa de contadores
   */
  getSnapshot(): MetricsSnapshot {
    return {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      since: this.startedAt.toISOString(),
      counters: Object.fromEntries([...this.counters.entries()].sort()),
    };
  }

  /** Emite o snapshot agregado (uma linha) se houve movimento na janela. */
  private flush(): void {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;

    try {
      this.logger.log(
        JSON.stringify({
          metric: 'metrics.snapshot',
          ts: new Date().toISOString(),
          windowMs: SNAPSHOT_INTERVAL_MS,
          ...this.getSnapshot(),
        }),
      );
    } catch {
      // idem: nunca propaga.
    }
  }

  /**
   * Remove campos com nome suspeito de segredo e trunca strings longas.
   *
   * Defesa em profundidade — a regra primária é o call-site nunca passar
   * segredo. Aqui garantimos que um descuido futuro não vaze no log.
   */
  private sanitize(fields: MetricFields): MetricFields {
    const safe: MetricFields = {};

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) {
        continue;
      }

      // Só faz sentido redigir VALOR STRING: um segredo é sempre string. Um
      // boolean como `hadRefreshToken` (beacon do frontend) é sinal, não segredo.
      const lowered = key.toLowerCase();
      if (
        typeof value === 'string' &&
        FORBIDDEN_FIELD_FRAGMENTS.some((fragment) => lowered.includes(fragment))
      ) {
        safe[key] = '[redacted]';
        continue;
      }

      safe[key] =
        typeof value === 'string' && value.length > MAX_FIELD_LENGTH
          ? `${value.slice(0, MAX_FIELD_LENGTH)}…`
          : value;
    }

    return safe;
  }
}
