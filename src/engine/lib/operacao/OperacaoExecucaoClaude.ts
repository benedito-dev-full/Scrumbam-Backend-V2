import { Decimal } from '@prisma/client/runtime/library';
import OperacaoPedido from './OperacaoPedido';
import { IExecucaoData } from '../interfaces/IExecucaoData';
import { IOperacaoExecucaoClaudeConstruct } from '../interfaces/IOperacaoExecucaoClaudeConstruct';
// type-only: Engine não depende em runtime de src/eventos/
import type { IEventProducer } from '../../../eventos/interfaces/event-producer.interface';

/**
 * OperacaoExecucaoClaude — Engine V2 que orquestra execução de Claude Code
 * via agente remoto VPS, com Risk Gate, Approval Flow e PR auto-open.
 *
 * Estende OperacaoPedido para herdar o workflow polimórfico completo (nova/calcula/aprova/grava)
 * e a infraestrutura de scripts DVFS (Dimensão 3 do modelo polimórfico Devari Core).
 *
 * Fluxo end-to-end:
 *   1. service.execute(dto) → new OperacaoExecucaoClaude(...)
 *   2. await op.nova()              — gera sequence key + carrega DVFS chaves 3,4,5,6,7
 *   3. op.pedidoCab.setValor(0)     — execution não tem valor financeiro
 *   4. op.pedidoCab.setPessoa(triggeredBy)
 *   5. op.setExecucaoData({ command, ... })
 *   6. await op.calcula()
 *      → DVFS chave 3 (risk-gate-validator) classifica LOW/MED/HIGH em op.dados.risk
 *      → DVFS chave 4 (command-validator) valida path traversal e limites
 *      → define op._classeBase = '-301' | '-302' | '-303' conforme risk.level
 *   7. Decisão de approval (no Service, fora do Engine):
 *      LOW  → await op.aprova({ aprovador: 'auto:risk-gate-low' })
 *      MED  → await op.aprova({ aprovador: 'auto:risk-gate-medium' })
 *      HIGH → await op.gravarComoAwaitingApproval() — aguarda POST /executions/:id/approve
 *   8. await op.grava()
 *      → popula pedidoCab com dados serializados
 *      → DVFS chave 6 (pré-gravação): última validação
 *      → INSERT DPedido idClasse=-301|-302|-303 em transaction atômica
 *      → DVFS chave 7 (pós-gravação): pr-auto-open + notification-dispatcher
 *      → Emite evento via eventProducer (APÓS persistência — Padrão #7)
 *      → Se status='approved': dispara Claude Runner via agentTunnelService (STUB em F6)
 *
 * REGRAS INVIOLÁVEIS:
 *   - Engine APENAS para DPedido idClasse=-300..-303 (Pilar 1, ADR-V2-005)
 *   - NUNCA instanciar para DTask, DProject, DEntidade, DTabela, DVincula
 *   - agentTunnelService é STUB em F6 — implementação real em F13
 *   - Eventos APÓS persistência (Padrão #7 devari-backend-patterns)
 *
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see ADR-V2-006 (risk via idClasse -301/-302/-303, não campo)
 * @see ADR-V2-016 (scripts DVFS via s.chaveScript, nunca s.id)
 * @see docs/plano/02-DOMINIO-ENGINE.md §6.7
 */
export default class OperacaoExecucaoClaude extends OperacaoPedido {
  /** Dados polimórficos da execução — serializados em DPedido.dados Json */
  public dados: IExecucaoData;

  protected readonly projectId: bigint;
  protected readonly agentId: bigint;
  protected readonly taskId?: bigint;
  protected readonly correlationId: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected readonly agentTunnelService: any;
  /**
   * Producer canônico (puro contrato `IEventProducer`).
   * F7 Bloco Q: tipado (antes era `any` STUB).
   */
  protected readonly eventProducer: IEventProducer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected readonly githubClient?: any;

