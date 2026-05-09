import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { ClasseService } from './classes.service';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { ListClassesQueryDto } from './dto/list-classes-query.dto';
import { ClasseResponseDto, ClasseTreeDto } from './dto/classe-response.dto';

/**
 * Controller READ-ONLY para DClasse (Pilar 2 — Endpoints Genéricos).
 *
 * DClasses são definidas pelo seed (chave negativa = responsabilidade do
 * desenvolvedor). Portanto este controller NÃO tem POST/PATCH/DELETE —
 * qualquer tentativa de criar DClasse via API retorna 403 com mensagem clara.
 *
 * Endpoints disponíveis:
 * - GET /classes → lista flat com filtros
 * - GET /classes/tree → árvore hierárquica aninhada
 * - GET /classes/:id → busca por ID
 * - GET /classes/:id/fields → tableFields para formulários dinâmicos
 *
 * @see ClasseService — lógica de negócio (read-only)
 */
@ApiTags('classes')
@ApiBearerAuth()
@ApiHeader({ name: 'X-API-Key', required: false, description: 'API Key alternativa ao JWT' })
@UseGuards(AuthCompositeGuard)
@Controller('classes')
export class ClasseController {
  constructor(private readonly classeService: ClasseService) {}

  /**
   * Lista DClasses em formato flat com filtros opcionais.
   *
   * Retorna classes ativas por padrão (excluido=false, inativo=false).
   *
   * @param query - Filtros opcionais
   * @returns Array de ClasseResponseDto
   *
   * @example
   * ```bash
   * curl 'http://localhost:3000/api/v1/classes?nome=Sprint'
   * # retorna DClasse -400 SPRINT
   * ```
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lista DClasses (flat) com filtros',
    description: 'Retorna DClasses ativas. Use ?all=true para incluir inativas/excluídas.',
  })
  @ApiQuery({ name: 'nome', required: false, description: 'Filtro por nome (parcial)', example: 'Sprint' })
  @ApiQuery({ name: 'codigo', required: false, description: 'Filtro por código', example: 'SPRINT' })
  @ApiQuery({ name: 'idPai', required: false, description: 'Filtro por DClasse pai', example: '-51' })
  @ApiQuery({ name: 'all', required: false, description: 'Incluir inativas/excluídas?', example: false })
  @ApiResponse({ status: 200, description: 'Lista de DClasses', type: [ClasseResponseDto] })
  async listarFlat(@Query() query: ListClassesQueryDto): Promise<ClasseResponseDto[]> {
    return this.classeService.listarFlat(query);
  }

  /**
   * Retorna árvore hierárquica de DClasses.
   *
   * PERFORMANCE: executa 1 query + montagem em memória (N+1 ZERO).
   * Com 128 DClasses do seed V2, retorna em <10ms.
   *
   * @param rootChave - Chave da raiz (padrão: -1 = Root)
   * @returns ClasseTreeDto aninhado
   *
   * @throws {NotFoundException} Se rootChave não encontrada
   *
   * @example
   * ```bash
   * curl 'http://localhost:3000/api/v1/classes/tree'
   * # { "chave": "-1", "nome": "Root", "filhos": [...] }
   * ```
   */
  @Get('tree')
  @ApiOperation({
    summary: 'Retorna árvore hierárquica de DClasses',
    description: '1 query + montagem em memória (N+1 ZERO). Profundidade ≤ 6.',
  })
  @ApiQuery({ name: 'rootChave', required: false, description: 'Chave da raiz (padrão: -1)', example: '-1' })
  @ApiResponse({ status: 200, description: 'Árvore de DClasses', type: ClasseTreeDto })
  @ApiResponse({ status: 404, description: 'rootChave não encontrada' })
  async getTree(@Query('rootChave') rootChave?: string): Promise<ClasseTreeDto> {
    const root = rootChave ? BigInt(rootChave) : BigInt(-1);
    return this.classeService.getTree(root);
  }

  /**
   * Retorna campos dinâmicos (tableFields) de uma DClasse.
   *
   * Atenção: rota /:id/fields DEVE ser registrada ANTES de /:id para evitar
   * que "fields" seja interpretado como um ID numérico.
   * Na prática, "fields" não é um número válido, mas a ordem explícita é mais segura.
   *
   * @param id - Chave BigInt da DClasse
   * @returns tableFields (Json) ou null
   *
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```bash
   * curl 'http://localhost:3000/api/v1/classes/-150/fields'
   * ```
   */
  @Get(':id/fields')
  @ApiOperation({ summary: 'Retorna tableFields de uma DClasse' })
  @ApiParam({ name: 'id', description: 'Chave da DClasse (ex: -150)', example: '-150' })
  @ApiResponse({ status: 200, description: 'tableFields (Json ou null)' })
  @ApiResponse({ status: 404, description: 'DClasse não encontrada' })
  async getFields(@Param('id', ParseBigIntPipe) id: bigint): Promise<unknown> {
    return this.classeService.getFieldsByClasse(id.toString());
  }

  /**
   * Busca DClasse por ID.
   *
   * @param id - Chave BigInt da DClasse
   * @returns ClasseResponseDto
   *
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```bash
   * curl 'http://localhost:3000/api/v1/classes/-400'
   * ```
   */
  @Get(':id')
  @ApiOperation({ summary: 'Busca DClasse por ID' })
  @ApiParam({ name: 'id', description: 'Chave da DClasse (ex: -400)', example: '-400' })
  @ApiResponse({ status: 200, description: 'DClasse encontrada', type: ClasseResponseDto })
  @ApiResponse({ status: 404, description: 'DClasse não encontrada' })
  async findOne(@Param('id', ParseBigIntPipe) id: bigint): Promise<ClasseResponseDto> {
    return this.classeService.buscarPorId(id.toString());
  }

  /**
   * Bloqueia criação de DClasse via API (403 sempre).
   *
   * DClasses são definidas pelo seed com chave negativa — são responsabilidade
   * exclusiva do desenvolvedor, nunca criadas em runtime pelo usuário.
   * Registrado como @Post() explícito para retornar 403 com mensagem clara
   * em vez de 404 nativo (dívida F2 resolvida em F3).
   *
   * @throws {ForbiddenException} Sempre — DClasses não são criáveis via API
   */
  @Post()
  @HttpCode(HttpStatus.FORBIDDEN)
  @ApiOperation({
    summary: '[BLOQUEADO] DClasses não são criáveis via API',
    description: 'DClasses têm chave negativa e são definidas pelo seed do desenvolvedor. Use `npx prisma db seed`.',
  })
  @ApiResponse({ status: 403, description: 'Criação de DClasse não permitida via API' })
  createNotAllowed(): never {
    throw new ForbiddenException(
      'DClasses são definidas pelo seed — não criáveis via API. ' +
      'Adicione a DClasse em prisma/seeds/classes.seed.ts e rode `npx prisma db seed`.',
    );
  }
}
