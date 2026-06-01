import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskTimerStateDto } from './task-timer-response.dto';

/**
 * Estado de execução ativa de uma task (DPedido idClasse=-300..-304 com
 * `baixado=false` e `dados.taskId` igual à chave da task).
 *
 * Quando presente em `TaskResponseDto.activeExecution`, a task está
 * sendo processada pela IA (Claude Code via agente VPS) e a UI deve
 * tratá-la como read-only (sem drag-and-drop, sem edição inline, sem
 * mover de coluna). A própria criação de uma execução só acontece
 * quando o usuário clica explicitamente em "Executar" — portanto
 * `activeExecution !== null` é o sinal canônico de "lock".
 *
 * Volta a `null` quando o agente conclui (`baixado=true`) ou quando a
 * execução é rejeitada/expirada (também `baixado=true`).
 *
 * @see OperacaoExecucaoClaude (Pilar 1 — DPedido idClasse=-301/-302/-303)
 * @see ADR-V2-005 (Engine Pilar 1 ATIVADO)
 * @see ADR-V2-006 (risk via idClasse)
 */
export class ActiveExecutionDto {
  @ApiProperty({
    description: 'ID do DPedido (BigInt como string) que representa a execução ativa.',
    example: '12345',
  })
  id!: string;

  @ApiProperty({
    description:
      'Estado simplificado derivado de aprovado/baixado do DPedido: ' +
      '`awaiting_approval` (aprovado=false), `running` (aprovado=true, baixado=false). ' +
      'Quando `baixado=true`, a execução deixa de aparecer (o campo activeExecution vira null).',
    enum: ['queued', 'running', 'awaiting_approval'],
    example: 'running',
  })
  status!: 'queued' | 'running' | 'awaiting_approval';

  @ApiProperty({
    description:
      'Nível de risco da execução, derivado do idClasse do DPedido ' +
      '(-301=LOW, -302=MEDIUM, -303=HIGH). ADR-V2-006.',
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    example: 'LOW',
  })
  riskLevel!: 'LOW' | 'MEDIUM' | 'HIGH';

  @ApiProperty({
    description: 'Data ISO 8601 de criação do DPedido (início da execução).',
    example: '2026-05-26T13:00:00.000Z',
  })
  startedAt!: string;
}

/**
 * DTO de resposta de task.
 *
 * Retornado em create, findOne, update e updateStatus.
 * O campo `dados` expõe identifier, estado V3 e telemetria.
 *
 * @example
 * ```json
 * {
 *   "id": "7",
 *   "nome": "Implementar JWT",
 *   "projectId": "1",
 *   "identifier": "DEV-7",
 *   "status": "INBOX",
 *   "priority": null,
 *   "taskType": "BUG",
 *   "assigneeId": null,
 *   "sprintId": null,
 *   "dados": { "identifier": "DEV-7", "v3": { "state": "INBOX" }, "taskType": "BUG" },
 *   "criadoEm": "2026-05-09T00:00:00.000Z",
 *   "atualizadoEm": "2026-05-09T00:00:00.000Z"
 * }
 * ```
 */
export class TaskResponseDto {
  @ApiProperty({ description: 'ID da task (chave DTask)', example: '7' })
  id!: string;

  @ApiProperty({ description: 'Nome/título da task', example: 'Implementar JWT' })
  nome!: string;

  @ApiPropertyOptional({ description: 'Descrição da task', nullable: true })
  descricao!: string | null;

  @ApiProperty({ description: 'ID do projeto', example: '1' })
  projectId!: string;

  @ApiProperty({
    description:
      'idClasse polimórfica da DTask como string. "-154" = SCRUMBAN_TASK; ' +
      '"-200" = PHASE/BLOCO (ADR-V2-047). Usado pelo frontend para distinguir ' +
      'task executável de fase agrupadora.',
    example: '-154',
    enum: ['-154', '-200'],
  })
  idClasse!: string;

  @ApiProperty({ description: 'Identifier único (ex: DEV-7); vazio para fases', example: 'DEV-7' })
  identifier!: string;

