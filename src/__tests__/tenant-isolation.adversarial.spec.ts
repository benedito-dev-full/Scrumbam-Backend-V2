/**
 * Testes adversariais multi-tenant — ADR-V2-042.
 *
 * Cobertura: 10 cenarios de tentativa de cross-tenant leakage, validando
 * que os services bloqueiam acesso (lista vazia / 404) e nao expoem dados
 * de outra org.
 *
 * Padrao: usuario U pertence as orgs A e B. Recursos PA na org A, PB na
 * org B. Esperado: JWT(orgId=A) ve apenas A; JWT(orgId=B) ve apenas B.
 *
 * Nao usamos a HTTP layer (e2e) — testamos a integracao Service ↔ Prisma
 * que e onde o bug original morava (services ignoravam organizationId).
 */
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { TenantScopeService } from '../common/services/tenant-scope.service';
import { AgentsService } from '../automation/agents/agents.service';
import { AUTOMATION_CLASS_IDS } from '../automation/constants/automation-class-ids';

// ─── Mock factories ──────────────────────────────────────────────────────────

const ORG_A = '50';
const ORG_B = '60';
const USER_U_ENT = BigInt(100);
const PA = BigInt(10); // projeto da org A
const PB = BigInt(20); // projeto da org B
const AGENT_A = BigInt(5); // agente da org A

