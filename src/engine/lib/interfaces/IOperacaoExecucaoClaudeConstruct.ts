import { IOperacaoPedidoConstruct } from './IOperacaoPedidoConstruct';
import { IExecucaoData } from './IExecucaoData';
// type-only import: garante que `src/engine/` NÃO depende em runtime de `src/eventos/`
import type { IEventProducer } from '../../../eventos/interfaces/event-producer.interface';

/**
 * Parâmetros para construção de OperacaoExecucaoClaude.
 * Estende IOperacaoPedidoConstruct com os campos específicos de execução.
 *
 * @see docs/plano/02-DOMINIO-ENGINE.md §6.7
 * @see ADR-V2-005 (Engine isolado de outros módulos — apenas tipo via interface)
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
  /**
   * Prompt natural pré-montado pelo `PromptBuilderService` (ADR-V2-049).
   *
   * Opcional. Quando presente, é populado em `dados.prompt` (fonte canônica V2
   * lida pelo `execution-run.processor.ts`). Quando ausente, o processor faz
   * fallback para `command.args[-p]` (modo legado).
   */
  prompt?: string;
  /**
   * Tipo da task (`code | docs | research | validation | other`) — ADR-V2-049.
   *
   * Opcional. Persistido em `dados.taskType` para audit/UI/relatórios. NÃO
   * influencia o Risk Gate (ADR-V2-048 — Risk vence TaskType no idClasse).
   */
  taskType?: string;
  /** Correlation ID para rastreamento distributed (X-Correlation-Id) */
  correlationId: string;
  /**
   * Serviço de túnel SSH/WebSocket para o agente remoto.
   * STUB em F6 — implementação real em F13.
   * Em testes: mock que retorna { exitCode: 0, stdout: '', stderr: '' }.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentTunnelService: any;
  /**
   * EventProducer para emitir DEvento após persistência (Padrão #7).
   *
   * Tipo `IEventProducer` (puro contrato, sem dependência de runtime
   * de `src/eventos/`). Em produção: `EventProducerService` real
   * injetado via DI no `ExecutionsService`. Em testes: mock que absorve
   * silenciosamente (`{ addInternalEvent: jest.fn() }`).
   *
   * F7 Bloco Q: substituiu o STUB `any` por contrato tipado (decisão CEO #5).
   */
  eventProducer: IEventProducer;
  /**
   * Cliente GitHub (Octokit) para PR auto-open.
   * Opcional — projetos sem GitHub pulam PR open.
   * Tipagem real: Octokit. Mantido como `any` até F12.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  githubClient?: any;
}
