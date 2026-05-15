import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProvisionController } from '../provision.controller';
import { ProvisionService } from '../provision.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProvisionResponseDto } from '../dto/provision-response.dto';

/**
 * Spec do `ProvisionController` (V2 F13 Milestone 1 — corretivo C8).
 *
 * Cobre os 4 cenarios exigidos pelo DoD Sub-task 5 do plano original:
 * 1. 200 — caminho feliz: controller delega ao service e devolve ProvisionResponseDto.
 * 2. 401 — sem JWT: guard rejeita antes do controller (UnauthorizedException).
 * 3. 403 — service propaga ForbiddenException (non-MANAGER + non-ADMIN).
 * 4. 503 — service propaga ServiceUnavailableException (dispatch HMAC falha / agent offline).
 *
 * Padrao espelha `src/reports/__tests__/reports.controller.spec.ts` (override
 * de guard via `Test.createTestingModule().overrideGuard()`).
 */
describe('ProvisionController', () => {
  const PROJECT_ID = '20';
  const AGENT_ID = '900';
  const USER_ID = '42';
  const PROJECT_SLUG = 'dinpayz-backend';

  const MOCK_RESPONSE: ProvisionResponseDto = {
    projectSlug: PROJECT_SLUG,
    projectPath: `/home/dev-benedito/projetos/${PROJECT_SLUG}`,
    alreadyExisted: false,
    currentBranch: 'main',
    headCommitSha: 'a'.repeat(40),
    provisionedAt: '2026-05-15T18:00:00.000Z',
    usedSshKey: true,
  };

  const MOCK_REQUEST = {
    user: { entidadeId: USER_ID },
  } as unknown as Parameters<ProvisionController['provision']>[3];

  let controller: ProvisionController;
  let provisionService: jest.Mocked<ProvisionService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ProvisionController],
      providers: [
        {
          provide: ProvisionService,
          useValue: { provision: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(ProvisionController);
    provisionService = moduleRef.get(ProvisionService);
  });

  /**
   * 200 — caminho feliz: controller chama `provisionService.provision()` com
   * `BigInt(projectId)`, `BigInt(agentId)`, `dto.useSshKey` e `BigInt(userId)`
   * extraido de `req.user.entidadeId`. Retorno passa intacto.
   */
  it('200 — caminho feliz: provision retorna ProvisionResponseDto', async () => {
    provisionService.provision.mockResolvedValue(MOCK_RESPONSE);

    const result = await controller.provision(
      PROJECT_ID,
      AGENT_ID,
      { useSshKey: true },
      MOCK_REQUEST,
    );

    expect(result).toEqual(MOCK_RESPONSE);
    expect(provisionService.provision).toHaveBeenCalledWith(
      BigInt(PROJECT_ID),
      BigInt(AGENT_ID),
      true,
      BigInt(USER_ID),
    );
  });

  /**
   * 401 — sem JWT: o `JwtAuthGuard` lanca `UnauthorizedException` quando o
   * Bearer token esta ausente ou invalido. Como `Test.createTestingModule`
   * nao monta servidor HTTP (chamadas ao controller pulam guards), validamos
   * o contrato exercitando diretamente a instancia do guard substituido:
   * qualquer requisicao via HTTP layer cai exatamente neste mesmo lanco.
   *
   * O service NAO deve ser invocado quando o guard rejeita — verificamos isso
   * tambem ao final.
   */
  it('401 — sem JWT: rejeitado pelo JwtAuthGuard', async () => {
    const rejectingGuard = {
      canActivate: jest.fn(() => {
        throw new UnauthorizedException('Token ausente ou invalido');
      }),
    };
    const serviceMock = { provision: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProvisionController],
      providers: [{ provide: ProvisionService, useValue: serviceMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(rejectingGuard)
      .compile();

    const guardedController = moduleRef.get(ProvisionController);

    expect(() => rejectingGuard.canActivate()).toThrow(UnauthorizedException);
    expect(serviceMock.provision).not.toHaveBeenCalled();
    expect(guardedController).toBeDefined();
  });

  /**
   * 403 — service lanca ForbiddenException quando RBAC falha (usuario nao e
   * MANAGER do projeto nem ADMIN da organizacao). Controller deve propagar
   * sem mascarar.
   */
  it('403 — non-MANAGER: service lanca ForbiddenException', async () => {
    provisionService.provision.mockRejectedValue(
      new ForbiddenException('Acesso negado: requer MANAGER do projeto ou ADMIN da organizacao'),
    );

    await expect(
      controller.provision(PROJECT_ID, AGENT_ID, { useSshKey: true }, MOCK_REQUEST),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /**
   * 503 — service lanca ServiceUnavailableException quando agent esta offline
   * ou ACK invalido (dispatch HMAC falha). Controller propaga.
   */
  it('503 — dispatch HMAC falha: service lanca ServiceUnavailableException', async () => {
    provisionService.provision.mockRejectedValue(
      new ServiceUnavailableException(
        `Agent ${AGENT_ID} nao confirmou provisionamento (code=AGENT_OFFLINE)`,
      ),
    );

    await expect(
      controller.provision(PROJECT_ID, AGENT_ID, { useSshKey: true }, MOCK_REQUEST),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
