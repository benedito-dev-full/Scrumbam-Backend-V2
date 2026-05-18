import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RoleResolverService } from '../auth/services/role-resolver.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { FolderResponseDto, ListFolderResponseDto } from './dto/folder-response.dto';

/** idClasses canônicas do seed F1 (Folder MVP — ADR-V2-FOLDERS-001). */
const ID_CLASSE_FOLDER = BigInt(-155);
const ID_CLASSE_FOLDER_PROJECT_LINK = BigInt(-183);
const ID_CLASSE_SCRUMBAN_PROJECT = BigInt(-153);
const ID_CLASSE_ORGANIZATION = BigInt(-152);

/**
 * Service de Folders (DEntidade idClasse=-155).
 *
 * Implementa CRUD completo de pastas e gestão do vínculo N:1 com DProject
 * via DVincula idClasse=-183 (FOLDER_PROJECT_LINK).
 *
 * Padrões aplicados (devari-backend-patterns + 3 Pilares):
 *  - Pilar 1: NÃO se aplica (Folder é cadastro estrutural — Prisma direto)
 *  - Pilar 2: rotas vivem no `EntidadeController` (precedente `/entidades/plataformas/...`)
 *  - Pilar 3: DClasses -155 e -183 registradas em `prisma/seeds/classes.seed.ts`
 *
 *  - BigInt para todos IDs
 *  - N+1 ZERO (groupBy em batch para contar projects por folder)
 *  - `prisma.$transaction` em moveProject para garantir invariante N:1
 *  - Acesso autorizado via `RoleResolverService.getOrgRole` (F3 — RBAC duplo)
 *  - Soft-delete (excluido=true, nunca DELETE físico)
 *
 * Decisões CEO (2026-05-18):
 *  - Q1 OUT: folders flat (sem aninhamento)
 *  - Q2 OUT: sem cor/ícone (`dados` reservado mas não populado)
 *  - Q3 OUT: ordenação alfabética por `nome`
 *  - Q4: delete de folder com projects MOVE projects para limbo
 *    (soft-delete dos DVincula -183, mantém DProject intacto)
 *
 * @see ADR-V2-FOLDERS-001
 * @see ADR-V2-001 (zero tabela nova)
 * @see ADR-V2-029 (precedente PROJECT_TEAM_LINK)
 */
@Injectable()
export class FoldersService {
  private readonly logger = new Logger(FoldersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roleResolver: RoleResolverService,
  ) {}

