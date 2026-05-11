import { SensitiveDataSanitizerService } from './sensitive-data-sanitizer.service';

describe('SensitiveDataSanitizerService', () => {
  it('redige segredos em objetos aninhados sem alterar campos seguros', () => {
    const service = new SensitiveDataSanitizerService();

    const result = service.sanitizeRecord({
      agentId: '10',
      agentApiKey: 'plain',
      nested: {
        password: 'secret',
        publicKeyFingerprint: 'safe-fingerprint',
      },
    });

    expect(result).toEqual({
      agentId: '10',
      agentApiKey: '[REDACTED]',
      nested: {
        password: '[REDACTED]',
        publicKeyFingerprint: 'safe-fingerprint',
      },
    });
  });
});
