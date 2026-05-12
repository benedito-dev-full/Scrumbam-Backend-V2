import { Injectable, Logger } from '@nestjs/common';
import { ExecutionLogContext, ExecutionRuntimeLogService } from './execution-runtime-log.service';
import { RemoteAgentRuntime } from './remote-execution-client';
import { ExecutionWorktree } from './execution-worktree.service';

/**
 * @deprecated F13/V2: rollback de worktree no servidor remoto deixou de
 * ser responsabilidade do backend a partir de ADR-V2-030/-032/-033. O
 * agente V2 nao mais aceita comandos shell genericos - apenas
 * `RUN_CLAUDE_CODE`. Caso seja necessario reverter alteracoes do Claude
 * Code, isso sera modelado como nova execucao Claude Code instruida a
 * desfazer mudancas, ou via fluxo de PR no GitHub (revert/close).
 *
 * Stub mantido para preservar a interface do `ExecutionRunProcessor`
 * enquanto Sub-tarefa 2.4 nao reescreve o fluxo end-to-end com o callback
 * `POST /agents/:id/execution-result`.
 */
export interface RollbackInput {
  executionId: string;
  projectId: string;
  correlationId: string;
  agent: RemoteAgentRuntime;
  worktree: ExecutionWorktree;
}

/**
 * @deprecated Ver bloco JSDoc do arquivo. Service nao executa mais
 * comandos remotos no V2 - apenas registra evento de "rollback solicitado"
 * no log estruturado e retorna.
 */
@Injectable()
export class RollbackService {
  private readonly logger = new Logger(RollbackService.name);

  constructor(private readonly logService: ExecutionRuntimeLogService) {}

  async rollbackWorktree(input: RollbackInput, _logContext: ExecutionLogContext): Promise<void> {
    this.logger.warn(
      `rollback_noop executionId=${input.executionId} branch=${input.worktree.branch} (V2: backend nao mais executa rollback remoto)`,
    );

    try {
      await this.logService.recordSystem({
        executionId: input.executionId,
        projectId: input.projectId,
        agentId: input.agent.agentId,
        correlationId: input.correlationId,
        line: `rollback noop (V2): manual revert or new Claude Code execution required`,
        code: 'ROLLBACK_NOT_IMPLEMENTED_V2',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`rollback_log_failed error=${message}`);
    }
  }
}
