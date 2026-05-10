import {
  Body,
  Controller,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { EntidadeService } from '../entidades/entidades.service';
import { PairingService } from './core/pairing.service';
import { LinkAccountDto } from './core/dto/link-account.dto';

/**
 * Controller de pareamento canal↔conta de usuário.
 *
 * Endpoints protegidos por JWT. O userId é sempre resolvido via
 * `EntidadeService.getEntidadeIdFromUserGroup` para garantir que
 * o vínculo aponta para DEntidade.chave (não DUserGroup.chave).
 *
 * @see PairingService — lógica de geração e consumo de tokens
 */
@ApiTags('channels')
@ApiBearerAuth()
@Controller('channels/pairing')
@UseGuards(JwtAuthGuard)
export class PairingController {
  private readonly logger = new Logger(PairingController.name);

  constructor(
    private readonly pairingService: PairingService,
    private readonly entidadeService: EntidadeService,
  ) {}

  /**
   * Gera um código de pareamento one-shot para o usuário autenticado.
   *
   * O código tem TTL configurado em `PAIRING_TOKEN_TTL_MIN` (default: 15 min).
   * Deve ser usado no canal externo (ex: Telegram) antes de expirar.
   * Não pode ser recuperado após gerado — é retornado apenas uma vez.
   *
   * @param user - Usuário autenticado (extraído do JWT)
   * @returns Objeto com `code` (plaintext 12 chars) e `expiresAt` (ISO string)
   *
   * @throws {UnauthorizedException} Se JWT ausente ou inválido
   *
   * @example
   * ```bash
   * curl -X POST /channels/pairing/generate \
   *   -H "Authorization: Bearer <token>"
   * ```
   *
   * @example
   * ```json
   * // Response 201
   * { "code": "a1b2c3d4e5f6", "expiresAt": "2026-05-10T12:30:00.000Z" }
   * ```
   */
  @Post('generate')
  @ApiOperation({
    summary: 'Gera código de pareamento one-shot',
    description:
      'Gera um código TTL para vincular o usuário autenticado a um canal externo. ' +
      'Retornado uma única vez — não pode ser recuperado depois.',
  })
  @ApiResponse({
    status: 201,
    description: 'Código gerado com sucesso',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'a1b2c3d4e5f6', description: '12 chars hexadecimais' },
        expiresAt: { type: 'string', format: 'date-time', example: '2026-05-10T12:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'JWT ausente ou inválido' })
  async generate(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ code: string; expiresAt: string }> {
    this.logger.log(`Gerando código de pareamento para userGroupId=${user.sub}`);

    // Converter DUserGroup.chave → DEntidade.chave (padrão canônico)
    const userId = await this.entidadeService.getEntidadeIdFromUserGroup(
      BigInt(user.sub),
    );

    const { code, expiresAt } = await this.pairingService.generate(userId);

    return { code, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Vincula o canal externo ao usuário autenticado via código de pareamento.
   *
   * Útil para testes e ambientes sem webhook ativo.
   * Em produção, o bot Telegram chama `PairingService.consume` diretamente
   * ao receber o comando `/pair <code>`.
   *
   * @param dto - Código, canal e chatId a vincular
   * @param user - Usuário autenticado (para validar ownership do token)
   * @returns `{ linked: true }` em caso de sucesso
   *
   * @throws {UnauthorizedException} Se JWT ausente, inválido ou código inválido/expirado
   *
   * @example
   * ```bash
   * curl -X POST /channels/pairing/link \
   *   -H "Authorization: Bearer <token>" \
   *   -H "Content-Type: application/json" \
   *   -d '{"code":"a1b2c3d4e5f6","channelName":"telegram","chatId":"123456789"}'
   * ```
   *
   * @example
   * ```json
   * // Response 200
   * { "linked": true }
   * ```
   */
  @Post('link')
  @ApiOperation({
    summary: 'Vincula canal externo ao usuário autenticado',
    description:
      'Consome o código de pareamento e cria o vínculo canal↔usuário. ' +
      'O código é one-shot — não pode ser reutilizado.',
  })
  @ApiResponse({
    status: 200,
    description: 'Vínculo criado com sucesso',
    schema: {
      type: 'object',
      properties: {
        linked: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'DTO inválido' })
  @ApiResponse({ status: 401, description: 'JWT ausente, inválido ou código de pareamento inválido' })
  async link(
    @Body() dto: LinkAccountDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ linked: boolean }> {
    this.logger.log(
      `Tentativa de link: userGroupId=${user.sub} channel=${dto.channelName} chatId=${dto.chatId}`,
    );

    await this.pairingService.consume(dto.code, {
      channelName: dto.channelName,
      chatId: BigInt(dto.chatId),
    });

    return { linked: true };
  }
}
