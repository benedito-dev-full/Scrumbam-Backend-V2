import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

  describe('cruzamento (subGroupBy)', () => {
    it('groupBy=usuario + subGroupBy=motivo: monta groups[].sub, 1 query, 2 findMany, pai = soma dos subs, avg ponderado, sub ordenado', async () => {
      // 2 usuários; usuário 42 com 2 motivos (18 e 12), usuário 7 com 1 motivo (5).
      // Linhas fora de ordem de pai de propósito → força o fold + sort em JS.
      prisma.$queryRaw.mockResolvedValue([
        { key: '42', subKey: '-535', count: 18, avgDelayDays: '3' },
        { key: '7', subKey: '-531', count: 5, avgDelayDays: '10' },
        { key: '42', subKey: '-531', count: 12, avgDelayDays: '8' },
      ]);
      prisma.dEntidade.findMany.mockResolvedValue([
        { chave: BigInt(42), nome: 'Maria' },
        { chave: BigInt(7), nome: 'João' },
      ]);
      prisma.dClasse.findMany.mockResolvedValue([
        { chave: BigInt(-535), nome: 'Problema técnico / bug' },
        { chave: BigInt(-531), nome: 'Dependência não entregue' },
      ]);

      const res = await service.aggregate(
        query({ groupBy: 'usuario', subGroupBy: 'motivo' }),
        ADMIN,
        ORG.toString(),
      );

      // 1 única query de agregação.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // Rótulos das DUAS dimensões: exatamente 1 findMany por dimensão.
      expect(prisma.dEntidade.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.dClasse.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.dProject.findMany).not.toHaveBeenCalled();

      expect(res.groupBy).toBe('usuario');
      expect(res.subGroupBy).toBe('motivo');
      expect(res.total).toBe(35); // 18 + 12 + 5

      // Pais ordenados por count desc: Maria(30) antes de João(5).
      expect(res.groups).toEqual([
        {
          key: '42',
          label: 'Maria',
          count: 30, // 18 + 12
          // avg ponderado: (18*3 + 12*8) / 30 = 150/30 = 5.0
          avgDelayDays: 5,
          sub: [
            { key: '-535', label: 'Problema técnico / bug', count: 18, avgDelayDays: 3 },
            { key: '-531', label: 'Dependência não entregue', count: 12, avgDelayDays: 8 },
          ],
        },
        {
          key: '7',
          label: 'João',
          count: 5,
          avgDelayDays: 10,
          sub: [{ key: '-531', label: 'Dependência não entregue', count: 5, avgDelayDays: 10 }],
        },
      ]);
    });

    it('avg ponderado ignora subs com avg null (numerador e denominador)', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { key: '42', subKey: '-535', count: 10, avgDelayDays: '4' },
        { key: '42', subKey: '-531', count: 5, avgDelayDays: null },
      ]);
      prisma.dEntidade.findMany.mockResolvedValue([{ chave: BigInt(42), nome: 'Maria' }]);
      prisma.dClasse.findMany.mockResolvedValue([
        { chave: BigInt(-535), nome: 'Bug' },
        { chave: BigInt(-531), nome: 'Dependência' },
      ]);

      const res = await service.aggregate(
        query({ groupBy: 'usuario', subGroupBy: 'motivo' }),
        ADMIN,
        ORG.toString(),
      );

      // count do pai soma TODOS os subs (10 + 5), mas avg pondera só o sub com amostra: 40/10 = 4.
      expect(res.groups[0].count).toBe(15);
      expect(res.groups[0].avgDelayDays).toBe(4);
      expect(res.groups[0].sub).toEqual([
        { key: '-535', label: 'Bug', count: 10, avgDelayDays: 4 },
        { key: '-531', label: 'Dependência', count: 5, avgDelayDays: null },
      ]);
    });

    it('400 quando subGroupBy === groupBy', async () => {
      await expect(
        service.aggregate(
          query({ groupBy: 'motivo', subGroupBy: 'motivo' }),
          ADMIN,
          ORG.toString(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Falha ANTES de qualquer agregação.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('RBAC continua: MEMBER → 403 mesmo com subGroupBy', async () => {
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      await expect(
        service.aggregate(
          query({ groupBy: 'usuario', subGroupBy: 'motivo' }),
          ADMIN,
          ORG.toString(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('sem subGroupBy: resposta retrocompatível (subGroupBy null, sub ausente, 1 dimensão de label)', async () => {
      prisma.$queryRaw.mockResolvedValue([{ key: '-535', count: 18, avgDelayDays: '3.4' }]);
      prisma.dClasse.findMany.mockResolvedValue([
        { chave: BigInt(-535), nome: 'Problema técnico / bug' },
      ]);

      const res = await service.aggregate(query({ groupBy: 'motivo' }), ADMIN, ORG.toString());

      expect(res.subGroupBy).toBeNull();
      // `sub` NÃO aparece nos grupos.
      expect(res.groups[0]).not.toHaveProperty('sub');
      expect(res.groups[0]).toEqual({
        key: '-535',
        label: 'Problema técnico / bug',
        count: 18,
        avgDelayDays: 3.4,
      });
      // Só 1 dimensão de rótulo resolvida.
      expect(prisma.dClasse.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.dEntidade.findMany).not.toHaveBeenCalled();
      expect(prisma.dProject.findMany).not.toHaveBeenCalled();
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