  constructor(params: IOperacaoExecucaoClaudeConstruct) {
    // 1. Chama super (OperacaoPedido) — inicializa pedidoCab, _itensPedido,
    //    _dvfsLoader e _classeBase a partir de params.classe
    super(params);

    // 2. Armazena referências específicas de Execution
    this.projectId = BigInt(params.projectId);
    this.agentId = BigInt(params.agentId);
    this.taskId = params.taskId ? BigInt(params.taskId) : undefined;
    this.correlationId = params.correlationId;
    this.agentTunnelService = params.agentTunnelService;
    this.eventProducer = params.eventProducer;
    this.githubClient = params.githubClient;

    // 3. Inicializa dados com defaults (command obrigatório + audit trail)
    this.dados = {
      command: params.command,
      audit: {
        correlationId: params.correlationId,
        triggeredBy: params.usuario,
        agentId: params.agentId,
        projectId: params.projectId,
      },
      task: params.taskId ? { id: params.taskId } : undefined,
    };
  }

  /**
   * Inicializa a operação: gera sequence key + carrega scripts DVFS.
   * Reutiliza super.nova() que carrega DVFS chaves 3-7 via _carregaScriptsCalc/Grav.
   *
   * @param chaveCustom Chave personalizada (usar apenas em testes)
   */
  async nova(chaveCustom?: bigint): Promise<void> {
    await super.nova(chaveCustom);
    this.logger.log(`[${this.correlationId}] Execution iniciada chave=${this.chcriacao}`);
  }

  /**
   * Helper público para popular dados da execução antes de calcula/aprova/grava.
   * Permite atualização parcial dos dados sem sobrescrever campos já populados.
   *
   * @param data Dados parciais a mesclar em this.dados
   */
  setExecucaoData(data: Partial<IExecucaoData>): void {
    this.dados = { ...this.dados, ...data };
  }

  /**
   * Executa Risk Gate + Command Validator via scripts DVFS.
   *
   * Sobrescreve calcula() de OperacaoPedido para:
   *   1. Validar que DVFS chaves 3 e 4 foram carregadas (obrigatórias para execution)
   *   2. Chamar super.calcula() que executa os scripts DVFS (3, 4, 5)
   *   3. Validar que op.dados.risk foi populado pelo script chave 3
   *   4. Determinar _classeBase conforme risk.level (ADR-V2-006)
   *
   * Os scripts DVFS recebem `this` como contexto — acesso a dados, _database, etc.
   *
   * @throws Error se DVFS chaves 3 ou 4 não foram carregadas
   * @throws Error se Risk Gate não classificou a execução
   */
  async calcula(): Promise<void> {
    // Chaves 3 e 4 são OBRIGATÓRIAS para execution — sem elas, sistema está misconfigured
    if (!this._funcPreCalculo) {
      this.erro({
        mensagem: 'DVFS chave 3 (risk-gate-validator) não carregado. Verifique seed da DVFS.',
      });
    }
    if (!this._funcCalculo) {
      this.erro({
        mensagem: 'DVFS chave 4 (command-validator) não carregado. Verifique seed da DVFS.',
      });
    }

    this.logger.log(`[${this.correlationId}] Calculando: risk-gate + command-validator`);

    // super.calcula() executa _funcPreCalculo(this), _funcCalculo(this), _funcPosCalculo(this)
    // Scripts manipulam this.dados.risk e validam this.dados.command
    await super.calcula();

    // Validar que Risk Gate classificou a execução (dados.risk populado pelo script chave 3)
    if (!this.dados.risk) {
      this.erro({
        mensagem: 'Risk Gate não classificou execução. Script DVFS chave 3 com bug?',
      });
    }

    // ADR-V2-006: idClasse final baseado em risk.level (LOW=-301, MED=-302, HIGH=-303)
    const classeMap: Record<string, number> = {
      LOW: -301,
      MEDIUM: -302,
      HIGH: -303,
    };
    const classeNum = classeMap[this.dados.risk!.level];
    if (!classeNum) {
      this.erro({
        mensagem: `Risk level inválido: ${this.dados.risk!.level}. Esperado: LOW, MEDIUM, HIGH.`,
      });
    }
    this._classeBase = classeNum.toString();

    this.logger.log(
      `[${this.correlationId}] Risk Gate: ${this.dados.risk!.level}, idClasse=${this._classeBase}`,
    );
  }