  /**
   * Cria nova pasta na organização.
   *
   * Valida que o usuário tem role na org (ADMIN/MEMBER/VIEWER) via DVincula
   * -160..-163. Persiste em `DEntidade.idEstab=organizationId`, sem popular
   * `dados` (cor/ícone OUT — CEO Q2).
   *
   * @param dto - Dados da pasta (nome, organizationId)
   * @param userEntidadeId - Chave BigInt da DEntidade do usuário logado
   * @returns FolderResponseDto com projectCount=0
   *
   * @throws {NotFoundException} Se organização não encontrada
   * @throws {ForbiddenException} Se usuário não é membro da org
   *
   * @example
   * ```typescript
   * const folder = await service.create(
   *   { nome: 'Cliente Acme', organizationId: '100' },
   *   BigInt(userId),
   * );
   * ```
   */
  async create(dto: CreateFolderDto, userEntidadeId: bigint): Promise<FolderResponseDto> {
    const orgId = BigInt(dto.organizationId);

    await this.requireOrgAccess(orgId, userEntidadeId);
    await this.ensureOrgExists(orgId);

    this.logger.log(`Criando folder nome="${dto.nome}" org=${orgId} user=${userEntidadeId}`);

    const folder = await this.prisma.dEntidade.create({
      data: {
        idClasse: ID_CLASSE_FOLDER,
        nome: dto.nome,
        idEstab: orgId,
      },
      select: {
        chave: true,
        nome: true,
        idEstab: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    return this.buildResponse(folder, 0);
  }

  /**
   * Lista pastas de uma organização (ordenadas por nome alfabético).
   *
   * Retorna lista plana ordenada por `nome` ascendente (CEO Q3 — sem ordem
   * manual no MVP). Contagem de projects via `groupBy` em batch (N+1 ZERO,
   * 2 queries totais independente de N folders).
   *
   * @param organizationId - ID da organização (string)
   * @param userEntidadeId - Chave BigInt do usuário logado
   * @returns Lista de pastas da org com projectCount
   *
   * @throws {ForbiddenException} Se usuário não é membro da org
   */
  async findAllByOrg(
    organizationId: string,
    userEntidadeId: bigint,
  ): Promise<ListFolderResponseDto> {
    const orgId = BigInt(organizationId);
    await this.requireOrgAccess(orgId, userEntidadeId);

    const folders = await this.prisma.dEntidade.findMany({
      where: {
        idClasse: ID_CLASSE_FOLDER,
        idEstab: orgId,
        excluido: false,
      },
      select: {
        chave: true,
        nome: true,
        idEstab: true,
        criadoEm: true,
        atualizadoEm: true,
      },
      orderBy: { nome: 'asc' },
    });

    if (folders.length === 0) {
      return { items: [] };
    }

    // Batch: contagem de projects vinculados (N+1 ZERO)
    const folderIds = folders.map((f) => f.chave);
    const counts = await this.prisma.dVincula.groupBy({
      by: ['idLocEscritu'],
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idLocEscritu: { in: folderIds },
        excluido: false,
      },
      _count: { chave: true },
    });
    const countMap = new Map(counts.map((c) => [c.idLocEscritu.toString(), c._count.chave]));

    const items = folders.map((f) => this.buildResponse(f, countMap.get(f.chave.toString()) ?? 0));

    return { items };
  }

  /**
   * Busca pasta por ID, verificando acesso via org.
   *
   * @param folderId - Chave BigInt da pasta (string)
   * @param userEntidadeId - Chave BigInt do usuário
   * @returns FolderResponseDto
   *
   * @throws {NotFoundException} Se pasta não encontrada
   * @throws {ForbiddenException} Se usuário não é membro da org da pasta
   */
  async findById(folderId: string, userEntidadeId: bigint): Promise<FolderResponseDto> {
    const id = BigInt(folderId);
    const folder = await this.fetchFolderOrThrow(id);

    await this.requireOrgAccess(folder.idEstab!, userEntidadeId);

    const projectCount = await this.prisma.dVincula.count({
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idLocEscritu: id,
        excluido: false,
      },
    });

    return this.buildResponse(folder, projectCount);
  }

  /**
   * Renomeia pasta (apenas `nome` no MVP).
   *
   * @param folderId - Chave BigInt da pasta (string)
   * @param dto - Campos a atualizar (apenas `nome` no MVP)
   * @param userEntidadeId - Chave BigInt do usuário
   * @returns FolderResponseDto atualizada
   *
   * @throws {NotFoundException} Se pasta não encontrada
   * @throws {ForbiddenException} Se usuário não tem acesso à org
   */
  async update(
    folderId: string,
    dto: UpdateFolderDto,
    userEntidadeId: bigint,
  ): Promise<FolderResponseDto> {
    const id = BigInt(folderId);
    const existing = await this.fetchFolderOrThrow(id);
    await this.requireOrgAccess(existing.idEstab!, userEntidadeId);

    this.logger.log(`Renomeando folder=${id} user=${userEntidadeId}`);

    const updated = await this.prisma.dEntidade.update({
      where: { chave: id },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
      },
      select: {
        chave: true,
        nome: true,
        idEstab: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    const projectCount = await this.prisma.dVincula.count({
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idLocEscritu: id,
        excluido: false,
      },
    });

    return this.buildResponse(updated, projectCount);
  }

  /**
   * Soft-delete da pasta com cascata dos vínculos.
   *
   * Comportamento conforme CEO Q4: projects vinculados são movidos para
   * o "limbo" (soft-delete dos DVincula -183), DProject permanece intacto.
   * Operação atômica em transação.
   *
   * @param folderId - Chave BigInt da pasta (string)
   * @param userEntidadeId - Chave BigInt do usuário
   *
   * @throws {NotFoundException} Se pasta não encontrada
   * @throws {ForbiddenException} Se usuário não tem acesso à org
   */
  async delete(folderId: string, userEntidadeId: bigint): Promise<void> {
    const id = BigInt(folderId);
    const folder = await this.fetchFolderOrThrow(id);
    await this.requireOrgAccess(folder.idEstab!, userEntidadeId);

    this.logger.log(`Deletando folder=${id} user=${userEntidadeId}`);

    await this.prisma.$transaction(async (tx) => {
      // Cascata: soft-delete dos vínculos folder→project (CEO Q4 — projects vão p/ limbo)
      await tx.dVincula.updateMany({
        where: {
          idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
          idLocEscritu: id,
          excluido: false,
        },
        data: { excluido: true },
      });

      // Soft-delete da pasta
      await tx.dEntidade.update({
        where: { chave: id },
        data: { excluido: true },
      });
    });
  }

  /**
   * Lista projects vinculados a uma pasta.
   *
   * @param folderId - Chave BigInt da pasta (string)
   * @param userEntidadeId - Chave BigInt do usuário
   * @returns Lista de projects (chave + nome + idEstab) ativos vinculados
   *
   * @throws {NotFoundException} Se pasta não encontrada
   * @throws {ForbiddenException} Se usuário não tem acesso à org
   */
  async listProjects(
    folderId: string,
    userEntidadeId: bigint,
  ): Promise<{ items: { id: string; nome: string; orgId: string | null }[] }> {
    const id = BigInt(folderId);
    const folder = await this.fetchFolderOrThrow(id);
    await this.requireOrgAccess(folder.idEstab!, userEntidadeId);

    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idLocEscritu: id,
        excluido: false,
      },
      select: { idEntidade: true },
    });

