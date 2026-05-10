import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

import { MCP_JSON_RPC_VERSION } from '../constants';

export class JsonRpcRequestDto {
  @ApiProperty({ enum: [MCP_JSON_RPC_VERSION], example: MCP_JSON_RPC_VERSION })
  @IsIn([MCP_JSON_RPC_VERSION])
  jsonrpc!: typeof MCP_JSON_RPC_VERSION;

  @ApiProperty({ example: 'initialize' })
  @IsString()
  method!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
    example: '1',
  })
  @IsOptional()
  id?: string | number | null;
}
