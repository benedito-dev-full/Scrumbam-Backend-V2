import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class McpKeyCreatedResponseDto {
  @ApiProperty({ example: '123' })
  id!: string;

  @ApiProperty({ example: 'scrumban_mcp' })
  prefix!: string;

  @ApiProperty({ example: 'scrumban_mcp_xxxxxxxxxxxxxxxxxxxxxx' })
  plaintext!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  createdAt!: string;
}

export class McpKeyListItemDto {
  @ApiProperty({ example: '123' })
  id!: string;

  @ApiProperty({ example: 'scrumban_mcp' })
  prefix!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty({ example: false })
  disabled!: boolean;

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  createdAt!: string;

  @ApiPropertyOptional({ example: '2026-05-10T12:30:00.000Z', nullable: true })
  lastUsedAt!: string | null;
}
