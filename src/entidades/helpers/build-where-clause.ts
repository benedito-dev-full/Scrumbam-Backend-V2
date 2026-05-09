import { Prisma } from '@prisma/client';
import { ListEntidadeQueryDto } from '../dto/list-entidade-query.dto';

/**
 * Constrói o objeto `where` do Prisma para listagem de entidades.
 *
 * Função pura — sem efeitos colaterais, sem acesso ao banco.
 * Testável isoladamente. Centraliza a lógica de filtros para evitar
 * duplicação entre `listarPorClasse` e contagem total.
 *
 * Filtros aplicados:
 * - `idClasse`: sempre presente (obrigatório)
 * - `excluido: false`: sempre presente (soft-delete)
 * - `nome`: busca parcial case-insensitive (contém)
 * - `codigo`: busca parcial case-insensitive
 * - `idEstab`: filtro exato por entidade pai
 * - `cursor`: cursor pagination (`chave < cursor` para orderBy desc)
 *
 * @param idClasse - ID da DClasse (obrigatório, já convertido para bigint)
 * @param query - Query DTO com filtros opcionais
 * @returns Objeto `where` compatível com `prisma.dEntidade.findMany`
 *
 * @example
 * ```typescript
 * const where = buildEntidadeWhereClause(BigInt(-150), {
 *   nome: 'João',
 *   idEstab: '100',
 *   cursor: '999',
 * });
 * // { idClasse: -150n, excluido: false, nome: { contains: 'João', ... }, ... }
 * ```
 */
export function buildEntidadeWhereClause(
  idClasse: bigint,
  query: Partial<ListEntidadeQueryDto>,
): Prisma.DEntidadeWhereInput {
  const where: Prisma.DEntidadeWhereInput = {
    idClasse,
    excluido: false,
  };

  if (query.nome) {
    where.nome = { contains: query.nome, mode: 'insensitive' };
  }

  if (query.codigo) {
    where.codigo = { contains: query.codigo, mode: 'insensitive' };
  }

  if (query.idEstab) {
    where.idEstab = BigInt(query.idEstab);
  }

  if (query.cursor) {
    where.chave = { lt: BigInt(query.cursor) };
  }

  return where;
}
