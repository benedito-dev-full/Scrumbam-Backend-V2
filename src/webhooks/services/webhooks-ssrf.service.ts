import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

/**
 * Servico de protecao contra Server-Side Request Forgery (SSRF) (Pilar 2).
 *
 * Bloqueia URLs que apontam para localhost, redes privadas, enderecos de metadata
 * de cloud providers e outros hosts restritos.
 */
@Injectable()
export class WebhooksSsrfService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Valida se uma URL e segura para despacho de webhook.
   *
   * @param url - URL a ser validada.
   * @throws BadRequestException se a URL for invalida, usar protocolo nao suportado,
   * conter credenciais ou apontar para host bloqueado/privado.
   */
  async validateUrl(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('URL invalida');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('URL deve usar protocolo http ou https');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException('URL nao pode conter credenciais');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.localhost')) {
      throw new BadRequestException('URL aponta para host bloqueado');
    }

    const addresses = await this.resolveAddresses(hostname);
    const allowPrivate = this.configService.get<string>('WEBHOOKS_ALLOW_PRIVATE') === 'true';

    for (const address of addresses) {
      if (this.isCloudMetadata(address)) {
        throw new BadRequestException('URL aponta para metadata cloud bloqueada');
      }

      if (!allowPrivate && this.isPrivateAddress(address)) {
        throw new BadRequestException('URL aponta para rede privada ou local');
      }
    }
  }

  private async resolveAddresses(hostname: string): Promise<string[]> {
    if (isIP(hostname) !== 0) {
      return [hostname];
    }

    try {
      const records = await lookup(hostname, { all: true, verbatim: true });
      return records.map((record) => record.address);
    } catch {
      throw new BadRequestException('Nao foi possivel resolver o host da URL');
    }
  }

  private isCloudMetadata(address: string): boolean {
    return address === '169.254.169.254' || address === '100.100.100.200';
  }

  private isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase();

    if (normalized.startsWith('::ffff:')) {
      return this.isPrivateAddress(normalized.replace('::ffff:', ''));
    }

    const version = isIP(normalized);
    if (version === 4) {
      const parts = normalized.split('.').map((part) => BigInt(part));
      const [a, b] = parts;
      return (
        a === 0n ||
        a === 10n ||
        a === 127n ||
        (a === 100n && b >= 64n && b <= 127n) ||
        (a === 169n && b === 254n) ||
        (a === 172n && b >= 16n && b <= 31n) ||
        (a === 192n && b === 168n)
      );
    }

    if (version === 6) {
      return (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe8') ||
        normalized.startsWith('fe9') ||
        normalized.startsWith('fea') ||
        normalized.startsWith('feb')
      );
    }

    return true;
  }
}

