import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProjectRefService } from './project-ref.service';

/** idClasses DVincula para RBAC de projeto (seed F1). */
const ID_CLASSE_PROJECT_MANAGER = BigInt(-171);
const ID_CLASSE_PROJECT_MEMBER = BigInt(-172);
const ID_CLASSE_PROJECT_VIEWER = BigInt(-173);

const PROJECT_ROLE_CLASSES = [
  ID_CLASSE_PROJECT_MANAGER,
  ID_CLASSE_PROJECT_MEMBER,
  ID_CLASSE_PROJECT_VIEWER,
];

/**
 * Service compartilhado para resolver projetos associados a um usuario.
 *
 * Usa o contrato canonico de membership de projeto:
 * `DVincula.idLocEscritu = DProject.chave` e
 * `DVincula.idEntidade = DEntidade.chave` do usuario.
 */
@Injectable()
export class UserProjectService {
  private readonly logger = new Logger(UserProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectRef: ProjectRefService,
  ) {}

  /**
   * Retorna o projeto padrao mais recente do usuario, ou null se nao houver.
   *
   * Nao usa `DProject.idEstab=userId`: `idEstab` e organizacao pai do projeto.
   * A relacao usuario-projeto e feita por DVincula -171/-172/-173.
   *
   * @param userId - DEntidade.chave do usuario
   * @returns Chave BigInt do DProject mais recente associado ao usuario
   */
  async getDefaultProject(userId: bigint): Promise<bigint | null> {
    const roleLinks = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
      select: { idLocEscritu: true },
      orderBy: { idLocEscritu: 'desc' },
      take: 20,
    });

    // ADR-V2-058: idLocEscritu é a chave da espelho (-158) — reverter E→P para
    // obter os DProject.chave reais (legados sem espelho: passthrough P).
    const projectIdStrs = await this.projectRef.refsToProjectIds(
      roleLinks.map((link) => link.idLocEscritu),
    );
    const projectIds = projectIdStrs.map((s) => BigInt(s));
    if (projectIds.length === 0) {
      this.logger.debug(`Nenhum projeto associado ao userId=${userId}`);
      return null;
    }

    const project = await this.prisma.dProject.findFirst({
      where: {
        chave: { in: projectIds },
        excluido: false,
      },
      select: { chave: true },
      orderBy: { chave: 'desc' },
    });

    return project?.chave ?? null;
  }
}
