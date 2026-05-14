import { Controller, Get, Logger, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgTenantGuard } from '../auth/guards/org-tenant.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchResponseDto } from './dto/search-response.dto';

/**
 * Controller de busca cross-entity do Scrumban-Backend-V2.
 *
 * Expõe o endpoint GET /search com busca unificada em DTask, DProject e
 * DEntidade USER (-150) no workspace da organização do usuário autenticado.
 *
 * Controller próprio JUSTIFICADO (Pilar 2 — ADR-V2-009):
 * - Acessa 3 tabelas estruturais distintas em uma request
 * - Aplica lógica de tenant isolation cruzada (DTask→DProject→org, DVincula→org)
 * - Retorna resultado categorizado — impossível mapear para /entidades ou /tabelas
 *
 * F8 é read-only puro:
 * - ZERO Engine/Operacao, ZERO INSERT/UPDATE/DELETE
 * - ZERO emissão de eventos
 * - organizationId sempre do JWT (nunca de query param)
 *
 * Guards: JwtAuthGuard + OrgTenantGuard
 *
 * @see SearchService — executa as 3 queries paralelas
 */
@ApiTags('search')
@Controller('search')
@UseGuards(JwtAuthGuard, OrgTenantGuard)
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchService: SearchService) {}

  /**
   * Busca cross-entity no workspace da organização autenticada.
   *
   * Executa 3 queries Prisma em paralelo (Promise.all):
   * 1. DTask — tasks que combinam com `q` (nome ou descrição)
   * 2. DProject — projetos que combinam com `q` (nome)
   * 3. DEntidade USER (-150) — membros da org que combinam com `q` (nome ou email)
   *
   * Tenant isolation aplicado automaticamente via JWT (organizationId):
   * - DTask: scopado via JOIN DProject.idEstab = orgId
   * - DProject: scopado via idEstab = orgId
   * - DEntidade USER: scopado via DVincula membership (-161/-162/-163)
   *
   * Distribuição de limite fixa (DA-4):
   * - Tasks: ceil(limit * 0.5) — mínimo 1
   * - Projects: ceil(limit * 0.3) — mínimo 1
   * - People: ceil(limit * 0.2) — mínimo 1
   *
   * Paginação com cursors independentes por categoria (DA-2).
   * Passar cursor na próxima request para continuar de onde parou.
   *
   * @param query - Query params de busca e paginação (validados via DTO)
   * @param user - Usuário autenticado extraído do JWT
   * @returns SearchResponseDto com tasks, projects, people, cursors e meta
   *
   * @throws {UnauthorizedException} Se token JWT inválido ou ausente
   * @throws {ForbiddenException} Se organização inválida (OrgTenantGuard)
   * @throws {BadRequestException} Se `q` não atingir mín 2 chars ou params inválidos
   *
   * @example
   * ```bash
   * # Busca básica
   * curl -X GET "http://localhost:3000/search?q=login" \
   *   -H "Authorization: Bearer {token}"
   *
   * # Busca com paginação (segunda página de tasks)
   * curl -X GET "http://localhost:3000/search?q=auth&taskCursor=523" \
   *   -H "Authorization: Bearer {token}"
   *
   * # Busca filtrada por projeto
   * curl -X GET "http://localhost:3000/search?q=bug&projectId=42&limit=10" \
   *   -H "Authorization: Bearer {token}"
   * ```
   *
   * @example
   * ```json
   * // Response 200 OK
   * {
   *   "tasks": [{ "chave": "523", "nome": "Implementar login OAuth", "criadoEm": "..." }],
   *   "projects": [],
   *   "people": [{ "chave": "15", "nome": "João Silva", "email": "joao@..." }],
   *   "cursors": { "task": "523", "project": null, "person": null },
   *   "meta": { "q": "login", "limit": 20, "organizationId": "100" }
   * }
   * ```
   */
  @Get()
  @ApiOperation({
    summary: 'Busca cross-entity no workspace',
    description:
      'Busca unificada em DTask, DProject e DEntidade USER com tenant isolation e cursor pagination por categoria.',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Termo de busca (mín 2 chars, máx 100 chars)',
    example: 'login',
  })
  @ApiQuery({
    name: 'projectId',
    required: false,
    description: 'Filtrar tasks por projeto específico (ID do DProject)',
    example: '42',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limite total de resultados (default 20, máx 50)',
    example: 20,
  })
  @ApiQuery({
    name: 'taskCursor',
    required: false,
    description: 'Cursor de paginação para tasks (chave da última task retornada)',
    example: '523',
  })
  @ApiQuery({
    name: 'projectCursor',
    required: false,
    description: 'Cursor de paginação para projetos (chave do último projeto retornado)',
    example: '41',
  })
  @ApiQuery({
    name: 'peopleCursor',
    required: false,
    description: 'Cursor de paginação para pessoas (chave da última pessoa retornada)',
    example: '15',
  })
  @ApiResponse({
    status: 200,
    type: SearchResponseDto,
    description: 'Resultados de busca cross-entity categorizados',
  })
  @ApiResponse({ status: 400, description: '`q` muito curto ou parâmetros inválidos' })
  @ApiResponse({ status: 401, description: 'Não autenticado — token JWT ausente ou inválido' })
  @ApiResponse({ status: 403, description: 'Organização inválida (OrgTenantGuard)' })
  async search(
    @Query() query: SearchQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<SearchResponseDto> {
    // OrgTenantGuard garante que organizationId está presente. Assertion
    // defensiva preserva o contrato após `JwtPayload.organizationId` virar
    // opcional (ADR-V2-040 — Etapa 1 do plano orphan-workspace).
    const organizationId = user.organizationId!;
    this.logger.log(`Search q="${query.q}" org=${organizationId} user=${user.sub}`);

    return this.searchService.search({
      q: query.q,
      organizationId,
      projectIdFilter: query.projectId,
      limit: query.limit ?? 20,
      taskCursor: query.taskCursor,
      projectCursor: query.projectCursor,
      peopleCursor: query.peopleCursor,
    });
  }
}
