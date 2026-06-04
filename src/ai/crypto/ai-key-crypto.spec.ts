import { InternalServerErrorException } from '@nestjs/common';
import { decrypt, encrypt, isEncrypted, tryDecrypt } from './ai-key-crypto';

/**
 * Cobertura da criptografia at-rest das chaves de IA (R-2 / ADR-V2-064).
 *
 * Valida: round-trip encrypt→decrypt, deteccao de formato (`isEncrypted`),
 * passa-through de legado (`tryDecrypt`), deteccao de adulteracao (authTag) e
 * erro claro quando a chave-mestra esta ausente.
 *
 * A chave-mestra e mockada com hex de 64 chars (formato canonico) no
 * `beforeEach`; o `afterEach` restaura a env original.
 */
describe('ai-key-crypto', () => {
  const MASTER_KEY_ENV = 'AI_KEYS_ENCRYPTION_KEY';
  // Hex de 64 chars = 32 bytes (formato canonico AES-256).
  const VALID_MASTER_KEY = 'a'.repeat(64);
  const ORIGINAL = process.env[MASTER_KEY_ENV];

  beforeEach(() => {
    process.env[MASTER_KEY_ENV] = VALID_MASTER_KEY;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[MASTER_KEY_ENV];
    } else {
      process.env[MASTER_KEY_ENV] = ORIGINAL;
    }
  });

  describe('encrypt / decrypt (round-trip)', () => {
    it('decifra de volta o plaintext original', () => {
      const plaintext = 'sk-ant-supersecret-abc123';
      const stored = encrypt(plaintext);

      expect(stored).not.toBe(plaintext);
      expect(stored.startsWith('enc:v1:')).toBe(true);
      expect(decrypt(stored)).toBe(plaintext);
    });

    it('produz cifras diferentes para o mesmo plaintext (IV aleatorio)', () => {
      const plaintext = 'sk-openai-zzz';
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);

      expect(a).not.toBe(b);
      // Ambas decifram para o mesmo valor.
      expect(decrypt(a)).toBe(plaintext);
      expect(decrypt(b)).toBe(plaintext);
    });

    it('round-trip de string vazia e caracteres unicode', () => {
      expect(decrypt(encrypt(''))).toBe('');
      expect(decrypt(encrypt('chave-éç-🔑'))).toBe('chave-éç-🔑');
    });
  });

  describe('isEncrypted', () => {
    it('true para formato cifrado', () => {
      expect(isEncrypted(encrypt('AIzaSyAbc'))).toBe(true);
    });

    it('false para plaintext legado', () => {
      expect(isEncrypted('AIzaSyLegacyPlainKey')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted('enc:v0:nope')).toBe(false);
    });
  });

  describe('tryDecrypt', () => {
    it('decifra quando cifrado', () => {
      const plaintext = 'sk-ant-tolerante';
      expect(tryDecrypt(encrypt(plaintext))).toBe(plaintext);
    });

    it('passa-through quando legado (plaintext cru)', () => {
      const legacy = 'sk-ant-legacy-plain';
      expect(tryDecrypt(legacy)).toBe(legacy);
    });
  });

  describe('deteccao de adulteracao', () => {
    it('decrypt LANCA quando o authTag e adulterado', () => {
      const stored = encrypt('sk-ant-integro');
      const parts = stored.split(':');
      // Corrompe o authTag (4o segmento) mantendo base64 valido.
      const tag = Buffer.from(parts[3], 'base64');
      tag[0] = tag[0] ^ 0xff;
      parts[3] = tag.toString('base64');
      const tampered = parts.join(':');

      expect(() => decrypt(tampered)).toThrow();
    });

    it('decrypt LANCA quando o ciphertext e adulterado', () => {
      const stored = encrypt('sk-ant-integro');
      const parts = stored.split(':');
      const data = Buffer.from(parts[4], 'base64');
      data[0] = data[0] ^ 0xff;
      parts[4] = data.toString('base64');

      expect(() => decrypt(parts.join(':'))).toThrow();
    });

    it('decrypt LANCA quando o formato e invalido', () => {
      expect(() => decrypt('nao-cifrado')).toThrow();
      expect(() => decrypt('enc:v1:so:tres')).toThrow();
    });
  });

  describe('chave-mestra ausente', () => {
    it('encrypt LANCA erro claro quando a env esta ausente', () => {
      delete process.env[MASTER_KEY_ENV];
      expect(() => encrypt('qualquer')).toThrow(InternalServerErrorException);
    });

    it('encrypt LANCA quando a env esta vazia', () => {
      process.env[MASTER_KEY_ENV] = '   ';
      expect(() => encrypt('qualquer')).toThrow(InternalServerErrorException);
    });
  });
});
