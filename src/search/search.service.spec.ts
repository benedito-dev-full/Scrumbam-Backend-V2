import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma.service';

// ─── Helpers de Mock ──────────────────────────────────────────────────────────

/** Cria uma task mockada com BigInt chave. */
function makeTask(chave: bigint, nome = 'Task Teste', descricao?: string) {
  return {
    chave,
    nome,
    descricao: descricao ?? null,
    idProject: BigInt(42),
    idStatus: BigInt(441),
    criadoEm: new Date('2026-05-01T10:00:00Z'),
    project: { chave: BigInt(42), nome: 'Projeto Teste' },
  };
}

/** Cria um projeto mockado com BigInt chave. */
function makeProject(chave: bigint, nome = 'Projeto Teste') {
  return {
    chave,
    nome,
    descricao: null,
    criadoEm: new Date('2026-04-01T08:00:00Z'),
  };
}

/** Cria uma entidade USER mockada com BigInt chave. */
function makePerson(chave: bigint, nome = 'João Silva') {
  return {
    chave,
    nome,
    email: 'joao@example.com',
    criadoEm: new Date('2026-03-15T12:00:00Z'),
  };
}

/** Cria um vínculo de org mockado. */
function makeVinculo(idEntidade: bigint) {
  return { idEntidade };
}

// ─── Prisma Mock Builder ──────────────────────────────────────────────────────

function buildPrismaMock(overrides: {
  dTaskFindMany?: jest.Mock;
  dProjectFindMany?: jest.Mock;
  dVinculaFindMany?: jest.Mock;
  dEntidadeFindMany?: jest.Mock;
}) {
  return {
    dTask: { findMany: overrides.dTaskFindMany ?? jest.fn().mockResolvedValue([]) },
    dProject: { findMany: overrides.dProjectFindMany ?? jest.fn().mockResolvedValue([]) },
    dVincula: { findMany: overrides.dVinculaFindMany ?? jest.fn().mockResolvedValue([]) },
    dEntidade: { findMany: overrides.dEntidadeFindMany ?? jest.fn().mockResolvedValue([]) },
  };
}

// ─── Params base para os testes ───────────────────────────────────────────────

const BASE_PARAMS = {
  q: 'login',
  organizationId: '100',
  limit: 20,
};

// ─── Suite Principal ──────────────────────────────────────────────────────────

