import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import {
  TeamResponseDto,
  ListTeamResponseDto,
  ListTeamMembersResponseDto,
  TeamMemberDto,
} from './dto/team-response.dto';

/** idClasses para times e memberships (seed F1). */
const ID_CLASSE_TEAM = BigInt(-180);
const ID_CLASSE_TEAM_MEMBERSHIP = BigInt(-181);
const ID_CLASSE_ISSUE_COUNTER = BigInt(-475);

/** idClasses de RBAC de org (para verificar membership na org). */
const ID_CLASSE_ORG_ADMIN = BigInt(-161);
const ID_CLASSE_ORG_MEMBER = BigInt(-162);
const ID_CLASSE_ORG_VIEWER = BigInt(-163);

/**
 * Service de times (DEntidade idClasse=-180).
 *
 * Implementa CRUD completo de times e gestão de memberships via DVincula -181.
 * Tabela estrutural — Pilar 1 NÃO se aplica.
 *
 * Ao criar um time, atomicamente:
 * 1. DEntidade -180 (TEAM, idEstab=orgId)
 * 2. DTabela -475 (ISSUE_COUNTER, dEntidadeId=teamId)
 * 3. DVincula -181 (TEAM_MEMBERSHIP, cargo=LEAD) para o criador
 *
 * @see PrismaService — acesso ao banco
 * @see EventProducerService — audit log canônico (F7) — não consumido neste service
 */
