import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class HeartbeatDto {
  @ApiPropertyOptional({ description: 'Versao do scrumban-agent' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agentVersion?: string;

  @ApiPropertyOptional({ description: 'Versao do Claude Code CLI' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  claudeVersion?: string;

  @ApiPropertyOptional({ description: 'Sistema operacional reportado pelo agent' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  os?: string;
}

export class HeartbeatResponseDto {
  ok!: boolean;
  agentId!: string;
  statusCode!: string;
  lastSeen!: string;
}
