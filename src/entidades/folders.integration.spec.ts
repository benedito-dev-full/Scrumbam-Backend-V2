import { Test, TestingModule } from '@nestjs/testing';
import { FoldersService } from './folders.service';
import { PrismaService } from '../prisma.service';
import { RoleResolverService } from '../auth/services/role-resolver.service';

/**
 * Integration-style tests para FoldersService (ADR-V2-FOLDERS-001).
 *
 * Não usa Postgres real (repo V2 ainda não tem infra de testcontainers para
 * specs). Em vez disso, simula um Prisma in-memory que persiste estado entre
 * chamadas — exercita fluxos end-to-end (criar folder → mover projects →
 * deletar folder com cascata → listar limbo) verificando invariantes:
 *
 *  - 1 project tem no máximo 1 vínculo ativo -183 ao mesmo tempo (N:1)
 *  - Mover project entre folders invalida o vínculo anterior
 *  - Delete de folder move projects de volta para o limbo (CEO Q4)
 *  - listUnassigned reflete corretamente projects órfãos após cada operação
 */

/** Linha simulada da DEntidade no in-memory store. */
interface EntidadeRow {
  chave: bigint;
  idClasse: bigint;
  nome: string;
  idEstab: bigint | null;
  excluido: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
}

/** Linha simulada da DVincula no in-memory store. */
interface VinculaRow {
  chave: bigint;
  idClasse: bigint;
  idLocEscritu: bigint | null;
  idEntidade: bigint | null;
  excluido: boolean;
  criadoEm: Date;
}

/** Linha simulada da DProject no in-memory store. */
interface ProjectRow {
  chave: bigint;
  idClasse: bigint;
  idEstab: bigint | null;
  nome: string;
  excluido: boolean;
}

/**
 * In-memory store simples para entidades + vinculos + projects. Não cobre
 * todos os edge cases do Prisma — cobre exatamente as queries usadas por
 * FoldersService.
 */
class InMemoryStore {
  entidades: EntidadeRow[] = [];
  vinculos: VinculaRow[] = [];
  projects: ProjectRow[] = [];
  private entSeq = 1000n;
  private vinSeq = 2000n;

  addEntidade(row: Partial<EntidadeRow>): EntidadeRow {
    const full: EntidadeRow = {
      chave: row.chave ?? ++this.entSeq,
      idClasse: row.idClasse!,
      nome: row.nome ?? '',
      idEstab: row.idEstab ?? null,
      excluido: row.excluido ?? false,
      criadoEm: row.criadoEm ?? new Date(),
      atualizadoEm: row.atualizadoEm ?? new Date(),
    };
    this.entidades.push(full);
    return full;
  }

  addVincula(row: Partial<VinculaRow>): VinculaRow {
    const full: VinculaRow = {
      chave: row.chave ?? ++this.vinSeq,
      idClasse: row.idClasse!,
      idLocEscritu: row.idLocEscritu ?? null,
      idEntidade: row.idEntidade ?? null,
      excluido: row.excluido ?? false,
      criadoEm: row.criadoEm ?? new Date(),
    };
    this.vinculos.push(full);
    return full;
  }

  addProject(row: Partial<ProjectRow>): ProjectRow {
    const full: ProjectRow = {
      chave: row.chave!,
      idClasse: row.idClasse ?? BigInt(-153),
      idEstab: row.idEstab ?? null,
      nome: row.nome ?? '',
      excluido: row.excluido ?? false,
    };
    this.projects.push(full);
    return full;
  }
}

/**
 * Cria mock Prisma que delega para o InMemoryStore (cobre só queries usadas).
 */
