import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';
import { AgentKeyService } from './agent-key.service';

export interface ConsumedInstallToken {
  tokenId: bigint;
  projectId: bigint;
  createdBy: bigint;
}

@Injectable()
export class AgentInstallTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly roleResolver: RoleResolverService,
    private readonly agentKeyService: AgentKeyService,
  ) {}

  async createInstallToken(
    projectId: bigint,
    createdBy: bigint,
  ): Promise<{ token: string; installTokenId: bigint; expiresAt: Date }> {
    await this.requireProjectManagerOrOrgAdmin(projectId, createdBy);

    const ttlMin = parseInt(
      this.configService.get<string>('AGENT_INSTALL_TOKEN_TTL_MIN', '10'),
      10,
    );
    const expiresAt = new Date(Date.now() + ttlMin * 60_000);
    const token = this.agentKeyService.generateSecret(32);
    const tokenHash = this.agentKeyService.hashSecret(token);

    const row = await this.prisma.dTabela.create({
      data: {
        idClasse: AUTOMATION_CLASS_IDS.INSTALL_TOKEN,
        codigo: tokenHash,
        nome: 'Agent install token',
        dEntidadeId: createdBy,
        idLocEscrituracao: projectId,
        dados: {
          tokenHash,
          projectId: projectId.toString(),
          createdBy: createdBy.toString(),
          expiresAt: expiresAt.toISOString(),
          used: false,
        } as Prisma.InputJsonValue,
      },
      select: { chave: true },
    });

    return { token, installTokenId: row.chave, expiresAt };
  }

  async consumeInstallToken(
    tx: Prisma.TransactionClient,
    tokenPlain: string,
  ): Promise<ConsumedInstallToken> {
    const tokenHash = this.agentKeyService.hashSecret(tokenPlain);
    const rows = await tx.$queryRaw<
      Array<{
        chave: bigint;
        dEntidadeId: bigint | null;
        idLocEscrituracao: bigint | null;
        dados: Prisma.JsonValue | null;
      }>
    >`
      SELECT "chave", "dEntidadeId", "idLocEscrituracao", "dados"
      FROM "DTabela"
      WHERE "idClasse" = ${AUTOMATION_CLASS_IDS.INSTALL_TOKEN}
        AND "codigo" = ${tokenHash}
        AND "excluido" = false
      FOR UPDATE
    `;

    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Token de instalacao invalido');
    }

    const dados = (row.dados as Record<string, unknown> | null) ?? {};
    const used = dados.used === true;
    const expiresAtRaw = typeof dados.expiresAt === 'string' ? dados.expiresAt : null;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    if (used) {
      throw new ConflictException('Token de instalacao ja utilizado');
    }
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Token de instalacao expirado');
    }
    if (!row.idLocEscrituracao || !row.dEntidadeId) {
      throw new ConflictException('Token de instalacao inconsistente');
    }

    await tx.dTabela.update({
      where: { chave: row.chave },
      data: {
        dados: {
          ...dados,
          used: true,
          usedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    return {
      tokenId: row.chave,
      projectId: row.idLocEscrituracao,
      createdBy: row.dEntidadeId,
    };
  }

  private async requireProjectManagerOrOrgAdmin(
    projectId: bigint,
    userId: bigint,
  ): Promise<void> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true, idEstab: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId.toString()} nao encontrado`);
    }

    const projectRole = await this.roleResolver.getProjectRole(userId, projectId);
    if (projectRole === 'MANAGER') {
      return;
    }

    if (project.idEstab) {
      const orgRole = await this.roleResolver.getOrgRole(userId, project.idEstab);
      if (orgRole === 'ADMIN') {
        return;
      }
    }

    throw new ForbiddenException('Acesso negado: requer MANAGER do projeto ou ADMIN da organizacao');
  }
}
