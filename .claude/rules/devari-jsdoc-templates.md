---
# Path-specific: carrega quando trabalhando com codigo TypeScript
paths:
  - "src/**/*.ts"
---

# Templates JSDoc - Devari Core

**Versao:** 1.0
**Data:** 2026-02-26
**Aplicavel a:** Services, Controllers, DTOs, Processors

---

## OBJETIVO

Padronizar documentacao JSDoc em todo codigo Devari Core para:
- Qualidade enterprise (template padroniza todos projetos gerados)
- Onboarding de devs juniors
- Manutenibilidade de longo prazo
- Geracao automatica de docs (Swagger, TypeDoc)

**Nivel de cobertura target:** 100% em metodos publicos e DTOs

---

## TEMPLATE 1: SERVICES (Metodos Publicos)

### Estrutura Completa

```typescript
/**
 * [Descricao clara do que o metodo faz em 1 linha - imperativo]
 *
 * [Paragrafo adicional com detalhes importantes:
 *  - Comportamentos especiais ou regras de negocio
 *  - Integracoes com outros services
 *  - Eventos emitidos (se aplicavel)
 *  - Side effects (atualizacoes em outras tabelas)
 *  - Performance considerations (se relevante)]
 *
 * @param paramName - Descricao do parametro
 * @param optionalParam - Descricao do parametro opcional
 * @returns Promise com descricao do que retorna
 *
 * @throws {NotFoundException} Quando recurso nao e encontrado
 * @throws {ConflictException} Quando ja existe recurso com mesmos dados
 * @throws {BadRequestException} Quando validacao de negocio falha
 *
 * @example
 * ```typescript
 * // Exemplo de uso basico
 * const resultado = await service.getEntidadesByClasse(
 *   BigInt(-45),
 *   { limit: 20, cursor: '456' }
 * );
 * console.log(resultado.items.length); // 20
 * ```
 *
 * @see RelatedDto para estrutura de entrada
 * @see ResponseDto para estrutura de saida
 */
async metodoExemplo(
  paramName: bigint,
  optionalParam?: QueryDto
): Promise<ResponseDto> {
  // Implementation
}
```

### Exemplo Real (EntidadeService)

```typescript
/**
 * Obtem entidades filtradas por classe com paginacao por cursor
 *
 * Retorna lista paginada de entidades de uma classe especifica:
 * - Filtros por nome, data de criacao, status
 * - Cursor pagination (escalavel para milhoes de registros)
 * - Inclui dados da classe (join automatico)
 *
 * Query otimizada com cursor pagination e select seletivo.
 * Usa TimezoneService para filtros de data no timezone de Brasilia.
 *
 * @param idClasse - ID da classe (chave da DClasse, ex: -45 para Marketplace)
 * @param query - Parametros de filtro e paginacao
 * @returns Promise com lista paginada e metadados
 *
 * @throws {NotFoundException} Quando classe nao encontrada no sistema
 * @throws {BadRequestException} Quando parametros de query sao invalidos
 *
 * @example
 * ```typescript
 * // Buscar primeira pagina (20 itens)
 * const page1 = await service.getEntidadesByClasse(
 *   BigInt(-45),
 *   { limit: 20 }
 * );
 *
 * // Buscar proxima pagina usando cursor
 * const page2 = await service.getEntidadesByClasse(
 *   BigInt(-45),
 *   { limit: 20, cursor: page1.nextCursor }
 * );
 *
 * // Com filtros de data
 * const filtrado = await service.getEntidadesByClasse(
 *   BigInt(-45),
 *   {
 *     dataInicio: '2025-01-01',
 *     dataFim: '2025-12-31',
 *     limit: 50
 *   }
 * );
 * ```
 *
 * @see ListEntidadeQueryDto para parametros de query
 * @see ListEntidadeResponseDto para estrutura de resposta
 */
async getEntidadesByClasse(
  idClasse: bigint,
  query: ListEntidadeQueryDto
): Promise<ListEntidadeResponseDto> {
  // Implementation
}
```

---

## TEMPLATE 2: CONTROLLERS (Endpoints)

### Estrutura Completa

