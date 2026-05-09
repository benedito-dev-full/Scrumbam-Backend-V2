import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { LRUCache } from '../common/helpers/lru-cache';
import { buildEntidadeWhereClause } from './helpers/build-where-clause';
import { formatEntidadeResponse, formatEntidadeList } from './helpers/format-entidade-response';
import { ListEntidadeQueryDto } from './dto/list-entidade-query.dto';
import { CreateEntidadeDto } from './dto/create-entidade.dto';
import { UpdateEntidadeDto } from './dto/update-entidade.dto';
import { EntidadeResponseDto } from './dto/entidade-response.dto';
import { ListEntidadeResponseDto } from './dto/list-entidade-response.dto';

/** Cache LRU para alias ?classe=NOME → idClasse (ADR-V2-015). TTL 5min. */
const classeAliasCache = new LRUCache<string, bigint>(200, 300_000);

/** Data de sunset do alias ?classe=NOME (2 sprints ≈ 4 semanas a partir de F2). */
const CLASSE_ALIAS_SUNSET = new Date('2026-06-05T00:00:00.000Z').toISOString();

/**
 * Service canônico para DEntidade (Pilar 2 — Endpoints Genéricos).
 *
 * Implementa CRUD completo para DEntidade polimórfica usando Prisma direto
 * (tabela estrutural — Pilar 1 não se aplica aqui, apenas em DPedido).
 *
 * Padrões aplicados:
 * - BigInt SEMPRE (nunca parseInt/Number)
 * - N+1 ZERO (include com select no findMany)
 * - Transaction para operações multi-tabela (criar entidade + DEvento)
 * - Soft-delete (excluido=true, nunca DELETE físico)
 * - Wrapper ?classe=NOME com LRU cache (ADR-V2-015, deprecated)
 *
 * @see PrismaService — única forma de acessar o banco
 * @see EntidadeController — controller que orquestra este service
 */
@Injectable()
export class EntidadeService {
  private readonly logger = new Logger(EntidadeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valida a existência de uma DClasse no banco.
   *
   * Chamado antes de qualquer operação que use idClasse.
   * Lança 404 se a DClasse não existir ou estiver excluída.
   *
   * @param idClasse - Chave BigInt da DClasse
   * @throws {NotFoundException} Se DClasse não encontrada
   */
  private async validarClasse(idClasse: bigint): Promise<void> {
    const classe = await this.prisma.dClasse.findFirst({
      where: { chave: idClasse, excluido: false },
      select: { chave: true, nome: true },
    });
    if (!classe) {
      throw new NotFoundException(`DClasse ${idClasse} não encontrada`);
    }
  }

  /**
   * Resolve idClasse a partir do query (idClasse canônico ou alias classe deprecated).
   *
   * ADR-V2-015:
   * - `?idClasse=N` → canônico, usa direto
   * - `?classe=NOME` → deprecated, busca via LRU cache, emite Logger.warn + header Deprecation
   * - Ambos → 400 BadRequest
   * - Nenhum → 400 BadRequest
   *
   * @param query - Query DTO com idClasse e/ou classe
   * @param res - Response Express para setar headers de deprecation (opcional)
   * @returns bigint da DClasse resolvida
   * @throws {BadRequestException} Se ambos ou nenhum presente
   * @throws {NotFoundException} Se alias não encontrado no banco
   */
  async resolveIdClasse(query: ListEntidadeQueryDto, res?: Response): Promise<bigint> {
    const hasIdClasse = !!query.idClasse;
    const hasClasse = !!query.classe;

    if (hasIdClasse && hasClasse) {
      throw new BadRequestException(
        'Use `?idClasse=N` ou `?classe=NOME`, não ambos simultaneamente',
      );
    }

    if (!hasIdClasse && !hasClasse) {
      throw new BadRequestException(
        'Parâmetro obrigatório ausente: informe `?idClasse=N` (ex: ?idClasse=-150)',
      );
    }

    if (hasIdClasse) {
      return BigInt(query.idClasse!);
    }

    // Alias deprecated ?classe=NOME
    const codigoNorm = query.classe!.toUpperCase();

    // Verificar cache LRU primeiro
    const cached = classeAliasCache.get(codigoNorm);
    if (cached !== undefined) {
      this.logger.warn(
        `[DEPRECATED ADR-V2-015] ?classe=${query.classe} usado — migre para ?idClasse=${cached}`,
      );
      if (res) {
        res.setHeader('Deprecation', 'true');
        res.setHeader('Sunset', CLASSE_ALIAS_SUNSET);
        res.setHeader(
          'Link',
          `</api/v1/entidades?idClasse=${cached}>; rel="successor-version"`,
        );
      }
      return cached;
    }

    // Buscar no banco se não está no cache
    const classe = await this.prisma.dClasse.findFirst({
      where: { codigo: codigoNorm, excluido: false },
      select: { chave: true },
    });

    if (!classe) {
      throw new NotFoundException(`DClasse com codigo "${query.classe}" não encontrada`);
    }

    classeAliasCache.set(codigoNorm, classe.chave);

    this.logger.warn(
      `[DEPRECATED ADR-V2-015] ?classe=${query.classe} (chave=${classe.chave}) — migre para ?idClasse=${classe.chave}`,
    );

    if (res) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', CLASSE_ALIAS_SUNSET);
      res.setHeader(
        'Link',
        `</api/v1/entidades?idClasse=${classe.chave}>; rel="successor-version"`,
      );
    }

    return classe.chave;
  }

