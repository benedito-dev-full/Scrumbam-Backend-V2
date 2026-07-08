import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para promover um projeto (List/Space) real a Template reutilizável.
 *
 * Usado no endpoint `POST /projects/:id/promote-to-template` (extensão da
 * feature Templates — ADR-V2-061 / ADR-V2-062). O `:id` é a chave de um
 * DProject real (`idClasse` -352 LIST ou -350 SPACE); o motor `cloneTree`
 * (com `toTemplate: true`) cria uma CÓPIA da árvore inteira remapeando a
 * DClasse para o template (-352→-401 TEMPLATE_LIST, -350→-402 TEMPLATE_SPACE),
 * sem copiar tasks de trabalho (molde-limpo), carimbando `dados.categoria` na
 * raiz e o `idEstab` da org ativa. O projeto original permanece intacto.
 *
 * Validações aplicadas via class-validator:
 * - categoria: string obrigatória, não-vazia (texto livre, sem enum fechado)
 * - novoNome: string opcional (sobrescreve o nome da raiz materializada)
 *
 * @example
 * ```typescript
 * const dto: PromoteToTemplateDto = {
 *   categoria: 'Desenvolvimento',
 *   novoNome: 'Molde QA E2E',
 * };
 * ```
 */
export class PromoteToTemplateDto {
  /**
   * Categoria do catálogo de templates.
   *
   * Texto livre escolhido pelo usuário no momento da promoção — sem
   * default/pré-seleção. Gravado em `dados.categoria` da raiz materializada
   * e usado por `GET /projects?idClasse=-401&categoria=X` para popular a
   * galeria de templates.
   */
  @ApiProperty({
    description: 'Categoria do catálogo de templates (texto livre, escolhida pelo usuário)',
    example: 'Desenvolvimento',
  })
  @IsString()
  @IsNotEmpty()
  categoria!: string;

  /**
   * Sobrescreve o nome do nó raiz materializado (o template resultante).
   *
   * Se ausente, usa `${nome original} (cópia)` — mesmo default de
   * `duplicate`/`cloneTree`.
   */
  @ApiPropertyOptional({
    description: 'Nome do template resultante (default "<nome original> (cópia)")',
    example: 'Molde QA E2E',
  })
  @IsOptional()
  @IsString()
  novoNome?: string;
}