@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria time na organização com Issue Counter e membership LEAD.
   *
   * Valida que o prefixo é único na organização antes de criar.
   * Transaction atômica: DEntidade + DTabela + DVincula.
   *
   * @param orgId - Chave BigInt da organização pai (string)
   * @param dto - Dados do time (nome, prefix, description)
   * @param userEntidadeId - Chave BigInt do criador (será LEAD)
   * @returns TeamResponseDto com memberCount=1
   *
   * @throws {NotFoundException} Se organização não encontrada
   * @throws {ForbiddenException} Se usuário não é membro da organização
   * @throws {ConflictException} Se prefixo já existe na organização
   *
   * @example
   * ```typescript
   * const team = await service.create('100', { nome: 'Backend', prefix: 'BACK' }, BigInt(userId));
   * ```
   */
  async create(
    orgId: string,
    dto: CreateTeamDto,
    userEntidadeId: bigint,
  ): Promise<TeamResponseDto> {
    const orgIdBigInt = BigInt(orgId);
    await this.requireOrgMembership(orgIdBigInt, userEntidadeId);

    const prefix = dto.prefix ?? 'DEV';

    // Validar unicidade do prefixo na org
    const existingCounter = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: ID_CLASSE_ISSUE_COUNTER,
        excluido: false,
        dEntidadeId: {
          // teams desta org
          in: (
            await this.prisma.dEntidade.findMany({
              where: { idEstab: orgIdBigInt, idClasse: ID_CLASSE_TEAM, excluido: false },
              select: { chave: true },
            })
          ).map((t) => t.chave),
        },
      },
      select: { metaDados: true },
    });

    // Verificar se algum counter existente usa o mesmo prefix
    if (existingCounter) {
      const existingPrefix = (existingCounter.metaDados as Record<string, unknown>)?.prefix;
      if (existingPrefix === prefix) {
        throw new ConflictException(
          `Prefixo "${prefix}" já existe em outro time desta organização`,
        );
      }
    }

    this.logger.log(`Criando time nome="${dto.nome}" prefix="${prefix}" org=${orgIdBigInt}`);

    const team = await this.prisma.$transaction(async (tx) => {
      // 1. DEntidade -180 (TEAM)
      const teamEntity = await tx.dEntidade.create({
        data: {
          idClasse: ID_CLASSE_TEAM,
          nome: dto.nome,
          idEstab: orgIdBigInt,
          dados: {
            key: prefix,
            ...(dto.description && { description: dto.description }),
            ...(dto.color !== undefined && { color: dto.color }),
            ...(dto.icon !== undefined && { icon: dto.icon }),
          } as Prisma.InputJsonValue,
        },
      });

      // 2. DTabela -475 (ISSUE_COUNTER)
      await tx.dTabela.create({
        data: {
          idClasse: ID_CLASSE_ISSUE_COUNTER,
          nome: `${prefix} counter`,
          dEntidadeId: teamEntity.chave,
          metaDados: { prefix, lastSeq: 0 } as Prisma.InputJsonValue,
        },
      });

      // 3. DVincula -181 (TEAM_MEMBERSHIP LEAD)
      await tx.dVincula.create({
        data: {
          idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
          idLocEscritu: teamEntity.chave,
          idEntidade: userEntidadeId,
          metaDados: { cargo: 'LEAD' } as Prisma.InputJsonValue,
        },
      });

      return teamEntity;
    });

    // Quem cria vira LEAD do time — sempre pode editar/deletar
    return this.buildResponse(team, orgId, prefix, 1, {
      canEdit: true,
      canDelete: true,
      myCargo: 'LEAD',
    });
  }

  /**
   * Lista times de uma organização.
   *
   * @param orgId - Chave BigInt da organização (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser membro da org)
   * @param cursor - Cursor para paginação
   * @param limit - Quantidade por página
   * @returns Lista paginada de times
   *
   * @throws {ForbiddenException} Se usuário não é membro da organização
   *
   * @example
   * ```typescript
   * const { items } = await service.findByOrg('100', BigInt(userId));
   * ```
   */
  async findByOrg(
    orgId: string,
    userEntidadeId: bigint,
    cursor?: string,
    limit = 20,
  ): Promise<ListTeamResponseDto> {
    const orgIdBigInt = BigInt(orgId);
    await this.requireOrgMembership(orgIdBigInt, userEntidadeId);

    const take = Math.min(limit, 100);

    const teams = await this.prisma.dEntidade.findMany({
      where: {
        idEstab: orgIdBigInt,
        idClasse: ID_CLASSE_TEAM,
        excluido: false,
        ...(cursor && { chave: { lt: BigInt(cursor) } }),
      },
      select: {
        chave: true,
        nome: true,
        dados: true,
        idEstab: true,
        criadoEm: true,
        atualizadoEm: true,
      },
      take: take + 1,
      orderBy: { chave: 'desc' },
    });

    const hasMore = teams.length > take;
    const pageTeams = hasMore ? teams.slice(0, take) : teams;

    // Batch: contar membros por time
    const teamIds = pageTeams.map((t) => t.chave);
    const memberCounts = await this.prisma.dVincula.groupBy({
      by: ['idLocEscritu'],
      where: {
        idLocEscritu: { in: teamIds },
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
      },
      _count: { chave: true },
    });
    const countMap = new Map(
      memberCounts.map((mc) => [mc.idLocEscritu.toString(), mc._count.chave]),
    );

    // Batch: cargo do usuário em cada time + status de ADMIN na org (para canEdit/canDelete)
    const [userMemberships, orgAdminVinculo] = await Promise.all([
      teamIds.length > 0
        ? this.prisma.dVincula.findMany({
            where: {
              idLocEscritu: { in: teamIds },
              idEntidade: userEntidadeId,
              idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
              excluido: false,
            },
            select: { idLocEscritu: true, metaDados: true },
          })
        : Promise.resolve([]),
      this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: orgIdBigInt,
          idEntidade: userEntidadeId,
          idClasse: ID_CLASSE_ORG_ADMIN,
          excluido: false,
        },
        select: { chave: true },
      }),
    ]);
    const cargoMap = new Map<string, string>();
    for (const m of userMemberships) {
      const meta = m.metaDados as Record<string, unknown> | null;
      cargoMap.set(m.idLocEscritu.toString(), (meta?.cargo as string) ?? 'MEMBER');
    }
    const isOrgAdmin = !!orgAdminVinculo;

    const items = pageTeams.map((t) => {
      const dados = t.dados as Record<string, unknown> | null;
      const prefix = (dados?.key as string) ?? 'DEV';
      const cargo = cargoMap.get(t.chave.toString()) ?? null;
      const myCargo = cargo === 'LEAD' || cargo === 'MEMBER' ? (cargo as 'LEAD' | 'MEMBER') : null;
      const canManage = cargo === 'LEAD' || isOrgAdmin;
      return this.buildResponse(
        t,
        orgId,
        prefix,
        countMap.get(t.chave.toString()) ?? 0,
        { canEdit: canManage, canDelete: canManage, myCargo },
        dados,
      );
    });

    const nextCursor = hasMore ? pageTeams[pageTeams.length - 1].chave.toString() : null;
    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Lista times onde o usuário é membro (cross-org).
   *
   * Busca DVincula -181 WHERE idEntidade=userId e inclui DEntidade team.
   * N+1 ZERO — 1 query com include.
   *
   * @param userEntidadeId - Chave BigInt do usuário
   * @param cursor - Cursor para paginação
   * @param limit - Quantidade por página
   * @returns Lista paginada de times do usuário
   *
   * @example
   * ```typescript
   * const { items } = await service.findMine(BigInt(userId));
   * ```
   */
  async findMine(
    userEntidadeId: bigint,
    cursor?: string,
    limit = 20,
  ): Promise<ListTeamResponseDto> {
    const take = Math.min(limit, 100);

    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
        ...(cursor && { idLocEscritu: { lt: BigInt(cursor) } }),
      },
      include: {
        locEscritu: {
          select: {
            chave: true,
            nome: true,
            dados: true,
            idEstab: true,
            criadoEm: true,
            atualizadoEm: true,
            excluido: true,
          },
        },
      },
      take: take + 1,
      orderBy: { idLocEscritu: 'desc' },
    });

    const hasMore = vinculos.length > take;
    const pageVinculos = hasMore ? vinculos.slice(0, take) : vinculos;

    // Batch: contar membros por time
    const teamIds = pageVinculos.map((v) => v.idLocEscritu);
    const memberCounts = await this.prisma.dVincula.groupBy({
      by: ['idLocEscritu'],
      where: {
        idLocEscritu: { in: teamIds },
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
      },
      _count: { chave: true },
    });
    const countMap = new Map(
      memberCounts.map((mc) => [mc.idLocEscritu.toString(), mc._count.chave]),
    );

    // Batch: status de ADMIN nas orgs distintas dos times (para canEdit/canDelete)
    const orgIdsSet = new Set<string>();
    for (const v of pageVinculos) {
      if (v.locEscritu?.idEstab) orgIdsSet.add(v.locEscritu.idEstab.toString());
    }
    const orgIds = Array.from(orgIdsSet).map((s) => BigInt(s));
    const adminVinculos =
      orgIds.length > 0
        ? await this.prisma.dVincula.findMany({
            where: {
              idLocEscritu: { in: orgIds },
              idEntidade: userEntidadeId,
              idClasse: ID_CLASSE_ORG_ADMIN,
              excluido: false,
            },
            select: { idLocEscritu: true },
          })
        : [];
    const adminOrgSet = new Set(adminVinculos.map((a) => a.idLocEscritu.toString()));

    const items: TeamResponseDto[] = pageVinculos
      .filter((v) => v.locEscritu && !v.locEscritu.excluido)
      .map((v) => {
        const team = v.locEscritu!;
        const dados = team.dados as Record<string, unknown> | null;
        const prefix = (dados?.key as string) ?? 'DEV';
        const orgId = team.idEstab?.toString() ?? '';
        const meta = v.metaDados as Record<string, unknown> | null;
        const cargo = (meta?.cargo as string) ?? 'MEMBER';
        const myCargo =
          cargo === 'LEAD' || cargo === 'MEMBER' ? (cargo as 'LEAD' | 'MEMBER') : null;
        const canManage = cargo === 'LEAD' || adminOrgSet.has(orgId);
        return this.buildResponse(
          team,
          orgId,
          prefix,
          countMap.get(team.chave.toString()) ?? 0,
          { canEdit: canManage, canDelete: canManage, myCargo },
          dados,
        );
      });

    const nextCursor = hasMore
      ? pageVinculos[pageVinculos.length - 1].idLocEscritu.toString()
      : null;
    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Busca time por ID.
   *
   * @param id - Chave BigInt do time (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser membro do time)
   * @returns TeamResponseDto
   *
   * @throws {NotFoundException} Se time não encontrado
   * @throws {ForbiddenException} Se não é membro do time
   *
   * @example
   * ```typescript
   * const team = await service.findOne('200', BigInt(userId));
   * ```
   */
  async findOne(id: string, userEntidadeId: bigint): Promise<TeamResponseDto> {
    const teamId = BigInt(id);

    const [team, membership] = await Promise.all([
      this.prisma.dEntidade.findFirst({
        where: { chave: teamId, idClasse: ID_CLASSE_TEAM, excluido: false },
        select: {
          chave: true,
          nome: true,
          dados: true,
          idEstab: true,
          criadoEm: true,
          atualizadoEm: true,
        },
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: teamId,
          idEntidade: userEntidadeId,
          idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
          excluido: false,
        },
        select: { chave: true, metaDados: true },
      }),
    ]);

    if (!team) {
      throw new NotFoundException(`Time ${id} não encontrado`);
    }
    if (!membership) {
      throw new ForbiddenException('Acesso negado: você não é membro deste time');
    }

    const meta = membership.metaDados as Record<string, unknown> | null;
    const cargo = (meta?.cargo as string) ?? 'MEMBER';
    const myCargo = cargo === 'LEAD' || cargo === 'MEMBER' ? (cargo as 'LEAD' | 'MEMBER') : null;
    // Só checa ADMIN da org se ainda não for LEAD (otimização: evita query desnecessária)
    let isOrgAdmin = false;
    if (cargo !== 'LEAD' && team.idEstab) {
      const adminVinculo = await this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: team.idEstab,
          idEntidade: userEntidadeId,
          idClasse: ID_CLASSE_ORG_ADMIN,
          excluido: false,
        },
        select: { chave: true },
      });
      isOrgAdmin = !!adminVinculo;
    }
    const canManage = cargo === 'LEAD' || isOrgAdmin;

    const memberCount = await this.prisma.dVincula.count({
      where: { idLocEscritu: teamId, idClasse: ID_CLASSE_TEAM_MEMBERSHIP, excluido: false },
    });

    const dados = team.dados as Record<string, unknown> | null;
    const prefix = (dados?.key as string) ?? 'DEV';
    const orgId = team.idEstab?.toString() ?? '';
    return this.buildResponse(
      team,
      orgId,
      prefix,
      memberCount,
      { canEdit: canManage, canDelete: canManage, myCargo },
      dados,
    );
  }

  /**
   * Atualiza time (apenas LEAD ou ADMIN da org pode).
   *
   * @param id - Chave BigInt do time (string)
   * @param dto - Campos a atualizar
   * @param userEntidadeId - Chave BigInt do usuário
   * @returns TeamResponseDto atualizado
   *
   * @throws {NotFoundException} Se time não encontrado
   * @throws {ForbiddenException} Se não é LEAD do time
   *
   * @example
   * ```typescript
   * const updated = await service.update('200', { nome: 'Novo Nome' }, BigInt(userId));
   * ```
   */
  async update(id: string, dto: UpdateTeamDto, userEntidadeId: bigint): Promise<TeamResponseDto> {
    const teamId = BigInt(id);

    const team = await this.prisma.dEntidade.findFirst({
      where: { chave: teamId, idClasse: ID_CLASSE_TEAM, excluido: false },
      select: {
        chave: true,
        nome: true,
        dados: true,
        idEstab: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    if (!team) {
      throw new NotFoundException(`Time ${id} não encontrado`);
    }

    await this.requireLeadOrAdminRole(teamId, team.idEstab, userEntidadeId);

    const dadosAtuais = (team.dados as Record<string, unknown>) ?? {};
    const novosDados: Record<string, unknown> = {
      ...dadosAtuais,
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.icon !== undefined && { icon: dto.icon }),
    };

    const updated = await this.prisma.dEntidade.update({
      where: { chave: teamId },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        dados: novosDados as Prisma.InputJsonValue,
      },
      select: {
        chave: true,
        nome: true,
        dados: true,
        idEstab: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    const [memberCount, userMembership] = await Promise.all([
      this.prisma.dVincula.count({
        where: { idLocEscritu: teamId, idClasse: ID_CLASSE_TEAM_MEMBERSHIP, excluido: false },
      }),
      // Re-busca cargo do usuário para preencher myCargo (pode ser ADMIN da
      // org que editou um time sem ser membro — nesse caso myCargo=null).
      this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: teamId,
          idEntidade: userEntidadeId,
          idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
          excluido: false,
        },
        select: { metaDados: true },
      }),
    ]);
    const userMeta = userMembership?.metaDados as Record<string, unknown> | null;
    const userCargo = userMeta?.cargo as string | undefined;
    const myCargo =
      userCargo === 'LEAD' || userCargo === 'MEMBER' ? (userCargo as 'LEAD' | 'MEMBER') : null;

    const updatedDados = updated.dados as Record<string, unknown> | null;
    const prefix = (updatedDados?.key as string) ?? 'DEV';
    const orgId = updated.idEstab?.toString() ?? '';
    // requireLeadOrAdminRole acima já validou: quem chega aqui pode editar e deletar
    return this.buildResponse(
      updated,
      orgId,
      prefix,
      memberCount,
      { canEdit: true, canDelete: true, myCargo },
      updatedDados,
    );
  }

  /**
   * Soft-delete de time.
   *
   * @param id - Chave BigInt do time (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser LEAD ou ADMIN da org)
   *
   * @throws {NotFoundException} Se time não encontrado
   * @throws {ForbiddenException} Se não autorizado
   *
   * @example
   * ```typescript
   * await service.delete('200', BigInt(userId));
   * ```
   */
  async delete(id: string, userEntidadeId: bigint): Promise<void> {
    const teamId = BigInt(id);

    const team = await this.prisma.dEntidade.findFirst({
      where: { chave: teamId, idClasse: ID_CLASSE_TEAM, excluido: false },
      select: { chave: true, idEstab: true },
    });

    if (!team) {
      throw new NotFoundException(`Time ${id} não encontrado`);
    }

    await this.requireLeadOrAdminRole(teamId, team.idEstab, userEntidadeId);

    await this.prisma.$transaction(async (tx) => {
      // Cascade: DVincula memberships
      await tx.dVincula.updateMany({
        where: { idLocEscritu: teamId, idClasse: ID_CLASSE_TEAM_MEMBERSHIP, excluido: false },
        data: { excluido: true },
      });

      // Cascade: DTabela ISSUE_COUNTER
      await tx.dTabela.updateMany({
        where: { dEntidadeId: teamId, idClasse: ID_CLASSE_ISSUE_COUNTER, excluido: false },
        data: { excluido: true },
      });

      // Soft delete do time
      await tx.dEntidade.update({
        where: { chave: teamId },
        data: { excluido: true },
      });
    });

    this.logger.log(`Time ${teamId} deletado por user=${userEntidadeId}`);
  }

  /**
   * Lista membros de um time.
   *
   * @param id - Chave BigInt do time (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser membro)
   * @returns Lista de membros com cargo
   *
   * @throws {ForbiddenException} Se não é membro
   *
   * @example
   * ```typescript
   * const { members } = await service.getMembers('200', BigInt(userId));
   * ```
   */
  async getMembers(id: string, userEntidadeId: bigint): Promise<ListTeamMembersResponseDto> {
    await this.findOne(id, userEntidadeId); // valida membership

    const teamId = BigInt(id);

    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idLocEscritu: teamId,
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
      },
      include: {
        entidade: {
          select: { chave: true, nome: true, email: true },
        },
      },
      orderBy: { criadoEm: 'asc' },
    });

    const members: TeamMemberDto[] = vinculos
      .filter((v) => v.entidade)
      .map((v) => {
        const meta = v.metaDados as Record<string, unknown> | null;
        return {
          userId: v.idEntidade!.toString(),
          nome: v.entidade!.nome,
          email: v.entidade!.email,
          cargo: (meta?.cargo as string) ?? 'MEMBER',
        };
      });

    return { members };
  }

  /**
   * Adiciona membro ao time.
   *
   * Apenas LEAD do time pode adicionar membros.
   *
   * @param id - Chave BigInt do time (string)
   * @param dto - userId e cargo
   * @param userEntidadeId - Chave BigInt do LEAD executante
   *
   * @throws {NotFoundException} Se time ou usuário não encontrados
   * @throws {ForbiddenException} Se não é LEAD
   * @throws {ConflictException} Se já é membro
   *
   * @example
   * ```typescript
   * await service.addMember('200', { userId: '300', cargo: 'MEMBER' }, BigInt(leadId));
   * ```
   */
  async addMember(id: string, dto: AddTeamMemberDto, userEntidadeId: bigint): Promise<void> {
    const teamId = BigInt(id);

    const team = await this.prisma.dEntidade.findFirst({
      where: { chave: teamId, idClasse: ID_CLASSE_TEAM, excluido: false },
      select: { chave: true, idEstab: true },
    });

    if (!team) {
      throw new NotFoundException(`Time ${id} não encontrado`);
    }

    await this.requireLeadOrAdminRole(teamId, team.idEstab, userEntidadeId);

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
        idLocEscritu: teamId,
        idEntidade: targetId,
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
      },
      select: { chave: true },
    });
    if (existing) {
      throw new ConflictException(`Usuário ${dto.userId} já é membro deste time`);
    }

    await this.prisma.dVincula.create({
      data: {
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        idLocEscritu: teamId,
        idEntidade: targetId,
        metaDados: { cargo: dto.cargo } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Membro ${targetId} adicionado ao time ${teamId} com cargo ${dto.cargo}`);
  }

  /**
   * Atualiza cargo de membro no time.
   *
   * @param id - Chave BigInt do time (string)
   * @param memberId - Chave BigInt da DEntidade do membro (string)
   * @param cargo - Novo cargo (LEAD ou MEMBER)
   * @param userEntidadeId - Chave BigInt do LEAD executante
   *
   * @throws {NotFoundException} Se membro não encontrado
   * @throws {ForbiddenException} Se não é LEAD
   *
   * @example
   * ```typescript
   * await service.updateMemberCargo('200', '300', 'LEAD', BigInt(leadId));
   * ```
   */
  async updateMemberCargo(
    id: string,
    memberId: string,
    cargo: 'LEAD' | 'MEMBER',
    userEntidadeId: bigint,
  ): Promise<void> {
    const teamId = BigInt(id);

    const team = await this.prisma.dEntidade.findFirst({
      where: { chave: teamId, idClasse: ID_CLASSE_TEAM, excluido: false },
      select: { chave: true, idEstab: true },
    });
    if (!team) {
      throw new NotFoundException(`Time ${id} não encontrado`);
    }

    await this.requireLeadOrAdminRole(teamId, team.idEstab, userEntidadeId);

    const memberIdBigInt = BigInt(memberId);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: teamId,
        idEntidade: memberIdBigInt,
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
      },
      select: { chave: true, metaDados: true },
    });

    if (!vinculo) {
      throw new NotFoundException(`Membro ${memberId} não encontrado no time ${id}`);
    }

    const metaDadosAtuais = (vinculo.metaDados as Record<string, unknown>) ?? {};

    await this.prisma.dVincula.update({
      where: { chave: vinculo.chave },
      data: {
        metaDados: { ...metaDadosAtuais, cargo } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Remove membro do time.
   *
   * @param id - Chave BigInt do time (string)
   * @param memberId - Chave BigInt da DEntidade do membro (string)
   * @param userEntidadeId - Chave BigInt do LEAD executante
   *
   * @throws {NotFoundException} Se membro não encontrado
   * @throws {ForbiddenException} Se não é LEAD
   *
   * @example
   * ```typescript
   * await service.removeMember('200', '300', BigInt(leadId));
   * ```
   */
  async removeMember(id: string, memberId: string, userEntidadeId: bigint): Promise<void> {
    const teamId = BigInt(id);

    const team = await this.prisma.dEntidade.findFirst({
      where: { chave: teamId, idClasse: ID_CLASSE_TEAM, excluido: false },
      select: { chave: true, idEstab: true },
    });
    if (!team) {
      throw new NotFoundException(`Time ${id} não encontrado`);
    }

    await this.requireLeadOrAdminRole(teamId, team.idEstab, userEntidadeId);

    const memberIdBigInt = BigInt(memberId);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: teamId,
        idEntidade: memberIdBigInt,
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!vinculo) {
      throw new NotFoundException(`Membro ${memberId} não encontrado no time ${id}`);
    }

    await this.prisma.dVincula.update({
      where: { chave: vinculo.chave },
      data: { excluido: true },
    });
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Verifica que o usuário é membro da organização (qualquer role).
   */
  private async requireOrgMembership(orgId: bigint, userEntidadeId: bigint): Promise<void> {
    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: orgId,
        idEntidade: userEntidadeId,
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
      },
      select: { chave: true },
    });

    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: você não é membro desta organização');
    }
  }

  /**
   * Verifica que o usuário é LEAD do time ou ADMIN da organização.
   *
   * @param teamId - Chave BigInt do time
   * @param orgId - Chave BigInt da organização (pode ser null para times sem org)
   * @param userEntidadeId - Chave BigInt do usuário
   * @throws {ForbiddenException} Se não tem permissão
   */
  private async requireLeadOrAdminRole(
    teamId: bigint,
    orgId: bigint | null | undefined,
    userEntidadeId: bigint,
  ): Promise<void> {
    const membership = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: teamId,
        idEntidade: userEntidadeId,
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
      },
      select: { metaDados: true },
    });

    const meta = membership?.metaDados as Record<string, unknown> | null;
    const cargo = meta?.cargo as string | undefined;

    if (cargo === 'LEAD') {
      return; // LEAD do time — autorizado
    }

    // Verificar se é ADMIN da organização
    if (orgId) {
      const isOrgAdmin = await this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: orgId,
          idEntidade: userEntidadeId,
          idClasse: ID_CLASSE_ORG_ADMIN,
          excluido: false,
        },
        select: { chave: true },
      });

      if (isOrgAdmin) {
        return; // ADMIN da org — autorizado
      }
    }

    throw new ForbiddenException(
      'Acesso negado: requer cargo LEAD no time ou ADMIN na organização',
    );
  }

  /**
   * Constrói TeamResponseDto a partir de dados brutos.
   *
   * @param permissions - Flags canEdit/canDelete já calculadas pelo caller.
   *   Os callers que listam (findByOrg, findMine) calculam em batch para evitar N+1.
   */
  private buildResponse(
    team: {
      chave: bigint;
      nome: string;
      dados?: unknown;
      idEstab?: bigint | null;
      criadoEm: Date;
      atualizadoEm: Date;
    },
    orgId: string,
    prefix: string,
    memberCount: number,
    permissions: {
      canEdit: boolean;
      canDelete: boolean;
      myCargo: 'LEAD' | 'MEMBER' | null;
    },
    dados?: Record<string, unknown> | null,
  ): TeamResponseDto {
    const teamDados = dados ?? (team.dados as Record<string, unknown> | null);
    return {
      id: team.chave.toString(),
      nome: team.nome,
      orgId: orgId || team.idEstab?.toString() || '',
      prefix,
      description: (teamDados?.description as string | null | undefined) ?? null,
      color: (teamDados?.color as string | null | undefined) ?? null,
      icon: (teamDados?.icon as string | null | undefined) ?? null,
      memberCount,
      criadoEm: team.criadoEm.toISOString(),
      atualizadoEm: team.atualizadoEm.toISOString(),
      canEdit: permissions.canEdit,
      canDelete: permissions.canDelete,
      myCargo: permissions.myCargo,
    };
  }
}
