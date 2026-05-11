import { WebhooksService, WEBHOOK_CLASS_ID } from '../services/webhooks.service';

describe('WebhooksService', () => {
  let prisma: {
    dProject: { findFirst: jest.Mock };
    dTabela: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let signing: { generateSecret: jest.Mock; encrypt: jest.Mock };
  let ssrf: { validateUrl: jest.Mock };
  let service: WebhooksService;

  const storedDados = {
    url: 'https://hooks.example.com/a',
    events: ['task.created'],
    secretEncrypted: 'encrypted-secret',
    disabled: false,
    failureCount: 0,
    createdAt: '2026-05-10T12:00:00.000Z',
    lastSuccessAt: null,
    lastFailureAt: null,
  };

  beforeEach(() => {
    prisma = {
      dProject: { findFirst: jest.fn() },
      dTabela: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    signing = {
      generateSecret: jest.fn().mockReturnValue('f'.repeat(64)),
      encrypt: jest.fn().mockReturnValue('encrypted-secret'),
    };
    ssrf = { validateUrl: jest.fn().mockResolvedValue(undefined) };
    service = new WebhooksService(prisma as never, signing as never, ssrf as never);
  });

  it('cria DTabela -470, criptografa secret e retorna plaintext somente no create', async () => {
    prisma.dProject.findFirst.mockResolvedValue({ chave: BigInt(100) });
    prisma.dTabela.create.mockResolvedValue({
      chave: BigInt(200),
      dEntidadeId: BigInt(100),
      nome: storedDados.url,
      dados: storedDados,
      criadoEm: new Date(storedDados.createdAt),
    });

    const result = await service.create({
      projectId: '100',
      url: storedDados.url,
      events: ['task.created'],
    });

    expect(ssrf.validateUrl).toHaveBeenCalledWith(storedDados.url);
    expect(prisma.dTabela.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idClasse: WEBHOOK_CLASS_ID,
          dEntidadeId: BigInt(100),
          nome: storedDados.url,
          dados: expect.objectContaining({
            secretEncrypted: 'encrypted-secret',
          }),
        }),
      }),
    );
    expect(result.secret).toBe('f'.repeat(64));
    expect(JSON.stringify(result)).not.toContain('encrypted-secret');
  });

  it('lista respostas sem secret plaintext nem secretEncrypted', async () => {
    prisma.dTabela.findMany.mockResolvedValue([
      {
        chave: BigInt(200),
        dEntidadeId: BigInt(100),
        nome: storedDados.url,
        dados: storedDados,
        criadoEm: new Date(storedDados.createdAt),
      },
    ]);

    const result = await service.list({ projectId: '100', limit: 20 });

    expect(result.items).toEqual([
      {
        id: '200',
        projectId: '100',
        url: storedDados.url,
        events: ['task.created'],
        disabled: false,
        failureCount: 0,
        createdAt: storedDados.createdAt,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secretEncrypted');
    expect(JSON.stringify(result)).not.toContain('encrypted-secret');
  });

  it('atualiza url/eventos preservando secretEncrypted e rodando SSRF', async () => {
    prisma.dTabela.findFirst.mockResolvedValue({
      chave: BigInt(200),
      dEntidadeId: BigInt(100),
      nome: storedDados.url,
      dados: storedDados,
      criadoEm: new Date(storedDados.createdAt),
    });
    prisma.dTabela.update.mockResolvedValue({
      chave: BigInt(200),
      dEntidadeId: BigInt(100),
      nome: 'https://hooks.example.com/b',
      dados: {
        ...storedDados,
        url: 'https://hooks.example.com/b',
        events: ['task.status_changed'],
      },
      criadoEm: new Date(storedDados.createdAt),
    });

    const result = await service.update('200', {
      url: 'https://hooks.example.com/b',
      events: ['task.status_changed'],
    });

    expect(ssrf.validateUrl).toHaveBeenCalledWith('https://hooks.example.com/b');
    expect(prisma.dTabela.update.mock.calls[0][0].data.dados.secretEncrypted).toBe(
      'encrypted-secret',
    );
    expect(result).not.toHaveProperty('secret');
    expect(JSON.stringify(result)).not.toContain('encrypted-secret');
  });

  it('soft-delete marca excluido e inativo', async () => {
    prisma.dTabela.findFirst.mockResolvedValue({
      chave: BigInt(200),
      dEntidadeId: BigInt(100),
      nome: storedDados.url,
      dados: storedDados,
      criadoEm: new Date(storedDados.createdAt),
    });
    prisma.dTabela.update.mockResolvedValue({});

    await service.delete('200');

    expect(prisma.dTabela.update).toHaveBeenCalledWith({
      where: { chave: BigInt(200) },
      data: { excluido: true, inativo: true },
    });
  });
});