  @ApiProperty({ description: 'Estado V3 atual', example: 'INBOX' })
  status!: string;

  @ApiPropertyOptional({
    description:
      'Prioridade da task — string enum (HIGH/MEDIUM/LOW/URGENT) derivada do idClasse ' +
      'da DTabela referenciada por DTask.idPriority. Retorna null se não definida.',
    nullable: true,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
    example: 'HIGH',
  })
  priority!: string | null;

  @ApiPropertyOptional({
    description:
      'Tipo da task (FEATURE/BUG/IMPROVEMENT/REVIEW/EXPLAIN); extraído de dados.taskType',
    nullable: true,
    example: 'BUG',
  })
  taskType!: string | null;

  @ApiPropertyOptional({
    description:
      'ID do time responsável pela task. Extraído de dados.assigneeTeamId. ' +
      'Null se não atribuído a nenhum time.',
    nullable: true,
    example: '42',
  })
  assigneeTeamId!: string | null;

  @ApiPropertyOptional({ description: 'ID do assignee', nullable: true })
  assigneeId!: string | null;

  @ApiPropertyOptional({ description: 'ID do sprint', nullable: true })
  sprintId!: string | null;

  @ApiPropertyOptional({
    description: 'ID da task pai (subtarefa). Null se task raiz.',
    nullable: true,
    example: '42',
  })
  idPai!: string | null;

  @ApiPropertyOptional({
    description:
      'Data limite da task em ISO 8601. Null se não definida. ' +
      '(D1 — Bloco D integração frontend V2)',
    nullable: true,
    example: '2026-06-30T03:00:00.000Z',
  })
  dueDate!: string | null;

  @ApiPropertyOptional({
    description: 'Dados polimórficos (identifier, v3, telemetry, automation)',
    nullable: true,
  })
  dados!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description:
      'Execução ativa (Claude Code via VPS) associada a esta task. ' +
      '`null` quando não há execução em andamento. Quando presente, a ' +
      'UI deve tratar a task como read-only — o disparo da execução é ' +
      'irreversível e consome tokens da assinatura Claude Max, então ' +
      'edições durante a janela de execução são bloqueadas no client.',
    type: () => ActiveExecutionDto,
    nullable: true,
  })
  activeExecution!: ActiveExecutionDto | null;

  @ApiPropertyOptional({
    description:
      'Estado agregado do timer manual de tempo por usuário (ADR-V2-057). ' +
      'Deriva de `DTask.dados.telemetry.manualTimers[]`. `null` quando a task ' +
      'nunca teve timer manual. Toda a aritmética é server-side (anti-fraude); ' +
      'o cronômetro do frontend é apenas visual e usa `runningStartedAt` como ' +
      'offset.',
    type: () => TaskTimerStateDto,
    nullable: true,
  })
  timer!: TaskTimerStateDto | null;

  @ApiProperty({
    description:
      'Total de tempo manual gasto na task, agregado server-side (soma de ' +
      'durationMs de todas as sessões fechadas em dados.telemetry.manualTimers[], ' +
      'de todos os usuários) e JÁ FORMATADO como rótulo humano ("2h 45min", "45min", ' +
      '"—" quando zero). Fonte da coluna builtin read-only "Tempo gasto" (timeSpent) ' +
      'da grade Blocos — Fase 3 / ADR-V2-057. O frontend NUNCA recalcula: apenas exibe.',
    example: '2h 45min',
  })
  timeSpentLabel!: string;

  @ApiProperty({ description: 'Data de criação ISO 8601' })
  criadoEm!: string;

  @ApiProperty({ description: 'Data de atualização ISO 8601' })
  atualizadoEm!: string;
}

/**
 * DTO de lista paginada de tasks.
 */
export class ListTasksResponseDto {
  @ApiProperty({ type: [TaskResponseDto] })
  items!: TaskResponseDto[];

  @ApiProperty({ description: 'Metadados de paginação' })
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}
