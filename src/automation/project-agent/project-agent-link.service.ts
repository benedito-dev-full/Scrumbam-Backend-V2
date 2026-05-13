import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';
import { AgentTunnelService } from '../agents/agent-tunnel.service';
import { LinkAgentResponseDto, ProjectAgentTipo } from './dto/link-agent.dto';
import { ProjectAgentStatusResponseDto } from './dto/agent-status-response.dto';

const EXECUTION_CLASSES = [
  AUTOMATION_CLASS_IDS.EXEC_LOW,
  AUTOMATION_CLASS_IDS.EXEC_MEDIUM,
  AUTOMATION_CLASS_IDS.EXEC_HIGH,
];

const ACTIVE_EXECUTION_STATUS_CODES = [
  AUTOMATION_CLASS_IDS.EXEC_STATUS_QUEUED.toString(),
  AUTOMATION_CLASS_IDS.EXEC_STATUS_AWAITING_APPROVAL.toString(),
  AUTOMATION_CLASS_IDS.EXEC_STATUS_APPROVED.toString(),
  AUTOMATION_CLASS_IDS.EXEC_STATUS_RUNNING.toString(),
];

const ACTIVE_EXECUTION_STATUS_VALUES = [
  'queued',
  'awaiting_approval',
  'approved',
  'running',
  'QUEUED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'RUNNING',
];

const PROJECT_AGENT_LOCK_BASE = BigInt(13_185_000_000_000);

const PROJECT_SLUG_MAX_LENGTH = 64;
const PROJECT_SLUG_REGEX = /^[a-z0-9-]{1,64}$/;

/**
 * Converte um nome arbitrario de projeto em projectSlug canonico.
 *
 * Regras (plan-2026-05-13 §5 + ADR-V2-035):
 * - Normaliza acentos (NFD + strip diacritics).
 * - Lowercase.
 * - Substitui qualquer caractere fora de [a-z0-9] por hifen.
 * - Colapsa hifens consecutivos.
 * - Trim de hifens nas pontas.
 * - Trunca em 64 chars (re-trim apos truncar).
 *
 * Fallback: retorna 'project-<chave>' se a slugificacao resultar em string vazia.
 *
 * @param nome - Nome bruto do projeto (DProject.nome).
 * @param fallbackChave - Chave do projeto para o fallback determinístico.
 * @returns Slug `^[a-z0-9-]{1,64}$`.
 */
function slugifyProjectName(nome: string, fallbackChave: bigint): string {
  const normalized = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PROJECT_SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
  if (normalized.length === 0) {
    return `project-${fallbackChave.toString()}`.slice(0, PROJECT_SLUG_MAX_LENGTH);
  }
  return normalized;
}

type ProjectRecord = { chave: bigint; idEstab: bigint | null };

@Injectable()
export class ProjectAgentLinkService {
  private readonly logger = new Logger(ProjectAgentLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roleResolver: RoleResolverService,
    private readonly agentTunnelService: AgentTunnelService,
  ) {}

