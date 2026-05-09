import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Status V3 padrão para seed de projetos.
 * idClasses -441 a -449 (seed F1).
 */
const STATUS_V3_DEFAULTS: Array<{ idClasse: bigint; nome: string; codigo: string }> = [
  { idClasse: BigInt(-441), nome: 'INBOX', codigo: 'INBOX' },
  { idClasse: BigInt(-442), nome: 'READY', codigo: 'READY' },
  { idClasse: BigInt(-443), nome: 'EXECUTING', codigo: 'EXECUTING' },
  { idClasse: BigInt(-444), nome: 'DONE', codigo: 'DONE' },
  { idClasse: BigInt(-445), nome: 'FAILED', codigo: 'FAILED' },
  { idClasse: BigInt(-446), nome: 'CANCELLED', codigo: 'CANCELLED' },
  { idClasse: BigInt(-447), nome: 'DISCARDED', codigo: 'DISCARDED' },
  { idClasse: BigInt(-448), nome: 'VALIDATING', codigo: 'VALIDATING' },
  { idClasse: BigInt(-449), nome: 'VALIDATED', codigo: 'VALIDATED' },
];

/** idClasse DTabela para Sprint (seed F1). */
const ID_CLASSE_SPRINT = BigInt(-400);

/**
 * Service de bootstrap de projetos.
 *
 * Cria os dados padrão de um novo projeto dentro de uma transaction:
 * - 9 statuses V3 (DTabela -441 a -449, dEntidadeId=projectId)
 * - 1 Sprint default "Sprint 1" (DTabela -400, dEntidadeId=projectId)
 *
 * Chamado dentro de ProjectsService.create() via transaction.
 * Idempotente: verifica existência de INBOX antes de criar.
 *
 * @example
 * ```typescript
 * await this.seedBootstrap.seedProject(tx, projectId);
 * ```
 */
@Injectable()
export class SeedBootstrapService {
  private readonly logger = new Logger(SeedBootstrapService.name);

  /**
   * Semeia dados padrão do projeto na transaction fornecida.
   *
   * Cria 9 statuses V3 + 1 sprint default.
   * Idempotente por INBOX como sentinela.
   *
   * @param tx - Prisma transaction client (obrigatório — chamado dentro de $transaction)
   * @param projectId - Chave BigInt do DProject recém-criado
   * @returns Número de registros criados (0 se já existiam)
   *
   * @example
   * ```typescript
   * await this.prisma.$transaction(async (tx) => {
   *   const project = await tx.dProject.create({ ... });
   *   await this.seedBootstrap.seedProject(tx, project.chave);
   * });
   * ```
   */
  async seedProject(tx: Prisma.TransactionClient, projectId: bigint): Promise<number> {
    // Verificar idempotência: INBOX já existe?
    const existingInbox = await tx.dTabela.findFirst({
      where: {
        idClasse: BigInt(-441),
        dEntidadeId: projectId,
        excluido: false,
      },
      select: { chave: true },
    });

    if (existingInbox) {
      this.logger.debug(`seedProject: dados padrão já existem para projectId=${projectId} — skipping`);
      return 0;
    }

    let created = 0;

    // Criar os 9 statuses V3
    for (const status of STATUS_V3_DEFAULTS) {
      await tx.dTabela.create({
        data: {
          idClasse: status.idClasse,
          nome: status.nome,
          codigo: status.codigo,
          dEntidadeId: projectId,
          metaDados: { v3Status: true } as Prisma.InputJsonValue,
        },
      });
      created++;
    }

    // Criar Sprint 1 default
    await tx.dTabela.create({
      data: {
        idClasse: ID_CLASSE_SPRINT,
        nome: 'Sprint 1',
        codigo: 'SPRINT_1',
        dEntidadeId: projectId,
        metaDados: { isDefault: true, order: 1 } as Prisma.InputJsonValue,
      },
    });
    created++;

    this.logger.log(
      `seedProject: ${created} registros criados para projectId=${projectId} (9 statuses + 1 sprint)`,
    );

    return created;
  }
}