  /**
   * Aprova a execução e registra o aprovador em dados.approval.
   * Suporta tanto aprovação humana (ADMINs para HIGH) quanto auto-aprovação
   * (service usa 'auto:risk-gate-low' ou 'auto:risk-gate-medium' como aprovador).
   *
   * @param params.aprovador ID do aprovador ou identificador de auto-aprovação
   */
  async aprova(params: { aprovador: string }): Promise<void> {
    await super.aprova(params);
    this.dados.approval = {
      ...this.dados.approval,
      status: 'approved',
      approvedBy: params.aprovador,
      decidedAt: new Date().toISOString(),
    };
    this.logger.log(`[${this.correlationId}] Approved by ${params.aprovador}`);
  }

  /**
   * Restaura estado do Engine a partir de DPedido já persistido e executa
   * o workflow de aprovação manual: aprova → DVFS 6,7 → UPDATE → _executarClaude.
   *
   * Usado por ApprovalFlowService.approve() para execuções HIGH que estavam em
   * awaiting_approval. NÃO chama nova() — a chave já existe no banco.
   * NÃO faz INSERT — chama UPDATE via _atualizarPedidoCompleto().
   *
   * Fluxo:
   *   1. Restaura this.chcriacao e this.dados dos dados persistidos
   *   2. Marca _operacaoCalculada=true (já foi calculado antes)
   *   3. Chama aprova() para marcar approval.status='approved'
   *   4. Recarrega scripts DVFS de gravação (se ainda não carregados)
   *   5. Executa _funcPreGravacao (DVFS chave 6) se carregada
   *   6. UPDATE DPedido.dados via _atualizarPedidoCompleto() (não INSERT)
   *   7. Executa _funcPosGravacao (DVFS chave 7) APÓS UPDATE (pr-auto-open etc.)
   *   8. Dispara Claude Runner via _executarClaude()
   *
   * @param params.aprovador - ID ou identificador do aprovador
   * @param params.dadosExistentes - Registro DPedido já persistido no banco
   */
  async gravarAposAprovacaoManual(params: {
    aprovador: string;
    dadosExistentes: {
      chave: bigint;
      dados: IExecucaoData;
      idClasse: bigint;
      aprovado?: boolean | null;
      baixado?: boolean | null;
    };
  }): Promise<void> {
    // 1. Restaura state sem chamar nova() (chave já existe no banco)
    this.chcriacao = params.dadosExistentes.chave;
    this.dados = { ...(params.dadosExistentes.dados as IExecucaoData) };
    this._classeBase = params.dadosExistentes.idClasse.toString();
    this._operacaoCalculada = true; // já foi calculado antes do gravarComoAwaitingApproval

    this.logger.log(
      `[${this.correlationId}] gravarAposAprovacaoManual: restaurando chave=${this.chcriacao}`,
    );

    // 2. Aprova — popula dados.approval.status='approved' + decidedAt
    await this.aprova({ aprovador: params.aprovador });

    // 3. Recarrega scripts DVFS de gravação se não carregados
    //    (necessário porque nova() não foi chamado)
    if (!this._funcPreGravacao && !this._funcPosGravacao) {
      await this['_carregaScriptsGrav']();
    }

    // 4. Executa pré-gravação (DVFS chave 6) se carregada
    if (this._funcPreGravacao) {
      await this._funcPreGravacao(this);
    }

    // 5. UPDATE DPedido — não INSERT (chave já existe)
    await this._database.dPedido.update({
      where: { chave: this.chcriacao },
      data: {
        aprovado: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dados: this.dados as any,
      },
    });

    this.logger.log(
      `[${this.correlationId}] DPedido atualizado (aprovação manual) chave=${this.chcriacao}`,
    );

    // 6. Executa pós-gravação (DVFS chave 7) APÓS UPDATE — pr-auto-open etc.
    if (this._funcPosGravacao) {
      await this._funcPosGravacao(this);
    }

    // 7. Dispara Claude Runner (STUB em F6)
    await this._executarClaude();
  }

