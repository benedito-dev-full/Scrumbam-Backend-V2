import { Test } from '@nestjs/testing';

import { PrismaService } from '../../prisma.service';
import { MCP_CALL_EVENT_CLASS_ID } from '../constants';
import type { McpUserContext } from '../interfaces/mcp.types';
import { McpAuditService } from './mcp-audit.service';

/**
 * Suíte de audit para o caminho Bearer OAuth (Reforma 2 — F3, DoD "b").
 *
 * Prova que `McpAuditService.record` grava um DEvento -495
 * ({@link MCP_CALL_EVENT_CLASS_ID}) usando os valores SINTÉTICOS do
 * `McpUserContext` produzido pelo `McpBearerService`:
 * - `idEntidade` = `userCtx.dEntidadeId` (bigint sintético, SHA-256(sub));
 * - `metaDados.keyPrefix` = `'oauth'`.
 *
 * A lógica de audit (ADR-V2-008 / DEvento -495) NÃO é alterada por esta fase —
 * apenas se confirma que ela opera corretamente com um userCtx Bearer. Prisma
 * é mockado no padrão do módulo (jest.fn() em `dEvento.create`).
 */
describe('McpAuditService (caminho Bearer OAuth)', () => {
  let service: McpAuditService;
  let create: jest.Mock;

  /**
   * `McpUserContext` idêntico ao que o `McpBearerService` retorna: dEntidadeId
   * sintético, keyChave=0, keyPrefix='oauth', keyHash com prefixo `oauth:`.
   */
  const bearerCtx: McpUserContext = {
    dEntidadeId: BigInt('123456789012345'),
    scopes: ['tasks:read'],
    keyChave: BigInt(0),
    keyPrefix: 'oauth',
    keyHash: `oauth:${'a'.repeat(64)}`,
  };

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({ chave: BigInt(1) });

    const module = await Test.createTestingModule({
      providers: [
        McpAuditService,
        {
          provide: PrismaService,
          useValue: { dEvento: { create } },
        },
      ],
    }).compile();

    service = module.get(McpAuditService);
  });

  it('(b) grava DEvento -495 com idEntidade sintético e keyPrefix="oauth"', async () => {
    await service.record({
      method: 'tools/call',
      params: { name: 'get_task', arguments: { id: '1' } },
      userCtx: bearerCtx,
      httpCode: 200,
      durationMs: 12,
      correlationId: 'corr-oauth-1',
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;

    // Classe canônica -495 (MCP call) — intocada.
    expect(data.idClasse).toBe(MCP_CALL_EVENT_CLASS_ID);
    // OAuth: idEntidade é NULL (o dEntidadeId sintético não é uma DEntidade
    // real — gravá-lo violaria a FK DEvento_idEntidade_fkey, o que derrubava a
    // auditoria no handshake do Claude Web). A identidade sintética é preservada
    // em metaDados.syntheticEntidadeId. (F5.1)
    expect(data.idEntidade).toBeNull();
    expect(data.metaDados.syntheticEntidadeId).toBe(bearerCtx.dEntidadeId.toString());
    // keyPrefix sintético do Bearer propaga para o metaDados do evento.
    expect(data.metaDados.keyPrefix).toBe('oauth');
    expect(data.metaDados.method).toBe('tools/call');
    expect(data.metaDados.httpCode).toBe(200);
    expect(data.identificadorExterno).toBe('corr-oauth-1');
  });

  it('(b) params são hasheados (não vazam plaintext) mesmo no caminho Bearer', async () => {
    await service.record({
      method: 'tools/call',
      params: { name: 'update_task', arguments: { secret: 'sensitive' } },
      userCtx: bearerCtx,
      httpCode: 200,
      durationMs: 5,
      correlationId: 'corr-oauth-2',
    });

    const data = create.mock.calls[0][0].data;
    // paramsHash é um SHA-256 hex; o plaintext dos params NÃO aparece.
    expect(data.metaDados.paramsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data.metaDados)).not.toContain('sensitive');
  });

  it('falha de persistência NÃO propaga (audit é best-effort)', async () => {
    create.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.record({
        method: 'tools/call',
        userCtx: bearerCtx,
        httpCode: 200,
        durationMs: 1,
        correlationId: 'corr-oauth-3',
      }),
    ).resolves.toBeUndefined();
  });
});
