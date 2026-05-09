import { PrismaService } from '../../../prisma.service';

/**
 * Parâmetros base para construção de qualquer Operacao.
 * Todos os Engines herdam esta interface.
 */
export interface IOperacaoConstruct {
  /** userId como string (bigint stringificado) */
  usuario: string;
  /** PrismaService injetado pelo Service */
  bd: PrismaService;
}
