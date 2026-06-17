import { BadRequestException, NotFoundException } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpRouterService } from '../services/mcp-router.service';
import { GetProjectMetricsTool } from '../tools/get-project-metrics.tool';

/**
 * Specs para a tool MCP `get_project_metrics` (PR1 — tasks:read).
 *
 * Contrato:
 * (1) sem scope → FORBIDDEN, nenhum service chamado.
 * (2) projectId ausente / não-BigInt → INVALID_PARAMS field=projectId.
 * (3) period fora do enum → INVALID_PARAMS field=period.
 * (4) periodFrom malformado → INVALID_PARAMS field=periodFrom.
 * (5) historicalPeriods=13 / iterations=99 → INVALID_PARAMS.
 * (6) projectId fora do escopo → NotFoundException.
 * (7) happy path com forecast OK → dashboard + forecast não-null.
 * (8) forecast histórico insuficiente (BadRequest) → forecast=null + forecastError, tool NÃO lança.
 * (9) includeForecast=false → forecast NÃO chamado, forecast=null.
 */
describe('MCP get_project_metrics tool', () => {
  const projectId = '100';
  const entidadeId = BigInt(5);

  const ctxWithScope: McpUserContext = {
    dEntidadeId: entidadeId,
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  const ctxNoScope: McpUserContext = { ...ctxWithScope, scopes: ['tasks:write'] };

  const dashboardResult = { projectId, cycleTime: { p50: 4 }, calculatedAt: 'now' };
  const forecastResult = { p50: 12, p75: 18, p85: 22, p95: 35, unit: 'days', tasksRemaining: 30 };

  let dashboardService: { getDashboard: jest.Mock };
  let forecastService: { forecast: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let tool: GetProjectMetricsTool;
  let router: McpRouterService;

  /** Router com GetProjectMetricsTool na posição 19 (0-based). */
  function buildRouter(t: GetProjectMetricsTool): McpRouterService {
    return new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      undefined, // getUnreadCountTool
      undefined, // searchTasksTool
      undefined, // listBlocksTool
      undefined, // listBlockTasksTool
      undefined, // executeTaskTool
      undefined, // updateTimerTool
      undefined, // deleteTaskTool
      undefined, // getTaskTreeTool
      t, // getProjectMetricsTool
    );
  }

  function parse(response: { result?: unknown }): Record<string, unknown> {
    return JSON.parse(
      (response.result as { content: Array<{ text: string }> }).content[0].text,
    ) as Record<string, unknown>;
  }

  beforeEach(() => {
    dashboardService = { getDashboard: jest.fn().mockResolvedValue(dashboardResult) };
    forecastService = { forecast: jest.fn().mockResolvedValue(forecastResult) };
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };
    tool = new GetProjectMetricsTool(
      dashboardService as never,
      forecastService as never,
      projectsService as never,
    );
    router = buildRouter(tool);
  });

  it('(1) sem scope → FORBIDDEN', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId } },
      ctxNoScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.FORBIDDEN,
        data: { requiredScope: 'tasks:read' },
      }),
    );
    expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
    expect(dashboardService.getDashboard).not.toHaveBeenCalled();
  });

  it('(2a) projectId ausente → INVALID_PARAMS field=projectId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: {} },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: expect.objectContaining({ field: 'projectId' }),
      }),
    );
  });

  it('(2b) projectId não-BigInt → INVALID_PARAMS field=projectId', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId: 'abc' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        data: { field: 'projectId', issue: 'valid bigint string expected' },
      }),
    );
  });

  it('(3) period fora do enum → INVALID_PARAMS field=period', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId, period: 'year' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        data: expect.objectContaining({ field: 'period' }),
      }),
    );
    expect(dashboardService.getDashboard).not.toHaveBeenCalled();
  });

  it('(4) periodFrom malformado → INVALID_PARAMS field=periodFrom', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId, periodFrom: '2026/01/01' } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ data: expect.objectContaining({ field: 'periodFrom' }) }),
    );
  });

  it('(5a) historicalPeriods=13 → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId, historicalPeriods: 13 } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ data: expect.objectContaining({ field: 'historicalPeriods' }) }),
    );
  });

  it('(5b) iterations=99 → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId, iterations: 99 } },
      ctxWithScope,
    );

    expect(response.error).toEqual(
      expect.objectContaining({ data: expect.objectContaining({ field: 'iterations' }) }),
    );
  });

  it('(6) projectId fora do escopo → NotFoundException', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce(['999']);

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'get_project_metrics', arguments: { projectId } },
        ctxWithScope,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(dashboardService.getDashboard).not.toHaveBeenCalled();
  });

  it('(7) happy path com forecast OK → dashboard + forecast não-null', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId, period: 'month' } },
      ctxWithScope,
    );

    expect(dashboardService.getDashboard).toHaveBeenCalledWith(BigInt(projectId), {
      period: 'month',
    });
    expect(forecastService.forecast).toHaveBeenCalledWith(BigInt(projectId), {});
    expect(response.error).toBeUndefined();
    const parsed = parse(response);
    expect(parsed.projectId).toBe(projectId);
    expect(parsed.dashboard).toEqual(dashboardResult);
    expect(parsed.forecast).toEqual(forecastResult);
    expect(parsed.forecastError).toBeUndefined();
  });

  it('(8) forecast histórico insuficiente → forecast=null + forecastError, tool NÃO lança', async () => {
    forecastService.forecast.mockRejectedValueOnce(new BadRequestException('Sem histórico'));

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId } },
      ctxWithScope,
    );

    expect(response.error).toBeUndefined();
    const parsed = parse(response);
    expect(parsed.dashboard).toEqual(dashboardResult);
    expect(parsed.forecast).toBeNull();
    expect(parsed.forecastError).toBe('historico insuficiente para forecast');
  });

  it('(8b) erro inesperado do forecast → propaga (não engole)', async () => {
    forecastService.forecast.mockRejectedValueOnce(new Error('boom'));

    await expect(
      router.dispatch(
        'tools/call',
        { name: 'get_project_metrics', arguments: { projectId } },
        ctxWithScope,
      ),
    ).rejects.toThrow('boom');
  });

  it('(9) includeForecast=false → forecast NÃO chamado, forecast=null', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project_metrics', arguments: { projectId, includeForecast: false } },
      ctxWithScope,
    );

    expect(forecastService.forecast).not.toHaveBeenCalled();
    const parsed = parse(response);
    expect(parsed.forecast).toBeNull();
    expect(parsed.forecastError).toBeUndefined();
  });
});
