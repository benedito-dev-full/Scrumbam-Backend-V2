import { DashboardsController } from '../dashboards.controller';

describe('DashboardsController', () => {
  let dashboardsService: any;
  let controller: DashboardsController;

  const user = {
    sub: 'user-1',
    organizationId: '10',
  } as any;

  beforeEach(() => {
    dashboardsService = {
      resolveProjectId: jest.fn().mockResolvedValue(BigInt(123)),
      getMetrics: jest.fn().mockResolvedValue({ projectId: '123' }),
      getVelocity: jest.fn().mockResolvedValue({ projectId: '123' }),
      getBurndown: jest.fn().mockResolvedValue({ projectId: '123' }),
      getTasksByUser: jest.fn().mockResolvedValue({ projectId: '123' }),
      getDailySummary: jest.fn().mockResolvedValue({ projectId: '123' }),
    };
    controller = new DashboardsController(dashboardsService);
  });

  it('encaminha metrics apos validar tenant', async () => {
    await expect(controller.getMetrics('123', { period: 'month' }, user)).resolves.toEqual({
      projectId: '123',
    });

    expect(dashboardsService.resolveProjectId).toHaveBeenCalledWith('123', '10');
    expect(dashboardsService.getMetrics).toHaveBeenCalledWith('10', BigInt(123), { period: 'month' });
  });

  it('encaminha velocity apos resolver projeto no service', async () => {
    await expect(controller.getVelocity('123', {}, user)).resolves.toEqual({ projectId: '123' });

    expect(dashboardsService.getVelocity).toHaveBeenCalledWith('10', BigInt(123), {});
  });

  it('encaminha burndown apos resolver projeto no service', async () => {
    await expect(controller.getBurndown('123', {}, user)).resolves.toEqual({ projectId: '123' });

    expect(dashboardsService.getBurndown).toHaveBeenCalledWith('10', BigInt(123), {});
  });

  it('encaminha tasks-by-user apos resolver projeto no service', async () => {
    await expect(controller.getTasksByUser('123', {}, user)).resolves.toEqual({ projectId: '123' });

    expect(dashboardsService.getTasksByUser).toHaveBeenCalledWith('10', BigInt(123), {});
  });

  it('encaminha daily-summary apos resolver projeto no service', async () => {
    await expect(controller.getDailySummary('123', user)).resolves.toEqual({ projectId: '123' });

    expect(dashboardsService.getDailySummary).toHaveBeenCalledWith('10', BigInt(123));
  });
});
