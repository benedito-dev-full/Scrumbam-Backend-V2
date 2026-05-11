import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Valida o formato do Idempotency-Key.
 * O retorno idempotente da execution existente fica no ExecutionsService,
 * porque o service tem acesso ao DPedido persistido.
 */
@Injectable()
export class IdempotencyGuard implements CanActivate {
  private readonly logger = new Logger(IdempotencyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const raw = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(raw) ? raw[0] : raw;

    if (!idempotencyKey) {
      return true;
    }

    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
    if (!uuidV4Regex.test(idempotencyKey)) {
      this.logger.warn('Idempotency-Key invalido');
      throw new BadRequestException('Idempotency-Key deve ser um UUID v4 valido');
    }

    return true;
  }
}
