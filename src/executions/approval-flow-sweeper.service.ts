import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { AUTOMATION_CLASS_IDS } from '../automation/constants/automation-class-ids';

@Injectable()
export class ApprovalFlowSweeperService {
  private readonly logger = new Logger(ApprovalFlowSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventProducer: EventProducerService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStaleApprovals(): Promise<number> {
    const now = new Date();

    const candidates = await this.prisma.dPedido.findMany({
      where: {
        idClasse: { in: [AUTOMATION_CLASS_IDS.EXEC_MEDIUM, AUTOMATION_CLASS_IDS.EXEC_HIGH] },
        excluido: false,
        aprovado: false,
        baixado: false,
      },
      select: { chave: true, dados: true, idLocEscritu: true },
      take: 100,
    });

    const expired = candidates.filter((p) => {
      const d = p.dados as any;
      return (
        d?.approval?.status === 'awaiting_approval' &&
        d?.approval?.expiresAt &&
        new Date(d.approval.expiresAt) < now
      );
    });
    const expiredIds = expired.map((p) => p.chave);

    if (expiredIds.length === 0) {
      return 0;
    }

    await this.prisma.$executeRaw`
      UPDATE "DPedido"
      SET dados = jsonb_set(
            jsonb_set(
              jsonb_set(dados, '{approval,status}', '"expired"'),
              '{approval,decidedAt}', to_jsonb(NOW()::text)
            ),
            '{statusCode}', to_jsonb(${AUTOMATION_CLASS_IDS.EXEC_STATUS_EXPIRED.toString()}::text)
          ),
          "atualizadoEm" = NOW()
      WHERE chave = ANY(${expiredIds}::bigint[])
        AND dados->'approval'->>'status' = 'awaiting_approval'
        AND (dados->'approval'->>'expiresAt')::timestamptz < NOW()
    `;

    this.logger.log(
      `[ApprovalFlowSweeper] ${expiredIds.length} execution(s) expiradas em ${now.toISOString()}`,
    );

    for (const candidate of expired) {
      const dados = (candidate.dados ?? {}) as any;
      await this.eventProducer.addInternalEvent('execution.expired', {
        executionId: candidate.chave.toString(),
        projectId: dados?.audit?.projectId ?? candidate.idLocEscritu?.toString(),
        agentId: dados?.audit?.agentId,
      }, dados?.audit?.correlationId ?? `expired-${candidate.chave}`, {
        source: ApprovalFlowSweeperService.name,
      });
    }

    return expiredIds.length;
  }
}
