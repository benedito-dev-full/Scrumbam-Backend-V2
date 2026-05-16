import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { isValidRepoUrl } from '../../projects/utils/repo-url';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';
import { RemoteExecutionClient } from '../runtime/remote-execution-client';
import { ProvisionResponseDto } from './dto/provision-response.dto';

const DEFAULT_BASE_DIR = '/home/projetos';
// depth omitido = full clone no agente (readOptionalPositiveInt rejeita 0)
// ADR-V2-044: shallow (depth=1) quebra git push no Milestone 2
const DEFAULT_TIMEOUT_SEC = 60;

interface ProvisionAck {
  accepted?: unknown;
  alreadyExisted?: unknown;
  projectPath?: unknown;
  currentBranch?: unknown;
  headCommitSha?: unknown;
  usedSshKey?: unknown;
  errorCode?: unknown;
  message?: unknown;
}

interface ProjectRecord {
  chave: bigint;
  idEstab: bigint | null;
  repoUrl: string | null;
  dados: Record<string, unknown>;
}

interface LinkRecord {
  chave: bigint;
  metaDados: Record<string, unknown>;
}

interface AgentRuntime {
  chave: bigint;
  tunnelPort: number;
  agentCommandSecretEncrypted: string;
}

/**
 * Orquestra o clone/pull de um projeto na VPS via agent HMAC.
 *
 * Fluxo:
 * 1. Valida RBAC: MANAGER do projeto ou ADMIN da org.
 * 2. Resolve `repoUrl` canônico (`DProject.repoUrl`, fallback legado `dados.gitRepo`).
 * 3. Carrega vinculo `PROJECT_AGENT` e `projectSlug`.
 * 4. Dispara `PROVISION_PROJECT` no agente.
 * 5. Persiste metadados de provisionamento em `DVincula -185 metaDados`.
 * 6. Emite `project.provisioned` apos persistencia.
 */
@Injectable()
export class ProvisionService {
  private readonly logger = new Logger(ProvisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly remoteClient: RemoteExecutionClient,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly roleResolver: RoleResolverService,
  ) {}

