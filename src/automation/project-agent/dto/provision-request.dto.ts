import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Body opcional de `POST /projects/:id/agent/:agentId/provision`.
 *
 * `useSshKey=true` faz o agente usar a deploy key per-projectSlug via
 * `GIT_SSH_COMMAND`. Para repos publicos, o frontend pode enviar `false`.
 */
export class ProvisionRequestDto {
  @ApiPropertyOptional({
    description:
      'Se true (default), o agente usa deploy key SSH per-slug. Se false, clona sem chave.',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  useSshKey?: boolean;
}
