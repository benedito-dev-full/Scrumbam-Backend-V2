import { ApiProperty } from '@nestjs/swagger';

/**
 * Resposta de provisionamento de projeto na VPS.
 *
 * O endpoint e sincrono: retorna depois que o agente confirma clone/pull.
 */
export class ProvisionResponseDto {
  @ApiProperty({ description: 'Slug do projeto resolvido pelo vinculo project-agent' })
  projectSlug!: string;

  @ApiProperty({
    description: 'Path absoluto do repositorio na VPS. Referencia de leitura; nao usar como input.',
  })
  projectPath!: string;

  @ApiProperty({
    description: 'true quando a pasta ja existia como repo git e o agente executou pull',
  })
  alreadyExisted!: boolean;

  @ApiProperty({ description: 'Branch atual apos clone/pull', example: 'main' })
  currentBranch!: string;

  @ApiProperty({ description: 'SHA do commit HEAD apos clone/pull' })
  headCommitSha!: string;

  @ApiProperty({ description: 'ISO8601 do momento em que o backend persistiu o ACK' })
  provisionedAt!: string;

  @ApiProperty({ description: 'true se o agente usou deploy key SSH' })
  usedSshKey!: boolean;
}
