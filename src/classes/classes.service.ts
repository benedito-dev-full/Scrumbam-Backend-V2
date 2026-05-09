import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ListClassesQueryDto } from './dto/list-classes-query.dto';
import { ClasseResponseDto, ClasseTreeDto } from './dto/classe-response.dto';

/**
 * Nó interno para montagem da árvore em memória.
 */
interface ClasseNode {
  chave: bigint;
  codigo: string | null;
  nome: string;
  idPai: bigint | null;
  agrupamento: boolean;
  inativo: boolean;
  excluido: boolean;
  excluivel: boolean;
  editavel: boolean;
  tableFields: unknown;
  filhos: ClasseNode[];
}

/**
 * Service READ-ONLY para DClasse (Pilar 2 — Endpoints Genéricos).
 *
 * DClasses são definidas pelo seed (chave negativa = responsabilidade do
 * desenvolvedor, não do usuário). Por isso este service NÃO tem métodos
 * de escrita (criar/atualizar/deletar).
 *
 * O método mais crítico é `getTree`: usa 1 `findMany` + montagem em
 * memória via Map — NUNCA recursão de queries (N+1 proibido).
 *
 * Profundidade máxima da árvore: ≤ 6 níveis (validada pelo seed de F1).
 *
 * @see ClasseController — apenas GETs
 */
