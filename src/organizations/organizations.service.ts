import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddOrgMemberDto } from './dto/add-org-member.dto';
import { UpdateOrgMemberRoleDto } from './dto/update-org-member-role.dto';
import {
  OrganizationResponseDto,
  ListOrganizationResponseDto,
  OrgMemberDto,
  ListOrgMembersResponseDto,
} from './dto/organization-response.dto';

/** idClasses de DEntidade para o domínio Scrumban (seed F1). */
const ID_CLASSE_ORGANIZATION = BigInt(-152);
const ID_CLASSE_TEAM = BigInt(-180);

/** idClasses de DVincula para RBAC de org (seed F1). */
const ID_CLASSE_ORG_ADMIN = BigInt(-161);
const ID_CLASSE_ORG_MEMBER = BigInt(-162);
const ID_CLASSE_ORG_VIEWER = BigInt(-163);
const ID_CLASSE_TEAM_MEMBERSHIP = BigInt(-181);

/** idClasse DTabela para issue counter por team (seed F1). */
const ID_CLASSE_ISSUE_COUNTER = BigInt(-475);

// idClasse DEvento para org lifecycle: -500 ORG_LIFECYCLE (ADR-V2-027)
// type='org.created'/'org.updated'/'org.deleted' → idClasse=-500 + metaDados._meta.action

/** Mapa de role string para idClasse DVincula. */
const ROLE_TO_CLASSE: Record<string, bigint> = {
  ADMIN: ID_CLASSE_ORG_ADMIN,
  MEMBER: ID_CLASSE_ORG_MEMBER,
  VIEWER: ID_CLASSE_ORG_VIEWER,
};

/** Mapa de idClasse DVincula para role string. */
const CLASSE_TO_ROLE: Record<string, string> = {
  [ID_CLASSE_ORG_ADMIN.toString()]: 'ADMIN',
  [ID_CLASSE_ORG_MEMBER.toString()]: 'MEMBER',
  [ID_CLASSE_ORG_VIEWER.toString()]: 'VIEWER',
};

