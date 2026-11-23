import { Decimal } from '@prisma/client/runtime/library';
import OperacaoPedido from './OperacaoPedido';
import { Prisma } from '@prisma/client';
import { IExecucaoData, IExecucaoOutcome } from '../interfaces/IExecucaoData';
import { PrismaService } from '../../../prisma.service';
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
    //    ADR-V2-049: prompt e taskType são opcionais; quando presentes (modo
    //    PROMPT do ExecutionsService), populam o caminho canônico V2 lido
    //    por `execution-run.processor.ts:resolvePrompt`.
    this.dados = {
      command: params.command,
      ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
      ...(params.taskType !== undefined ? { taskType: params.taskType } : {}),
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
   *   4. Modo PROMPT (ADR-V2-081): guarda de contrato (script sem varredura de
   *      prompt → mínimo MEDIUM) + piso de emergência RISK_GATE_PROMPT_FLOOR
   *   5. Determinar _classeBase conforme risk.level (ADR-V2-006)
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

    // ADR-V2-081: guarda de contrato + piso de emergência do modo PROMPT.
    // Só eleva — nunca rebaixa a classificação do script.
    this._aplicarGuardasModoPrompt();

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
   * Guardas do modo PROMPT aplicadas após o Risk Gate (ADR-V2-081).
   *
   * Atua SOMENTE quando há `dados.prompt` (modo PROMPT — ADR-V2-049); no modo
   * COMMAND/HÍBRIDO não interfere. Nunca rebaixa o nível do script.
   *
   *   1. Guarda de contrato: se o script DVFS chave 3 não declarou `'prompt'`
   *      em `risk.scannedSources` (ex.: banco ainda com o validador v1 — seed
   *      DVFS não reaplicado), eleva para no mínimo MEDIUM. Transforma o drift
   *      "cego silencioso" em "aprovação extra visível". O Engine NÃO decide
   *      padrões (regra de risco continua na DVFS — ADR-V2-007), só garante
   *      a integridade do contrato.
   *   2. Piso de emergência `RISK_GATE_PROMPT_FLOOR` (env, default desligado):
   *      `MEDIUM` ou `HIGH` força todo modo PROMPT a exigir aprovação humana.
   *      Valores ausentes/inválidos = desligado.
   */
  private _aplicarGuardasModoPrompt(): void {
    const risk = this.dados.risk;
    if (!risk || typeof this.dados.prompt !== 'string') return;

    const scanned = Array.isArray(risk.scannedSources) ? risk.scannedSources : [];
    if (!scanned.includes('prompt')) {
      this.logger.warn(
        `[${this.correlationId}] Risk Gate desatualizado: DVFS chave 3 não varre dados.prompt ` +
          `(validatorVersion=${risk.validatorVersion ?? 'ausente'}). Elevando para no mínimo MEDIUM. ` +
          'Reaplicar seed DVFS (ADR-V2-081).',
      );
      this._elevarRisco(
        'MEDIUM',
        'Risk Gate desatualizado (DVFS sem varredura de prompt) — aprovação humana exigida.',
        'engine:risk-gate-stale',
      );
    }

    const floor = OperacaoExecucaoClaude._lerPisoModoPrompt();
    if (floor) {
      this._elevarRisco(
        floor,
        `Piso de emergência RISK_GATE_PROMPT_FLOOR=${floor} ativo para o modo PROMPT.`,
        'engine:risk-gate-prompt-floor',
      );
    }
  }

  /**
   * Lê `RISK_GATE_PROMPT_FLOOR` do ambiente. Aceita apenas `MEDIUM`/`HIGH`
   * (case-insensitive); qualquer outro valor (inclusive `LOW`/vazio) = desligado.
   */
  private static _lerPisoModoPrompt(): 'MEDIUM' | 'HIGH' | null {
    const raw = (process.env.RISK_GATE_PROMPT_FLOOR ?? '').trim().toUpperCase();
    return raw === 'MEDIUM' || raw === 'HIGH' ? raw : null;
  }

  /**
   * Eleva `dados.risk.level` para `minimo` se o nível atual for menor.
   * Registra o motivo em `explanation` e um `matchedPatterns` com `source='engine'`
   * (sem trecho de texto do prompt). Nunca rebaixa.
   */
  private _elevarRisco(minimo: 'MEDIUM' | 'HIGH', motivo: string, pattern: string): void {
    const risk = this.dados.risk!;
    const rank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    if ((rank[risk.level] ?? 0) >= rank[minimo]) return;

    this.dados.risk = {
      ...risk,
      level: minimo,
      explanation:
        risk.level === 'LOW'
          ? motivo
          : `${motivo} (classificação original ${risk.level}: ${risk.explanation})`,
      matchedPatterns: [
        ...(Array.isArray(risk.matchedPatterns) ? risk.matchedPatterns : []),
        { pattern, level: minimo, source: 'engine' },
      ],
    };
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
   *   - NÃO chama aprova() nem calcula() (execução já foi aprovada/classificada;
   *     `dados.risk` não é tocado — guardas da ADR-V2-081 não re-executam)
   *   - Atualiza dados.claude com outcome (sessionId, exitCode, stdout, stderr)
   *     e dados.audit com claudeSessionPath (INTERNAL — não exposto ao frontend)
   *   - Executa DVFS chave 7 (pós-gravação) APÓS UPDATE — SOMENTE se a CAS aplicou
   *
   * CAS + BAIXA (ADR-V2-082): o UPDATE é condicional — só grava se a execução
   * ainda NÃO tem `audit.outcome` OU se o outcome existente é sintético
   * (`source='system'`: sweeper, falha de dispatch, backfill). Política
   * "verdade tardia prevalece sobre o desfecho sintético, uma única vez"
   * (decisão CEO P1): ao substituir, grava `audit.outcome.supersedes`; como o
   * novo outcome é `source='agent'`, qualquer callback seguinte encontra 0
   * linhas. O mesmo UPDATE grava `baixado=true` (lock de `activeExecution`
   * liberado).
   *
   * PILAR 1 PRESERVADO: única tabela transacional tocada é DPedido (idClasse -301/-302/-303),
   * via UPDATE encapsulado no Engine. Handler `recordExecutionResult` NÃO chama prisma direto.
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
   * @returns `applied=false` quando outro callback já gravou (idempotência por CAS);
   *   `superseded` preenchido quando substituiu um desfecho sintético;
   *   `persistedAt` = recordedAt do outcome gravado (ou do existente, se !applied)
   *
   * @example
   * ```typescript
   * const r = await op.registrarOutcome({ dadosExistentes, exitCode: 0, success: true, ... });
   * if (!r.applied) return { accepted: true, alreadyPersisted: true, persistedAt: r.persistedAt };
   * ```
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
  }): Promise<RegistrarOutcomeResult> {
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

    // 2.1 runtime.finishedAt real (no supersede, substitui o do desfecho sintético — L2).
    this.dados.runtime = { ...(this.dados.runtime ?? {}), finishedAt: nowIso };

    // 3. Sentinela de desfecho (source='agent') + errorCode + resumedFrom.
    //    `supersedes` é calculado DENTRO do UPDATE (estado real no momento da CAS).
    const previousAudit = this.dados.audit;
    const nextAudit: NonNullable<IExecucaoData['audit']> = {
      ...(previousAudit ?? {
        correlationId: this.correlationId,
        triggeredBy: '',
        agentId: this.agentId.toString(),
        projectId: this.projectId.toString(),
      }),
      outcome: { success: params.success, recordedAt: nowIso, source: 'agent' },
    };
    if (params.resumedFrom !== null && params.resumedFrom !== undefined) {
      nextAudit.resumedFrom = params.resumedFrom;
    }
    if (params.errorCode) {
      nextAudit.errorCode = params.errorCode;
    } else {
      // Remove errorCode de um desfecho sintético substituído (ex.: TIMEOUT_NO_CALLBACK).
      delete nextAudit.errorCode;
    }
    this.dados.audit = nextAudit;

    // 4. Status final
    this.dados.statusCode = params.success
      ? '-519' // EXEC_STATUS_SUCCESS
      : '-520'; // EXEC_STATUS_FAILED

    this.logger.log(
      `[${this.correlationId}] Registrando outcome: chave=${this.chcriacao} success=${params.success} exitCode=${params.exitCode}`,
    );

    // 5. UPDATE com CAS + baixado=true (Engine encapsula Prisma)
    const rows = await this._database.$queryRaw<
      Array<{ chave: bigint; supersedes: { reason?: string; recordedAt?: string } | null }>
    >(Prisma.sql`
      UPDATE "DPedido"
      SET dados = CASE
            WHEN dados->'audit'->'outcome'->>'source' = 'system' THEN
              jsonb_set(
                ${JSON.stringify(this.dados)}::jsonb,
                '{audit,outcome,supersedes}',
                jsonb_build_object(
                  'reason', dados->'audit'->'outcome'->'reason',
                  'recordedAt', dados->'audit'->'outcome'->'recordedAt'
                ),
                true
              )
            ELSE ${JSON.stringify(this.dados)}::jsonb
          END,
          baixado = true,
          "atualizadoEm" = NOW()
      WHERE chave = ${this.chcriacao}
        AND "idClasse" IN (${Prisma.join(EXECUTION_CLASS_IDS)})
        AND (
          dados->'audit'->'outcome' IS NULL
          OR dados->'audit'->'outcome'->>'source' = 'system'
        )
      RETURNING chave, dados->'audit'->'outcome'->'supersedes' AS supersedes
    `);

    if (rows.length === 0) {
      const existing = (params.dadosExistentes.dados?.audit?.outcome ?? null) as IExecucaoOutcome | null;
      this.logger.log(
        `[${this.correlationId}] Outcome NÃO aplicado (CAS: outro callback já gravou) chave=${this.chcriacao}`,
      );
      return { applied: false, persistedAt: existing?.recordedAt ?? nowIso };
    }

    const superseded = rows[0].supersedes ?? undefined;
    if (superseded) {
      this.dados.audit = {
        ...this.dados.audit!,
        outcome: { ...this.dados.audit!.outcome!, supersedes: superseded },
      };
      this.logger.warn(
        `[${this.correlationId}] Callback tardio substituiu desfecho sintético (${superseded.reason ?? '?'}) chave=${this.chcriacao}`,
      );
    }

    // 6. DVFS chave 7 (pós-gravação) SÓ quando a CAS aplicou — pr-auto-open etc.
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
    return { applied: true, persistedAt: nowIso, ...(superseded ? { superseded } : {}) };
  }

  /**
   * Encerra a execução como FAILED por decisão do SISTEMA (ADR-V2-082).
   *
   * Usado pelo processor (falha de dispatch, 409 esgotado, duplicata) — o
   * sweeper usa a versão em lote {@link OperacaoExecucaoClaude.encerrarVencidas}.
   * Grava, num único UPDATE com CAS (sem outcome prévio + status esperado):
   *   - `statusCode=-520`, `baixado=true`
   *   - `claude.exitCode=-1`, `claude.stderr=detail`, `claude.finishedAt` (o
   *     frontend só encerra o polling com `claude.finishedAt` — requisito explícito)
   *   - `runtime.finishedAt`
   *   - `audit.outcome={success:false, source:'system', reason, recordedAt}` +
   *     `audit.errorCode`
   *
   * Não chama calcula()/aprova() — `dados.risk` intocado. O JSON é montado no
   * próprio SQL (jsonb_set sobre o estado ATUAL da linha), então não sobrescreve
   * campos gravados concorrentemente.
   *
   * @param params.chave DPedido.chave da execução
   * @param params.reason Motivo (EXECUTION_FAILURE_REASONS) → `audit.outcome.reason`
   * @param params.detail Mensagem legível → `claude.stderr` (default = reason)
   * @param params.errorCode Código → `audit.errorCode` (default = reason)
   * @param params.expected `'RUNNING'` exige statusCode -518; `'ANY_NON_TERMINAL'`
   *   aceita -514/-515/-516/-518 (ou statusCode ausente, legado)
   * @returns true se esta chamada encerrou a execução (CAS aplicou)
   *
   * @example
   * ```typescript
   * const ok = await op.encerrarPorFalhaSistemica({
   *   chave: BigInt(123), reason: 'DISPATCH_FAILED', detail: 'ACK timeout', expected: 'ANY_NON_TERMINAL',
   * });
   * if (ok) await eventProducer.addInternalEvent('execution.failed', ...);
   * ```
   */
  async encerrarPorFalhaSistemica(params: {
    chave: bigint;
    reason: string;
    detail?: string;
    errorCode?: string;
    expected: 'RUNNING' | 'ANY_NON_TERMINAL';
  }): Promise<boolean> {
    this.chcriacao = params.chave;
    const detail = params.detail ?? params.reason;
    const errorCode = params.errorCode ?? params.reason;
    const statusFilter =
      params.expected === 'RUNNING'
        ? Prisma.sql`dados->>'statusCode' = '-518'`
        : Prisma.sql`(dados->>'statusCode' IS NULL OR dados->>'statusCode' IN (${Prisma.join(
            NON_TERMINAL_EXEC_STATUS,
          )}))`;

    const rows = await this._database.$queryRaw<Array<{ chave: bigint }>>(Prisma.sql`
      UPDATE "DPedido"
      SET dados = ${OperacaoExecucaoClaude.sqlDadosFalhaSistemica(
        Prisma.sql`${params.reason}::text`,
        Prisma.sql`${detail}::text`,
        Prisma.sql`${errorCode}::text`,
      )},
          baixado = true,
          "atualizadoEm" = NOW()
      WHERE chave = ${params.chave}
        AND "idClasse" IN (${Prisma.join(EXECUTION_CLASS_IDS)})
        AND excluido = false
        AND dados->'audit'->'outcome' IS NULL
        AND ${statusFilter}
      RETURNING chave
    `);

    const applied = rows.length > 0;
    this.logger.log(
      `[${this.correlationId}] encerrarPorFalhaSistemica chave=${params.chave} reason=${params.reason} applied=${applied}`,
    );
    return applied;
  }

  /**
   * Devolve uma execução RUNNING para a fila (QUEUED) após 409 PROJECT_BUSY do
   * agente (ADR-V2-082). CAS: só aplica se ainda -518 e sem outcome.
   * Remove `runtime.startedAt` (o deadline do sweeper recomeça no próximo
   * markRunning) e grava `dados.dispatch`.
   *
   * @param params.chave DPedido.chave
   * @param params.busyAttempt Tentativa atual (1-based)
   * @param params.nextAttemptAt ISO do próximo dispatch
   * @returns true se a execução voltou para QUEUED
   *
   * @example
   * ```typescript
   * if (await op.devolverParaFila({ chave, busyAttempt: 1, nextAttemptAt })) await queue.enqueueRetry(...);
   * ```
   */
  async devolverParaFila(params: {
    chave: bigint;
    busyAttempt: number;
    nextAttemptAt: string;
  }): Promise<boolean> {
    this.chcriacao = params.chave;
    const dispatch = {
      busyAttempts: params.busyAttempt,
      nextAttemptAt: params.nextAttemptAt,
      lastErrorCode: 'PROJECT_BUSY',
    };
    const rows = await this._database.$queryRaw<Array<{ chave: bigint }>>(Prisma.sql`
      UPDATE "DPedido"
      SET dados = jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(dados, '{}'::jsonb),
                '{statusCode}', to_jsonb('-514'::text), true
              ),
              '{runtime}', COALESCE(dados->'runtime', '{}'::jsonb) - 'startedAt', true
            ),
            '{dispatch}', ${JSON.stringify(dispatch)}::jsonb, true
          ),
          "atualizadoEm" = NOW()
      WHERE chave = ${params.chave}
        AND "idClasse" IN (${Prisma.join(EXECUTION_CLASS_IDS)})
        AND dados->>'statusCode' = '-518'
        AND dados->'audit'->'outcome' IS NULL
      RETURNING chave
    `);
    return rows.length > 0;
  }

  /**
   * Encerra em LOTE as execuções vencidas (sweeper — ADR-V2-082).
   *
   * Um único `UPDATE … FROM (SELECT … LIMIT n FOR UPDATE SKIP LOCKED) … RETURNING`:
   * seguro com várias réplicas do backend (cada linha é encerrada por uma só;
   * só quem recebe a linha no RETURNING emite eventos). Sempre sem
   * `audit.outcome`, `baixado=false`, não excluída. Critérios:
   *   - RUNNING (-518) com **deadline vencido**: `COALESCE(runtime.startedAt,
   *     atualizadoEm) + COALESCE(timeoutSec, defaultTimeoutSec) + marginSec < NOW()`
   *     → `TIMEOUT_NO_CALLBACK`;
   *   - RUNNING (-518) cujo **agente reiniciou** depois do início (heartbeat
   *     persiste `lastSeen` — relógio do backend — e `uptime` em segundos):
   *     `lastSeen − uptime > startedAt + 60s` → `AGENT_RESTARTED`;
   *   - QUEUED (-514) / APPROVED (-516) **órfãs** (Ciclo 2 / M3 — job perdido no
   *     Redis ou `REDIS_ENABLED=false` sem processor): `GREATEST(atualizadoEm,
   *     dispatch.nextAttemptAt) + queueStaleSec < NOW()` → `QUEUE_STALE`.
   *     Sem isso a task ficaria com 409 `execution_in_progress` para sempre.
   *
   * O UPDATE re-confere que o `statusCode` ainda é o lido no SELECT (CAS) — um
   * `markRunning` concorrente que venceu tira a linha do lote.
   *
   * Grava o mesmo formato de {@link encerrarPorFalhaSistemica} (statusCode -520,
   * baixado=true, claude.finishedAt/exitCode=-1, outcome source='system').
   * Durações calculadas com NOW()/timestamptz do Postgres (não são filtros por
   * dia — TimezoneService não se aplica).
   *
   * @param bd PrismaService
   * @param opts.marginSec Margem do deadline de RUNNING (P4 = 300s)
   * @param opts.defaultTimeoutSec Fallback p/ execuções legadas sem timeoutSec
   * @param opts.queueStaleSec Prazo de QUEUED/APPROVED órfãs (default 900s)
   * @param opts.limit Máximo de linhas por chamada
   * @returns Linhas efetivamente encerradas (com `reason`)
   *
   * @example
   * ```typescript
   * const rows = await OperacaoExecucaoClaude.encerrarVencidas(prisma, {
   *   marginSec: 300, defaultTimeoutSec: 1800, queueStaleSec: 900, limit: 100,
   * });
   * ```
   */
  static async encerrarVencidas(
    bd: PrismaService,
    opts: { marginSec: number; defaultTimeoutSec: number; queueStaleSec: number; limit: number },
  ): Promise<ExecucaoEncerradaRow[]> {
    const startedAtSql = Prisma.sql`COALESCE((p.dados->'runtime'->>'startedAt')::timestamptz, p."atualizadoEm")`;
    const restartSql = Prisma.sql`EXISTS (
      SELECT 1 FROM "DEntidade" a
       WHERE a.chave = (CASE WHEN p.dados->'audit'->>'agentId' ~ '^-?[0-9]+$'
                             THEN (p.dados->'audit'->>'agentId')::bigint END)
         AND a."idClasse" = ${AGENT_CLASS_ID}
         AND (CASE WHEN a.dados->>'uptime' ~ '^[0-9]+(\\.[0-9]+)?$'
                    AND a.dados->>'lastSeen' IS NOT NULL
                   THEN (a.dados->>'lastSeen')::timestamptz
                        - make_interval(secs => (a.dados->>'uptime')::double precision)
              END) > ${startedAtSql} + interval '60 seconds'
    )`;
    const timeoutSql = Prisma.sql`(CASE WHEN p.dados->>'timeoutSec' ~ '^[0-9]+$'
                                        THEN (p.dados->>'timeoutSec')::int
                                        ELSE ${opts.defaultTimeoutSec}::int END)`;
    const queueRefSql = Prisma.sql`GREATEST(
      p."atualizadoEm",
      COALESCE((p.dados->'dispatch'->>'nextAttemptAt')::timestamptz, p."atualizadoEm")
    )`;

    const rows = await bd.$queryRaw<ExecucaoEncerradaRow[]>(Prisma.sql`
      WITH alvo AS (
        SELECT p.chave,
               p.dados->>'statusCode' AS status_code,
               CASE WHEN p.dados->>'statusCode' IN ('-514', '-516') THEN ${EXEC_REASON_QUEUE_STALE}::text
                    WHEN ${restartSql} THEN ${EXEC_REASON_AGENT_RESTARTED}::text
                    ELSE ${EXEC_REASON_TIMEOUT}::text END AS reason
          FROM "DPedido" p
         WHERE p."idClasse" IN (${Prisma.join(EXECUTION_CLASS_IDS)})
           AND p.excluido = false
           AND p.baixado = false
           AND p.dados->'audit'->'outcome' IS NULL
           AND (
             (
               p.dados->>'statusCode' = '-518'
               AND (
                 ${startedAtSql}
                   + make_interval(secs => (${timeoutSql} + ${opts.marginSec}::int)::double precision) < NOW()
                 OR ${restartSql}
               )
             )
             OR (
               p.dados->>'statusCode' IN ('-514', '-516')
               AND ${queueRefSql} + make_interval(secs => ${opts.queueStaleSec}::int) < NOW()
             )
           )
         ORDER BY p.chave
         LIMIT ${opts.limit}::int
         FOR UPDATE SKIP LOCKED
      )
      UPDATE "DPedido"
         SET dados = ${OperacaoExecucaoClaude.sqlDadosFalhaSistemica(
           Prisma.sql`alvo.reason`,
           Prisma.sql`alvo.reason`,
           Prisma.sql`alvo.reason`,
         )},
             baixado = true,
             "atualizadoEm" = NOW()
        FROM alvo
       WHERE "DPedido".chave = alvo.chave
         AND "DPedido".dados->>'statusCode' = alvo.status_code
         AND "DPedido".dados->'audit'->'outcome' IS NULL
      RETURNING "DPedido".chave AS chave, "DPedido"."idLocEscritu" AS "idLocEscritu",
                "DPedido".dados AS dados, alvo.reason AS reason
    `);
    return rows;
  }

  /**
   * Fragmento SQL (expressão jsonb sobre a coluna `dados` da linha alvo) que
   * marca a execução como FAILED pelo sistema. Fonte única do formato usado
   * por {@link encerrarPorFalhaSistemica}, {@link encerrarVencidas} e pelo
   * script de backfill (`--close-stale-running`).
   *
   * Timestamps em ISO 8601 UTC (`YYYY-MM-DDTHH:MI:SS.MSZ`) — mesmo formato do
   * `new Date().toISOString()` do lado Node (parseável pelo frontend).
   *
   * @param reasonSql Expressão SQL text do motivo (`audit.outcome.reason`)
   * @param detailSql Expressão SQL text da mensagem (`claude.stderr`)
   * @param errorCodeSql Expressão SQL text do código (`audit.errorCode`)
   * @returns Prisma.Sql da expressão jsonb
   */
  static sqlDadosFalhaSistemica(
    reasonSql: Prisma.Sql,
    detailSql: Prisma.Sql,
    errorCodeSql: Prisma.Sql,
  ): Prisma.Sql {
    const nowIso = Prisma.sql`to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
    return Prisma.sql`jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(dados, '{}'::jsonb),
            '{statusCode}', to_jsonb('-520'::text), true
          ),
          '{claude}',
          COALESCE(dados->'claude', '{}'::jsonb)
            || jsonb_build_object('exitCode', -1, 'stderr', ${detailSql}, 'finishedAt', ${nowIso}),
          true
        ),
        '{runtime}',
        COALESCE(dados->'runtime', '{}'::jsonb) || jsonb_build_object('finishedAt', ${nowIso}),
        true
      ),
      '{audit}',
      COALESCE(dados->'audit', '{}'::jsonb)
        || jsonb_build_object(
             'errorCode', ${errorCodeSql},
             'outcome', jsonb_build_object(
               'success', false,
               'source', 'system',
               'reason', ${reasonSql},
               'recordedAt', ${nowIso}
             )
           ),
      true
    )`;
  }
}

/** idClasse de execução (ADR-V2-006) — CAS de desfecho restringe a elas. */
const EXECUTION_CLASS_IDS = [BigInt(-301), BigInt(-302), BigInt(-303)];

/** Status não-terminais (-514 QUEUED, -515 AWAITING, -516 APPROVED, -518 RUNNING). */
const NON_TERMINAL_EXEC_STATUS = ['-514', '-515', '-516', '-518'];

/** DClasse AGENT (DEntidade -156) — heartbeat persiste lastSeen/uptime. */
const AGENT_CLASS_ID = BigInt(-156);

/** Motivos gravados pelo sweeper (espelham EXECUTION_FAILURE_REASONS do módulo executions). */
const EXEC_REASON_TIMEOUT = 'TIMEOUT_NO_CALLBACK';
const EXEC_REASON_AGENT_RESTARTED = 'AGENT_RESTARTED';
const EXEC_REASON_QUEUE_STALE = 'QUEUE_STALE';

/** Resultado de {@link OperacaoExecucaoClaude.registrarOutcome}. */
export interface RegistrarOutcomeResult {
  /** false = CAS não aplicou (outro callback já gravou o desfecho real). */
  applied: boolean;
  /** recordedAt do outcome gravado (ou do existente quando !applied). */
  persistedAt: string;
  /** Desfecho sintético substituído (no máximo 1 vez por execução). */
  superseded?: { reason?: string; recordedAt?: string };
}

/** Linha devolvida por {@link OperacaoExecucaoClaude.encerrarVencidas}. */
export interface ExecucaoEncerradaRow {
  chave: bigint;
  idLocEscritu: bigint | null;
  dados: IExecucaoData;
  reason: string;
}
