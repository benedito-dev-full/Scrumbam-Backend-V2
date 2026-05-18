import { ApiProperty } from '@nestjs/swagger';
import { IsNumberString, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para criação de Folder (POST /entidades/folders).
 *
 * Cria DEntidade idClasse=-155 (FOLDER) com `idEstab=organizationId`.
 * Folders são flat (sem aninhamento — CEO Q1), ordenadas alfabeticamente
 * pelo `nome` (sem ordem manual — CEO Q3). Cor/ícone OUT do MVP (CEO Q2)
 * — o frontend deriva cor por hash(nome).
 *
 * @example
 * ```typescript
 * const dto: CreateFolderDto = {
 *   nome: 'Cliente Acme',
 *   organizationId: '100',
 * };
 * ```
 *
 * @see ADR-V2-FOLDERS-001
 */
export class CreateFolderDto {
  /**
   * Nome da pasta (obrigatório, 1..100 chars).
   *
   * Aparece como label no card "Folders" do workspace e na sidebar.
   * Frontend deriva cor por hash(nome) — nomes diferentes ganham cores
   * estáveis sem custo de persistência.
   */
  @ApiProperty({
    description: 'Nome da pasta',
    example: 'Cliente Acme',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nome!: string;

  /**
   * ID da organização dona da pasta (BigInt como string).
   *
   * Persistido em `DEntidade.idEstab`. Funciona como filtro de tenant —
   * o service exige que o usuário tenha role na org via DVincula -160..-163.
   */
  @ApiProperty({
    description: 'ID da organização pai (BigInt como string)',
    example: '100',
  })
  @IsNumberString({ no_symbols: false })
  organizationId!: string;
}
