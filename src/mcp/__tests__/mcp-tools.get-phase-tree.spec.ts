import { NotFoundException } from '@nestjs/common';

import { McpRouterService } from '../services/mcp-router.service';
import { GetPhaseTreeTool } from '../tools/get-phase-tree.tool';

/**
 * Specs para a tool MCP `get_phase_tree` (F7 ADR-V2-047).
 *
 * Cobre:
 * (a) happy path — chama buildTree e serializa via textResult
 * (b) phaseId ausente → INVALID_PARAMS
 * (c) phaseId BigInt invalido → INVALID_PARAMS
 * (d) maxDepth fora de range (0, 21, decimal) → INVALID_PARAMS
 * (e) includeMetrics tipo errado → INVALID_PARAMS
 * (f) tenant gate: findOne lanca NotFoundException → propaga
 * (g) scope vazio → NotFoundException (anti enumeration)
 * (h) defaults: maxDepth undefined, includeMetrics false
 */
describe('MCP get_phase_tree tool', () => {
  const phaseId = '7';
  const projectId = '9007199254740995';
  const userCtx = {
    dEntidadeId: BigInt('9007199254740997'),
    scopes: ['tools:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  let tasksService: { findOne: jest.Mock };
  let projectsService: { findAccessibleProjectIds: jest.Mock };
  let phaseTreeService: { buildTree: jest.Mock };
  let router: McpRouterService;

  const fakeTree = {
    root: {
      id: phaseId,
      nome: 'Fase Raiz',
      idClasse: '-200',
      idPai: null,
      status: null,
      depth: 0,
      children: [],
      metrics: null,
    },
    totalNodes: 1,
    maxDepthReached: 0,
  };

  beforeEach(() => {
    tasksService = {
      findOne: jest.fn().mockResolvedValue({ id: phaseId, projectId }),
    };
    projectsService = {
      findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
    };
    phaseTreeService = {
      buildTree: jest.fn().mockResolvedValue(fakeTree),
    };

    router = new McpRouterService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new GetPhaseTreeTool(
        tasksService as never,
        projectsService as never,
        phaseTreeService as never,
      ),
    );
  });

  it('(a) happy path — chama buildTree com defaults e serializa via textResult', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: { phaseId } },
      userCtx,
    );

    expect(projectsService.findAccessibleProjectIds).toHaveBeenCalledWith(userCtx.dEntidadeId);
    expect(tasksService.findOne).toHaveBeenCalledWith(phaseId, [projectId]);
    expect(phaseTreeService.buildTree).toHaveBeenCalledWith(BigInt(phaseId), {
      maxDepth: undefined,
      includeMetrics: false,
    });

    expect(response.result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(fakeTree) }],
    });
  });

  it('(b) phaseId ausente → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: {} },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'phaseId' }),
      }),
    );
    expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
  });

  it('(c) phaseId BigInt invalido → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: { phaseId: 'not-bigint' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'phaseId' }),
      }),
    );
  });

  it('(d) maxDepth=0 → INVALID_PARAMS (minimo 1)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: { phaseId, maxDepth: 0 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'maxDepth' }),
      }),
    );
  });

  it('(d2) maxDepth=21 → INVALID_PARAMS (max 20)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: { phaseId, maxDepth: 21 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'maxDepth' }),
      }),
    );
  });

  it('(d3) maxDepth decimal → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: { phaseId, maxDepth: 5.5 } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'maxDepth' }),
      }),
    );
  });

  it('(e) includeMetrics tipo errado → INVALID_PARAMS', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: { phaseId, includeMetrics: 'yes' } },
      userCtx,
    );

    expect(response.error).toEqual(
      expect.objectContaining({
        code: -32602,
        data: expect.objectContaining({ field: 'includeMetrics' }),
      }),
    );
  });

  it('(f) tenant gate: findOne lanca NotFoundException → propaga', async () => {
    tasksService.findOne.mockRejectedValueOnce(
      new NotFoundException(`Task ${phaseId} não encontrada`),
    );

    await expect(
      router.dispatch('tools/call', { name: 'get_phase_tree', arguments: { phaseId } }, userCtx),
    ).rejects.toThrow(NotFoundException);

    expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
  });

  it('(g) scope vazio → NotFoundException antes de chamar findOne', async () => {
    projectsService.findAccessibleProjectIds.mockResolvedValueOnce([]);

    await expect(
      router.dispatch('tools/call', { name: 'get_phase_tree', arguments: { phaseId } }, userCtx),
    ).rejects.toThrow(NotFoundException);

    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(phaseTreeService.buildTree).not.toHaveBeenCalled();
  });

  it('(h) maxDepth + includeMetrics propagados corretamente', async () => {
    await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: { phaseId, maxDepth: 5, includeMetrics: true } },
      userCtx,
    );

    expect(phaseTreeService.buildTree).toHaveBeenCalledWith(BigInt(phaseId), {
      maxDepth: 5,
      includeMetrics: true,
    });
  });

  it('serializa BigInt do tree como string (via textResult)', async () => {
    const response = await router.dispatch(
      'tools/call',
      { name: 'get_phase_tree', arguments: { phaseId } },
      userCtx,
    );

    const text = (response.result as { content: { text: string }[] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(typeof parsed.root.id).toBe('string');
    expect(parsed.root.id).toBe(phaseId);
  });
});
