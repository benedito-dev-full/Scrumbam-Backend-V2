import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { EmailService } from '../email/email.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { AuthService } from '../auth/auth.service';

import { CreateInviteDto } from './dto/create-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { InviteInfoDto } from './dto/invite-info.dto';
import { AcceptInviteResponseDto } from './dto/accept-invite-response.dto';

/** idClasses canonicos (seed F1 + ADR-V2-028). */
const ID_CLASSE_USER_GROUP = BigInt(-46);
const ID_CLASSE_USER = BigInt(-150);
const ID_CLASSE_ORG_ADMIN = BigInt(-161);
const ID_CLASSE_ORG_MEMBER = BigInt(-162);
const ID_CLASSE_ORG_VIEWER = BigInt(-163);
const ID_CLASSE_INVITE_TOKEN = BigInt(-476);

/** bcrypt rounds (mesma policy do AuthService — ADR-V2-003). */
const BCRYPT_ROUNDS = 12;

/** TTL do convite em milissegundos (7 dias). */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Mapa role → idClasse DVincula. */
const ROLE_TO_VINCULA_CLASSE: Record<'MEMBER' | 'VIEWER', bigint> = {
  MEMBER: ID_CLASSE_ORG_MEMBER,
  VIEWER: ID_CLASSE_ORG_VIEWER,
};

/**
 * Estrutura interna do `metaDados` de um DTabela INVITE_TOKEN.
 *
 * Importante: tokenHash NUNCA e exposto fora do service. Apenas o hash
 * (SHA-256) e persistido — o raw token so existe no email.
 */
interface InviteMetaDados {
  tokenHash: string;
  role: 'MEMBER' | 'VIEWER';
  expiresAt: string;
  usedAt: string | null;
  invitedByUserId: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  /**
   * Fluxo do aceite (ADR-V2-030). Default `new_user` para back-compat com
   * convites criados antes da migracao para multi-tenant identity.
   */
  flow?: 'new_user' | 'existing_user';
  /**
   * Apenas para flow=`existing_user`: id (string) da DEntidade -150 ja
   * existente que sera vinculada a org via DVincula no accept. Snapshot
   * tirado no momento do createInvite — re-validado no accept.
   */
  targetUserId?: string;
}

