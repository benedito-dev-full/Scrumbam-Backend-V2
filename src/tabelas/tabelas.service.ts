import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { LRUCache } from '../common/helpers/lru-cache';
import { validarClasse } from '../common/helpers/validar-classe.helper';
import { buildTabelaWhereClause } from './helpers/build-where-clause';
import { formatTabelaResponse } from './helpers/format-tabela-response';
import { ListTabelaQueryDto } from './dto/list-tabela-query.dto';
import { CreateTabelaDto } from './dto/create-tabela.dto';
import { UpdateTabelaDto } from './dto/update-tabela.dto';
import { TabelaResponseDto } from './dto/tabela-response.dto';
import { ListTabelaResponseDto } from './dto/list-tabela-response.dto';

/** Cache LRU compartilhado para alias ?classe=NOME (ADR-V2-015). TTL 5min. */
const classeAliasCacheTabela = new LRUCache<string, bigint>(200, 300_000);

/** Data de sunset do alias ?classe=NOME (2 sprints ≈ 4 semanas a partir de F2). */
const CLASSE_ALIAS_SUNSET = new Date('2026-06-05T00:00:00.000Z').toISOString();

/**
 * Service canônico para DTabela (Pilar 2 — Endpoints Genéricos).
 *
 * Serve todos os lookups, configs e catálogos:
 * - Sprints (-400), Status V3 (-440), Priorities (-420), Task Types (-430)
 * - Webhooks (-470), API Keys (-471), MCP Keys (-472)
 * - Canais Telegram (-460), etc.
 *
 * Mesmos padrões do EntidadeService: BigInt, N+1 ZERO, soft-delete,
 * cursor pagination, alias wrapper com LRU cache (ADR-V2-015).
 *
 * @see TabelaController — controller que orquestra este service
 */
@Injectable()
export class TabelaService {
  private readonly logger = new Logger(TabelaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve idClasse a partir do query (canônico ou alias deprecated).
   *
   * @param query - Query DTO
   * @param res - Response Express para headers de deprecation
   * @returns bigint resolvida
   * @throws {BadRequestException} Se ambos ou nenhum presente
   */
  async resolveIdClasse(query: ListTabelaQueryDto, res?: Response): Promise<bigint> {
    const hasIdClasse = !!query.idClasse;
    const hasClasse = !!query.classe;

    if (hasIdClasse && hasClasse) {
      throw new BadRequestException(
        'Use `?idClasse=N` ou `?classe=NOME`, não ambos simultaneamente',
      );
    }

    if (!hasIdClasse && !hasClasse) {
      throw new BadRequestException(
        'Parâmetro obrigatório ausente: informe `?idClasse=N` (ex: ?idClasse=-440)',
      );
    }

    if (hasIdClasse) {
      return BigInt(query.idClasse!);
    }

    const codigoNorm = query.classe!.toUpperCase();
    const cached = classeAliasCacheTabela.get(codigoNorm);

    if (cached !== undefined) {
      this.logger.warn(
        `[DEPRECATED ADR-V2-015] /tabelas?classe=${query.classe} — migre para ?idClasse=${cached}`,
      );
      if (res) {
        res.setHeader('Deprecation', 'true');
        res.setHeader('Sunset', CLASSE_ALIAS_SUNSET);
      }
      return cached;
    }

    const classe = await this.prisma.dClasse.findFirst({
      where: { codigo: codigoNorm, excluido: false },
      select: { chave: true },
    });

    if (!classe) {
      throw new NotFoundException(`DClasse com codigo "${query.classe}" não encontrada`);
    }

    classeAliasCacheTabela.set(codigoNorm, classe.chave);

    this.logger.warn(
      `[DEPRECATED ADR-V2-015] /tabelas?classe=${query.classe} (chave=${classe.chave}) — migre para ?idClasse=${classe.chave}`,
    );

    if (res) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', CLASSE_ALIAS_SUNSET);
    }

    return classe.chave;
  }