  async linkAgent(
    projectId: bigint,
    agentId: bigint,
    tipo: ProjectAgentTipo,
    userEntidadeId: bigint,
  ): Promise<LinkAgentResponseDto> {
    await this.requireProjectManagerOrOrgAdmin(projectId, userEntidadeId);

    const link = await this.prisma.$transaction(async (tx) => {
      await this.lockProjectAgentLinks(tx, projectId);

      // NOTA (fix multi-projeto): NAO filtrar por `idLocEscritu: projectId`.
      // O `idLocEscritu` do DEntidade -156 e' o projeto/usuario de origem
      // (onde o agent foi criado via install-token). Restringir o vinculo
      // a esse projeto quebra a feature multi-projeto introduzida em
      // commit 09eeb61 (`feat(automation): endpoints link/unlink/list
      // agente-projeto (multi-project)`). A validacao de autorizacao
      // (`requireProjectManagerOrOrgAdmin`) acima ja garante que o usuario
      // tem permissao no projeto destino — basta existir um agent ativo
      // com o id requisitado.
      const agent = await tx.dEntidade.findFirst({
        where: {
          chave: agentId,
          idClasse: AUTOMATION_CLASS_IDS.AGENT,
          excluido: false,
        },
        select: { chave: true },
      });
      if (!agent) {
        throw new NotFoundException(`Agent ${agentId} nao encontrado (ou ja foi removido)`);
      }

      const project = await tx.dProject.findUnique({
        where: { chave: projectId },
        select: { nome: true },
      });
      if (!project) {
        throw new NotFoundException(`Projeto ${projectId} nao encontrado`);
      }

      if (tipo === 'primary') {
        await tx.dVincula.updateMany({
          where: {
            idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
            idLocEscritu: projectId,
            idEntidade: { not: agentId },
            tipo: 'primary',
            excluido: false,
          },
          data: { tipo: 'secondary' },
        });
      }

      const existing = await tx.dVincula.findFirst({
        where: {
          idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
          idLocEscritu: projectId,
          idEntidade: agentId,
          excluido: false,
        },
        select: { chave: true, metaDados: true },
      });

      const existingMeta = (existing?.metaDados as Record<string, unknown> | null) ?? null;
      const existingSlug =
        typeof existingMeta?.projectSlug === 'string' &&
        PROJECT_SLUG_REGEX.test(existingMeta.projectSlug)
          ? (existingMeta.projectSlug as string)
          : null;
      const projectSlug = existingSlug ?? slugifyProjectName(project.nome, projectId);

      const now = new Date().toISOString();
      if (existing) {
        return tx.dVincula.update({
          where: { chave: existing.chave },
          data: {
            tipo,
            metaDados: {
              ...(existingMeta ?? {}),
              tipo,
              projectSlug,
              updatedAt: now,
              updatedBy: userEntidadeId.toString(),
            } as Prisma.InputJsonValue,
          },
          select: { chave: true, idEntidade: true, tipo: true },
        });
      }

      return tx.dVincula.create({
        data: {
          idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
          idLocEscritu: projectId,
          idEntidade: agentId,
          tipo,
          metaDados: {
            tipo,
            projectSlug,
            createdAt: now,
            createdBy: userEntidadeId.toString(),
          } as Prisma.InputJsonValue,
        },
        select: { chave: true, idEntidade: true, tipo: true },
      });
    });

    this.logger.log(`project-agent link project=${projectId} agent=${agentId} tipo=${tipo}`);

    return {
      projectId: projectId.toString(),
      agentId: link.idEntidade!.toString(),
      tipo: this.normalizeTipo(link.tipo),
      linkId: link.chave.toString(),
    };
  }

  async unlinkAgent(projectId: bigint, agentId: bigint, userEntidadeId: bigint): Promise<void> {
    await this.requireProjectManagerOrOrgAdmin(projectId, userEntidadeId);

    await this.prisma.$transaction(async (tx) => {
      await this.lockProjectAgentLinks(tx, projectId);

      const link = await tx.dVincula.findFirst({
        where: {
          idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
          idLocEscritu: projectId,
          idEntidade: agentId,
          excluido: false,
        },
        select: { chave: true },
      });
      if (!link) {
        throw new NotFoundException(`Vinculo project-agent nao encontrado`);
      }

      const activeExecution = await this.findActiveExecutionForAgent(tx, projectId, agentId);
      if (activeExecution) {
        throw new ConflictException(
          `Nao e possivel remover agent ${agentId}: execution ativa ${activeExecution.chave}`,
        );
      }

      await tx.dVincula.update({
        where: { chave: link.chave },
        data: { excluido: true },
      });
    });

    this.logger.log(`project-agent unlink project=${projectId} agent=${agentId}`);
  }

