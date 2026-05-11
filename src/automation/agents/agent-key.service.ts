import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

@Injectable()
export class AgentKeyService {
  constructor(private readonly configService: ConfigService) {}

  generateSecret(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  hashSecret(secret: string): string {
    const pepper = this.getHexKey('AGENT_KEY_PEPPER');
    return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
  }

  verifySecret(secret: string, expectedHash: string): boolean {
    const actualHash = this.hashSecret(secret);
    const actual = Buffer.from(actualHash, 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(actual, expected);
  }

  encryptCommandSecret(secret: string): string {
    const key = this.getHexKey('AGENT_COMMAND_SECRET_ENCRYPTION_KEY');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('hex'),
      tag.toString('hex'),
      ciphertext.toString('hex'),
    ].join(':');
  }

  decryptCommandSecret(encrypted: string): string {
    const [version, ivHex, tagHex, ciphertextHex] = encrypted.split(':');
    if (version !== 'v1' || !ivHex || !tagHex || !ciphertextHex) {
      throw new BadRequestException('Formato de segredo criptografado invalido');
    }

    const key = this.getHexKey('AGENT_COMMAND_SECRET_ENCRYPTION_KEY');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getHexKey(name: string): Buffer {
    const value = this.configService.get<string>(name);
    if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
      throw new InternalServerErrorException(`${name} deve ser hex de 32 bytes`);
    }
    return Buffer.from(value, 'hex');
  }
}
