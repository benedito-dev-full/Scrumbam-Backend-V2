import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { AgentTunnelService } from '../../automation/agents/agent-tunnel.service';
import { AUTOMATION_CLASS_IDS } from '../../automation/constants/automation-class-ids';
import { ExecutionRuntimeLogService } from '../../automation/runtime/execution-runtime-log.service';
import {
  RemoteAgentRuntime,
  RemoteExecutionClient,
} from '../../automation/runtime/remote-execution-client';
import { EXECUTION_QUEUE_NAME } from '../queues/execution-queue.constants';
import { RemoteAgentHttpError } from '../../automation/runtime/remote-agent-http.error';
import { ExecutionQueueService, ExecutionRunJobData } from '../queues/execution-queue.service';
import { TasksService } from '../../tasks/tasks.service';
import OperacaoExecucaoClaude from '../../engine/lib/operacao/OperacaoExecucaoClaude';
import { IExecucaoData } from '../../engine/lib/interfaces/IExecucaoData';
import {
  computeBusyDelayMs,
  EXECUTION_DEFAULT_TIMEOUT_SEC,
  EXECUTION_FAILURE_REASONS,
  ExecutionFailureReason,
  ExecutionLifecycleConfig,
  executionTaskLockKey,
  isBusyWaitExhausted,
  resolveExecutionLifecycleConfig,
  systemFailureMovedBy,
} from '../constants/execution-lifecycle.const';

/** Slug aceito pelo agente / gravado no vínculo PROJECT_AGENT (ADR-V2-035). */
const PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/;

/** Branch segura para trafegar ao agente (ADR-V2-083). */
const SAFE_GIT_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;

/**
 * `errorCode` do ACK do agente (preflight síncrono) → motivo canônico
 * (ADR-V2-083). Ex.: repo sem `/scrumban-executar` ⇒ 422 `PIPELINE_NOT_INSTALLED`.
 */
const AGENT_ACK_ERROR_TO_REASON: Record<string, ExecutionFailureReason> = {
  PIPELINE_NOT_INSTALLED: EXECUTION_FAILURE_REASONS.PIPELINE_NOT_INSTALLED,
  PIPELINE_PRECONDITION_FAILED: EXECUTION_FAILURE_REASONS.PIPELINE_PRECONDITION_FAILED,
  BASE_BRANCH_NOT_FOUND: EXECUTION_FAILURE_REASONS.PIPELINE_PRECONDITION_FAILED,
  INVALID_GIT_BRANCH: EXECUTION_FAILURE_REASONS.PIPELINE_PRECONDITION_FAILED,
};

const EXECUTION_CLASSES = [
  AUTOMATION_CLASS_IDS.EXEC_LOW,
  AUTOMATION_CLASS_IDS.EXEC_MEDIUM,
  AUTOMATION_CLASS_IDS.EXEC_HIGH,
];

/**
 * Set de idClasseRisk validos (defensive double-check). A primeira barreira
 * eh `loadExecution()` que ja filtra `idClasse IN EXECUTION_CLASSES` na
 * query Prisma; esta validacao garante que, se algo bizarro chegar via
 * outra via, `dispatchRunClaudeCode()` falha barulhento ao inves de mandar
 * idClasseRisk fora do contrato para o agente.
 */
const VALID_RISK_CLASSES = new Set<number>([
  Number(AUTOMATION_CLASS_IDS.EXEC_LOW),
  Number(AUTOMATION_CLASS_IDS.EXEC_MEDIUM),
  Number(AUTOMATION_CLASS_IDS.EXEC_HIGH),
]);

/** Regex de id numerico (BigInt-parseavel) — defesa antes de `BigInt()`. */
const NUMERIC_ID_RE = /^-?\d+$/;

interface ExecutionPedido {
  chave: bigint;
  idClasse: bigint;
  idLocEscritu: bigint | null;
  dados: Record<string, unknown>;
}

interface RuntimeProject {
  chave: bigint;
  dados: Record<string, unknown>;
}

interface RuntimeAgent {
  chave: bigint;
  dados: Record<string, unknown>;
}