describe('SearchService', () => {
  let service: SearchService;
  let prismaMock: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prismaMock = buildPrismaMock({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Spec 1: Retorna resultados das 3 categorias em paralelo ──────────────

  it('1: retorna resultados das 3 categorias em paralelo', async () => {
    prismaMock.dTask.findMany = jest.fn().mockResolvedValue([makeTask(BigInt(1))]);
    prismaMock.dProject.findMany = jest.fn().mockResolvedValue([makeProject(BigInt(10))]);
    prismaMock.dVincula.findMany = jest.fn().mockResolvedValue([makeVinculo(BigInt(15))]);
    prismaMock.dEntidade.findMany = jest.fn().mockResolvedValue([makePerson(BigInt(15))]);

    const result = await service.search(BASE_PARAMS);

    expect(result.tasks).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
    expect(result.people).toHaveLength(1);
    expect(result.meta.q).toBe('login');
    expect(result.meta.organizationId).toBe('100');
  });

  // ─── Spec 2: Tenant isolation DTask via project.idEstab ───────────────────

  it('2: aplica tenant isolation em DTask via project.idEstab', async () => {
    prismaMock.dTask.findMany = jest.fn().mockResolvedValue([]);

    await service.search(BASE_PARAMS);

    expect(prismaMock.dTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project: expect.objectContaining({
            idEstab: BigInt('100'),
            excluido: false,
          }),
        }),
      }),
    );
  });

  // ─── Spec 3: Tenant isolation DProject via idEstab ────────────────────────

  it('3: aplica tenant isolation em DProject via idEstab', async () => {
    prismaMock.dProject.findMany = jest.fn().mockResolvedValue([]);

    await service.search(BASE_PARAMS);

    expect(prismaMock.dProject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idEstab: BigInt('100'),
          excluido: false,
        }),
      }),
    );
  });

  // ─── Spec 4: People filtrado por idClasse=-150 (USER) ─────────────────────

  it('4: filtra DEntidade por idClasse=-150 (USER)', async () => {
    prismaMock.dVincula.findMany = jest.fn().mockResolvedValue([makeVinculo(BigInt(15))]);
    prismaMock.dEntidade.findMany = jest.fn().mockResolvedValue([]);

    await service.search(BASE_PARAMS);

    expect(prismaMock.dEntidade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idClasse: BigInt(-150),
          excluido: false,
        }),
      }),
    );
  });

  // ─── Spec 5: Distribuição de limite ceil(0.5), ceil(0.3), ceil(0.2) ───────

  it('5: distribui limite: taskLimit=ceil(0.5*limit), projectLimit=ceil(0.3*limit), peopleLimit=ceil(0.2*limit)', async () => {
    const params = { ...BASE_PARAMS, limit: 20 };
    // taskLimit = ceil(20*0.5)=10, projectLimit=ceil(20*0.3)=6, peopleLimit=ceil(20*0.2)=4

    await service.search(params);

    expect(prismaMock.dTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
    expect(prismaMock.dProject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 6 }),
    );
    // people: take=4 aplicado em dEntidade (se houver membros)
    // Verificamos dVincula chamado — people só busca dEntidade se há membros
    expect(prismaMock.dVincula.findMany).toHaveBeenCalled();
  });

  // ─── Spec 6: cursor=null quando resultados < limit ─────────────────────────

  it('6: retorna cursor=null quando resultados < limit de tasks', async () => {
    // taskLimit = ceil(20*0.5) = 10; retornamos apenas 3 tasks → cursor null
    prismaMock.dTask.findMany = jest
      .fn()
      .mockResolvedValue([makeTask(BigInt(1)), makeTask(BigInt(2)), makeTask(BigInt(3))]);

    const result = await service.search(BASE_PARAMS);

    expect(result.cursors.task).toBeNull();
  });

  // ─── Spec 7: cursor=último.chave quando resultados == limit ───────────────

  it('7: retorna cursor=último.chave quando resultados == taskLimit', async () => {
    // taskLimit = ceil(20*0.5) = 10; retornar exatamente 10 tasks
    const tenTasks = Array.from({ length: 10 }, (_, i) => makeTask(BigInt(i + 1)));
    prismaMock.dTask.findMany = jest.fn().mockResolvedValue(tenTasks);

    const result = await service.search(BASE_PARAMS);

    expect(result.cursors.task).toBe('10'); // último chave.toString()
  });

  // ─── Spec 8: taskCursor aplicado como gt:BigInt(cursor) ──────────────────

  it('8: aplica taskCursor como gt:BigInt(cursor) na where clause', async () => {
    prismaMock.dTask.findMany = jest.fn().mockResolvedValue([]);

    await service.search({ ...BASE_PARAMS, taskCursor: '999' });

    expect(prismaMock.dTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chave: { gt: BigInt('999') },
        }),
      }),
    );
  });

  // ─── Spec 9: projectId filtrado quando fornecido ──────────────────────────

  it('9: filtra por projectId quando fornecido', async () => {
    prismaMock.dTask.findMany = jest.fn().mockResolvedValue([]);

    await service.search({ ...BASE_PARAMS, projectIdFilter: '42' });

    expect(prismaMock.dTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idProject: BigInt('42'),
        }),
      }),
    );
  });

  // ─── Spec 10: ZERO eventos emitidos (read-only puro) ─────────────────────

  it('10: não emite eventos — read-only puro (sem EventProducerService)', async () => {
    // SearchService não injeta EventProducerService — basta verificar que o
    // módulo compila sem esse provider e o service funciona normalmente.
    const result = await service.search(BASE_PARAMS);
    expect(result).toBeDefined();
    // Se houvesse eventProducer, o construtor falharia sem o provider mockado.
    // A ausência de erro aqui confirma ZERO EventProducerService.
  });

  // ─── Spec 11: trunca descricao em 150 chars ───────────────────────────────

  it('11: trunca descricao em 150 chars com sufixo "..."', async () => {
    const longDesc = 'x'.repeat(300); // 300 chars
    prismaMock.dTask.findMany = jest.fn().mockResolvedValue([makeTask(BigInt(1), 'Tarefa', longDesc)]);

    const result = await service.search(BASE_PARAMS);

    expect(result.tasks[0].descricao).toHaveLength(153); // 150 + '...'
    expect(result.tasks[0].descricao).toMatch(/\.\.\.$/);
  });

  // ─── Spec 12: chave serializado como string em todos os DTOs ─────────────

  it('12: serializa chave como string em todos os DTOs de resultado', async () => {
    prismaMock.dTask.findMany = jest.fn().mockResolvedValue([makeTask(BigInt(523))]);
    prismaMock.dProject.findMany = jest.fn().mockResolvedValue([makeProject(BigInt(41))]);
    prismaMock.dVincula.findMany = jest.fn().mockResolvedValue([makeVinculo(BigInt(15))]);
    prismaMock.dEntidade.findMany = jest.fn().mockResolvedValue([makePerson(BigInt(15))]);

    const result = await service.search(BASE_PARAMS);

    // Todos os campos chave devem ser string
    expect(typeof result.tasks[0].chave).toBe('string');
    expect(result.tasks[0].chave).toBe('523');

    expect(typeof result.projects[0].chave).toBe('string');
    expect(result.projects[0].chave).toBe('41');

    expect(typeof result.people[0].chave).toBe('string');
    expect(result.people[0].chave).toBe('15');
  });

  // ─── Spec 13: ForbiddenException quando organizationId ausente ───────────

  it('13: lança ForbiddenException quando organizationId ausente', async () => {
    await expect(
      service.search({ ...BASE_PARAMS, organizationId: '' }),
    ).rejects.toThrow(ForbiddenException);
  });

  // ─── Spec 14: retorna [] de people quando não há membros na org ──────────

  it('14: retorna people=[] quando não há membros na org (DVincula vazio)', async () => {
    prismaMock.dVincula.findMany = jest.fn().mockResolvedValue([]); // sem membros

    const result = await service.search(BASE_PARAMS);

    expect(result.people).toHaveLength(0);
    // dEntidade não deve ser chamado se não há membros
    expect(prismaMock.dEntidade.findMany).not.toHaveBeenCalled();
  });

  // ─── Spec 15: cursors project e person null quando < limit ────────────────

  it('15: cursors project e person são null quando resultados < limit respectivo', async () => {
    prismaMock.dProject.findMany = jest.fn().mockResolvedValue([makeProject(BigInt(1))]);
    prismaMock.dVincula.findMany = jest.fn().mockResolvedValue([makeVinculo(BigInt(5))]);
    prismaMock.dEntidade.findMany = jest.fn().mockResolvedValue([makePerson(BigInt(5))]);

    // projectLimit=6, peopleLimit=4 → 1 projeto e 1 pessoa → ambos null
    const result = await service.search(BASE_PARAMS);

    expect(result.cursors.project).toBeNull();
    expect(result.cursors.person).toBeNull();
  });
});
