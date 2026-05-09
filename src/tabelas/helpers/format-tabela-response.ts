import { TabelaResponseDto } from '../dto/tabela-response.dto';

/**
 * Serializa DTabela do Prisma para TabelaResponseDto.
 *
 * Converte BigInt → string em todos os campos numéricos (IDs).
 * Extraído de `tabelas.service.ts` (dívida técnica F2 resolvida em F3)
 * para facilitar testes unitários e reutilização.
 *
 * @param tabela - Registro DTabela do Prisma (com include classe opcional)
 * @returns TabelaResponseDto serializado
 *
 * @example
 * ```typescript
 * const dto = formatTabelaResponse(tabelaFromPrisma);
 * // dto.chave é string, não BigInt
 * ```
 */
export function formatTabelaResponse(tabela: {
  chave: bigint;
  idClasse: bigint;
  codigo: string | null;
  nome: string;
  descricao: string | null;
  dEntidadeId: bigint | null;
  dados: unknown;
  inativo: boolean;
  excluido: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
  classe?: { codigo: string | null; nome: string } | null;
}): TabelaResponseDto {
  return {
    chave: tabela.chave.toString(),
    idClasse: tabela.idClasse.toString(),
    codigo: tabela.codigo,
    nome: tabela.nome,
    descricao: tabela.descricao,
    dEntidadeId: tabela.dEntidadeId?.toString() ?? null,
    dados: tabela.dados as Record<string, unknown> | null,
    inativo: tabela.inativo,
    excluido: tabela.excluido,
    criadoEm: tabela.criadoEm,
    atualizadoEm: tabela.atualizadoEm,
    classe: tabela.classe
      ? { codigo: tabela.classe.codigo, nome: tabela.classe.nome }
      : null,
  };
}
