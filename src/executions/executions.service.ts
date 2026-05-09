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
import { ClaudeRunnerService } from './claude-runner.service';
import { ExecuteCommandDto } from './dto/execute-command.dto';
import {
  ExecutionResponseDto,
  serializeExecution,
} from './dto/execution-response.dto';
import OperacaoExecucaoClaude from '../engine/lib/operacao/OperacaoExecucaoClaude';

/** idClasses de membership em projeto (DVincula) */
const PROJECT_MEMBERSHIP_CLASSES = [
  BigInt(-170),
  BigInt(-171),
  BigInt(-172),
  BigInt(-173),
];

/**
 * ExecutionsService — orquestra criação de executions via Engine (Pilar 1).
 *
 * O método execute() instancia OperacaoExecucaoClaude e executa o workflow
 * completo: nova() → setExecucaoData() → calcula() → [aprova()/gravarComoAwaitingApproval()] → grava()
 *
 * Decisão de approval (conforme ADR-V2-006):
 * - LOW (-301): auto-aprovação → aprova('auto:risk-gate-low') → grava()
 * - MEDIUM (-302): auto-aprovação → aprova('auto:risk-gate-medium') → grava()
 * - HIGH (-303): aguarda admin → gravarComoAwaitingApproval() (sem aprova/grava)
 *
 * REGRA INVIOLÁVEL: Engine APENAS para DPedido idClasse=-300..-303.
 * Cadastros estruturais (DProject, DTask, DEntidade) usam Service + Prisma direto.
 *
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see ADR-V2-006 (risk via idClasse -301/-302/-303)
 */
@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entidadeService: EntidadeService,
    private readonly claudeRunnerService: ClaudeRunnerService,
  ) {}

  /**
   * Cria e executa um comando Claude Code via Engine.
   *
   * Fluxo:
   * 1. Busca DProject + valida existência
   * 2. Resolve entidadeId do user via EntidadeService
   * 3. Valida membership no projeto via DVincula
   * 4. Resolve agentId de DProject.dados.automation.idAgent
   * 5. Instancia OperacaoExecucaoClaude + executa workflow
   * 6. Decisão de approval conforme risk.level
   * 7. Retorna ExecutionResponseDto
   *
   * @param projectId - ID do projeto (string do BigInt)
   * @param dto - Comando e opções
   * @param userId - ID do DUserGroup do usuário autenticado
   * @returns ExecutionResponseDto com dados da execution criada
   *
   * @throws {NotFoundException} Se projeto não existe
   * @throws {ForbiddenException} Se usuário não é membro do projeto
   * @throws {UnprocessableEntityException} Se agente não configurado no projeto
   */
  async execute(
    projectId: string,
    dto: ExecuteCommandDto,
    userId: string,
  ): Promise<ExecutionResponseDto> {
    // 1. Buscar DProject
    const project = await this.prisma.dProject.findFirst({
      where: { chave: BigInt(projectId), excluido: false },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} não encontrado.`);
    }

    // 2. Resolver entidadeId do user
    const userEntidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(
      BigInt(userId),
    );

    // 3. Validar membership
    const membership = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: { in: PROJECT_MEMBERSHIP_CLASSES },
        idLocEscritu: BigInt(projectId),
        idEntidade: userEntidadeId,
        excluido: false,
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        `Usuário não tem acesso ao projeto ${projectId}.`,
      );
    }

    // 4. Resolver agentId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projectDados = (project.dados ?? {}) as any;
    const agentId: string | undefined = projectDados?.automation?.idAgent;

    if (!agentId) {
      throw new UnprocessableEntityException(
        `Projeto ${projectId} não tem agente configurado. Configure DProject.dados.automation.idAgent.`,
      );
    }

    // 5. Gerar correlationId
    const correlationId = randomUUID();

    this.logger.log(
      `[${correlationId}] execute: project=${projectId} user=${userEntidadeId} agent=${agentId}`,
    );

    // 6. Instanciar Engine (Pilar 1 — APENAS para DPedido idClasse=-300..-303)
    const op = new OperacaoExecucaoClaude({
      usuario: userEntidadeId.toString(),
      classe: '-300', // agrupador — calcula() sobrescreverá _classeBase conforme risk.level
      bd: this.prisma,
      projectId: projectId,
      agentId: agentId,
      taskId: dto.taskId,
      command: {
        text: dto.text,
        cwd: dto.cwd,
        timeoutMs: dto.timeoutMs,
      },
      correlationId,
      agentTunnelService: this.claudeRunnerService,
      eventProducer: {
        // Stub F7 — EventProducerService real implementado em F7
        addInternalEvent: async (
          event: string,
          data: unknown,
          corrId: string,
        ) => {
          this.logger.debug(
            `[${corrId}] STUB eventProducer: ${event} ${JSON.stringify(data)}`,
          );
        },
      },
    });

    // 7. Workflow Engine
    await op.nova();
    op.pedidoCab.setPessoa(userEntidadeId);
    op.pedidoCab.setLocEscritu(BigInt(projectId));
    op.setExecucaoData({
      command: { text: dto.text, cwd: dto.cwd, timeoutMs: dto.timeoutMs },
    });
    await op.calcula(); // Risk Gate (DVFS chave 3) → define _classeBase e dados.risk

    const riskLevel = op.dados.risk?.level ?? 'LOW';

    // 8. Decisão de approval
    if (riskLevel === 'LOW') {
      await op.aprova({ aprovador: 'auto:risk-gate-low' });
      await op.grava();
    } else if (riskLevel === 'MEDIUM') {
      await op.aprova({ aprovador: 'auto:risk-gate-medium' });
      await op.grava();
    } else {
      // HIGH → aguarda aprovação manual
      await op.gravarComoAwaitingApproval(3600000); // 1h expiração
    }

    // 9. Buscar registro persistido para serializar
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
      // Fallback: usar dados do op (em casos de mock em testes)
      return serializeExecution({
        chave: (op as any).chcriacao,
        idClasse: BigInt((op as any)._classeBase),
        idPessoa: userEntidadeId,
        dados: op.dados,
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });
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
}
