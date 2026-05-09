import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  AddProjectMemberDto,
  UpdateProjectMemberDto,
} from './dto/add-project-member.dto';
import {
  ListProjectMembersResponseDto,
  ProjectMemberDto,
} from './dto/project-response.dto';

/** idClasses DVincula para RBAC de projeto (seed F1). */
const ID_CLASSE_PROJECT_MANAGER = BigInt(-171);
const ID_CLASSE_PROJECT_MEMBER = BigInt(-172);
const ID_CLASSE_PROJECT_VIEWER = BigInt(-173);

const PROJECT_ROLE_CLASSES = [
  ID_CLASSE_PROJECT_MANAGER,
  ID_CLASSE_PROJECT_MEMBER,
  ID_CLASSE_PROJECT_VIEWER,
];

const ROLE_TO_CLASSE: Record<string, bigint> = {
  MANAGER: ID_CLASSE_PROJECT_MANAGER,
  MEMBER: ID_CLASSE_PROJECT_MEMBER,
  VIEWER: ID_CLASSE_PROJECT_VIEWER,
};

const CLASSE_TO_ROLE: Record<string, string> = {
  [ID_CLASSE_PROJECT_MANAGER.toString()]: 'MANAGER',
  [ID_CLASSE_PROJECT_MEMBER.toString()]: 'MEMBER',
  [ID_CLASSE_PROJECT_VIEWER.toString()]: 'VIEWER',
};

/**
 * Service de membros de projeto.
 *
 * Gerencia DVincula -171/-172/-173 (MANAGER/MEMBER/VIEWER) de projetos.
 * idLocEscritu=projectId, idEntidade=userEntidadeId.
 *
 * @example
 * ```typescript
 * const members = await service.getMembers('1');
 * await service.addMember('1', { userId: '200', role: 'MEMBER' }, BigInt(adminId));
 * ```
 */
@Injectable()
export class ProjectMembersService {
  private readonly logger = new Logger(ProjectMembersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista membros do projeto com roles.
   *
   * Busca DVincula in [-171,-172,-173] com include da DEntidade.
   * N+1 ZERO — 1 query com include.
   *
   * @param projectId - Chave BigInt do projeto (string)
   * @returns Lista de membros com roles
   *
   * @throws {NotFoundException} Se projeto não encontrado
   *
   * @example
   * ```typescript
   * const { members } = await service.getMembers('1');
   * ```
   */
  async getMembers(projectId: string): Promise<ListProjectMembersResponseDto> {
    const projectIdBigInt = BigInt(projectId);

    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idLocEscritu: projectIdBigInt,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
      include: {
        entidade: {
          select: { chave: true, nome: true, email: true },
        },
      },
      orderBy: { idClasse: 'asc' },
    });

    const members: ProjectMemberDto[] = vinculos
      .filter((v) => v.entidade)
      .map((v) => {
        const meta = v.metaDados as Record<string, unknown> | null;
        return {
          userId: v.idEntidade!.toString(),
          nome: v.entidade!.nome,
          email: v.entidade!.email ?? null,
          role: CLASSE_TO_ROLE[v.idClasse.toString()] ?? 'MEMBER',
          cargo: (meta?.cargo as string | null) ?? null,
        };
      });

