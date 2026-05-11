import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const AAD = Buffer.from('webhook-secret');

/**
 * Servico responsavel pela geracao, criptografia de secrets e assinatura de payloads (Pilar 2).
 *
 * Utiliza AES-256-GCM para criptografar secrets no banco e HMAC-SHA256 para assinar as entregas.
 */
@Injectable()
export class WebhooksSigningService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksSigningService.name);
  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const keyHex = this.configService.get<string>('WEBHOOK_ENCRYPTION_KEY');
    if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
      this.logger.error('WEBHOOK_ENCRYPTION_KEY invalida: esperado hex de 64 caracteres');
      throw new Error('WEBHOOK_ENCRYPTION_KEY invalida');
    }

    this.key = Buffer.from(keyHex, 'hex');
  }

  /**
   * Gera um novo secret aleatorio para um webhook.
   *
   * @returns String hexadecimal de 32 bytes (64 caracteres).
   */
  generateSecret(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Criptografa o secret para armazenamento seguro.
   *
   * @param secret - Secret em texto plano.
   * @returns String base64 contendo IV + TAG + Ciphertext.
   */
  encrypt(secret: string): string {
    this.ensureInitialized();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(AAD);

    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  /**
   * Decriptografa o secret para uso na assinatura.
   *
   * @param secretEncrypted - Secret criptografado (base64).
   * @returns Secret em texto plano.
   */
  decrypt(secretEncrypted: string): string {
    this.ensureInitialized();
    const buffer = Buffer.from(secretEncrypted, 'base64');
    if (buffer.length <= IV_LENGTH + TAG_LENGTH) {
      throw new Error('secretEncrypted invalido');
    }

    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Assina o payload do webhook usando HMAC-SHA256.
   *
   * @param secret - Secret em texto plano.
   * @param bodyString - Stringificada do JSON body.
   * @returns Header formatado `sha256=<hex>`.
   */
  sign(secret: string, bodyString: string): string {
    return `sha256=${createHmac('sha256', secret).update(bodyString, 'utf8').digest('hex')}`;
  }

  private ensureInitialized(): void {
    if (!this.key) {
      this.onModuleInit();
    }
  }
}

