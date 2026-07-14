import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../../../projects/projects.service';
import { TasksService } from '../../../../tasks/tasks.service';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/**
 * idClasse fixa de FASE/BLOCO (DTask -200, ADR-V2-047 / ADR-V2-050).
 * A capability sempre cria com esta classe — a IA nao decide.
 */
const ID_CLASSE_BLOCO = '-200';

/**
 * `CreateBlockCapability` — capability neutra `create_block` (Onda 4).
 *
 * Casca FINA sobre `TasksService.create` com `idClasse='-200'` fixo (FASE/
 * BLOCO). MESMA delegacao que o wrapper legado
 * (`src/mcp/tools/create-block.tool.ts`): expoe o minimo de um agrupador
 * (`projectId` + `titulo` obrigatorios; `descricao` + `idPai` opcionais);
 * `idPai` (outra FASE) cria uma sub-fase (ADR-V2-050). A validacao "pai de
 * fase deve ser fase" permanece server-side.
 *
 * Tenant isolation (ADR-V2-042/069): valida o acesso ao projeto via
 * `ProjectsService.findOne(projectId, actorEntidadeId)` ANTES de criar —
 * paridade deliberada com `create_task`. `actorEntidadeId` vem SEMPRE do auth.
 *
 * `requiredScopes: ['tasks:write']` — espelha `requireScope(ctx,
 * MCP_SCOPES.TASKS_WRITE)` (bloco e sub-recurso de task; nao usa
 * `projects:write`). No Nexus, `principal.can('tasks:write')` (RBAC:
 * MEMBER/MANAGER/ADMIN).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 4 (blocks-write)
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-050 (sub-fases via idPai)
 */
@Injectable()
export class CreateBlockCapability implements Capability {
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
  readonly requiredScopes = ['tasks:write'] as const;

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Cria o bloco. Valida shape (obrigatorios, limites, BigInt), confirma o
   * acesso ao projeto e delega com `idClasse='-200'` fixo.
   *
   * @param input - `{ projectId, titulo, descricao?, idPai? }`.
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com o bloco criado (`TaskResponseDto`).
   * @throws {CapabilityError} `INVALID_INPUT` quando um campo viola o schema.
   * @throws {import('@nestjs/common').NotFoundException} Projeto fora do scope.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const projectId = this.requiredString(input, 'projectId');
    const titulo = this.requiredString(input, 'titulo');
    this.maxLength(titulo, 'titulo', 512);

    const descricao = this.optionalString(input, 'descricao');
    if (descricao) {
      this.maxLength(descricao, 'descricao', 10000);
    }
    const idPai = this.optionalString(input, 'idPai');

    this.assertBigIntParseable(projectId, 'projectId');
    if (idPai) {
      this.assertBigIntParseable(idPai, 'idPai');
    }

    await this.projectsService.findOne(projectId, principal.actorEntidadeId);

    const result = await this.tasksService.create(
      {
        projectId,
        nome: titulo,
        idClasse: ID_CLASSE_BLOCO,
        ...(descricao ? { descricao } : {}),
        ...(idPai ? { idPai } : {}),
        source: principal.surface,
      } as never,
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

  private maxLength(value: string, field: string, max: number): void {
    if (value.length > max) {
      throw new CapabilityError('INVALID_INPUT', `${field}: max length ${max} exceeded`, { field });
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
}
