import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

import { ALL_MCP_SCOPES } from '../constants';

/**
 * DTO para criação de uma MCP Key (`POST /mcp/keys`).
 *
 * Os scopes solicitados são validados em duas camadas no
 * {@link McpKeyService.generate} (ADR-V2-068 Fase 2):
 * - catálogo: cada scope deve pertencer a `ALL_MCP_SCOPES`;
 * - escalação de privilégio: o usuário só pode conceder scopes compatíveis
 *   com o seu role (via `RoleResolverService.getAllowedMcpScopes`).
 *
 * Os validators de class-validator aqui garantem apenas o SHAPE (array de
 * strings, tamanho máximo); a validação semântica de catálogo + escalação
 * fica no service porque depende do role do usuário autenticado.
 */
export class CreateMcpKeyDto {
  @ApiPropertyOptional({
    description:
      'Escopos concedidos para a key MCP (catálogo canônico ADR-V2-068). ' +
      'Validados contra o role do usuário no service.',
    example: ['tasks:read', 'tasks:write'],
    enum: ALL_MCP_SCOPES,
    isArray: true,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  scopes?: string[];
}
