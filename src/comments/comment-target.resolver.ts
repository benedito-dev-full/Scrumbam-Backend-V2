import {
  BadRequestException,
  forwardRef,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RoleResolverService } from '../auth/services/role-resolver.service';
import { CommentTargetType } from './dto/comment-target-type.enum';

/** idClasse de FOLDER no seed Scrumban (DProject filho de SPACE). */
const ID_CLASSE_FOLDER = BigInt(-351);

/** idClasse de LIST no seed Scrumban (DProject filho de FOLDER ou SPACE). */
const ID_CLASSE_LIST = BigInt(-352);

/** idClasses de FOLDER e LIST — excluídos quando targetType=PROJECT. */
const FOLDER_AND_LIST_CLASSES = [ID_CLASSE_FOLDER, ID_CLASSE_LIST];

/**
 * Resolve e autoriza acesso a um alvo polimórfico de comentário.
 *
 * Peça central do `CommentsModule`. Dado `(targetType, targetId, requester)`,
 * o resolver:
 *  1. Confirma que o alvo existe (na tabela correta com idClasse correto).
 *  2. Aplica tenant isolation (idEstab × organizationId).
 *  3. Valida que o requester tem acesso ao alvo.
 *
 * Estratégias por `targetType`:
 *
 * | targetType | Tabela | idClasse | Acesso via |
 * |------------|--------|----------|------------|
 * | task | DTask | -154 (qualquer task) | `findAccessibleProjectIds` ⊇ task.idProject |
 * | project | DProject | qualquer ≠ FOLDER/LIST | DVincula in [-171,-172,-173] |
 * | folder | DProject | -351 | DVincula in [-171,-172,-173] |
 * | list | DProject | -352 | DVincula in [-171,-172,-173] |
 *
 * **Por que membership inline e não `ProjectMembersService`?**
 * O service expõe `getMembers(projectId)` para listagem; não tem método
 * `getMembership(projectId, userId)`. Em vez de duplicar lógica de listagem
 * só para extrair um único vínculo, fazemos a query direta — mesmas
 * idClasses (`-171/-172/-173`), mesma semântica.
 *
 * @see ProjectMembersService.requireManagerRole — padrão de query DVincula reaplicado aqui.
 *
 * @example
 * ```typescript
 * await resolver.resolveAndAuthorize(
 *   CommentTargetType.TASK,
 *   '777',
 *   BigInt(42),
 *   '50'
 * );
 * // → não lança = autorizado; lança NotFound/Forbidden em falha
 * ```
 */
