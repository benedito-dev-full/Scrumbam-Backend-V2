import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { JwtPayload } from '../../auth/decorators/current-user.decorator';
import { EntidadeService } from '../../entidades/entidades.service';
import { WEBHOOK_CLASS_ID } from '../services/webhooks.service';

const PROJECT_ROLE_CLASSES = [BigInt(-171), BigInt(-172), BigInt(-173)];

@Injectable()
export class WebhookOwnerGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entidadeService: EntidadeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: Record<string, unknown>;
    }>();

    const userGroupId = request.user?.sub;
    if (!userGroupId) {
      throw new ForbiddenException('Usuario nao autenticado');
    }

    const projectId = await this.resolveProjectId(request);
    if (!projectId) {
      throw new ForbiddenException('Projeto do webhook nao informado');
    }

    const userEntidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(
      BigInt(userGroupId),
    );

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectId,
        idEntidade: userEntidadeId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
      select: { chave: true },
    });

    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: sem permissao no projeto do webhook');
    }

    return true;
  }

  private async resolveProjectId(request: {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  }): Promise<bigint | null> {
    const webhookId = request.params?.id;
    if (webhookId) {
      const webhook = await this.prisma.dTabela.findFirst({
        where: {
          chave: this.toBigInt(webhookId, 'id'),
          idClasse: WEBHOOK_CLASS_ID,
          excluido: false,
        },
        select: { dEntidadeId: true },
      });
      return webhook?.dEntidadeId ?? null;
    }

    const projectId = request.query?.projectId ?? request.body?.projectId;
    return typeof projectId === 'string' ? this.toBigInt(projectId, 'projectId') : null;
  }

  private toBigInt(value: string, field: string): bigint {
    if (!/^-?\d+$/.test(value)) {
      throw new BadRequestException(`${field} deve ser um numero inteiro`);
    }

    return BigInt(value);
  }
}
