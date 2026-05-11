import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { EntidadeService } from '../entidades/entidades.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { ClaudeRunnerService } from './claude-runner.service';
import { AgentTunnelService } from '../automation/agents/agent-tunnel.service';
import { AUTOMATION_CLASS_IDS } from '../automation/constants/automation-class-ids';
import { CommandValidatorService } from './services/command-validator.service';
import { ExecutionQueueService } from './queues/execution-queue.service';
import { ExecuteCommandDto } from './dto/execute-command.dto';
import {
  ExecutionResponseDto,
  serializeExecution,
} from './dto/execution-response.dto';
import OperacaoExecucaoClaude from '../engine/lib/operacao/OperacaoExecucaoClaude';

const PROJECT_MEMBERSHIP_CLASSES = [
  BigInt(-170),
  BigInt(-171),
  BigInt(-172),
  BigInt(-173),
];

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entidadeService: EntidadeService,
    private readonly claudeRunnerService: ClaudeRunnerService,
    private readonly eventProducer: EventProducerService,
    private readonly commandValidator: CommandValidatorService,
    private readonly agentTunnelService: AgentTunnelService,
    private readonly executionQueue: ExecutionQueueService,
  ) {}

  async execute(
    projectId: string,
    dto: ExecuteCommandDto,
    userId: string,
    idempotencyKey?: string,
  ): Promise<ExecutionResponseDto> {
    if (!dto.command) {
      throw new UnprocessableEntityException(
        'POST /projects/:id/execute exige command estruturado. Campo text livre nao e aceito.',
      );
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: BigInt(projectId), excluido: false },
    });
    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} nao encontrado.`);
    }

    const userEntidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(
      BigInt(userId),
    );

    const existingExecution = idempotencyKey
      ? await this.findIdempotentExecution(projectId, userEntidadeId.toString(), idempotencyKey)
      : null;
    if (existingExecution) {
      return existingExecution;
    }

    const membership = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: { in: PROJECT_MEMBERSHIP_CLASSES },
        idLocEscritu: BigInt(projectId),
        idEntidade: userEntidadeId,
        excluido: false,
      },
    });
    if (!membership) {
      throw new ForbiddenException(`Usuario nao tem acesso ao projeto ${projectId}.`);
    }

    this.commandValidator.validate(dto.command);

    const agent = await this.resolvePrimaryAgent(BigInt(projectId), dto.agentId);
    const agentId = agent.chave.toString();
    const correlationId = randomUUID();
    const commandText = this.toCommandText(dto.command);

    this.logger.log(
      `[${correlationId}] execute: project=${projectId} user=${userEntidadeId} agent=${agentId}`,
    );

    const command = {
      text: commandText,
      executable: dto.command.executable,
      args: dto.command.args,
      cwd: dto.command.cwd,
      env: dto.command.env,
      timeoutMs: dto.command.timeoutMs,
    };

    const op = new OperacaoExecucaoClaude({
      usuario: userEntidadeId.toString(),
      classe: '-300',
      bd: this.prisma,
      projectId,
      agentId,
      taskId: dto.taskId,
      command,
      correlationId,
      agentTunnelService: this.claudeRunnerService,
      eventProducer: this.eventProducer,
    });

    await op.nova();
    op.pedidoCab.setPessoa(userEntidadeId);
    op.pedidoCab.setLocEscritu(BigInt(projectId));
    op.setExecucaoData({
      command,
      idempotency: idempotencyKey
        ? { key: idempotencyKey, userId: userEntidadeId.toString(), projectId }
        : undefined,
      rollbackOnFailure: dto.rollbackOnFailure === true,
    } as any);
    await op.calcula();

    const riskLevel = op.dados.risk?.level ?? 'LOW';
    op.setExecucaoData({
      riskLevelCode: this.toRiskLevelCode(riskLevel),
      statusCode:
        riskLevel === 'LOW'
          ? AUTOMATION_CLASS_IDS.EXEC_STATUS_QUEUED.toString()
          : AUTOMATION_CLASS_IDS.EXEC_STATUS_AWAITING_APPROVAL.toString(),
    } as any);

    if (riskLevel === 'LOW') {
      await op.gravarComoQueued();
    } else {
      await op.gravarComoAwaitingApproval(3600000);
    }

    const pedido = await this.prisma.dPedido.findFirst({
      where: { chave: (op as any).chcriacao },
      select: {
        chave: true,
        idClasse: true,
        idPessoa: true,
        dados: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    if (!pedido) {
      const response = serializeExecution({
        chave: (op as any).chcriacao,
        idClasse: BigInt((op as any)._classeBase),
        idPessoa: userEntidadeId,
        dados: op.dados,
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });
      if (riskLevel === 'LOW') {
        await this.executionQueue.enqueueExecution({
          executionId: response.id,
          projectId,
          agentId,
        });
      }
      return response;
    }

    const response = serializeExecution({
      chave: pedido.chave,
      idClasse: pedido.idClasse,
      idPessoa: pedido.idPessoa,
      dados: pedido.dados,
      criadoEm: pedido.criadoEm,
      atualizadoEm: pedido.atualizadoEm,
    });
    if (riskLevel === 'LOW') {
      await this.executionQueue.enqueueExecution({
        executionId: response.id,
        projectId,
        agentId,
      });
    }
    return response;
  }

  private toCommandText(command: ExecuteCommandDto['command']): string {
    return [command.executable, ...command.args].join(' ').trim();
  }

  private toRiskLevelCode(riskLevel: string): string {
    if (riskLevel === 'HIGH') return AUTOMATION_CLASS_IDS.RISK_LEVEL_HIGH.toString();
    if (riskLevel === 'MEDIUM') return AUTOMATION_CLASS_IDS.RISK_LEVEL_MEDIUM.toString();
    return AUTOMATION_CLASS_IDS.RISK_LEVEL_LOW.toString();
  }

  private async findIdempotentExecution(
    projectId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<ExecutionResponseDto | null> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        idClasse: {
          in: [
            AUTOMATION_CLASS_IDS.EXEC_LOW,
            AUTOMATION_CLASS_IDS.EXEC_MEDIUM,
            AUTOMATION_CLASS_IDS.EXEC_HIGH,
          ],
        },
        idLocEscritu: BigInt(projectId),
        excluido: false,
        dados: {
          path: ['idempotency', 'key'],
          equals: idempotencyKey,
        },
      } as any,
      select: {
        chave: true,
        idClasse: true,
        idPessoa: true,
        dados: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    if (!pedido) return null;

    const dados = (pedido.dados ?? {}) as any;
    if (dados?.idempotency?.userId !== userId || dados?.idempotency?.projectId !== projectId) {
      return null;
    }

    return serializeExecution({
      chave: pedido.chave,
      idClasse: pedido.idClasse,
      idPessoa: pedido.idPessoa,
      dados: pedido.dados,
      criadoEm: pedido.criadoEm,
      atualizadoEm: pedido.atualizadoEm,
    });
  }

  private async resolvePrimaryAgent(
    projectId: bigint,
    requestedAgentId?: string,
  ): Promise<{ chave: bigint }> {
    const link = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
        idLocEscritu: projectId,
        tipo: 'primary',
        excluido: false,
      },
      include: {
        entidade: {
          select: { chave: true, dados: true },
        },
      },
    });

    if (!link?.entidade) {
      throw new UnprocessableEntityException(`Projeto ${projectId} nao tem agent primary vinculado.`);
    }

    if (requestedAgentId && requestedAgentId !== link.entidade.chave.toString()) {
      throw new UnprocessableEntityException(`agentId informado nao e o primary do projeto ${projectId}.`);
    }

    const dados = (link.entidade.dados ?? {}) as Record<string, unknown>;
    if (String(dados.statusCode) !== AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString()) {
      throw new UnprocessableEntityException('Agent primary nao esta online.');
    }

    const tunnelPort =
      typeof dados.tunnelPort === 'number'
        ? dados.tunnelPort
        : typeof dados.tunnelPort === 'string' && /^\d+$/.test(dados.tunnelPort)
          ? Number(dados.tunnelPort)
          : null;

    const probe = await this.agentTunnelService.probe(tunnelPort);
    if (!probe.tunnelOk) {
      throw new UnprocessableEntityException(`Tunnel do agent indisponivel: ${probe.error ?? 'TUNNEL_UNAVAILABLE'}`);
    }

    return { chave: link.entidade.chave };
  }
}
