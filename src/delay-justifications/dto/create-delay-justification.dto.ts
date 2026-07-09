import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * DTO para criar OU editar (supersede) a justificativa de atraso vigente de
 * uma tarefa.
 *
 * Usado em `POST /tasks/:taskId/delay-justification`. Espelha o modal do
 * frontend: um **radio de categoria (obrigatório)** + um **textarea de
 * detalhe (opcional)**.
 *
 * Validações (class-validator):
 * - `motivoClasse`: string obrigatória, uma DClasse-motivo `-531..-537`
 *   (folhas de `DELAY_REASON -530`, seed F1 / ADR-V2-070). O regex
 *   `/^-53[1-7]$/` rejeita qualquer outra chave (incluindo o próprio
 *   agrupador `-530`, que não é selecionável).
 * - `texto`: opcional, até 2000 caracteres (contexto humano livre).
 *
 * @example
 * ```typescript
 * const dto: CreateDelayJustificationDto = {
 *   motivoClasse: '-535',
 *   texto: 'Bug intermitente no gateway de pagamento travou a entrega.',
 * };
 * ```
 */
export class CreateDelayJustificationDto {
  /**
   * DClasse-motivo escolhida no radio. Uma das 7 folhas de `DELAY_REASON`:
   * `-531` Dependência · `-532` Bloqueio externo · `-533` Subestimei ·
   * `-534` Prioridade mudou · `-535` Problema técnico · `-536` Sobrecarga ·
   * `-537` Outro.
   */
  @ApiProperty({
    description: 'DClasse-motivo do atraso (-531..-537). Populado via GET /classes?idPai=-530.',
    example: '-535',
    pattern: '^-53[1-7]$',
  })
  @IsString()
  @Matches(/^-53[1-7]$/, {
    message: 'motivoClasse deve ser uma DClasse-motivo válida (-531 a -537)',
  })
  motivoClasse!: string;

  /**
   * Detalhe humano opcional. Persiste em `DEvento.descricao` + `metaDados.texto`.
   */
  @ApiPropertyOptional({
    description: 'Detalhe livre do atraso (opcional, até 2000 caracteres)',
    example: 'Aguardando retorno do cliente sobre o escopo.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'texto não pode exceder 2000 caracteres' })
  texto?: string;
}
