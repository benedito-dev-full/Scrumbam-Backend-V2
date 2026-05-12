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
 * Priorities V3 padrão para seed de projetos.
 * idClasses -421..-424 (seed F1 — DClasses canônicas V2).
 *
 * Cada projeto precisa das 4 DTabelas para que o lookup
 * `(idClasse, dEntidadeId=projectId)` em TasksService funcione.
 */
const PRIORITY_DEFAULTS: Array<{ idClasse: bigint; nome: string; codigo: string }> = [
  { idClasse: BigInt(-421), nome: 'HIGH', codigo: 'HIGH' },
  { idClasse: BigInt(-422), nome: 'MEDIUM', codigo: 'MEDIUM' },
  { idClasse: BigInt(-423), nome: 'LOW', codigo: 'LOW' },
  { idClasse: BigInt(-424), nome: 'URGENT', codigo: 'URGENT' },
];

/**
 * Service de bootstrap de projetos.
 *
 * Cria os dados padrão de um novo projeto dentro de uma transaction:
 * - 9 statuses V3 (DTabela -441 a -449, dEntidadeId=projectId)
 * - 4 priorities (DTabela -421 a -424, dEntidadeId=projectId)
 * - 1 Sprint default "Sprint 1" (DTabela -400, dEntidadeId=projectId)
 *
 * Chamado dentro de ProjectsService.create() via transaction.
 * Idempotente em duas camadas:
 *   1. INBOX (-441) sentinela para projetos novos (early-exit).
 *   2. Priorities — `seedPrioritiesIfMissing` é executado mesmo se INBOX existir,
 *      cobrindo projetos legados criados antes desta feature (ADR-V2-XXX).
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
   * Cria 9 statuses V3 + 4 priorities + 1 sprint default.
   * Idempotente por INBOX como sentinela; priorities têm idempotência
   * própria (lookup por `idClasse + dEntidadeId`).
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

    let created = 0;

    if (!existingInbox) {
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
    } else {
      this.logger.debug(
        `seedProject: statuses+sprint já existem para projectId=${projectId} — pulando criação base`,
      );
    }

    // Priorities têm idempotência própria (cobre projetos legados sem INBOX-bypass)
    const prioritiesCreated = await this.seedPrioritiesIfMissing(tx, projectId);
    created += prioritiesCreated;

    if (created > 0) {
      this.logger.log(
        `seedProject: ${created} registros criados para projectId=${projectId}` +
          ` (${existingInbox ? 'apenas priorities backfill' : '9 statuses + 1 sprint + ' + prioritiesCreated + ' priorities'})`,
      );
    }

    return created;
  }

  /**
   * Cria DTabelas PRIORITY (HIGH/MEDIUM/LOW/URGENT) faltantes para um projeto.
   *
   * Idempotente: faz lookup por `(idClasse, dEntidadeId)` para cada uma das 4
   * priorities e cria apenas as ausentes. Pode ser chamado isoladamente em
   * backfill scripts para projetos legados.
   *
   * @param tx - Prisma transaction client OU PrismaService (compatível com ambos)
   * @param projectId - Chave BigInt do DProject
   * @returns Quantidade de priorities recém-criadas (0 se todas já existiam)
   *
   * @example
   * ```typescript
   * // Backfill standalone (sem transaction obrigatória)
   * await seedBootstrap.seedPrioritiesIfMissing(prisma, project.chave);
   * ```
   */
  async seedPrioritiesIfMissing(tx: Prisma.TransactionClient, projectId: bigint): Promise<number> {
    // Batch lookup: 1 query para todas as priorities existentes do projeto (ZERO N+1)
    const existing = await tx.dTabela.findMany({
      where: {
        idClasse: { in: PRIORITY_DEFAULTS.map((p) => p.idClasse) },
        dEntidadeId: projectId,
        excluido: false,
      },
      select: { idClasse: true },
    });

    const existingClasses = new Set(existing.map((e) => e.idClasse.toString()));
    let created = 0;

    for (const priority of PRIORITY_DEFAULTS) {
      if (existingClasses.has(priority.idClasse.toString())) {
        continue;
      }
      await tx.dTabela.create({
        data: {
          idClasse: priority.idClasse,
          nome: priority.nome,
          codigo: priority.codigo,
          dEntidadeId: projectId,
          metaDados: { v3Priority: true } as Prisma.InputJsonValue,
        },
      });
      created++;
    }

    return created;
  }
}
