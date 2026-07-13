import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TasksController } from '../../tasks/tasks.controller';
import { ProjectScopeGuard } from '../guards/project-scope.guard';

/**
 * F4 — itens 4.2 (`ORG_CONTEXT_STALE` no agregado DTask) e 4.5 (bug latente do
 * `ProjectScopeGuard`).
 *
 * A parte 4.2 no lado de `/projects` é coberta em `projects.service.spec.ts`
 * (`describe('F4 — ORG_CONTEXT_STALE')`). Aqui provamos o lado de `/tasks`, onde
 * a decisão **não pode** morar no service: `TasksService.findMany` recebe apenas
 * `accessibleProjectIds` — nunca o claim `organizationId` — logo é incapaz, por
 * construção, de distinguir "usuário novo sem projetos" de "org stale". Quem tem
 * o claim é o controller; é lá que a checagem acontece.
 */
describe('F4 — ORG_CONTEXT_STALE em /tasks + ProjectScopeGuard (itens 4.2 e 4.5)', () => {
  describe('TasksController.resolveScopedProjectIds', () => {
    const buildController = (
      accessibleIds: string[],
      assertImpl: jest.Mock,
    ): { controller: TasksController; tasksService: { findMany: jest.Mock } } => {
      const tasksService = {
        findMany: jest.fn().mockResolvedValue({
          items: [],
          pagination: { hasMore: false, nextCursor: null },
        }),
      };
      const projectsService = {
        findAccessibleProjectIds: jest.fn().mockResolvedValue(accessibleIds),
        assertOrgContextFresh: assertImpl,
      };

      const controller = new TasksController(
        tasksService as never,
        projectsService as never,
        {} as never, // PhaseTreeService
        {} as never, // PhaseMetricsService
        {} as never, // PunctualityMetricsService
        {} as never, // SearchService
      );

      return { controller, tasksService };
    };

    const req = { user: { entidadeId: '100', organizationId: '50' } };

    it('escopo VAZIO + org STALE → 401 ORG_CONTEXT_STALE (não mais 200 com [])', async () => {
      const assertOrgContextFresh = jest.fn().mockRejectedValue(
        new UnauthorizedException({
          code: 'ORG_CONTEXT_STALE',
          message: 'Contexto de organização desatualizado.',
        }),
      );
      const { controller, tasksService } = buildController([], assertOrgContextFresh);

      await expect(controller.findMany({} as never, req as never)).rejects.toMatchObject({
        status: 401,
        response: { code: 'ORG_CONTEXT_STALE' },
      });

      // O service nem chega a ser chamado — o contexto morreu antes.
      expect(tasksService.findMany).not.toHaveBeenCalled();
      expect(assertOrgContextFresh).toHaveBeenCalledWith(BigInt(100), '50', 'tasks.controller');
    });

    it('TESTE-GUARDA: escopo VAZIO + org VÁLIDA (usuário novo) → 200 com lista vazia', async () => {
      // `assertOrgContextFresh` resolve 'fresh' → o fluxo SEGUE e responde 200 [].
      // Se este teste quebrar, todo usuário novo entra em loop de refresh.
      const assertOrgContextFresh = jest.fn().mockResolvedValue('fresh');
      const { controller, tasksService } = buildController([], assertOrgContextFresh);

      const result = await controller.findMany({} as never, req as never);

      expect(result.items).toEqual([]);
      expect(tasksService.findMany).toHaveBeenCalledWith({}, []);
    });

    it('escopo NÃO-vazio → nem consulta o contexto de org (custo zero no fluxo normal)', async () => {
      const assertOrgContextFresh = jest.fn();
      const { controller, tasksService } = buildController(['1'], assertOrgContextFresh);

      await controller.findMany({} as never, req as never);

      expect(assertOrgContextFresh).not.toHaveBeenCalled();
      expect(tasksService.findMany).toHaveBeenCalledWith({}, ['1']);
    });
  });

  describe('ProjectScopeGuard — item 4.5 (bug latente)', () => {
    const buildContext = (user: Record<string, string>): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ user, params: { projectId: '7' } }),
        }),
      }) as unknown as ExecutionContext;

    it('resolve o papel com DEntidade.chave (entidadeId), NÃO com DUserGroup.chave (sub)', async () => {
      // O bug: `BigInt(user.sub)` era passado a `getProjectRole`, que consulta
      // `DVincula.idEntidade` (chave da DEntidade). Sequências distintas → 403
      // em usuário legítimo + cache envenenado com `null` na chave errada.
      const roleResolver = { getProjectRole: jest.fn().mockResolvedValue('MEMBER') };
      const guard = new ProjectScopeGuard(roleResolver as never);

      const ok = await guard.canActivate(buildContext({ sub: '999', entidadeId: '100' }));

      expect(ok).toBe(true);
      expect(roleResolver.getProjectRole).toHaveBeenCalledWith(BigInt(100), BigInt(7));
      expect(roleResolver.getProjectRole).not.toHaveBeenCalledWith(BigInt(999), BigInt(7));
    });

    it('sem papel no projeto → 403 com code FORBIDDEN_ROLE', async () => {
      const roleResolver = { getProjectRole: jest.fn().mockResolvedValue(null) };
      const guard = new ProjectScopeGuard(roleResolver as never);

      await expect(
        guard.canActivate(buildContext({ sub: '999', entidadeId: '100' })),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'FORBIDDEN_ROLE' },
      });
    });

    it('JWT sem entidadeId → ForbiddenException (nunca consulta com id errado)', async () => {
      const roleResolver = { getProjectRole: jest.fn() };
      const guard = new ProjectScopeGuard(roleResolver as never);

      await expect(guard.canActivate(buildContext({ sub: '999' }))).rejects.toThrow(
        ForbiddenException,
      );
      expect(roleResolver.getProjectRole).not.toHaveBeenCalled();
    });
  });
});
