import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * DTO de heartbeat reportado pelo scrumban-agent.
 *
 * Endpoint: POST /agents/:id/heartbeat (autenticado via AgentAuthGuard HMAC).
 *
 * Campos canonicos (alinhados com `agent/src/outbound/backend-client.ts` linhas 35-54):
 *  - `agentVersion`, `claudeVersion`, `os`: identificacao basica
 *  - `cpu`, `mem`, `uptime`: telemetria de processo
 *  - `claudeCodeAvailable`, `tunnelHealthy`: saude operacional
 *
 * Todos opcionais — agent legado pode enviar subset. Persistidos em
 * `dEntidade.dados` via spread (sem schema migration).
 *
 * @see ADR-V2-040 (HMAC bilateral + DTO canonico)
 */
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

  @ApiPropertyOptional({ description: 'Load avg normalizado (loadavg[0]/cpuCount)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cpu?: number;

  @ApiPropertyOptional({ description: 'Fracao memoria usada (0..1)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  mem?: number;

  @ApiPropertyOptional({ description: 'Uptime do processo agent em segundos' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  uptime?: number;

  @ApiPropertyOptional({ description: 'Binario claude responde a --version' })
  @IsOptional()
  @IsBoolean()
  claudeCodeAvailable?: boolean;

  @ApiPropertyOptional({ description: 'Reverse tunnel autossh saudavel' })
  @IsOptional()
  @IsBoolean()
  tunnelHealthy?: boolean;
}

export class HeartbeatResponseDto {
  ok!: boolean;
  agentId!: string;
  statusCode!: string;
  lastSeen!: string;
}
