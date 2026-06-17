import { computeGrandfatheredDados } from '../mcp-grandfather-scopes';
import { ALL_MCP_SCOPES } from '../../src/mcp/constants';

const NOW = '2026-06-16T12:00:00.000Z';

describe('computeGrandfatheredDados (ADR-V2-068 Fase 3 — grandfather de scopes)', () => {
  it('migra key com scopes legados (tools:read/tools:call) para o full set, preservando o legado em scopesPreviousValue', () => {
    const dados = {
      prefix: 'scrumban_mcp_a',
      hash: 'abc123',
      scopes: ['tools:read', 'tools:call'],
      disabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
    };

    const result = computeGrandfatheredDados(dados, ALL_MCP_SCOPES, NOW);

    expect(result).not.toBeNull();
    expect(result?.scopes).toEqual([...ALL_MCP_SCOPES]);
    expect(result?.scopesPreviousValue).toEqual(['tools:read', 'tools:call']);
    expect(result?.grandfatheredAt).toBe(NOW);
    // Preserva os demais campos originais
    expect(result?.prefix).toBe('scrumban_mcp_a');
    expect(result?.hash).toBe('abc123');
    expect(result?.disabled).toBe(false);
  });

  it('retorna null (no-op) quando a key já tem exatamente o full set, em qualquer ordem', () => {
    const dadosOrdemOriginal = {
      prefix: 'scrumban_mcp_b',
      scopes: [...ALL_MCP_SCOPES],
    };
    expect(computeGrandfatheredDados(dadosOrdemOriginal, ALL_MCP_SCOPES, NOW)).toBeNull();

    const dadosOrdemInvertida = {
      prefix: 'scrumban_mcp_c',
      scopes: [...ALL_MCP_SCOPES].reverse(),
    };
    expect(computeGrandfatheredDados(dadosOrdemInvertida, ALL_MCP_SCOPES, NOW)).toBeNull();
  });

  it('migra key sem dados.scopes (legado/ausente) para o full set, com scopesPreviousValue = []', () => {
    const dadosSemScopes = {
      prefix: 'scrumban_mcp_d',
      hash: 'def456',
    };

    const result = computeGrandfatheredDados(dadosSemScopes, ALL_MCP_SCOPES, NOW);

    expect(result).not.toBeNull();
    expect(result?.scopes).toEqual([...ALL_MCP_SCOPES]);
    expect(result?.scopesPreviousValue).toEqual([]);
    expect(result?.grandfatheredAt).toBe(NOW);
  });

  it('trata dados null/undefined como objeto vazio e ainda migra para o full set', () => {
    expect(computeGrandfatheredDados(null, ALL_MCP_SCOPES, NOW)).toEqual({
      scopes: [...ALL_MCP_SCOPES],
      scopesPreviousValue: [],
      grandfatheredAt: NOW,
    });

    expect(computeGrandfatheredDados(undefined, ALL_MCP_SCOPES, NOW)).toEqual({
      scopes: [...ALL_MCP_SCOPES],
      scopesPreviousValue: [],
      grandfatheredAt: NOW,
    });
  });

  it('migra key com subconjunto parcial do catálogo (ex: só tasks:read) para o full set', () => {
    const dados = {
      prefix: 'scrumban_mcp_e',
      scopes: ['tasks:read'],
    };

    const result = computeGrandfatheredDados(dados, ALL_MCP_SCOPES, NOW);

    expect(result).not.toBeNull();
    expect(result?.scopes).toEqual([...ALL_MCP_SCOPES]);
    expect(result?.scopesPreviousValue).toEqual(['tasks:read']);
  });
});
