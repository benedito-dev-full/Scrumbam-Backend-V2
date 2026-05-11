import { UnauthorizedException } from '@nestjs/common';
import { AgentAuthGuard } from '../guards/agent-auth.guard';
import { AgentsService } from '../agents.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentSecurityService } from '../agent-security.service';

describe('AgentAuthGuard', () => {
  it('autentica agent com X-Agent-Id e X-Agent-Key validos', async () => {
    const agentsService = {
      findAgentForAuth: jest.fn().mockResolvedValue({
        chave: BigInt(5),
        dados: { apiKeyHash: 'hash' },
      }),
    };
    const keyService = { verifySecret: jest.fn().mockReturnValue(true) };
    const securityService = { assertRequestAllowed: jest.fn().mockResolvedValue(undefined) };
    const guard = new AgentAuthGuard(
      agentsService as unknown as AgentsService,
      keyService as unknown as AgentKeyService,
      securityService as unknown as AgentSecurityService,
    );
    const request = {
      params: { id: '5' },
      headers: {
        'x-agent-id': '5',
        'x-agent-key': 'plain',
        'x-agent-nonce': 'nonce-1',
        'x-agent-timestamp': new Date().toISOString(),
      },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await expect(guard.canActivate(context as any)).resolves.toBe(true);
    expect(request).toHaveProperty('agent');
    expect(securityService.assertRequestAllowed).toHaveBeenCalledWith('5', 'nonce-1');
    expect(keyService.verifySecret).toHaveBeenCalledWith('plain', 'hash');
  });

  it('rejeita timestamp fora da janela', async () => {
    const guard = new AgentAuthGuard(
      {} as AgentsService,
      {} as AgentKeyService,
      {} as AgentSecurityService,
    );
    const request = {
      params: { id: '5' },
      headers: {
        'x-agent-id': '5',
        'x-agent-key': 'plain',
        'x-agent-nonce': 'nonce-1',
        'x-agent-timestamp': new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await expect(guard.canActivate(context as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
