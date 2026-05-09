import { IOperacaoPedidoConstruct } from './IOperacaoPedidoConstruct';
import { IExecucaoData } from './IExecucaoData';

/**
 * Parâmetros para construção de OperacaoExecucaoClaude.
 * Estende IOperacaoPedidoConstruct com os campos específicos de execução.
 *
 * @see docs/plano/02-DOMINIO-ENGINE.md §6.7
 */
export interface IOperacaoExecucaoClaudeConstruct extends IOperacaoPedidoConstruct {
  /** ID do projeto (bigint stringificado) */
  projectId: string;
  /** ID do agente remoto DEntidade idClasse=-310 (bigint stringificado) */
  agentId: string;
  /** ID da task associada (opcional, bigint stringificado) */
  taskId?: string;
  /** Comando a executar (estrutura completa) */
  command: IExecucaoData['command'];
  /** Correlation ID para rastreamento distributed (X-Correlation-Id) */
  correlationId: string;
  /**
   * Serviço de túnel SSH/WebSocket para o agente remoto.
   * STUB em F6 — implementação real em F13.
   * Em testes: mock que retorna { exitCode: 0, stdout: '', stderr: '' }.
   */
  agentTunnelService: any;
  /**
   * EventProducerService para emitir DEvento após persistência.
   * STUB em F6 — implementação real em F7.
   * Em testes: mock que absorve silenciosamente.
   */
  eventProducer: any;
  /**
   * Cliente GitHub (Octokit) para PR auto-open.
   * Opcional — projetos sem GitHub pulam PR open.
   * Tipagem real: Octokit. Mantido como `any` até F12.
   */
  githubClient?: any;
}
