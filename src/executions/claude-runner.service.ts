import { Injectable, Logger } from '@nestjs/common';

/**
 * Resultado da execução Claude Code via agente remoto.
 */
export interface ClaudeRunResult {
  exitCode: number;
  headBefore?: string;
  headAfter?: string;
  branch?: string;
  commitMessage?: string;
  pushedAt?: string;
  filesChanged?: number;
  sessionId?: string;
  sessionPath?: string;
  stdout?: string;
  stderr?: string;
}

/**
 * Parâmetros para execução do Claude Code.
 */
export interface ClaudeRunParams {
  agentId: bigint;
  projectId: bigint;
  executionId: bigint;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  correlationId: string;
}

/**
 * ClaudeRunnerService — STUB para F6.
 *
 * Em F6, este service retorna resultados simulados para permitir testar
 * o fluxo completo de Execution sem o agente VPS real.
 *
 * F13 implementará o SSH reverso real + WebSocket tunnel.
 *
 * Modo STUB_CLAUDE_FAIL=true (env): retorna exitCode=1 para testes de falha.
 *
 * @see docs/plano/02-DOMINIO-ENGINE.md §6.7
 * @see F13 — implementação real do SSH reverso
 */
@Injectable()
export class ClaudeRunnerService {
  private readonly logger = new Logger(ClaudeRunnerService.name);
  private readonly stubFail: boolean;

  constructor() {
    this.stubFail = process.env['STUB_CLAUDE_FAIL'] === 'true';
  }

  /**
   * Executa Claude Code no agente remoto.
   *
   * STUB F6: retorna mock result. F13 implementa SSH reverso real.
   *
   * @param params - Parâmetros da execução
   * @returns Promise com resultado simulado (ou falha se STUB_CLAUDE_FAIL=true)
   */
  async runClaudeCode(params: ClaudeRunParams): Promise<ClaudeRunResult> {
    this.logger.log(
      `[${params.correlationId}] STUB: simulando execução Claude Code (executionId=${params.executionId})`,
    );

    if (this.stubFail) {
      this.logger.warn(
        `[${params.correlationId}] STUB_CLAUDE_FAIL=true — retornando exitCode=1`,
      );
      return {
        exitCode: 1,
        stdout: '',
        stderr: '[STUB] Claude Code execution failed (STUB_CLAUDE_FAIL=true)',
        sessionId: `stub-fail-${params.executionId}`,
        sessionPath: `/tmp/claude-fail-${params.executionId}`,
      };
    }

    // Stub de sucesso: simula execution com mudanças no repo
    const stubHeadBefore = 'abc1234567890';
    const stubHeadAfter = `def${params.executionId.toString().padStart(10, '0')}`;

    return {
      exitCode: 0,
      headBefore: stubHeadBefore,
      headAfter: stubHeadAfter,
      branch: `scrumban/auto-${params.executionId}`,
      commitMessage: `feat: claude code execution ${params.executionId} [stub]`,
      pushedAt: new Date().toISOString(),
      filesChanged: 0,
      sessionId: `stub-sess-${params.executionId}`,
      sessionPath: `/tmp/claude-${params.executionId}`,
      stdout: `[STUB] Claude Code execution simulated (executionId=${params.executionId})`,
      stderr: '',
    };
  }
}
