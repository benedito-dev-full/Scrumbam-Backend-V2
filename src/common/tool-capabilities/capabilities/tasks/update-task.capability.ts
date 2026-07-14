import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** V3 status codes — espelha `V3_STATUS_CODES` de `mcp/tools/tool-params`. */
const V3_STATUS_CODES = [
  'INBOX',
  'READY',
  'EXECUTING',
  'DONE',
  'FAILED',
  'CANCELLED',
  'DISCARDED',
  'VALIDATING',
  'VALIDATED',
] as const;

/** Enum de prioridade alinhado ao DTO canonico `UpdateTaskDto`. */
const PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/**
 * `UpdateTaskCapability` — capability neutra `update_task` (Onda 4, writes so-MCP).
 *
 * Casca FINA que reproduz a orquestracao condicional do wrapper legado
 * (`src/mcp/tools/update-task.tool.ts`): UMA tool com todos os campos
 * opcionais (exceto `taskId`), roteando internamente para:
 *  - `TasksService.update` — campos basicos (`name`/`description`/`priority`/
 *    `assigneeId`/`dueDate`/`idPai`/`idBloco`/`fields`); `idBloco`+`fields`
 *    empacotados numa UNICA chave `dados` (ADR-V2-065).
 *  - `TasksService.updateStatus` — status V3 (state machine + telemetria).
 *
 * Ordem quando multiplos campos: update -> updateStatus. O estado FINAL e
 * re-hidratado via `TasksService.findOne` para uma snapshot consistente —
 * MESMA sequencia que a tool legada.
 *
 * Tenant isolation (ADR-V2-042): resolve `accessibleProjectIds` UMA vez via
 * `ProjectsService.findAccessibleProjectIds(principal.actorEntidadeId)` e o
 * propaga a cada call — cada metodo do service valida que `task.idProject`
 * esta no scope autorizado (anti enumeration). `actorEntidadeId` vem SEMPRE do
 * auth (nunca de input da IA).
 *
 * `requiredScopes: ['tasks:write']` — espelha 1:1 o `requireScope(ctx,
 * MCP_SCOPES.TASKS_WRITE)` da tool legada. No Nexus o gate roda no
 * `NexusCapabilityAdapter` via `principal.can('tasks:write')` (RBAC:
 * concedido a MEMBER/MANAGER/ADMIN — `RoleResolverService.getAllowedMcpScopes`).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (tasks-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class UpdateTaskCapability implements Capability {
  readonly name = 'update_task';
  readonly description =
    'Atualiza qualquer combinacao de campos de uma task (name, description, priority, assigneeId, status, dueDate, idPai, idBloco, fields). Para dueDate/idPai/idBloco: ausente=nao toca, null=remove, string=define. fields (valores das colunas customizaveis da Lista): presente=merge, ausente=nao toca, null DENTRO de fields limpa a coluna. Use update_status se for atualizar APENAS o status.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId'],
    properties: {
      taskId: { type: 'string' },
      name: { type: 'string', maxLength: 512 },
      description: { type: 'string', maxLength: 10000 },
      priority: {
        type: 'string',
        enum: [...PRIORITY_VALUES],
        description: 'Prioridade (LOW/MEDIUM/HIGH/URGENT)',
      },
      assigneeId: {
        type: ['string', 'null'],
        description: 'ID do assignee (DEntidade) ou null para remover',
      },
      status: {
        type: 'string',
        enum: [...V3_STATUS_CODES],
        description:
          'Codigo V3: INBOX|READY|EXECUTING|DONE|FAILED|CANCELLED|DISCARDED|VALIDATING|VALIDATED',
      },
      dueDate: {
        type: ['string', 'null'],
        description: 'Data limite ISO 8601; null remove; ausente nao toca',
      },
      idPai: {
        type: ['string', 'null'],
        description:
          'string=novo pai (subtarefa, ADR-V2-047); null=move para raiz; ausente=nao toca',
      },
      idBloco: {
        type: ['string', 'null'],
        description:
          'string=vincula ao Bloco (DTask -200); null=desvincula; ausente=nao toca (via dados.idBloco)',
      },
      fields: {
        type: 'object',
        additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
        description:
          'Valores das colunas customizaveis da Lista, chaveados por ColumnDef.key (ex: f_a1b2). Valores: string|number|boolean|null (null limpa o valor). Validados server-side contra o schema da Lista (DProject.tableFields).',
      },
    },
  };
  readonly requiredScopes = ['tasks:write'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Executa a atualizacao parcial. Valida o shape do input (INVALID_INPUT
   * cedo), exige >=1 campo de update, resolve o scope de tenant e roteia para
   * update (basicos) -> updateStatus, re-hidratando o estado final.
   *
   * @param input - Argumentos no formato neutro (ver `inputSchema`).
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com a snapshot final da task (`TaskResponseDto`).
   * @throws {CapabilityError} `INVALID_INPUT` quando um campo viola o schema
   *   ou quando nenhum campo de update e fornecido.
   * @throws {import('@nestjs/common').NotFoundException} Task fora do scope.
   * @throws {import('@nestjs/common').BadRequestException} Transicao de status invalida.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const taskId = this.requiredString(input, 'taskId');
    this.assertBigIntParseable(taskId, 'taskId');

    const name = this.optionalString(input, 'name', 512);
    const description = this.optionalString(input, 'description', 10000);
    const priority = this.optionalEnum(input, 'priority', PRIORITY_VALUES);
    const assigneeId = this.optionalStringOrNull(input, 'assigneeId');
    const status = this.optionalEnum(input, 'status', V3_STATUS_CODES);
    const dueDate = this.optionalStringOrNull(input, 'dueDate', { iso8601: true });
    const idPai = this.optionalStringOrNull(input, 'idPai', { bigint: true });
    const idBloco = this.optionalStringOrNull(input, 'idBloco', { bigint: true });
    const fields = this.optionalRecord(input, 'fields');

    const hasBasicUpdate =
      name !== undefined ||
      description !== undefined ||
      priority !== undefined ||
      assigneeId !== undefined ||
      dueDate !== undefined ||
      idPai !== undefined ||
      idBloco !== undefined ||
      fields !== undefined;
    const hasStatusUpdate = status !== undefined;

    if (!hasBasicUpdate && !hasStatusUpdate) {
      throw new CapabilityError('INVALID_INPUT', 'at least one field to update is required', {
        field: 'arguments',
      });
    }

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      principal.actorEntidadeId,
    );

    if (hasBasicUpdate) {
      // assigneeId === null e codificado como '' (string vazia), que o
      // TasksService.update interpreta como "limpar" (idAssignee = null).
      // idBloco/fields sao empacotados numa UNICA chave `dados` (dois spreads
      // separados se sobrescreveriam).
      const dados: Record<string, unknown> = {
        ...(idBloco !== undefined ? { idBloco } : {}),
        ...(fields !== undefined ? { fields } : {}),
      };
      const basicDto: Record<string, unknown> = {
        ...(name !== undefined ? { nome: name } : {}),
        ...(description !== undefined ? { descricao: description } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId ?? '' } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(idPai !== undefined ? { idPai } : {}),
        ...(Object.keys(dados).length > 0 ? { dados } : {}),
      };
      await this.tasksService.update(taskId, basicDto as never, accessibleProjectIds);
    }

    if (hasStatusUpdate) {
      await this.tasksService.updateStatus(
        taskId,
        { status: status as string, movedBy: principal.actorEntidadeId.toString() },
        principal.actorEntidadeId,
        accessibleProjectIds,
      );
    }

    const finalTask = await this.tasksService.findOne(taskId, accessibleProjectIds);
    return { data: finalTask };
  }

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
  }

  private optionalString(
    input: Record<string, unknown>,
    field: string,
    maxLength?: number,
  ): string | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new CapabilityError('INVALID_INPUT', `${field}: string expected`, { field });
    }
    if (maxLength !== undefined && value.length > maxLength) {
      throw new CapabilityError('INVALID_INPUT', `${field}: max length ${maxLength} exceeded`, {
        field,
      });
    }
    return value;
  }

  /**
   * Extrai um campo com semantica ternaria (ausente=nao toca, null=remove,
   * string=define), com validacao adicional opcional (iso8601/bigint).
   */
  private optionalStringOrNull(
    input: Record<string, unknown>,
    field: string,
    opts?: { iso8601?: boolean; bigint?: boolean },
  ): string | null | undefined {
    if (!(field in input)) {
      return undefined;
    }
    const value = input[field];
    if (value === null) {
      return null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: string or null expected`, { field });
    }
    if (opts?.iso8601 && Number.isNaN(Date.parse(value))) {
      throw new CapabilityError('INVALID_INPUT', `${field}: ISO 8601 date string expected`, {
        field,
      });
    }
    if (opts?.bigint) {
      this.assertBigIntParseable(value, field);
    }
    return value;
  }

  private optionalEnum<T extends string>(
    input: Record<string, unknown>,
    field: string,
    allowed: readonly T[],
  ): T | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw new CapabilityError('INVALID_INPUT', `${field}: one of [${allowed.join('|')}] expected`, {
        field,
      });
    }
    return value as T;
  }

  private optionalRecord(
    input: Record<string, unknown>,
    field: string,
  ): Record<string, unknown> | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new CapabilityError('INVALID_INPUT', `${field}: object expected`, { field });
    }
    return value as Record<string, unknown>;
  }

  private assertBigIntParseable(value: string, field: string): void {
    try {
      BigInt(value);
    } catch {
      throw new CapabilityError('INVALID_INPUT', `${field}: valid bigint string expected`, {
        field,
      });
    }
  }
}
