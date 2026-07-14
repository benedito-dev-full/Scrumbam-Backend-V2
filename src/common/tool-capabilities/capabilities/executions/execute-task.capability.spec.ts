import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import toolsSchema from '../../../../mcp/schemas/tools.schema.json';
import { CapabilityError } from '../../capability-error';
import { fromMcp, fromNexus } from '../../tool-principal';
import { ExecuteTaskCapability } from './execute-task.capability';

/**
 * Onda 6 (ADR-V2-079) — `ExecuteTaskCapability`. A tool mais sensivel: dispara
 * `claude -p` na VPS (DPedido -300..-303 via Pilar 1). Cobre:
 *  - metadados (scope executions:create; schema espelha o legado + confirm);
 *  - happy path (delega ao ExecutionsService com shape do legado);
 *  - trava de confirmacao (confirm ausente/false => INVALID_INPUT, service NAO
 *    chamado);
 *  - tenant isolation (cross-tenant task => NotFound; sem membership =>
 *    Forbidden — ambas propagadas);
 *  - Risk Gate (BadRequestException => INVALID_INPUT reason risk_gate_blocked);
 *  - ordem das travas (confirm ANTES de qualquer query).
 *
 * O gate de SCOPE (executions:create) e responsabilidade do ADAPTER (MCP:
 * requireScope; Nexus: principal.can via RBAC) — coberto nos specs de adapter e
 * de ToolRegistry. Aqui provamos que a capability EXIGE o scope no metadado.
 */
