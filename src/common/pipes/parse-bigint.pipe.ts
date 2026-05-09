import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/**
 * Pipe que converte string de query param para bigint.
 *
 * Valida que o valor corresponde ao padrão ^-?\d+$ antes de converter.
 * Lança BadRequestException com mensagem clara se o valor for inválido.
 *
 * Usar em @Param() ou @Query() quando o campo é obrigatório.
 *
 * @example
 * ```typescript
 * @Get(':id')
 * async findOne(@Param('id', ParseBigIntPipe) id: bigint) {
 *   return this.service.findOne(id);
 * }
 * ```
 *
 * @throws {BadRequestException} Quando o valor não é um inteiro válido
 *
 * @see ParseOptionalBigIntPipe para versão com campo opcional
 */
@Injectable()
export class ParseBigIntPipe implements PipeTransform<string, bigint> {
  private static readonly PATTERN = /^-?\d+$/;

  /**
   * Transforma string em bigint com validação de formato.
   *
   * @param value - Valor string recebido do query/path param
   * @returns bigint validado
   * @throws {BadRequestException} Quando valor é nulo, vazio ou não-numérico
   */
  transform(value: string): bigint {
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException('Parâmetro obrigatório deve ser um número inteiro');
    }

    if (!ParseBigIntPipe.PATTERN.test(value)) {
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
