import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';
import { InstallAgentDto, InstallAgentResponseDto } from './dto/install-agent.dto';
import { HeartbeatDto, HeartbeatResponseDto } from './dto/heartbeat.dto';
import { AgentInstallTokenService } from './agent-install-token.service';
import { AgentKeyService } from './agent-key.service';
import { AgentPortAllocatorService } from './agent-port-allocator.service';

export interface AuthenticatedAgent {
  chave: bigint;
  dados: Record<string, unknown>;
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly installTokenService: AgentInstallTokenService,
    private readonly agentKeyService: AgentKeyService,
    private readonly portAllocator: AgentPortAllocatorService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
  ) {}

  async install(dto: InstallAgentDto): Promise<InstallAgentResponseDto> {
    const agentApiKey = this.agentKeyService.generateSecret(32);
    const agentCommandSecret = this.agentKeyService.generateSecret(32);
    const apiKeyHash = this.agentKeyService.hashSecret(agentApiKey);
    const agentCommandSecretEncrypted =
      this.agentKeyService.encryptCommandSecret(agentCommandSecret);

    const result = await this.prisma.$transaction(async (tx) => {
      const consumed = await this.installTokenService.consumeInstallToken(
        tx,
        dto.installToken,
      );
      const tunnelPort = await this.portAllocator.allocate(tx);

      const agent = await tx.dEntidade.create({
        data: {
          idClasse: AUTOMATION_CLASS_IDS.AGENT,
          nome: dto.hostname,
          idLocEscritu: consumed.projectId,
          dados: {
            projectId: consumed.projectId.toString(),
            installTokenId: consumed.tokenId.toString(),
            installedBy: consumed.createdBy.toString(),
            hostname: dto.hostname,
            os: dto.os ?? null,
            agentVersion: dto.agentVersion ?? null,
            claudeVersion: dto.claudeVersion ?? null,
            publicKeyFingerprint: dto.publicKeyFingerprint ?? null,
            tunnelPort,
            apiKeyHash,
            agentCommandSecretEncrypted,
            statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_NEVER_CONNECTED.toString(),
            lastSeen: null,
            installedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
        select: { chave: true },
      });

      await tx.dVincula.create({
        data: {
          idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
          idLocEscritu: consumed.projectId,
          idEntidade: agent.chave,
          tipo: 'agent',
          metaDados: {
            installedAt: new Date().toISOString(),
            installTokenId: consumed.tokenId.toString(),
          } as Prisma.InputJsonValue,
        },
      });

      return { agentId: agent.chave, tunnelPort };
    });

    await this.eventProducer.addInternalEvent(
      'agent.registered',
      {
        agentId: result.agentId.toString(),
        tunnelPort: result.tunnelPort,
      },
      this.correlationIdService.getOrGenerate(),
      { source: AgentsService.name },
    );

    return {
      agentId: result.agentId.toString(),
      agentApiKey,
      agentCommandSecret,
      tunnelPort: result.tunnelPort,
    };
  }

  async heartbeat(
    agent: AuthenticatedAgent,
    dto: HeartbeatDto,
  ): Promise<HeartbeatResponseDto> {
    const previousStatus = agent.dados.statusCode?.toString();
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.dEntidade.update({
        where: { chave: agent.chave },
        data: {
          dados: {
            ...agent.dados,
            ...(dto.agentVersion !== undefined && { agentVersion: dto.agentVersion }),
            ...(dto.claudeVersion !== undefined && { claudeVersion: dto.claudeVersion }),
            ...(dto.os !== undefined && { os: dto.os }),
            statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString(),
            lastSeen: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.dEvento.create({
        data: {
          idClasse: AUTOMATION_CLASS_IDS.AGENT_HEARTBEAT_EVENT,
          idEntidade: agent.chave,
          descricao: 'agent.heartbeat',
          metaDados: {
            agentId: agent.chave.toString(),
            at: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    });

    if (previousStatus === AUTOMATION_CLASS_IDS.AGENT_STATUS_OFFLINE.toString()) {
      await this.eventProducer.addInternalEvent(
        'agent.online',
        { agentId: agent.chave.toString(), lastSeen: now.toISOString() },
        this.correlationIdService.getOrGenerate(),
        { source: AgentsService.name },
      );
    }

    return {
      ok: true,
      agentId: agent.chave.toString(),
      statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString(),
      lastSeen: now.toISOString(),
    };
  }

  async findAgentForAuth(agentId: bigint): Promise<AuthenticatedAgent> {
    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: agentId,
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true, dados: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent nao encontrado');
    }

    return {
      chave: agent.chave,
      dados: (agent.dados as Record<string, unknown> | null) ?? {},
    };
  }
}
