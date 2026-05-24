import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Valida que definir `idPai = novoPaiId` no projeto `targetId` não cria ciclo.
 *
 * Usa CTE recursiva do PostgreSQL para traversar todos os ancestrais do
 * `novoPaiId` e verifica se `targetId` aparece em algum ponto da cadeia
 * (ciclo A→B→A ou A→B→C→A).
 *
 * Deve ser chamado ANTES de qualquer UPDATE de `idPai` no DProject.
 *
 * @param prisma  - PrismaService (passado pelo caller; suporta PrismaClient raiz)
 * @param targetId  - `DProject.chave` do projeto que terá idPai alterado
 * @param novoPaiId - Novo valor de `idPai` (null = desvincula → sem ciclo possível)
 *
 * @throws {BadRequestException} Quando `novoPaiId === targetId` (auto-referência)
 * @throws {BadRequestException} Quando o novo pai é descendente do target (ciclo)
 *
 * @example
 * ```typescript
 * // Antes de setar Space B como pai do Space A:
 * await validateNoCycle(prisma, BigInt(spaceAId), BigInt(spaceBId));
 * await prisma.dProject.update({ where: { chave: spaceAId }, data: { idPai: spaceBId } });
 * ```
 */
export async function validateNoCycle(
  prisma: PrismaService,
  targetId: bigint,
  novoPaiId: bigint | null,
): Promise<void> {
  // Null = remover pai → impossível criar ciclo
  if (novoPaiId === null) return;

  // Auto-referência direta
  if (novoPaiId === targetId) {
    throw new BadRequestException('Um projeto não pode ser pai de si mesmo');
  }

  // CTE recursiva: sobe a árvore a partir de novoPaiId até a raiz.
  // Se targetId aparecer em qualquer ancestral, a operação criaria um ciclo.
  const result = await prisma.$queryRaw<Array<{ chave: bigint }>>`
    WITH RECURSIVE ancestors AS (
      SELECT "chave", "idPai"
      FROM "DProject"
      WHERE "chave" = ${novoPaiId} AND "excluido" = false

      UNION ALL

      SELECT p."chave", p."idPai"
      FROM "DProject" p
      INNER JOIN ancestors a ON p."chave" = a."idPai"
      WHERE p."excluido" = false
    )
    SELECT "chave" FROM ancestors WHERE "chave" = ${targetId}
  `;

  if (result.length > 0) {
    throw new BadRequestException(
      'Operação criaria ciclo na hierarquia de projetos',
    );
  }
}