    return { members };
  }

  /**
   * Adiciona membro ao projeto.
   *
   * Cria DVincula com idClasse correspondente ao role.
   * Apenas MANAGER pode adicionar membros.
   *
   * @param projectId - Chave BigInt do projeto (string)
   * @param dto - userId, role e cargo opcional
   * @param requesterId - Chave BigInt do MANAGER que executa a ação
   *
   * @throws {ForbiddenException} Se executante não é MANAGER
   * @throws {NotFoundException} Se usuário alvo não encontrado
   * @throws {ConflictException} Se usuário já é membro
   *
   * @example
   * ```typescript
   * await service.addMember('1', { userId: '200', role: 'MEMBER' }, BigInt(managerId));
   * ```
   */
  async addMember(
    projectId: string,
    dto: AddProjectMemberDto,
    requesterId: bigint,
  ): Promise<void> {
    const projectIdBigInt = BigInt(projectId);
    await this.requireManagerRole(projectIdBigInt, requesterId);

    const targetId = BigInt(dto.userId);

    const targetUser = await this.prisma.dEntidade.findFirst({
      where: { chave: targetId, excluido: false },
      select: { chave: true },
    });
    if (!targetUser) {
      throw new NotFoundException(`Usuário ${dto.userId} não encontrado`);
    }

    const existing = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectIdBigInt,
        idEntidade: targetId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
      select: { chave: true },
    });
    if (existing) {
      throw new ConflictException(`Usuário ${dto.userId} já é membro deste projeto`);
    }

    const idClasse = ROLE_TO_CLASSE[dto.role];
    await this.prisma.dVincula.create({
      data: {
        idClasse,
        idLocEscritu: projectIdBigInt,
        idEntidade: targetId,
        metaDados: { role: dto.role, cargo: dto.cargo ?? null } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `addMember: user=${targetId} adicionado ao projeto=${projectIdBigInt} como ${dto.role}`,
    );
  }

  /**
   * Atualiza role/cargo de membro no projeto.
   *
   * Apenas MANAGER pode alterar roles.
   *
   * @param projectId - Chave BigInt do projeto (string)
   * @param userId - Chave BigInt da DEntidade do membro (string)
   * @param dto - Novo role e cargo opcional
   * @param requesterId - Chave BigInt do MANAGER executante
   *
   * @throws {ForbiddenException} Se executante não é MANAGER
   * @throws {NotFoundException} Se membro não encontrado no projeto
   *
   * @example
   * ```typescript
   * await service.updateMember('1', '200', { role: 'MANAGER' }, BigInt(managerId));
   * ```
   */
  async updateMember(
    projectId: string,
    userId: string,
    dto: UpdateProjectMemberDto,
    requesterId: bigint,
  ): Promise<void> {
    const projectIdBigInt = BigInt(projectId);
    await this.requireManagerRole(projectIdBigInt, requesterId);

    const userIdBigInt = BigInt(userId);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectIdBigInt,
        idEntidade: userIdBigInt,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
      select: { chave: true, metaDados: true },
    });

    if (!vinculo) {
      throw new NotFoundException(`Membro ${userId} não encontrado no projeto ${projectId}`);
    }

    const idClasse = ROLE_TO_CLASSE[dto.role];
    const metaAtual = (vinculo.metaDados as Record<string, unknown>) ?? {};

    await this.prisma.dVincula.update({
      where: { chave: vinculo.chave },
      data: {
        idClasse,
        metaDados: {
          ...metaAtual,
          role: dto.role,
          ...(dto.cargo !== undefined ? { cargo: dto.cargo } : {}),
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `updateMember: user=${userIdBigInt} no projeto=${projectIdBigInt} → role=${dto.role}`,
    );
  }

  /**
   * Remove membro do projeto (soft delete do DVincula).
   *
   * Apenas MANAGER pode remover. Não pode remover o último MANAGER.
   *
   * @param projectId - Chave BigInt do projeto (string)
   * @param userId - Chave BigInt da DEntidade do membro (string)
   * @param requesterId - Chave BigInt do MANAGER executante
   *
   * @throws {ForbiddenException} Se executante não é MANAGER, ou se é o último
   * @throws {NotFoundException} Se membro não encontrado
   *
   * @example
   * ```typescript
   * await service.removeMember('1', '200', BigInt(managerId));
   * ```
   */
  async removeMember(
    projectId: string,
    userId: string,
    requesterId: bigint,
  ): Promise<void> {
    const projectIdBigInt = BigInt(projectId);
    await this.requireManagerRole(projectIdBigInt, requesterId);

    const userIdBigInt = BigInt(userId);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectIdBigInt,
        idEntidade: userIdBigInt,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
      select: { chave: true, idClasse: true },
    });

    if (!vinculo) {
      throw new NotFoundException(`Membro ${userId} não encontrado no projeto ${projectId}`);
    }

    // Não pode remover o último MANAGER
    if (vinculo.idClasse === ID_CLASSE_PROJECT_MANAGER) {
      const managerCount = await this.prisma.dVincula.count({
        where: {
          idLocEscritu: projectIdBigInt,
          idClasse: ID_CLASSE_PROJECT_MANAGER,
          excluido: false,
        },
      });
      if (managerCount <= 1) {
        throw new ForbiddenException('Não é possível remover o único MANAGER do projeto');
      }
    }

    await this.prisma.dVincula.update({
      where: { chave: vinculo.chave },
      data: { excluido: true },
    });

    this.logger.log(`removeMember: user=${userIdBigInt} removido do projeto=${projectIdBigInt}`);
  }

  /**
   * Cria o DVincula inicial de MANAGER para o criador do projeto.
   * Chamado dentro de transaction em ProjectsService.create().
   *
   * @param tx - Prisma transaction client
   * @param projectId - Chave BigInt do projeto
   * @param userEntidadeId - Chave BigInt da DEntidade do criador
   *
   * @example
   * ```typescript
   * await this.projectMembersService.createManagerLink(tx, project.chave, creatorId);
   * ```
   */
  async createManagerLink(
    tx: Prisma.TransactionClient,
    projectId: bigint,
    userEntidadeId: bigint,
  ): Promise<void> {
    await tx.dVincula.create({
      data: {
        idClasse: ID_CLASSE_PROJECT_MANAGER,
        idLocEscritu: projectId,
        idEntidade: userEntidadeId,
        metaDados: { role: 'MANAGER', cargo: 'Project Manager' } as Prisma.InputJsonValue,
      },
    });
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
}
