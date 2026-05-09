import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/**
 * Pipe que converte string opcional de query param para bigint ou undefined.
 *
 * Reutiliza a mesma validação de ParseBigIntPipe mas retorna undefined quando
 * o valor não foi enviado (null/undefined). Útil para filtros opcionais.
 *
 * @example
 * ```typescript
 * @Get()
 * async findAll(
 *   @Query('idEstab', ParseOptionalBigIntPipe) idEstab?: bigint
 * ) {
 *   return this.service.findAll(idEstab);
 * }
 * ```
 *
 * @see ParseBigIntPipe para versão obrigatória
 */
@Injectable()
export class ParseOptionalBigIntPipe implements PipeTransform<string | undefined, bigint | undefined> {
  private static readonly PATTERN = /^-?\d+$/;

  /**
   * Transforma string opcional em bigint ou undefined.
   *
   * @param value - Valor string recebido, ou undefined se não enviado
   * @returns bigint se presente e válido, undefined se ausente
   * @throws {BadRequestException} Quando valor presente mas não-numérico
   */
  transform(value: string | undefined): bigint | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (!ParseOptionalBigIntPipe.PATTERN.test(value)) {
      throw new BadRequestException(
        `Valor "${value}" inválido — deve ser um número inteiro (ex: -150, 42)`,
      );
    }

    try {
      return BigInt(value);
    } catch {
      throw new BadRequestException(
        `Não foi possível converter "${value}" para número inteiro`,
      );
    }
  }
}