/**
 * Service de convites por email (ADR-V2-028).
 *
 * Implementa o ciclo de vida completo do convite usando APENAS as 17
 * tabelas canonicas:
 *  - Token persistido em `DTabela` idClasse=-476 INVITE_TOKEN.
 *  - Hash SHA-256 em `metaDados.tokenHash` (raw token so no email).
 *  - Audit trail em `DEvento` idClasse=-502 INVITE_LIFECYCLE.
 *  - Accept cria DUserGroup + DEntidade + DVincula em $transaction atomica.
 *
 * Anti-enumeracao: `getInviteByToken` e `acceptInvite` retornam 404
 * identico em qualquer cenario de falha (token invalido, expirado, usado).
 *
 * Pilar 1 NAO se aplica — cadastro estrutural, sem DPedido. Prisma direto
 * em $transaction.
 *
 * @see EmailService — dispara template 'invite'
 * @see AuthService.issueSessionForUser — auto-login pos-accept
 */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  /**
   * Cria convite e dispara email (fire-and-forget).
   *
   * Workflow:
   *  1. Verifica que `inviterUserId` e ADMIN da org (DVincula -161).
   *  2. Verifica que email nao e ja membro (DEntidade -150 + DVincula).
   *  3. Verifica que nao existe convite pendente (DTabela -476 sem usedAt).
   *  4. Gera token cripto (32 bytes base64url) + hash SHA-256.
   *  5. Persiste DTabela INVITE_TOKEN com hash em metaDados.
   *  6. Emite DEvento -502 com action='sent' (audit).
   *  7. Dispara EmailService.sendTemplate('invite', ...) sem aguardar
   *     (fire-and-forget — falha de provider NAO bloqueia resposta).
   *
   * NUNCA loga o raw token — apenas o hash e/ou o inviteId.
   *
   * @param orgId - Chave BigInt da organizacao (string).
   * @param dto - Email + role do convidado.
   * @param inviterUserId - Chave BigInt da DEntidade do admin que convida.
   * @returns Resumo do convite criado (sem token raw).
   *
   * @throws {ForbiddenException} Se inviter nao e ADMIN da org.
   * @throws {NotFoundException} Se org nao existe.
   * @throws {ConflictException} Se email ja e membro ou ja tem convite pendente.
   */
  async createInvite(
    orgId: string,
    dto: CreateInviteDto,
    inviterUserId: bigint,
  ): Promise<{ id: string; email: string; role: 'MEMBER' | 'VIEWER'; expiresAt: string }> {
    const orgIdBigInt = BigInt(orgId);
    const emailLower = dto.email.toLowerCase();

    // Carregar org + verificar inviter ADMIN em paralelo (queries independentes).
    const [org, inviterVinculo, inviterEntidade] = await Promise.all([
      this.prisma.dEntidade.findFirst({
        where: { chave: orgIdBigInt, idClasse: BigInt(-152), excluido: false },
        select: { chave: true, nome: true },
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: orgIdBigInt,
          idEntidade: inviterUserId,
          idClasse: ID_CLASSE_ORG_ADMIN,
          excluido: false,
        },
        select: { chave: true },
      }),
      this.prisma.dEntidade.findFirst({
        where: { chave: inviterUserId, idClasse: ID_CLASSE_USER, excluido: false },
        select: { chave: true, nome: true },
      }),
    ]);

    if (!org) {
      throw new NotFoundException(`Organizacao ${orgId} nao encontrada`);
    }
    if (!inviterVinculo) {
      throw new ForbiddenException('Apenas ADMIN da organizacao pode enviar convites');
    }
    if (!inviterEntidade) {
      throw new ForbiddenException('Inviter nao possui perfil de usuario');
    }

    // Verificar se email ja virou DEntidade USER (ADR-V2-030: merge flow).
    // - Se ja e membro DESTA org → 409 (decisao CEO).
    // - Se tem conta em outra org → flow='existing_user' (token de merge).
    // - Se nao tem conta → flow='new_user' (fluxo padrao do convite).
    const existingUser = await this.prisma.dEntidade.findFirst({
      where: { idClasse: ID_CLASSE_USER, email: emailLower, excluido: false },
      select: { chave: true },
    });
    let inviteFlow: 'new_user' | 'existing_user' = 'new_user';
    let targetUserId: bigint | null = null;
    if (existingUser) {
      const existingLink = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: existingUser.chave,
          idLocEscritu: orgIdBigInt,
          idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
          excluido: false,
        },
        select: { chave: true },
      });
      if (existingLink) {
        throw new ConflictException('Email ja e membro desta organizacao');
      }
      // Email tem conta noutra org — gerar token de merge (sem criar DUserGroup).
      inviteFlow = 'existing_user';
      targetUserId = existingUser.chave;
    }

    // Verificar convite pendente
    const pending = await this.findPendingInviteByEmail(orgIdBigInt, emailLower);
    if (pending) {
      throw new ConflictException({
        message: 'Convite pendente ja existe para este email',
        existingInviteId: pending.chave.toString(),
      });
    }

    // Gerar token raw (base64url 32 bytes ~ 43 chars) + hash SHA-256.
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const metaDados: InviteMetaDados = {
      tokenHash,
      role: dto.role,
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      invitedByUserId: inviterUserId.toString(),
      status: 'PENDING',
      flow: inviteFlow,
      ...(targetUserId ? { targetUserId: targetUserId.toString() } : {}),
    };

    const invite = await this.prisma.dTabela.create({
      data: {
        idClasse: ID_CLASSE_INVITE_TOKEN,
        nome: emailLower,
        idLocEscrituracao: orgIdBigInt,
        dEntidadeId: inviterUserId,
        metaDados: metaDados as unknown as Prisma.InputJsonValue,
      },
      select: { chave: true },
    });

    // Audit APOS persistencia — log estruturado SEM o raw token.
    const correlationId = this.correlationIdService.getOrGenerate();
    await this.eventProducer.addInternalEvent(
      'invite.sent',
      {
        inviteId: invite.chave.toString(),
        orgId,
        orgName: org.nome,
        email: emailLower,
        role: dto.role,
        inviterUserId: inviterUserId.toString(),
        expiresAt: expiresAt.toISOString(),
      },
      correlationId,
      { source: InvitesService.name },
    );

    this.logger.log(
      `Convite criado inviteId=${invite.chave} orgId=${orgId} email=${emailLower} role=${dto.role} flow=${inviteFlow}`,
    );

    // Fire-and-forget — log estruturado de falha (NUNCA bloquear resposta).
    void this.dispatchInviteEmail(inviterEntidade.nome, org.nome, emailLower, rawToken).catch(
      (err) => {
        this.logger.error(
          `Falha ao enviar email de convite inviteId=${invite.chave} email=${emailLower}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      },
    );

    return {
      id: invite.chave.toString(),
      email: emailLower,
      role: dto.role,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Retorna info publica do convite por token raw (anti-enumeracao).
   *
   * 404 identico em todos os cenarios de falha (token invalido, expirado,
   * usado). NUNCA revela motivo especifico para nao logado.
   *
   * @param rawToken - Token em texto plano (vindo do path param da URL).
   * @returns Info sanitizada do convite.
   * @throws {NotFoundException} Sempre que invalido/expirado/usado.
   */
  async getInviteByToken(rawToken: string): Promise<InviteInfoDto> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new NotFoundException();
    }

    const invite = await this.findValidInviteByRawToken(rawToken);
    if (!invite) {
      throw new NotFoundException();
    }

    const meta = invite.metaDados as unknown as InviteMetaDados;

    // Buscar nome da org + inviter em paralelo (2 queries — sem N+1).
    const [org, inviter] = await Promise.all([
      this.prisma.dEntidade.findFirst({
        where: {
          chave: invite.idLocEscrituracao ?? BigInt(0),
          idClasse: BigInt(-152),
          excluido: false,
        },
        select: { nome: true },
      }),
      this.prisma.dEntidade.findFirst({
        where: {
          chave: invite.dEntidadeId ?? BigInt(0),
          idClasse: ID_CLASSE_USER,
          excluido: false,
        },
        select: { nome: true },
      }),
    ]);

    if (!org) {
      // Org foi deletada apos convite criado — invalidar (anti-enumeracao).
      throw new NotFoundException();
    }

    return {
      orgName: org.nome,
      inviterName: inviter?.nome ?? 'Admin',
      email: invite.nome,
      role: meta.role,
      expiresAt: meta.expiresAt,
      flow: meta.flow ?? 'new_user',
    };
  }

  /**
   * Aceita convite e completa onboarding com auto-login.
   *
   * Workflow:
   *  1. $transaction atomica:
   *     a. Re-valida token (race-safe: bloqueia se outro request usou).
   *     b. Valida que email nao virou DEntidade entre GET e POST (race).
   *     c. Cria DUserGroup (-46) com senha hash bcrypt rounds=12.
   *     d. Cria DEntidade (-150) com email + nome + dUserGroupId.
   *     e. Cria DVincula com idClasse correto (-162 MEMBER ou -163 VIEWER).
   *     f. UPDATE DTabela com usedAt + status=ACCEPTED.
   *     g. INSERT DEvento -502 com action='accepted'.
   *  2. FORA da $transaction: AuthService.issueSessionForUser → JWT + refresh.
   *
   * Tokens FORA da transaction porque nao escrevem dados criticos
   * em DB (refresh hash e escrita simples) e queremos isolar.
   *
   * @param rawToken - Token raw vindo do path param.
   * @param dto - name + password do novo usuario.
   * @returns AuthResponseDto + redirectTo.
   * @throws {NotFoundException} Token invalido/expirado/usado (anti-enumeracao).
   * @throws {ConflictException} Email ja virou user entre GET e POST.
   */
  async acceptInvite(rawToken: string, dto: AcceptInviteDto): Promise<AcceptInviteResponseDto> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new NotFoundException();
    }

    const tokenHash = this.hashToken(rawToken);

    // Pre-resolve do flow (1 query rapida fora da tx) — necessario porque:
    //  - new_user precisa hashar senha ANTES da tx (bcrypt e CPU-bound, ~100ms).
    //  - existing_user nao precisa de senha (ignora dto.name/password).
    //  - Hashar senha dentro da tx prolonga lock de DB desnecessariamente.
    // A re-validacao do token dentro da tx (race-safe) e feita normalmente.
    const preInvite = await this.findValidInviteByHashWithinTx(this.prisma, tokenHash);
    if (!preInvite) {
      throw new NotFoundException();
    }
    const preMeta = preInvite.metaDados as unknown as InviteMetaDados;
    const flow: 'new_user' | 'existing_user' = preMeta.flow ?? 'new_user';

    // Validar payload conforme o flow (regras de negocio que o DTO opcional nao cobre).
    if (flow === 'new_user') {
      if (!dto.name || dto.name.trim().length < 2) {
        throw new BadRequestException('Nome e obrigatorio (minimo 2 caracteres)');
      }
      if (!dto.password || dto.password.length < 8) {
        throw new BadRequestException('Senha e obrigatoria (minimo 8 caracteres)');
      }
    } else if (dto.name || dto.password) {
      // existing_user: name/password sao ignorados — apenas log, nao falha.
      this.logger.warn(
        `acceptInvite inviteId=${preInvite.chave} flow=existing_user com name/password no body — ignorados`,
      );
    }

    const senhaHash =
      flow === 'new_user' && dto.password ? await bcrypt.hash(dto.password, BCRYPT_ROUNDS) : null;

    // $transaction atomica — TODA escrita dentro. Geracao de JWT FORA.
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Re-validar token dentro da tx (concurrent-safe contra duplo-accept).
      const invite = await this.findValidInviteByHashWithinTx(tx, tokenHash);
      if (!invite) {
        throw new NotFoundException();
      }

      const meta = invite.metaDados as unknown as InviteMetaDados;
      const txFlow: 'new_user' | 'existing_user' = meta.flow ?? 'new_user';
      const emailLower = invite.nome.toLowerCase();

      const orgId = invite.idLocEscrituracao;
      if (!orgId) {
        throw new NotFoundException();
      }

      // 2. Verificar que org ainda existe.
      const org = await tx.dEntidade.findFirst({
        where: { chave: orgId, idClasse: BigInt(-152), excluido: false },
        select: { chave: true },
      });
      if (!org) {
        throw new NotFoundException();
      }

      const roleClasse = ROLE_TO_VINCULA_CLASSE[meta.role];
      if (!roleClasse) {
        throw new BadRequestException(`Role invalido no convite: ${meta.role}`);
      }

      let userGroupId: bigint;
      let userEntidadeId: bigint;

      if (txFlow === 'existing_user') {
        // ───────── Merge flow (ADR-V2-030) ─────────
        // NAO cria DUserGroup nem DEntidade — apenas DVincula.
        if (!meta.targetUserId) {
          throw new NotFoundException();
        }
        const targetEntidadeId = BigInt(meta.targetUserId);
        const targetEntidade = await tx.dEntidade.findFirst({
          where: {
            chave: targetEntidadeId,
            idClasse: ID_CLASSE_USER,
            excluido: false,
          },
          select: { chave: true, dUserGroupId: true, email: true },
        });
        if (!targetEntidade || !targetEntidade.dUserGroupId) {
          // Anti-enumeracao: usuario alvo sumiu — token vira invalido.
          throw new NotFoundException();
        }
        // Defesa: email do convite deve continuar bate ndo com email do user alvo
        // (cobre caso de admin convidar B@x.com e depois user B mudar seu email).
        if (targetEntidade.email && targetEntidade.email.toLowerCase() !== emailLower) {
          throw new NotFoundException();
        }

        // Race-safe: re-checar que ainda nao e membro desta org.
        const existingLink = await tx.dVincula.findFirst({
          where: {
            idEntidade: targetEntidadeId,
            idLocEscritu: orgId,
            idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
            excluido: false,
          },
          select: { chave: true },
        });
        if (existingLink) {
          throw new ConflictException('Email ja e membro desta organizacao');
        }

        await tx.dVincula.create({
          data: {
            idClasse: roleClasse,
            idLocEscritu: orgId,
            idEntidade: targetEntidadeId,
            metaDados: { cargo: meta.role, mergedFromInvite: true } as Prisma.InputJsonValue,
          },
        });

        userGroupId = targetEntidade.dUserGroupId;
        userEntidadeId = targetEntidadeId;
      } else {
        // ───────── new_user flow (cria conta) ─────────
        if (!senhaHash || !dto.name) {
          // Defesa em profundidade — validado fora da tx, mas garante o invariant.
          throw new BadRequestException('Nome e senha sao obrigatorios para criar conta');
        }

        // Race: email pode ter virado user/membro entre GET e POST.
        const existingUser = await tx.dEntidade.findFirst({
          where: { idClasse: ID_CLASSE_USER, email: emailLower, excluido: false },
          select: { chave: true },
        });
        if (existingUser) {
          throw new ConflictException('Email ja possui conta. Faca login normalmente.');
        }

        // DUserGroup (-46) — credenciais.
        const userGroup = await tx.dUserGroup.create({
          data: {
            idClasse: ID_CLASSE_USER_GROUP,
            usuario: emailLower,
            senha: senhaHash,
            nome: dto.name,
            dados: {} as Prisma.InputJsonValue,
          },
        });

        // DEntidade (-150) — perfil.
        const userEntidade = await tx.dEntidade.create({
          data: {
            idClasse: ID_CLASSE_USER,
            nome: dto.name,
            email: emailLower,
            dUserGroupId: userGroup.chave,
          },
        });

        // DVincula — role na org.
        await tx.dVincula.create({
          data: {
            idClasse: roleClasse,
            idLocEscritu: orgId,
            idEntidade: userEntidade.chave,
            metaDados: { cargo: meta.role } as Prisma.InputJsonValue,
          },
        });

        userGroupId = userGroup.chave;
        userEntidadeId = userEntidade.chave;
      }

      // UPDATE DTabela — marca convite como usado (status=ACCEPTED).
      const usedAt = new Date().toISOString();
      const newMeta: InviteMetaDados = {
        ...meta,
        usedAt,
        status: 'ACCEPTED',
      };
      await tx.dTabela.update({
        where: { chave: invite.chave },
        data: {
          metaDados: newMeta as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        userGroupId,
        userEntidadeId,
        orgId,
        inviteId: invite.chave,
        role: meta.role,
        flow: txFlow,
      };
    });

    // Audit APOS commit (fora da tx). Falha aqui NAO compromete o aceite.
    const correlationId = this.correlationIdService.getOrGenerate();
    await this.eventProducer.addInternalEvent(
      result.flow === 'existing_user' ? 'invite.accepted.merge' : 'invite.accepted',
      {
        inviteId: result.inviteId.toString(),
        orgId: result.orgId.toString(),
        newUserId: result.userEntidadeId.toString(),
        role: result.role,
        flow: result.flow,
      },
      correlationId,
      { source: InvitesService.name },
    );

    this.logger.log(
      `Convite aceito inviteId=${result.inviteId} userId=${result.userEntidadeId} role=${result.role} flow=${result.flow}`,
    );

    // Auto-login FORA da $transaction (gera JWT + refresh).
    // Em existing_user, preferimos emitir sessao ja na org recem-mergeada
    // (UX: usuario completa o accept e ja "esta" no workspace novo).
    const session = await this.authService.issueSessionForUser(result.userGroupId, result.orgId);

    return {
      ...session,
      redirectTo: '/intentions',
    };
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Hash determinstico SHA-256 do token raw.
   *
   * Usado para persistir em DTabela.metaDados.tokenHash e para comparar
   * no GET/POST accept. NUNCA expoe o raw token.
   */
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Busca convite valido por raw token (hash + filtros usedAt + expiresAt).
   *
   * Estrategia: lista DTabelas INVITE_TOKEN ativas (sem usedAt) e filtra
   * em memoria por hash + expiresAt. Aceitavel pois o conjunto de
   * convites pendentes por sistema e pequeno (centenas, nao milhoes).
   *
   * @param rawToken - Token em texto plano.
   * @returns DTabela completa ou null.
   */
  private async findValidInviteByRawToken(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();

    const candidates = await this.prisma.dTabela.findMany({
      where: {
        idClasse: ID_CLASSE_INVITE_TOKEN,
        excluido: false,
      },
      take: 500, // safety bound — conjunto pequeno em producao
    });

    for (const inv of candidates) {
      const meta = inv.metaDados as unknown as InviteMetaDados | null;
      if (!meta) continue;
      if (meta.tokenHash !== tokenHash) continue;
      if (meta.usedAt) continue;
      if (meta.status !== 'PENDING') continue;
      if (!meta.expiresAt) continue;
      if (new Date(meta.expiresAt).getTime() <= now.getTime()) continue;
      return inv;
    }
    return null;
  }

  /**
   * Idem `findValidInviteByRawToken`, mas operando sobre tx (transaction).
   * Recebe ja o hash (calculado fora da tx para evitar custo redundante).
   */
  private async findValidInviteByHashWithinTx(
    tx: Prisma.TransactionClient | PrismaService,
    tokenHash: string,
  ) {
    const now = new Date();
    const candidates = await tx.dTabela.findMany({
      where: {
        idClasse: ID_CLASSE_INVITE_TOKEN,
        excluido: false,
      },
      take: 500,
    });
    for (const inv of candidates) {
      const meta = inv.metaDados as unknown as InviteMetaDados | null;
      if (!meta) continue;
      if (meta.tokenHash !== tokenHash) continue;
      if (meta.usedAt) continue;
      if (meta.status !== 'PENDING') continue;
      if (!meta.expiresAt) continue;
      if (new Date(meta.expiresAt).getTime() <= now.getTime()) continue;
      return inv;
    }
    return null;
  }

  /**
   * Busca convite pendente por (orgId, email) para deduplicacao.
   */
  private async findPendingInviteByEmail(orgId: bigint, emailLower: string) {
    const candidates = await this.prisma.dTabela.findMany({
      where: {
        idClasse: ID_CLASSE_INVITE_TOKEN,
        idLocEscrituracao: orgId,
        nome: emailLower,
        excluido: false,
      },
      take: 50,
    });
    const now = Date.now();
    for (const inv of candidates) {
      const meta = inv.metaDados as unknown as InviteMetaDados | null;
      if (!meta) continue;
      if (meta.usedAt) continue;
      if (meta.status !== 'PENDING') continue;
      if (!meta.expiresAt) continue;
      if (new Date(meta.expiresAt).getTime() <= now) continue;
      return inv;
    }
    return null;
  }

  /**
   * Monta URL absoluta do convite e dispara `EmailService.sendTemplate('invite', ...)`.
   *
   * Fire-and-forget — exceptions sao capturadas pelo caller (createInvite)
   * e logadas SEM o raw token.
   *
   * @param inviterName - Nome humano para a frase "convidado por X".
   * @param orgName - Nome publico da org no email.
   * @param emailDest - Destinatario.
   * @param rawToken - Token raw (SO usado para montar a URL).
   */
  private async dispatchInviteEmail(
    inviterName: string,
    orgName: string,
    emailDest: string,
    rawToken: string,
  ): Promise<void> {
    const appBaseUrl = this.configService.get<string>('APP_BASE_URL', 'http://localhost:3000');
    const inviteUrl = `${appBaseUrl.replace(/\/$/, '')}/invite?token=${encodeURIComponent(rawToken)}`;

    await this.emailService.sendTemplate('invite', { inviterName, orgName, inviteUrl }, emailDest);
  }
}
