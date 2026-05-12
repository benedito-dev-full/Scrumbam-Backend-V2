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

/**
 * Resultado do consumo de um install token one-shot.
 *
 * `projectId` é NULLABLE — quando o token foi gerado standalone
 * (sem `projectId`), o agente nasce sem vínculo de projeto e o
 * vínculo deve ser criado depois via `POST /agents/:id/projects`.
 */
export interface ConsumedInstallToken {
  tokenId: bigint;
  projectId: bigint | null;
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

  /**
   * Gera um install token one-shot para registro de novo agente.
   *
   * Quando `projectId` é fornecido, valida RBAC (MANAGER do projeto OU
   * ADMIN da org) e o agente nascerá automaticamente vinculado a esse
   * projeto via DVincula -185 no `install`.
   *
   * Quando `projectId` é `null`, o token é gerado standalone — qualquer
   * usuário autenticado JWT pode gerar (controller já cobre via
   * `JwtAuthGuard`). O agente nasce sem vínculo e o `createdBy` torna-se
   * o "dono operacional" inicial (idLocEscritu da DEntidade). Vínculos
   * de projeto são criados depois via `POST /agents/:id/projects`
   * (sub-tarefa 4.3, não coberta nesta sub-tarefa).
   *
   * @param projectId - ID do projeto (opcional). `null` = standalone.
   * @param createdBy - ID (DEntidade.chave) do usuário gerando o token.
   * @returns Token plaintext (exibido uma única vez), ID do registro DTabela e expiração.
   *
   * @throws {NotFoundException} Quando `projectId` é fornecido mas o projeto não existe.
   * @throws {ForbiddenException} Quando `projectId` é fornecido e o usuário não tem MANAGER/ADMIN.
   */
  async createInstallToken(
    projectId: bigint | null,
    createdBy: bigint,
  ): Promise<{ token: string; installTokenId: bigint; expiresAt: Date }> {
    if (projectId !== null) {
      await this.requireProjectManagerOrOrgAdmin(projectId, createdBy);
    }

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
          projectId: projectId !== null ? projectId.toString() : null,
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
    // `dEntidadeId` (createdBy) é OBRIGATÓRIO para audit do install.
    // `idLocEscrituracao` (projectId) é OPCIONAL — null = token standalone.
    if (!row.dEntidadeId) {
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
      projectId: row.idLocEscrituracao ?? null,
      createdBy: row.dEntidadeId,
    };
  }

  private async requireProjectManagerOrOrgAdmin(projectId: bigint, userId: bigint): Promise<void> {
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

    throw new ForbiddenException(
      'Acesso negado: requer MANAGER do projeto ou ADMIN da organizacao',
    );
  }
}
