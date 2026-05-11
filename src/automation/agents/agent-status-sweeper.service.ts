import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';

@Injectable()
export class AgentStatusSweeperService {
  private readonly logger = new Logger(AgentStatusSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweepOfflineAgents(): Promise<void> {
    const timeoutSeconds = parseInt(
      this.configService.get<string>('AGENT_HEARTBEAT_TIMEOUT_S', '90'),
      10,
    );
    const cutoff = Date.now() - timeoutSeconds * 1000;

    const offlineAgents = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.dEntidade.findMany({
        where: {
          idClasse: AUTOMATION_CLASS_IDS.AGENT,
          excluido: false,
        },
        select: { chave: true, dados: true },
      });

      const stale = candidates.filter((agent) => {
        const dados = (agent.dados as Record<string, unknown> | null) ?? {};
        if (dados.statusCode?.toString() !== AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString()) {
          return false;
        }
        const lastSeenRaw = typeof dados.lastSeen === 'string' ? dados.lastSeen : null;
        const lastSeen = lastSeenRaw ? new Date(lastSeenRaw).getTime() : NaN;
        return Number.isFinite(lastSeen) && lastSeen < cutoff;
      });

      for (const agent of stale) {
        const dados = (agent.dados as Record<string, unknown> | null) ?? {};
        await tx.dEntidade.update({
          where: { chave: agent.chave },
          data: {
            dados: {
              ...dados,
              statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_OFFLINE.toString(),
              offlineAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      }

      return stale.map((agent) => agent.chave);
    });

    for (const agentId of offlineAgents) {
      await this.eventProducer.addInternalEvent(
        'agent.offline',
        { agentId: agentId.toString() },
        this.correlationIdService.getOrGenerate(),
        { source: AgentStatusSweeperService.name },
      );
    }

    if (offlineAgents.length > 0) {
      this.logger.log(`Marked ${offlineAgents.length} agent(s) offline`);
    }
  }
}
