import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto, AvailableOrgDto, UserProfileDto } from './dto/auth-response.dto';
import { UpdateMeDto } from './dto/update-me.dto';
// forwardRef para evitar circular dependency AuthModule ↔ OrganizationsModule
import { OrganizationsService } from '../organizations/organizations.service';

/** Bcrypt rounds — NUNCA abaixo de 12 (ADR-V2-003). */
const BCRYPT_ROUNDS = 12;

/** idClasses usados no register. */
const ID_CLASSE_USER_GROUP = BigInt(-46);
const ID_CLASSE_USER = BigInt(-150);
const ID_CLASSE_USER_LOGIN_EVENT = BigInt(-501);

/**
 * Service principal de autenticação.
 *
 * Implementa:
 * - register: transaction atômica (DUserGroup + DEntidade + DVincula + DEvento)
 * - login: bcrypt.compare + JWT + refresh token rotativo
 * - refresh: validação + rotação + reuse detection
 * - logout: revogação de refresh token + DEvento
 * - getMe: perfil completo (≤ 3 queries)
 * - updateMe / deleteMe: PATCH/DELETE em DEntidade
 *
 * Pilar 1: ZERO Engine — auth é cadastro estrutural (Prisma direto em transaction).
 * ADR-V2-003: roles via DVincula, nunca coluna `role`.
 *
 * @see RefreshTokenService — gerencia lifecycle do refresh token
 * @see JwtStrategy — valida o access token
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    @Inject(forwardRef(() => OrganizationsService))
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * Registra novo usuário e cria organização completa (com Default Team + Issue Counter).
   *
   * Fluxo refatorado (F5 — Opção A aprovada):
   * Transaction 1 (atomica):
   *   1. DUserGroup (-46) — credenciais (bcrypt hash rounds=12)
   *   2. DEntidade (-150) — perfil do usuário
   *   3. DEvento (-501) — audit trail de register
   *
   * Pós-commit: OrganizationsService.create() — transaction separada:
   *   4. DEntidade (-152) — organização
   *   5. DEntidade (-180) — Default Team
   *   6. DTabela (-475) — Issue Counter
   *   7. DVincula (-161) — user é ADMIN da org
   *   8. DVincula (-181) — user é LEAD do Default Team
   *
   * Separar as duas transactions garante que:
   * - Criação de usuário e org são independentes
   * - OrganizationsService permanece canônico (reutilizável via POST /organizations)
   *
   * @param dto - Dados de cadastro
   * @returns AuthResponseDto com JWT + refresh token
   * @throws {ConflictException} Se email já existe
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    // Verificar duplicidade antes da transaction
    const existing = await this.prisma.dUserGroup.findFirst({
      where: { usuario: dto.email.toLowerCase() },
      select: { chave: true },
    });
    if (existing) {
      throw new ConflictException('Email já cadastrado');
    }

    const senhaHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const orgNome = dto.organizationName ?? `${dto.name}'s Org`;

    this.logger.log(`Registrando usuário email="${dto.email}"`);

    // Transaction 1: criar usuário (DUserGroup + DEntidade + DEvento)
    const userResult = await this.prisma.$transaction(async (tx) => {
      // 1. Criar DUserGroup (credenciais)
      const userGroup = await tx.dUserGroup.create({
        data: {
          idClasse: ID_CLASSE_USER_GROUP,
          usuario: dto.email.toLowerCase(),
          senha: senhaHash,
          nome: dto.name,
          dados: {} as Prisma.InputJsonValue,
        },
      });

      // 2. Criar DEntidade (-150 USER)
      const entidade = await tx.dEntidade.create({
        data: {
          idClasse: ID_CLASSE_USER,
          nome: dto.name,
          email: dto.email.toLowerCase(),
          dUserGroupId: userGroup.chave,
        },
      });

      // 3. DEvento (-501 USER_LOGIN) — audit register
      await tx.dEvento.create({
        data: {
          idClasse: ID_CLASSE_USER_LOGIN_EVENT,
          idEntidade: entidade.chave,
          descricao: 'auth.register',
          metaDados: {
            action: 'register',
            email: dto.email.toLowerCase(),
          } as Prisma.InputJsonValue,
        },
      });

      return { userGroup, entidade };
    });

    // Transaction 2 (via OrganizationsService): criar org completa + default team + memberships
    const org = await this.organizationsService.create(
      { nome: orgNome },
      userResult.entidade.chave,
    );

    const orgIdBigInt = BigInt(org.id);

    // Gerar tokens APÓS persistência bem-sucedida
    const accessToken = this.generateAccessToken(
      userResult.userGroup.chave,
      userResult.entidade.chave,
      orgIdBigInt,
      dto.email.toLowerCase(),
    );
    const refreshToken = await this.refreshTokenService.generate(userResult.userGroup.chave);

    return this.buildAuthResponse(
      accessToken,
      refreshToken,
      userResult.userGroup.chave,
      userResult.entidade.chave,
      orgIdBigInt,
      dto.email.toLowerCase(),
      dto.name,
      orgNome,
      'ADMIN',
    );
  }

  /**
   * Autentica usuário com email + senha.
   *
   * Queries: 2 (DUserGroup + DVincula org)
   *
   * @param dto - Credenciais de login
   * @returns AuthResponseDto com JWT + refresh token
   * @throws {UnauthorizedException} Se credenciais inválidas
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    // Query 1: buscar DUserGroup + DEntidade em JOIN
    const userGroup = await this.prisma.dUserGroup.findFirst({
      where: { usuario: dto.email.toLowerCase(), excluido: false, ativo: true },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });

    if (!userGroup) {
      this.logger.debug(`Login falhou: email="${dto.email}" não encontrado`);
      await this.registrarEventoLoginFalhou(null, dto.email);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const senhaValida = await bcrypt.compare(dto.password, userGroup.senha);
    if (!senhaValida) {
      this.logger.debug(`Login falhou: senha incorreta para email="${dto.email}"`);
      await this.registrarEventoLoginFalhou(userGroup.entidades[0]?.chave ?? null, dto.email);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const entidade = userGroup.entidades[0];
    if (!entidade) {
      throw new UnauthorizedException('Perfil de usuário não encontrado');
    }

    // Query 2: buscar org role via DVincula
    const orgVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: entidade.chave,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      include: {
        locEscritu: { select: { chave: true, nome: true } },
      },
      orderBy: { idClasse: 'asc' }, // -161 (ADMIN) vem primeiro
    });

    const orgId = orgVinculo?.idLocEscritu ?? entidade.chave;
    const orgNome = orgVinculo?.locEscritu?.nome ?? '';
    const orgRole = this.mapOrgRole(orgVinculo?.idClasse ?? null);

    // Atualizar ultimoLogin
    await this.prisma.dUserGroup.update({
      where: { chave: userGroup.chave },
      data: { ultimoLogin: new Date() },
    });

    // Audit login (APÓS persistência)
    await this.prisma.dEvento.create({
      data: {
        idClasse: ID_CLASSE_USER_LOGIN_EVENT,
        idEntidade: entidade.chave,
        descricao: 'auth.login',
        metaDados: { action: 'login', email: dto.email.toLowerCase() } as Prisma.InputJsonValue,
      },
    });

    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
    );
    const refreshToken = await this.refreshTokenService.generate(userGroup.chave);

    return this.buildAuthResponse(
      accessToken,
      refreshToken,
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      entidade.nome,
      orgNome,
      orgRole,
    );
  }

  /**
   * Renova access token via refresh token (rotação estrita).
   *
   * Rotação estrita (Decisão D3): cada uso gera novo refresh token.
   * Reuse attack detection: token antigo após rotação → revoga tudo.
   *
   * @param refreshTokenPlaintext - Token em texto plano
   * @param userGroupId - Chave BigInt do DUserGroup (extraída do JWT expirado)
   * @returns AuthResponseDto com novo par de tokens
   * @throws {UnauthorizedException} Se token inválido ou reuse detectado
   */
  async refresh(refreshTokenPlaintext: string, userGroupId: bigint): Promise<AuthResponseDto> {
    const isValid = await this.refreshTokenService.validate(refreshTokenPlaintext, userGroupId);

    if (!isValid) {
      // Reuse detectado! Revogar tudo imediatamente
      this.logger.warn(`REUSE ATTACK detectado para userGroupId=${userGroupId}`);
      await this.refreshTokenService.revoke(userGroupId);
      throw new UnauthorizedException(
        'Refresh token inválido ou já utilizado. Faça login novamente.',
      );
    }

    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });

    if (!userGroup) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const entidade = userGroup.entidades[0];
    if (!entidade) {
      throw new UnauthorizedException('Perfil de usuário não encontrado');
    }

    const orgVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: entidade.chave,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
    });

    const orgId = orgVinculo?.idLocEscritu ?? entidade.chave;
    const orgRole = this.mapOrgRole(orgVinculo?.idClasse ?? null);

    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
    );
    const newRefreshToken = await this.refreshTokenService.rotate(userGroupId);

    return this.buildAuthResponse(
      accessToken,
      newRefreshToken,
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      entidade.nome,
      '',
      orgRole,
    );
  }

  /**
   * Realiza logout e revoga refresh token.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   */
  async logout(userGroupId: bigint): Promise<void> {
    this.logger.log(`Logout userGroupId=${userGroupId}`);
    await this.refreshTokenService.revoke(userGroupId);

    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, excluido: false },
      select: { chave: true },
    });

    // Audit logout (APÓS persistência)
    if (entidade) {
      await this.prisma.dEvento.create({
        data: {
          idClasse: ID_CLASSE_USER_LOGIN_EVENT,
          idEntidade: entidade.chave,
          descricao: 'auth.logout',
          metaDados: { action: 'logout' } as Prisma.InputJsonValue,
        },
      });
    }
  }

  /**
   * Retorna perfil completo do usuário autenticado (≤ 3 queries).
   *
   * Query 1: DUserGroup + DEntidade (JOIN)
   * Query 2: DVincula org role
   * (Query 3: opcional DEntidade org nome)
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @returns UserProfileDto completo
   * @throws {NotFoundException} Se usuário não encontrado
   */
  async getMe(userGroupId: bigint): Promise<UserProfileDto> {
    // Query 1: DUserGroup + DEntidade em JOIN (N+1 ZERO)
    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });

    if (!userGroup || !userGroup.entidades[0]) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const entidade = userGroup.entidades[0];

    // Query 2: TODOS os vinculos ativos do usuario (-161/-162/-163) com nome
    // da org em JOIN. Ordenados ADMIN antes — o primeiro vira a org "default"
    // do perfil (compat com /me legado). availableOrgs[] inclui todos para
    // alimentar o workspace switcher (ADR-V2-030).
    const orgVinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: entidade.chave,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      include: {
        locEscritu: { select: { chave: true, nome: true } },
      },
      orderBy: { idClasse: 'asc' },
    });

    const primary = orgVinculos[0];
    const availableOrgs: AvailableOrgDto[] = orgVinculos
      .filter((v) => v.locEscritu)
      .map((v) => ({
        id: v.idLocEscritu.toString(),
        nome: v.locEscritu!.nome,
        role: (this.mapOrgRole(v.idClasse) ?? 'MEMBER') as 'ADMIN' | 'MEMBER' | 'VIEWER',
      }));

    return {
      id: userGroup.chave.toString(),
      entidadeId: entidade.chave.toString(),
      email: userGroup.usuario,
      name: entidade.nome,
      organizationId: primary?.idLocEscritu?.toString(),
      organizationName: primary?.locEscritu?.nome,
      orgRole: this.mapOrgRole(primary?.idClasse ?? null),
      availableOrgs,
    };
  }

  /**
   * Atualiza perfil do usuário autenticado (PATCH semântico).
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   * @param dto - Campos a atualizar
   * @returns UserProfileDto atualizado
   */
  async updateMe(userGroupId: bigint, dto: UpdateMeDto): Promise<UserProfileDto> {
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, excluido: false },
      select: { chave: true, dados: true },
    });

    if (!entidade) {
      throw new NotFoundException('Perfil de usuário não encontrado');
    }

    const dadosAtuais = (entidade.dados as Record<string, unknown>) ?? {};

    await this.prisma.$transaction(async (tx) => {
      await tx.dEntidade.update({
        where: { chave: entidade.chave },
        data: {
          ...(dto.name !== undefined && { nome: dto.name }),
          ...(dto.email !== undefined && { email: dto.email.toLowerCase() }),
          dados: {
            ...dadosAtuais,
            ...(dto.defaultProjectId !== undefined && { defaultProjectId: dto.defaultProjectId }),
            ...(dto.defaultTeamId !== undefined && { defaultTeamId: dto.defaultTeamId }),
            ...(dto.onboardingCompleted !== undefined && {
              onboardingCompleted: dto.onboardingCompleted,
            }),
          } as Prisma.InputJsonValue,
        },
      });

      if (dto.email !== undefined) {
        await tx.dUserGroup.update({
          where: { chave: userGroupId },
          data: { usuario: dto.email.toLowerCase() },
        });
      }
    });

    return this.getMe(userGroupId);
  }

  /**
   * Soft-delete do usuário autenticado.
   *
   * Marca DEntidade, DUserGroup e DVincula como excluido=true em transaction.
   *
   * @param userGroupId - Chave BigInt do DUserGroup
   */
  async deleteMe(userGroupId: bigint): Promise<void> {
    const entidade = await this.prisma.dEntidade.findFirst({
      where: { dUserGroupId: userGroupId, excluido: false },
      select: { chave: true },
    });

    if (!entidade) {
      throw new NotFoundException('Usuário não encontrado');
    }

    this.logger.log(`Soft-delete usuário entidadeId=${entidade.chave}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.dEntidade.update({ where: { chave: entidade.chave }, data: { excluido: true } });
      await tx.dUserGroup.update({
        where: { chave: userGroupId },
        data: { excluido: true, ativo: false },
      });
      await tx.dVincula.updateMany({
        where: { idEntidade: entidade.chave, excluido: false },
        data: { excluido: true },
      });
    });
  }

  /**
   * Emite par de tokens (access + refresh) para um usuario ja persistido,
   * SEM validar senha. Uso restrito a fluxos pos-cadastro auto-autenticados
   * (ex.: accept de convite — ADR-V2-028).
   *
   * Reusa exatamente o mesmo pipeline do `login()`:
   *  - Resolve org/role via DVincula (-161/-162/-163).
   *  - Gera JWT + refresh token (rotacao estrita).
   *  - Emite `user.login.succeeded` para audit (mesma trilha do login normal).
   *
   * NUNCA deve ser exposto via endpoint publico. Chamado apenas por services
   * confiaveis que ja validaram a identidade por outro mecanismo (token de
   * convite, magic link, etc.).
   *
   * @param userGroupId - Chave BigInt do DUserGroup ja criado/persistido.
   * @returns AuthResponseDto identica a `login()`.
   * @throws {NotFoundException} Se DUserGroup ou DEntidade nao existir.
   *
   * @example
   * ```typescript
   * // Dentro do InvitesService, apos $transaction do accept:
   * const session = await this.authService.issueSessionForUser(newUserGroupId);
   * return { ...session, redirectTo: '/intentions' };
   * ```
   */
  async issueSessionForUser(
    userGroupId: bigint,
    preferredOrgId?: bigint,
  ): Promise<AuthResponseDto> {
    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });

    if (!userGroup) {
      throw new NotFoundException('Usuario nao encontrado');
    }
    const entidade = userGroup.entidades[0];
    if (!entidade) {
      throw new NotFoundException('Perfil de usuario nao encontrado');
    }

    // Se preferredOrgId fornecido (ex: accept de convite merge), priorizar
    // esse vinculo. Senao, comportamento padrao: primeiro vinculo ativo
    // ordenado por idClasse (ADMIN -161 antes de MEMBER/VIEWER).
    const preferred =
      preferredOrgId !== undefined
        ? await this.prisma.dVincula.findFirst({
            where: {
              idEntidade: entidade.chave,
              idLocEscritu: preferredOrgId,
              idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
              excluido: false,
            },
            include: { locEscritu: { select: { chave: true, nome: true } } },
          })
        : null;
    const orgVinculo =
      preferred ??
      (await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: entidade.chave,
          idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
          excluido: false,
        },
        include: { locEscritu: { select: { chave: true, nome: true } } },
        orderBy: { idClasse: 'asc' },
      }));

    const orgId = orgVinculo?.idLocEscritu ?? entidade.chave;
    const orgNome = orgVinculo?.locEscritu?.nome ?? '';
    const orgRole = this.mapOrgRole(orgVinculo?.idClasse ?? null);

    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
    );
    const refreshToken = await this.refreshTokenService.generate(userGroup.chave);

    return this.buildAuthResponse(
      accessToken,
      refreshToken,
      userGroup.chave,
      entidade.chave,
      orgId,
      userGroup.usuario,
      entidade.nome,
      orgNome,
      orgRole,
    );
  }

  /**
   * Troca a organizacao ativa da sessao (ADR-V2-030).
   *
   * Valida que o usuario tem DVincula ativo na org alvo, emite novo par de
   * tokens (access + refresh rotacionado) com `organizationId` apontando
   * para a org de destino e emite `DEvento -501` com `action='org.switch'`.
   *
   * O refresh token e rotacionado (estrita): tokens antigos sao invalidados.
   * O frontend DEVE atualizar AMBOS os tokens apos a chamada — usar o
   * refresh velho falhara com reuse detection.
   *
   * Race contra membership removida: a propria validacao de DVincula cobre
   * — se admin removeu o user da org alvo entre o GET /auth/me e o POST
   * /auth/switch-org, retorna 403.
   *
   * Queries: 3 (DUserGroup+DEntidade JOIN, DVincula da org alvo, availableOrgs).
   *
   * @param userGroupId - Chave BigInt do DUserGroup (do JWT atual).
   * @param targetOrgId - Chave BigInt da org alvo.
   * @returns AuthResponseDto com tokens novos + perfil com availableOrgs.
   * @throws {NotFoundException} Se usuario nao existe.
   * @throws {ForbiddenException} Se nao tem DVincula ativo na org alvo.
   */
  async switchOrg(userGroupId: bigint, targetOrgId: bigint): Promise<AuthResponseDto> {
    // Query 1: DUserGroup + DEntidade (mesmo padrao do login).
    const userGroup = await this.prisma.dUserGroup.findUnique({
      where: { chave: userGroupId },
      include: {
        entidades: {
          where: { idClasse: ID_CLASSE_USER, excluido: false },
          take: 1,
        },
      },
    });
    if (!userGroup) {
      throw new NotFoundException('Usuario nao encontrado');
    }
    const entidade = userGroup.entidades[0];
    if (!entidade) {
      throw new NotFoundException('Perfil de usuario nao encontrado');
    }

    // Query 2: validar DVincula ativo na org alvo (segurança — cobre
    // membership removida entre /me e /switch-org).
    const targetVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: entidade.chave,
        idLocEscritu: targetOrgId,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      include: { locEscritu: { select: { chave: true, nome: true } } },
    });
    if (!targetVinculo) {
      throw new ForbiddenException('Voce nao e membro desta organizacao');
    }

    const orgNome = targetVinculo.locEscritu?.nome ?? '';
    const orgRole = this.mapOrgRole(targetVinculo.idClasse);

    // Audit DEvento -501 com action='org.switch'.
    await this.prisma.dEvento.create({
      data: {
        idClasse: ID_CLASSE_USER_LOGIN_EVENT,
        idEntidade: entidade.chave,
        descricao: 'auth.org.switch',
        metaDados: {
          action: 'org.switch',
          toOrgId: targetOrgId.toString(),
          email: userGroup.usuario,
        } as Prisma.InputJsonValue,
      },
    });

    // Emitir novo access token + rotacionar refresh.
    const accessToken = this.generateAccessToken(
      userGroup.chave,
      entidade.chave,
      targetOrgId,
      userGroup.usuario,
    );
    const newRefreshToken = await this.refreshTokenService.rotate(userGroupId);

    this.logger.log(
      `org.switch userGroupId=${userGroupId} entidadeId=${entidade.chave} toOrgId=${targetOrgId}`,
    );

    return this.buildAuthResponse(
      accessToken,
      newRefreshToken,
      userGroup.chave,
      entidade.chave,
      targetOrgId,
      userGroup.usuario,
      entidade.nome,
      orgNome,
      orgRole,
    );
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Gera access token JWT com payload tipado.
   *
   * Campos como string (evita BigInt serialization issues).
   */
  private generateAccessToken(
    userGroupId: bigint,
    entidadeId: bigint,
    orgId: bigint,
    email: string,
  ): string {
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '900');
    return this.jwtService.sign(
      {
        sub: userGroupId.toString(),
        entidadeId: entidadeId.toString(),
        organizationId: orgId.toString(),
        email,
      },
      { expiresIn: parseInt(expiresIn, 10) },
    );
  }

  /**
   * Monta AuthResponseDto padronizado.
   *
   * Se `availableOrgs` for omitido, o helper faz a query para popular a
   * lista (ADR-V2-030). Callers que ja tem essa info em maos podem passar
   * para evitar query duplicada.
   */
  private async buildAuthResponse(
    accessToken: string,
    refreshToken: string,
    userGroupId: bigint,
    entidadeId: bigint,
    orgId: bigint,
    email: string,
    name: string,
    orgNome: string,
    orgRole?: string | null,
    availableOrgs?: AvailableOrgDto[],
  ): Promise<AuthResponseDto> {
    const expiresIn = parseInt(this.configService.get<string>('JWT_EXPIRES_IN', '900'), 10);

    const orgs = availableOrgs ?? (await this.loadAvailableOrgs(entidadeId));

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      user: {
        id: userGroupId.toString(),
        entidadeId: entidadeId.toString(),
        email,
        name,
        organizationId: orgId.toString(),
        organizationName: orgNome,
        orgRole: orgRole ?? undefined,
        availableOrgs: orgs,
      },
    };
  }

  /**
   * Lista todas as DVinculas ativas (-161/-162/-163) do usuario.
   *
   * Usado para popular `availableOrgs[]` no AuthResponseDto. 1 query
   * indexada com JOIN para nome da org — ZERO N+1.
   */
  private async loadAvailableOrgs(entidadeId: bigint): Promise<AvailableOrgDto[]> {
    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: entidadeId,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      include: { locEscritu: { select: { chave: true, nome: true } } },
      orderBy: { idClasse: 'asc' },
    });
    return vinculos
      .filter((v) => v.locEscritu)
      .map((v) => ({
        id: v.idLocEscritu.toString(),
        nome: v.locEscritu!.nome,
        role: (this.mapOrgRole(v.idClasse) ?? 'MEMBER') as 'ADMIN' | 'MEMBER' | 'VIEWER',
      }));
  }

  /**
   * Mapeia idClasse DVincula para string de role.
   */
  private mapOrgRole(idClasse: bigint | null): string | undefined {
    if (idClasse === BigInt(-161)) return 'ADMIN';
    if (idClasse === BigInt(-162)) return 'MEMBER';
    if (idClasse === BigInt(-163)) return 'VIEWER';
    return undefined;
  }

  /**
   * Registra DEvento de login falhou (APÓS tentativa).
   */
  private async registrarEventoLoginFalhou(
    entidadeId: bigint | null,
    email: string,
  ): Promise<void> {
    try {
      await this.prisma.dEvento.create({
        data: {
          idClasse: ID_CLASSE_USER_LOGIN_EVENT,
          ...(entidadeId && { idEntidade: entidadeId }),
          descricao: 'auth.failed',
          metaDados: {
            action: 'login_failed',
            email: email.toLowerCase(),
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao registrar evento login_failed: ${(err as Error).message}`);
    }
  }
}