  /**
   * Persiste DPedido com resultados da execução.
   *
   * Fluxo:
   *   1. Popula pedidoCab com valor=0 e dados serializados
   *   2. super.grava(): DVFS chave 6 (pré) → INSERT DPedido → DVFS chave 7 (pós)
   *   3. APÓS persistência: emite evento canônico (Padrão #7)
   *   4. Se status='approved': dispara Claude Runner via agentTunnelService
   *
   * REGRA: eventProducer.addInternalEvent SOMENTE APÓS super.grava() retornar (Padrão #7).
   */
  async grava(): Promise<void> {
    // Serializa dados para DPedido.dados Json
    this.pedidoCab.setValor(new Decimal(0)); // execution não tem valor monetário
    this.pedidoCab.setDados(this.dados); // serializa IExecucaoData para Json

    // 1. Persistência via super.grava() — executa DVFS 6 (pré) e 7 (pós)
    await super.grava();

    this.logger.log(
      `[${this.correlationId}] DPedido idClasse=${this._classeBase} persistido. chave=${this.chcriacao}`,
    );

    // 2. Emite evento canônico APÓS persistência (Padrão #7 — NUNCA antes do INSERT)
    if (this.eventProducer && this.dados.risk) {
      await this.eventProducer.addInternalEvent(
        `execution.${this.dados.risk.level.toLowerCase()}.created`,
        {
          executionId: this.chcriacao.toString(),
          projectId: this.projectId.toString(),
          riskLevel: this.dados.risk.level,
          triggeredBy: this.dados.audit?.triggeredBy,
          approval: this.dados.approval?.status,
        },
        this.correlationId,
      );
    }

    // 3. Se aprovado: dispara Claude Runner (STUB em F6 — implementação real em F13)
    if (this.dados.approval?.status === 'approved') {
      await this._executarClaude();
    }
  }

  /**
   * Grava execução em estado awaiting_approval (para risk HIGH).
   * Não chama aprova() — apenas persiste com approval.status='awaiting_approval'.
   * Endpoint POST /executions/:id/approve invocará aprova() + grava() quando ADMIN decidir.
   *
   * @param expiresInMs Tempo em ms até expiração (default: 1h = 3.600.000ms)
   */
  async gravarComoQueued(): Promise<void> {
    this.dados.approval = {
      status: 'queued',
    };
    this._baixado = null;
    await this._gravarParcialmente();
  }

  async gravarComoAwaitingApproval(expiresInMs = 3600000): Promise<void> {
    this.dados.approval = {
      status: 'awaiting_approval',
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    };
    this._baixado = null;
    await this._gravarParcialmente();
  }

  /**
   * Persiste DPedido parcialmente (sem workflow completo de aprovação).
   * Usado por gravarComoAwaitingApproval() para salvar estado inicial.
   */
  private async _gravarParcialmente(): Promise<void> {
    this.pedidoCab.setValor(new Decimal(0));
    this.pedidoCab.setDados(this.dados);
    await super.grava();
  }

