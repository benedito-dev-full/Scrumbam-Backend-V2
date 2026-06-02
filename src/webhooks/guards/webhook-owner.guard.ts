import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { JwtPayload } from '../../auth/decorators/current-user.decorator';
import { EntidadeService } from '../../entidades/entidades.service';
import { ProjectRefService } from '../../projects/project-ref.service';
import { WEBHOOK_CLASS_ID } from '../services/webhooks.service';

const PROJECT_ROLE_CLASSES = [BigInt(-171), BigInt(-172), BigInt(-173)];

@Injectable()
export class WebhookOwnerGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entidadeService: EntidadeService,
    private readonly projectRef: ProjectRefService,
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

    const projectId = await this.resolveRequestProjectId(request);
    if (!projectId) {
      throw new ForbiddenException('Projeto do webhook nao informado');
    }

    // ADR-V2-042: tenant isolation — projeto DEVE pertencer a org do JWT.
    // Mensagem 404 (anti enumeration) quando mismatch.
    const jwtOrgId = request.user?.organizationId;
    if (jwtOrgId) {
      const project = await this.prisma.dProject.findFirst({
        where: { chave: projectId, excluido: false },
        select: { idEstab: true },
      });
      if (!project || project.idEstab === null || project.idEstab.toString() !== jwtOrgId) {
        throw new NotFoundException('Webhook nao encontrado');
      }
    }

    const userEntidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(
      BigInt(userGroupId),
    );

    // ADR-V2-058: handle do projeto em DVincula = chave da espelho (-158) ou
    // P legado (passthrough). Read-safe.
    const projectHandle = await this.projectRef.resolveEntidadeRef(projectId);
    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectHandle,
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

  /**
   * Resolve SEMPRE o `projectId` real (`DProject.chave` = P) a partir da request.
   *
   * Dois caminhos:
   *  - Rota com `:id` (webhook): lê `DTabela.dEntidadeId`, que após ADR-V2-058/059
   *    é o handle canônico (DEntidade-espelho -158, ou P legado). Convertemos
   *    E→P via {@link ProjectRefService.resolveProjectId} (passthrough para P
   *    legado). Isso garante que o caller (tenant isolation e RBAC) sempre
   *    receba P, nunca o handle E.
   *  - `query`/`body.projectId`: já é P — retornado direto.
   *
   * Ambos os usos de `canActivate` (tenant isolation via `dProject.findFirst`
   * por `chave`, e RBAC via `resolveEntidadeRef`) esperam P e funcionam.
   *
   * @returns `projectId` (P) ou `null` se não informado.
   */
  private async resolveRequestProjectId(request: {
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
      if (!webhook?.dEntidadeId) {
        return null;
      }
      // dEntidadeId é o handle (E ou P-legado) → resolver para P.
      return this.projectRef.resolveProjectId(webhook.dEntidadeId);
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
