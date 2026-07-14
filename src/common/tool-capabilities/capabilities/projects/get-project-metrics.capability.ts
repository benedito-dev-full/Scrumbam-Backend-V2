import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { DashboardService } from '../../../../flow-metrics/services/dashboard.service';
import { PeriodInput } from '../../../../flow-metrics/helpers/period-resolver';
import { ForecastQueryDto } from '../../../../forecast/dto/forecast-query.dto';
import { ForecastService } from '../../../../forecast/forecast.service';
import { ProjectsService } from '../../../../projects/projects.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** Periodos pre-definidos aceitos pelo PeriodResolver. */
const PERIOD_ENUM = ['today', 'week', 'month'] as const;
/** Formato YYYY-MM-DD (espelha PeriodInput.periodFrom/periodTo). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GetProjectMetricsCapability` — capability neutra `get_project_metrics`
 * (Onda 3, reads so-MCP).
 *
 * Casca fina READ-ONLY que AGREGA dois services de dominio (Pilar 2) — a
 * MESMA composicao que o wrapper legado MCP
 * (`src/mcp/tools/get-project-metrics.tool.ts`) ja faz:
 *  - `DashboardService.getDashboard` — cycleTime/leadTime/throughput/wipAge/cfd
 *    (SEMPRE retornado).
 *  - `ForecastService.forecast` — Monte Carlo p50/p75/p85/p95 (opcional,
 *    controlado por `includeForecast`; historico insuficiente vira
 *    `forecast: null` + `forecastError`, NUNCA falha a capability).
 *
 * Tenant isolation (ADR-V2-042): `accessibleProjectIds` via
 * `ProjectsService.findAccessibleProjectIds`; `projectId` fora do scope lanca
 * `NotFoundException` identica a "projeto nao encontrado" (anti-enumeration).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 3 (projects-read)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class GetProjectMetricsCapability implements Capability {
  readonly name = 'get_project_metrics';
  readonly description =
    'Retorna flow metrics de um projeto (cycleTime, leadTime, throughput, wipAge, cfd) e, opcionalmente, forecast Monte Carlo (p50/p75/p85/p95 em dias). Se historico insuficiente, forecast vem null. Read-only.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string', description: 'ID do projeto (chave DProject)' },
      period: {
        type: 'string',
        enum: [...PERIOD_ENUM],
        description:
          'Periodo pre-definido (opcional, mutuamente exclusivo com periodFrom/periodTo).',
      },
      periodFrom: {
        type: 'string',
        description: 'Data inicial YYYY-MM-DD (opcional, par com periodTo).',
      },
      periodTo: {
        type: 'string',
        description: 'Data final YYYY-MM-DD (opcional, par com periodFrom).',
      },
      includeForecast: {
        type: 'boolean',
        default: true,
        description:
          'Quando true, tenta anexar forecast Monte Carlo. Se historico insuficiente, forecast=null + forecastError; NUNCA falha a tool.',
      },
      historicalPeriods: {
        type: 'integer',
        minimum: 1,
        maximum: 12,
        description:
          'Forecast: numero de periodos historicos (1-12, default 4). Ignorado se includeForecast=false.',
      },
      iterations: {
        type: 'integer',
        minimum: 100,
        maximum: 50000,
        description:
          'Forecast: iteracoes Monte Carlo (100-50000, default 10000). Ignorado se includeForecast=false.',
      },
    },
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly forecastService: ForecastService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Retorna flow metrics (sempre) + forecast (opcional, tolerante a
   * historico insuficiente) de um projeto acessivel.
   *
   * @param input - `{ projectId, period?, periodFrom?, periodTo?, includeForecast?, historicalPeriods?, iterations? }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ projectId, dashboard, forecast, forecastError? }`.
   * @throws {CapabilityError} `INVALID_INPUT` quando algum parametro e invalido.
   * @throws {import('@nestjs/common').NotFoundException} Projeto nao acessivel.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const projectId = this.requiredString(input, 'projectId');
    this.assertBigIntParseable(projectId, 'projectId');

    const period = this.parsePeriod(input.period);
    const periodFrom = this.parseDateString(input.periodFrom, 'periodFrom');
    const periodTo = this.parseDateString(input.periodTo, 'periodTo');
    const includeForecast = this.parseBoolean(input.includeForecast, 'includeForecast');
    const historicalPeriods = this.parseIntInRange(
      input.historicalPeriods,
      'historicalPeriods',
      1,
      12,
    );
    const iterations = this.parseIntInRange(input.iterations, 'iterations', 100, 50000);

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );
    if (!accessibleProjectIds.includes(projectId)) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    const periodInput: PeriodInput = {
      ...(period !== undefined ? { period } : {}),
      ...(periodFrom !== undefined ? { periodFrom } : {}),
      ...(periodTo !== undefined ? { periodTo } : {}),
    };

    const dashboard = await this.dashboardService.getDashboard(BigInt(projectId), periodInput);

    let forecast: unknown = null;
    let forecastError: string | undefined;

    if (includeForecast !== false) {
      const forecastQuery: ForecastQueryDto = {
        ...(historicalPeriods !== undefined ? { historicalPeriods } : {}),
        ...(iterations !== undefined ? { iterations } : {}),
      };
      try {
        forecast = await this.forecastService.forecast(BigInt(projectId), forecastQuery);
      } catch (e) {
        if (e instanceof BadRequestException) {
          forecastError = 'historico insuficiente para forecast';
        } else {
          throw e;
        }
      }
    }

    return {
      data: {
        projectId,
        dashboard,
        forecast,
        ...(forecastError ? { forecastError } : {}),
      },
    };
  }

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
  }

  private assertBigIntParseable(value: string, field: string): void {
    try {
      BigInt(value);
    } catch {
      throw new CapabilityError('INVALID_INPUT', `${field}: valid bigint string expected`, {
        field,
      });
    }
  }

  private parsePeriod(raw: unknown): (typeof PERIOD_ENUM)[number] | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'string' || !(PERIOD_ENUM as readonly string[]).includes(raw)) {
      throw new CapabilityError('INVALID_INPUT', 'period: one of: today, week, month', {
        field: 'period',
      });
    }
    return raw as (typeof PERIOD_ENUM)[number];
  }

  private parseDateString(raw: unknown, field: string): string | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
      throw new CapabilityError('INVALID_INPUT', `${field}: date string YYYY-MM-DD expected`, {
        field,
      });
    }
    return raw;
  }

  private parseBoolean(raw: unknown, field: string): boolean | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'boolean') {
      throw new CapabilityError('INVALID_INPUT', `${field}: boolean expected`, { field });
    }
    return raw;
  }

  private parseIntInRange(
    raw: unknown,
    field: string,
    min: number,
    max: number,
  ): number | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
      throw new CapabilityError(
        'INVALID_INPUT',
        `${field}: integer between ${min} and ${max} expected`,
        { field },
      );
    }
    return raw;
  }
}