  /**
   * Executa Claude Code via agente remoto após approval.
   * Atualiza dados.claude, dados.git, dados.pullRequest progressivamente.
   * Re-grava DPedido com resultados após execução.
   *
   * STUB em F6: agentTunnelService retorna mock. Implementação real em F13.
   */
  private async _executarClaude(): Promise<void> {
    this.dados.claude = {
      startedAt: new Date().toISOString(),
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await this.agentTunnelService.runClaudeCode({
        agentId: this.agentId,
        projectId: this.projectId,
        executionId: this.chcriacao,
        command: this.dados.command.text,
        cwd: this.dados.command.cwd,
        timeoutMs: this.dados.command.timeoutMs ?? 600000,
        correlationId: this.correlationId,
      });

      this.dados.claude = {
        ...this.dados.claude,
        sessionId: result.sessionId,
        sessionPath: result.sessionPath,
        stdout: this._truncate(result.stdout, 1024 * 1024),
        stderr: this._truncate(result.stderr, 1024 * 1024),
        exitCode: result.exitCode,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(this.dados.claude.startedAt!).getTime(),
      };

      // Se sucesso (exit=0) e houve mudança no repo: popula git + aciona PR
      if (result.exitCode === 0 && result.headAfter && result.headAfter !== result.headBefore) {
        this.dados.git = {
          headBefore: result.headBefore,
          headAfter: result.headAfter,
          branch: `scrumban/auto-${this.chcriacao}`,
          commitMessage: result.commitMessage,
          pushedAt: result.pushedAt,
          filesChanged: result.filesChanged,
        };

        // Dispara DVFS chave 7 manualmente com contexto git atualizado para PR open
        if (this._funcPosGravacao) {
          await this._funcPosGravacao(this);
        }
      }

      // Atualiza DPedido.dados com resultados completos
      await this._atualizarPedidoCompleto();

      // Emite evento final APÓS persistência
      if (this.eventProducer) {
        await this.eventProducer.addInternalEvent(
          result.exitCode === 0 ? 'execution.succeeded' : 'execution.failed',
          {
            executionId: this.chcriacao.toString(),
            exitCode: result.exitCode,
            prUrl: this.dados.pullRequest?.url,
          },
          this.correlationId,
        );
      }
    } catch (err) {
      const error = err as Error;

      this.dados.claude = {
        ...this.dados.claude,
        finishedAt: new Date().toISOString(),
        exitCode: -1,
        stderr: error.message,
      };

      await this._atualizarPedidoCompleto();

      if (this.eventProducer) {
        await this.eventProducer.addInternalEvent(
          'execution.failed',
          {
            executionId: this.chcriacao.toString(),
            error: error.message,
          },
          this.correlationId,
        );
      }

      this.erro({ mensagem: `Execução Claude falhou: ${error.message}` });
    }
  }

  /**
   * Trunca string para no máximo maxBytes bytes UTF-8.
   * Previne que stdout/stderr grandes excedam o campo Json do DPedido.
   *
   * @param str String a truncar (pode ser undefined)
   * @param maxBytes Limite em bytes (default: 1MB = 1024*1024)
   * @returns String truncada com sufixo '[TRUNCATED]', ou undefined se entrada undefined
   */
  private _truncate(str: string | undefined, maxBytes: number): string | undefined {
    if (!str) return str;
    if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
    return Buffer.from(str, 'utf8').subarray(0, maxBytes).toString('utf8') + '\n... [TRUNCATED]';
  }

  /**
   * Atualiza DPedido.dados com o estado completo atual via UPDATE.
   * Chamado após _executarClaude() para persistir stdout/stderr/git/pullRequest.
   */
  private async _atualizarPedidoCompleto(): Promise<void> {
    await this._database.dPedido.update({
      where: { chave: this.chcriacao },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { dados: this.dados as any },
    });
  }

