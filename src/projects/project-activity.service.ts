import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  ListProjectActivityResponseDto,
  ProjectActivityDto,
} from './dto/project-response.dto';
import { ProjectActivityQueryDto } from './dto/project-activity-query.dto';

/**
 * idClasses DEvento para atividade de projeto (seed F1).
 * -497: task.created | -498: status.changed | -499: project.deleted | -500: org.deleted
 */
const PROJECT_ACTIVITY_CLASSES = [BigInt(-497), BigInt(-498), BigInt(-499), BigInt(-500)];

/**
 * Service de atividade de projetos.
 *
 * Lê DEvento idClasse in [-497,-498,-499,-500] onde idEntidade=projectId.
 * Cursor pagination por chave (ZERO N+1 — select seletivo).
 *
 * @example
 * ```typescript
 * const activity = await service.getActivity('1', { limit: 20 });
 * ```
 */
@Injectable()
export class ProjectActivityService {
  private readonly logger = new Logger(ProjectActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna timeline de eventos do projeto com cursor pagination.
   *
   * Busca DEvento idClasse in [-497,-498,-499,-500] WHERE idEntidade=projectId.
   * Cursor: chave do último evento retornado (paginação decrescente).
   *
   * @param projectId - Chave BigInt do projeto (string)
   * @param query - Parâmetros de cursor e limit
   * @returns Lista paginada de eventos de atividade
   *
   * @example
   * ```typescript
   * const { items, pagination } = await service.getActivity('1', { limit: 20 });
   * ```
   */
  async getActivity(
    projectId: string,
    query: ProjectActivityQueryDto,
  ): Promise<ListProjectActivityResponseDto> {
    const projectIdBigInt = BigInt(projectId);
    const take = Math.min(query.limit ?? 20, 100);

    const eventos = await this.prisma.dEvento.findMany({
      where: {
        idEntidade: projectIdBigInt,
        idClasse: { in: PROJECT_ACTIVITY_CLASSES },
        ...(query.cursor ? { chave: { lt: BigInt(query.cursor) } } : {}),
      },
      select: {
        chave: true,
        descricao: true,
        metaDados: true,
        criadoEm: true,
      },
      take: take + 1,
      orderBy: { chave: 'desc' },
    });

    const hasMore = eventos.length > take;
    const pageEventos = hasMore ? eventos.slice(0, take) : eventos;

    const items: ProjectActivityDto[] = pageEventos.map((e) => ({
      id: e.chave.toString(),
      tipo: e.descricao ?? 'evento',
      metaDados: e.metaDados as Record<string, unknown> | null,
      criadoEm: e.criadoEm.toISOString(),
    }));

    const nextCursor =
      hasMore ? pageEventos[pageEventos.length - 1].chave.toString() : null;

    this.logger.debug(
      `getActivity: projectId=${projectIdBigInt}, items=${items.length}, hasMore=${hasMore}`,
    );

    return { items, pagination: { hasMore, nextCursor } };
  }
}