function buildPrismaMock(store: InMemoryStore): jest.Mocked<PrismaService> {
  // Helper p/ avaliar where clauses dos campos suportados
  const matchEntidade = (row: EntidadeRow, where: Record<string, unknown>): boolean => {
    if (where.chave !== undefined && row.chave !== where.chave) return false;
    if (where.idClasse !== undefined) {
      const cls = where.idClasse;
      if (typeof cls === 'object' && cls !== null && 'in' in cls) {
        const arr = (cls as { in: bigint[] }).in;
        if (!arr.includes(row.idClasse)) return false;
      } else if (row.idClasse !== cls) {
        return false;
      }
    }
    if (where.idEstab !== undefined && row.idEstab !== where.idEstab) return false;
    if (where.excluido !== undefined && row.excluido !== where.excluido) return false;
    return true;
  };

  const matchVincula = (row: VinculaRow, where: Record<string, unknown>): boolean => {
    if (where.idClasse !== undefined && row.idClasse !== where.idClasse) return false;
    if (where.idLocEscritu !== undefined) {
      const v = where.idLocEscritu;
      if (typeof v === 'object' && v !== null && 'in' in v) {
        const arr = (v as { in: bigint[] }).in;
        if (row.idLocEscritu === null || !arr.includes(row.idLocEscritu)) return false;
      } else if (row.idLocEscritu !== v) {
        return false;
      }
    }
    if (where.idEntidade !== undefined) {
      const v = where.idEntidade;
      if (typeof v === 'object' && v !== null && 'in' in v) {
        const arr = (v as { in: bigint[] }).in;
        if (row.idEntidade === null || !arr.includes(row.idEntidade)) return false;
      } else if (row.idEntidade !== v) {
        return false;
      }
    }
    if (where.excluido !== undefined && row.excluido !== where.excluido) return false;
    return true;
  };

  const matchProject = (row: ProjectRow, where: Record<string, unknown>): boolean => {
    if (where.chave !== undefined) {
      const v = where.chave;
      if (typeof v === 'object' && v !== null && 'in' in v) {
        const arr = (v as { in: bigint[] }).in;
        if (!arr.includes(row.chave)) return false;
      } else if (row.chave !== v) {
        return false;
      }
    }
    if (where.idEstab !== undefined && row.idEstab !== where.idEstab) return false;
    if (where.excluido !== undefined && row.excluido !== where.excluido) return false;
    return true;
  };

  const mock = {
    dEntidade: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(store.entidades.find((e) => matchEntidade(e, where)) ?? null),
      ),
      findMany: jest.fn(
        ({
          where,
          orderBy,
        }: {
          where: Record<string, unknown>;
          orderBy?: { nome?: 'asc' | 'desc' };
        }) => {
          let rows = store.entidades.filter((e) => matchEntidade(e, where));
          if (orderBy?.nome === 'asc') {
            rows = [...rows].sort((a, b) => a.nome.localeCompare(b.nome));
          }
          return Promise.resolve(rows);
        },
      ),
      create: jest.fn(({ data }: { data: Partial<EntidadeRow> }) =>
        Promise.resolve(store.addEntidade(data)),
      ),
      update: jest.fn(
        ({ where, data }: { where: { chave: bigint }; data: Partial<EntidadeRow> }) => {
          const idx = store.entidades.findIndex((e) => e.chave === where.chave);
          if (idx >= 0) {
            store.entidades[idx] = {
              ...store.entidades[idx],
              ...data,
              atualizadoEm: new Date(),
            };
            return Promise.resolve(store.entidades[idx]);
          }
          return Promise.reject(new Error('not found'));
        },
      ),
    },
    dVincula: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(store.vinculos.find((v) => matchVincula(v, where)) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(store.vinculos.filter((v) => matchVincula(v, where))),
      ),
      groupBy: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const filtered = store.vinculos.filter((v) => matchVincula(v, where));
        const counts = new Map<string, number>();
        for (const v of filtered) {
          const key = v.idLocEscritu?.toString() ?? 'null';
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return Promise.resolve(
          Array.from(counts.entries()).map(([k, n]) => ({
            idLocEscritu: BigInt(k),
            _count: { chave: n },
          })),
        );
      }),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(store.vinculos.filter((v) => matchVincula(v, where)).length),
      ),
      create: jest.fn(({ data }: { data: Partial<VinculaRow> }) =>
        Promise.resolve(store.addVincula(data)),
      ),
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Partial<VinculaRow> }) => {
          const matches = store.vinculos.filter((v) => matchVincula(v, where));
          for (const m of matches) {
            Object.assign(m, data);
          }
          return Promise.resolve({ count: matches.length });
        },
      ),
    },
    dProject: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(store.projects.find((p) => matchProject(p, where)) ?? null),
      ),
      findMany: jest.fn(
        ({
          where,
          orderBy,
        }: {
          where: Record<string, unknown>;
          orderBy?: { nome?: 'asc' | 'desc' };
        }) => {
          let rows = store.projects.filter((p) => matchProject(p, where));
          if (orderBy?.nome === 'asc') {
            rows = [...rows].sort((a, b) => a.nome.localeCompare(b.nome));
          }
          return Promise.resolve(rows);
        },
      ),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mock)),
  } as unknown as jest.Mocked<PrismaService>;

  return mock;
}

