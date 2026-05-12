import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { RemoteAgentRuntime } from './remote-execution-client';

/**
 * @deprecated F13/V2: a partir de ADR-V2-030/-032/-033 o agente V2 NAO mais
 * recebe comandos shell genericos - apenas `RUN_CLAUDE_CODE`. Worktree
 * isolation passa a ser responsabilidade do Claude Code (que rodara `git
 * worktree add` ou afins de dentro do projeto, conforme o caso) ou
 * desnecessaria (operacao direto no projeto principal).
 *
 * Este service permanece como stub para nao quebrar o grafo do
 * `ExecutionRunProcessor` enquanto Sub-tarefa 2.4 (endpoint
 * execution-result inbound) nao reescreve o fluxo end-to-end. Sera
 * removido quando o fluxo V2 estiver completo (F13 final).
 */
export interface ProjectAutomationRuntimeConfig {
  remotePath?: string;
  remoteBranch?: string;
}

export interface ExecutionWorktreeInput {
  executionId: string;
  projectId: string;
  correlationId: string;
  agent: RemoteAgentRuntime;
  projectAutomation: ProjectAutomationRuntimeConfig;
  command?: {
    executable?: string;
    args?: string[];
  };
}

export interface ExecutionWorktree {
  branch: string;
  baseBranch: string;
  rootPath: string;
  workspace: string;
  isolated: boolean;
}

/**
 * @deprecated Ver bloco JSDoc do arquivo. Service nao executa mais comandos
 * remotos - apenas valida config do projeto e devolve metadados de worktree
 * "logica" (sem isolamento real, sem `git worktree add` outbound).
 */
@Injectable()
export class ExecutionWorktreeService {
  private readonly logger = new Logger(ExecutionWorktreeService.name);

  /**
   * @deprecated No protocolo V2 nao ha mais isolamento de worktree gerenciado
   * pelo backend. Esta funcao apenas valida `remotePath` e retorna metadados
   * "logicos" para preservar a interface dos consumidores. O agente V2/Claude
   * Code decide internamente o que fazer no filesystem.
   */
  async prepare(input: ExecutionWorktreeInput): Promise<ExecutionWorktree> {
    const rootPath = this.requireRemotePath(input.projectAutomation.remotePath);
    const branch = `scrumban/exec-${input.executionId}`;
    const baseBranch = input.projectAutomation.remoteBranch ?? 'main';

    this.logger.debug(
      `worktree_prepare_noop executionId=${input.executionId} projectId=${input.projectId} (V2: agent/Claude Code handles worktree)`,
    );

    return {
      branch,
      baseBranch,
      rootPath,
      workspace: rootPath,
      isolated: false,
    };
  }

  /**
   * @deprecated Mantido como interface para callers existentes. No V2 nao
   * faz diferenca pratica (sempre retorna `false` - worktree isolation eh
   * decisao do agente).
   */
  requiresIsolatedWorktree(): boolean {
    return false;
  }

  private requireRemotePath(remotePath: string | undefined): string {
    if (!remotePath || !remotePath.startsWith('/')) {
      throw new UnprocessableEntityException(
        'Projeto sem dados.automation.remotePath absoluto para runtime remoto.',
      );
    }
    if (remotePath.includes('..') || /[\r\n`$;&|<>]/.test(remotePath)) {
      throw new UnprocessableEntityException(
        'dados.automation.remotePath invalido para runtime remoto.',
      );
    }
    return remotePath.replace(/\/+$/, '');
  }
}
