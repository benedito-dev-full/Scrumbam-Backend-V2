import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { McpKeyResponseDto } from '../dto/mcp-key-response.dto';

/** idClasse da DTabela de MCP Keys (ADR-V2-004). */
const ID_CLASSE_MCP_KEY = BigInt(-472);

/**
 * Service para geração, validação e revogação de MCP Keys.
 *
 * MCP Keys são armazenadas em:
 * - DTabela(-472): fonte de verdade (dEntidadeId = userId)
 * - DUserGroup.dados.mcpKeyHash: hash duplicado para latência mínima (ADR-V2-004 D4)
 *
 * Sync entre os dois via transaction Prisma ao revogar.
 *
 * @see McpKeyGuard — guard que usa este service
 * @see DTabela(-472) — armazenamento canônico
 */
@Injectable()
export class McpKeyService {
  private readonly logger = new Logger(McpKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera nova MCP Key vinculada a um usuário.
   *
   * Cria DTabela(-472) e atualiza DUserGroup.dados.mcpKeyHash em transaction.
   * Retorna plaintext UMA vez.
   *
   * @param userId - Chave BigInt da DEntidade (-150) do usuário
   * @param userGroupId - Chave BigInt do DUserGroup (para dados.mcpKeyHash)
   * @returns McpKeyResponseDto com key plaintext (apenas nesta chamada)
   */
  async generate(userId: bigint, userGroupId: bigint): Promise<McpKeyResponseDto> {
    const plaintext = `mcp_${randomBytes(24).toString('hex')}`;
    const hash = createHash('sha256').update(plaintext).digest('hex');
    const prefix = plaintext.slice(0, 8);

    this.logger.log(`Gerando MCP Key para userId=${userId} userGroupId=${userGroupId}`);

    const tabela = await this.prisma.$transaction(async (tx) => {
      // Criar DTabela(-472) com hash
      const created = await tx.dTabela.create({
        data: {
          idClasse: ID_CLASSE_MCP_KEY,
          nome: `MCP Key ${prefix}...`,
          codigo: prefix,
          dEntidadeId: userId,
          dados: {
            hash,
            prefix,
            userId: userId.toString(),
          } as Prisma.InputJsonValue,
        },
      });

      // Duplicar hash em DUserGroup.dados.mcpKeyHash (latência mínima)
      const userGroup = await tx.dUserGroup.findUnique({
        where: { chave: userGroupId },
        select: { dados: true },
      });

      const dadosAtuais = (userGroup?.dados as Record<string, unknown>) ?? {};
      await tx.dUserGroup.update({
        where: { chave: userGroupId },
        data: {
          dados: {
            ...dadosAtuais,
            mcpKeyHash: hash,
          } as Prisma.InputJsonValue,
        },
      });

      return created;
    });

    return {
      key: plaintext,
      prefix,
      id: tabela.chave.toString(),
      userId: userId.toString(),
      createdAt: tabela.criadoEm,
    };
  }

  /**
   * Valida MCP Key em texto plano.
   *
   * Caminho rápido: se userGroupId fornecido, compara hash com DUserGroup.dados.mcpKeyHash (1 query).
   * Caminho lento: se não, busca em DTabela(-472) (filtragem em app).
   *
   * @param plaintext - MCP Key em texto plano do header X-MCP-Key
   * @param userGroupId - Chave BigInt do DUserGroup (opcional, para caminho rápido)
   * @returns { userId } ou null se inválida
   */
  async validate(
    plaintext: string,
    userGroupId?: bigint,
  ): Promise<{ userId: bigint } | null> {
    const hash = createHash('sha256').update(plaintext).digest('hex');

    if (userGroupId) {
      // Caminho rápido: verifica hash duplicado em DUserGroup.dados
      const userGroup = await this.prisma.dUserGroup.findUnique({
        where: { chave: userGroupId },
        select: { dados: true, entidades: { where: { excluido: false }, select: { chave: true }, take: 1 } },
      });

      const dados = userGroup?.dados as Record<string, unknown> | null;
      if (dados?.mcpKeyHash === hash && userGroup?.entidades[0]) {
        return { userId: userGroup.entidades[0].chave };
      }
    }

    // Caminho lento: buscar em DTabela(-472)
    const mcpKeys = await this.prisma.dTabela.findMany({
      where: {
        idClasse: ID_CLASSE_MCP_KEY,
        excluido: false,
        inativo: false,
      },
      select: {
        dEntidadeId: true,
        dados: true,
      },
    });

    const match = mcpKeys.find((k) => {
      const dados = k.dados as Record<string, unknown> | null;
      return dados?.hash === hash;
    });

    if (!match || !match.dEntidadeId) {
      return null;
    }

    return { userId: match.dEntidadeId };
  }

  /**
   * Revoga MCP Key de um usuário.
   *
   * Remove DTabela(-472) (soft-delete) e limpa DUserGroup.dados.mcpKeyHash
   * em transaction atômica.
   *
   * @param userId - Chave BigInt da DEntidade do usuário
   * @param userGroupId - Chave BigInt do DUserGroup
   * @throws {NotFoundException} Se MCP Key não encontrada
   */
  async revoke(userId: bigint, userGroupId: bigint): Promise<void> {
    const mcpKey = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: ID_CLASSE_MCP_KEY,
        dEntidadeId: userId,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!mcpKey) {
      throw new NotFoundException(`MCP Key não encontrada para userId=${userId}`);
    }

    this.logger.log(`Revogando MCP Key userId=${userId}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.dTabela.update({
        where: { chave: mcpKey.chave },
        data: { excluido: true },
      });

      const userGroup = await tx.dUserGroup.findUnique({
        where: { chave: userGroupId },
        select: { dados: true },
      });

      const dadosAtuais = (userGroup?.dados as Record<string, unknown>) ?? {};
      const { mcpKeyHash: _removed, ...dadosSemHash } = dadosAtuais;
      void _removed;

      await tx.dUserGroup.update({
        where: { chave: userGroupId },
        data: {
          dados: dadosSemHash as Prisma.InputJsonValue,
        },
      });
    });
  }

  /**
   * Verifica se usuário tem MCP Key ativa.
   *
   * @param userId - Chave BigInt da DEntidade do usuário
   * @returns McpKeyResponseDto sem campo key, ou null se não existe
   */
  async getByUser(userId: bigint): Promise<McpKeyResponseDto | null> {
    const tabela = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: ID_CLASSE_MCP_KEY,
        dEntidadeId: userId,
        excluido: false,
      },
    });

    if (!tabela) {
      return null;
    }

    const dados = tabela.dados as Record<string, unknown> | null;

    return {
      prefix: (dados?.prefix as string) ?? tabela.codigo ?? '',
      id: tabela.chave.toString(),
      userId: userId.toString(),
      createdAt: tabela.criadoEm,
    };
  }
}
