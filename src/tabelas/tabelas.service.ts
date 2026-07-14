import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { ProjectRefService } from '../projects/project-ref.service';
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
 * idClasses de DTabela cujo `dEntidadeId` é o **escopo do projeto** (ADR-V2-058/059).
 *
 * Esses lookups são gravados pelo seed/bootstrap com a chave da DEntidade-espelho
 * (`E`), mas os consumidores (frontend, MCP) passam `dEntidadeId={projectId}` (`P`)
 * na query. Para esses idClasses — e SOMENTE esses — o `dEntidadeId` recebido é
 * resolvido `P→E` antes de filtrar (legacy-safe). idClasses org/user-scoped
 * (API Keys -471, MCP Keys -472) NÃO entram aqui — seu `dEntidadeId` já é uma
 * DEntidade real (org/user) e resolver quebraria o filtro.
 */
const PROJECT_SCOPED_TABELA_CLASSES: ReadonlySet<bigint> = new Set<bigint>([
  BigInt(-420), // PRIORITY (agrupador)
  BigInt(-421), // PRIORITY HIGH
  BigInt(-422), // PRIORITY MEDIUM
  BigInt(-423), // PRIORITY LOW
  BigInt(-424), // PRIORITY URGENT
  BigInt(-430), // TASK TYPE
  BigInt(-440), // STATUS V3 (agrupador)
  BigInt(-441), // INBOX
  BigInt(-442), // READY
  BigInt(-443), // EXECUTING
  BigInt(-444), // DONE
  BigInt(-445), // FAILED
  BigInt(-446), // CANCELLED
  BigInt(-447), // DISCARDED
  BigInt(-448), // VALIDATING
  BigInt(-449), // VALIDATED
]);

/**
 * DClasses de DTabela **PROIBIDAS** no endpoint genérico `/tabelas` (F3 —
 * ADR-V2-077).
 *
 * ## Por que existe uma denylist no Pilar 2
 *
 * O Pilar 2 (endpoints genéricos) é uma virtude — até o dia em que uma linha de
 * `DTabela` passa a guardar **credencial**. É o caso de `SESSION` (-485), onde:
 *
 * - `codigo`    = `sha256(refresh token CORRENTE)`
 * - `metaDados` = `{ prevHash, jti, familyId, ... }`
 *
 * Sem esta denylist, um `GET /tabelas?idClasse=-485` autenticado devolveria
 * **os hashes de refresh token de todos os usuários** — e o `formatTabelaResponse`
 * serializa `codigo` e `metaDados` crus. Isso não é vazamento hipotético: é o
 * endpoint genérico virando o vetor de exfiltração de sessão.
 *
 * A leitura de sessão tem UM caminho autorizado, com projeção obrigatória:
 * `GET /auth/sessions` (ver `SessionResponseDto`, que nunca carrega hash).
 *
 * Resposta escolhida: **404** (e não 403). O usuário não deve nem saber que a
 * classe existe aqui — anti-enumeração (OWASP Authorization Cheat Sheet).
 */
const CLASSES_PROIBIDAS_NO_GENERICO: ReadonlySet<bigint> = new Set<bigint>([
  BigInt(-485), // SESSION — codigo = hash do refresh token
]);

/**
 * Service canônico para DTabela (Pilar 2 — Endpoints Genéricos).
 *
 * Serve todos os lookups, configs e catálogos:
 * - Status V3 (-440), Priorities (-420), Task Types (-430)
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectRef: ProjectRefService,
  ) {}

  /**
   * Barra classes de credencial no endpoint genérico (F3 — ADR-V2-077).
   *
   * Chamado em TODA porta de entrada do service (list, get, create, update,
   * delete). 404 — nunca 403 — para não confirmar a existência da classe.
   *
   * @param idClasse - Classe resolvida da requisição
   * @throws {NotFoundException} Se a classe for denylisted (ex.: SESSION -485)
   */
  private assertClasseNaoProibida(idClasse: bigint): void {
    if (!CLASSES_PROIBIDAS_NO_GENERICO.has(idClasse)) return;

    this.logger.warn(
      `[SEGURANÇA] Tentativa de acesso a DClasse denylisted via /tabelas: ${idClasse}. ` +
        `Sessões só podem ser lidas via GET /auth/sessions (projeção segura).`,
    );
    throw new NotFoundException(`DClasse ${idClasse} não encontrada`);
  }

  /**
   * Resolve idClasse a partir do query (canônico ou alias deprecated).
   *
   * @param query - Query DTO
   * @param res - Response Express para headers de deprecation
   * @returns bigint resolvida
   * @throws {BadRequestException} Se ambos ou nenhum presente
   * @throws {NotFoundException} Se a classe for denylisted (SESSION — ADR-V2-077)
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
      const idClasse = BigInt(query.idClasse!);
      this.assertClasseNaoProibida(idClasse);
      return idClasse;
    }

    const codigoNorm = query.classe!.toUpperCase();
    const cached = classeAliasCacheTabela.get(codigoNorm);

    if (cached !== undefined) {
      // Alias `?classe=SESSION` resolve para -485 — barra aqui também.
      this.assertClasseNaoProibida(cached);
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

    this.assertClasseNaoProibida(classe.chave);

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
  async listarPorClasse(query: ListTabelaQueryDto, res?: Response): Promise<ListTabelaResponseDto> {
    const idClasse = await this.resolveIdClasse(query, res);
    await validarClasse(this.prisma, idClasse);

    const take = Math.min(query.pageSize ?? 20, 100);
    const where = buildTabelaWhereClause(idClasse, query);

    // ADR-V2-058/059: para lookups project-scoped (statuses, priorities,
    // task types), o `dEntidadeId` recebido é o projectId (P); o seed grava com a
    // DEntidade-espelho (E). Resolver P→E (legacy-safe) para que o filtro encontre
    // os registros. NÃO aplicar a idClasses org/user-scoped (API/MCP keys).
    if (query.dEntidadeId && PROJECT_SCOPED_TABELA_CLASSES.has(idClasse)) {
      const handle = await this.projectRef.resolveEntidadeRef(BigInt(query.dEntidadeId));
      where.dEntidadeId = handle;
    }

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

    // Denylist por CHAVE: sem isto, `GET /tabelas/1042` (id de uma sessão)
    // devolveria a linha inteira — com o hash do refresh token no `codigo`.
    this.assertClasseNaoProibida(tabela.idClasse);

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
   * const status = await service.criar({ idClasse: '-440', nome: 'Em Revisão' });
   * ```
   */
  async criar(dto: CreateTabelaDto): Promise<TabelaResponseDto> {
    const idClasse = BigInt(dto.idClasse);
    this.assertClasseNaoProibida(idClasse);
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