describe('ExecuteTaskCapability (Onda 6 — execute_task no Nexus, gated)', () => {
  const taskId = '402';
  const projectId = '100';
  const actorEntidadeId = BigInt(7);

  let tasksService: { findOne: jest.Mock };
  let projectsService: { findOne: jest.Mock };
  let executionsService: { execute: jest.Mock };
  let entidadeService: { getUserGroupIdFromEntidade: jest.Mock };
  let capability: ExecuteTaskCapability;

  beforeEach(() => {
    tasksService = { findOne: jest.fn().mockResolvedValue({ id: taskId, projectId }) };
    projectsService = { findOne: jest.fn().mockResolvedValue({ id: projectId }) };
    executionsService = {
      execute: jest.fn().mockResolvedValue({
        id: '1000123',
        riskLevel: 'LOW',
        approval: { status: 'queued' },
        createdAt: '2026-07-13T10:00:00.000Z',
      }),
    };
    entidadeService = { getUserGroupIdFromEntidade: jest.fn().mockResolvedValue(BigInt(55)) };
    capability = new ExecuteTaskCapability(
      tasksService as never,
      projectsService as never,
      executionsService as never,
      entidadeService as never,
    );
  });

  const nexusPrincipal = () =>
    fromNexus({ actorEntidadeId, grantedScopes: ['executions:create'] });

  it('metadados: nome canonico + scope executions:create (distinto de tasks:write)', () => {
    expect(capability.name).toBe('execute_task');
    expect(capability.requiredScopes).toEqual(['executions:create']);
    // NAO e tasks:write — escrever task nao concede queimar tokens (ADR-V2-067).
    expect(capability.requiredScopes).not.toContain('tasks:write');
  });

  it('MCP wire intacto: schema estatico segue so com taskId; a capability adiciona confirm (so-Nexus)', () => {
    // tools.schema.json (wire MCP) permanece com apenas taskId (golden).
    const wire = toolsSchema.tools.find((t) => t.name === 'execute_task')!;
    expect(Object.keys(wire.inputSchema.properties)).toEqual(['taskId']);
    expect(wire.inputSchema.required).toEqual(['taskId']);

    // A capability (servida SO ao Nexus) exige taskId + confirm.
    const props = capability.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['confirm', 'taskId']);
    expect(capability.inputSchema.required).toEqual(['taskId', 'confirm']);
    expect((props.confirm as { type: string }).type).toBe('boolean');
  });

  it('happy path: confirm=true => tenant + userGroup + delega e retorna shape do legado', async () => {
    const principal = nexusPrincipal();

    const result = await capability.run({ taskId, confirm: true }, principal);

    expect(tasksService.findOne).toHaveBeenCalledWith(taskId);
    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, actorEntidadeId);
    expect(entidadeService.getUserGroupIdFromEntidade).toHaveBeenCalledWith(actorEntidadeId);
    expect(executionsService.execute).toHaveBeenCalledWith(projectId, { taskId }, '55');
    expect(result).toEqual({
      data: {
        executionId: '1000123',
        taskId,
        projectId,
        status: 'queued',
        riskLevel: 'LOW',
        riskClassId: '-301',
        createdAt: '2026-07-13T10:00:00.000Z',
        pollHint: expect.stringContaining('get_task(taskId)'),
      },
    });
  });

  it('risk MEDIUM/HIGH: mapeia riskClassId e propaga status awaiting_approval', async () => {
    executionsService.execute.mockResolvedValue({
      id: '1000124',
      riskLevel: 'HIGH',
      approval: { status: 'awaiting_approval' },
      createdAt: '2026-07-13T10:05:00.000Z',
    });

    const result = (await capability.run({ taskId, confirm: true }, nexusPrincipal())) as {
      data: { status: string; riskLevel: string; riskClassId: string };
    };

    expect(result.data.status).toBe('awaiting_approval');
    expect(result.data.riskLevel).toBe('HIGH');
    expect(result.data.riskClassId).toBe('-303');
  });

  // ─── Adversarial: confirmacao explicita ────────────────────────────────────

  it('(confirm ausente) => INVALID_INPUT e NENHUMA query/execucao disparada', async () => {
    await expect(capability.run({ taskId }, nexusPrincipal())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  it('(confirm=false) => INVALID_INPUT e service NAO chamado (o modelo nao dispara sozinho)', async () => {
    await expect(
      capability.run({ taskId, confirm: false }, nexusPrincipal()),
    ).rejects.toBeInstanceOf(CapabilityError);
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  it('(confirm truthy nao-boolean, ex: "true") => INVALID_INPUT (exige boolean true estrito)', async () => {
    await expect(
      capability.run({ taskId, confirm: 'true' as unknown as boolean }, nexusPrincipal()),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  it('a trava de confirmacao vem ANTES de qualquer query (nem tasksService.findOne roda)', async () => {
    await capability.run({ taskId }, nexusPrincipal()).catch(() => undefined);
    expect(tasksService.findOne).not.toHaveBeenCalled();
    expect(projectsService.findOne).not.toHaveBeenCalled();
    expect(entidadeService.getUserGroupIdFromEntidade).not.toHaveBeenCalled();
  });

  // ─── Adversarial: input invalido ───────────────────────────────────────────

  it('(taskId ausente, confirm=true) => INVALID_INPUT, service NAO chamado', async () => {
    await expect(capability.run({ confirm: true }, nexusPrincipal())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  it('(taskId nao-BigInt) => INVALID_INPUT, service NAO chamado', async () => {
    await expect(
      capability.run({ taskId: 'abc', confirm: true }, nexusPrincipal()),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  // ─── Adversarial: tenant isolation (ADR-V2-042) ────────────────────────────

  it('(cross-tenant taskId) task inexistente/fora do tenant => NotFound propagada, sem execucao', async () => {
    tasksService.findOne.mockRejectedValue(new NotFoundException('task 999 nao encontrada'));

    await expect(
      capability.run({ taskId: '999', confirm: true }, nexusPrincipal()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  it('(sem membership no projeto) => Forbidden propagada, sem execucao', async () => {
    projectsService.findOne.mockRejectedValue(new ForbiddenException('sem acesso ao projeto'));

    await expect(
      capability.run({ taskId, confirm: true }, nexusPrincipal()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(entidadeService.getUserGroupIdFromEntidade).not.toHaveBeenCalled();
    expect(executionsService.execute).not.toHaveBeenCalled();
  });

  it('actorEntidadeId vem SEMPRE do principal (auth), nunca de input da IA', async () => {
    // Um "actorEntidadeId" no input e IGNORADO — o membership usa o do auth.
    await capability.run(
      { taskId, confirm: true, actorEntidadeId: '999999' } as never,
      nexusPrincipal(),
    );
    expect(projectsService.findOne).toHaveBeenCalledWith(projectId, actorEntidadeId);
    expect(entidadeService.getUserGroupIdFromEntidade).toHaveBeenCalledWith(actorEntidadeId);
  });

  // ─── Risk Gate ─────────────────────────────────────────────────────────────

  it('(Risk Gate) BadRequestException do service => INVALID_INPUT reason=risk_gate_blocked', async () => {
    executionsService.execute.mockRejectedValue(new BadRequestException('command bloqueado'));

    await expect(
      capability.run({ taskId, confirm: true }, nexusPrincipal()),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      data: { reason: 'risk_gate_blocked' },
    });
  });

  it('funciona identico via MCP principal (paridade de superficie — mesma logica de dominio)', async () => {
    const principal = fromMcp({ actorEntidadeId, scopes: ['executions:create'] });

    const result = (await capability.run({ taskId, confirm: true }, principal)) as {
      data: { executionId: string };
    };

    expect(result.data.executionId).toBe('1000123');
    expect(executionsService.execute).toHaveBeenCalledWith(projectId, { taskId }, '55');
  });
});