  /**
   * Lista tabelas por classe com cursor pagination (N+1 ZERO).
   *
   * @param query - Filtros e paginação
   * @param res - Response Express para headers de deprecation
   * @returns Lista paginada com hasMore e nextCursor
   *
   * @throws {BadRequestException} Se parâmetros inválidos
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```typescript
   * const statuses = await service.listarPorClasse({ idClasse: '-440' });
   * // 9 statuses V3 do seed
   * ```
   */
  async listarPorClasse(
    query: ListTabelaQueryDto,
    res?: Response,
  ): Promise<ListTabelaResponseDto> {
    const idClasse = await this.resolveIdClasse(query, res);
    await validarClasse(this.prisma, idClasse);

    const take = Math.min(query.pageSize ?? 20, 100);
    const where = buildTabelaWhereClause(idClasse, query);

    this.logger.debug(`listarPorClasse (tabela) idClasse=${idClasse} take=${take}`);

    // 1 query com JOIN — N+1 ZERO
    const tabelas = await this.prisma.dTabela.findMany({
      where,
      include: {
        classe: { select: { codigo: true, nome: true } },
      },
      take: take + 1,
      orderBy: { chave: 'desc' },
    });

    const hasMore = tabelas.length > take;
    const items = hasMore ? tabelas.slice(0, take) : tabelas;
    const nextCursor = hasMore ? items[items.length - 1].chave.toString() : null;

    return {
      items: items.map(formatTabelaResponse),
      pagination: { hasMore, nextCursor },
    };
  }

  /**
   * Busca tabela por ID (chave primária).
   *
   * @param id - Chave BigInt como string
   * @returns TabelaResponseDto serializada
   *
   * @throws {NotFoundException} Se não encontrada ou excluída
   */
  async buscarPorId(id: string): Promise<TabelaResponseDto> {
    const chave = BigInt(id);
    this.logger.debug(`buscarPorId (tabela) chave=${chave}`);

    const tabela = await this.prisma.dTabela.findFirst({
      where: { chave, excluido: false },
      include: {
        classe: { select: { codigo: true, nome: true } },
      },
    });

    if (!tabela) {
      throw new NotFoundException(`Tabela ${id} não encontrada`);
    }

    return formatTabelaResponse(tabela);
  }

  /**
   * Cria novo lookup/config.
   *
   * @param dto - Dados do novo registro
   * @returns TabelaResponseDto criada
   *
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```typescript
   * const sprint = await service.criar({ idClasse: '-400', nome: 'Sprint 1' });
   * ```
   */
  async criar(dto: CreateTabelaDto): Promise<TabelaResponseDto> {
    const idClasse = BigInt(dto.idClasse);
    await validarClasse(this.prisma, idClasse);

    this.logger.log(`criar tabela idClasse=${idClasse} nome="${dto.nome}"`);

    const tabela = await this.prisma.dTabela.create({
      data: {
        idClasse,
        nome: dto.nome,
        ...(dto.codigo && { codigo: dto.codigo }),
        ...(dto.descricao && { descricao: dto.descricao }),
        ...(dto.dEntidadeId && { dEntidadeId: BigInt(dto.dEntidadeId) }),
        ...(dto.dados && { dados: dto.dados as Prisma.InputJsonValue }),
      },
      include: {
        classe: { select: { codigo: true, nome: true } },
      },
    });

    return formatTabelaResponse(tabela);
  }

  /**
   * Atualiza campos de um lookup/config.
   *
   * @param id - Chave BigInt como string
   * @param dto - Campos a atualizar
   * @returns TabelaResponseDto atualizada
   *
   * @throws {NotFoundException} Se não encontrada
   */
  async atualizar(id: string, dto: UpdateTabelaDto): Promise<TabelaResponseDto> {
    const chave = BigInt(id);
    await this.buscarPorId(id);

    this.logger.log(`atualizar tabela chave=${chave}`);

    const tabela = await this.prisma.dTabela.update({
      where: { chave },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        ...(dto.codigo !== undefined && { codigo: dto.codigo }),
        ...(dto.descricao !== undefined && { descricao: dto.descricao }),
        ...(dto.inativo !== undefined && { inativo: dto.inativo }),
        ...(dto.dados !== undefined && { dados: dto.dados as Prisma.InputJsonValue }),
      },
      include: {
        classe: { select: { codigo: true, nome: true } },
      },
    });

    return formatTabelaResponse(tabela);
  }

  /**
   * Soft-delete de tabela lookup/config.
   *
   * @param id - Chave BigInt como string
   * @throws {NotFoundException} Se não encontrada
   */
  async softDelete(id: string): Promise<void> {
    const chave = BigInt(id);
    await this.buscarPorId(id);

    this.logger.log(`softDelete tabela chave=${chave}`);

    await this.prisma.dTabela.update({
      where: { chave },
      data: { excluido: true },
    });
  }
}
