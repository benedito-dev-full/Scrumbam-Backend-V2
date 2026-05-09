import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreatePermissaoDto } from './dto/create-permissao.dto';
import { PermissaoResponseDto } from './dto/permissao-response.dto';

/** idClasse padrão de DPermissao (usar a canônica de controle de acesso). */
const ID_CLASSE_PERMISSAO = BigInt(-46); // compartilha com USER_GROUP por ora; F5 dedicará -530

/**
 * Service para CRUD de permissões granulares (DPermissao).
 *
 * Permissões granulares complementam o RBAC de roles (ADR-V2-003).
 * Apenas ADMINs podem gerenciar permissões (RolesGuard valida no controller).
 *
 * @see PermissoesController — controller protegido por @Roles('ADMIN')
 */
@Injectable()
export class PermissoesService {
  private readonly logger = new Logger(PermissoesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista permissões de um grupo de usuários.
   *
   * @param groupId - Chave BigInt do DUserGroup
   * @returns Lista de PermissaoResponseDto
   */
  async list(groupId: bigint): Promise<PermissaoResponseDto[]> {
    this.logger.debug(`list permissoes groupId=${groupId}`);

    const permissoes = await this.prisma.dPermissao.findMany({
      where: { dUserGroupId: groupId, excluido: false },
      orderBy: [{ recurso: 'asc' }, { acao: 'asc' }],
    });

    return permissoes.map(this.formatResponse);
  }

  /**
   * Cria nova permissão granular.
   *
   * @param dto - Dados da permissão
   * @returns PermissaoResponseDto criada
   */
  async create(dto: CreatePermissaoDto): Promise<PermissaoResponseDto> {
    this.logger.log(`create permissao recurso="${dto.recurso}" acao="${dto.acao}"`);

    const permissao = await this.prisma.dPermissao.create({
      data: {
        idClasse: ID_CLASSE_PERMISSAO,
        dUserGroupId: BigInt(dto.dUserGroupId),
        recurso: dto.recurso,
        acao: dto.acao,
        permitido: dto.permitido,
        ...(dto.metaDados && { metaDados: dto.metaDados as Prisma.InputJsonValue }),
      },
    });

    return this.formatResponse(permissao);
  }

  /**
   * Atualiza permissão existente.
   *
   * @param id - Chave BigInt da DPermissao
   * @param patch - Campos a atualizar
   * @returns PermissaoResponseDto atualizada
   * @throws {NotFoundException} Se não encontrada
   */
  async update(id: bigint, patch: Partial<Pick<CreatePermissaoDto, 'permitido' | 'metaDados'>>): Promise<PermissaoResponseDto> {
    const exists = await this.prisma.dPermissao.findFirst({
      where: { chave: id, excluido: false },
      select: { chave: true },
    });
    if (!exists) {
      throw new NotFoundException(`Permissão ${id} não encontrada`);
    }

    const permissao = await this.prisma.dPermissao.update({
      where: { chave: id },
      data: {
        ...(patch.permitido !== undefined && { permitido: patch.permitido }),
        ...(patch.metaDados !== undefined && { metaDados: patch.metaDados as Prisma.InputJsonValue }),
      },
    });

    return this.formatResponse(permissao);
  }

  /**
   * Soft-delete de permissão.
   *
   * @param id - Chave BigInt da DPermissao
   * @throws {NotFoundException} Se não encontrada
   */
  async delete(id: bigint): Promise<void> {
    const exists = await this.prisma.dPermissao.findFirst({
      where: { chave: id, excluido: false },
      select: { chave: true },
    });
    if (!exists) {
      throw new NotFoundException(`Permissão ${id} não encontrada`);
    }

    await this.prisma.dPermissao.update({
      where: { chave: id },
      data: { excluido: true },
    });
  }

  /** Serializa DPermissao para DTO. */
  private formatResponse(p: {
    chave: bigint;
    dUserGroupId: bigint;
    recurso: string;
    acao: string;
    permitido: boolean;
    metaDados: unknown;
    criadoEm: Date;
  }): PermissaoResponseDto {
    return {
      chave: p.chave.toString(),
      dUserGroupId: p.dUserGroupId.toString(),
      recurso: p.recurso,
      acao: p.acao,
      permitido: p.permitido,
      metaDados: p.metaDados as Record<string, unknown> | null,
      criadoEm: p.criadoEm,
    };
  }
}
