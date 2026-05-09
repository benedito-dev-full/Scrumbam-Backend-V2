import { EntidadeResponseDto } from '../dto/entidade-response.dto';

/**
 * Tipo parcial de DEntidade retornado pelo Prisma (com join de classe).
 */
interface DEntidadeComClasse {
  chave: bigint;
  idClasse: bigint;
  codigo: string | null;
  nome: string;
  nomeFantasia: string | null;
  email: string | null;
  cpfCnpj: string | null;
  telefone: string | null;
  celular: string | null;
  idEstab: bigint | null;
  idLocEscritu: bigint | null;
  dados: unknown;
  inativo: boolean;
  excluido: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
  classe?: { codigo: string | null; nome: string } | null;
}

/**
 * Serializa uma DEntidade do Prisma para EntidadeResponseDto.
 *
 * Converte TODOS os campos BigInt para string (JSON.stringify nativo não
 * suporta BigInt — lançaria TypeError em runtime). Esta função é o único
 * ponto onde a conversão acontece, garantindo consistência.
 *
 * @param entidade - Registro DEntidade retornado pelo Prisma (com `include: { classe }`)
 * @returns EntidadeResponseDto com BigInts como strings
 *
 * @example
 * ```typescript
 * const raw = await prisma.dEntidade.findFirst({ include: { classe: ... } });
 * const dto = formatEntidadeResponse(raw);
 * // dto.chave === '150' (string, não bigint)
 * ```
 */
export function formatEntidadeResponse(entidade: DEntidadeComClasse): EntidadeResponseDto {
  return {
    chave: entidade.chave.toString(),
    idClasse: entidade.idClasse.toString(),
    codigo: entidade.codigo,
    nome: entidade.nome,
    nomeFantasia: entidade.nomeFantasia,
    email: entidade.email,
    cpfCnpj: entidade.cpfCnpj,
    telefone: entidade.telefone,
    celular: entidade.celular,
    idEstab: entidade.idEstab?.toString() ?? null,
    idLocEscritu: entidade.idLocEscritu?.toString() ?? null,
    dados: entidade.dados as Record<string, unknown> | null,
    inativo: entidade.inativo,
    excluido: entidade.excluido,
    criadoEm: entidade.criadoEm,
    atualizadoEm: entidade.atualizadoEm,
    classe: entidade.classe
      ? { codigo: entidade.classe.codigo, nome: entidade.classe.nome }
      : null,
  };
}

/**
 * Serializa uma lista de DEntidade para array de EntidadeResponseDto.
 *
 * @param entidades - Lista de registros DEntidade do Prisma
 * @returns Array de DTOs com BigInts como strings
 */
export function formatEntidadeList(entidades: DEntidadeComClasse[]): EntidadeResponseDto[] {
  return entidades.map(formatEntidadeResponse);
}
