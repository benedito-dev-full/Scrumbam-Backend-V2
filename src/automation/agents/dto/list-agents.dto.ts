import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum AgentListStatus {
  PENDING_INSTALL = 'pending_install',
  NEVER_CONNECTED = 'never_connected',
  ONLINE = 'online',
  OFFLINE = 'offline',
}

export class ListAgentsQueryDto {
  @ApiPropertyOptional({
    description: 'Filtra agents por status (calculado em runtime via lastSeen).',
    enum: AgentListStatus,
  })
  @IsOptional()
  @IsEnum(AgentListStatus)
  status?: AgentListStatus;

  @ApiPropertyOptional({ description: 'Busca por nome/hostname (LIKE case-insensitive).' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}

export class AgentListItemDto {
  @ApiProperty({ description: 'ID do agent (DEntidade -156)', example: '32' })
  id!: string;

  @ApiProperty({ description: 'Nome do agent (reportado no install)', example: 'argus' })
  nome!: string;

  @ApiProperty({ enum: AgentListStatus, example: AgentListStatus.ONLINE })
  status!: AgentListStatus;

  @ApiProperty({
    description: 'Hostname FQDN do agent',
    nullable: true,
    example: 'argus.devari.com.br',
  })
  hostname!: string | null;

  @ApiProperty({
    description: 'Versão do binário scrumban-agent',
    nullable: true,
    example: '0.1.0',
  })
  agentVersion!: string | null;

  @ApiProperty({ description: 'Porta do reverse tunnel', nullable: true, example: 20000 })
  tunnelPort!: number | null;

  @ApiProperty({ description: 'Timestamp ISO do último heartbeat', nullable: true })
  lastHeartbeat!: string | null;

  @ApiProperty({ description: 'Timestamp ISO de quando o agent foi instalado', nullable: true })
  installedAt!: string | null;

  @ApiProperty({ description: 'Timestamp ISO de criação do registro' })
  createdAt!: string;
}