  /**
   * Restaura estado do Engine a partir de DPedido já persistido e registra
   * outcome reportado pelo agente V2 via callback execution-result (ADR-V2-033).
   *
   * Diferente de gravarAposAprovacaoManual():
   *   - NÃO chama aprova() (execução já foi aprovada antes de rodar)
   *   - NÃO chama scripts DVFS de aprovação
   *   - Apenas atualiza dados.claude com outcome (sessionId, exitCode, stdout, stderr)
   *     e dados.audit com claudeSessionPath (INTERNAL — não exposto ao frontend)
   *   - Executa DVFS chave 7 (pós-gravação) APÓS UPDATE — pr-auto-open se aplicável
   *
   * IDEMPOTÊNCIA: chamador (AgentsService) DEVE checar `dados.claude?.finishedAt`
   * antes de instanciar o Engine — se já presente, retornar `alreadyPersisted=true`
   * sem invocar este método.
   *
   * PILAR 1 PRESERVADO: única tabela transacional tocada é DPedido (idClasse -301/-302/-303),
   * via UPDATE encapsulado no Engine. Handler `recordExecutionResult` NÃO chama prisma.dPedido.update
   * direto.
   *
   * @param params Outcome reportado pelo agente V2 via POST /agents/:id/execution-result
   * @param params.dadosExistentes DPedido carregado do banco (chave, dados, idClasse)
   * @param params.claudeSessionId UUID Claude Code (null se extração falhou)
   * @param params.claudeSessionPath Caminho absoluto do .jsonl no agente (INTERNAL — vaza filesystem)
   * @param params.resumedFrom UUID da sessão anterior (null = nova; preenchido = resumed via --resume)
   * @param params.exitCode Exit code do CLI Claude Code (0 = sucesso)
   * @param params.success Flag derivado (exitCode === 0 e sem erros operacionais)
   * @param params.durationMs Duração total em ms
   * @param params.stdoutTruncated Stdout (max 64KB no payload)
   * @param params.stderrTruncated Stderr (max 64KB no payload)
   * @param params.errorCode Categoria de erro se !success
   */
  async registrarOutcome(params: {
    dadosExistentes: {
      chave: bigint;
      dados: IExecucaoData;
      idClasse: bigint;
    };
    claudeSessionId: string | null;
    claudeSessionPath: string | null;
    resumedFrom: string | null;
    exitCode: number;
    success: boolean;
    durationMs: number;
    stdoutTruncated: string;
    stderrTruncated: string;
    errorCode?: string;
  }): Promise<void> {
    // 1. Restaura state sem chamar nova() (chave já existe no banco)
    this.chcriacao = params.dadosExistentes.chave;
    this.dados = { ...(params.dadosExistentes.dados as IExecucaoData) };
    this._classeBase = params.dadosExistentes.idClasse.toString();
    this._operacaoCalculada = true;
    this._aprovado = true;

    const nowIso = new Date().toISOString();
    const previousClaude = this.dados.claude ?? {};
    const startedAt = previousClaude.startedAt ?? nowIso;

    // 2. Atualiza dados.claude com outcome reportado pelo agente
    this.dados.claude = {
      ...previousClaude,
      sessionId: params.claudeSessionId ?? previousClaude.sessionId,
      // sessionPath: caminho absoluto do .jsonl — INTERNAL, persistido para audit
      // mas NÃO exposto em ExecutionResponseDto (Risco #7 do plan).
      sessionPath: params.claudeSessionPath ?? previousClaude.sessionPath,
      stdout: params.stdoutTruncated,
      stderr: params.stderrTruncated,
      exitCode: params.exitCode,
      startedAt,
      finishedAt: nowIso,
      durationMs: params.durationMs,
    };

    // 3. Marca outcome no audit trail (idempotency sentinel + errorCode + resumedFrom)
    // IExecucaoData.audit não modela esses campos opcionais; usa Record<string, unknown>
    // intermediário e re-cast no final para manter type safety sem `any`.
    const previousAudit = (this.dados.audit ?? {}) as Record<string, unknown>;
    const nextAudit: Record<string, unknown> = {
      ...previousAudit,
      outcome: { success: params.success, recordedAt: nowIso },
    };
    if (params.resumedFrom !== null && params.resumedFrom !== undefined) {
      nextAudit.resumedFrom = params.resumedFrom;
    }
    if (params.errorCode) {
      nextAudit.errorCode = params.errorCode;
    }
    this.dados.audit = nextAudit as unknown as IExecucaoData['audit'];

    // 4. Marca status final em dados.claude já preenchido + sinalizador top-level
    this.dados.statusCode = params.success
      ? '-519' // EXEC_STATUS_SUCCESS
      : '-520'; // EXEC_STATUS_FAILED

    this.logger.log(
      `[${this.correlationId}] Registrando outcome: chave=${this.chcriacao} success=${params.success} exitCode=${params.exitCode}`,
    );

    // 5. UPDATE DPedido via método centralizado (Engine encapsula Prisma)
    await this._atualizarPedidoCompleto();

    // 6. Executa DVFS chave 7 (pós-gravação) se carregada — pr-auto-open etc.
    //    Carrega scripts se ainda não foram (callback pode chegar em processo distinto)
    if (!this._funcPosGravacao) {
      await this['_carregaScriptsGrav']();
    }
    if (this._funcPosGravacao) {
      try {
        await this._funcPosGravacao(this);
      } catch (e) {
        // Pós-gravação não deve derrubar o callback; loga e continua.
        const err = e as Error;
        this.logger.warn(
          `[${this.correlationId}] DVFS chave 7 pós-gravação falhou (não-fatal): ${err.message}`,
        );
      }
    }

    this.logger.log(`[${this.correlationId}] Outcome persistido chave=${this.chcriacao}`);
  }
}