@Injectable()
export class CommentTargetResolver {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService,
    private readonly roleResolver: RoleResolverService,
  ) {}

  /**
   * Confirma existência do alvo e valida acesso do requester.
   *
   * @param targetType - Tipo do alvo (task / project / folder / list).
   * @param targetId - Chave string do alvo (será convertido para BigInt).
   * @param requesterEntidadeId - `DEntidade.chave` do requester.
   * @param organizationId - Org ativa (`DEntidade.chave` string). Opcional.
   * @returns Promise<void> — não lança = autorizado.
   *
   * @throws {BadRequestException} Quando targetType inválido (defesa em
   *   profundidade — o `ParseEnumPipe` no controller pega primeiro).
   * @throws {NotFoundException} Quando alvo não existe OU está em outra
   *   org. Mensagem idêntica para ambos os casos (anti-enumeration,
   *   mesmo padrão de ADR-V2-042).
   * @throws {ForbiddenException} Quando alvo existe na org mas o
   *   requester não tem acesso (não é membro do projeto).
   */
  async resolveAndAuthorize(
    targetType: CommentTargetType,
    targetId: string,
    requesterEntidadeId: bigint,
    organizationId?: string,
  ): Promise<void> {
    let targetIdBigInt: bigint;
    try {
      targetIdBigInt = BigInt(targetId);
    } catch {
      // Anti-enumeration: id inválido vira 404 idêntico a "não encontrado".
      throw new NotFoundException(`${targetType} ${targetId} não encontrado`);
    }

    switch (targetType) {
      case CommentTargetType.TASK:
        return this.resolveTask(targetIdBigInt, targetId, requesterEntidadeId, organizationId);
      case CommentTargetType.PROJECT:
      case CommentTargetType.FOLDER:
      case CommentTargetType.LIST:
        return this.resolveDProject(
          targetType,
          targetIdBigInt,
          targetId,
          requesterEntidadeId,
          organizationId,
        );
      default:
        // Defesa em profundidade — o ParseEnumPipe no controller pega
        // valores inválidos antes de chegar aqui. Esta linha protege
        // chamadas internas que poderiam burlar o pipe.
        throw new BadRequestException(`targetType inválido: ${String(targetType)}`);
    }
  }

  /**
   * Estratégia TASK: tarefa precisa existir e seu projeto precisa estar
   * na lista de projectIds acessíveis (resolve membership + tenant
   * em uma única chamada).
   *
   * **Tenant isolation simétrico (M1 Fase 2.1):** Antes de delegar à
   * `findAccessibleProjectIds`, fazemos uma checagem explícita de
   * `DProject.idEstab × organizationId` — mesmo padrão de
   * `resolveDProject`. Isso evita que requisições com `orgId` informado
   * vazem para outra org via task pertencente a projeto cross-tenant,
   * mesmo nos caminhos onde `findAccessibleProjectIds` é mais permissivo
   * (ex: chamadas internas/MCP). Quando `orgId` é ausente, a defesa
   * recai para `findAccessibleProjectIds` (comportamento original).
   * Mismatch de org retorna 404 idêntico a "não encontrado"
   * (anti-enumeration — não revela se a task existe em outro tenant).
   */
  private async resolveTask(
    targetIdBigInt: bigint,
    targetId: string,
    requesterEntidadeId: bigint,
    organizationId?: string,
  ): Promise<void> {
    const task = await this.prisma.dTask.findFirst({
      where: { chave: targetIdBigInt, excluido: false },
      select: { chave: true, idProject: true },
    });

    if (!task || task.idProject === null) {
      // Task sem projeto não tem como ser autorizada (DTask.idProject é
      // nullable no schema mas órfãs não devem aceitar comentários).
      // Mensagem 404 idêntica preserva anti-enumeration.
      throw new NotFoundException(`task ${targetId} não encontrada`);
    }

    // Tenant isolation simétrico com resolveDProject (ADR-V2-042):
    // busca leve do DProject da task para comparar idEstab × orgId
    // antes da validação de membership. Custo: +1 SELECT por
    // request em targetType=TASK — aceitável, não introduz N+1.
    const project = await this.prisma.dProject.findFirst({
      where: { chave: task.idProject, excluido: false },
      select: { chave: true, idEstab: true },
    });

    if (!project) {
      // Projeto ausente/soft-deleted → task órfã. 404 idêntico.
      throw new NotFoundException(`task ${targetId} não encontrada`);
    }

    if (organizationId && /^-?\d+$/.test(organizationId)) {
      const orgIdBig = BigInt(organizationId);
      if (project.idEstab && project.idEstab !== orgIdBig) {
        // Cross-tenant: 404 (não 403) para não revelar existência.
        throw new NotFoundException(`task ${targetId} não encontrada`);
      }
    }

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      requesterEntidadeId,
      organizationId,
    );

    // `findAccessibleProjectIds` retorna string[] de chaves DProject.
    if (!accessibleProjectIds.includes(task.idProject.toString())) {
      throw new ForbiddenException(`Sem acesso à task ${targetId}`);
    }
  }

  /**
   * Estratégia PROJECT/FOLDER/LIST: registro em DProject precisa existir
   * com o idClasse esperado, dentro do tenant (orgId), e o requester
   * precisa ter vínculo MANAGER/MEMBER/VIEWER.
   */
  private async resolveDProject(
    targetType: CommentTargetType.PROJECT | CommentTargetType.FOLDER | CommentTargetType.LIST,
    targetIdBigInt: bigint,
    targetId: string,
    requesterEntidadeId: bigint,
    organizationId?: string,
  ): Promise<void> {
    const where: Prisma.DProjectWhereInput = {
      chave: targetIdBigInt,
      excluido: false,
    };

    if (targetType === CommentTargetType.FOLDER) {
      where.idClasse = ID_CLASSE_FOLDER;
    } else if (targetType === CommentTargetType.LIST) {
      where.idClasse = ID_CLASSE_LIST;
    } else {
      // PROJECT = qualquer DProject que NÃO seja FOLDER/LIST.
      // (Inclui SPACE, PROJECT genérico, DOC futuro — todos comentáveis.)
      where.idClasse = { notIn: FOLDER_AND_LIST_CLASSES };
    }

    const project = await this.prisma.dProject.findFirst({
      where,
      select: { chave: true, idEstab: true },
    });

    if (!project) {
      throw new NotFoundException(`${targetType} ${targetId} não encontrado`);
    }

    // Tenant isolation (ADR-V2-042): se orgId informado, alvo de outra org
    // retorna 404 (mensagem idêntica, anti-enumeration).
    if (organizationId && /^-?\d+$/.test(organizationId)) {
      const orgIdBig = BigInt(organizationId);
      if (project.idEstab && project.idEstab !== orgIdBig) {
        throw new NotFoundException(`${targetType} ${targetId} não encontrado`);
      }
    }

    // Membership check via resolvedor CENTRAL (RoleResolverService): qualquer
    // role de projeto (MANAGER/MEMBER/VIEWER) basta para comentar e ler. Usar
    // getProjectRole — em vez de query direta — herda automaticamente as duas
    // camadas centralizadas: acesso por SPACE público (ADR-V2-051 §8) e herança
    // ORG_ADMIN → MANAGER (admin da org acessa todos os projetos dela). Também
    // resolve P→E internamente (ADR-V2-058, read-safe).
    const role = await this.roleResolver.getProjectRole(requesterEntidadeId, project.chave);

    if (!role) {
      throw new ForbiddenException(`Sem acesso ao ${targetType} ${targetId}`);
    }
  }
}
