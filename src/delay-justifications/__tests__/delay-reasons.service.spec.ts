import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TimezoneService } from '../../common/services/timezone.service';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { DelayReasonsService } from '../delay-reasons.service';
import { DelayReasonsQueryDto } from '../dto/delay-reasons-query.dto';

/**
 * Testes do painel admin de motivos de atraso (Fase 2 — ADR-V2-070).
 *
 * Cobre: RBAC (org ADMIN SOMENTE → 403 p/ não-admin), os 3 groupBy com
 * resolução de rótulo, escopo de org (via projectId vs JWT), 404 de projeto
 * inexistente, e normalização de total/avgDelayDays.
 */
describe('DelayReasonsService', () => {
  let service: DelayReasonsService;
  let prisma: {
    dProject: { findFirst: jest.Mock; findMany: jest.Mock };
    dClasse: { findMany: jest.Mock };
    dEntidade: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let roleResolver: { getOrgRole: jest.Mock };

  const ADMIN = BigInt(42);
  const ORG = BigInt(10);

  const query = (over: Partial<DelayReasonsQueryDto> = {}): DelayReasonsQueryDto => ({
    groupBy: 'motivo',
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      dProject: { findFirst: jest.fn(), findMany: jest.fn() },
      dClasse: { findMany: jest.fn() },
      dEntidade: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };
    roleResolver = { getOrgRole: jest.fn().mockResolvedValue('ADMIN') };

    const module = await Test.createTestingModule({
      providers: [
        DelayReasonsService,
        TimezoneService,
        { provide: PrismaService, useValue: prisma },
        { provide: RoleResolverService, useValue: roleResolver },
      ],
    }).compile();

    service = module.get(DelayReasonsService);
  });

  describe('RBAC (org ADMIN SOMENTE)', () => {
    it('403 quando requester NÃO é org ADMIN (é MEMBER)', async () => {
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');

      await expect(service.aggregate(query(), ADMIN, ORG.toString())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('403 quando requester não tem vínculo de org (null)', async () => {
      roleResolver.getOrgRole.mockResolvedValue(null);
      await expect(service.aggregate(query(), ADMIN, ORG.toString())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('403 quando não há org ativa no JWT nem projectId', async () => {
      await expect(service.aggregate(query(), ADMIN, undefined)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(roleResolver.getOrgRole).not.toHaveBeenCalled();
    });

    it('resolve a org a partir do JWT quando não há projectId e valida ADMIN nessa org', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.dClasse.findMany.mockResolvedValue([]);

      await service.aggregate(query(), ADMIN, ORG.toString());

      expect(roleResolver.getOrgRole).toHaveBeenCalledWith(ADMIN, ORG);
    });
  });

  describe('escopo de org via projectId', () => {
    it('usa a org DONA do projeto (idEstab) e valida ADMIN nela', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(999) });
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.dClasse.findMany.mockResolvedValue([]);

      const res = await service.aggregate(query({ projectId: '77' }), ADMIN, ORG.toString());

      expect(roleResolver.getOrgRole).toHaveBeenCalledWith(ADMIN, BigInt(999));
      expect(res.orgId).toBe('999');
    });

    it('404 quando o projectId informado não existe', async () => {
      prisma.dProject.findFirst.mockResolvedValue(null);
      await expect(
        service.aggregate(query({ projectId: '77' }), ADMIN, ORG.toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('groupBy=motivo', () => {
    it('agrega e resolve rótulos via DClasse (ordenado por count desc)', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { key: '-535', count: 18, avgDelayDays: '3.4' },
        { key: '-531', count: 12, avgDelayDays: '5.06' },
      ]);
      prisma.dClasse.findMany.mockResolvedValue([
        { chave: BigInt(-535), nome: 'Problema técnico / bug' },
        { chave: BigInt(-531), nome: 'Dependência não entregue' },
      ]);

      const res = await service.aggregate(query({ groupBy: 'motivo' }), ADMIN, ORG.toString());

      expect(res.groupBy).toBe('motivo');
      expect(res.total).toBe(30);
      expect(res.groups).toEqual([
        { key: '-535', label: 'Problema técnico / bug', count: 18, avgDelayDays: 3.4 },
        { key: '-531', label: 'Dependência não entregue', count: 12, avgDelayDays: 5.1 },
      ]);
      expect(prisma.dEntidade.findMany).not.toHaveBeenCalled();
      expect(prisma.dProject.findMany).not.toHaveBeenCalled();
    });
  });

  describe('groupBy=usuario', () => {
    it('resolve rótulos via DEntidade', async () => {
      prisma.$queryRaw.mockResolvedValue([{ key: '42', count: 5, avgDelayDays: '2' }]);
      prisma.dEntidade.findMany.mockResolvedValue([{ chave: BigInt(42), nome: 'Maria' }]);

      const res = await service.aggregate(query({ groupBy: 'usuario' }), ADMIN, ORG.toString());

      expect(res.groups[0]).toEqual({ key: '42', label: 'Maria', count: 5, avgDelayDays: 2 });
      expect(prisma.dEntidade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { chave: { in: [BigInt(42)] } } }),
      );
    });
  });

  describe('groupBy=projeto', () => {
    it('resolve rótulos via DProject; label null se projeto não resolvido', async () => {
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: ORG });
      prisma.$queryRaw.mockResolvedValue([
        { key: '10', count: 7, avgDelayDays: null },
        { key: '11', count: 3, avgDelayDays: '4' },
      ]);
      prisma.dProject.findMany.mockResolvedValue([{ chave: BigInt(10), nome: 'Projeto A' }]);

      const res = await service.aggregate(
        query({ groupBy: 'projeto', projectId: '10' }),
        ADMIN,
        ORG.toString(),
      );

      expect(res.groups).toEqual([
        { key: '10', label: 'Projeto A', count: 7, avgDelayDays: null },
        { key: '11', label: null, count: 3, avgDelayDays: 4 },
      ]);
    });
  });

  describe('filtros e eco', () => {
    it('ecoa os filtros aplicados e executa 1 query de agregação', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.dClasse.findMany.mockResolvedValue([]);

      const res = await service.aggregate(
        query({ motivoClasse: '-535', userId: '42', from: '2026-07-01', to: '2026-07-31' }),
        ADMIN,
        ORG.toString(),
      );

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(res.filters).toEqual({
        userId: '42',
        projectId: null,
        motivoClasse: '-535',
        from: '2026-07-01',
        to: '2026-07-31',
      });
      // Sem grupos → não faz query de rótulos.
      expect(prisma.dClasse.findMany).not.toHaveBeenCalled();
      expect(res.total).toBe(0);
    });
  });
});
