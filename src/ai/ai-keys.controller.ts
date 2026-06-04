import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { OrgAdminGuard } from './guards/org-admin.guard';
import { AiKeysService } from './ai-keys.service';
import { AiProviderPrefService, AiProviderPref } from './ai-provider-pref.service';
import { UpsertAiKeyDto } from './dto/upsert-ai-key.dto';
import { AiKeyResponseDto } from './dto/ai-key-response.dto';
import { SetProviderPrefDto } from './dto/set-provider-pref.dto';
import {
  AiProviderAvailabilityDto,
  AiProvidersAvailabilityResponseDto,
} from './dto/ai-provider-availability.dto';
import { AI_PROVIDER_NAMES, AiProviderName } from './dto/send-message.dto';

/**
 * Shape do `req.user` injetado pelo `AuthCompositeGuard`.
 *
 * `organizationId` e opcional no contrato geral, mas obrigatorio nas rotas
 * deste controller (o `OrgAdminGuard` rejeita ausencia; as rotas de leitura
 * que so usam `AuthCompositeGuard` validam manualmente).
 */
interface JwtRequest {
  user: { entidadeId: string; organizationId?: string };
}

/**
 * Controller de gestao das chaves de IA por organizacao (Nexus multi-provider).
 *
 * Rotas de ESCRITA e listagem de chave sao ADMIN-only (`OrgAdminGuard` sobre
 * DVincula -161). Rotas de DISPONIBILIDADE e leitura de preferencia sao
 * acessiveis a qualquer membro autenticado (so `AuthCompositeGuard`) — o
 * membro ve QUE providers estao configurados e a preferencia, mas NUNCA a
 * chave.
 *
 * **Seguranca:** o `orgId` e SEMPRE derivado do JWT (`req.user.organizationId`),
 * nunca do body — impede cadastrar/ler chave de outra org. Respostas de chave
 * sao SEMPRE mascaradas (sem plaintext).
 *
 * Decisao Pilar 2 (plano §3): controller especifico `ai/keys` em vez do
 * `/tabela` generico — justificado por mascaramento obrigatorio, gate ADMIN e
 * validacao por provider que o generico nao impoe.
 *
 * @see AiKeysService — CRUD/masking sobre DTabela -481/-482/-483.
 * @see AiProviderPrefService — preferencia default da org (DTabela -484).
 * @see OrgAdminGuard — gate ADMIN (DVincula -161).
 */
@ApiTags('ai-keys')
@ApiBearerAuth()
@Controller('ai')
export class AiKeysController {
  private readonly logger = new Logger(AiKeysController.name);

  constructor(
    private readonly aiKeys: AiKeysService,
    private readonly providerPref: AiProviderPrefService,
  ) {}

  /**
   * Cadastra ou rotaciona a chave de um provider para a org (ADMIN-only).
   *
   * @param dto - `{ provider, key }`. O `key` plaintext nunca e logado/devolvido.
   * @param req - Request com `req.user` (orgId derivado do JWT).
   * @returns Resposta MASCARADA da chave (sem plaintext).
   *
   * @throws {ForbiddenException} Usuario nao e ADMIN da org.
   * @throws {BadRequestException} JWT sem org ativa; provider invalido.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/ai/keys \
   *   -H "Authorization: Bearer ..." -H "Content-Type: application/json" \
   *   -d '{"provider":"claude","key":"sk-ant-..."}'
   * ```
   *
   * @example
   * ```json
   * { "provider": "claude", "prefix": "sk-ant-", "masked": "sk-ant-…f3a9",
   *   "configured": true, "createdAt": "2026-06-04T10:00:00.000Z",
   *   "lastRotatedAt": "2026-06-04T10:00:00.000Z" }
   * ```
   */
  @Post('keys')
  @UseGuards(AuthCompositeGuard, OrgAdminGuard)
  @ApiOperation({
    summary: 'Cadastra/rotaciona a chave de IA de um provider (ADMIN da org)',
    description:
      'Grava DTabela -481/-482/-483 com dEntidadeId=orgId (do JWT). Resposta mascarada — plaintext nunca exposto. Invalida o cache do resolver.',
  })
  @ApiResponse({ status: 201, description: 'Chave cadastrada/rotacionada (mascarada)', type: AiKeyResponseDto })
  @ApiResponse({ status: 400, description: 'Org ativa ausente ou provider invalido' })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Usuario nao e ADMIN da org' })
  async upsertKey(
    @Body() dto: UpsertAiKeyDto,
    @Request() req: JwtRequest,
  ): Promise<AiKeyResponseDto> {
    const orgId = BigInt(req.user.organizationId as string);
    this.logger.log(`POST /ai/keys provider=${dto.provider} org=${orgId.toString()}`);
    return this.aiKeys.upsertKey(orgId, dto.provider, dto.key, BigInt(req.user.entidadeId));
  }