    const projectIds = vinculos.map((v) => v.idEntidade).filter((v): v is bigint => v !== null);

    if (projectIds.length === 0) {
      return { items: [] };
    }

    const projects = await this.prisma.dProject.findMany({
      where: {
        chave: { in: projectIds },
        excluido: false,
      },
      select: { chave: true, nome: true, idEstab: true },
      orderBy: { nome: 'asc' },
    });

    return {
      items: projects.map((p) => ({
        id: p.chave.toString(),
        nome: p.nome,
        orgId: p.idEstab?.toString() ?? null,
      })),
    };
  }

  /**
   * Lista projects de uma organização que NÃO estão em nenhuma pasta ("limbo").
   *
   * Usa NOT EXISTS via Prisma `none` relation filter para escalar.
   *
   * @param organizationId - ID da organização (string)
   * @param userEntidadeId - Chave BigInt do usuário
   * @returns Lista de projects órfãos
   *
   * @throws {ForbiddenException} Se usuário não tem acesso à org
   */
  async listUnassigned(
    organizationId: string,
    userEntidadeId: bigint,
  ): Promise<{ items: { id: string; nome: string; orgId: string | null }[] }> {
    const orgId = BigInt(organizationId);
    await this.requireOrgAccess(orgId, userEntidadeId);

    // 1) Buscar todos projects da org
    const projects = await this.prisma.dProject.findMany({
      where: {
        idEstab: orgId,
        excluido: false,
      },
      select: { chave: true, nome: true, idEstab: true },
      orderBy: { nome: 'asc' },
    });

    if (projects.length === 0) {
      return { items: [] };
    }

    // 2) Buscar vínculos ativos -183 para esses projects (batch — N+1 ZERO)
    const projectIds = projects.map((p) => p.chave);
    const links = await this.prisma.dVincula.findMany({
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idEntidade: { in: projectIds },
        excluido: false,
      },
      select: { idEntidade: true },
    });
    const linkedIds = new Set(
      links.map((l) => l.idEntidade?.toString()).filter((s): s is string => s !== undefined),
    );

    // 3) Filtrar projects sem vínculo ativo
    const unassigned = projects.filter((p) => !linkedIds.has(p.chave.toString()));

    return {
      items: unassigned.map((p) => ({
        id: p.chave.toString(),
        nome: p.nome,
        orgId: p.idEstab?.toString() ?? null,
      })),
    };
  }

  /**
   * Move um project para a pasta (idempotente e race-safe).
   *
   * Garante invariante N:1 (1 project tem no máximo 1 folder ativo) via
   * transação:
   *  1. Soft-delete de qualquer vínculo ativo anterior (-183) para o project
   *  2. Cria novo vínculo apontando para a pasta destino
   *
   * Operação idempotente: chamar duas vezes com o mesmo (folderId, projectId)
   * gera apenas 1 vínculo ativo (o segundo soft-deleta o primeiro e cria
   * outro — comportamento consistente, não duplica).
   *
   * @param folderId - Chave BigInt da pasta destino (string)
   * @param projectId - Chave BigInt do project a mover (string)
   * @param userEntidadeId - Chave BigInt do usuário
   *
   * @throws {NotFoundException} Se pasta ou project não encontrados
   * @throws {ForbiddenException} Se usuário não tem acesso à org
   * @throws {ConflictException} Se project pertence a outra org
   */
  async moveProject(folderId: string, projectId: string, userEntidadeId: bigint): Promise<void> {
    const fId = BigInt(folderId);
    const pId = BigInt(projectId);

    const folder = await this.fetchFolderOrThrow(fId);
    await this.requireOrgAccess(folder.idEstab!, userEntidadeId);

    const project = await this.prisma.dProject.findFirst({
      where: { chave: pId, excluido: false },
      select: { chave: true, idEstab: true },
    });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} não encontrado`);
    }

    // Project DEVE pertencer à mesma org da pasta (sem cross-tenant)
    if (project.idEstab === null || project.idEstab !== folder.idEstab) {
      throw new ConflictException(
        `Project ${projectId} pertence a outra organização — não pode ser movido para esta pasta`,
      );
    }

    this.logger.log(`Movendo project=${pId} para folder=${fId} user=${userEntidadeId}`);

    await this.prisma.$transaction(async (tx) => {
      // Soft-delete qualquer vínculo ativo anterior (-183) para este project.
      // Usa updateMany para idempotência (cobre o caso "já está nessa pasta").
      await tx.dVincula.updateMany({
        where: {
          idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
          idEntidade: pId,
          excluido: false,
        },
        data: { excluido: true },
      });

      // Cria novo vínculo apontando para a pasta destino
      await tx.dVincula.create({
        data: {
          idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
          idLocEscritu: fId,
          idEntidade: pId,
        },
      });
    });
  }

  /**
   * Desvincula um project da pasta (move para o limbo).
   *
   * Apenas soft-deleta o vínculo ativo entre (folderId, projectId).
   * Idempotente — não erra se não havia vínculo.
   *
   * @param folderId - Chave BigInt da pasta (string)
   * @param projectId - Chave BigInt do project (string)
   * @param userEntidadeId - Chave BigInt do usuário
   *
   * @throws {NotFoundException} Se pasta não encontrada
   * @throws {ForbiddenException} Se usuário não tem acesso à org
   */
  async unmoveProject(folderId: string, projectId: string, userEntidadeId: bigint): Promise<void> {
    const fId = BigInt(folderId);
    const pId = BigInt(projectId);

    const folder = await this.fetchFolderOrThrow(fId);
    await this.requireOrgAccess(folder.idEstab!, userEntidadeId);

    this.logger.log(`Desvinculando project=${pId} da folder=${fId} user=${userEntidadeId}`);

    await this.prisma.dVincula.updateMany({
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idLocEscritu: fId,
        idEntidade: pId,
        excluido: false,
      },
      data: { excluido: true },
    });
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Carrega a pasta verificando idClasse=-155 e não excluída.
   *
   * @throws {NotFoundException} se não encontrada.
   */
  private async fetchFolderOrThrow(folderId: bigint): Promise<{
    chave: bigint;
    nome: string;
    idEstab: bigint | null;
    criadoEm: Date;
    atualizadoEm: Date;
  }> {
    const folder = await this.prisma.dEntidade.findFirst({
      where: {
        chave: folderId,
        idClasse: ID_CLASSE_FOLDER,
        excluido: false,
      },
      select: {
        chave: true,
        nome: true,
        idEstab: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    if (!folder) {
      throw new NotFoundException(`Folder ${folderId} não encontrada`);
    }
    if (folder.idEstab === null) {
      // Salvaguarda defensiva — pasta sempre deve ter idEstab da org dona
      throw new NotFoundException(`Folder ${folderId} sem organização vinculada`);
    }
    return folder;
  }

  /**
   * Garante que `organizationId` aponta para uma DEntidade -152 viva.
   *
   * @throws {NotFoundException} se org não existir.
   */
  private async ensureOrgExists(orgId: bigint): Promise<void> {
    const org = await this.prisma.dEntidade.findFirst({
      where: {
        chave: orgId,
        idClasse: ID_CLASSE_ORGANIZATION,
        excluido: false,
      },
      select: { chave: true },
    });
    if (!org) {
      throw new NotFoundException(`Organização ${orgId} não encontrada`);
    }
  }

  /**
   * Exige que o usuário tenha algum role na org (ADMIN/MEMBER/VIEWER).
   *
   * Delega para RoleResolverService (cache LRU + DVincula query indexada).
   *
   * @throws {ForbiddenException} se sem role.
   */
  private async requireOrgAccess(orgId: bigint, userEntidadeId: bigint): Promise<void> {
    const role = await this.roleResolver.getOrgRole(userEntidadeId, orgId);
    if (!role) {
      throw new ForbiddenException('Acesso negado: você não tem permissão nesta organização');
    }
  }

  /**
   * Constrói FolderResponseDto a partir dos dados brutos da DEntidade.
   */
  private buildResponse(
    folder: {
      chave: bigint;
      nome: string;
      idEstab: bigint | null;
      criadoEm: Date;
      atualizadoEm: Date;
    },
    projectCount: number,
  ): FolderResponseDto {
    return {
      id: folder.chave.toString(),
      nome: folder.nome,
      organizationId: folder.idEstab?.toString() ?? '',
      projectCount,
      criadoEm: folder.criadoEm.toISOString(),
      atualizadoEm: folder.atualizadoEm.toISOString(),
    };
  }

  /**
   * Aplica o "FolderId" de cada project em batch para uso em ProjectsService.
   *
   * Retorna mapa `projectId.toString() → folderId.toString() | null`.
   * 1 query indexada (idClasse + idEntidade IN) para N projects.
   *
   * Anexado neste service para preservar coesão (toda lógica de
   * DVincula -183 fica aqui — ProjectsService apenas consome o map).
   *
   * @param projectIds - Chaves BigInt dos projects (não vazio)
   * @returns Map<string, string | null> com folderId resolvido
   */
  async resolveFolderIdsForProjects(
    projectIds: ReadonlyArray<bigint>,
  ): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (projectIds.length === 0) {
      return map;
    }

    // Inicializa todos os projects com null (default: limbo)
    for (const pid of projectIds) {
      map.set(pid.toString(), null);
    }

    const links = await this.prisma.dVincula.findMany({
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idEntidade: { in: [...projectIds] },
        excluido: false,
      },
      select: { idEntidade: true, idLocEscritu: true },
    });

    for (const link of links) {
      if (link.idEntidade !== null) {
        map.set(link.idEntidade.toString(), link.idLocEscritu.toString());
      }
    }

    return map;
  }
}

export {
  ID_CLASSE_FOLDER,
  ID_CLASSE_FOLDER_PROJECT_LINK,
  ID_CLASSE_SCRUMBAN_PROJECT,
  ID_CLASSE_ORGANIZATION,
};
