import { Prisma } from '@prisma/client';
import { ListTabelaQueryDto } from '../dto/list-tabela-query.dto';

/**
 * Constrói o objeto `where` do Prisma para listagem de tabelas.
 *
 * Função pura sem efeitos colaterais. Centraliza a lógica de filtros
 * para DTabela (análogo ao buildEntidadeWhereClause).
 *
 * @param idClasse - ID da DClasse (obrigatório, já em bigint)
 * @param query - Filtros opcionais da query
 * @returns Objeto `where` para `prisma.dTabela.findMany`
 *
 * @example
 * ```typescript
 * const where = buildTabelaWhereClause(BigInt(-440), { dEntidadeId: '100' });
 * ```
 */
export function buildTabelaWhereClause(
  idClasse: bigint,
  query: Partial<ListTabelaQueryDto>,
): Prisma.DTabelaWhereInput {
  const where: Prisma.DTabelaWhereInput = {
    idClasse,
    excluido: false,
  };

  if (query.nome) {
    where.nome = { contains: query.nome, mode: 'insensitive' };
  }

  if (query.codigo) {
    where.codigo = { contains: query.codigo, mode: 'insensitive' };
  }

  if (query.dEntidadeId) {
    where.dEntidadeId = BigInt(query.dEntidadeId);
  }

  if (query.cursor) {
    where.chave = { lt: BigInt(query.cursor) };
  }

  return where;
}
