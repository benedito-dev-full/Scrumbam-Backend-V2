import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import { WebhooksSsrfService } from '../services/webhooks-ssrf.service';

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}));

describe('WebhooksSsrfService', () => {
  const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it('bloqueia protocolos fora de http/https', async () => {
    const service = new WebhooksSsrfService({ get: jest.fn() } as unknown as ConfigService);

    await expect(service.validateUrl('file:///etc/passwd')).rejects.toThrow(
      'URL deve usar protocolo http ou https',
    );
  });

  it('bloqueia loopback e localhost', async () => {
    const service = new WebhooksSsrfService({ get: jest.fn() } as unknown as ConfigService);

    await expect(service.validateUrl('http://127.0.0.1/hook')).rejects.toThrow(
      'URL aponta para rede privada ou local',
    );
    await expect(service.validateUrl('http://localhost/hook')).rejects.toThrow(
      'URL aponta para host bloqueado',
    );
  });

  it('bloqueia RFC1918 e link-local resolvidos via DNS', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '10.0.0.5', family: 4 },
    ] as never);
    const service = new WebhooksSsrfService({ get: jest.fn() } as unknown as ConfigService);

    await expect(service.validateUrl('https://internal.example.com/hook')).rejects.toThrow(
      'URL aponta para rede privada ou local',
    );
  });

  it('WEBHOOKS_ALLOW_PRIVATE permite privado, mas nao metadata cloud', async () => {
    const service = new WebhooksSsrfService({
      get: jest.fn().mockReturnValue('true'),
    } as unknown as ConfigService);

    await expect(service.validateUrl('http://192.168.1.2/hook')).resolves.toBeUndefined();
    await expect(service.validateUrl('http://169.254.169.254/latest')).rejects.toThrow(
      'URL aponta para metadata cloud bloqueada',
    );
  });

  it('permite endereco publico resolvido', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    const service = new WebhooksSsrfService({ get: jest.fn() } as unknown as ConfigService);

    await expect(service.validateUrl('https://example.com/hook')).resolves.toBeUndefined();
  });
});

