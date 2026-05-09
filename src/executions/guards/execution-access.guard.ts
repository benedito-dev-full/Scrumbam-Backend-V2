import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma.service';

/** idClasses de membership (qualquer nível) */
const PROJECT_MEMBERSHIP_CLASSES = [
  BigInt(-170),
  BigInt(-171),
  BigInt(-172),
  BigInt(-173),
];

/** idClasses que permitem approve/reject/rollback */
const MANAGER_CLASSES = [BigInt(-171)];

/** idClasses de execution */
const EXECUTION_CLASSES = [BigInt(-301), BigInt(-302), BigInt(-303)];

/**
 * ExecutionAccessGuard — valida membership do user no projeto.
 *
 * Para rotas de approve/reject/rollback: exige idClasse=-171 (PROJECT_MANAGER).
 * Para demais rotas: qualquer membership (-170..-173) é aceito.
 *
 * Lê projectId de:
 * - req.params.id (rotas /projects/:id/execute)
 * - req.query.projectId (rotas /executions?projectId=X)
 * - DPedido.idLocEscritu (rotas /executions/:id/*)
 *
 * Retorna false (403) sem lançar — AuthCompositeGuard ou handler decide.
 */
@Injectable()
export class ExecutionAccessGuard implements CanActivate {
  private readonly logger = new Logger(ExecutionAccessGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica acesso do user à execution ou projeto.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se autorizado, false caso contrário
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: any }>();
    const user = req.user;

    if (!user) {
      this.logger.warn('[ExecutionAccessGuard] req.user ausente');
      return false;
    }

    // Suporta entidadeId direto ou como nested no payload JWT
    const userEntidadeId: string | undefined =
      user.entidadeId ?? user.sub?.toString();

    if (!userEntidadeId) {
      this.logger.warn('[ExecutionAccessGuard] entidadeId ausente no user JWT');
      return false;
    }

    // Determinar projectId a partir do request
    let projectId: string | undefined;

    if (req.params?.id && !this._isExecutionRoute(req)) {
      // Rota /projects/:id/execute — id é o projectId
      projectId = req.params.id;
    } else if (req.query?.projectId) {
      // Rota /executions?projectId=X
      projectId = req.query.projectId as string;
    } else if (req.params?.id) {
      // Rota /executions/:id — precisa buscar projectId via DPedido
      projectId = await this._resolveProjectIdFromExecution(req.params.id);
    }

    if (!projectId) {
      this.logger.warn('[ExecutionAccessGuard] projectId não encontrado no request');
      return false;
    }

    const requireAdmin = this._isAdminRoute(req.method, req.path);

    // Buscar membership
    const membershipWhere = requireAdmin
      ? {
          idClasse: { in: MANAGER_CLASSES },
          idLocEscritu: BigInt(projectId),
          idEntidade: BigInt(userEntidadeId),
          excluido: false,
        }
      : {
          idClasse: { in: PROJECT_MEMBERSHIP_CLASSES },
          idLocEscritu: BigInt(projectId),
          idEntidade: BigInt(userEntidadeId),
          excluido: false,
        };

    const membership = await this.prisma.dVincula.findFirst({
      where: membershipWhere,
      select: { idClasse: true },
    });

    if (!membership) {
      this.logger.warn(
        `[ExecutionAccessGuard] Acesso negado: user=${userEntidadeId} project=${projectId} adminRequired=${requireAdmin}`,
      );
      return false;
    }

    return true;
  }

  /**
   * Verifica se a rota é de execução individual (não de projeto).
   */
  private _isExecutionRoute(req: Request): boolean {
    return req.path.includes('/executions/');
  }

  /**
   * Verifica se a rota requer papel de ADMIN/MANAGER.
   */
  private _isAdminRoute(method: string, path: string): boolean {
    return (
      method === 'POST' &&
      (path.includes('/approve') ||
        path.includes('/reject') ||
        path.includes('/rollback'))
    );
  }

  /**
   * Resolve projectId a partir do ID de uma execution (DPedido.idLocEscritu).
   *
   * @param executionId - ID da execution (BigInt como string)
   * @returns projectId como string ou undefined se não encontrado
   */
  private async _resolveProjectIdFromExecution(
    executionId: string,
  ): Promise<string | undefined> {
    try {
      const pedido = await this.prisma.dPedido.findFirst({
        where: {
          chave: BigInt(executionId),
          idClasse: { in: EXECUTION_CLASSES },
          excluido: false,
        },
        select: { idLocEscritu: true },
      });

      return pedido?.idLocEscritu?.toString();
    } catch {
      return undefined;
    }
  }
}
