import { ProjectsService } from '../../projects/projects.service';
import { RealtimeGateway } from '../realtime.gateway';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let projectsService: { findAccessibleProjectIds: jest.Mock };

  const user = { sub: '10', entidadeId: '20', organizationId: '30', email: 'u@test.com' };

  /** Socket falso com `join`/`leave`/`emit` espionáveis. */
  function makeClient(overrides: Record<string, unknown> = {}) {
    return {
      data: { user },
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    projectsService = { findAccessibleProjectIds: jest.fn() };
    gateway = new RealtimeGateway(projectsService as unknown as ProjectsService);
  });

  describe('handleJoinList', () => {
    it('nega quando listId não está em findAccessibleProjectIds', async () => {
      projectsService.findAccessibleProjectIds.mockResolvedValue(['999']);
      const client = makeClient();

      await gateway.handleJoinList(client as never, { listId: '123' });

      expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(
        BigInt('20'),
        '30',
      );
      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        code: 'FORBIDDEN_LIST',
        listId: '123',
      });
    });

    it('entra na sala e emite joined:list quando tem acesso', async () => {
      projectsService.findAccessibleProjectIds.mockResolvedValue(['123', '456']);
      const client = makeClient();

      await gateway.handleJoinList(client as never, { listId: '123' });

      expect(client.join).toHaveBeenCalledWith('list:123');
      expect(client.emit).toHaveBeenCalledWith('joined:list', { listId: '123' });
    });

    it('rejeita payload sem listId sem chamar RBAC', async () => {
      const client = makeClient();

      await gateway.handleJoinList(client as never, { listId: '' });

      expect(projectsService.findAccessibleProjectIds).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        code: 'INVALID_PAYLOAD',
        message: 'listId obrigatório',
      });
    });
  });

  describe('handleLeaveList', () => {
    it('sai da sala', async () => {
      const client = makeClient();

      await gateway.handleLeaveList(client as never, { listId: '123' });

      expect(client.leave).toHaveBeenCalledWith('list:123');
      expect(client.emit).toHaveBeenCalledWith('left:list', { listId: '123' });
    });
  });

  describe('broadcast', () => {
    it('emite no canal list:event com o envelope correto', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      gateway.broadcast('list:123', 'task.updated', {
        listId: '123',
        entityId: '777',
        actorId: '20',
      });

      expect(to).toHaveBeenCalledWith('list:123');
      expect(emit).toHaveBeenCalledWith('list:event', {
        event: 'task.updated',
        listId: '123',
        entityId: '777',
        actorId: '20',
      });
    });
  });
});