```typescript
/**
 * [Descricao clara do endpoint em 1 linha]
 *
 * [Paragrafo adicional com:
 *  - Quem pode acessar (guards/permissoes)
 *  - Casos de uso principais
 *  - Limitacoes ou consideracoes]
 *
 * @param param - Descricao do path/query param
 * @param dto - Descricao do body (se POST/PUT)
 * @returns Promise com response DTO
 *
 * @throws {UnauthorizedException} Quando nao autenticado
 * @throws {ForbiddenException} Quando sem permissao
 * @throws {NotFoundException} Quando recurso nao encontrado
 *
 * @example
 * ```bash
 * # Exemplo de request
 * curl -X GET "http://localhost:3000/api/v1/entidades?idClasse=-45&limit=20" \
 *   -H "Authorization: Bearer {token}"
 * ```
 *
 * @example
 * ```json
 * // Response esperado
 * {
 *   "items": [
 *     { "chave": "123", "nome": "Entidade 1", "idClasse": "-45" }
 *   ],
 *   "pagination": { "hasMore": true, "nextCursor": "124" }
 * }
 * ```
 */
@Get()
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: 'Listar entidades por classe' })
@ApiResponse({ status: 200, type: ListEntidadeResponseDto })
async listar(
  @Query() query: ListEntidadeQueryDto
): Promise<ListEntidadeResponseDto> {
  // Implementation
}
```

### Exemplo Real (EntidadeController)

```typescript
/**
 * Retorna lista paginada de entidades filtradas por classe
 *
 * Endpoint protegido que requer autenticacao JWT.
 * Utiliza o endpoint generico polimorfico -- diferentes tipos de entidade
 * sao acessados via o parametro idClasse.
 *
 * Suporta:
 * - Cursor pagination (escalavel)
 * - Filtros por nome, data de criacao
 * - Ordenacao customizavel
 * - Include de dados da classe (join)
 *
 * @param query - Filtros e parametros de paginacao (query params)
 * @returns Promise com lista paginada e metadados
 *
 * @throws {UnauthorizedException} Quando token JWT invalido ou ausente
 * @throws {NotFoundException} Quando classe nao encontrada
 *
 * @example
 * ```bash
 * # Request basico (listar marketplaces)
 * curl -X GET "http://localhost:3000/api/v1/entidades?idClasse=-45&limit=20" \
 *   -H "Authorization: Bearer eyJhbGciOiJIUzI1..."
 * ```
 *
 * @example
 * ```bash
 * # Request com filtros e paginacao
 * curl -X GET "http://localhost:3000/api/v1/entidades?idClasse=-45&nome=Empresa&limit=50&cursor=456" \
 *   -H "Authorization: Bearer eyJhbGciOiJIUzI1..."
 * ```
 *
 * @example
 * ```json
 * // Response esperado (200 OK)
 * {
 *   "items": [
 *     {
 *       "chave": "789",
 *       "nome": "Empresa ABC",
 *       "idClasse": "-45",
 *       "classe": { "codigo": "MARKETPLACE", "nome": "Marketplace" },
 *       "chcriacao": "2025-01-15T10:30:00Z"
 *     }
 *   ],
 *   "pagination": {
 *     "hasMore": true,
 *     "nextCursor": "790",
 *     "total": 150
 *   }
 * }
 * ```
 */
@Get()
@UseGuards(JwtAuthGuard)
@ApiOperation({
  summary: 'Listar entidades por classe',
  description: 'Retorna lista paginada de entidades filtradas por idClasse (endpoint generico polimorfico)'
})
@ApiQuery({
  name: 'idClasse',
  description: 'ID da classe para filtrar (ex: -45 para Marketplace)',
  example: '-45'
})
@ApiResponse({
  status: 200,
  description: 'Lista retornada com sucesso',
  type: ListEntidadeResponseDto
})
@ApiResponse({
  status: 404,
  description: 'Classe nao encontrada'
})
async listar(
  @Query() query: ListEntidadeQueryDto
): Promise<ListEntidadeResponseDto> {
  // Implementation
}
```

---

## TEMPLATE 3: DTOs (Request/Response)

### Estrutura para Request DTOs

