import { PrismaService } from '../../prisma.service';

/**
 * Gera a próxima chave da sequence `chcriacao_seq` via PostgreSQL.
 *
 * O Engine usa esta função para pré-gerar o ID do pedido ANTES do INSERT,
 * permitindo referenciar a chave em logs e eventos antes da persistência.
 *
 * A sequence `chcriacao_seq` é criada via migration add_chcriacao_seq e
 * inicia em 1000000 para separar o range do BIGSERIAL default de DPedido.
 *
 * @param prisma PrismaService injetado
 * @returns bigint — chave única para o DPedido
 *
 * @see ADR-V2-007 (DVFS portabilidade)
 * @see prisma/migrations/20260509000000_add_chcriacao_seq/migration.sql
 */
export async function getNextSequenceKey(prisma: PrismaService): Promise<bigint> {
  const result = await prisma.$queryRaw<[{ nextval: bigint }]>`
    SELECT nextval('chcriacao_seq')
  `;
  return result[0].nextval;
}
