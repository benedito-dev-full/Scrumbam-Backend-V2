import { Job } from 'bullmq';
import { WebhookDispatchProcessor } from '../processors/webhook-dispatch.processor';
import { WEBHOOK_CLASS_ID } from '../services/webhooks.service';
import { WebhookDispatchJobData, WEBHOOK_USER_AGENT } from '../types/webhook-dispatch-job';

describe('WebhookDispatchProcessor', () => {
  const jobData: WebhookDispatchJobData = {
    webhookId: '200',
    eventType: 'task.created',
    eventId: '300',
    payload: { taskId: '400' },
    deliveryId: 'delivery-1',
    attempt: 1,
  };

  const dados = {
    url: 'https://hooks.example.com/inbound',
    events: ['task.created'],
    secretEncrypted: 'encrypted-secret',
    disabled: false,
    failureCount: 7,
    createdAt: '2026-05-10T12:00:00.000Z',
    lastSuccessAt: null,
    lastFailureAt: null,
  };

  let prisma: {
    dTabela: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    dEvento: { create: jest.Mock };
    dTabela: { update: jest.Mock };
  };
  let signing: { decrypt: jest.Mock; sign: jest.Mock };
  let ssrf: { validateUrl: jest.Mock };
  let retry: { calcDelay: jest.Mock; shouldAutoDisable: jest.Mock };
  let config: { get: jest.Mock };
  let eventProducer: { addInternalEvent: jest.Mock };
  let queue: { add: jest.Mock };
  let processor: WebhookDispatchProcessor;

  beforeEach(() => {
    tx = {
      dEvento: { create: jest.fn().mockResolvedValue({}) },
      dTabela: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      dTabela: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(200),
          dEntidadeId: BigInt(100),
          dados,
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };
    signing = {
      decrypt: jest.fn().mockReturnValue('plain-secret'),
      sign: jest.fn().mockReturnValue('sha256=abcdef'),
    };
    ssrf = { validateUrl: jest.fn().mockResolvedValue(undefined) };
    retry = {
      calcDelay: jest.fn().mockReturnValue(60_000),
      shouldAutoDisable: jest.fn().mockReturnValue(false),
    };
    config = { get: jest.fn().mockReturnValue('10000') };
    eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    queue = { add: jest.fn().mockResolvedValue({}) };
    processor = new WebhookDispatchProcessor(
      prisma as never,
      signing as never,
      ssrf as never,
      retry as never,
      config as never,
      eventProducer as never,
      queue as never,
    );
    jest.spyOn(global, 'fetch').mockResolvedValue({ status: 204 } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('faz POST assinado e audita sucesso em transaction zerando failureCount', async () => {
    await processor.process({ data: jobData } as Job<WebhookDispatchJobData>);

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
    expect(global.fetch).toHaveBeenCalledWith(
      dados.url,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Webhook-Signature': 'sha256=abcdef',
          'X-Webhook-Event': 'task.created',
          'X-Webhook-Delivery': 'delivery-1',
          'User-Agent': WEBHOOK_USER_AGENT,
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.dEvento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idClasse: BigInt(-491),
        idEntidade: BigInt(100),
        descricao: 'webhook.delivery.success',
        metaDados: expect.objectContaining({
          webhookId: '200',
          eventId: '300',
          status: 'success',
          httpCode: 204,
          attempt: 1,
        }),
      }),
    });
    expect(tx.dTabela.update).toHaveBeenCalledWith({
      where: { chave: BigInt(200) },
      data: {
        dados: expect.objectContaining({
          failureCount: 0,
          lastSuccessAt: expect.any(String),
        }),
      },
    });
    expect(queue.add).not.toHaveBeenCalled();
    expect(eventProducer.addInternalEvent).not.toHaveBeenCalled();
  });

  it('audita falha HTTP e re-enfileira attempt 2 sem incrementar failureCount', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ status: 500 } as Response);

    await processor.process({ data: jobData } as Job<WebhookDispatchJobData>);

    expect(tx.dEvento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        descricao: 'webhook.delivery.fail',
        metaDados: expect.objectContaining({
          status: 'fail',
          httpCode: 500,
          errorMessage: 'HTTP 500',
          attempt: 1,
        }),
      }),
    });
    expect(tx.dTabela.update).toHaveBeenCalledWith({
      where: { chave: BigInt(200) },
      data: {
        dados: expect.objectContaining({
          failureCount: 7,
          lastFailureAt: expect.any(String),
        }),
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'dispatch',
      expect.objectContaining({ attempt: 2, deliveryId: 'delivery-1' }),
      expect.objectContaining({ delay: 60_000, attempts: 1 }),
    );
  });

  it('na terceira falha incrementa failureCount uma vez e nao re-enfileira', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ status: 503 } as Response);

    await processor.process({
      data: { ...jobData, attempt: 3 },
    } as Job<WebhookDispatchJobData>);

    expect(tx.dTabela.update).toHaveBeenCalledWith({
      where: { chave: BigInt(200) },
      data: {
        dados: expect.objectContaining({
          failureCount: 8,
          lastFailureAt: expect.any(String),
        }),
      },
    });
    expect(queue.add).not.toHaveBeenCalled();
    expect(eventProducer.addInternalEvent).not.toHaveBeenCalled();
  });

  it('auto-disable na falha final quando threshold e atingido e emite evento apos transaction', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ status: 503 } as Response);
    retry.shouldAutoDisable.mockReturnValue(true);

    await processor.process({
      data: { ...jobData, attempt: 3 },
    } as Job<WebhookDispatchJobData>);

    expect(tx.dTabela.update).toHaveBeenCalledWith({
      where: { chave: BigInt(200) },
      data: {
        dados: expect.objectContaining({
          disabled: true,
          failureCount: 8,
          lastFailureAt: expect.any(String),
        }),
      },
    });
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'webhook.auto_disabled',
      expect.objectContaining({
        webhookId: '200',
        projectId: '100',
        eventId: '300',
        deliveryId: 'delivery-1',
        failureCount: 8,
      }),
      '300',
      { source: 'webhooks.dispatch.processor' },
    );
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      eventProducer.addInternalEvent.mock.invocationCallOrder[0],
    );
  });

  it('descarta webhook desabilitado sem auditar nem chamar HTTP', async () => {
    prisma.dTabela.findFirst.mockResolvedValue({
      chave: BigInt(200),
      dEntidadeId: BigInt(100),
      dados: { ...dados, disabled: true },
    });

    await processor.process({ data: jobData } as Job<WebhookDispatchJobData>);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('audita timeout via AbortController e agenda retry manual', async () => {
    jest.useFakeTimers();
    config.get.mockReturnValue('1');
    jest.spyOn(global, 'fetch').mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const processing = processor.process({ data: jobData } as Job<WebhookDispatchJobData>);
    await jest.advanceTimersByTimeAsync(1);
    await processing;

    expect(tx.dEvento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        descricao: 'webhook.delivery.fail',
        metaDados: expect.objectContaining({
          status: 'fail',
          httpCode: null,
          errorMessage: 'timeout_1ms',
        }),
      }),
    });
    expect(queue.add).toHaveBeenCalledWith(
      'dispatch',
      expect.objectContaining({ attempt: 2 }),
      expect.objectContaining({ delay: 60_000 }),
    );
  });
});