```typescript
/**
 * DTO para [finalidade/endpoint]
 *
 * [Paragrafo explicando contexto de uso]
 *
 * Validacoes aplicadas via class-validator:
 * - campo1: tipo, constraints (min, max, pattern, etc.)
 * - campo2: tipo, constraints
 * - campoOpcional: tipo, opcional
 *
 * @example
 * ```typescript
 * const dto: ExemploDto = {
 *   campo1: 'valor',
 *   campo2: 123
 * };
 * ```
 */
export class ExemploDto {
  /**
   * Descricao clara do campo
   *
   * [Detalhes adicionais se necessario:
   *  - Formato esperado
   *  - Regras de negocio
   *  - Valores aceitos]
   */
  @ApiProperty({
    description: 'Descricao do campo',
    example: 'exemplo',
    required: true
  })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  campo1: string;

  /**
   * Descricao do campo numerico
   */
  @ApiProperty({
    description: 'Valor entre 1 e 100',
    example: 20,
    minimum: 1,
    maximum: 100
  })
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  campo2: number;

  /**
   * Campo opcional com default
   */
  @ApiPropertyOptional({
    description: 'Campo opcional',
    example: 'default',
    default: 'default'
  })
  @IsOptional()
  @IsString()
  campoOpcional?: string = 'default';
}
```

### Exemplo Real (ListEntidadeQueryDto)

```typescript
/**
 * DTO para query de listagem de entidades por classe
 *
 * Usado no endpoint GET /entidades para filtrar e paginar resultados.
 * O parametro idClasse e obrigatorio e define o tipo de entidade retornada.
 *
 * Validacoes aplicadas via class-validator:
 * - idClasse: string obrigatorio (ID da DClasse)
 * - cursor: string opcional (ID do ultimo item da pagina anterior)
 * - limit: number entre 1 e 100 (default: 20)
 * - nome: string opcional (filtro por nome, busca parcial)
 * - dataInicio: string ISO 8601 opcional (YYYY-MM-DD)
 * - dataFim: string ISO 8601 opcional (YYYY-MM-DD)
 * - ordenacao: 'asc' | 'desc' (default: 'desc')
 *
 * @example
 * ```typescript
 * // Query basica (listar marketplaces)
 * const query: ListEntidadeQueryDto = {
 *   idClasse: '-45',
 *   limit: 20
 * };
 *
 * // Query com cursor (proxima pagina)
 * const query: ListEntidadeQueryDto = {
 *   idClasse: '-45',
 *   cursor: '456',
 *   limit: 20
 * };
 *
 * // Query com filtros
 * const query: ListEntidadeQueryDto = {
 *   idClasse: '-45',
 *   nome: 'Empresa',
 *   dataInicio: '2025-01-01',
 *   dataFim: '2025-12-31',
 *   limit: 50,
 *   ordenacao: 'asc'
 * };
 * ```
 */
export class ListEntidadeQueryDto {
  /**
   * ID da classe para filtrar entidades
   *
   * Define o tipo de entidade retornada (polimorfico).
   * Ex: -45 para Marketplace, -47 para Seller.
   */
  @ApiProperty({
    description: 'ID da classe (chave da DClasse)',
    example: '-45'
  })
  @IsString()
  idClasse: string;

  /**
   * Cursor para paginacao
   *
   * ID (chave) do ultimo item da pagina anterior.
   * Usado para buscar proximos N itens apos este cursor.
   * Se omitido, retorna primeira pagina.
   */
  @ApiPropertyOptional({
    description: 'Cursor para paginacao (ID do ultimo item da pagina anterior)',
    example: '456'
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  /**
   * Quantidade de itens por pagina
   *
   * Minimo: 1, Maximo: 100, Default: 20
   */
  @ApiPropertyOptional({
    description: 'Quantidade de itens por pagina',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  /**
   * Filtro por nome (busca parcial, case-insensitive)
   */
  @ApiPropertyOptional({
    description: 'Filtro por nome (busca parcial)',
    example: 'Empresa'
  })
  @IsOptional()
  @IsString()
  nome?: string;

  /**
   * Data inicial do filtro (inclusivo)
   *
   * Formato: YYYY-MM-DD (ISO 8601)
   * Timezone: America/Sao_Paulo (Brasilia)
   */
  @ApiPropertyOptional({
    description: 'Data inicial do filtro (formato: YYYY-MM-DD)',
    example: '2025-01-01'
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dataInicio deve estar no formato YYYY-MM-DD'
  })
  dataInicio?: string;

  /**
   * Data final do filtro (inclusivo)
   *
   * Formato: YYYY-MM-DD (ISO 8601)
   * Timezone: America/Sao_Paulo (Brasilia)
   */
  @ApiPropertyOptional({
    description: 'Data final do filtro (formato: YYYY-MM-DD)',
    example: '2025-12-31'
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dataFim deve estar no formato YYYY-MM-DD'
  })
  dataFim?: string;

  /**
   * Ordenacao dos resultados
   *
   * - 'desc': Mais recentes primeiro (padrao)
   * - 'asc': Mais antigos primeiro
   */
  @ApiPropertyOptional({
    description: 'Ordenacao dos resultados',
    example: 'desc',
    enum: ['asc', 'desc'],
    default: 'desc'
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  ordenacao?: 'asc' | 'desc' = 'desc';
}
```

