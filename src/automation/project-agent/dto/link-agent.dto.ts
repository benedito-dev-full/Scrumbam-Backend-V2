import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';

export type ProjectAgentTipo = 'primary' | 'secondary';

export class LinkAgentDto {
  @ApiProperty({ description: 'ID do agent (DEntidade -156)', example: '900' })
  @IsString()
  @Matches(/^\d+$/)
  agentId!: string;

  @ApiProperty({ enum: ['primary', 'secondary'], example: 'primary' })
  @IsString()
  @IsIn(['primary', 'secondary'])
  tipo!: ProjectAgentTipo;
}

export class LinkAgentResponseDto {
  @ApiProperty({ description: 'ID do projeto', example: '20' })
  projectId!: string;

  @ApiProperty({ description: 'ID do agent', example: '900' })
  agentId!: string;

  @ApiProperty({ enum: ['primary', 'secondary'] })
  tipo!: ProjectAgentTipo;

  @ApiProperty({ description: 'ID do vinculo DVincula -185', example: '1000' })
  linkId!: string;
}