  /**
   * Lista as chaves da org (1 por provider configurado), mascaradas (ADMIN-only).
   *
   * @param req - Request com `req.user` (orgId do JWT).
   * @returns Lista de chaves mascaradas (sem plaintext).
   *
   * @throws {ForbiddenException} Usuario nao e ADMIN da org.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/ai/keys -H "Authorization: Bearer ..."
   * ```
   */
  @Get('keys')
  @UseGuards(AuthCompositeGuard, OrgAdminGuard)
  @ApiOperation({
    summary: 'Lista as chaves de IA da org (mascaradas, ADMIN da org)',
    description: 'Uma chave por provider configurado. Plaintext NUNCA devolvido.',
  })
  @ApiResponse({ status: 200, description: 'Chaves mascaradas da org', type: [AiKeyResponseDto] })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Usuario nao e ADMIN da org' })
  async listKeys(@Request() req: JwtRequest): Promise<AiKeyResponseDto[]> {
    const orgId = BigInt(req.user.organizationId as string);
    return this.aiKeys.listKeys(orgId);
  }

  /**
   * Remove (soft-delete) a chave da org para um provider (ADMIN-only).
   *
   * @param provider - Provider cuja chave sera removida (path param).
   * @param req - Request com `req.user` (orgId do JWT).
   *
   * @throws {ForbiddenException} Usuario nao e ADMIN da org.
   * @throws {BadRequestException} Provider invalido / org ausente.
   * @throws {NotFoundException} Org nao tem chave deste provider.
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/ai/keys/openai -H "Authorization: Bearer ..."
   * ```
   */
  @Delete('keys/:provider')
  @UseGuards(AuthCompositeGuard, OrgAdminGuard)
  @ApiOperation({
    summary: 'Remove (soft-delete) a chave de IA de um provider (ADMIN da org)',
    description: 'Marca excluido=true na DTabela da org e invalida o cache do resolver.',
  })
  @ApiParam({ name: 'provider', enum: AI_PROVIDER_NAMES, description: 'Provider alvo' })
  @ApiResponse({ status: 200, description: 'Chave removida' })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Usuario nao e ADMIN da org' })
  @ApiResponse({ status: 404, description: 'Org nao possui chave deste provider' })
  async deleteKey(
    @Param('provider') provider: string,
    @Request() req: JwtRequest,
  ): Promise<{ deleted: true; provider: string }> {
    const orgId = BigInt(req.user.organizationId as string);
    const validProvider = this.assertProvider(provider);
    this.logger.log(`DELETE /ai/keys/${validProvider} org=${orgId.toString()}`);
    await this.aiKeys.deleteKey(orgId, validProvider);
    return { deleted: true, provider: validProvider };
  }

