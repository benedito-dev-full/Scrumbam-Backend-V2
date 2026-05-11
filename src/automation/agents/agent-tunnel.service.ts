import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'net';

export interface AgentTunnelProbeResult {
  tunnelOk: boolean;
  host: '127.0.0.1';
  port: number | null;
  latencyMs: number | null;
  error?: string;
}

@Injectable()
export class AgentTunnelService {
  private readonly logger = new Logger(AgentTunnelService.name);
  private readonly timeoutMs = 2000;

  async probe(tunnelPort: number | null | undefined): Promise<AgentTunnelProbeResult> {
    if (!Number.isInteger(tunnelPort) || !tunnelPort || tunnelPort <= 0 || tunnelPort > 65535) {
      return {
        tunnelOk: false,
        host: '127.0.0.1',
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
          host: '127.0.0.1',
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
        this.logger.debug(`Tunnel probe failed port=${tunnelPort}: ${error.message}`);
        const code = (error as NodeJS.ErrnoException).code ?? 'TUNNEL_UNAVAILABLE';
        finish({ tunnelOk: false, latencyMs: Date.now() - startedAt, error: code });
      });

      socket.connect(tunnelPort, '127.0.0.1');
    });
  }
}
