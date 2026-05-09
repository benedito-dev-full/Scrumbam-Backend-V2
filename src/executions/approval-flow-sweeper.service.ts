import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';

/**
 * ApprovalFlowSweeperService — expira executions HIGH em awaiting_approval vencidas.
 *
 * Cron a cada minuto: busca candidatos idClasse=-303 com approval.status='awaiting_approval'
 * e expiresAt < NOW(), atualiza para 'expired' via $executeRaw race-safe.
 *
 * O UPDATE é atômico — condição dupla garante que:
 * 1. Apenas status='awaiting_approval' é atualizado (não 'approved' que chegou ao mesmo tempo)
 * 2. Apenas expiresAt realmente vencidos são atualizados
 *
 * @see docs/plano/plan-f6-executions-task2.md §4 Queries — Sweeper
 */
@Injectable()
export class ApprovalFlowSweeperService {
  private readonly logger = new Logger(ApprovalFlowSweeperService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Expira executions HIGH em awaiting_approval cujo expiresAt já passou.
   *
   * Executado a cada minuto via @Cron.
   *
   * Passo 1: findMany candidatos (idClasse=-303, aprovado=false, baixado=false)
   * Passo 2: filtro em memória por approval.status='awaiting_approval' + expiresAt < now
   * Passo 3: $executeRaw UPDATE race-safe com condição dupla
   *
   * @returns Promise<number> quantidade de executions expiradas
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireStaleApprovals(): Promise<number> {
    const now = new Date();

    // Passo 1: buscar candidatos (apenas HIGH = -303; só HIGH exige approve manual)
    const candidates = await this.prisma.dPedido.findMany({
      where: {
        idClasse: BigInt(-303), // EXEC_HIGH — único que exige aprovação manual
        excluido: false,
        aprovado: false,
        baixado: false,
      },
      select: { chave: true, dados: true },
      take: 100, // processar em batches para não sobrecarregar
    });

    // Passo 2: filtrar em memória
    const expiredIds = candidates
      .filter((p) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = p.dados as any;
        return (
          d?.approval?.status === 'awaiting_approval' &&
          d?.approval?.expiresAt &&
          new Date(d.approval.expiresAt) < now
        );
      })
      .map((p) => p.chave);

    if (expiredIds.length === 0) {
      return 0;
    }

    // Passo 3: UPDATE race-safe via $executeRaw
    // Condição dupla: status=awaiting_approval + expiresAt < NOW() (previne race com approve)
    await this.prisma.$executeRaw`
      UPDATE "DPedido"
      SET dados = jsonb_set(
            jsonb_set(dados, '{approval,status}', '"expired"'),
            '{approval,decidedAt}', to_jsonb(NOW()::text)
          ),
          "atualizadoEm" = NOW()
      WHERE chave = ANY(${expiredIds}::bigint[])
        AND dados->'approval'->>'status' = 'awaiting_approval'
        AND (dados->'approval'->>'expiresAt')::timestamptz < NOW()
    `;

    this.logger.log(
      `[ApprovalFlowSweeper] ${expiredIds.length} execution(s) expiradas em ${now.toISOString()}`,
    );

    return expiredIds.length;
  }
}
