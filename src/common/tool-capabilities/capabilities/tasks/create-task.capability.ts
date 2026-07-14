import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * Enum de prioridade alinhado ao DTO canonico `CreateTaskDto`
 * (DTabela -421..-424 — LOW/MEDIUM/HIGH/URGENT).
 */
const PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/**
 * `CreateTaskCapability` — capability neutra `create_task` (Onda 1, piloto).
 *
 * Casca FINA sobre `TasksService.create` — a MESMA chamada de service que os
 * dois wrappers legados (`src/mcp/tools/create-task.tool.ts` e
 * `src/ai/tools/create-task.tool.ts`) ja fazem. Esta capability NAO reimplementa
 * logica de negocio (Pilar 2 do espirito de tools): valida o shape do input
 * (paridade com `CreateTaskDto`), resolve o `dados` polimorfico (`idBloco` +
 * `fields`) e delega.
 *
 * `inputSchema` e o schema MAIS RICO ja provado no MCP (paridade completa com
 * `CreateTaskDto`: priority/dueDate/idPai/assigneeTeamId/idBloco/fields) — ao
 * ser servido tambem pelo Nexus via {@link NexusCapabilityAdapter}, o chat
 * GANHA os campos que so o MCP tinha (nenhuma perda de capacidade).
 *
 * Tenant isolation (ADR-V2-042): `principal.actorEntidadeId` (SEMPRE do auth,
 * nunca de `input`) e repassado como `creatorId` ao service; o acesso ao
 * projeto e validado via `ProjectsService.findOne` ANTES de criar — mesma
 * defesa em profundidade que as duas cascas legadas ja aplicam.
 *
 * `source` do DTO e derivado de `principal.surface` ('mcp' | 'nexus') —
 * preserva o audit trail que a tool MCP legada ja gravava (`source:'mcp'`).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 1
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class CreateTaskCapability implements Capability {
  readonly name = 'create_task';
  readonly description =
    'Cria uma task no projeto informado. Campos opcionais: priority (LOW/MEDIUM/HIGH/URGENT), dueDate (ISO 8601), idPai (subtarefa), assigneeTeamId (time), idBloco (vincula a um Bloco via dados.idBloco) e fields (valores das colunas customizaveis da Lista, empacotados em dados.fields).';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId', 'titulo'],
    properties: {
      projectId: { type: 'string' },
      titulo: { type: 'string', maxLength: 500 },
      descricao: { type: 'string', maxLength: 5000 },
      assigneeId: { type: 'string' },
      priority: {
        type: 'string',
        enum: [...PRIORITY_VALUES],
        description: 'Prioridade (LOW/MEDIUM/HIGH/URGENT)',
      },
      dueDate: {
        type: 'string',
        description: 'Data limite no formato ISO 8601 (ex: 2026-06-30)',
      },
      idPai: {
        type: 'string',
        description: 'ID da task pai (subtarefa, ADR-V2-047)',
      },
      assigneeTeamId: {
        type: 'string',
        description: 'ID do time responsavel (DEntidade -155)',
      },
      idBloco: {
        type: 'string',
        description: 'ID do Bloco (DTask -200) a vincular via dados.idBloco',
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
   * Executa a criacao da task. Valida o shape do input (lancando
   * `CapabilityError('INVALID_INPUT', ...)` cedo, ANTES de tocar o service),
   * confirma o acesso ao projeto e delega a `TasksService.create`.
   *
   * @param input - Argumentos ja no formato neutro (ver `inputSchema`).
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com a task criada (`TaskResponseDto`).
   * @throws {CapabilityError} `INVALID_INPUT` quando um campo viola o schema.
   * @throws {import('@nestjs/common').NotFoundException} Projeto fora do
   *   scope do ator ou inexistente (propagada tal como as cascas legadas).
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const projectId = this.requiredString(input, 'projectId');
    const titulo = this.requiredString(input, 'titulo');
    this.maxLength(titulo, 'titulo', 500);

    const descricao = this.optionalString(input, 'descricao');
    if (descricao) {
      this.maxLength(descricao, 'descricao', 5000);
    }

    const assigneeId = this.optionalString(input, 'assigneeId');
    const priority = this.extractPriority(input);
    const dueDate = this.optionalIso8601(input, 'dueDate');
    const idPai = this.optionalString(input, 'idPai');
    const assigneeTeamId = this.optionalString(input, 'assigneeTeamId');
    const idBloco = this.optionalString(input, 'idBloco');
    const fields = this.optionalRecord(input, 'fields');

    // BigInt-parseabilidade cedo (mesma disciplina do wrapper MCP legado).
    this.assertBigIntParseable(projectId, 'projectId');
    if (assigneeId) this.assertBigIntParseable(assigneeId, 'assigneeId');
    if (idPai) this.assertBigIntParseable(idPai, 'idPai');
    if (assigneeTeamId) this.assertBigIntParseable(assigneeTeamId, 'assigneeTeamId');
    if (idBloco) this.assertBigIntParseable(idBloco, 'idBloco');

    // ADR-V2-042: confirma o acesso ao projeto ANTES de criar.
    await this.projectsService.findOne(projectId, principal.actorEntidadeId);

    const dados: Record<string, unknown> = {
      ...(idBloco ? { idBloco } : {}),
      ...(fields ? { fields } : {}),
    };

    const result = await this.tasksService.create(
      {
        projectId,
        nome: titulo,
        ...(descricao ? { descricao } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(priority ? { priority } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(idPai ? { idPai } : {}),
        ...(assigneeTeamId ? { assigneeTeamId } : {}),
        ...(Object.keys(dados).length > 0 ? { dados } : {}),
        source: principal.surface,
      },
      principal.actorEntidadeId,
    );

    return { data: result };
  }

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
  }

  private optionalString(input: Record<string, unknown>, field: string): string | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: string expected`, { field });
    }
    return value;
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

  private optionalIso8601(input: Record<string, unknown>, field: string): string | undefined {
    const value = input[field];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
      throw new CapabilityError('INVALID_INPUT', `${field}: ISO 8601 date string expected`, {
        field,
      });
    }
    return value;
  }

  private maxLength(value: string, field: string, max: number): void {
    if (value.length > max) {
      throw new CapabilityError('INVALID_INPUT', `${field}: max length ${max} exceeded`, {
        field,
      });
    }
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

  private extractPriority(input: Record<string, unknown>): string | undefined {
    const value = input.priority;
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || !PRIORITY_VALUES.includes(value as never)) {
      throw new CapabilityError(
        'INVALID_INPUT',
        `priority: one of [${PRIORITY_VALUES.join('|')}] expected`,
        { field: 'priority' },
      );
    }
    return value;
  }
}
