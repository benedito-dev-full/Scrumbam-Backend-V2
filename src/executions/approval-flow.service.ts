import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EntidadeService } from '../entidades/entidades.service';
import { ClaudeRunnerService } from './claude-runner.service';
import { ExecutionsService } from './executions.service';
import { ApproveExecutionDto } from './dto/approve-execution.dto';
import { RejectExecutionDto } from './dto/reject-execution.dto';
import {
  ExecutionResponseDto,
  serializeExecution,
} from './dto/execution-response.dto';
import OperacaoExecucaoClaude from '../engine/lib/operacao/OperacaoExecucaoClaude';

/** idClasses de execução */
const EXECUTION_CLASSES = [BigInt(-301), BigInt(-302), BigInt(-303)];

/** idClasses de membership ADMIN/MANAGER */
const MANAGER_CLASSES = [BigInt(-171)];
const PROJECT_MEMBERSHIP_CLASSES = [
  BigInt(-170),
  BigInt(-171),
  BigInt(-172),
  BigInt(-173),
];

/**
 * ApprovalFlowService — gerencia approve/reject/rollback de executions HIGH.
 *
 * Implementa race condition safety para approve():
 * - UPDATE atômico via $executeRaw com WHERE condicional
 * - Apenas o primeiro admin que chamar approve() vence (count > 0)
 * - Segundo admin recebe ConflictException (409)
 *
 * @see docs/plano/02-DOMINIO-ENGINE.md §6.11
 */
@Injectable()
export class ApprovalFlowService {
  private readonly logger = new Logger(ApprovalFlowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entidadeService: EntidadeService,
    private readonly claudeRunnerService: ClaudeRunnerService,
    private readonly executionsService: ExecutionsService,
  ) {}

