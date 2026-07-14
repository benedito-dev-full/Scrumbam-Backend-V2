import { Injectable, Logger } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { SearchService } from '../../search/search.service';
import { TaskDuplicateDto } from '../../search/dto/task-duplicate.dto';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  invalidParams,
  maxStringLength,
  optionalIso8601,
  optionalRecordField,
  optionalString,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/**
 * Enum de prioridade alinhado ao DTO canonico `CreateTaskDto`
 * (DTabela -421..-424 — LOW/MEDIUM/HIGH/URGENT).
 */
const PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/**
 * Tool MCP `create_task` — wrapper fino sobre `TasksService.create`.
 *
 * Expoe a paridade de campos que o `CreateTaskDto` ja suporta, sem
 * duplicar logica de negocio (Pilar 2): priority/dueDate/idPai/
 * assigneeTeamId sao repassados diretos; `idBloco` e exposto como campo
 * top-level e traduzido internamente para `dados.idBloco` (ADR-V2-065),
 * evitando que o LLM injete chaves arbitrarias em `dados`. Pela mesma
 * filosofia, `fields` (valores de colunas customizaveis da Lista) e exposto
 * como objeto top-level e empacotado em `dados.fields` — mesclado com
 * `idBloco` numa unica chave `dados`. A MCP NAO valida o tipo de cada valor
 * de coluna: o backend (`TasksService`) valida server-side contra o schema
 * da Lista (`DProject.tableFields`).
 *
 * Validacoes (enum, ISO 8601, BigInt-parseabilidade) falham com
 * INVALID_PARAMS limpo ANTES de chegar no service (sem 500).
 *
 * Tenant isolation (ADR-V2-042): valida o acesso ao projeto via
 * `projectsService.findOne(projectId, ctx.dEntidadeId)` antes de criar.
 */
@Injectable()
export class CreateTaskTool implements McpTool {
  private readonly logger = new Logger(CreateTaskTool.name);

  readonly name = 'create_task';
  readonly description =
    'Cria uma task no projeto informado. Campos opcionais: priority (LOW/MEDIUM/HIGH/URGENT), dueDate (ISO 8601), idPai (subtarefa), assigneeTeamId (time), idBloco (vincula a um Bloco via dados.idBloco) e fields (valores das colunas customizaveis da Lista, empacotados em dados.fields). O retorno inclui possibleDuplicates[]: tasks com titulo parecido na mesma Lista (informativo — a task e SEMPRE criada, nunca bloqueia).';
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

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
    private readonly searchService?: SearchService,
  ) {}

  /**
   * Handler do tools/call para `create_task`.
   *
   * Fluxo:
   * 1. Gate de autorização (ADR-V2-068).
   * 2. Valida params (projectId/titulo obrigatorios + limites de string).
   * 3. Extrai e valida campos opcionais (enum priority, ISO 8601 dueDate,
   *    BigInt-parseabilidade de assigneeId/idPai/assigneeTeamId/idBloco).
   * 4. Verifica acesso ao projeto (ADR-V2-042).
   * 5. Monta o DTO espalhando condicionalmente os campos presentes;
   *    `idBloco` e `fields` viram chaves de um UNICO `dados`.
   * 6. Delega para `tasksService.create`.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId`)
   * @returns Envelope MCP com a task criada
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:write` ausente
   * @throws {McpToolError} INVALID_PARAMS quando algum campo viola o schema
   * @throws {NotFoundException} Projeto fora do scope ou inexistente
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_WRITE);

    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    const assigneeId = optionalString(input, 'assigneeId');
    const titulo = requiredString(input, 'titulo');
    const descricao = optionalString(input, 'descricao');

    maxStringLength(titulo, 'titulo', 500);
    if (descricao) {
      maxStringLength(descricao, 'descricao', 5000);
    }

    parseBigIntParam(projectId, 'projectId');
    if (assigneeId) {
      parseBigIntParam(assigneeId, 'assigneeId');
    }

    // Novos campos (paridade com CreateTaskDto).
    const priority = this.extractPriority(input);
    const dueDate = optionalIso8601(input, 'dueDate');
    const idPai = optionalString(input, 'idPai');
    const assigneeTeamId = optionalString(input, 'assigneeTeamId');
    const idBloco = optionalString(input, 'idBloco');
    const fields = optionalRecordField(input, 'fields');

    if (idPai) {
      parseBigIntParam(idPai, 'idPai');
    }
    if (assigneeTeamId) {
      parseBigIntParam(assigneeTeamId, 'assigneeTeamId');
    }
    if (idBloco) {
      parseBigIntParam(idBloco, 'idBloco');
    }

    await this.projectsService.findOne(projectId, ctx.dEntidadeId);

    // Detecção de duplicata (task #799) — buscar ANTES do create evita auto-match
    // (a task recém-criada ainda não existe). SEMPRE informativo: nunca bloqueia.
    const possibleDuplicates = await this.findPossibleDuplicates(titulo, projectId);

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
        source: 'mcp',
      },
      ctx.dEntidadeId,
    );

    // Anexa possibleDuplicates ao envelope só quando o SearchService está
    // disponível (produção). Sem ele (testes que não o injetam) o retorno
    // permanece byte-idêntico ao legado — back-compat preservada.
    return textResult(this.searchService ? { ...(result as object), possibleDuplicates } : result);
  }

  /**
   * Busca possíveis duplicatas do título na mesma Lista (task #799 / DEV-128).
   *
   * Wrapper defensivo sobre {@link SearchService.findPossibleDuplicates}: qualquer
   * falha da busca é engolida (log warn) e retorna `[]` — a detecção é uma
   * cortesia informativa e NUNCA pode impedir a criação da task. Retorna `[]`
   * também quando o `SearchService` não foi injetado.
   *
   * @param titulo - Título proposto da task
   * @param projectId - Lista-alvo (escopo da checagem)
   * @returns Lista de candidatas (vazia em erro/ausência de service)
   */
  private async findPossibleDuplicates(
    titulo: string,
    projectId: string,
  ): Promise<TaskDuplicateDto[]> {
    if (!this.searchService) {
      return [];
    }
    try {
      return await this.searchService.findPossibleDuplicates({
        nome: titulo,
        projectId,
        scope: 'project',
        limit: 5,
      });
    } catch (err) {
      this.logger.warn(
        `create_task dedup check falhou project=${projectId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private extractPriority(input: Record<string, unknown>): string | undefined {
    const value = input.priority;
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || !PRIORITY_VALUES.includes(value as never)) {
      throw invalidParams('priority', `one of [${PRIORITY_VALUES.join('|')}] expected`);
    }
    return value;
  }
}
