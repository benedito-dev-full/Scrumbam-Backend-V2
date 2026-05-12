import {
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ApiKeyService } from './services/api-key.service';
import { AuthCompositeGuard } from './guards/auth-composite.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser, JwtPayload } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthResponseDto, UserProfileDto } from './dto/auth-response.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { SwitchOrgDto } from './dto/switch-org.dto';
import { ApiKeyResponseDto } from './dto/api-key-response.dto';

/**
 * Controller de autenticação e gestão de perfil.
 *
 * Endpoints públicos: POST /auth/register, /auth/login, /auth/refresh
 * Endpoints protegidos: todos os demais (AuthCompositeGuard ou JwtAuthGuard)
 *
 * Pilar 2: AuthController é justificado (fluxo de auth não cabe em /entidades).
 * ADR-V2-003: RBAC via DVincula — nenhum campo `role` no banco.
 *
 * @see AuthService — lógica de negócio
 * @see AuthCompositeGuard — guard OR (MCP Key → API Key → JWT)
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  /**
   * Cadastra novo usuário com organização padrão.
   *
   * Cria em transaction: DUserGroup + DEntidade(-150) + DEntidade(-152) + DVincula(-161).
   *
   * @param dto - Dados de cadastro
   * @returns AuthResponseDto com JWT + refresh token
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/auth/register \
   *   -H 'Content-Type: application/json' \
   *   -d '{"name":"João","email":"joao@empresa.com","password":"senha123"}'
   * ```
   */
  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cadastro de novo usuário + organização' })
  @ApiResponse({ status: 201, description: 'Usuário criado', type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email já cadastrado' })
  async register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto);
  }

  /**
   * Autentica usuário com email + senha.
   *
   * @param dto - Credenciais de login
   * @returns AuthResponseDto com JWT + refresh token
   *
   * @throws {UnauthorizedException} Se credenciais inválidas
   */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login com email + senha' })
  @ApiResponse({ status: 200, description: 'Autenticado', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  /**
   * Renova access token via refresh token rotativo.
   *
   * @param dto - Refresh token plaintext
   * @returns Novo par de tokens (access + refresh)
   *
   * @throws {UnauthorizedException} Se refresh token inválido ou reuse detectado
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renova access token (refresh rotativo)',
    description: 'Cada uso invalida o refresh token anterior. Reuse detectado → revoga tudo.',
  })
  @ApiResponse({ status: 200, description: 'Tokens renovados', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token inválido ou já utilizado' })
  async refresh(
    @Body() dto: RefreshDto,
    @CurrentUser() _user?: JwtPayload,
  ): Promise<AuthResponseDto> {
    // Para refresh, o JWT pode estar expirado — usa o sub do body ou extrai do payload
    // Neste endpoint @Public(), user pode ser null
    // O frontend deve enviar o userGroupId no body ou como header
    // Decisão simplificada F3: buscar userGroup pelo hash do refresh token
    // Implementação: AuthService.refresh valida sem exigir userGroupId no body
    // O refresh token contém info suficiente para identificar o user via hash

    // Workaround F3: usar _user se disponível (JWT ainda válido), ou buscar por hash
    const userGroupId = _user
      ? BigInt(_user.sub)
      : await this.findUserGroupByRefreshToken(dto.refreshToken);
    return this.authService.refresh(dto.refreshToken, userGroupId);
  }

  /**
   * Troca a organizacao ativa da sessao (ADR-V2-030 — multi-tenant identity).
   *
   * Permite a um usuario com vinculos em multiplas orgs (DVincula -161/-162/-163)
   * trocar de workspace sem fazer logout. Emite novo par de tokens com
   * `organizationId` apontando para a org alvo e rotaciona o refresh token
   * (tokens antigos sao invalidados imediatamente).
   *
   * O frontend DEVE:
   *  1. Salvar AMBOS os novos tokens em `useAuthStore.setTokens`.
   *  2. Atualizar `user.organizationId/organizationName/orgRole` no store.
   *  3. Limpar cache de queries (`queryClient.clear()`) para evitar leak da
   *     org anterior.
   *  4. Persistir em `localStorage['scrumban-last-org']` para auto-resolver
   *     no proximo login.
   *
   * @param user - JWT payload do usuario atual.
   * @param dto - { organizationId: string } da org alvo.
   * @returns AuthResponseDto com tokens novos + perfil atualizado.
   *
   * @throws {ForbiddenException} Se nao tem DVincula ativo na org alvo.
   * @throws {NotFoundException} Se usuario ou perfil nao existem.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/auth/switch-org \
   *   -H "Authorization: Bearer <jwt>" \
   *   -H "Content-Type: application/json" \
   *   -d '{"organizationId":"152"}'
   * ```
   */
  @Post('switch-org')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Troca a organizacao ativa da sessao (ADR-V2-030)',
    description:
      'Valida membership na org alvo, emite novo par de tokens (refresh rotacionado) e audit DEvento -501.',
  })
  @ApiResponse({ status: 200, description: 'Sessao trocada', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Nao e membro da org alvo' })
  @ApiResponse({ status: 404, description: 'Usuario ou perfil nao encontrado' })
  async switchOrg(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SwitchOrgDto,
  ): Promise<AuthResponseDto> {
    return this.authService.switchOrg(BigInt(user.sub), BigInt(dto.organizationId));
  }

  /**
   * Realiza logout e revoga refresh token.
   */
  @Post('logout')
  @UseGuards(AuthCompositeGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout — revoga refresh token' })
  @ApiResponse({ status: 204, description: 'Logout realizado' })
  async logout(@CurrentUser() user: JwtPayload): Promise<void> {
    return this.authService.logout(BigInt(user.sub));
  }

  /**
   * Retorna perfil completo do usuário autenticado.
   *
   * Máximo 3 queries ao banco (N+1 ZERO).
   *
   * @returns UserProfileDto com org role e nome da organização
   */
  @Get('me')
  @UseGuards(AuthCompositeGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: 'X-API-Key', required: false, description: 'API Key (alternativa ao JWT)' })
  @ApiHeader({ name: 'X-MCP-Key', required: false, description: 'MCP Key (alternativa ao JWT)' })
  @ApiOperation({ summary: 'Retorna perfil do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Perfil do usuário', type: UserProfileDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  async getMe(@CurrentUser() user: JwtPayload): Promise<UserProfileDto> {
    return this.authService.getMe(BigInt(user.sub));
  }

  /**
   * Atualiza perfil do usuário autenticado (PATCH semântico).
   *
   * @param dto - Campos a atualizar (todos opcionais)
   * @returns UserProfileDto atualizado
   */
  @Patch('me')
  @UseGuards(AuthCompositeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualiza perfil (PATCH semântico)' })
  @ApiResponse({ status: 200, description: 'Perfil atualizado', type: UserProfileDto })
  async updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMeDto,
  ): Promise<UserProfileDto> {
    return this.authService.updateMe(BigInt(user.sub), dto);
  }

  /**
   * Soft-delete da conta do usuário autenticado.
   *
   * Marca DEntidade, DUserGroup e DVincula como excluido=true.
   */
  @Delete('me')
  @UseGuards(AuthCompositeGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove conta do usuário (soft-delete)' })
  @ApiResponse({ status: 204, description: 'Conta removida' })
  async deleteMe(@CurrentUser() user: JwtPayload): Promise<void> {
    return this.authService.deleteMe(BigInt(user.sub));
  }

  /**
   * Gera nova API Key vinculada ao projeto padrão do usuário.
   *
   * @returns ApiKeyResponseDto com key plaintext (UMA VEZ apenas)
   */
  @Post('me/api-key')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Gera API Key (plaintext retornado uma vez)',
    description: 'A key é armazenada como hash SHA-256 em DTabela(-471). Guardar com segurança.',
  })
  @ApiResponse({ status: 201, description: 'API Key criada', type: ApiKeyResponseDto })
  async createApiKey(@CurrentUser() user: JwtPayload): Promise<ApiKeyResponseDto> {
    // Usa entidadeId como projectId placeholder até F5 (DProject controller)
    const userId = BigInt(user.entidadeId);
    return this.apiKeyService.generate(userId, userId);
  }

  /**
   * Lista API Keys do usuário autenticado (sem expor hashes).
   *
   * @returns Lista de ApiKeyResponseDto sem campo key
   */
  @Get('me/api-key')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lista API Keys (sem hash)' })
  @ApiResponse({ status: 200, description: 'Lista de API Keys', type: [ApiKeyResponseDto] })
  async listApiKeys(@CurrentUser() user: JwtPayload): Promise<ApiKeyResponseDto[]> {
    return this.apiKeyService.listByProject(BigInt(user.entidadeId));
  }

  /**
   * Revoga API Key pelo ID.
   *
   * @param _user - Usuário autenticado (para verificação de ownership em F5)
   */
  @Delete('me/api-key')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoga todas as API Keys do usuário' })
  @ApiResponse({ status: 204, description: 'API Keys revogadas' })
  async revokeApiKeys(@CurrentUser() user: JwtPayload): Promise<void> {
    const keys = await this.apiKeyService.listByProject(BigInt(user.entidadeId));
    for (const key of keys) {
      await this.apiKeyService.revoke(BigInt(key.id));
    }
  }

  /**
   * Gera MCP Key para o usuário autenticado.
   *
   * @returns McpKeyResponseDto com key plaintext (UMA VEZ apenas)
   */
  @Post('me/mcp-key')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Gera MCP Key (plaintext retornado uma vez)',
    description: 'Hash duplicado em DUserGroup.dados.mcpKeyHash para latência mínima (ADR-V2-004).',
  })
  @ApiResponse({ status: 410, description: 'Use POST /mcp/keys' })
  async createMcpKey(@CurrentUser() _user: JwtPayload): Promise<never> {
    throw new GoneException('Use POST /mcp/keys');
  }

  /**
   * Retorna MCP Key ativa do usuário (sem expor hash).
   *
   * @returns McpKeyResponseDto sem campo key, ou 404 se não existe
   */
  @Get('me/mcp-key')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retorna MCP Key ativa (sem hash)' })
  @ApiResponse({ status: 410, description: 'Use GET /mcp/keys' })
  @ApiResponse({ status: 410, description: 'Endpoint legado removido' })
  async getMcpKey(@CurrentUser() _user: JwtPayload): Promise<never> {
    throw new GoneException('Use GET /mcp/keys');
  }

  /**
   * Revoga MCP Key do usuário autenticado.
   */
  @Delete('me/mcp-key')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoga MCP Key do usuário' })
  @ApiResponse({ status: 410, description: 'Use DELETE /mcp/keys/:id' })
  async revokeMcpKey(@CurrentUser() _user: JwtPayload): Promise<never> {
    throw new GoneException('Use DELETE /mcp/keys/:id');
  }

  // ─── Helper privado ─────────────────────────────────────────────────────

  /**
   * Busca DUserGroup a partir do hash do refresh token.
   *
   * Usado em POST /auth/refresh quando JWT está expirado.
   * Limitação F3: percorre todos os DUserGroup com refreshTokenHash (volume baixo).
   * F14 avaliará índice ou campo dedicado.
   */
  private async findUserGroupByRefreshToken(plaintext: string): Promise<bigint> {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(plaintext).digest('hex');

    const userGroups = await this.authService['prisma'].dUserGroup.findMany({
      where: { excluido: false, ativo: true },
      select: { chave: true, dados: true },
      take: 1000, // limite razoável para F3
    });

    const match = userGroups.find((ug) => {
      const dados = ug.dados as Record<string, unknown> | null;
      return dados?.refreshTokenHash === hash;
    });

    if (!match) {
      throw new Error('Refresh token não encontrado');
    }

    return match.chave;
  }
}