---

## TEMPLATE 4: RESPONSE DTOs

### Estrutura

```typescript
/**
 * Response DTO para [endpoint/operacao]
 *
 * [Descricao do que representa]
 *
 * Estrutura:
 * - campo1: descricao
 * - campo2: descricao
 * - campoOpcional: descricao (pode ser null/undefined)
 *
 * @example
 * ```json
 * {
 *   "campo1": "valor",
 *   "campo2": 123,
 *   "campoOpcional": null
 * }
 * ```
 */
export class ExemploResponseDto {
  /**
   * Descricao do campo
   */
  @ApiProperty({
    description: 'Descricao detalhada',
    example: 'exemplo'
  })
  campo1: string;

  /**
   * Descricao do campo numerico
   */
  @ApiProperty({
    description: 'Numero positivo',
    example: 123,
    minimum: 0
  })
  campo2: number;

  /**
   * Campo que pode ser null
   */
  @ApiPropertyOptional({
    description: 'Pode ser null se nao disponivel',
    example: 'valor',
    nullable: true
  })
  campoOpcional?: string | null;
}
```

---

## TEMPLATE 5: PROCESSORS (BullMQ)

### Estrutura

```typescript
/**
 * Processor para [tipo de job/evento]
 *
 * [Descricao do que processa]
 *
 * Fila: [nome-da-fila]
 * Evento(s) consumido(s): [lista de eventos]
 * Evento(s) emitido(s): [lista de eventos]
 *
 * Performance target: <[X]ms por job
 *
 * @example
 * ```typescript
 * // Job data structure
 * const jobData = {
 *   entidadeId: '123',
 *   action: 'created',
 *   payload: { nome: 'Entidade Nova' }
 * };
 * ```
 */
@Processor('nome-da-fila')
export class MeuProcessor extends WorkerHost {
  private readonly logger = new Logger(MeuProcessor.name);

  /**
   * Processa job da fila
   *
   * [Descricao do fluxo de processamento:
   *  1. Etapa 1
   *  2. Etapa 2
   *  3. Emite evento X]
   *
   * @param job - Job do BullMQ com payload tipado
   * @returns Promise void ou resultado
   *
   * @throws {Error} Quando dados invalidos (job vai para retry)
   */
  async process(job: Job<JobDataType>): Promise<void> {
    // Implementation
  }
}
```

---

## CHECKLIST DE DOCUMENTACAO

Antes de considerar documentacao completa:

**Services:**
- [ ] Todos metodos publicos tem JSDoc
- [ ] @param para cada parametro
- [ ] @returns explicando o retorno
- [ ] @throws listando excecoes possiveis
- [ ] @example com caso de uso real
- [ ] @see referenciando DTOs relacionados

**Controllers:**
- [ ] Todos endpoints tem JSDoc
- [ ] @param para path/query params
- [ ] @throws listando status codes
- [ ] @example com curl request
- [ ] @example com response JSON
- [ ] @ApiOperation presente
- [ ] @ApiResponse para cada status code

**DTOs:**
- [ ] Classe tem JSDoc descrevendo finalidade
- [ ] @example com objeto completo
- [ ] Cada propriedade tem comentario inline
- [ ] @ApiProperty/@ApiPropertyOptional presentes
- [ ] Validacoes documentadas

**Processors:**
- [ ] Classe tem JSDoc descrevendo job type
- [ ] Fila documentada
- [ ] Eventos consumidos/emitidos listados
- [ ] process() method tem JSDoc
- [ ] Performance target documentado

---

**Este skill fornece templates para Documenter agent e Implementer agent ao escrever codigo novo.**
