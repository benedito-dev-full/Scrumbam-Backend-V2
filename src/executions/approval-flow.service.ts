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
import { EventProducerService } from '../eventos/core/event-producer.service';
import { AUTOMATION_CLASS_IDS } from '../automation/constants/automation-class-ids';
import { ExecutionQueueService } from './queues/execution-queue.service';
import { ApproveExecutionDto } from './dto/approve-execution.dto';
import { RejectExecutionDto } from './dto/reject-execution.dto';
import {
  ExecutionResponseDto,
  serializeExecution,
} from './dto/execution-response.dto';

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
    private readonly eventProducer: EventProducerService,
    private readonly executionQueue: ExecutionQueueService,
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
   * @throws {NotFoundException} Se execution nao existe
   * @throws {BadRequestException} Se execution nao esta em awaiting_approval
   * @throws {ForbiddenException} Se usuario nao e manager do projeto
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
                jsonb_set(
                  jsonb_set(dados, '{approval,status}', '"approved"'),
                  '{approval,approvedBy}', to_jsonb(${userEntidadeId.toString()}::text)
                ),
                '{approval,decidedAt}', to_jsonb(NOW()::text)
              ),
              '{approval,notes}', ${notesJson}::jsonb
            ),
            '{statusCode}', to_jsonb(${AUTOMATION_CLASS_IDS.EXEC_STATUS_APPROVED.toString()}::text)
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

    await this.eventProducer.addInternalEvent('execution.approved', {
      executionId,
      projectId: dadosAtualizados?.audit?.projectId,
      agentId: dadosAtualizados?.audit?.agentId,
      approvedBy: userEntidadeId.toString(),
    }, correlationId, { source: ApprovalFlowService.name });

    await this.executionQueue.enqueueExecution({
      executionId,
      projectId: String(dadosAtualizados?.audit?.projectId ?? pedidoAtualizado.idLocEscritu ?? '0'),
      agentId: String(dadosAtualizados?.audit?.agentId ?? '0'),
    });

    // Chamar gravarAposAprovacaoManual — restaura state + aprova + DVFS 6,7 + UPDATE + Claude
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
   * @throws {NotFoundException} Se execution nao existe
   * @throws {BadRequestException} Se execution nao esta em awaiting_approval
   * @throws {ForbiddenException} Se usuario nao e manager do projeto
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
                jsonb_set(
                  jsonb_set(dados, '{approval,status}', '"rejected"'),
                  '{approval,rejectedBy}', to_jsonb(${userEntidadeId.toString()}::text)
                ),
                '{approval,rejectedReason}', ${reasonJson}::jsonb
              ),
              '{approval,decidedAt}', to_jsonb(NOW()::text)
            ),
            '{statusCode}', to_jsonb(${AUTOMATION_CLASS_IDS.EXEC_STATUS_REJECTED.toString()}::text)
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

    const response = serializeExecution({
      chave: pedidoFinal!.chave,
      idClasse: pedidoFinal!.idClasse,
      idPessoa: pedidoFinal!.idPessoa,
      dados: pedidoFinal!.dados,
      criadoEm: pedidoFinal!.criadoEm,
      atualizadoEm: pedidoFinal!.atualizadoEm,
    });

    const dadosFinais = (pedidoFinal!.dados ?? {}) as any;
    await this.eventProducer.addInternalEvent('execution.rejected', {
      executionId,
      projectId: dadosFinais?.audit?.projectId,
      agentId: dadosFinais?.audit?.agentId,
      rejectedBy: userEntidadeId.toString(),
      reason: dto.reason,
    }, dadosFinais?.audit?.correlationId ?? `reject-${executionId}`, { source: ApprovalFlowService.name });

    return response;
  }
  /**
   * Rollback manual legado desabilitado.
   *
   * A F13 Bloco E permite rollback automatico apenas pelo RollbackService conservador.
   *
   * @throws {BadRequestException} Enquanto nao existir fluxo manual conservador
   */
  async rollback(
    executionId: string,
    _userId: string,
  ): Promise<ExecutionResponseDto> {
    throw new BadRequestException(
      `Rollback manual legado desabilitado para execution ${executionId}. Use rollbackOnFailure no runtime isolado.`,
    );
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