/**
 * Processor BullMQ que dispara execucoes Claude Code remotamente.
 *
 * Fila: `execution-run-queue` (concurrency 3, attempts 1).
 * Eventos emitidos: `execution.started` (apos markRunning), `execution.failed`
 * (falha de dispatch / busy esgotado / duplicata — com `reason`).
 *
 * Fluxo (ADR-V2-033 + ADR-V2-082):
 * 1. Carrega `DPedido` (idClasse=-301/-302/-303), `DProject`, agente.
 * 2. Probe do tunel.
 * 3. `markRunning` (CAS sob `pg_advisory_xact_lock` por task): QUEUED/APPROVED
 *    -> RUNNING, so se SEM `audit.outcome` e sem OUTRA execucao RUNNING da mesma
 *    task. CAS perdida por duplicata -> FAILED `DUPLICATE_TASK_EXECUTION`.
 * 4. Chama `remoteClient.execute()` (ACK sincrono) e, apos o ACK, emite
 *    `execution.started` (uma vez — retries de 409 nao re-emitem).
 * 5. ACK ok -> move a task vinculada para EXECUTING **somente se a execucao
 *    ainda esta RUNNING** (callback ultrarrapido nao regride DONE->EXECUTING).
 * 6. 409 `PROJECT_BUSY` do agente -> Engine `devolverParaFila` (RUNNING->QUEUED)
 *    + `enqueueRetry` com backoff (30s, 60s, ... teto 300s) enquanto a espera
 *    desde o 1º 409 nao passar de `EXECUTION_BUSY_MAX_WAIT_SEC` (~6h05 —
 *    ADR-V2-083, decisao CEO P4); estourou -> FAILED `PROJECT_BUSY_EXHAUSTED`.
 *    422 do preflight do agente (`PIPELINE_NOT_INSTALLED`, ...) -> FAILED com
 *    o motivo canonico correspondente (ADR-V2-083).
 * 7. Demais erros -> FAILED via Engine `encerrarPorFalhaSistemica`
 *    (`source='system'`, baixado=true, claude.finishedAt/exitCode=-1) e a task
 *    sai de EXECUTING se estiver la.
 *
 * O resultado real chega via callback `POST /agents/:id/execution-result`.
 * Se o callback nunca chegar, o `ExecutionRunningSweeperService` encerra a
 * execucao no deadline (`startedAt + timeoutSec + 300s`) ou ao detectar
 * restart do agente via heartbeat.
 *
 * Desvio Pilar 1 sinalizado (nao expandido): `markRunning` segue como UPDATE
 * raw neste processor (follow-up: mover para o Engine).
 *
 * Performance target: < 200ms por job (excluindo o ACK do agente, ate 30s).
 */
