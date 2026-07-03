import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  maxStringLength,
  optionalString,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

/**
 * idClasse fixa de FASE/BLOCO (DTask -200, ADR-V2-047 / ADR-V2-050).
 * A tool `create_block` sempre cria com esta classe — o LLM nao decide.
 */
const ID_CLASSE_BLOCO = '-200';

/**
 * Tool MCP `create_block` — wrapper fino sobre `TasksService.create` com
 * `idClasse` fixo em `-200` (FASE/BLOCO).
 *
 * Completa o CRUD de blocos no MCP: hoje o servidor le blocos
 * (`list_blocks`, `list_block_tasks`) e sabe vincular tasks a um bloco
 * (`create_task` com `idBloco`), mas nao criava o bloco em si. Esta tool
 * expoe o minimo necessario para um agrupador: `projectId` + `titulo`
 * (obrigatorios), `descricao` + `idPai` (opcionais). `idPai` (outra FASE)
 * cria uma sub-fase (ADR-V2-050).
 *
 * Pilar 2 (reuso): NAO duplica logica de negocio. Delega 100% a
 * `TasksService.create` — a mesma rota de `POST /tasks` e da tool
 * `create_task`. A validacao "pai de fase deve ser fase" e o silenciamento
 * de campos irrelevantes (priority/assignee/taskType) permanecem
 * server-side. Campos mortos para -200 NAO sao expostos (o backend os
 * ignoraria), evitando enganar o agente.
 *
 * Validacoes (BigInt-parseabilidade, maxLength) falham com INVALID_PARAMS
 * limpo ANTES de chegar no service (sem 500).
 *
 * Tenant isolation (ADR-V2-042/069): valida o acesso ao projeto via
 * `projectsService.findOne(projectId, ctx.dEntidadeId)` antes de criar —
 * paridade deliberada com `create_task`.
 */
@Injectable()
export class CreateBlockTool implements McpTool {
  readonly name = 'create_block';
  readonly description =
    'Cria um Bloco/Fase (DTask idClasse=-200) no projeto informado. Use idPai (outra fase) para criar uma sub-fase (ADR-V2-050). Vincule tasks ao bloco depois via create_task(idBloco).';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId', 'titulo'],
    properties: {
      projectId: { type: 'string', description: 'ID do projeto (DProject.chave)' },
      titulo: { type: 'string', maxLength: 512, description: 'Nome do bloco/fase' },
      descricao: { type: 'string', maxLength: 10000, description: 'Descricao opcional' },
      idPai: {
        type: 'string',
        description: 'ID de outra FASE (-200) para criar sub-fase (ADR-V2-050). Opcional.',
      },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Handler do tools/call para `create_block`.
   *
   * Fluxo:
   * 1. Gate de autorização (scope `tasks:write`, ADR-V2-068).
   * 2. Valida params (projectId/titulo obrigatorios + limites de string +
   *    BigInt-parseabilidade de projectId/idPai).
   * 3. Verifica acesso ao projeto (ADR-V2-042/069).
   * 4. Delega para `tasksService.create` com `idClasse='-200'` fixo.
   *
   * @param params - Argumentos da chamada (ver `inputSchema`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId` e `scopes`)
   * @returns Envelope MCP com o bloco criado
   * @throws {McpToolError} FORBIDDEN (-32002) quando scope `tasks:write` ausente
   * @throws {McpToolError} INVALID_PARAMS quando algum campo viola o schema
   * @throws {NotFoundException} Projeto fora do scope ou inexistente
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_WRITE);

    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    const titulo = requiredString(input, 'titulo');
    const descricao = optionalString(input, 'descricao');
    const idPai = optionalString(input, 'idPai');

    maxStringLength(titulo, 'titulo', 512);
    if (descricao) {
      maxStringLength(descricao, 'descricao', 10000);
    }

    parseBigIntParam(projectId, 'projectId');
    if (idPai) {
      parseBigIntParam(idPai, 'idPai');
    }

    await this.projectsService.findOne(projectId, ctx.dEntidadeId);

    const result = await this.tasksService.create(
      {
        projectId,
        nome: titulo,
        idClasse: ID_CLASSE_BLOCO,
        ...(descricao ? { descricao } : {}),
        ...(idPai ? { idPai } : {}),
        source: 'mcp',
      },
      ctx.dEntidadeId,
    );

    return textResult(result);
  }
}
