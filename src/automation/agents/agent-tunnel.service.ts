import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'net';

export interface AgentTunnelProbeResult {
  tunnelOk: boolean;
  host: string;
  port: number | null;
  latencyMs: number | null;
  error?: string;
}

/**
 * Host alvo do probe TCP. Identico ao usado no `RemoteExecutionClient`
 * — backend em Docker (Dokploy) precisa de `172.17.0.1` (Docker bridge da
 * VPS, onde o tunnel SSH reverso do agent esta bindado). Default `127.0.0.1`
 * mantem dev local funcional.
 *
 * Sem essa variavel, o socket.connect mira o localhost do container e
 * o probe falha com ECONNREFUSED — bloqueando POST /projects/:id/execute
 * com 422 "Tunnel do agent indisponivel".
 */
function resolveTunnelHost(): string {
  return process.env.AGENT_TUNNEL_HOST ?? '127.0.0.1';
}

@Injectable()
export class AgentTunnelService {
  private readonly logger = new Logger(AgentTunnelService.name);
  private readonly timeoutMs = 2000;

  async probe(tunnelPort: number | null | undefined): Promise<AgentTunnelProbeResult> {
    const host = resolveTunnelHost();

    if (!Number.isInteger(tunnelPort) || !tunnelPort || tunnelPort <= 0 || tunnelPort > 65535) {
      return {
        tunnelOk: false,
        host,
        port: tunnelPort ?? null,
        latencyMs: null,
        error: 'INVALID_TUNNEL_PORT',
      };
    }

    const startedAt = Date.now();

    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;

      const finish = (result: Omit<AgentTunnelProbeResult, 'host' | 'port'>): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({
          host,
          port: tunnelPort,
          ...result,
        });
      };

      socket.setTimeout(this.timeoutMs);
      socket.once('connect', () => {
        finish({ tunnelOk: true, latencyMs: Date.now() - startedAt });
      });
      socket.once('timeout', () => {
        finish({ tunnelOk: false, latencyMs: Date.now() - startedAt, error: 'TUNNEL_TIMEOUT' });
      });
      socket.once('error', (error) => {
        this.logger.debug(`Tunnel probe failed host=${host} port=${tunnelPort}: ${error.message}`);
        const code = (error as NodeJS.ErrnoException).code ?? 'TUNNEL_UNAVAILABLE';
        finish({ tunnelOk: false, latencyMs: Date.now() - startedAt, error: code });
      });

      socket.connect(tunnelPort, host);
    });
  }
}
