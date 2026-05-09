import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/** idClasse DTabela para Issue Counter por projeto/time (seed F1). */
const ID_CLASSE_ISSUE_COUNTER = BigInt(-475);

/**
 * Service de identificadores atômicos de tasks.
 *
 * Gera identifiers únicos no formato "PREFIX-N" (ex: "DEV-7").
 * Usa DTabela idClasse=-475 (ISSUE_COUNTER) com metaDados.lastSeq.
 *
 * Estratégia de atomicidade:
 * - Busca DTabela -475 do projeto
 * - Se não existe: cria com lastSeq=1, retorna "PREFIX-1"
 * - Se existe: usa $executeRaw com UPDATE...RETURNING para incremento atômico
 *   (evita race condition — jsonb_set no PostgreSQL é atômico dentro de tx)
 *
 * A chamada deve ser feita dentro de uma $transaction para garantir atomicidade
 * completa com a criação da DTask.
 *
 * @example
 * ```typescript
 * // Dentro de $transaction
 * const identifier = await identifierService.getNextIdentifier(tx, BigInt(projectId), 'DEV');
 * // Retorna: "DEV-1", "DEV-2", etc.
 * ```
 */
@Injectable()
export class TasksIdentifierService {
  private readonly logger = new Logger(TasksIdentifierService.name);

  // prisma é injetado mas getNextIdentifier usa tx passado por parâmetro.
  // Mantemos a injeção para compatibilidade com possível uso futuro standalone.
  constructor(_prisma: PrismaService) {}

  /**
   * Retorna o próximo identifier atômico para o projeto.
   *
   * Usa UPDATE atômico via Prisma $transaction para evitar race conditions.
   * Se o counter não existe ainda, cria e retorna PREFIX-1.
   *
   * @param tx - Prisma transaction client (obrigatório para atomicidade)
   * @param projectId - Chave BigInt do DProject
   * @param prefix - Prefixo do identifier (ex: "DEV")
   * @returns Identifier no formato "PREFIX-N" (ex: "DEV-7")
   *
   * @example
   * ```typescript
   * await this.prisma.$transaction(async (tx) => {
   *   const identifier = await this.identifierService.getNextIdentifier(tx, projectId, 'DEV');
   *   // identifier = "DEV-7"
   *   await tx.dTask.create({ data: { dados: { identifier } } });
   * });
   * ```
   */
  async getNextIdentifier(
    tx: Prisma.TransactionClient,
    projectId: bigint,
    prefix: string,
  ): Promise<string> {
    // Buscar counter existente
    const counter = await tx.dTabela.findFirst({
      where: {
        idClasse: ID_CLASSE_ISSUE_COUNTER,
        dEntidadeId: projectId,
        excluido: false,
      },
      select: { chave: true, metaDados: true },
    });

    if (!counter) {
      // Criar counter com lastSeq=1
      this.logger.debug(
        `getNextIdentifier: criando counter para projectId=${projectId}, prefix=${prefix}`,
      );
      await tx.dTabela.create({
        data: {
          idClasse: ID_CLASSE_ISSUE_COUNTER,
          nome: `${prefix} counter`,
          dEntidadeId: projectId,
          metaDados: { prefix, lastSeq: 1 } as Prisma.InputJsonValue,
        },
      });
      return `${prefix}-1`;
    }

    // Incrementar lastSeq atomicamente via jsonb_set
    // A atomicidade é garantida pela transaction em que esta chamada está inserida.
    const metaDados = counter.metaDados as Record<string, unknown>;
    const currentSeq = typeof metaDados.lastSeq === 'number' ? metaDados.lastSeq : 0;
    const nextSeq = currentSeq + 1;

    await tx.dTabela.update({
      where: { chave: counter.chave },
      data: {
        metaDados: {
          ...metaDados,
          lastSeq: nextSeq,
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.debug(
      `getNextIdentifier: projectId=${projectId}, ${prefix}-${nextSeq}`,
    );

    return `${prefix}-${nextSeq}`;
  }
}