  /**
   * Lista os providers e se a org tem chave configurada (acessivel a membro).
   *
   * NAO exige ADMIN — qualquer membro autenticado ve a DISPONIBILIDADE (nunca
   * a chave). Sem org ativa, retorna todos como `configured:false`.
   *
   * @param req - Request com `req.user`.
   * @returns Disponibilidade por provider (`{ provider, configured }[]`).
   *
   * @example
   * ```bash
   * curl http://localhost:3000/ai/providers -H "Authorization: Bearer ..."
   * ```
   */
  @Get('providers')
  @UseGuards(AuthCompositeGuard)
  @ApiOperation({
    summary: 'Lista providers de IA e disponibilidade de chave da org',
    description: 'Acessivel a membro. Retorna apenas configured:boolean por provider — nunca a chave.',
  })
  @ApiResponse({ status: 200, description: 'Disponibilidade por provider', type: AiProvidersAvailabilityResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  async listProviders(
    @Request() req: JwtRequest,
  ): Promise<AiProvidersAvailabilityResponseDto> {
    const orgIdRaw = req.user.organizationId;
    const configured: Record<AiProviderName, boolean> = orgIdRaw
      ? await this.aiKeys.getConfiguredMap(BigInt(orgIdRaw))
      : { gemini: false, claude: false, openai: false };

    const providers: AiProviderAvailabilityDto[] = AI_PROVIDER_NAMES.map((provider) => ({
      provider,
      configured: configured[provider],
    }));
    return { providers };
  }

  /**
   * Define o provider/modelo default da org (ADMIN-only).
   *
   * Persiste em DTabela -484 via upsert ATOMICO (resolve o debito M1 da Fase 2).
   *
   * @param dto - `{ provider, model? }`.
   * @param req - Request com `req.user` (orgId do JWT).
   * @returns A preferencia persistida.
   *
   * @throws {ForbiddenException} Usuario nao e ADMIN da org.
   * @throws {BadRequestException} Org ativa ausente.
   *
   * @example
   * ```bash
   * curl -X PUT http://localhost:3000/ai/preference \
   *   -H "Authorization: Bearer ..." -H "Content-Type: application/json" \
   *   -d '{"provider":"claude","model":"claude-sonnet-4-5"}'
   * ```
   */
  @Put('preference')
  @UseGuards(AuthCompositeGuard, OrgAdminGuard)
  @ApiOperation({
    summary: 'Define o provider/modelo default da org (ADMIN da org)',
    description: 'Upsert atomico em DTabela -484 (dEntidadeId=orgId do JWT).',
  })
  @ApiResponse({ status: 200, description: 'Preferencia persistida', type: SetProviderPrefDto })
  @ApiResponse({ status: 400, description: 'Org ativa ausente' })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Usuario nao e ADMIN da org' })
  async setPreference(
    @Body() dto: SetProviderPrefDto,
    @Request() req: JwtRequest,
  ): Promise<AiProviderPref> {
    const orgId = BigInt(req.user.organizationId as string);
    this.logger.log(`PUT /ai/preference provider=${dto.provider} org=${orgId.toString()}`);
    const pref: AiProviderPref = {
      provider: dto.provider,
      ...(dto.model !== undefined ? { model: dto.model } : {}),
    };
    return this.providerPref.setDefaultForOrg(orgId, pref);
  }

  /**
   * Le o provider/modelo default da org (acessivel a membro).
   *
   * NAO exige ADMIN — qualquer membro pode ler a preferencia. Retorna `null`
   * quando a org nao definiu preferencia. Sem org ativa, retorna `null`.
   *
   * @param req - Request com `req.user`.
   * @returns `{ provider, model? }` ou `null`.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/ai/preference -H "Authorization: Bearer ..."
   * ```
   */
  @Get('preference')
  @UseGuards(AuthCompositeGuard)
  @ApiOperation({
    summary: 'Le o provider/modelo default da org (membro)',
    description: 'Retorna a preferencia da org ou null. Acessivel a qualquer membro.',
  })
  @ApiResponse({ status: 200, description: 'Preferencia da org (ou null)' })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  async getPreference(@Request() req: JwtRequest): Promise<AiProviderPref | null> {
    const orgIdRaw = req.user.organizationId;
    if (!orgIdRaw) return null;
    return this.providerPref.getDefaultForOrg(BigInt(orgIdRaw));
  }

  /**
   * Valida e estreita o path param `provider` para o union fechado.
   *
   * @throws {BadRequestException} Provider fora de {gemini, claude, openai}.
   */
  private assertProvider(provider: string): AiProviderName {
    if ((AI_PROVIDER_NAMES as readonly string[]).includes(provider)) {
      return provider as AiProviderName;
    }
    throw new BadRequestException(
      `Provider de IA invalido: ${provider}. Validos: ${AI_PROVIDER_NAMES.join(', ')}`,
    );
  }
}
