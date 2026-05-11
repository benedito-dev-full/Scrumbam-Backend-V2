import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches } from 'class-validator';

export class GenerateInstallTokenDto {
  @ApiProperty({ description: 'ID do projeto', example: '123' })
  @IsNotEmpty()
  @Matches(/^\d+$/)
  projectId!: string;
}

export class GenerateInstallTokenResponseDto {
  @ApiProperty({ description: 'Token plaintext exibido uma unica vez' })
  token!: string;

  @ApiProperty({ description: 'ID do registro DTabela -473', example: '456' })
  installTokenId!: string;

  @ApiProperty({ description: 'Expiracao ISO-8601' })
  expiresAt!: string;
}
