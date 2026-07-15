import { UpdateStatusCapability } from '../../../common/tool-capabilities/capabilities/tasks/update-status.capability';
import { UpdateStatusTool } from '../../../mcp/tools/update-status.tool';
import { MCP_ERROR_CODES, MCP_SCOPES } from '../../../mcp/constants';
import { McpToolError } from '../../../mcp/tools/tool.interface';
import { CapabilityError } from '../../../common/tool-capabilities/capability-error';
import { ProjectsService } from '../../../projects/projects.service';
import { TasksService } from '../../../tasks/tasks.service';
import { ToolPrincipal } from '../../../common/tool-capabilities/tool-principal';
import { McpUserContext } from '../../../mcp/interfaces/mcp.types';
import { validTransitions, isValidState } from '../../tasks-state-machine';
import { REMOVED_V3_STATUS_CODES, V3_STATUS_CODES } from '../task-status.const';

/**
 * Prova de que a CAUSA RAIZ da poda 9 → 5 morreu.
 *
 * O dano nunca foi o seed nem as métricas: foi o **enum do MCP/Capabilities**.
 * Ele anunciava 9 status para o cliente (Claude/Nexus), e a IA escolhia o que
 * "soava certo" — despejando tasks HUMANAS em `VALIDATING`, um estado sem
 * produtor e sem consumidor. Enquanto a superfície de tools aceitar esses
 * códigos, remover o resto é cosmético.
 *
 * Estes testes falhavam ANTES da poda (o enum aceitava os 4 códigos) e passam
 * DEPOIS. Se alguém reintroduzir um status removido em qualquer camada de
 * entrada, eles quebram.
 */
describe('Poda V3 9 → 5 — status removidos não têm mais porta de entrada', () => {
  const removed = [...REMOVED_V3_STATUS_CODES];

  it('o catálogo canônico tem exatamente os 5 status e nenhum removido', () => {
    expect([...V3_STATUS_CODES]).toEqual(['INBOX', 'READY', 'EXECUTING', 'DONE', 'FAILED']);
    for (const code of removed) {
      expect(V3_STATUS_CODES as readonly string[]).not.toContain(code);
    }
  });

  describe('MCP tool update_status (a causa raiz)', () => {
    /**
     * Services mockados de propósito: a rejeição do statusCode inválido acontece
     * ANTES de qualquer I/O. Se a validação regredir, o teste falha por chamar
     * um mock não configurado — nunca por um falso-positivo.
     */
    const tasksService = {
      findOne: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as TasksService;
    const projectsService = { findOne: jest.fn() } as unknown as ProjectsService;

    const tool = new UpdateStatusTool(tasksService, projectsService);
    const ctx: McpUserContext = {
      dEntidadeId: BigInt(1),
      scopes: [MCP_SCOPES.TASKS_WRITE],
    } as McpUserContext;

    afterEach(() => jest.clearAllMocks());

    it.each(removed)('rejeita statusCode=%s com INVALID_PARAMS', async (code) => {
      await expect(tool.handler({ taskId: '1', statusCode: code }, ctx)).rejects.toMatchObject({
        code: MCP_ERROR_CODES.INVALID_PARAMS,
      });
      // Nada de I/O: a task nem chega a ser buscada.
      expect(tasksService.findOne).not.toHaveBeenCalled();
      expect(tasksService.updateStatus).not.toHaveBeenCalled();
    });

    it('rejeita VALIDATING com erro do tipo McpToolError', async () => {
      await expect(
        tool.handler({ taskId: '1', statusCode: 'VALIDATING' }, ctx),
      ).rejects.toBeInstanceOf(McpToolError);
    });

    it('o inputSchema anunciado ao cliente não menciona nenhum status removido', () => {
      const schema = JSON.stringify(tool.inputSchema);
      for (const code of removed) {
        expect(schema).not.toContain(code);
      }
      expect(schema).toContain('INBOX|READY|EXECUTING|DONE|FAILED');
    });
  });

  describe('Capability update_status (superfície Nexus)', () => {
    const tasksService = {
      findOne: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as TasksService;
    const projectsService = { findOne: jest.fn() } as unknown as ProjectsService;

    const capability = new UpdateStatusCapability(tasksService, projectsService);
    const principal = {
      dEntidadeId: BigInt(1),
      scopes: ['tasks:write'],
    } as unknown as ToolPrincipal;

    afterEach(() => jest.clearAllMocks());

    it.each(removed)('rejeita statusCode=%s', async (code) => {
      await expect(
        capability.run({ taskId: '1', statusCode: code }, principal),
      ).rejects.toBeInstanceOf(CapabilityError);
      expect(tasksService.updateStatus).not.toHaveBeenCalled();
    });

    it('o inputSchema da capability não menciona nenhum status removido', () => {
      const schema = JSON.stringify(capability.inputSchema);
      for (const code of removed) {
        expect(schema).not.toContain(code);
      }
    });
  });

  describe('State machine', () => {
    it.each(removed)('%s não é um estado válido', (code) => {
      expect(isValidState(code)).toBe(false);
    });

    it('nenhum estado válido pode transicionar para um status removido', () => {
      for (const destinos of Object.values(validTransitions)) {
        for (const code of removed) {
          expect(destinos as string[]).not.toContain(code);
        }
      }
    });

    it('DONE não é mais terminal — pode voltar para EXECUTING (reabertura)', () => {
      expect(validTransitions.DONE).toContain('EXECUTING');
    });
  });
});
