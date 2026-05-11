import { ConfigService } from '@nestjs/config';
import { AgentKeyService } from '../agent-key.service';

describe('AgentKeyService', () => {
  let service: AgentKeyService;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AGENT_KEY_PEPPER') return '11'.repeat(32);
        if (key === 'AGENT_COMMAND_SECRET_ENCRYPTION_KEY') return '22'.repeat(32);
        return undefined;
      }),
    } as unknown as ConfigService;
    service = new AgentKeyService(config);
  });

  it('gera segredo CSPRNG e valida HMAC com timingSafeEqual', () => {
    const secret = service.generateSecret();
    const hash = service.hashSecret(secret);

    expect(secret).toHaveLength(43);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(service.verifySecret(secret, hash)).toBe(true);
    expect(service.verifySecret(`${secret}x`, hash)).toBe(false);
  });

  it('criptografa e decriptografa agentCommandSecret com AES-256-GCM', () => {
    const plaintext = 'command-secret';
    const encrypted = service.encryptCommandSecret(plaintext);

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain(plaintext);
    expect(service.decryptCommandSecret(encrypted)).toBe(plaintext);
  });
});
