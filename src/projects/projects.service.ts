import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/services/audit.service';
import { SeedBootstrapService } from './seed-bootstrap.service';
import { ProjectMembersService } from './project-members.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ProjectResponseDto,
  ListProjectResponseDto,
  ProjectStatsDto,
} from './dto/project-response.dto';

/** idClasse de DProject no seed F1 (classes canônicas V2). */
const ID_CLASSE_PROJECT = BigInt(-153); // SCRUMBAN_PROJECT (seed classes.seed.ts)

/** idClasse de DVincula MANAGER de projeto (seed F1). */
const ID_CLASSE_PROJECT_MANAGER = BigInt(-171);
const ID_CLASSE_PROJECT_MEMBER = BigInt(-172);
const ID_CLASSE_PROJECT_VIEWER = BigInt(-173);

const PROJECT_ROLE_CLASSES = [
  ID_CLASSE_PROJECT_MANAGER,
  ID_CLASSE_PROJECT_MEMBER,
  ID_CLASSE_PROJECT_VIEWER,
];


/**
 * Service de projetos (DProject).
 *
 * Implementa CRUD completo de projetos usando Prisma direto em transactions.
 * Tabela estrutural — Pilar 1 NÃO se aplica (DProject não é DPedido).
 *
 * Ao criar um projeto, atomicamente:
 * 1. DProject
 * 2. DVincula -171 (PROJECT_ROLE_MANAGER) para o criador
 * 3. SeedBootstrapService.seedProject() → 9 statuses V3 + 1 sprint default
 *
 * Audit DEvento -499 emitido APÓS commit.
 *
 * @see PrismaService — acesso ao banco
 * @see SeedBootstrapService — seed de statuses + sprint
 * @see ProjectMembersService — gestão de membros
 * @see AuditService — audit log pós-commit
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seedBootstrap: SeedBootstrapService,
    private readonly projectMembers: ProjectMembersService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Cria projeto com seed completo e membership MANAGER.
   *
   * Transaction atômica (3 etapas):
   * 1. DProject (tabela canônica)
   * 2. DVincula -171 (MANAGER) para o criador
   * 3. seedProject(): 9 statuses V3 + 1 sprint default
   *
   * Audit project.created emitido APÓS commit.
   *
   * @param dto - Dados do projeto (nome, prefix, description, orgId...)
   * @param userEntidadeId - Chave BigInt da DEntidade do criador
   * @returns ProjectResponseDto com memberCount=1
   *
   * @example
   * ```typescript
   * const project = await service.create({ nome: 'Scrumban V2', prefix: 'DEV' }, BigInt(userId));
   * ```
   */
  async create(dto: CreateProjectDto, userEntidadeId: bigint): Promise<ProjectResponseDto> {
    this.logger.log(`Criando projeto nome="${dto.nome}" para user=${userEntidadeId}`);

    const project = await this.prisma.$transaction(async (tx) => {
      // Construir dados polimórficos
      const dadosPayload: Record<string, unknown> = {
        prefix: dto.prefix ?? 'DEV',
        automationEnabled: dto.automationEnabled ?? false,
        ...(dto.description ? { description: dto.description } : {}),
        ...(dto.gitRepo ? { gitRepo: dto.gitRepo } : {}),
      };

      // 1. DProject
      const proj = await tx.dProject.create({
        data: {
          idClasse: ID_CLASSE_PROJECT,
          nome: dto.nome,
          ...(dto.description ? { descricao: dto.description } : {}),
          ...(dto.orgId ? { idEstab: BigInt(dto.orgId) } : {}),
          dados: dadosPayload as Prisma.InputJsonValue,
        },
      });

      // 2. DVincula -171 (MANAGER): criador é MANAGER
      await this.projectMembers.createManagerLink(tx, proj.chave, userEntidadeId);

      // 3. Seed: 9 statuses V3 + 1 sprint default
      await this.seedBootstrap.seedProject(tx, proj.chave);

      return proj;
    });

    // Audit APÓS commit
    await this.auditService.log(
      'project.created',
      project.chave,
      { nome: dto.nome, prefix: dto.prefix ?? 'DEV' },
      userEntidadeId,
    );

    return this.buildResponse(project, 1);
  }

  /**
   * Lista projetos onde o usuário é membro.
   *
   * Busca DVincula roles [-171,-172,-173] WHERE idEntidade=userEntidadeId
   * e retorna DProjects correspondentes. N+1 ZERO via include.
   *
   * @param userEntidadeId - Chave BigInt da DEntidade do usuário
   * @param cursor - Cursor para paginação (última chave retornada)
   * @param limit - Quantidade de itens por página (default: 20, max: 100)
   * @returns Lista paginada de projetos
   *
   * @example
   * ```typescript
   * const { items } = await service.findMany(BigInt(userId));
   * ```
   */
  async findMany(
    userEntidadeId: bigint,
    cursor?: string,
    limit = 20,
  ): Promise<ListProjectResponseDto> {
    const take = Math.min(limit, 100);

    // Query: DVincula das project-roles do usuário com include de DProject
    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
        ...(cursor ? { idLocEscritu: { lt: BigInt(cursor) } } : {}),
      },
      select: {
        idLocEscritu: true,
      },
      take: take + 1,
      orderBy: { idLocEscritu: 'desc' },
    });

    const hasMore = vinculos.length > take;
    const pageVinculos = hasMore ? vinculos.slice(0, take) : vinculos;
    const projectIds = pageVinculos.map((v) => v.idLocEscritu);

    if (projectIds.length === 0) {
      return { items: [], pagination: { hasMore: false, nextCursor: null } };
    }

    // Batch: buscar DProjects + contagem de membros (2 queries adicionais)
    const [projects, memberCounts] = await Promise.all([
      this.prisma.dProject.findMany({
        where: { chave: { in: projectIds }, excluido: false },
        orderBy: { chave: 'desc' },
      }),
      this.prisma.dVincula.groupBy({
        by: ['idLocEscritu'],
        where: {
          idLocEscritu: { in: projectIds },
          idClasse: { in: PROJECT_ROLE_CLASSES },
          excluido: false,
        },
        _count: { chave: true },
      }),
    ]);

    const countMap = new Map(
      memberCounts.map((mc) => [mc.idLocEscritu.toString(), mc._count.chave]),
    );

    const items: ProjectResponseDto[] = projects.map((p) =>
      this.buildResponse(p, countMap.get(p.chave.toString()) ?? 0),
    );

    const nextCursor =
      hasMore ? pageVinculos[pageVinculos.length - 1].idLocEscritu.toString() : null;

    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Busca projeto por ID, verificando membership do usuário.
   *
   * @param id - Chave BigInt do projeto (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser membro)
   * @returns ProjectResponseDto
   *
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {ForbiddenException} Se usuário não é membro
   *
   * @example
   * ```typescript
   * const project = await service.findOne('1', BigInt(userId));
   * ```
   */
  async findOne(id: string, userEntidadeId: bigint): Promise<ProjectResponseDto> {
    const projectId = BigInt(id);

    const [project, vinculo] = await Promise.all([
      this.prisma.dProject.findFirst({
        where: { chave: projectId, excluido: false },
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: projectId,
          idEntidade: userEntidadeId,
          idClasse: { in: PROJECT_ROLE_CLASSES },
          excluido: false,
        },
        select: { chave: true },
      }),
    ]);

    if (!project) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }
    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: você não é membro deste projeto');
    }

    const memberCount = await this.prisma.dVincula.count({
      where: {
        idLocEscritu: projectId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
    });

    return this.buildResponse(project, memberCount);
  }

  /**
   * Atualiza projeto (apenas MANAGER pode).
   *
   * @param id - Chave BigInt do projeto (string)
   * @param dto - Campos a atualizar
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   * @returns ProjectResponseDto atualizada
   *
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {ForbiddenException} Se usuário não é MANAGER
   *
   * @example
   * ```typescript
   * const updated = await service.update('1', { nome: 'Novo Nome' }, BigInt(managerId));
   * ```
   */
  async update(
    id: string,
    dto: UpdateProjectDto,
    userEntidadeId: bigint,
  ): Promise<ProjectResponseDto> {
    const projectId = BigInt(id);
    await this.requireManagerRole(projectId, userEntidadeId);

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }

    const dadosAtuais = (project.dados as Record<string, unknown>) ?? {};
    const novosDados: Record<string, unknown> = {
      ...dadosAtuais,
      ...(dto.prefix !== undefined ? { prefix: dto.prefix } : {}),
      ...(dto.automationEnabled !== undefined ? { automationEnabled: dto.automationEnabled } : {}),
      ...(dto.gitRepo !== undefined ? { gitRepo: dto.gitRepo } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    };

    const updated = await this.prisma.dProject.update({
      where: { chave: projectId },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.description !== undefined ? { descricao: dto.description } : {}),
        dados: novosDados as Prisma.InputJsonValue,
      },
    });

    const memberCount = await this.prisma.dVincula.count({
      where: {
        idLocEscritu: projectId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
    });

    return this.buildResponse(updated, memberCount);
  }

  /**
   * Soft-delete do projeto.
   *
   * Cascades em transaction:
   * - DVincula de membros do projeto
   * - DTask do projeto (soft delete)
   * - DProject (soft delete)
   *
   * Audit project.deleted emitido APÓS commit.
   *
   * @param id - Chave BigInt do projeto (string)
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   *
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {ForbiddenException} Se não é MANAGER
   *
   * @example
   * ```typescript
   * await service.delete('1', BigInt(managerId));
   * ```
   */
  async delete(id: string, userEntidadeId: bigint): Promise<void> {
    const projectId = BigInt(id);
    await this.requireManagerRole(projectId, userEntidadeId);

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true, nome: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }

    await this.prisma.$transaction(async (tx) => {
      // Cascade: DVincula dos membros
      await tx.dVincula.updateMany({
        where: { idLocEscritu: projectId, excluido: false },
        data: { excluido: true },
      });

      // Cascade: DTask do projeto
      await tx.dTask.updateMany({
        where: { idProject: projectId, excluido: false },
        data: { excluido: true },
      });

      // Soft delete do projeto
      await tx.dProject.update({
        where: { chave: projectId },
        data: { excluido: true },
      });
    });

    // Audit APÓS commit
    await this.auditService.log(
      'project.deleted',
      projectId,
      { nome: project.nome, projectId: id },
      userEntidadeId,
    );

    this.logger.log(`Projeto ${projectId} deletado por user=${userEntidadeId}`);
  }

  /**
   * Retorna contadores de tasks por status V3 do projeto.
   *
   * Busca DTask do projeto agrupando por idStatus.
   * N+1 ZERO — 1 query groupBy.
   *
   * @param id - Chave BigInt do projeto (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser membro)
   * @returns Contadores por status + total
   *
   * @example
   * ```typescript
   * const stats = await service.getStats('1', BigInt(userId));
   * ```
   */
  async getStats(id: string, userEntidadeId: bigint): Promise<ProjectStatsDto> {
    // Verificar acesso
    await this.findOne(id, userEntidadeId);

    const projectId = BigInt(id);

    // Buscar DTabela dos statuses V3 do projeto para montar mapa idStatus → nome
    const statusTabelas = await this.prisma.dTabela.findMany({
      where: {
        dEntidadeId: projectId,
        idClasse: {
          in: [
            BigInt(-441), BigInt(-442), BigInt(-443), BigInt(-444), BigInt(-445),
            BigInt(-446), BigInt(-447), BigInt(-448), BigInt(-449),
          ],
        },
        excluido: false,
      },
      select: { chave: true, nome: true, idClasse: true },
    });

    const statusIdToName = new Map(
      statusTabelas.map((s) => [s.chave.toString(), s.nome]),
    );

    // Contar tasks por status
    const taskCounts = await this.prisma.dTask.groupBy({
      by: ['idStatus'],
      where: { idProject: projectId, excluido: false },
      _count: { chave: true },
    });

    const statusCounts: Record<string, number> = {};
    let totalTasks = 0;

    for (const tc of taskCounts) {
      const statusName = tc.idStatus
        ? (statusIdToName.get(tc.idStatus.toString()) ?? 'UNKNOWN')
        : 'NO_STATUS';
      statusCounts[statusName] = tc._count.chave;
      totalTasks += tc._count.chave;
    }

    return { statusCounts, totalTasks };
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  private async requireManagerRole(projectId: bigint, userId: bigint): Promise<void> {
    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectId,
        idEntidade: userId,
        idClasse: ID_CLASSE_PROJECT_MANAGER,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: requer role MANAGER no projeto');
    }
  }

  private buildResponse(
    project: {
      chave: bigint;
      nome: string;
      descricao?: string | null;
      idEstab?: bigint | null;
      dados?: unknown;
      criadoEm: Date;
      atualizadoEm: Date;
    },
    memberCount: number,
  ): ProjectResponseDto {
    const dados = project.dados as Record<string, unknown> | null;

    return {
      id: project.chave.toString(),
      nome: project.nome,
      prefix: (dados?.prefix as string | null) ?? 'DEV',
      description:
        (dados?.description as string | null | undefined) ??
        project.descricao ??
        null,
      orgId: project.idEstab?.toString() ?? null,
      memberCount,
      automationEnabled: (dados?.automationEnabled as boolean | null) ?? false,
      gitRepo: (dados?.gitRepo as string | null) ?? null,
      criadoEm: project.criadoEm.toISOString(),
      atualizadoEm: project.atualizadoEm.toISOString(),
    };
  }
}
