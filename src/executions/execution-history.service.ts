import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EntidadeService } from '../entidades/entidades.service';
import {
  ExecutionResponseDto,
  serializeExecution,
  RISK_CLASSE_MAP,
} from './dto/execution-response.dto';
import { ListExecutionsQueryDto } from './dto/list-executions-query.dto';

/** idClasses de membership em projeto (DVincula) */
const PROJECT_MEMBERSHIP_CLASSES = [BigInt(-170), BigInt(-171), BigInt(-172), BigInt(-173)];

/** Mapa riskLevel → idClasse para filtro */
const RISK_LEVEL_TO_CLASSE: Record<string, bigint> = {
  LOW: BigInt(-301),
  MEDIUM: BigInt(-302),
  HIGH: BigInt(-303),
};

/** idClasses de execução */
const EXECUTION_CLASSES = [BigInt(-301), BigInt(-302), BigInt(-303)];

/**
 * ExecutionHistoryService — consulta de executions (DPedido idClasse=-301|-302|-303).
 *
 * Implementa cursor pagination + filtros sem N+1 queries.
 * Valida membership do user via DVincula antes de expor dados.
 *
 * @see ADR-V2-006 (risco via idClasse, não campo)
 */
@Injectable()
export class ExecutionHistoryService {
  private readonly logger = new Logger(ExecutionHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entidadeService: EntidadeService,
  ) {}

  /**
   * Converte o `userId` que chega do controller (extraido do JWT — eh o
   * `DUserGroup.chave`/`sub`, NAO o entidadeId) no `DEntidade.chave`
   * usado pelos checks de membership/role em `DVincula`.
   *
   * Sem essa conversao, qualquer endpoint listava/checava role com a
   * chave de login, que nao bate com a chave de negocio onde roles vivem
   * — resultado: 403 mesmo para admins/managers legitimos.
   */
  private async resolveEntidadeId(userIdFromJwt: string): Promise<bigint> {
    return this.entidadeService.getEntidadeIdFromUserGroup(BigInt(userIdFromJwt));
  }

  /**
   * Lista executions de um projeto com cursor pagination e filtros.
   *
   * Query única em DPedido com WHERE composto — ZERO N+1.
   * Cursor: chave do último item (BigInt decrescente).
   *
   * @param query - Filtros e parâmetros de paginação
   * @param userEntidadeId - ID da DEntidade do user (para validação de acesso)
   * @returns Promise com items e nextCursor (undefined se última página)
   *
   * @throws {ForbiddenException} Se user não é membro do projeto
   */
  async findMany(
    query: ListExecutionsQueryDto,
    userIdFromJwt: string,
  ): Promise<{ items: ExecutionResponseDto[]; nextCursor?: string }> {
    const projectId = BigInt(query.projectId);
    const limit = query.limit ?? 20;
    const userEntidadeId = await this.resolveEntidadeId(userIdFromJwt);

    // Validar membership
    const membership = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: { in: PROJECT_MEMBERSHIP_CLASSES },
        idLocEscritu: projectId,
        idEntidade: userEntidadeId,
        excluido: false,
      },
    });

    if (!membership) {
      throw new ForbiddenException(`Usuário não tem acesso ao projeto ${query.projectId}.`);
    }

    // Construir filtro de idClasse (riskLevel → idClasse ou todos)
    const idClasseFilter =
      query.riskLevel && RISK_LEVEL_TO_CLASSE[query.riskLevel]
        ? { equals: RISK_LEVEL_TO_CLASSE[query.riskLevel] }
        : { in: EXECUTION_CLASSES };

    // Query com cursor pagination — ZERO N+1 (select + orderBy)
    const rows = await this.prisma.dPedido.findMany({
      where: {
        idClasse: idClasseFilter,
        idLocEscritu: projectId,
        excluido: false,
        ...(query.cursor ? { chave: { lt: BigInt(query.cursor) } } : {}),
      },
      select: {
        chave: true,
        idClasse: true,
        idPessoa: true,
        dados: true,
        aprovado: true,
        baixado: true,
        criadoEm: true,
        atualizadoEm: true,
      },
      take: limit + 1, // +1 para detectar hasMore
      orderBy: { chave: 'desc' },
    });

    // Filtro de status em memória (JSON path filter não suportado pelo Prisma ORM diretamente)
    const filteredRows = query.status
      ? rows.filter((r) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = r.dados as any;
          return d?.approval?.status === query.status;
        })
      : rows;

    const hasMore = filteredRows.length > limit;
    const items = hasMore ? filteredRows.slice(0, limit) : filteredRows;

    this.logger.debug(
      `[ExecutionHistory] project=${query.projectId} total=${items.length} hasMore=${hasMore}`,
    );

    return {
      items: items.map((row) =>
        serializeExecution({
          chave: row.chave,
          idClasse: row.idClasse,
          idPessoa: row.idPessoa,
          dados: row.dados,
          criadoEm: row.criadoEm,
          atualizadoEm: row.atualizadoEm,
        }),
      ),
      nextCursor: hasMore ? items[items.length - 1].chave.toString() : undefined,
    };
  }

  /**
   * Busca uma execution por ID com validação de acesso.
   *
   * Valida que o DPedido pertence ao projeto que o user tem acesso.
   *
   * @param executionId - ID da execution (BigInt como string)
   * @param userEntidadeId - ID da DEntidade do user
   * @returns ExecutionResponseDto
   *
   * @throws {NotFoundException} Se execution não encontrada
   * @throws {ForbiddenException} Se user não tem acesso ao projeto da execution
   */
  async findOne(executionId: string, userIdFromJwt: string): Promise<ExecutionResponseDto> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: {
        chave: BigInt(executionId),
        idClasse: { in: EXECUTION_CLASSES },
        excluido: false,
      },
      select: {
        chave: true,
        idClasse: true,
        idPessoa: true,
        idLocEscritu: true,
        dados: true,
        aprovado: true,
        baixado: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    });

    if (!pedido) {
      throw new NotFoundException(`Execution ${executionId} não encontrada.`);
    }

    // Valida acesso cross-project (security: não expor executions de outros projetos)
    if (pedido.idLocEscritu) {
      const userEntidadeId = await this.resolveEntidadeId(userIdFromJwt);
      const membership = await this.prisma.dVincula.findFirst({
        where: {
          idClasse: { in: PROJECT_MEMBERSHIP_CLASSES },
          idLocEscritu: pedido.idLocEscritu,
          idEntidade: userEntidadeId,
          excluido: false,
        },
      });

      if (!membership) {
        // Não revelar existência — lançar como 404
        throw new NotFoundException(`Execution ${executionId} não encontrada.`);
      }
    }

    return serializeExecution({
      chave: pedido.chave,
      idClasse: pedido.idClasse,
      idPessoa: pedido.idPessoa,
      dados: pedido.dados,
      criadoEm: pedido.criadoEm,
      atualizadoEm: pedido.atualizadoEm,
    });
  }

  /**
   * Retorna o mapa de riskLevel derivado do RISK_CLASSE_MAP (utilitário público).
   */
  getRiskClasseMap(): typeof RISK_CLASSE_MAP {
    return RISK_CLASSE_MAP;
  }
}
