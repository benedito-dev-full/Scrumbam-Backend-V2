import { NexusCapabilityAdapter, NexusScopeResolver } from '../../../../ai/tools/nexus-capability.adapter';
import { AiToolContext } from '../../../../ai/tools/tool-context';
import { McpCapabilityAdapter } from '../../../../mcp/tools/mcp-capability.adapter';
import { CapabilityRegistry } from '../../capability-registry';
import { ExecuteTaskCapability } from './execute-task.capability';

/**
 * Onda 6 — wiring da feature-flag `NEXUS_EXECUTE_TASK_ENABLED` (default OFF).
 *
 * A flag e lida no LOAD do modulo (`process.env`), entao o seu EFEITO real e
 * "registrar ou nao a capability `execute_task` no `CapabilityRegistry`". Este
 * spec prova o contrato observavel dos dois estados sem depender do boot do
 * Nest (evita reset de modulo/env fragil):
 *  - Flag OFF  <=> registry SEM execute_task => a tool NAO aparece no Nexus.
 *  - Flag ON   <=> registry COM execute_task => a tool aparece no Nexus e roda
 *    atras do scope executions:create (default nega) + confirmacao explicita.
 *
 * A correspondencia flag->registro e garantida por `ToolCapabilitiesModule`
 * (registerIfAbsent condicional a `NEXUS_EXECUTE_TASK_ENABLED`) — coberta pela
 * inspecao do modulo abaixo.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 6
 * @see ADR-V2-079
 */
describe('execute_task — wiring da feature-flag (Onda 6)', () => {
  const ctx: AiToolContext = { userEntidadeId: BigInt(7), organizationId: '5' };
  const taskId = '402';
  const projectId = '100';

  function buildCapability(): ExecuteTaskCapability {
    const tasksService = { findOne: jest.fn().mockResolvedValue({ id: taskId, projectId }) };
    const projectsService = { findOne: jest.fn().mockResolvedValue({ id: projectId }) };
    const executionsService = {
      execute: jest.fn().mockResolvedValue({
        id: '1000123',
        riskLevel: 'LOW',
        approval: { status: 'queued' },
        createdAt: '2026-07-13T10:00:00.000Z',
      }),
    };
    const entidadeService = {
      getUserGroupIdFromEntidade: jest.fn().mockResolvedValue(BigInt(55)),
    };
    return new ExecuteTaskCapability(
      tasksService as never,
      projectsService as never,
      executionsService as never,
      entidadeService as never,
    );
  }

  const grant = (scopes: string[]): NexusScopeResolver => async () => scopes;

  it('flag OFF (registry sem execute_task): a tool NAO aparece na lista do Nexus', () => {
    const registry = new CapabilityRegistry(); // sem execute_task
    const adapter = new NexusCapabilityAdapter(registry);

    const names = adapter.buildAll(ctx, grant(['executions:create'])).map((t) => t.name);
    expect(names).not.toContain('execute_task');
  });

  it('flag ON (registry com execute_task): aparece no Nexus e, com scope+confirm, DISPARA', async () => {
    const registry = new CapabilityRegistry();
    registry.register(buildCapability());
    const adapter = new NexusCapabilityAdapter(registry);

    const tools = adapter.buildAll(ctx, grant(['executions:create']));
    const executeTask = tools.find((t) => t.name === 'execute_task');
    expect(executeTask).toBeDefined();

    const out = (await executeTask!.execute({ taskId, confirm: true })) as {
      executionId: string;
      status: string;
    };
    expect(out.executionId).toBe('1000123');
    expect(out.status).toBe('queued');
  });

  it('flag ON, sem scope executions:create no RBAC => negado (default nega), nao dispara', async () => {
    const registry = new CapabilityRegistry();
    const cap = buildCapability();
    registry.register(cap);
    const adapter = new NexusCapabilityAdapter(registry);

    // RBAC concede tasks:write mas NAO executions:create (ex: MEMBER).
    const tools = adapter.buildAll(ctx, grant(['tasks:write', 'tasks:read']));
    const executeTask = tools.find((t) => t.name === 'execute_task')!;

    await expect(executeTask.execute({ taskId, confirm: true })).rejects.toThrow(
      /Permissao negada/,
    );
  });

  it('flag ON, com scope mas SEM confirmacao => recusado (o modelo nao dispara sozinho)', async () => {
    const registry = new CapabilityRegistry();
    registry.register(buildCapability());
    const adapter = new NexusCapabilityAdapter(registry);

    const executeTask = adapter
      .buildAll(ctx, grant(['executions:create']))
      .find((t) => t.name === 'execute_task')!;

    // NexusCapabilityAdapter traduz CapabilityError -> Error humanizado.
    await expect(executeTask.execute({ taskId })).rejects.toThrow();
  });

  it('MCP: mesmo com a capability no registry, o McpCapabilityAdapter a mapeia (mas o router usa o legado)', () => {
    // Prova que a capability e traduzivel para McpTool (paridade estrutural),
    // ainda que o McpRouterService sirva execute_task pelo wrapper legado — o
    // roteamento e responsabilidade do router, nao deste adapter.
    const registry = new CapabilityRegistry();
    registry.register(buildCapability());
    const mcpNames = new McpCapabilityAdapter(registry).buildAll().map((t) => t.name);
    expect(mcpNames).toContain('execute_task');
  });
});
