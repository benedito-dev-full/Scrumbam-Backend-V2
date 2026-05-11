import { WebhooksRedriveService } from '../services/webhooks-redrive.service';
import { WEBHOOK_CLASS_ID } from '../services/webhooks.service';

describe('WebhooksRedriveService', () => {
  const dados = {
    url: 'https://hooks.example.com/inbound',
    events: ['task.created'],
    secretEncrypted: 'encrypted-secret',
    disabled: true,
    failureCount: 10,
    createdAt: '2026-05-10T12:00:00.000Z',
    lastSuccessAt: null,
    lastFailureAt: '2026-05-10T12:01:00.000Z',
  };

  let prisma: {
    dTabela: { findFirst: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let tx: {
    dTabela: { findFirst: jest.Mock; update: jest.Mock };
  };
  let signing: { decrypt: jest.Mock; sign: jest.Mock };
  let ssrf: { validateUrl: jest.Mock };
  let config: { get: jest.Mock };
  let service: WebhooksRedriveService;

  beforeEach(() => {
    prisma = {
      dTabela: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(200),
          dEntidadeId: BigInt(100),
          dados,
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      $queryRaw: jest.fn(),
    };
    tx = {
      dTabela: {
        findFirst: jest.fn().mockResolvedValue({ chave: BigInt(200), dados }),
        update: jest.fn().mockResolvedValue({
          chave: BigInt(200),
          dados: { ...dados, disabled: false, failureCount: 0 },
        }),
      },
    };
    signing = {
      decrypt: jest.fn().mockReturnValue('plain-secret'),
      sign: jest.fn().mockReturnValue('sha256=abcdef'),
    };
    ssrf = { validateUrl: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn().mockReturnValue('10000') };
    service = new WebhooksRedriveService(
      prisma as never,
      signing as never,
      ssrf as never,
      config as never,
    );
    jest.spyOn(global, 'fetch').mockResolvedValue({ status: 204 } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('test faz entrega sincrona assinada sem transaction nem DEvento', async () => {
    const result = await service.test('200', {
      eventType: 'task.created',
      payload: { smoke: true },
    });

    expect(prisma.dTabela.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chave: BigInt(200),
          idClasse: WEBHOOK_CLASS_ID,
        }),
      }),
    );
    expect(ssrf.validateUrl).toHaveBeenCalledWith(dados.url);
    expect(signing.decrypt).toHaveBeenCalledWith('encrypted-secret');
    expect(signing.sign).toHaveBeenCalledWith('plain-secret', expect.any(String));
    expect(global.fetch).toHaveBeenCalledWith(
      dados.url,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Webhook-Signature': 'sha256=abcdef',
          'X-Webhook-Event': 'task.created',
        }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        eventType: 'task.created',
        success: true,
        httpCode: 204,
      }),
    );
  });

  it('redrive reabilita e zera failureCount em transaction', async () => {
    const result = await service.redrive('200');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.dTabela.update).toHaveBeenCalledWith({
      where: { chave: BigInt(200) },
      data: {
        dados: expect.objectContaining({
          disabled: false,
          failureCount: 0,
        }),
      },
      select: { chave: true, dados: true },
    });
    expect(result).toEqual({ id: '200', disabled: false, failureCount: 0 });
  });

  it('lista attempts por metaDados.webhookId com cursor pagination sem N+1', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        chave: BigInt(500),
        idClasse: BigInt(-491),
        idEntidade: BigInt(100),
        identificadorExterno: 'delivery-1:3',
        descricao: 'webhook.delivery.fail',
        metaDados: { webhookId: '200', status: 'fail', attempt: 3 },
        criadoEm: new Date('2026-05-10T12:02:00.000Z'),
      },
      {
        chave: BigInt(499),
        idClasse: BigInt(-491),
        idEntidade: BigInt(100),
        identificadorExterno: 'delivery-1:2',
        descricao: 'webhook.delivery.fail',
        metaDados: { webhookId: '200', status: 'fail', attempt: 2 },
        criadoEm: new Date('2026-05-10T12:01:00.000Z'),
      },
    ]);

    const result = await service.listAttempts('200', { limit: 1, cursor: '600' });

    expect(prisma.dTabela.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: '500',
          idClasse: '-491',
          projectId: '100',
          metaDados: { webhookId: '200', status: 'fail', attempt: 3 },
        }),
      ],
      pagination: { hasMore: true, nextCursor: '500' },
    });
  });
});
