import { ForbiddenException } from '@nestjs/common';
import { AnalyticsController } from '../analytics.controller';

describe('AnalyticsController', () => {
  let analyticsService: any;
  let dashboardsService: any;
  let controller: AnalyticsController;

  const user = {
    sub: 'user-1',
    organizationId: '10',
  } as any;

  beforeEach(() => {
    analyticsService = {
      compareProject: jest.fn().mockResolvedValue({ projectId: '123' }),
      capacityForecast: jest.fn().mockResolvedValue({ orgId: '10' }),
      stakeholderReport: jest.fn().mockResolvedValue({ projectId: '123' }),
    };
    dashboardsService = {
      resolveProjectId: jest.fn().mockResolvedValue(BigInt(123)),
    };
    controller = new AnalyticsController(analyticsService, dashboardsService);
  });

  it('encaminha compare apos validar tenant do projeto', async () => {
    const query = {
      periodAFrom: '2026-04-01',
      periodATo: '2026-04-30',
      periodBFrom: '2026-05-01',
      periodBTo: '2026-05-10',
    };

    await expect(controller.compare('123', query, user)).resolves.toEqual({ projectId: '123' });

    expect(dashboardsService.resolveProjectId).toHaveBeenCalledWith('123', '10');
    expect(analyticsService.compareProject).toHaveBeenCalledWith('10', BigInt(123), query);
  });

  it('capacityForecast retorna 403 quando org do path diverge do token', async () => {
    await expect(controller.capacityForecast('11', {}, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(analyticsService.capacityForecast).not.toHaveBeenCalled();
  });

  it('capacityForecast exige org presente no token', async () => {
    await expect(controller.capacityForecast('10', {}, { sub: 'u' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(analyticsService.capacityForecast).not.toHaveBeenCalled();
  });

  it('encaminha capacityForecast com org validada', async () => {
    await expect(controller.capacityForecast('10', { historicalSprints: 4 }, user)).resolves.toEqual({ orgId: '10' });

    expect(analyticsService.capacityForecast).toHaveBeenCalledWith(BigInt(10), { historicalSprints: 4 });
  });

  it('encaminha stakeholderReport apos validar tenant do projeto', async () => {
    await expect(controller.stakeholderReport('123', { period: 'month' }, user)).resolves.toEqual({
      projectId: '123',
    });

    expect(dashboardsService.resolveProjectId).toHaveBeenCalledWith('123', '10');
    expect(analyticsService.stakeholderReport).toHaveBeenCalledWith('10', BigInt(123), { period: 'month' });
  });
});
