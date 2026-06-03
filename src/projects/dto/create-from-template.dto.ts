import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para criar um projeto (List/Space) a partir de um template.
 *
 * Usado no endpoint `POST /projects/:id/from-template` (Sub-fase 4 da feature
 * Templates — ver `workspace/plans/plan-templates-feature.md`). O `:id` é a
 * chave de um DProject-template (`idClasse` -401 TEMPLATE_LIST ou -402
 * TEMPLATE_SPACE); o motor `cloneTree` materializa a árvore inteira do template
 * remapeando a DClasse para a real (-401→-352 LIST, -402→-350 SPACE), copiando
 * blocos e tasks (molde-limpo) e carimbando o `idEstab` da org de destino.
 *
 * Validações aplicadas via class-validator:
 * - includeTasks: boolean opcional (default true — templates copiam as tasks)
 * - novoNome: string opcional (sobrescreve o nome da raiz materializada)
 * - novoIcone: string opcional (sobrescreve `dados.icon` da raiz)
 * - idPai: string opcional (SPACE/FOLDER destino onde o nó nasce)
 *
 * @example
 * ```typescript
 * const dto: CreateFromTemplateDto = {
 *   includeTasks: true,
 *   novoNome: 'Onboarding Cliente X',
 *   novoIcone: 'rocket',
 *   idPai: '123',
 * };
 * ```
 */
export class CreateFromTemplateDto {
  /**
   * Copiar as tasks de trabalho (-154) do template, além dos blocos/fases.
   *
   * Default `true` — templates materializam o molde completo (tasks com reset
   * molde-limpo: INBOX, sem assignee/prazo, novo identifier DEV-N).
   */
  @ApiPropertyOptional({
    description: 'Copiar as tasks do template (molde-limpo). Default true.',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeTasks?: boolean;

  /**
   * Sobrescreve o nome do nó raiz materializado.
   *
   * Se ausente, usa `${nome do template} (cópia)` — mesmo default de `duplicate`.
   */
  @ApiPropertyOptional({
    description: 'Nome do nó raiz materializado (default "<nome> (cópia)")',
    example: 'Onboarding Cliente X',
  })
  @IsOptional()
  @IsString()
  novoNome?: string;

  /**
   * Sobrescreve `dados.icon` do nó raiz materializado.
   *
   * Se ausente, o ícone herdado do template é preservado.
   */
  @ApiPropertyOptional({
    description: 'Ícone do nó raiz materializado (sobrescreve dados.icon)',
    example: 'rocket',
  })
  @IsOptional()
  @IsString()
  novoIcone?: string;

  /**
   * SPACE/FOLDER destino onde o nó materializado nasce.
   *
   * - Para TEMPLATE_LIST (-401): destino deve ser um SPACE (-350) ou FOLDER
   *   (-351) da org ativa; o usuário precisa ser MANAGER do destino.
   * - Para TEMPLATE_SPACE (-402): se ausente, o SPACE materializado nasce como
   *   raiz (idPai null) — basta ser membro da org.
   * - Quando ausente para LIST, o nó nasce ao lado (comportamento legado de
   *   clone), mas geralmente o frontend informa o destino.
   */
  @ApiPropertyOptional({
    description: 'ID do SPACE/FOLDER destino onde o nó nasce',
    example: '123',
  })
  @IsOptional()
  @IsString()
  idPai?: string;
}