@Injectable()
@Processor(EXECUTION_QUEUE_NAME, { concurrency: 3 })
export class ExecutionRunProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecutionRunProcessor.name);
  private readonly lifecycle: ExecutionLifecycleConfig = resolveExecutionLifecycleConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventProducer: EventProducerService,
    private readonly agentTunnel: AgentTunnelService,
    private readonly remoteClient: RemoteExecutionClient,
    private readonly logService: ExecutionRuntimeLogService,
    private readonly tasksService: TasksService,
    private readonly executionQueue: ExecutionQueueService,
  ) {
    super();
  }

  /**
   * Processa um job `run` da fila (ver JSDoc da classe para o fluxo).
   *
   * @param job - Job BullMQ `{ executionId, projectId, agentId, busyAttempt? }`
   * @returns Promise void (nunca lanca — falhas viram FAILED/retry)
   */
  async process(job: Job<ExecutionRunJobData>): Promise<void> {
    const { executionId, projectId, agentId } = job.data;
    const pedido = await this.loadExecution(executionId);
    if (!pedido) return;

    const dados = pedido.dados;
    const correlationId =
      this.asString(this.asRecord(dados.audit)?.correlationId) ?? `execution-${executionId}`;

    const [project, agent] = await Promise.all([
      this.loadProject(projectId),
      this.loadAgent(agentId),
    ]);

    if (!project || !agent) {
      await this.failExecution(pedido, correlationId, 'PROJECT_OR_AGENT_NOT_FOUND');
      return;
    }

    let runtimeAgent: RemoteAgentRuntime;
    try {
      runtimeAgent = this.resolveRuntimeAgent(agent);
      const probe = await this.agentTunnel.probe(runtimeAgent.tunnelPort);
      if (!probe.tunnelOk) {
        // Ciclo 3: código canônico próprio; detalhe técnico (ECONNREFUSED,
        // TUNNEL_TIMEOUT…) só em claude.stderr.
        await this.failExecution(
          pedido,
          correlationId,
          probe.error ?? EXECUTION_FAILURE_REASONS.TUNNEL_UNAVAILABLE,
          EXECUTION_FAILURE_REASONS.TUNNEL_UNAVAILABLE,
        );
        return;
      }

      const transitioned = await this.markRunning(
        executionId,
        this.asString(this.asRecord(dados.task)?.id),
      );
      if (!transitioned) {
        await this.handleMarkRunningLost(pedido, correlationId);
        return;
      }

      await this.dispatchRunClaudeCode({
        pedido,
        project,
        agent: runtimeAgent,
        correlationId,
      });

      // L1 (Ciclo 2): `execution.started` só após o ACK — retries de 409
      // PROJECT_BUSY não re-emitem o evento.
      await this.safeEmit('execution.started', { executionId, projectId, agentId }, correlationId);

      // ADR-V2-082: task -> EXECUTING SO depois do ACK (evita task EXECUTING
      // durante 409/backoff) e so se a execucao ainda esta RUNNING.
      await this.moveLinkedTaskToExecutingIfStillRunning(pedido);
    } catch (error) {
      if (error instanceof RemoteAgentHttpError && error.isProjectBusy()) {
        await this.handleProjectBusy(job, pedido, correlationId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const ackReason =
        error instanceof RemoteAgentHttpError && error.errorCode
          ? AGENT_ACK_ERROR_TO_REASON[error.errorCode]
          : undefined;
      await this.failExecution(pedido, correlationId, message, ackReason);
    }
  }

  /**
   * 409 PROJECT_BUSY do agente: devolve a execucao para QUEUED (Engine, CAS)
   * e re-enfileira com backoff. Desistencia POR TEMPO (ADR-V2-083, P4): se a
   * espera desde o 1º 409 passou de `busyMaxWaitSec` (~6h05 — teto da esteira
   * + margem) -> FAILED `PROJECT_BUSY_EXHAUSTED`. Se o re-enfileiramento falhar
   * (Redis), falha a execucao para nao deixa-la QUEUED para sempre.
   *
   * O QUEUE_STALE do sweeper continua seguro: cada retry regrava
   * `dispatch.nextAttemptAt` (<= 300s a frente) e o prazo de fila e 900s.
   */
  private async handleProjectBusy(
    job: Job<ExecutionRunJobData>,
    pedido: ExecutionPedido,
    correlationId: string,
  ): Promise<void> {
    const { executionId, projectId, agentId } = job.data;
    const attempt = (job.data.busyAttempt ?? 0) + 1;
    const nowMs = Date.now();
    // Fonte: job (retries novos) -> dados.dispatch (job pre-deploy) -> agora (1º 409).
    const dispatchAtual = this.asRecord(pedido.dados.dispatch);
    const busySince =
      this.asString(job.data.busySince) ??
      this.asString(dispatchAtual?.firstBusyAt) ??
      new Date(nowMs).toISOString();
    const maxWaitSec = this.lifecycle.busyMaxWaitSec;

    if (isBusyWaitExhausted(busySince, nowMs, maxWaitSec)) {
      await this.failExecution(
        pedido,
        correlationId,
        `PROJECT_BUSY: projeto ocupado por mais de ${maxWaitSec}s (${attempt - 1} tentativas desde ${busySince})`,
        EXECUTION_FAILURE_REASONS.PROJECT_BUSY_EXHAUSTED,
      );
      return;
    }

    const delayMs = computeBusyDelayMs(
      attempt,
      this.lifecycle.busyBaseDelayMs,
      this.lifecycle.busyMaxDelayMs,
    );
    const nextAttemptAt = new Date(nowMs + delayMs).toISOString();
    const requeued = await this.buildEngine(pedido, correlationId).devolverParaFila({
      chave: pedido.chave,
      busyAttempt: attempt,
      nextAttemptAt,
      firstBusyAt: busySince,
    });
    if (!requeued) {
      // Callback/sweeper ja decidiram o desfecho — nada a fazer.
      this.logger.warn(`execution_busy_requeue_skipped executionId=${executionId}`);
      return;
    }

    try {
      await this.executionQueue.enqueueRetry(
        { executionId, projectId, agentId, busySince },
        { attempt, delayMs },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failExecution(pedido, correlationId, `PROJECT_BUSY requeue falhou: ${message}`);
      return;
    }

    const audit = this.asRecord(pedido.dados.audit);
    await this.safeRecordSystem({
      executionId,
      projectId: this.asString(audit?.projectId) ?? projectId,
      agentId: this.asString(audit?.agentId) ?? agentId,
      correlationId,
      line: `PROJECT_BUSY retry ${attempt} em ${Math.round(delayMs / 1000)}s (aguardando ha ${Math.round((nowMs - Date.parse(busySince)) / 1000)}s de ate ${maxWaitSec}s)`,
      code: 'PROJECT_BUSY',
    });
  }

  /**
   * CAS do `markRunning` nao aplicou. Se ha OUTRA execucao RUNNING da mesma
   * task, esta perdeu a corrida anti-duplicata -> FAILED
   * `DUPLICATE_TASK_EXECUTION` (nao fica QUEUED para sempre). Senao e job
   * stale (ja terminou/ja rodando) -> skip.
   */
  private async handleMarkRunningLost(
    pedido: ExecutionPedido,
    correlationId: string,
  ): Promise<void> {
    const executionId = pedido.chave.toString();
    const taskId = this.asString(this.asRecord(pedido.dados.task)?.id);
    const ownStatus = this.asString(pedido.dados.statusCode);
    const ownOutcome = this.asRecord(this.asRecord(pedido.dados.audit)?.outcome);

    if (taskId && ownStatus !== AUTOMATION_CLASS_IDS.EXEC_STATUS_RUNNING.toString() && !ownOutcome) {
      const otherRunning = await this.prisma.dPedido.findFirst({
        where: {
          idClasse: { in: EXECUTION_CLASSES },
          excluido: false,
          chave: { not: pedido.chave },
          AND: [
            { dados: { path: ['task', 'id'], equals: taskId } },
            {
              dados: {
                path: ['statusCode'],
                equals: AUTOMATION_CLASS_IDS.EXEC_STATUS_RUNNING.toString(),
              },
            },
          ],
        },
        select: { chave: true },
      });
      if (otherRunning) {
        await this.failExecution(
          pedido,
          correlationId,
          `Execucao ${otherRunning.chave.toString()} da mesma task ja esta RUNNING`,
          EXECUTION_FAILURE_REASONS.DUPLICATE_TASK_EXECUTION,
        );
        return;
      }
    }

    this.logger.warn(`execution_run_skip_stale executionId=${executionId}`);
  }

  /**
   * Monta o payload V2 e dispara `RUN_CLAUDE_CODE`. Retorna apos receber
   * ACK sincrono do agente — resultado completo chega via callback.
   */
  private async dispatchRunClaudeCode(input: {
    pedido: ExecutionPedido;
    project: RuntimeProject;
    agent: RemoteAgentRuntime;
    correlationId: string;
  }): Promise<void> {
    const executionId = input.pedido.chave.toString();
    const projectId = input.project.chave.toString();

    const projectSlug = await this.resolveProjectSlug(input.project, input.agent.agentId);
    const prompt = this.resolvePrompt(input.pedido.dados);
    const { git, pipeline } = this.resolvePipelineRequest(input.pedido.dados);
    const resumeSessionId = this.resolveResumeSessionId(input.pedido.dados);
    const timeoutSec = this.resolveTimeoutSec(input.pedido.dados);
    const idClasseRisk = Number(input.pedido.idClasse);

    if (!VALID_RISK_CLASSES.has(idClasseRisk)) {
      throw new Error(`idClasseRisk invalido (${idClasseRisk}) — esperado -301/-302/-303`);
    }

    await this.remoteClient.execute({
      executionId,
      projectId,
      correlationId: input.correlationId,
      projectSlug,
      idClasseRisk,
      prompt,
      resumeSessionId,
      timeoutSec,
      ...(git ? { git } : {}),
      ...(pipeline ? { pipeline } : {}),
      agent: input.agent,
    });

    this.logger.log(
      `execution_dispatched executionId=${executionId} projectSlug=${projectSlug} idClasseRisk=${idClasseRisk} mode=${pipeline ? 'pipeline' : 'simple'}`,
    );

    // A execucao permanece RUNNING ate o callback `POST /agents/:id/execution-result`
    // (Engine.registrarOutcome) ou ate o ExecutionRunningSweeperService encerra-la
    // no deadline (timeoutSec + margem) / restart do agente (ADR-V2-082).
  }

  /**
   * Resolve o `projectSlug` que a VPS CONHECE (ADR-V2-083 — correcao de slug).
   *
   * Fonte primaria: `DVincula(PROJECT_AGENT).metaDados.projectSlug` do par
   * projeto×agente — e exatamente o slug usado no PROVISION_PROJECT (secao
   * `## <slug>` do CLAUDE.md global da VPS). Antes o dispatch usava
   * `DProject.dados.slug` (com sufixo de colisao `-2`), divergente do slug
   * provisionado (sem sufixo) ⇒ execucao no repo errado / slug desconhecido.
   * Fallback: `DProject.dados.slug` (vinculo legado sem projectSlug). 1 query.
   */
  private async resolveProjectSlug(project: RuntimeProject, agentId: string): Promise<string> {
    let linkSlug: string | undefined;
    if (NUMERIC_ID_RE.test(agentId)) {
      const link = await this.prisma.dVincula.findFirst({
        where: {
          idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
          idLocEscritu: project.chave,
          idEntidade: BigInt(agentId),
          excluido: false,
        },
        select: { metaDados: true },
      });
      const meta = this.asRecord(link?.metaDados);
      const candidate = this.asString(meta?.projectSlug);
      if (candidate && PROJECT_SLUG_RE.test(candidate)) linkSlug = candidate;
    }
    const projectSlug = this.asString(project.dados.slug);
    if (linkSlug && projectSlug && linkSlug !== projectSlug) {
      this.logger.warn(
        `project_slug_divergence projectId=${project.chave.toString()} agentId=${agentId} link=${linkSlug} project=${projectSlug} (usando o do vinculo)`,
      );
    }
    if (linkSlug) return linkSlug;
    const slug = projectSlug;
    if (!slug) {
      throw new InternalServerErrorException(
        `DProject.dados.slug ausente para projectId=${project.chave.toString()} — execute Sub-tarefa 2.3 (backfill) antes de disparar execucoes V2`,
      );
    }
    return slug;
  }

  /**
   * Extrai prompt do usuario.
   *
   * Preferencia: `DPedido.dados.prompt` (canonico V2).
   *
   * Fallback: `DPedido.dados.command.args` apos o flag `-p` (formato legado
   * gerado pelo `ExecutionsService.execute` quando recebe `ExecuteCommandDto`
   * com `command.args: ["-p", "<prompt>", ...]`). O fallback existe porque
   * a sub-tarefa 2.2 (plan-automation-backend-side-task2) removeu o uso de
   * `command.text` no consumer, mas a sub-tarefa correspondente que
   * atualizaria o producer para popular `dados.prompt` diretamente nao foi
   * realizada — esta camada ponte deixa producer atual e consumer V2
   * conviverem ate o backfill canonico ser implementado.
   *
   * Falha barulhento se nenhum dos dois caminhos resolver — execucao sem
   * prompt nao tem como rodar.
   */
  private resolvePrompt(dados: Record<string, unknown>): string {
    const direct = this.asString(dados.prompt);
    if (direct) return direct;

    const command = this.asRecord(dados.command);
    const args = Array.isArray(command?.args) ? (command!.args as unknown[]) : null;
    if (args) {
      // Procura o primeiro `-p` ou `--print` e pega o token seguinte.
      for (let i = 0; i < args.length - 1; i++) {
        const flag = args[i];
        if (flag === '-p' || flag === '--print') {
          const next = args[i + 1];
          if (typeof next === 'string' && next.trim().length > 0) {
            return next;
          }
        }
      }
    }

    throw new Error(
      'DPedido.dados.prompt ausente — protocolo V2 espera `dados.prompt` (canonico) ou `dados.command.args` no formato `["-p", "<prompt>"]` (legado, deprecated).',
    );
  }

  /**
   * Monta `git` + `pipeline` do payload RUN_CLAUDE_CODE a partir de
   * `dados.git`/`dados.pipeline` gravados na criacao (ADR-V2-083). Execucoes
   * sem `pipeline.required` (legado/COMMAND/HIBRIDO) ⇒ ambos `null` (modo simples).
   */
  private resolvePipelineRequest(dados: Record<string, unknown>): {
    git: { branch: string; baseBranch: string | null } | null;
    pipeline: { required: boolean; prRequired: boolean; taskType: string } | null;
  } {
    const pipeline = this.asRecord(dados.pipeline);
    if (pipeline?.required !== true) return { git: null, pipeline: null };
    const git = this.asRecord(dados.git);
    const branch = this.asString(git?.branch);
    const base = this.asString(git?.baseBranch);
    if (!branch || !SAFE_GIT_REF_RE.test(branch)) {
      throw new Error('dados.git.branch ausente/invalida em execucao do modo esteira (ADR-V2-083)');
    }
    return {
      git: { branch, baseBranch: base && SAFE_GIT_REF_RE.test(base) ? base : null },
      pipeline: {
        required: true,
        prRequired: pipeline.prRequired === true,
        taskType: this.asString(pipeline.taskType) ?? 'other',
      },
    };
  }

  /**
   * Extrai `resumeSessionId` opcional de `DPedido.dados.resumeSessionId`.
   * Retorna `null` se ausente (sessao nova).
   */
  private resolveResumeSessionId(dados: Record<string, unknown>): string | null {
    const direct = this.asString(dados.resumeSessionId);
    return direct ?? null;
  }

  /**
   * Extrai timeout em segundos de `DPedido.dados.timeoutSec` — fonte unica
   * gravada na criacao (ADR-V2-082). Fallback `EXECUTION_DEFAULT_TIMEOUT_SEC`
   * (1800s) para execucoes legadas.
   */
  private resolveTimeoutSec(dados: Record<string, unknown>): number {
    const direct = this.asNumber(dados.timeoutSec);
    if (direct && direct > 0 && Number.isFinite(direct)) return direct;
    return EXECUTION_DEFAULT_TIMEOUT_SEC;
  }

  private async loadExecution(executionId: string): Promise<ExecutionPedido | null> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        chave: BigInt(executionId),
        idClasse: { in: EXECUTION_CLASSES },
        excluido: false,
      },
      select: { chave: true, idClasse: true, idLocEscritu: true, dados: true },
    });

    if (!pedido) return null;
    return {
      chave: pedido.chave,
      idClasse: pedido.idClasse,
      idLocEscritu: pedido.idLocEscritu,
      dados: (pedido.dados ?? {}) as Record<string, unknown>,
    };
  }

  private async loadProject(projectId: string): Promise<RuntimeProject | null> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: BigInt(projectId), excluido: false },
      select: { chave: true, dados: true },
    });
    if (!project) return null;
    return {
      chave: project.chave,
      dados: (project.dados ?? {}) as Record<string, unknown>,
    };
  }

  private async loadAgent(agentId: string): Promise<RuntimeAgent | null> {
    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: BigInt(agentId),
        idClasse: AUTOMATION_CLASS_IDS.AGENT,
        excluido: false,
      },
      select: { chave: true, dados: true },
    });
    if (!agent) return null;
    return {
      chave: agent.chave,
      dados: (agent.dados ?? {}) as Record<string, unknown>,
    };
  }

  private resolveRuntimeAgent(agent: RuntimeAgent): RemoteAgentRuntime {
    const tunnelPortRaw = agent.dados.tunnelPort;
    const tunnelPort =
      typeof tunnelPortRaw === 'number'
        ? tunnelPortRaw
        : typeof tunnelPortRaw === 'string'
          ? Number(tunnelPortRaw)
          : NaN;
    const agentCommandSecretEncrypted = this.asString(agent.dados.agentCommandSecretEncrypted);
    if (!Number.isInteger(tunnelPort) || !agentCommandSecretEncrypted) {
      throw new Error('Agent sem tunnelPort ou agentCommandSecretEncrypted.');
    }
    return {
      agentId: agent.chave.toString(),
      tunnelPort,
      agentCommandSecretEncrypted,
    };
  }

  /**
   * Move a task vinculada para EXECUTING somente se a execucao ainda esta
   * RUNNING e sem outcome (releitura — 1 query). Evita regredir DONE/FAILED ->
   * EXECUTING quando um callback ultrarrapido chega antes.
   */
  private async moveLinkedTaskToExecutingIfStillRunning(pedido: ExecutionPedido): Promise<void> {
    const taskId = this.asString(this.asRecord(pedido.dados.task)?.id);
    if (!taskId) return;
    try {
      const current = await this.prisma.dPedido.findFirst({
        where: { chave: pedido.chave, excluido: false },
        select: { dados: true },
      });
      const dadosAtuais = (current?.dados ?? {}) as Record<string, unknown>;
      const stillRunning =
        this.asString(dadosAtuais.statusCode) ===
          AUTOMATION_CLASS_IDS.EXEC_STATUS_RUNNING.toString() &&
        !this.asRecord(this.asRecord(dadosAtuais.audit)?.outcome);
      if (!stillRunning) {
        this.logger.log(`task_move_executing_skipped taskId=${taskId} (execucao ja terminou)`);
        return;
      }
      await this.tasksService.updateStatus(taskId, { status: 'EXECUTING' });
      this.logger.log(`task_moved_to_executing taskId=${taskId}`);
    } catch (err) {
      this.logger.warn(`task_move_executing_failed taskId=${taskId} err=${(err as Error).message}`);
    }
  }

  /**
   * Tira a task vinculada de EXECUTING (-> FAILED) quando a execucao falhou
   * pelo sistema. So age se a task AINDA esta EXECUTING (nao pisa em humano).
   */
  private async releaseLinkedTaskOnFailure(pedido: ExecutionPedido): Promise<void> {
    const taskId = this.asString(this.asRecord(pedido.dados.task)?.id);
    if (!taskId) return;
    try {
      const task = await this.tasksService.findOne(taskId);
      if (task.status !== 'EXECUTING') return;
      // M2/L7: marcador permite ao callback tardio promover FAILED -> DONE
      // somente quando o FAILED veio desta falha sintética.
      await this.tasksService.updateStatus(taskId, {
        status: 'FAILED',
        movedBy: systemFailureMovedBy(pedido.chave.toString()),
      });
      this.logger.log(`task_released_on_failure taskId=${taskId}`);
    } catch (err) {
      this.logger.warn(`task_release_failed taskId=${taskId} err=${(err as Error).message}`);
    }
  }

  /**
   * CAS QUEUED/APPROVED -> RUNNING (desvio Pilar 1 sinalizado — raw fora do Engine).
   *
   * ADR-V2-082: reforcada com (a) `audit.outcome` ausente — um re-enfileiramento
   * nunca sobrescreve SUCCESS/FAILED com RUNNING; (b) anti-duplicata — nenhuma
   * OUTRA execucao da mesma task pode estar RUNNING.
   *
   * Ciclo 2 / M1: o `NOT EXISTS` sozinho sofre write skew sob READ COMMITTED
   * (duas transacoes concorrentes nao enxergam o RUNNING nao-commitado uma da
   * outra). Por isso o UPDATE roda numa transacao que antes adquire
   * `pg_advisory_xact_lock(hashtext('exec-task:<taskId>'))`: a segunda espera a
   * primeira commitar e, como cada statement em READ COMMITTED tira snapshot
   * novo, o `NOT EXISTS` dela enxerga o RUNNING ja commitado -> CAS falha.
   * Mesmo lock usado por `ExecutionsService.execute` (trava + criacao).
   */
  private async markRunning(executionId: string, taskId?: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (taskId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${executionTaskLockKey(taskId)}))`;
      }
      const updated = await tx.$executeRaw`
        UPDATE "DPedido"
        SET dados = jsonb_set(
              jsonb_set(
                COALESCE(dados, '{}'::jsonb),
                '{runtime}',
                COALESCE(dados->'runtime', '{}'::jsonb) || jsonb_build_object('startedAt', NOW()::text),
                true
              ),
              '{statusCode}',
              to_jsonb(${AUTOMATION_CLASS_IDS.EXEC_STATUS_RUNNING.toString()}::text),
              true
            ),
            "atualizadoEm" = NOW()
        WHERE "chave" = ${BigInt(executionId)}
          AND "idClasse" IN (${Prisma.join(EXECUTION_CLASSES)})
          AND dados->'audit'->'outcome' IS NULL
          AND (
            dados->>'statusCode' IN (
              ${AUTOMATION_CLASS_IDS.EXEC_STATUS_QUEUED.toString()},
              ${AUTOMATION_CLASS_IDS.EXEC_STATUS_APPROVED.toString()}
            )
            OR dados->'approval'->>'status' IN ('queued', 'approved')
          )
          AND NOT EXISTS (
            SELECT 1 FROM "DPedido" o
             WHERE o."idClasse" IN (${Prisma.join(EXECUTION_CLASSES)})
               AND o.excluido = false
               AND o.chave <> ${BigInt(executionId)}
               AND o.dados->'task'->>'id' IS NOT NULL
               AND o.dados->'task'->>'id' = "DPedido".dados->'task'->>'id'
               AND o.dados->>'statusCode' = ${AUTOMATION_CLASS_IDS.EXEC_STATUS_RUNNING.toString()}
          )
      `;
      return updated > 0;
    });
  }

  /**
   * Falha a execucao pelo sistema via Engine (`encerrarPorFalhaSistemica`):
   * statusCode -520, baixado=true, claude.finishedAt + exitCode=-1,
   * outcome `source='system'`. SO se a CAS aplicou: log -496, task
   * EXECUTING -> FAILED e `execution.failed {reason, errorCode}` (Padrao #7).
   *
   * @param detail - Mensagem legivel (vai para `claude.stderr` e log -496)
   * @param reason - Motivo canonico (tipado: so codigos de EXECUTION_FAILURE_REASONS;
   *   default `DISPATCH_FAILED`) -> `audit.outcome.reason` e `errorCode`
   */
  private async failExecution(
    pedido: ExecutionPedido,
    correlationId: string,
    detail: string,
    reason: ExecutionFailureReason = EXECUTION_FAILURE_REASONS.DISPATCH_FAILED,
  ): Promise<void> {
    const executionId = pedido.chave.toString();
    const dadosAudit = this.asRecord(pedido.dados.audit);
    const projectId = this.asString(dadosAudit?.projectId) ?? pedido.idLocEscritu?.toString() ?? '';
    const agentId = this.asString(dadosAudit?.agentId) ?? '0';
    const taskId = this.asString(this.asRecord(pedido.dados.task)?.id);
    // L3 (Ciclo 2): errorCode sempre canônico (motivo); o detalhe livre vai só
    // para claude.stderr / log.
    const errorCode = reason;

    let applied = false;
    try {
      applied = await this.buildEngine(pedido, correlationId).encerrarPorFalhaSistemica({
        chave: pedido.chave,
        reason,
        detail,
        errorCode,
        expected: 'ANY_NON_TERMINAL',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`execution_fail_persist_error executionId=${executionId} error=${message}`);
      return;
    }

    if (!applied) {
      this.logger.warn(
        `execution_fail_skipped executionId=${executionId} reason=${reason} (desfecho ja gravado)`,
      );
      return;
    }

    await this.safeRecordSystem({
      executionId,
      projectId,
      agentId,
      correlationId,
      line: detail,
      code: reason,
    });
    await this.releaseLinkedTaskOnFailure(pedido);
    await this.safeEmit(
      'execution.failed',
      {
        executionId,
        projectId,
        agentId,
        ...(taskId ? { taskId } : {}),
        reason,
        errorCode,
      },
      correlationId,
    );
  }

  /**
   * Instancia o Engine apenas para os metodos de desfecho (sem nova/calcula —
   * `dados.risk` intocado, guardas ADR-V2-081 nao re-executam).
   */
  private buildEngine(pedido: ExecutionPedido, correlationId: string): OperacaoExecucaoClaude {
    const audit = this.asRecord(pedido.dados.audit);
    const projectRaw = this.asString(audit?.projectId) ?? pedido.idLocEscritu?.toString() ?? '0';
    const agentRaw = this.asString(audit?.agentId) ?? '0';
    const command = (this.asRecord(pedido.dados.command) as unknown as IExecucaoData['command']) ?? {
      text: '',
    };
    return new OperacaoExecucaoClaude({
      usuario: 'system:execution-run-processor',
      classe: pedido.idClasse.toString(),
      bd: this.prisma,
      projectId: NUMERIC_ID_RE.test(projectRaw) ? projectRaw : '0',
      agentId: NUMERIC_ID_RE.test(agentRaw) ? agentRaw : '0',
      correlationId,
      command,
      agentTunnelService: { runClaudeCode: () => Promise.resolve({}) },
      eventProducer: this.eventProducer,
    });
  }

  private async safeEmit(
    type: string,
    payload: Record<string, unknown>,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.eventProducer.addInternalEvent(type, payload, correlationId, {
        source: ExecutionRunProcessor.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`execution_event_emit_failed type=${type} error=${message}`);
    }
  }

  private async safeRecordSystem(
    input: Parameters<ExecutionRuntimeLogService['recordSystem']>[0],
  ): Promise<void> {
    try {
      await this.logService.recordSystem(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`execution_system_log_failed error=${message}`);
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
}
