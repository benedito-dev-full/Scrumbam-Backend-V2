import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { STATUS_V3_DEFAULTS } from '../tasks/constants/task-status.const';

/**
 * Service de Workflow Statuses V3 (wrapper thin).
 *
 * Implementa apenas `seedDefaults` — semeia os 5 statuses V3 padrão
 * para um projeto quando ainda não existem.
 *
 * GET/PATCH/DELETE de statuses individuais usa o endpoint genérico
 * `/tabelas?idClasse=-440&dEntidadeId={projectId}` (Pilar 2).
 *
 * @see WorkflowStatusesController — endpoint seed-defaults
 * @see TabelaController — endpoints CRUD de statuses
 * @see README.md — documentação completa
 */
@Injectable()
export class WorkflowStatusesService {
  private readonly logger = new Logger(WorkflowStatusesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Semeia os 5 statuses V3 padrão para o projeto.
   *
   * Idempotente: verifica se INBOX (-441) já existe antes de criar.
   * Se INBOX existe, assume que todos os 5 foram criados (evita duplicatas).
   *
   * Pode ser chamado dentro de uma transaction existente (ex: createProject)
   * ou de forma standalone.
   *
   * @param projectId - Chave BigInt do DProject (ou DEntidade do projeto)
   * @param tx - Prisma transaction client (opcional — se null, usa this.prisma)
   * @returns Número de statuses criados (0 se já existiam)
   *
   * @example
   * ```typescript
   * // Dentro de uma transaction
   * await this.workflowStatusesService.seedDefaults(projectId, tx);
   *
   * // Standalone
   * await this.workflowStatusesService.seedDefaults(BigInt(projectId));
   * ```
   */
  async seedDefaults(projectId: bigint, tx?: Prisma.TransactionClient): Promise<number> {
    const db = tx ?? this.prisma;

    // Verificar idempotência: INBOX já existe?
    const existingInbox = await db.dTabela.findFirst({
      where: {
        idClasse: BigInt(-441), // INBOX
        dEntidadeId: projectId,
        excluido: false,
      },
      select: { chave: true },
    });

    if (existingInbox) {
      this.logger.debug(
        `seedDefaults: statuses V3 já existem para projectId=${projectId} — skipping`,
      );
      return 0;
    }

    this.logger.log(`seedDefaults: criando 5 statuses V3 para projectId=${projectId}`);

    // Criar todos os 5 statuses em ordem
    for (const status of STATUS_V3_DEFAULTS) {
      await db.dTabela.create({
        data: {
          idClasse: status.idClasse,
          nome: status.nome,
          codigo: status.codigo,
          dEntidadeId: projectId,
          metaDados: { v3Status: true } as Prisma.InputJsonValue,
        },
      });
    }

    this.logger.log(
      `seedDefaults: ${STATUS_V3_DEFAULTS.length} statuses criados para projectId=${projectId}`,
    );
    return STATUS_V3_DEFAULTS.length;
  }
}