  /**
   * Provisiona o repositório do projeto no agente alvo.
   *
   * @throws {NotFoundException} Projeto, agente ou vinculo nao encontrado.
   * @throws {ForbiddenException} Usuario sem permissao gerencial.
   * @throws {BadRequestException} Projeto sem `repoUrl` valido.
   * @throws {ConflictException} Vinculo sem `projectSlug` ou agente retorna conflito funcional.
   * @throws {ServiceUnavailableException} Agente offline, desatualizado ou ACK invalido.
   */
  async provision(
    projectId: bigint,
    agentId: bigint,
    useSshKey: boolean | undefined,
    userId: bigint,
  ): Promise<ProvisionResponseDto> {
    const project = await this.requireProjectManagerOrOrgAdmin(projectId, userId);
    const repoUrl = this.resolveRepoUrl(project);
    const { link, agent, projectSlug } = await this.loadLinkAndAgent(projectId, agentId);
    const correlationId = this.correlationIdService.getOrGenerate();
    const effectiveUseSshKey = useSshKey ?? true;

    let ack: ProvisionAck;
    try {
      ack = await this.remoteClient.dispatch<
        {
          projectSlug: string;
          repoUrl: string;
          useSshKey: boolean;
          baseDir: string;
          timeoutSec: number;
        },
        ProvisionAck
      >(
        'PROVISION_PROJECT',
        {
          projectSlug,
          repoUrl,
          useSshKey: effectiveUseSshKey,
          baseDir: DEFAULT_BASE_DIR,
          timeoutSec: DEFAULT_TIMEOUT_SEC,
        },
        {
          agent: {
            agentId: agent.chave.toString(),
            tunnelPort: agent.tunnelPort,
            agentCommandSecretEncrypted: agent.agentCommandSecretEncrypted,
          },
          correlationId,
        },
      );
    } catch (err) {
      await this.emitFailedEvent(projectId, agentId, userId, projectSlug, err, correlationId);
      throw err;
    }

    try {
      this.assertValidAck(ack, agent.chave, projectSlug);
    } catch (err) {
      await this.emitFailedEvent(projectId, agentId, userId, projectSlug, err, correlationId);
      throw err;
    }

    const provisionedAt = new Date().toISOString();
    const alreadyExisted = ack.alreadyExisted === true;
    const usedSshKey = ack.usedSshKey === true;
    const projectPath = ack.projectPath as string;
    const currentBranch = ack.currentBranch as string;
    const headCommitSha = ack.headCommitSha as string;

    await this.prisma.dVincula.update({
      where: { chave: link.chave },
      data: {
        metaDados: {
          ...link.metaDados,
          repoUrl,
          lastProvisionedAt: provisionedAt,
          lastProvisionAlreadyExisted: alreadyExisted,
          lastProvisionHeadSha: headCommitSha,
          lastProvisionBranch: currentBranch,
          lastProvisionProjectPath: projectPath,
          lastProvisionUsedSshKey: usedSshKey,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.eventProducer.addInternalEvent(
      'project.provisioned',
      {
        projectId: projectId.toString(),
        agentId: agentId.toString(),
        userId: userId.toString(),
        projectSlug,
        repoUrl,
        alreadyExisted,
        headCommitSha,
        currentBranch,
        usedSshKey,
      },
      correlationId,
      { source: ProvisionService.name },
    );

    this.logger.log(
      `project-provisioned projectId=${projectId.toString()} agentId=${agentId.toString()} ` +
        `slug=${projectSlug} alreadyExisted=${alreadyExisted} head=${headCommitSha}`,
    );

    return {
      projectSlug,
      projectPath,
      alreadyExisted,
      currentBranch,
      headCommitSha,
      provisionedAt,
      usedSshKey,
    };
  }

  private resolveRepoUrl(project: ProjectRecord): string {
    const legacyRepoUrl =
      typeof project.dados.gitRepo === 'string' ? (project.dados.gitRepo as string) : null;
    const repoUrl = project.repoUrl ?? legacyRepoUrl;
    if (!repoUrl) {
      throw new BadRequestException(`Projeto ${project.chave.toString()} sem repoUrl configurado`);
    }
    if (!isValidRepoUrl(repoUrl)) {
      throw new BadRequestException(`Projeto ${project.chave.toString()} possui repoUrl invalido`);
    }
    return repoUrl;
  }

  private assertValidAck(ack: ProvisionAck, agentId: bigint, projectSlug: string): void {
    if (ack?.accepted !== true) {
      const code = typeof ack?.errorCode === 'string' ? ack.errorCode : 'UNKNOWN';
      const message =
        typeof ack?.message === 'string' && ack.message.length > 0
          ? ack.message
          : 'Agent nao aceitou provisionamento';
      if (code === 'PROJECT_DIR_EXISTS_NOT_GIT') {
        throw new ConflictException(message);
      }
      throw new ServiceUnavailableException(
        `Agent ${agentId.toString()} nao confirmou provisionamento (code=${code})`,
      );
    }
    if (
      typeof ack.projectPath !== 'string' ||
      typeof ack.currentBranch !== 'string' ||
      typeof ack.headCommitSha !== 'string'
    ) {
      throw new ServiceUnavailableException(
        `Agent ${agentId.toString()} retornou ACK invalido para provision (slug=${projectSlug})`,
      );
    }
  }

  private async loadLinkAndAgent(
    projectId: bigint,
    agentId: bigint,
  ): Promise<{ link: LinkRecord; agent: AgentRuntime; projectSlug: string }> {
    const link = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
        idLocEscritu: projectId,
        idEntidade: agentId,
        excluido: false,
      },
      select: { chave: true, metaDados: true },
    });
    if (!link) {
      throw new NotFoundException(
        `Vinculo projectId=${projectId.toString()} agentId=${agentId.toString()} nao encontrado`,
      );
    }

    const metaDados = (link.metaDados as Record<string, unknown> | null) ?? {};
    const projectSlug = typeof metaDados.projectSlug === 'string' ? metaDados.projectSlug : '';
    if (!/^[a-z0-9-]{1,64}$/.test(projectSlug)) {
      throw new ConflictException(
        `Vinculo projectId=${projectId.toString()} agentId=${agentId.toString()} sem projectSlug valido`,
      );
    }

    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: agentId,
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true, dados: true },
    });
    if (!agent) {
      throw new NotFoundException(`Agente ${agentId.toString()} nao encontrado`);
    }

    const dados = (agent.dados as Record<string, unknown> | null) ?? {};
    const tunnelPortRaw = dados.tunnelPort;
    const secretRaw = dados.agentCommandSecretEncrypted;
    if (typeof tunnelPortRaw !== 'number' || !Number.isInteger(tunnelPortRaw)) {
      throw new ServiceUnavailableException(
        `Agent ${agentId.toString()} sem tunnelPort (estado invalido)`,
      );
    }
    if (typeof secretRaw !== 'string' || secretRaw.length === 0) {
      throw new ServiceUnavailableException(
        `Agent ${agentId.toString()} sem agentCommandSecretEncrypted (estado invalido)`,
      );
    }

    return {
      link: { chave: link.chave, metaDados },
      agent: {
        chave: agent.chave,
        tunnelPort: tunnelPortRaw,
        agentCommandSecretEncrypted: secretRaw,
      },
      projectSlug,
    };
  }

  private async requireProjectManagerOrOrgAdmin(
    projectId: bigint,
    userId: bigint,
  ): Promise<ProjectRecord> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true, idEstab: true, repoUrl: true, dados: true },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId.toString()} nao encontrado`);
    }

    const projectRole = await this.roleResolver.getProjectRole(userId, projectId);
    if (projectRole === 'MANAGER') {
      return {
        chave: project.chave,
        idEstab: project.idEstab,
        repoUrl: project.repoUrl,
        dados: (project.dados as Record<string, unknown> | null) ?? {},
      };
    }
    if (project.idEstab) {
      const orgRole = await this.roleResolver.getOrgRole(userId, project.idEstab);
      if (orgRole === 'ADMIN') {
        return {
          chave: project.chave,
          idEstab: project.idEstab,
          repoUrl: project.repoUrl,
          dados: (project.dados as Record<string, unknown> | null) ?? {},
        };
      }
    }
    throw new ForbiddenException(
      'Acesso negado: requer MANAGER do projeto ou ADMIN da organizacao',
    );
  }

  private async emitFailedEvent(
    projectId: bigint,
    agentId: bigint,
    userId: bigint,
    projectSlug: string,
    err: unknown,
    correlationId: string,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await this.eventProducer.addInternalEvent(
        'project.provision.failed',
        {
          projectId: projectId.toString(),
          agentId: agentId.toString(),
          userId: userId.toString(),
          projectSlug,
          errorMessage: message.slice(0, 500),
        },
        correlationId,
        { source: ProvisionService.name },
      );
    } catch (eventErr) {
      this.logger.warn(
        `falha ao emitir project.provision.failed projectId=${projectId.toString()} agentId=${agentId.toString()} ` +
          `slug=${projectSlug} originalError=${message} eventError=${
            eventErr instanceof Error ? eventErr.message : String(eventErr)
          }`,
      );
    }
  }
}