  async getStatus(
    projectId: bigint,
    userEntidadeId: bigint,
  ): Promise<ProjectAgentStatusResponseDto> {
    await this.requireProjectMemberOrOrgAdmin(projectId, userEntidadeId);

    const links = await this.prisma.dVincula.findMany({
      where: {
        idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
        idLocEscritu: projectId,
        excluido: false,
      },
      include: {
        entidade: {
          select: {
            chave: true,
            nome: true,
            dados: true,
          },
        },
      },
      orderBy: [{ tipo: 'asc' }, { chave: 'asc' }],
    });

    const agents = await Promise.all(
      links
        .filter((link) => link.entidade)
        .map(async (link) => {
          const dados = (link.entidade!.dados as Record<string, unknown> | null) ?? {};
          const meta = (link.metaDados as Record<string, unknown> | null) ?? {};
          const projectSlug =
            typeof meta.projectSlug === 'string' ? (meta.projectSlug as string) : null;
          const tunnelPort = this.parseTunnelPort(dados.tunnelPort);
          const probe = await this.agentTunnelService.probe(tunnelPort);

          return {
            linkId: link.chave.toString(),
            agentId: link.entidade!.chave.toString(),
            tipo: this.normalizeTipo(link.tipo),
            name: link.entidade!.nome,
            statusCode: this.stringifyNullable(dados.statusCode),
            lastSeen: this.stringifyNullable(dados.lastSeen),
            version: this.stringifyNullable(dados.version ?? dados.agentVersion),
            claudeVersion: this.stringifyNullable(dados.claudeVersion),
            tunnelPort,
            tunnelOk: probe.tunnelOk,
            tunnelLatencyMs: probe.latencyMs,
            projectSlug,
            ...(probe.error ? { tunnelError: probe.error } : {}),
          };
        }),
    );

    return { projectId: projectId.toString(), agents };
  }

  private async requireProjectManagerOrOrgAdmin(
    projectId: bigint,
    userEntidadeId: bigint,
  ): Promise<ProjectRecord> {
    const project = await this.findProject(projectId);
    const projectRole = await this.roleResolver.getProjectRole(userEntidadeId, projectId);
    if (projectRole === 'MANAGER') {
      return project;
    }

    if (project.idEstab) {
      const orgRole = await this.roleResolver.getOrgRole(userEntidadeId, project.idEstab);
      if (orgRole === 'ADMIN') {
        return project;
      }
    }

    throw new ForbiddenException('Acesso negado: requer MANAGER do projeto ou ADMIN da org');
  }

  private async requireProjectMemberOrOrgAdmin(
    projectId: bigint,
    userEntidadeId: bigint,
  ): Promise<ProjectRecord> {
    const project = await this.findProject(projectId);
    const projectRole = await this.roleResolver.getProjectRole(userEntidadeId, projectId);
    if (projectRole) {
      return project;
    }

    if (project.idEstab) {
      const orgRole = await this.roleResolver.getOrgRole(userEntidadeId, project.idEstab);
      if (orgRole === 'ADMIN') {
        return project;
      }
    }

    throw new ForbiddenException('Acesso negado: requer membro do projeto ou ADMIN da org');
  }

  private async findProject(projectId: bigint): Promise<ProjectRecord> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true, idEstab: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} nao encontrado`);
    }
    return project;
  }

  private async lockProjectAgentLinks(
    tx: Prisma.TransactionClient,
    projectId: bigint,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PROJECT_AGENT_LOCK_BASE + projectId})`;
  }

  private async findActiveExecutionForAgent(
    tx: Prisma.TransactionClient,
    projectId: bigint,
    agentId: bigint,
  ): Promise<{ chave: bigint } | null> {
    const agentIdText = agentId.toString();
    const rows = await tx.$queryRaw<Array<{ chave: bigint }>>`
      SELECT chave
      FROM "DPedido"
      WHERE "idClasse" IN (${Prisma.join(EXECUTION_CLASSES)})
        AND "idLocEscritu" = ${projectId}
        AND "excluido" = false
        AND (
          dados->'audit'->>'agentId' = ${agentIdText}
          OR dados->>'agentId' = ${agentIdText}
        )
        AND (
          dados->>'statusCode' IN (${Prisma.join(ACTIVE_EXECUTION_STATUS_CODES)})
          OR dados->'approval'->>'status' IN ('queued', 'awaiting_approval', 'QUEUED', 'AWAITING_APPROVAL')
          OR (
            dados->'approval'->>'status' IN ('approved', 'APPROVED')
            AND dados->'claude'->>'finishedAt' IS NULL
          )
          OR dados->'execution'->>'status' IN (${Prisma.join(ACTIVE_EXECUTION_STATUS_VALUES)})
          OR dados->>'status' IN (${Prisma.join(ACTIVE_EXECUTION_STATUS_VALUES)})
        )
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  private normalizeTipo(tipo: string | null): ProjectAgentTipo {
    return tipo === 'primary' ? 'primary' : 'secondary';
  }

  private parseTunnelPort(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return null;
  }

  private stringifyNullable(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return String(value);
  }
}
