import { ConflictException, HttpException } from '@nestjs/common';
import { AgentSecurityService } from '../agent-security.service';

describe('AgentSecurityService', () => {
  function service(): AgentSecurityService {
    return new AgentSecurityService({ get: jest.fn().mockReturnValue(undefined) } as any);
  }

  it('bloqueia replay de nonce por agent', async () => {
    const agentSecurity = service();

    await expect(agentSecurity.assertRequestAllowed('10', 'nonce-1')).resolves.toBeUndefined();
    await expect(agentSecurity.assertRequestAllowed('10', 'nonce-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('limita agent a 30 requests por minuto', async () => {
    const agentSecurity = service();

    for (let index = 0; index < 30; index++) {
      await agentSecurity.assertRequestAllowed('10', `nonce-${index}`);
    }

    await expect(agentSecurity.assertRequestAllowed('10', 'nonce-31')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
