import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { ApiKeyResponseDto } from '../dto/api-key-response.dto';

/** idClasse da DTabela de API Keys (ADR-V2-004). */
const ID_CLASSE_API_KEY = BigInt(-471);

/**
 * Service para geração, validação e revogação de API Keys.
 *
 * API Keys são armazenadas em DTabela(-471) com:
 * - dados.hash: SHA-256 do plaintext
 * - dados.prefix: primeiros 8 chars do plaintext (identificação)
 * - dados.createdBy: DEntidade.chave.toString() do criador
 * - dados.lastUsedAt: timestamp da última utilização (ou null)
 * - dEntidadeId: ID do projeto vinculado (se aplicável)
 *
 * Implementa ADR-V2-004: API Keys em DTabela, não colunas próprias.
 *
 * @see ApiKeyGuard — guard que usa este service para validar
 * @see DTabela(-471) — armazenamento canônico
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera nova API Key vinculada a um projeto.
   *
   * Cria DTabela(-471) com hash SHA-256. Retorna plaintext UMA vez.
   *
   * @param projectId - Chave BigInt do DProject
   * @param createdBy - Chave BigInt da DEntidade do criador
   * @returns ApiKeyResponseDto com key plaintext (apenas nesta chamada)
   */
  async generate(projectId: bigint, createdBy: bigint): Promise<ApiKeyResponseDto> {
    const plaintext = `sk_live_${randomBytes(24).toString('hex')}`;
    const hash = createHash('sha256').update(plaintext).digest('hex');
    const prefix = plaintext.slice(0, 8);

    this.logger.log(`Gerando API Key para projeto=${projectId} por=${createdBy}`);

    const tabela = await this.prisma.dTabela.create({
      data: {
        idClasse: ID_CLASSE_API_KEY,
        nome: `API Key ${prefix}...`,
        codigo: prefix,
        dEntidadeId: projectId,
        dados: {
          hash,
          prefix,
          createdBy: createdBy.toString(),
          lastUsedAt: null,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      key: plaintext,
      prefix,
      id: tabela.chave.toString(),
      createdAt: tabela.criadoEm,
      projectId: projectId.toString(),
      lastUsedAt: null,
    };
  }

  /**
   * Valida uma API Key em texto plano.
   *
   * Busca DTabela(-471) ativas, compara hash SHA-256, atualiza lastUsedAt.
   *
   * Performance: para volume < 100 API Keys, filtro em app é aceitável.
   * Para volume > 100, avaliar raw query com dados->>'hash' = $1 (F14).
   *
   * @param plaintext - API Key em texto plano do header X-API-Key
   * @returns { projectId, tabelaChave } ou null se inválida
   */
  async validate(plaintext: string): Promise<{ projectId: bigint | null; tabelaChave: bigint } | null> {
    const hash = createHash('sha256').update(plaintext).digest('hex');

    const apiKeys = await this.prisma.dTabela.findMany({
      where: {
        idClasse: ID_CLASSE_API_KEY,
        excluido: false,
        inativo: false,
      },
      select: {
        chave: true,
        dEntidadeId: true,
        dados: true,
      },
    });

    const match = apiKeys.find((k) => {
      const dados = k.dados as Record<string, unknown> | null;
      return dados?.hash === hash;
    });

    if (!match) {
      return null;
    }

    // Atualizar lastUsedAt de forma assíncrona (não bloqueia a response)
    this.prisma.dTabela
      .update({
        where: { chave: match.chave },
        data: {
          dados: {
            ...(match.dados as Record<string, unknown>),
            lastUsedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      })
      .catch((err: Error) => this.logger.error(`Falha ao atualizar lastUsedAt API Key: ${err.message}`));

    return {
      projectId: match.dEntidadeId,
      tabelaChave: match.chave,
    };
  }

  /**
   * Revoga uma API Key (soft-delete em DTabela).
   *
   * @param id - Chave BigInt da DTabela da API Key
   * @throws {NotFoundException} Se API Key não encontrada
   */
  async revoke(id: bigint): Promise<void> {
    const exists = await this.prisma.dTabela.findFirst({
      where: { chave: id, idClasse: ID_CLASSE_API_KEY, excluido: false },
      select: { chave: true },
    });

    if (!exists) {
      throw new NotFoundException(`API Key ${id} não encontrada`);
    }

    this.logger.log(`Revogando API Key id=${id}`);

    await this.prisma.dTabela.update({
      where: { chave: id },
      data: { excluido: true },
    });
  }

  /**
   * Lista API Keys de um projeto (sem expor hashes).
   *
   * @param projectId - Chave BigInt do projeto
   * @returns Lista de ApiKeyResponseDto sem campo key (plaintext)
   */
  async listByProject(projectId: bigint): Promise<ApiKeyResponseDto[]> {
    const tabelas = await this.prisma.dTabela.findMany({
      where: {
        idClasse: ID_CLASSE_API_KEY,
        dEntidadeId: projectId,
        excluido: false,
      },
      orderBy: { criadoEm: 'desc' },
    });

    return tabelas.map((t) => {
      const dados = t.dados as Record<string, unknown> | null;
      return {
        prefix: (dados?.prefix as string) ?? t.codigo ?? '',
        id: t.chave.toString(),
        createdAt: t.criadoEm,
        projectId: projectId.toString(),
        lastUsedAt: dados?.lastUsedAt ? new Date(dados.lastUsedAt as string) : null,
      };
    });
  }
}
