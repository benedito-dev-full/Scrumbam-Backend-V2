import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DashboardService } from '../../flow-metrics/services/dashboard.service';
import { PeriodInput } from '../../flow-metrics/helpers/period-resolver';
import { ForecastService } from '../../forecast/forecast.service';
import { ForecastQueryDto } from '../../forecast/dto/forecast-query.dto';
import { ProjectsService } from '../../projects/projects.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/** Períodos pré-definidos aceitos pelo PeriodResolver. */
const PERIOD_ENUM = ['today', 'week', 'month'] as const;
/** Formato YYYY-MM-DD (espelha PeriodInput.periodFrom/periodTo). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * MCP tool `get_project_metrics` — flow metrics + forecast de um projeto.
 *
 * Wrapper fino que AGREGA dois services de domínio (Pilar 2):
 *  - `DashboardService.getDashboard` — cycleTime/leadTime/throughput/wipAge/cfd
 *    (SEMPRE retornado).
 *  - `ForecastService.forecast` — Monte Carlo p50/p75/p85/p95 em dias
 *    (opcional, controlado por `includeForecast`).
 *
 * **UX do agente (decisão de design):** o forecast lança `BadRequestException`
 * quando o histórico de throughput é insuficiente (< 2 semanas). Esse caso é
 * CAPTURADO dentro do handler e devolvido como `forecast: null` + `forecastError`
 * — a tool NUNCA falha por isso (o dashboard continua válido). `NotFoundException`
 * do forecast (projeto inexistente) não ocorre aqui porque o gate de tenant já
 * confirmou o projeto; ainda assim, erros inesperados são re-lançados.
 *
 * **Fluxo (defense-in-depth — ADR-V2-042):**
 * 1. `requireScope(ctx, tasks:read)`. (Leituras de projeto via MCP usam
 *    `tasks:read` — não existe `projects:read`; coerente com `get_project`.)
 * 2. Valida params (`projectId` BigInt; period ∈ enum; periodFrom/To YYYY-MM-DD;
 *    includeForecast boolean; historicalPeriods 1-12; iterations 100-50000).
 * 3. Tenant gate: `findAccessibleProjectIds`; se projectId fora → 404 anti-enumeration.
 *    (Os controllers REST usam OrgTenantGuard + JWT org; o contexto MCP não tem
 *    org → a membership via `findAccessibleProjectIds` é a autoridade.)
 * 4. `getDashboard(BigInt(projectId), periodInput)` (sempre).
 * 5. Se `includeForecast !== false`: tenta `forecast(...)`, captura BadRequest.
 *
 * **Performance:** o dashboard já paraleliza seus 5 indicadores com Promise.all;
 * o CFD faz replay de eventos (pode ser custoso). ZERO N+1 (services otimizados).
 *
 * NÃO usa Engine: leitura pura sobre tabelas estruturais (DTask/DProject/DEvento).
 * Pilar 1 (Engine) só aplica em DPedido idClasse=-300 (executions transacionais).
 *
 * @see ADR-V2-042 (tenant isolation: gate + anti-enumeration)
 * @see ADR-V2-068 (scope catalog — tasks:read)
 */
@Injectable()
export class GetProjectMetricsTool implements McpTool {
  private readonly logger = new Logger(GetProjectMetricsTool.name);

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

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly forecastService: ForecastService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Retorna flow metrics (sempre) + forecast (opcional, tolerante a histórico
   * insuficiente) de um projeto acessível.
   *
   * @param params - `{ projectId, period?, periodFrom?, periodTo?, includeForecast?, historicalPeriods?, iterations? }`
   * @param ctx - Contexto do usuário MCP (resolve tenant via `dEntidadeId`)
   * @returns `McpToolResult` com `{ projectId, dashboard, forecast, forecastError? }`.
   *
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:read` ausente
   * @throws {McpToolError} INVALID_PARAMS quando algum parâmetro é inválido.
   * @throws {NotFoundException} Quando o projeto não é acessível.
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_READ);

    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    parseBigIntParam(projectId, 'projectId');

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

    // Tenant gate (ADR-V2-042): membership é a autoridade no contexto MCP.
    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );
    if (!accessibleProjectIds.includes(projectId)) {
      // Mensagem identica a projeto inexistente — anti-enumeration.
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    const periodInput: PeriodInput = {
      ...(period !== undefined ? { period } : {}),
      ...(periodFrom !== undefined ? { periodFrom } : {}),
      ...(periodTo !== undefined ? { periodTo } : {}),
    };

    this.logger.debug(
      `get_project_metrics projectId=${projectId} includeForecast=${includeForecast !== false}`,
    );

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
          // Histórico < 2 semanas: forecast indisponível, mas a tool não falha.
          forecastError = 'historico insuficiente para forecast';
        } else {
          // NotFound de projeto já barrado no gate; outros erros propagam.
          throw e;
        }
      }
    }

    return textResult({
      projectId,
      dashboard,
      forecast,
      ...(forecastError ? { forecastError } : {}),
    });
  }

  /** Valida `period` (∈ enum) quando presente. */
  private parsePeriod(raw: unknown): (typeof PERIOD_ENUM)[number] | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'string' || !PERIOD_ENUM.includes(raw as never)) {
      throw invalidParams('period', 'one of: today, week, month');
    }
    return raw as (typeof PERIOD_ENUM)[number];
  }

  /** Valida string de data YYYY-MM-DD quando presente. */
  private parseDateString(raw: unknown, field: string): string | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
      throw invalidParams(field, 'date string YYYY-MM-DD expected');
    }
    return raw;
  }

  /** Valida boolean quando presente. */
  private parseBoolean(raw: unknown, field: string): boolean | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (typeof raw !== 'boolean') {
      throw invalidParams(field, 'boolean expected');
    }
    return raw;
  }

  /** Valida inteiro dentro de [min, max] quando presente. */
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
      throw invalidParams(field, `integer between ${min} and ${max} expected`);
    }
    return raw;
  }
}
