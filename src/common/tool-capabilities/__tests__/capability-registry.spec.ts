import { Capability } from '../capability.interface';
import { CapabilityRegistry } from '../capability-registry';

/**
 * Onda 0.2 — `CapabilityRegistry` vazio funciona; registro/lookup/duplicata.
 */
function fakeCapability(name: string): Capability {
  return {
    name,
    description: `fake ${name}`,
    inputSchema: { type: 'object', properties: {} },
    requiredScopes: [],
    run: async () => ({ data: { ok: true } }),
  };
}

describe('CapabilityRegistry (camada neutra)', () => {
  it('nasce vazio (Onda 0 — nenhuma capability plugada)', () => {
    const registry = new CapabilityRegistry();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
    expect(registry.names()).toEqual([]);
    expect(registry.get('create_task')).toBeUndefined();
    expect(registry.has('create_task')).toBe(false);
  });

  it('register + get + has + list + names', () => {
    const registry = new CapabilityRegistry();
    const cap = fakeCapability('create_task');
    registry.register(cap);

    expect(registry.size).toBe(1);
    expect(registry.has('create_task')).toBe(true);
    expect(registry.get('create_task')).toBe(cap);
    expect(registry.names()).toEqual(['create_task']);
    expect(registry.list()).toEqual([cap]);
  });

  it('preserva ordem de insercao em list()/names()', () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeCapability('a'));
    registry.register(fakeCapability('b'));
    registry.register(fakeCapability('c'));
    expect(registry.names()).toEqual(['a', 'b', 'c']);
  });

  it('rejeita capability duplicada (falha cedo — bug de wiring)', () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeCapability('create_task'));
    expect(() => registry.register(fakeCapability('create_task'))).toThrow(
      /Capability duplicada/,
    );
  });
});