  /**
   * Lista entidades por classe com cursor pagination (N+1 ZERO).
   *
   * Executa 1 query com JOIN (include classe) — nunca N+1.
   * Valida DClasse antes da query principal (404 se inexistente).
   * Suporta filtros por nome, codigo, idEstab e cursor.
   *
   * @param query - Filtros e paginação
   * @param res - Response Express para headers de deprecation do alias ?classe=NOME
   * @returns Lista paginada com hasMore e nextCursor
   *
   * @throws {BadRequestException} Se ambos ou nenhum de idClasse/classe fornecido
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```typescript
   * const result = await service.listarPorClasse({ idClasse: '-150', pageSize: 20 });
   * // result.items → array de EntidadeResponseDto
   * // result.pagination.hasMore → boolean
   * ```
   */
  async listarPorClasse(
    query: ListEntidadeQueryDto,
    res?: Response,
  ): Promise<ListEntidadeResponseDto> {
    const idClasse = await this.resolveIdClasse(query, res);
    await this.validarClasse(idClasse);

    const take = Math.min(query.pageSize ?? 20, 100);
    const where = buildEntidadeWhereClause(idClasse, query);

    this.logger.debug(`listarPorClasse idClasse=${idClasse} take=${take}`);

    // 1 query com JOIN (include classe) — N+1 ZERO
    const entidades = await this.prisma.dEntidade.findMany({
      where,
      include: {
        classe: { select: { codigo: true, nome: true } },
      },
      take: take + 1, // +1 para detectar hasMore
      orderBy: { chave: 'desc' },
    });

    const hasMore = entidades.length > take;
    const items = hasMore ? entidades.slice(0, take) : entidades;
    const nextCursor = hasMore ? items[items.length - 1].chave.toString() : null;

    return {
      items: formatEntidadeList(items),
      pagination: { hasMore, nextCursor },
    };
  }

  /**
   * Busca uma entidade por ID (chave primária).
   *
   * @param id - Chave BigInt da DEntidade (string que será convertida)
   * @returns EntidadeResponseDto serializada
   *
   * @throws {NotFoundException} Se entidade não encontrada ou excluída
   *
   * @example
   * ```typescript
   * const entidade = await service.buscarPorId('150');
   * ```
   */
  async buscarPorId(id: string): Promise<EntidadeResponseDto> {
    const chave = BigInt(id);
    this.logger.debug(`buscarPorId chave=${chave}`);

    const entidade = await this.prisma.dEntidade.findFirst({
      where: { chave, excluido: false },
      include: {
        classe: { select: { codigo: true, nome: true } },
      },
    });

    if (!entidade) {
      throw new NotFoundException(`Entidade ${id} não encontrada`);
    }

    return formatEntidadeResponse(entidade);
  }

