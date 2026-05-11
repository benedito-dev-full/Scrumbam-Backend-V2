import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class InstallAgentDto {
  @ApiProperty({ description: 'Token one-shot recebido no install-token' })
  @IsString()
  @IsNotEmpty()
  installToken!: string;

  @ApiProperty({ description: 'Hostname reportado pelo agent', example: 'vps-client-01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  hostname!: string;

  @ApiPropertyOptional({ description: 'Sistema operacional reportado pelo agent' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  os?: string;

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

  @ApiPropertyOptional({ description: 'Fingerprint da chave publica do agent' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  publicKeyFingerprint?: string;
}

export class InstallAgentResponseDto {
  @ApiProperty({ description: 'ID do agent DEntidade -156', example: '789' })
  agentId!: string;

  @ApiProperty({ description: 'API key plaintext exibida uma unica vez' })
  agentApiKey!: string;

  @ApiProperty({ description: 'Command secret plaintext exibido uma unica vez' })
  agentCommandSecret!: string;

  @ApiProperty({ description: 'Porta de tunnel alocada', example: 20000 })
  tunnelPort!: number;
}
