import { ConfigService } from '@nestjs/config';
import { WebhooksSigningService } from '../services/webhooks-signing.service';

describe('WebhooksSigningService', () => {
  const validKey = 'a'.repeat(64);

  it('valida WEBHOOK_ENCRYPTION_KEY e falha ruidosamente se invalida', () => {
    const service = new WebhooksSigningService({
      get: jest.fn().mockReturnValue('invalid'),
    } as unknown as ConfigService);

    expect(() => service.onModuleInit()).toThrow('WEBHOOK_ENCRYPTION_KEY invalida');
  });

  it('gera secret, criptografa e decriptografa com AES-256-GCM', () => {
    const service = new WebhooksSigningService({
      get: jest.fn().mockReturnValue(validKey),
    } as unknown as ConfigService);
    service.onModuleInit();

    const secret = service.generateSecret();
    const encrypted = service.encrypt(secret);

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(encrypted).not.toContain(secret);
    expect(service.decrypt(encrypted)).toBe(secret);
  });

  it('assina body com HMAC-SHA256 no formato esperado', () => {
    const service = new WebhooksSigningService({
      get: jest.fn().mockReturnValue(validKey),
    } as unknown as ConfigService);

    const signature = service.sign('secret', '{"ok":true}');

    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('rejeita ciphertext adulterado', () => {
    const service = new WebhooksSigningService({
      get: jest.fn().mockReturnValue(validKey),
    } as unknown as ConfigService);
    service.onModuleInit();

    const encrypted = service.encrypt('secret');
    const tampered = `${encrypted.slice(0, -2)}aa`;

    expect(() => service.decrypt(tampered)).toThrow();
  });
});