  /**
   * Cria nova entidade com audit log inline (DEvento -497).
   *
   * Executa em transaction atômica para garantir que a entidade e o
   * DEvento de audit sejam criados juntos ou não sejam criados.
   *
   * Valida DClasse antes de inserir (404 se inexistente).
   * Nota: EventProducerService (F7) substituirá o DEvento inline.
   *
   * @param dto - Dados da nova entidade
   * @returns EntidadeResponseDto da entidade criada
   *
   * @throws {NotFoundException} Se DClasse não encontrada
   * @throws {ConflictException} Se já existe entidade com mesmo email (quando informado)
   *
   * @example
   * ```typescript
   * const nova = await service.criar({
   *   idClasse: '-150',
   *   nome: 'João Silva',
   *   email: 'joao@empresa.com',
   * });
   * ```
   */
  async criar(dto: CreateEntidadeDto): Promise<EntidadeResponseDto> {
    const idClasse = BigInt(dto.idClasse);
    await this.validarClasse(idClasse);

    // Verificar duplicidade de email (quando informado)
    if (dto.email) {
      const existing = await this.prisma.dEntidade.findFirst({
        where: { email: dto.email, excluido: false },
        select: { chave: true },
      });
      if (existing) {
        throw new ConflictException(`Já existe uma entidade com o email "${dto.email}"`);
      }
    }

    this.logger.log(`criar entidade idClasse=${idClasse} nome="${dto.nome}"`);

    const entidade = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dEntidade.create({
        data: {
          idClasse,
          nome: dto.nome,
          ...(dto.email && { email: dto.email }),
          ...(dto.codigo && { codigo: dto.codigo }),
          ...(dto.cpfCnpj && { cpfCnpj: dto.cpfCnpj }),
          ...(dto.telefone && { telefone: dto.telefone }),
          ...(dto.celular && { celular: dto.celular }),
          ...(dto.endereco && { endereco: dto.endereco }),
          ...(dto.bairro && { bairro: dto.bairro }),
          ...(dto.cep && { cep: dto.cep }),
          ...(dto.idEstab && { idEstab: BigInt(dto.idEstab) }),
          ...(dto.idLocEscritu && { idLocEscritu: BigInt(dto.idLocEscritu) }),
          ...(dto.dados && { dados: dto.dados as Prisma.InputJsonValue }),
        },
        include: {
          classe: { select: { codigo: true, nome: true } },
        },
      });

      // Audit log inline — substituído por EventProducerService em F7
      await tx.dEvento.create({
        data: {
          idClasse: BigInt(-497),
          idEntidade: created.chave,
          descricao: `entity.created: ${created.nome}`,
          metaDados: { idClasse: created.idClasse.toString(), tipo: 'entity.created' },
        },
      });

      return created;
    });

    return formatEntidadeResponse(entidade);
  }

  /**
   * Atualiza campos de uma entidade existente.
   *
   * Apenas os campos presentes no DTO são atualizados (PATCH semântico).
   * `idClasse` é imutável — não pode ser alterado.
   *
   * @param id - Chave BigInt da entidade (string)
   * @param dto - Campos a atualizar
   * @returns EntidadeResponseDto atualizada
   *
   * @throws {NotFoundException} Se entidade não encontrada
   *
   * @example
   * ```typescript
   * const updated = await service.atualizar('150', { email: 'novo@empresa.com' });
   * ```
   */
  async atualizar(id: string, dto: UpdateEntidadeDto): Promise<EntidadeResponseDto> {
    const chave = BigInt(id);
    await this.buscarPorId(id); // lança 404 se não existe

    this.logger.log(`atualizar entidade chave=${chave}`);

    const entidade = await this.prisma.dEntidade.update({
      where: { chave },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.codigo !== undefined && { codigo: dto.codigo }),
        ...(dto.cpfCnpj !== undefined && { cpfCnpj: dto.cpfCnpj }),
        ...(dto.telefone !== undefined && { telefone: dto.telefone }),
        ...(dto.celular !== undefined && { celular: dto.celular }),
        ...(dto.endereco !== undefined && { endereco: dto.endereco }),
        ...(dto.bairro !== undefined && { bairro: dto.bairro }),
        ...(dto.cep !== undefined && { cep: dto.cep }),
        ...(dto.inativo !== undefined && { inativo: dto.inativo }),
        ...(dto.dados !== undefined && { dados: dto.dados as Prisma.InputJsonValue }),
      },
      include: {
        classe: { select: { codigo: true, nome: true } },
      },
    });

    return formatEntidadeResponse(entidade);
  }

  /**
   * Soft-delete de entidade (marca excluido=true, nunca DELETE físico).
   *
   * @param id - Chave BigInt da entidade (string)
   *
   * @throws {NotFoundException} Se entidade não encontrada
   *
   * @example
   * ```typescript
   * await service.softDelete('150');
   * ```
   */
  async softDelete(id: string): Promise<void> {
    const chave = BigInt(id);
    await this.buscarPorId(id); // lança 404 se não existe

    this.logger.log(`softDelete entidade chave=${chave}`);

    await this.prisma.dEntidade.update({
      where: { chave },
      data: { excluido: true },
    });
  }

  /**
   * Converte chave de DUserGroup para chave de DEntidade associada.
   *
   * Padrão canônico Devari-Core #5: DUserGroup (credenciais) é diferente
   * de DEntidade (cadastro). FKs para dados cadastrais usam chave de DEntidade.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns Chave BigInt da DEntidade associada
   *
   * @throws {NotFoundException} Se DEntidade não encontrada para o userGroup
   *
   * @example
   * ```typescript
   * const entidadeId = await service.getEntidadeIdFromUserGroup(userId);
   * // Usar entidadeId em FKs de DEvento, DVincula, etc.
   * ```
   */
  async getEntidadeIdFromUserGroup(userGroupId: bigint): Promise<bigint> {
    this.logger.debug(`getEntidadeIdFromUserGroup userGroupId=${userGroupId}`);

    const entidade = await this.prisma.dEntidade.findFirst({
      where: {
        dUserGroupId: userGroupId,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!entidade) {
      throw new NotFoundException(
        `DEntidade não encontrada para DUserGroup ${userGroupId}`,
      );
    }

    return entidade.chave;
  }

  /**
   * Retorna campos dinâmicos (tableFields) de uma DClasse.
   *
   * Usado pelo endpoint GET /entidades/fields para que o frontend
   * saiba quais campos customizados renderizar para um tipo específico.
   *
   * @param idClasseStr - ID da DClasse como string
   * @returns tableFields Json da DClasse, ou null se não definido
   *
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```typescript
   * const fields = await service.getFieldsByClasse('-150');
   * // null ou { fields: [{ name: 'cpf', type: 'string', required: true }] }
   * ```
   */
  async getFieldsByClasse(idClasseStr: string): Promise<unknown> {
    const idClasse = BigInt(idClasseStr);

    const classe = await this.prisma.dClasse.findFirst({
      where: { chave: idClasse, excluido: false },
      select: { tableFields: true, nome: true },
    });

    if (!classe) {
      throw new NotFoundException(`DClasse ${idClasseStr} não encontrada`);
    }

    return classe.tableFields;
  }

  /**
   * Cria Seller (DEntidade -47) com Conta Virtual (-40) em transaction atômica.
   *
   * Método canônico do template Devari-Core para criação de entidades com
   * entidades vinculadas. Demonstra o padrão correto: Service + Prisma direto
   * em $transaction (NÃO Engine — Seller é cadastro estrutural, não transacional).
   *
   * Cria:
   * 1. DEntidade -47 (Seller)
   * 2. DEntidade -40 (Conta Virtual) vinculada ao Seller via idLocEscritu
   *
   * @param dto - Dados do Seller
   * @returns DEntidade do Seller criado (sem a Conta Virtual no response)
   *
   * @throws {NotFoundException} Se DClasse -47 ou -40 não encontrada no seed
   *
   * @example
   * ```typescript
   * const seller = await service.createSeller({
   *   idClasse: '-47',
   *   nome: 'Loja XYZ',
   *   idEstab: '100', // ID do Marketplace pai
   * });
   * ```
   */
  async createSeller(dto: CreateEntidadeDto): Promise<EntidadeResponseDto> {
    const idClasseSeller = BigInt(-47);
    const idClasseContaVirtual = BigInt(-40);

    await this.validarClasse(idClasseSeller);
    await this.validarClasse(idClasseContaVirtual);

    this.logger.log(`createSeller nome="${dto.nome}"`);

    const seller = await this.prisma.$transaction(async (tx) => {
      const createdSeller = await tx.dEntidade.create({
        data: {
          idClasse: idClasseSeller,
          nome: dto.nome,
          ...(dto.email && { email: dto.email }),
          ...(dto.codigo && { codigo: dto.codigo }),
          ...(dto.cpfCnpj && { cpfCnpj: dto.cpfCnpj }),
          ...(dto.idEstab && { idEstab: BigInt(dto.idEstab) }),
          ...(dto.dados && { dados: dto.dados as Prisma.InputJsonValue }),
        },
        include: {
          classe: { select: { codigo: true, nome: true } },
        },
      });

      // Criar Conta Virtual vinculada ao Seller
      await tx.dEntidade.create({
        data: {
          idClasse: idClasseContaVirtual,
          nome: `Conta Virtual — ${createdSeller.nome}`,
          idLocEscritu: createdSeller.chave,
        },
      });

      // Audit log
      await tx.dEvento.create({
        data: {
          idClasse: BigInt(-497),
          idEntidade: createdSeller.chave,
          descricao: `entity.created: seller ${createdSeller.nome}`,
          metaDados: { idClasse: idClasseSeller.toString(), tipo: 'seller.created' },
        },
      });

      return createdSeller;
    });

    return formatEntidadeResponse(seller);
  }
}