/**
 * Service de organizações (DEntidade idClasse=-152).
 *
 * Implementa CRUD completo de organizações usando Prisma direto em transactions
 * atômicas (cadastro estrutural — Pilar 1 NÃO se aplica).
 *
 * RBAC via DVincula:
 * - ADMIN (-161): acesso total
 * - MEMBER (-162): acesso operacional
 * - VIEWER (-163): somente leitura
 *
 * Ao criar uma organização, cria atomicamente:
 * 1. DEntidade -152 (ORGANIZATION)
 * 2. DEntidade -180 (TEAM "Default Team")
 * 3. DTabela -475 (ISSUE_COUNTER para o team)
 * 4. DVincula -161 (ADMIN) para o criador
 * 5. DVincula -181 (TEAM_MEMBERSHIP LEAD) para o criador
 *
 * @see PrismaService — acesso ao banco
 * @see EventProducerService — emissão canônica de eventos (audit pós-commit)
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
  ) {}

  /**
   * Cria organização completa com Default Team, Issue Counter e memberships.
   *
   * Transaction atômica (5 operações):
   * 1. DEntidade -152 (ORGANIZATION)
   * 2. DEntidade -180 (TEAM "Default Team", idEstab=orgId)
   * 3. DTabela -475 (ISSUE_COUNTER, dEntidadeId=teamId, metaDados={prefix:'DEV',lastSeq:0})
   * 4. DVincula -161 (ORG_ROLE_ADMIN, idLocEscritu=orgId, idEntidade=userEntidadeId)
   * 5. DVincula -181 (TEAM_MEMBERSHIP, idLocEscritu=teamId, idEntidade=userEntidadeId, cargo=LEAD)
   *
   * Audit de org.created emitido APÓS commit.
   *
   * @param dto - Dados da nova organização
   * @param userEntidadeId - Chave BigInt da DEntidade do criador (ADMIN)
   * @returns OrganizationResponseDto com memberCount=1
   *
   * @throws {NotFoundException} Se DClasse não encontrada no seed
   *
   * @example
   * ```typescript
   * const org = await service.create({ nome: 'Acme Corp' }, BigInt(userEntidadeId));
   * ```
   */
  async create(
    dto: CreateOrganizationDto,
    userEntidadeId: bigint,
  ): Promise<OrganizationResponseDto> {
    this.logger.log(`Criando organização nome="${dto.nome}" para user=${userEntidadeId}`);

    const org = await this.prisma.$transaction(async (tx) => {
      // 1. DEntidade -152 (ORGANIZATION)
      const orgEntity = await tx.dEntidade.create({
        data: {
          idClasse: ID_CLASSE_ORGANIZATION,
          nome: dto.nome,
          ...(dto.description && {
            dados: { description: dto.description } as Prisma.InputJsonValue,
          }),
        },
      });

      // 2. DEntidade -180 (TEAM "Default Team", idEstab=orgId)
      const teamEntity = await tx.dEntidade.create({
        data: {
          idClasse: ID_CLASSE_TEAM,
          nome: 'Default Team',
          idEstab: orgEntity.chave,
          dados: { key: 'DEV' } as Prisma.InputJsonValue,
        },
      });

      // 3. DTabela -475 (ISSUE_COUNTER, dEntidadeId=teamId)
      await tx.dTabela.create({
        data: {
          idClasse: ID_CLASSE_ISSUE_COUNTER,
          nome: 'DEV counter',
          dEntidadeId: teamEntity.chave,
          metaDados: { prefix: 'DEV', lastSeq: 0 } as Prisma.InputJsonValue,
        },
      });

      // 4. DVincula -161 (ORG_ROLE_ADMIN): criador é ADMIN da org
      await tx.dVincula.create({
        data: {
          idClasse: ID_CLASSE_ORG_ADMIN,
          idLocEscritu: orgEntity.chave,
          idEntidade: userEntidadeId,
          metaDados: { cargo: 'ADMIN' } as Prisma.InputJsonValue,
        },
      });

      // 5. DVincula -181 (TEAM_MEMBERSHIP): criador é LEAD do Default Team
      await tx.dVincula.create({
        data: {
          idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
          idLocEscritu: teamEntity.chave,
          idEntidade: userEntidadeId,
          metaDados: { cargo: 'LEAD' } as Prisma.InputJsonValue,
        },
      });

      return orgEntity;
    });

    // Audit APÓS commit (nunca dentro da transaction)
    // Tipo org.created → idClasse=-500 ORG_LIFECYCLE (ADR-V2-027)
    await this.eventProducer.addInternalEvent(
      'org.created',
      {
        orgId: org.chave.toString(),
        nome: dto.nome,
        userId: userEntidadeId.toString(),
      },
      this.correlationIdService.getOrGenerate(),
      { source: OrganizationsService.name },
    );

    return this.buildResponse(org, 1);
  }

  /**
   * Lista organizações onde o usuário é membro (qualquer role).
   *
   * Busca DVincula idClasse in [-161,-162,-163] WHERE idEntidade=userEntidadeId
   * e retorna as DEntidades org correspondentes.
   * N+1 ZERO — 1 query principal com include.
   *
   * @param userEntidadeId - Chave BigInt da DEntidade do usuário
   * @param cursor - Cursor para paginação (última chave retornada)
   * @param limit - Quantidade de itens por página (default: 20, max: 100)
   * @returns Lista paginada de organizações
   *
   * @example
   * ```typescript
   * const { items, pagination } = await service.findMany(BigInt(userId));
   * ```
   */
  async findMany(
    userEntidadeId: bigint,
    cursor?: string,
    limit = 20,
  ): Promise<ListOrganizationResponseDto> {
    const take = Math.min(limit, 100);

    // Query: DVincula das org-roles do usuário — sem N+1 via include
    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
        ...(cursor && { idLocEscritu: { lt: BigInt(cursor) } }),
      },
      include: {
        locEscritu: {
          select: {
            chave: true,
            nome: true,
            dados: true,
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

    // Contar membros por org em batch (1 query adicional)
    const orgIds = pageVinculos.map((v) => v.idLocEscritu);
    const memberCounts = await this.prisma.dVincula.groupBy({
      by: ['idLocEscritu'],
      where: {
        idLocEscritu: { in: orgIds },
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
      },
      _count: { chave: true },
    });

    const countMap = new Map(
      memberCounts.map((mc) => [mc.idLocEscritu.toString(), mc._count.chave]),
    );

    const items: OrganizationResponseDto[] = pageVinculos
      .filter((v) => v.locEscritu && !v.locEscritu.excluido)
      .map((v) => {
        const org = v.locEscritu!;
        const orgDados = org.dados as Record<string, unknown> | null;
        return this.buildResponse(
          org,
          countMap.get(org.chave.toString()) ?? 0,
          orgDados,
        );
      });

    const nextCursor =
      hasMore ? pageVinculos[pageVinculos.length - 1].idLocEscritu.toString() : null;

    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Busca organização por ID, verificando que o usuário é membro.
   *
   * @param id - Chave BigInt da organização (string)
   * @param userEntidadeId - Chave BigInt da DEntidade do usuário
   * @returns OrganizationResponseDto com memberCount
   *
   * @throws {NotFoundException} Se organização não encontrada
   * @throws {ForbiddenException} Se usuário não é membro da organização
   *
   * @example
   * ```typescript
   * const org = await service.findOne('100', BigInt(userEntidadeId));
   * ```
   */
  async findOne(id: string, userEntidadeId: bigint): Promise<OrganizationResponseDto> {
    const orgId = BigInt(id);

    const [org, vinculo] = await Promise.all([
      this.prisma.dEntidade.findFirst({
        where: { chave: orgId, idClasse: ID_CLASSE_ORGANIZATION, excluido: false },
        select: { chave: true, nome: true, dados: true, criadoEm: true, atualizadoEm: true },
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: orgId,
          idEntidade: userEntidadeId,
          idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
          excluido: false,
        },
        select: { chave: true },
      }),
    ]);

    if (!org) {
      throw new NotFoundException(`Organização ${id} não encontrada`);
    }
    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: você não é membro desta organização');
    }

    const memberCount = await this.prisma.dVincula.count({
      where: {
        idLocEscritu: orgId,
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
      },
    });

    const orgDados = org.dados as Record<string, unknown> | null;
    return this.buildResponse(org, memberCount, orgDados);
  }

  /**
   * Atualiza organização (apenas ADMIN pode).
   *
   * @param id - Chave BigInt da organização (string)
   * @param dto - Campos a atualizar
   * @param userEntidadeId - Chave BigInt do usuário que atualiza (deve ser ADMIN)
   * @returns OrganizationResponseDto atualizada
   *
   * @throws {NotFoundException} Se organização não encontrada
   * @throws {ForbiddenException} Se usuário não é ADMIN da organização
   *
   * @example
   * ```typescript
   * const updated = await service.update('100', { nome: 'Novo Nome' }, BigInt(userId));
   * ```
   */
  async update(
    id: string,
    dto: UpdateOrganizationDto,
    userEntidadeId: bigint,
  ): Promise<OrganizationResponseDto> {
    const orgId = BigInt(id);
    await this.requireAdminRole(orgId, userEntidadeId);

    const org = await this.prisma.dEntidade.findFirst({
      where: { chave: orgId, idClasse: ID_CLASSE_ORGANIZATION, excluido: false },
      select: { chave: true, dados: true },
    });

    if (!org) {
      throw new NotFoundException(`Organização ${id} não encontrada`);
    }

    const dadosAtuais = (org.dados as Record<string, unknown>) ?? {};
    const novosDados: Record<string, unknown> = {
      ...dadosAtuais,
      ...(dto.description !== undefined && { description: dto.description }),
    };

    const updated = await this.prisma.dEntidade.update({
      where: { chave: orgId },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        dados: novosDados as Prisma.InputJsonValue,
      },
      select: { chave: true, nome: true, dados: true, criadoEm: true, atualizadoEm: true },
    });

    const memberCount = await this.prisma.dVincula.count({
      where: {
        idLocEscritu: orgId,
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
      },
    });

    const updatedDados = updated.dados as Record<string, unknown> | null;
    return this.buildResponse(updated, memberCount, updatedDados);
  }

  /**
   * Soft-delete da organização com cascade completo.
   *
   * Cascades em transaction:
   * - DVincula de org (todos os roles)
   * - DEntidade dos teams filhos
   * - DTabela ISSUE_COUNTERs dos teams
   * - DVincula TEAM_MEMBERSHIP dos teams
   * - DProject vinculados à org (idEstab=orgId) — soft delete
   * - DEntidade da org (soft delete)
   *
   * Audit DEvento -500 emitido APÓS commit.
   *
   * @param id - Chave BigInt da organização (string)
   * @param userEntidadeId - Chave BigInt do usuário que deleta (deve ser ADMIN)
   *
   * @throws {NotFoundException} Se organização não encontrada
   * @throws {ForbiddenException} Se usuário não é ADMIN da organização
   *
   * @example
   * ```typescript
   * await service.delete('100', BigInt(userId));
   * ```
   */
  async delete(id: string, userEntidadeId: bigint): Promise<void> {
    const orgId = BigInt(id);
    await this.requireAdminRole(orgId, userEntidadeId);

    const org = await this.prisma.dEntidade.findFirst({
      where: { chave: orgId, idClasse: ID_CLASSE_ORGANIZATION, excluido: false },
      select: { chave: true, nome: true },
    });

    if (!org) {
      throw new NotFoundException(`Organização ${id} não encontrada`);
    }

    // Buscar teams filhos (idEstab=orgId, idClasse=-180)
    const teams = await this.prisma.dEntidade.findMany({
      where: { idEstab: orgId, idClasse: ID_CLASSE_TEAM, excluido: false },
      select: { chave: true },
    });
    const teamIds = teams.map((t) => t.chave);

    await this.prisma.$transaction(async (tx) => {
      // Cascade: DVincula de membership dos teams
      if (teamIds.length > 0) {
        await tx.dVincula.updateMany({
          where: { idLocEscritu: { in: teamIds }, excluido: false },
          data: { excluido: true },
        });

        // Cascade: DTabela ISSUE_COUNTERs dos teams
        await tx.dTabela.updateMany({
          where: {
            dEntidadeId: { in: teamIds },
            idClasse: ID_CLASSE_ISSUE_COUNTER,
            excluido: false,
          },
          data: { excluido: true },
        });

        // Cascade: DEntidade dos teams
        await tx.dEntidade.updateMany({
          where: { chave: { in: teamIds }, excluido: false },
          data: { excluido: true },
        });
      }

      // Cascade: DVincula da org (todos os roles)
      await tx.dVincula.updateMany({
        where: { idLocEscritu: orgId, excluido: false },
        data: { excluido: true },
      });

      // Cascade: DProject vinculados (soft delete)
      await tx.dProject.updateMany({
        where: { idEstab: orgId, excluido: false },
        data: { excluido: true },
      });

      // Soft delete da org
      await tx.dEntidade.update({
        where: { chave: orgId },
        data: { excluido: true },
      });
    });

    // Audit APÓS commit — tipo org.deleted → idClasse=-500 ORG_LIFECYCLE (ADR-V2-027)
    await this.eventProducer.addInternalEvent(
      'org.deleted',
      {
        orgId: id,
        nome: org.nome,
        userId: userEntidadeId.toString(),
      },
      this.correlationIdService.getOrGenerate(),
      { source: OrganizationsService.name },
    );

    this.logger.log(`Organização ${orgId} deletada por user=${userEntidadeId}`);
  }

  /**
   * Lista membros de uma organização.
   *
   * Busca todos os DVincula de roles (-161/-162/-163) da org
   * com include da DEntidade do usuário. N+1 ZERO.
   *
   * @param orgId - Chave BigInt da organização (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser membro)
   * @returns Lista de membros com roles
   *
   * @throws {NotFoundException} Se organização não encontrada
   * @throws {ForbiddenException} Se usuário não é membro
   *
   * @example
   * ```typescript
   * const { members } = await service.getMembers('100', BigInt(userId));
   * ```
   */
  async getMembers(orgId: string, userEntidadeId: bigint): Promise<ListOrgMembersResponseDto> {
    // Verificar membership primeiro
    await this.findOne(orgId, userEntidadeId);

    const orgIdBigInt = BigInt(orgId);

    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idLocEscritu: orgIdBigInt,
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
      },
      include: {
        entidade: {
          select: { chave: true, nome: true, email: true },
        },
      },
      orderBy: { idClasse: 'asc' }, // ADMIN primeiro
    });

    const members: OrgMemberDto[] = vinculos
      .filter((v) => v.entidade)
      .map((v) => ({
        userId: v.idEntidade!.toString(),
        nome: v.entidade!.nome,
        email: v.entidade!.email,
        role: CLASSE_TO_ROLE[v.idClasse.toString()] ?? 'MEMBER',
        idClasse: v.idClasse.toString(),
      }));

    return { members };
  }

  /**
   * Adiciona membro à organização.
   *
   * Cria DVincula idClasse=-162 (MEMBER) ou -163 (VIEWER).
   * Apenas ADMIN pode adicionar membros.
   *
   * @param orgId - Chave BigInt da organização (string)
   * @param dto - userId e role
   * @param userEntidadeId - Chave BigInt do ADMIN que executa a ação
   *
   * @throws {NotFoundException} Se org ou usuário não encontrados
   * @throws {ForbiddenException} Se executante não é ADMIN
   * @throws {ConflictException} Se usuário já é membro
   *
   * @example
   * ```typescript
   * await service.addMember('100', { userId: '200', role: 'MEMBER' }, BigInt(adminId));
   * ```
   */
  async addMember(
    orgId: string,
    dto: AddOrgMemberDto,
    userEntidadeId: bigint,
  ): Promise<void> {
    const orgIdBigInt = BigInt(orgId);
    await this.requireAdminRole(orgIdBigInt, userEntidadeId);

    const targetId = BigInt(dto.userId);

    // Verificar se o usuário alvo existe
    const targetUser = await this.prisma.dEntidade.findFirst({
      where: { chave: targetId, excluido: false },
      select: { chave: true },
    });
    if (!targetUser) {
      throw new NotFoundException(`Usuário ${dto.userId} não encontrado`);
    }

    // Verificar se já é membro
    const existing = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: orgIdBigInt,
        idEntidade: targetId,
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
      },
      select: { chave: true },
    });
    if (existing) {
      throw new ConflictException(`Usuário ${dto.userId} já é membro desta organização`);
    }

    const idClasse = ROLE_TO_CLASSE[dto.role];
    if (!idClasse) {
      throw new BadRequestException(`Role inválido: ${dto.role}`);
    }

    await this.prisma.dVincula.create({
      data: {
        idClasse,
        idLocEscritu: orgIdBigInt,
        idEntidade: targetId,
        metaDados: { cargo: dto.role } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Membro ${targetId} adicionado à org ${orgIdBigInt} com role ${dto.role}`);
  }

  /**
   * Atualiza role de membro na organização.
   *
   * Atualiza o `idClasse` do DVincula e `metaDados.cargo`.
   * Apenas ADMIN pode alterar roles.
   *
   * @param orgId - Chave BigInt da organização (string)
   * @param memberId - Chave BigInt da DEntidade do membro (string)
   * @param dto - Novo role
   * @param userEntidadeId - Chave BigInt do ADMIN executante
   *
   * @throws {NotFoundException} Se org ou membro não encontrados
   * @throws {ForbiddenException} Se executante não é ADMIN
   *
   * @example
   * ```typescript
   * await service.updateMemberRole('100', '200', { role: 'ADMIN' }, BigInt(adminId));
   * ```
   */
  async updateMemberRole(
    orgId: string,
    memberId: string,
    dto: UpdateOrgMemberRoleDto,
    userEntidadeId: bigint,
  ): Promise<void> {
    const orgIdBigInt = BigInt(orgId);
    await this.requireAdminRole(orgIdBigInt, userEntidadeId);

    const memberIdBigInt = BigInt(memberId);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: orgIdBigInt,
        idEntidade: memberIdBigInt,
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
      },
      select: { chave: true, metaDados: true },
    });

    if (!vinculo) {
      throw new NotFoundException(`Membro ${memberId} não encontrado na organização ${orgId}`);
    }

    const idClasse = ROLE_TO_CLASSE[dto.role];
    if (!idClasse) {
      throw new BadRequestException(`Role inválido: ${dto.role}`);
    }

    const metaDadosAtuais = (vinculo.metaDados as Record<string, unknown>) ?? {};

    await this.prisma.dVincula.update({
      where: { chave: vinculo.chave },
      data: {
        idClasse,
        metaDados: { ...metaDadosAtuais, cargo: dto.role } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Role do membro ${memberIdBigInt} na org ${orgIdBigInt} atualizado para ${dto.role}`,
    );
  }

  /**
   * Remove membro da organização (soft delete do DVincula).
   *
   * Apenas ADMIN pode remover membros. Não pode remover o último ADMIN.
   *
   * @param orgId - Chave BigInt da organização (string)
   * @param memberId - Chave BigInt da DEntidade do membro (string)
   * @param userEntidadeId - Chave BigInt do ADMIN executante
   *
   * @throws {NotFoundException} Se org ou membro não encontrados
   * @throws {ForbiddenException} Se executante não é ADMIN, ou se é o último ADMIN
   *
   * @example
   * ```typescript
   * await service.removeMember('100', '200', BigInt(adminId));
   * ```
   */
  async removeMember(
    orgId: string,
    memberId: string,
    userEntidadeId: bigint,
  ): Promise<void> {
    const orgIdBigInt = BigInt(orgId);
    await this.requireAdminRole(orgIdBigInt, userEntidadeId);

    const memberIdBigInt = BigInt(memberId);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: orgIdBigInt,
        idEntidade: memberIdBigInt,
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
      },
      select: { chave: true, idClasse: true },
    });

    if (!vinculo) {
      throw new NotFoundException(`Membro ${memberId} não encontrado na organização ${orgId}`);
    }

    // Não pode remover o último ADMIN
    if (vinculo.idClasse === ID_CLASSE_ORG_ADMIN) {
      const adminCount = await this.prisma.dVincula.count({
        where: {
          idLocEscritu: orgIdBigInt,
          idClasse: ID_CLASSE_ORG_ADMIN,
          excluido: false,
        },
      });
      if (adminCount <= 1) {
        throw new ForbiddenException('Não é possível remover o único ADMIN da organização');
      }
    }

    await this.prisma.dVincula.update({
      where: { chave: vinculo.chave },
      data: { excluido: true },
    });

    this.logger.log(`Membro ${memberIdBigInt} removido da org ${orgIdBigInt}`);
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Verifica que o usuário é ADMIN da organização.
   *
   * @param orgId - Chave BigInt da organização
   * @param userEntidadeId - Chave BigInt do usuário
   * @throws {ForbiddenException} Se não for ADMIN
   */
  private async requireAdminRole(orgId: bigint, userEntidadeId: bigint): Promise<void> {
    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: orgId,
        idEntidade: userEntidadeId,
        idClasse: ID_CLASSE_ORG_ADMIN,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: requer role ADMIN na organização');
    }
  }

  /**
   * Constrói OrganizationResponseDto a partir de dados brutos.
   */
  private buildResponse(
    org: {
      chave: bigint;
      nome: string;
      dados?: unknown;
      criadoEm: Date;
      atualizadoEm: Date;
    },
    memberCount: number,
    dados?: Record<string, unknown> | null,
  ): OrganizationResponseDto {
    const orgDados = dados ?? (org.dados as Record<string, unknown> | null);
    return {
      id: org.chave.toString(),
      nome: org.nome,
      description: (orgDados?.description as string | null | undefined) ?? null,
      memberCount,
      criadoEm: org.criadoEm.toISOString(),
      atualizadoEm: org.atualizadoEm.toISOString(),
    };
  }
}
