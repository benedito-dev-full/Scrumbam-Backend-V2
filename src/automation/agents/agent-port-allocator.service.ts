import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';

@Injectable()
export class AgentPortAllocatorService {
  constructor(private readonly configService: ConfigService) {}

  async allocate(tx: Prisma.TransactionClient): Promise<number> {
    const min = this.getNumber('AGENT_PORT_MIN', 20000);
    const max = this.getNumber('AGENT_PORT_MAX', 29999);
    const lockKey = this.getNumber('AGENT_PORT_LOCK_KEY', 1337);
    if (min > max) {
      throw new ConflictException('Range de portas de agent invalido');
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const agents = await tx.dEntidade.findMany({
      where: {
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { dados: true },
    });

    const usedPorts = new Set<number>();
    for (const agent of agents) {
      const dados = (agent.dados as Record<string, unknown> | null) ?? {};
      const port = dados.tunnelPort;
      if (typeof port === 'number' && Number.isInteger(port)) {
        usedPorts.add(port);
      }
    }

    for (let port = min; port <= max; port += 1) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }

    throw new ConflictException('Nenhuma porta de tunnel disponivel para agent');
  }

  private getNumber(name: string, fallback: number): number {
    const raw = this.configService.get<string>(name);
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
