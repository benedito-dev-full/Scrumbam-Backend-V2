import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

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

    const projectIds = roleLinks.map((link) => link.idLocEscritu);
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
