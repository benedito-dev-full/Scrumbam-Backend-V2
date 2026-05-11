import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectAgentTipo } from './link-agent.dto';

export class ProjectAgentStatusItemDto {
  @ApiProperty({ description: 'ID do vinculo DVincula -185', example: '1000' })
  linkId!: string;

  @ApiProperty({ description: 'ID do agent', example: '900' })
  agentId!: string;

  @ApiProperty({ enum: ['primary', 'secondary'] })
  tipo!: ProjectAgentTipo;

  @ApiProperty({ description: 'Nome/hostname cadastrado do agent', example: 'vps-01' })
  name!: string;

  @ApiProperty({ description: 'Status lookup do agent', example: '-510' })
  statusCode!: string | null;

  @ApiPropertyOptional({ description: 'Ultimo heartbeat ISO 8601' })
  lastSeen?: string | null;

  @ApiPropertyOptional({ description: 'Versao do scrumban-agent' })
  version?: string | null;

  @ApiPropertyOptional({ description: 'Versao do Claude Code reportada no heartbeat' })
  claudeVersion?: string | null;

  @ApiProperty({ description: 'Porta local do tunnel reverso no backend', example: 20000, nullable: true })
  tunnelPort!: number | null;

  @ApiProperty({ description: 'Resultado do probe TCP em 127.0.0.1:tunnelPort' })
  tunnelOk!: boolean;

  @ApiProperty({ description: 'Latencia do probe em ms', nullable: true })
  tunnelLatencyMs!: number | null;

  @ApiPropertyOptional({ description: 'Codigo de erro do probe quando indisponivel' })
  tunnelError?: string;
}

export class ProjectAgentStatusResponseDto {
  @ApiProperty({ description: 'ID do projeto', example: '20' })
  projectId!: string;

  @ApiProperty({ type: [ProjectAgentStatusItemDto] })
  agents!: ProjectAgentStatusItemDto[];
}