describe('FoldersService — integration scenarios', () => {
  let service: FoldersService;
  let store: InMemoryStore;
  let roleResolver: { getOrgRole: jest.Mock };

  const ORG_ID = BigInt(100);
  const USER_ID = BigInt(150);

  beforeEach(async () => {
    store = new InMemoryStore();
    roleResolver = { getOrgRole: jest.fn().mockResolvedValue('ADMIN') };

    // Seed inicial: 1 org + 3 projects (limbo)
    store.addEntidade({
      chave: ORG_ID,
      idClasse: BigInt(-152),
      nome: 'Acme Corp',
      idEstab: null,
    });
    store.addProject({ chave: BigInt(300), idEstab: ORG_ID, nome: 'Backend' });
    store.addProject({ chave: BigInt(301), idEstab: ORG_ID, nome: 'Frontend' });
    store.addProject({ chave: BigInt(302), idEstab: ORG_ID, nome: 'Mobile' });

    const prismaMock = buildPrismaMock(store);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoldersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RoleResolverService, useValue: roleResolver },
      ],
    }).compile();

    service = module.get<FoldersService>(FoldersService);
  });

  it('fluxo completo: cria folder → move 2 projects → lista projects → listUnassigned', async () => {
    // 1) Cria folder
    const folder = await service.create(
      { nome: 'Cliente Acme', organizationId: ORG_ID.toString() },
      USER_ID,
    );
    expect(folder.projectCount).toBe(0);

    // 2) Move 2 projects para a folder
    await service.moveProject(folder.id, '300', USER_ID);
    await service.moveProject(folder.id, '301', USER_ID);

    // 3) Lista projects da folder
    const list = await service.listProjects(folder.id, USER_ID);
    expect(list.items).toHaveLength(2);
    expect(list.items.map((p) => p.id).sort()).toEqual(['300', '301']);

    // 4) Verifica que limbo só tem o project 302
    const limbo = await service.listUnassigned(ORG_ID.toString(), USER_ID);
    expect(limbo.items).toHaveLength(1);
    expect(limbo.items[0].id).toBe('302');

    // 5) findById confirma projectCount=2
    const refetched = await service.findById(folder.id, USER_ID);
    expect(refetched.projectCount).toBe(2);
  });

  it('move project entre folders invalida o vínculo anterior (invariante N:1)', async () => {
    const folderA = await service.create(
      { nome: 'Pasta A', organizationId: ORG_ID.toString() },
      USER_ID,
    );
    const folderB = await service.create(
      { nome: 'Pasta B', organizationId: ORG_ID.toString() },
      USER_ID,
    );

    // Move project 300 para A
    await service.moveProject(folderA.id, '300', USER_ID);
    let listA = await service.listProjects(folderA.id, USER_ID);
    expect(listA.items).toHaveLength(1);

    // Move o MESMO project para B
    await service.moveProject(folderB.id, '300', USER_ID);

    // A deve ficar vazia, B deve ter 1
    listA = await service.listProjects(folderA.id, USER_ID);
    const listB = await service.listProjects(folderB.id, USER_ID);
    expect(listA.items).toHaveLength(0);
    expect(listB.items).toHaveLength(1);
    expect(listB.items[0].id).toBe('300');

    // Invariante N:1: deve haver no máximo 1 vínculo ativo para project 300
    const activeLinks = store.vinculos.filter(
      (v) => v.idClasse === BigInt(-183) && v.idEntidade === BigInt(300) && !v.excluido,
    );
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0].idLocEscritu).toBe(BigInt(folderB.id));
  });

  it('delete de folder com projects move projects para o limbo (CEO Q4)', async () => {
    const folder = await service.create({ nome: 'X', organizationId: ORG_ID.toString() }, USER_ID);
    await service.moveProject(folder.id, '300', USER_ID);
    await service.moveProject(folder.id, '301', USER_ID);

    // Confirma estado inicial: 2 projects na folder, 1 no limbo
    let limbo = await service.listUnassigned(ORG_ID.toString(), USER_ID);
    expect(limbo.items).toHaveLength(1);

    // Delete da folder
    await service.delete(folder.id, USER_ID);

    // Limbo agora tem todos os 3 projects (DProject NÃO foi deletado)
    limbo = await service.listUnassigned(ORG_ID.toString(), USER_ID);
    expect(limbo.items).toHaveLength(3);
    expect(limbo.items.map((p) => p.id).sort()).toEqual(['300', '301', '302']);

    // DProject ainda existe (verifica no store que projects estão intactos)
    expect(store.projects.filter((p) => !p.excluido)).toHaveLength(3);

    // Folder está soft-deletada
    const folderRow = store.entidades.find((e) => e.chave === BigInt(folder.id));
    expect(folderRow?.excluido).toBe(true);
  });

  it('listAllByOrg retorna folders alfabeticamente com projectCount preciso', async () => {
    const folderZ = await service.create(
      { nome: 'Zeta', organizationId: ORG_ID.toString() },
      USER_ID,
    );
    const folderA = await service.create(
      { nome: 'Alpha', organizationId: ORG_ID.toString() },
      USER_ID,
    );
    await service.moveProject(folderZ.id, '300', USER_ID);
    await service.moveProject(folderA.id, '301', USER_ID);
    await service.moveProject(folderA.id, '302', USER_ID);

    const list = await service.findAllByOrg(ORG_ID.toString(), USER_ID);

    expect(list.items.map((f) => f.nome)).toEqual(['Alpha', 'Zeta']);
    expect(list.items[0].projectCount).toBe(2); // Alpha
    expect(list.items[1].projectCount).toBe(1); // Zeta
  });

  it('unmoveProject move project de volta para limbo de forma idempotente', async () => {
    const folder = await service.create({ nome: 'X', organizationId: ORG_ID.toString() }, USER_ID);
    await service.moveProject(folder.id, '300', USER_ID);

    let limbo = await service.listUnassigned(ORG_ID.toString(), USER_ID);
    expect(limbo.items.map((p) => p.id).sort()).toEqual(['301', '302']);

    // Desvincula
    await service.unmoveProject(folder.id, '300', USER_ID);

    limbo = await service.listUnassigned(ORG_ID.toString(), USER_ID);
    expect(limbo.items.map((p) => p.id).sort()).toEqual(['300', '301', '302']);

    // Idempotente: chamar de novo não erra
    await expect(service.unmoveProject(folder.id, '300', USER_ID)).resolves.toBeUndefined();
  });

  it('resolveFolderIdsForProjects retorna map com folderIds resolvidos para uso em ProjectsService', async () => {
    const folder = await service.create({ nome: 'X', organizationId: ORG_ID.toString() }, USER_ID);
    await service.moveProject(folder.id, '300', USER_ID);

    const map = await service.resolveFolderIdsForProjects([BigInt(300), BigInt(301), BigInt(302)]);

    expect(map.get('300')).toBe(folder.id);
    expect(map.get('301')).toBeNull();
    expect(map.get('302')).toBeNull();
  });
});