  /**
   * Aprova uma execution em awaiting_approval.
   *
   * Implementa race-safe via UPDATE atômico:
   * - $executeRaw com WHERE dados->approval->status = 'awaiting_approval'
   * - Se count=0: outro admin já decidiu → ConflictException
   *
   * Após approve bem-sucedido, reconstrói Engine e chama gravarAposAprovacaoManual()
   * para executar DVFS 6,7 + Claude Runner.
   *
   * @param executionId - ID da execution (BigInt como string)
   * @param userId - ID do DUserGroup do admin
   * @param dto - DTO com notas opcionais
   * @returns ExecutionResponseDto atualizado
   *
   * @throws {NotFoundException} Se execution não existe
   * @throws {BadRequestException} Se execution não está em awaiting_approval
   * @throws {ForbiddenException} Se usuário não é MANAGER do projeto
   * @throws {ConflictException} Se outro admin já decidiu (race condition)
   */
  async approve(
    executionId: string,
    userId: string,
    dto: ApproveExecutionDto,
  ): Promise<ExecutionResponseDto> {
    // 1. Buscar execution
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        chave: BigInt(executionId),
        idClasse: { in: EXECUTION_CLASSES },
        excluido: false,
      },
    });

    if (!pedido) {
      throw new NotFoundException(`Execution ${executionId} não encontrada.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dados = pedido.dados as any;

    // 2. Validar status
    if (dados?.approval?.status !== 'awaiting_approval') {
      throw new BadRequestException(
        `Execution ${executionId} não está em awaiting_approval (status atual: ${dados?.approval?.status}).`,
      );
    }

    // 3. Validar ADMIN do projeto
    const userEntidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(
      BigInt(userId),
    );

    if (pedido.idLocEscritu) {
      await this._validateManagerAccess(
        pedido.idLocEscritu,
        userEntidadeId,
        executionId,
      );
    }

    // 4. UPDATE race-safe via $executeRaw
    const notesJson = dto.notes ? JSON.stringify(dto.notes) : 'null';
    const updated = await this.prisma.$executeRaw`
      UPDATE "DPedido"
      SET dados = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(dados, '{approval,status}', '"approved"'),
                '{approval,approvedBy}', to_jsonb(${userEntidadeId.toString()}::text)
              ),
              '{approval,decidedAt}', to_jsonb(NOW()::text)
            ),
            '{approval,notes}', ${notesJson}::jsonb
          ),
          aprovado = true,
          "atualizadoEm" = NOW()
      WHERE chave = ${BigInt(executionId)}
        AND dados->'approval'->>'status' = 'awaiting_approval'
    `;

    if (updated === 0) {
      throw new ConflictException(
        `Execution ${executionId} não está mais em awaiting_approval. Outro admin pode ter decidido simultaneamente.`,
      );
    }

    this.logger.log(
      `[ApprovalFlow] Execution ${executionId} aprovada por ${userEntidadeId}`,
    );

    // 5. Recarregar pedido após UPDATE
    const pedidoAtualizado = await this.prisma.dPedido.findFirst({
      where: { chave: BigInt(executionId) },
    });

    if (!pedidoAtualizado) {
      throw new NotFoundException(
        `Execution ${executionId} não encontrada após aprovação.`,
      );
    }

    // 6. Reconstituir Engine e executar workflow pós-aprovação
    const dadosAtualizados = pedidoAtualizado.dados as any;
    const correlationId =
      dadosAtualizados?.audit?.correlationId ?? `approve-${executionId}`;

    const op = new OperacaoExecucaoClaude({
      usuario: dadosAtualizados?.audit?.triggeredBy ?? userId,
      classe: pedidoAtualizado.idClasse.toString(),
      bd: this.prisma,
      projectId: dadosAtualizados?.audit?.projectId ?? '0',
      agentId: dadosAtualizados?.audit?.agentId ?? '0',
      taskId: dadosAtualizados?.task?.id,
      command: dadosAtualizados?.command ?? { text: '' },
      correlationId,
      agentTunnelService: this.claudeRunnerService,
      eventProducer: {
        addInternalEvent: async (event: string, data: unknown, corrId: string) => {
          this.logger.debug(`[${corrId}] STUB eventProducer: ${event} ${JSON.stringify(data)}`);
        },
      },
    });

    // Chamar gravarAposAprovacaoManual — restaura state + aprova + DVFS 6,7 + UPDATE + Claude
    await op.gravarAposAprovacaoManual({
      aprovador: userEntidadeId.toString(),
      dadosExistentes: {
        chave: pedidoAtualizado.chave,
        dados: dadosAtualizados,
        idClasse: pedidoAtualizado.idClasse,
        aprovado: pedidoAtualizado.aprovado,
        baixado: pedidoAtualizado.baixado,
      },
    });

    // 7. Buscar estado final e retornar
    const pedidoFinal = await this.prisma.dPedido.findFirst({
      where: { chave: BigInt(executionId) },
      select: {
        chave: true,
        idClasse: true,
        idPessoa: true,
        dados: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    return serializeExecution({
      chave: pedidoFinal!.chave,
      idClasse: pedidoFinal!.idClasse,
      idPessoa: pedidoFinal!.idPessoa,
      dados: pedidoFinal!.dados,
      criadoEm: pedidoFinal!.criadoEm,
      atualizadoEm: pedidoFinal!.atualizadoEm,
    });
  }

  /**
   * Rejeita uma execution em awaiting_approval.
   *
   * Race-safe: UPDATE condicional com WHERE dados->approval->status = 'awaiting_approval'.
   *
   * @param executionId - ID da execution
   * @param userId - ID do DUserGroup do admin
   * @param dto - Motivo obrigatório
   * @returns ExecutionResponseDto com status 'rejected'
   *
   * @throws {NotFoundException} Se execution não existe
   * @throws {BadRequestException} Se não está em awaiting_approval
   * @throws {ForbiddenException} Se não é MANAGER
   * @throws {ConflictException} Se outro admin já decidiu
   */
  async reject(
    executionId: string,
    userId: string,
    dto: RejectExecutionDto,
  ): Promise<ExecutionResponseDto> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        chave: BigInt(executionId),
        idClasse: { in: EXECUTION_CLASSES },
        excluido: false,
      },
    });

    if (!pedido) {
      throw new NotFoundException(`Execution ${executionId} não encontrada.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dados = pedido.dados as any;

    if (dados?.approval?.status !== 'awaiting_approval') {
      throw new BadRequestException(
        `Execution ${executionId} não está em awaiting_approval (status atual: ${dados?.approval?.status}).`,
      );
    }

    const userEntidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(
      BigInt(userId),
    );

    if (pedido.idLocEscritu) {
      await this._validateManagerAccess(
        pedido.idLocEscritu,
        userEntidadeId,
        executionId,
      );
    }

    const reasonJson = JSON.stringify(dto.reason);
    const updated = await this.prisma.$executeRaw`
      UPDATE "DPedido"
      SET dados = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(dados, '{approval,status}', '"rejected"'),
                '{approval,rejectedBy}', to_jsonb(${userEntidadeId.toString()}::text)
              ),
              '{approval,rejectedReason}', ${reasonJson}::jsonb
            ),
            '{approval,decidedAt}', to_jsonb(NOW()::text)
          ),
          "atualizadoEm" = NOW()
      WHERE chave = ${BigInt(executionId)}
        AND dados->'approval'->>'status' = 'awaiting_approval'
    `;

    if (updated === 0) {
      throw new ConflictException(
        `Execution ${executionId} não está mais em awaiting_approval. Outro admin pode ter decidido simultaneamente.`,
      );
    }

    this.logger.log(
      `[ApprovalFlow] Execution ${executionId} rejeitada por ${userEntidadeId}: ${dto.reason}`,
    );

    const pedidoFinal = await this.prisma.dPedido.findFirst({
      where: { chave: BigInt(executionId) },
      select: {
        chave: true,
        idClasse: true,
        idPessoa: true,
        dados: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    return serializeExecution({
      chave: pedidoFinal!.chave,
      idClasse: pedidoFinal!.idClasse,
      idPessoa: pedidoFinal!.idPessoa,
      dados: pedidoFinal!.dados,
      criadoEm: pedidoFinal!.criadoEm,
      atualizadoEm: pedidoFinal!.atualizadoEm,
    });
  }

  /**
   * Cria rollback de uma execution: gera nova execution com git reset --hard.
   *
   * A nova execution passará pelo Risk Gate e será classificada como HIGH
   * (contém force push + reset --hard) → exigirá nova aprovação manual.
   *
   * Após criação: marca dados.pullRequest.rolledBackAt na execution original.
   *
   * @param executionId - ID da execution original
   * @param userId - ID do DUserGroup do admin
   * @returns ExecutionResponseDto da nova execution de rollback
   *
   * @throws {NotFoundException} Se execution não existe
   * @throws {BadRequestException} Se execution não tem git.headBefore
   * @throws {ForbiddenException} Se não é MANAGER
   */
  async rollback(
    executionId: string,
    userId: string,
  ): Promise<ExecutionResponseDto> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        chave: BigInt(executionId),
        idClasse: { in: EXECUTION_CLASSES },
        excluido: false,
      },
    });

    if (!pedido) {
      throw new NotFoundException(`Execution ${executionId} não encontrada.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dados = pedido.dados as any;

    if (!dados?.git?.headBefore) {
      throw new BadRequestException(
        `Execution ${executionId} não tem dados de git.headBefore. Apenas executions que modificaram o código podem ser revertidas.`,
      );
    }

    const userEntidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(
      BigInt(userId),
    );

    if (pedido.idLocEscritu) {
      await this._validateManagerAccess(
        pedido.idLocEscritu,
        userEntidadeId,
        executionId,
      );
    }

    const projectId = dados?.audit?.projectId;
    const branch = dados?.git?.branch ?? 'main';

    // Comando de rollback — será classificado HIGH pelo Risk Gate
    const rollbackCommand =
      `git reset --hard ${dados.git.headBefore} && git push --force-with-lease origin ${branch}`;

    this.logger.log(
      `[ApprovalFlow] Rollback: execution=${executionId} headBefore=${dados.git.headBefore}`,
    );

    // Cria nova execution HIGH via ExecutionsService.execute()
    const newExecution = await this.executionsService.execute(
      projectId,
      { text: rollbackCommand },
      userId,
    );

    // Marcar execution original com rollbackAt
    await this.prisma.$executeRaw`
      UPDATE "DPedido"
      SET dados = jsonb_set(
            jsonb_set(dados, '{pullRequest,rolledBackAt}', to_jsonb(NOW()::text)),
            '{pullRequest,rollbackRef}', to_jsonb(${newExecution.id}::text)
          ),
          "atualizadoEm" = NOW()
      WHERE chave = ${BigInt(executionId)}
    `;

    return newExecution;
  }

  /**
   * Valida que o user é MANAGER (idClasse=-171) do projeto.
   * Também aceita membros de níveis superiores.
   *
   * @param projectId - ID do projeto
   * @param userEntidadeId - DEntidade.chave do user
   * @param executionId - Para contexto de erro
   * @throws {ForbiddenException} Se não é MANAGER
   */
  private async _validateManagerAccess(
    projectId: bigint,
    userEntidadeId: bigint,
    executionId: string,
  ): Promise<void> {
    const managerVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: { in: MANAGER_CLASSES },
        idLocEscritu: projectId,
        idEntidade: userEntidadeId,
        excluido: false,
      },
    });

    if (!managerVinculo) {
      // Check if user is any member (more informative error)
      const anyMembership = await this.prisma.dVincula.findFirst({
        where: {
          idClasse: { in: PROJECT_MEMBERSHIP_CLASSES },
          idLocEscritu: projectId,
          idEntidade: userEntidadeId,
          excluido: false,
        },
      });

      if (!anyMembership) {
        throw new ForbiddenException(
          `Usuário não tem acesso ao projeto da execution ${executionId}.`,
        );
      }

      throw new ForbiddenException(
        `Apenas PROJECT_MANAGER pode aprovar/rejeitar/rollback executions. Execution ${executionId}.`,
      );
    }
  }
}