function makePrisma() {
  const prisma = {
    dVincula: { findMany: jest.fn(), findFirst: jest.fn(), groupBy: jest.fn() },
    dProject: { findFirst: jest.fn(), findMany: jest.fn() },
    dTask: { findFirst: jest.fn(), findMany: jest.fn() },
    dTabela: { findMany: jest.fn(), findFirst: jest.fn() },
    dEntidade: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  return prisma as unknown as {
    dVincula: { findMany: jest.Mock; findFirst: jest.Mock; groupBy: jest.Mock };
    dProject: { findFirst: jest.Mock; findMany: jest.Mock };
    dTask: { findFirst: jest.Mock; findMany: jest.Mock };
    dTabela: { findMany: jest.Mock; findFirst: jest.Mock };
    dEntidade: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
}

describe('Tenant Isolation — Adversarial Scenarios (ADR-V2-042)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 1: GET /projects scopado por org ativa', () => {
    it('JWT(orgId=A) lista apenas PA; JWT(orgId=B) lista apenas PB', async () => {
      const prisma = makePrisma();
      // findMany #1 e #2 sao chamadas em sequencia: memberships, depois teamLinks
      prisma.dVincula.findMany
        .mockResolvedValueOnce([{ idLocEscritu: PA }, { idLocEscritu: PB }])
        .mockResolvedValueOnce([]); // teamLinks vazio
      // DProject.findMany filtra por idEstab=ORG_A → so PA
      prisma.dProject.findMany.mockResolvedValue([
        {
          chave: PA,
          nome: 'PA',
          descricao: null,
          idEstab: BigInt(ORG_A),
          dados: {},
          criadoEm: new Date(),
          atualizadoEm: new Date(),
        },
      ]);
      prisma.dVincula.groupBy.mockResolvedValue([]);

      const svc = new ProjectsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const resultA = await svc.findMany(USER_U_ENT, { organizationId: ORG_A });
      const idsA = resultA.items.map((p) => p.id);
      expect(idsA).toContain(PA.toString());
      expect(idsA).not.toContain(PB.toString());

      // Verificar filtro idEstab no SQL
      const projectFindArgs = prisma.dProject.findMany.mock.calls[0][0];
      expect(projectFindArgs.where.idEstab).toBe(BigInt(ORG_A));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 2: GET /projects/:id cross-tenant via path param → 404', () => {
    it('JWT(orgId=A) tentando GET /projects/PB → NotFoundException', async () => {
      const prisma = makePrisma();
      // PB existe na org B, nao na org A
      prisma.dProject.findFirst.mockResolvedValue({
        chave: PB,
        nome: 'PB',
        descricao: null,
        idEstab: BigInt(ORG_B),
        dados: {},
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });
      prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(999) }); // user e membro
      prisma.dVincula.groupBy.mockResolvedValue([]);

      const svc = new ProjectsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(svc.findOne(PB.toString(), USER_U_ENT, ORG_A)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 3: GET /tasks?projectId=PB com JWT(orgId=A) → lista vazia', () => {
    it('projectId fora do scope autorizado retorna vazio', async () => {
      const prisma = makePrisma();
      const svc = new TasksService(prisma as never, {} as never, {} as never, {} as never);

      // accessibleProjectIds = [PA] (scope JWT(orgId=A))
      const result = await svc.findMany({ projectId: PB.toString() }, [PA.toString()]);

      expect(result.items).toEqual([]);
      expect(prisma.dTask.findMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 4: GET /tasks sem filtro com JWT(orgId=A) → so tasks de PA', () => {
    it('findMany aplica idProject IN (accessibleProjectIds)', async () => {
      const prisma = makePrisma();
      prisma.dTask.findMany.mockResolvedValue([
        {
          chave: BigInt(700),
          idClasse: BigInt(-154),
          idProject: PA,
          nome: 'T-A',
          descricao: null,
          idStatus: null,
          idPriority: null,
          idAssignee: null,
          idSprint: null,
          dados: {},
          excluido: false,
          criadoEm: new Date(),
          atualizadoEm: new Date(),
        },
      ]);
      prisma.dTabela.findMany.mockResolvedValue([]);

      const svc = new TasksService(prisma as never, {} as never, {} as never, {} as never);

      const result = await svc.findMany({}, [PA.toString()]);

      const callArgs = prisma.dTask.findMany.mock.calls[0][0];
      expect(callArgs.where.idProject).toEqual({ in: [PA] });
      expect(result.items.length).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 5: Usuario orfao (sem orgs) faz GET /projects → vazio', () => {
    it('accessibleProjectIds=[] resulta em lista vazia sem hit no banco', async () => {
      const prisma = makePrisma();
      const svc = new TasksService(prisma as never, {} as never, {} as never, {} as never);

      const result = await svc.findMany({}, []);
      expect(result.items).toEqual([]);
      expect(prisma.dTask.findMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 6: MCP list_projects retorna apenas projetos no scope', () => {
    it('findAccessibleProjectIds com orgId=A retorna apenas PA', async () => {
      const prisma = makePrisma();
      prisma.dVincula.findMany.mockResolvedValue([{ idLocEscritu: PA }, { idLocEscritu: PB }]);
      prisma.dProject.findMany.mockResolvedValue([{ chave: PA }]);

      const svc = new ProjectsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const ids = await svc.findAccessibleProjectIds(USER_U_ENT, ORG_A);
      expect(ids).toEqual([PA.toString()]);
      expect(ids).not.toContain(PB.toString());
    });

    it('findAccessibleProjectIds sem orgId (modo MCP cross-org) retorna todos', async () => {
      const prisma = makePrisma();
      prisma.dVincula.findMany.mockResolvedValue([{ idLocEscritu: PA }, { idLocEscritu: PB }]);

      const svc = new ProjectsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const ids = await svc.findAccessibleProjectIds(USER_U_ENT);
      expect(ids).toContain(PA.toString());
      expect(ids).toContain(PB.toString());
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 7: MCP list_tasks sem filtro respeita scope', () => {
    it('TasksService.findMany ignora tasks fora de accessibleProjectIds', async () => {
      const prisma = makePrisma();
      const svc = new TasksService(prisma as never, {} as never, {} as never, {} as never);

      prisma.dTask.findMany.mockResolvedValue([]);
      prisma.dTabela.findMany.mockResolvedValue([]);

      await svc.findMany({ projectIds: [PA.toString(), PB.toString()] }, [PA.toString()]);

      const args = prisma.dTask.findMany.mock.calls[0][0];
      // intersect: so PA permanece (PB removido por estar fora do scope)
      expect(args.where.idProject).toEqual({ in: [PA] });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 8: GET /agents JWT(orgId=A) → apenas agents da org A', () => {
    it('AgentsService.listAgents filtra por idEstab=organizationId', async () => {
      const prisma = makePrisma();
      prisma.dEntidade.findMany.mockResolvedValue([
        {
          chave: AGENT_A,
          nome: 'agentA',
          dados: { lastSeen: null },
          criadoEm: new Date(),
        },
      ]);

      const svc = new AgentsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await svc.listAgents({}, ORG_A);

      const args = prisma.dEntidade.findMany.mock.calls[0][0];
      expect(args.where.idEstab).toBe(BigInt(ORG_A));
      expect(args.where.idClasse).toBe(AUTOMATION_CLASS_IDS.AGENT);
    });

    it('agente standalone (idEstab=null) nao aparece em listagem scopada', async () => {
      const prisma = makePrisma();
      // Simulando: o banco retorna [] porque idEstab=null nao casa com BigInt(50)
      prisma.dEntidade.findMany.mockResolvedValue([]);

      const svc = new AgentsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const items = await svc.listAgents({}, ORG_A);
      expect(items).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 9: TenantScopeService.assertProjectInOrg cross-tenant', () => {
    it('JWT(orgId=A) tentando agir em PB → 404 (anti enumeration)', async () => {
      const prisma = makePrisma();
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(ORG_B) });

      const helper = new TenantScopeService(prisma as never);
      await expect(helper.assertProjectInOrg(PB.toString(), ORG_A)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 10: TenantScopeService.assertTaskInOrg cross-tenant', () => {
    it('JWT(orgId=A) tentando agir em task de PB → 404', async () => {
      const prisma = makePrisma();
      prisma.dTask.findFirst.mockResolvedValue({ idProject: PB });
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(ORG_B) });

      const helper = new TenantScopeService(prisma as never);
      await expect(helper.assertTaskInOrg('777', ORG_A)).rejects.toThrow(NotFoundException);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 11 (extra): TasksService create cross-tenant', () => {
    it('JWT(orgId=A) cria task em projectId=PB → 404', async () => {
      const prisma = makePrisma();
      const svc = new TasksService(prisma as never, {} as never, {} as never, {} as never);

      await expect(
        svc.create(
          {
            nome: 'evil',
            projectId: PB.toString(),
            descricao: null,
            assigneeId: null,
            sprintId: null,
            priority: null,
          } as never,
          USER_U_ENT,
          [PA.toString()], // scope so tem PA
        ),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.dProject.findFirst).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('Cenario 12 (extra): TasksService.findOne cross-tenant via taskId', () => {
    it('JWT(orgId=A) tentando GET /tasks/:id de PB → 404', async () => {
      const prisma = makePrisma();
      prisma.dTask.findFirst.mockResolvedValue({
        chave: BigInt(700),
        idProject: PB,
        nome: 'T-B',
        descricao: null,
        idStatus: null,
        idPriority: null,
        idAssignee: null,
        idSprint: null,
        dados: {},
        excluido: false,
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });

      const svc = new TasksService(prisma as never, {} as never, {} as never, {} as never);

      await expect(svc.findOne('700', [PA.toString()])).rejects.toThrow(NotFoundException);
    });
  });
});