@Injectable()
export class ClasseService {
  private readonly logger = new Logger(ClasseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Serializa uma DClasse para ClasseResponseDto (BigInt → string).
   */
  private formatClasse(c: ClasseNode | Omit<ClasseNode, 'filhos'>): ClasseResponseDto {
    return {
      chave: c.chave.toString(),
      codigo: c.codigo,
      nome: c.nome,
      idPai: c.idPai?.toString() ?? null,
      agrupamento: c.agrupamento,
      inativo: c.inativo,
      excluido: c.excluido,
      excluivel: c.excluivel,
      editavel: c.editavel,
      tableFields: c.tableFields,
    };
  }

  /**
   * Serializa ClasseNode para ClasseTreeDto com filhos aninhados.
   */
  private formatClasseTree(node: ClasseNode): ClasseTreeDto {
    return {
      chave: node.chave.toString(),
      codigo: node.codigo,
      nome: node.nome,
      idPai: node.idPai?.toString() ?? null,
      agrupamento: node.agrupamento,
      filhos: node.filhos.map((f) => this.formatClasseTree(f)),
    };
  }

  /**
   * Lista DClasses em formato flat com filtros opcionais.
   *
   * Retorna apenas classes ativas (excluido=false, inativo=false) por padrão.
   * Com `all=true`, retorna todas incluindo inativas e excluídas.
   *
   * @param query - Filtros opcionais (nome, codigo, idPai, all)
   * @returns Array de ClasseResponseDto
   *
   * @example
   * ```typescript
   * const sprints = await service.listarFlat({ nome: 'Sprint' });
   * // [{ chave: '-400', codigo: 'SPRINT', nome: 'Sprint', ... }]
   * ```
   */
  async listarFlat(query: ListClassesQueryDto): Promise<ClasseResponseDto[]> {
    this.logger.debug(`listarFlat query=${JSON.stringify(query)}`);

    const where: {
      excluido?: boolean;
      inativo?: boolean;
      nome?: { contains: string; mode: 'insensitive' };
      codigo?: { contains: string; mode: 'insensitive' };
      idPai?: bigint;
    } = {};

    if (!query.all) {
      where.excluido = false;
      where.inativo = false;
    }

    if (query.nome) {
      where.nome = { contains: query.nome, mode: 'insensitive' };
    }

    if (query.codigo) {
      where.codigo = { contains: query.codigo, mode: 'insensitive' };
    }

    if (query.idPai) {
      where.idPai = BigInt(query.idPai);
    }

    const classes = await this.prisma.dClasse.findMany({
      where,
      orderBy: { chave: 'asc' },
    });

    return classes.map((c) => this.formatClasse({ ...c, filhos: [] }));
  }

  /**
   * Retorna a árvore hierárquica completa de DClasses.
   *
   * CRÍTICO — N+1 ZERO:
   * Executa EXATAMENTE 1 query `findMany` para buscar TODAS as classes.
   * A montagem da árvore ocorre em memória via Map<bigint, ClasseNode>.
   * NUNCA faz query recursiva ou loop com query interna.
   *
   * Complexidade: O(n) tempo, O(n) espaço — n = número de DClasses.
   * Com 128 DClasses do seed V2, execução é instantânea.
   *
   * @param rootChave - Chave da raiz (padrão: -1 = Root)
   * @returns ClasseTreeDto aninhado com filhos recursivos
   *
   * @throws {NotFoundException} Se rootChave não encontrada na árvore
   *
   * @example
   * ```typescript
   * const tree = await service.getTree(); // root = -1
   * // { chave: '-1', nome: 'Root', filhos: [...] }
   *
   * const subTree = await service.getTree(BigInt(-51)); // subárvore de Tabelas
   * ```
   */
  async getTree(rootChave: bigint = BigInt(-1)): Promise<ClasseTreeDto> {
    this.logger.debug(`getTree rootChave=${rootChave}`);

    // 1 query — busca TODAS as classes (ativas)
    const todas = await this.prisma.dClasse.findMany({
      where: { excluido: false },
      orderBy: { chave: 'asc' },
    });

    // Montagem em memória — O(n), sem recursão de queries
    const mapa = new Map<bigint, ClasseNode>();
    todas.forEach((c) =>
      mapa.set(c.chave, {
        chave: c.chave,
        codigo: c.codigo,
        nome: c.nome,
        idPai: c.idPai,
        agrupamento: c.agrupamento,
        inativo: c.inativo,
        excluido: c.excluido,
        excluivel: c.excluivel,
        editavel: c.editavel,
        tableFields: c.tableFields,
        filhos: [],
      }),
    );

    // Conectar filhos aos pais
    todas.forEach((c) => {
      if (c.idPai && mapa.has(c.idPai)) {
        mapa.get(c.idPai)!.filhos.push(mapa.get(c.chave)!);
      }
    });

    const root = mapa.get(rootChave);
    if (!root) {
      throw new NotFoundException(`DClasse ${rootChave} não encontrada na árvore`);
    }

    return this.formatClasseTree(root);
  }

  /**
   * Busca uma DClasse por ID (chave primária).
   *
   * @param id - Chave BigInt como string
   * @returns ClasseResponseDto
   *
   * @throws {NotFoundException} Se DClasse não encontrada ou excluída
   *
   * @example
   * ```typescript
   * const sprint = await service.buscarPorId('-400');
   * // { chave: '-400', codigo: 'SPRINT', nome: 'Sprint', ... }
   * ```
   */
  async buscarPorId(id: string): Promise<ClasseResponseDto> {
    const chave = BigInt(id);
    this.logger.debug(`buscarPorId (classe) chave=${chave}`);

    const classe = await this.prisma.dClasse.findFirst({
      where: { chave, excluido: false },
    });

    if (!classe) {
      throw new NotFoundException(`DClasse ${id} não encontrada`);
    }

    return this.formatClasse({ ...classe, filhos: [] });
  }

  /**
   * Retorna os campos dinâmicos (tableFields) de uma DClasse.
   *
   * Usado para descobrir campos customizados antes de criar/editar entidades.
   *
   * @param id - Chave BigInt como string
   * @returns tableFields (Json) ou null se não definido
   *
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```typescript
   * const fields = await service.getFieldsByClasse('-150');
   * // null ou { fields: [{ name: 'cpf', type: 'string' }] }
   * ```
   */
  async getFieldsByClasse(id: string): Promise<unknown> {
    const chave = BigInt(id);

    const classe = await this.prisma.dClasse.findFirst({
      where: { chave, excluido: false },
      select: { tableFields: true, nome: true },
    });

    if (!classe) {
      throw new NotFoundException(`DClasse ${id} não encontrada`);
    }

    return classe.tableFields;
  }
}
