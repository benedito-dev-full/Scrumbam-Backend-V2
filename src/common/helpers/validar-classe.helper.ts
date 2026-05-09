import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Valida a existência de uma DClasse no banco.
 *
 * Helper compartilhado entre EntidadeService e TabelaService para evitar
 * duplicação de código (dívida técnica F2 resolvida em F3).
 *
 * Lança NotFoundException se a DClasse não existir ou estiver excluída.
 * Usa 1 query mínima (select somente chave).
 *
 * @param prisma - Instância do PrismaService
 * @param idClasse - Chave BigInt da DClasse a validar
 * @throws {NotFoundException} Se DClasse não encontrada ou excluída
 *
 * @example
 * ```typescript
 * await validarClasse(this.prisma, BigInt(-150));
 * // Lança NotFoundException se -150 não existir no seed
 * ```
 */
export async function validarClasse(prisma: PrismaService, idClasse: bigint): Promise<void> {
  const classe = await prisma.dClasse.findFirst({
    where: { chave: idClasse, excluido: false },
    select: { chave: true },
  });
  if (!classe) {
    throw new NotFoundException(`DClasse ${idClasse} não encontrada`);
  }
}
