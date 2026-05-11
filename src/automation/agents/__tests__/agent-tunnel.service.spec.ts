import { AgentTunnelService } from '../agent-tunnel.service';

describe('AgentTunnelService', () => {
  it('rejeita porta invalida sem abrir socket', async () => {
    const service = new AgentTunnelService();

    await expect(service.probe(0)).resolves.toEqual({
      tunnelOk: false,
      host: '127.0.0.1',
      port: 0,
      latencyMs: null,
      error: 'INVALID_TUNNEL_PORT',
    });
  });
});
