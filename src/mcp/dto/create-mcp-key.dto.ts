import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class CreateMcpKeyDto {
  @ApiPropertyOptional({
    description: 'Escopos concedidos para a key MCP.',
    example: ['tools:read', 'tools:call'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  scopes?: string[];
}
