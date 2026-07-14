import { Capability } from '../../common/tool-capabilities/capability.interface';
import { CapabilityError } from '../../common/tool-capabilities/capability-error';
import { CapabilityRegistry } from '../../common/tool-capabilities/capability-registry';
import { NexusCapabilityAdapter, NexusScopeResolver } from './nexus-capability.adapter';
import { AiToolContext } from './tool-context';

/**
 * Onda 0.3 — `NexusCapabilityAdapter` (esqueleto, NAO plugado no ToolRegistry).
 *
 * Cobre o DoD: registry vazio -> lista vazia; 1 capability fake -> 1
 * AiToolDefinition bem-formado; execute repassa data; gate de scope via RBAC
 * (default nega); traducao de CapabilityError -> Error humanizado.
 */
const ctx: AiToolContext = {
  userEntidadeId: BigInt(3),
  organizationId: '99',
};

function capabilityWith(overrides: Partial<Capability> = {}): Capability {
  return {
    name: 'create_task',
    description: 'Cria uma task',
    inputSchema: { type: 'object', properties: { titulo: { type: 'string' } } },
    requiredScopes: ['tasks:write'],
    run: jest.fn().mockResolvedValue({ data: { id: '1', status: 'INBOX' } }),
    ...overrides,
  };
}

/** Resolver que concede um conjunto fixo de scopes (simula RBAC resolvido). */
const grant = (scopes: string[]): NexusScopeResolver => async () => scopes;

describe('NexusCapabilityAdapter (Onda 0.3 — esqueleto)', () => {
  it('registry vazio => buildAll() retorna lista vazia (adapter nao plugado)', () => {
    const adapter = new NexusCapabilityAdapter(new CapabilityRegistry());
    expect(adapter.buildAll(ctx, grant([]))).toEqual([]);
  });

  it('registry com 1 capability => 1 AiToolDefinition bem-formado', () => {
    const registry = new CapabilityRegistry();
    const cap = capabilityWith();
    registry.register(cap);
    const adapter = new NexusCapabilityAdapter(registry);

    const tools = adapter.buildAll(ctx, grant(['tasks:write']));
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('create_task');
    expect(tools[0].description).toBe('Cria uma task');
    expect(tools[0].parameters).toBe(cap.inputSchema);
    expect(typeof tools[0].execute).toBe('function');
  });

  it('execute repassa CapabilityResult.data como unknown (sem envelope)', async () => {
    const cap = capabilityWith();
    const adapter = new NexusCapabilityAdapter(new CapabilityRegistry());
    const def = adapter.toAiToolDefinition(cap, ctx, grant(['tasks:write']));

    const out = await def.execute({ titulo: 'X' });
    expect(out).toEqual({ id: '1', status: 'INBOX' });

    // Principal Nexus: surface nexus, actor do JWT, org convertida p/ bigint.
    const [, principal] = (cap.run as jest.Mock).mock.calls[0];
    expect(principal.surface).toBe('nexus');
    expect(principal.actorEntidadeId).toBe(ctx.userEntidadeId);
    expect(principal.organizationId).toBe(BigInt(99));
  });

  it('gate de scope RBAC: default NEGA quando o user nao tem o scope', async () => {
    const cap = capabilityWith();
    const adapter = new NexusCapabilityAdapter(new CapabilityRegistry());
    const def = adapter.toAiToolDefinition(cap, ctx, grant(['tasks:read'])); // sem tasks:write

    await expect(def.execute({ titulo: 'X' })).rejects.toThrow(/Permissao negada/);
    expect(cap.run).not.toHaveBeenCalled();
  });

  it('traduz CapabilityError => Error humanizado devolvido ao modelo', async () => {
    const cap = capabilityWith({
      run: jest.fn().mockRejectedValue(new CapabilityError('NOT_FOUND', 'Task nao encontrada')),
    });
    const adapter = new NexusCapabilityAdapter(new CapabilityRegistry());
    const def = adapter.toAiToolDefinition(cap, ctx, grant(['tasks:write']));

    const err = (await def.execute({ titulo: 'X' }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CapabilityError);
    expect(err.message).toBe('Task nao encontrada');
  });
});
