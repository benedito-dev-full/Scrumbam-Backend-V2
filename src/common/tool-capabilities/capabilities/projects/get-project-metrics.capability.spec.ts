import { BadRequestException, NotFoundException } from '@nestjs/common';

import { fromMcp } from '../../tool-principal';
import { GetProjectMetricsCapability } from './get-project-metrics.capability';

/**
 * Onda 3 (reads so-MCP) — `GetProjectMetricsCapability`.
 *
 * Espelha `src/mcp/tools/get-project-metrics.tool.ts`: agrega
 * `DashboardService.getDashboard` (sempre) + `ForecastService.forecast`
 * (opcional, tolerante a historico insuficiente).
 */
describe('GetProjectMetricsCapability (Onda 3 — reads so-MCP)', () => {
  const projectId = '10';
  const dashboard = { cycleTime: {}, leadTime: {}, throughput: {}, wipAge: {}, cfd: {} };
  const forecast = { p50: 3, p75: 5, p85: 7, p95: 10 };

  let dashboardService: { getDashboard: jest.Mock };
  let forecastService: { forecast: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let capability: GetProjectMetricsCapability;

  beforeEach(() => {
    dashboardService = { getDashboard: jest.fn().mockResolvedValue(dashboard) };
    forecastService = { forecast: jest.fn().mockResolvedValue(forecast) };
    projectsService = { findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]) };
    capability = new GetProjectMetricsCapability(
      dashboardService as never,
      forecastService as never,
      projectsService as never,
    );
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('get_project_metrics');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
  });

  it('retorna dashboard + forecast (default includeForecast=true)', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId }, principal);

    expect(result).toEqual({ data: { projectId, dashboard, forecast } });
  });

  it('includeForecast=false: pula forecast inteiramente', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId, includeForecast: false }, principal);

    expect(result).toEqual({ data: { projectId, dashboard, forecast: null } });
    expect(forecastService.forecast).not.toHaveBeenCalled();
  });

  it('historico insuficiente: forecast=null + forecastError (NUNCA falha)', async () => {
    forecastService.forecast.mockRejectedValue(new BadRequestException('sem historico'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ projectId }, principal);

    expect(result).toEqual({
      data: { projectId, dashboard, forecast: null, forecastError: 'historico insuficiente para forecast' },
    });
  });

  it('projeto fora do escopo -> NotFoundException anti-enumeration', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValue([]);
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(capability.run({ projectId }, principal)).rejects.toThrow(NotFoundException);
    expect(dashboardService.getDashboard).not.toHaveBeenCalled();
  });
});
