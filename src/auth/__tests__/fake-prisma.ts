import { createHash } from 'crypto';

/**
 * Fake in-memory do subconjunto de `PrismaService` usado pelo fluxo de
 * `POST /auth/refresh` (F1 — hotfix de sessão).
 *
 * Por que um fake e não `jest.fn()` soltos: os testes §6.1/§6.7 do plano são
 * sobre **estado compartilhado sob concorrência** (dois refresh do mesmo token).
 * Um mock que devolve valor fixo não reproduz a corrida — ele não tem estado.
 * Este fake guarda o `dados` do DUserGroup de verdade e implementa:
 *
 * - `findUnique` / `update` — read-modify-write (o que o código faz hoje);
 * - `updateMany` com filtro Json (`dados: { path: ['refreshTokenHash'], equals }`)
 *   — o **compare-and-swap** que a rotação passa a usar na F1.
 *
 * Cada operação é atômica (como um statement SQL), mas o intervalo ENTRE
 * operações é interleavável (`setImmediate`) — exatamente a janela onde a
 * corrida de duas abas acontece em produção.
 *
 * Uso restrito a testes.
 */
export interface FakeUserGroup {
  chave: bigint;
  usuario: string;
  senha: string;
  nome: string;
  ativo: boolean;
  excluido: boolean;
  dados: Record<string, unknown>;
}

export interface FakeEntidade {
  chave: bigint;
  nome: string;
  idClasse: bigint;
  excluido: boolean;
  dUserGroupId: bigint;
}

export interface FakeVincula {
  chave: bigint;
  idClasse: bigint;
  idEntidade: bigint;
  idLocEscritu: bigint;
  excluido: boolean;
  locEscritu?: { chave: bigint; nome: string };
}

/** SHA-256 hex — mesma função que o RefreshTokenService usa. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Cede o event loop — simula a latência de ida-e-volta ao banco. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export class FakePrisma {
  readonly userGroups: FakeUserGroup[] = [];
  readonly entidades: FakeEntidade[] = [];
  readonly vinculos: FakeVincula[] = [];
  readonly eventos: Array<Record<string, unknown>> = [];

  /** Quantas vezes o slot de refresh foi APAGADO (revoke). É o "sangramento". */
  revokeCount = 0;

  readonly dUserGroup = {
    findUnique: async (args: {
      where: { chave: bigint };
      include?: { entidades?: unknown };
      select?: unknown;
    }): Promise<unknown> => {
      await tick();
      const ug = this.userGroups.find((u) => u.chave === args.where.chave);
      if (!ug) return null;
      const base = { ...ug, dados: { ...ug.dados } };
      if (args.include?.entidades) {
        return {
          ...base,
          entidades: this.entidades.filter((e) => e.dUserGroupId === ug.chave && !e.excluido),
        };
      }
      return base;
    },

    findFirst: async (args: { where: { usuario?: string } }): Promise<unknown> => {
      await tick();
      const ug = this.userGroups.find((u) => u.usuario === args.where.usuario);
      if (!ug) return null;
      return {
        ...ug,
        dados: { ...ug.dados },
        entidades: this.entidades.filter((e) => e.dUserGroupId === ug.chave && !e.excluido),
      };
    },

    findMany: async (args: { take?: number } = {}): Promise<unknown[]> => {
      await tick();
      return this.userGroups
        .filter((u) => !u.excluido && u.ativo)
        .slice(0, args.take ?? this.userGroups.length)
        .map((u) => ({ chave: u.chave, dados: { ...u.dados } }));
    },

    update: async (args: {
      where: { chave: bigint };
      data: { dados?: Record<string, unknown>; ultimoLogin?: Date };
    }): Promise<unknown> => {
      await tick();
      const ug = this.userGroups.find((u) => u.chave === args.where.chave);
      if (!ug) throw new Error('FakePrisma: DUserGroup não encontrado');
      if (args.data.dados !== undefined) {
        const tinhaHash = typeof ug.dados.refreshTokenHash === 'string';
        const temHash = typeof args.data.dados.refreshTokenHash === 'string';
        if (tinhaHash && !temHash) {
          this.revokeCount += 1;
        }
        ug.dados = { ...args.data.dados };
      }
      return { ...ug };
    },

    /**
     * Compare-and-swap: só aplica o UPDATE se o hash corrente no banco ainda
     * for o esperado (filtro Json). `count: 0` = perdeu a corrida.
     */
    updateMany: async (args: {
      where: { chave: bigint; dados?: { path: string[]; equals: unknown } };
      data: { dados: Record<string, unknown> };
    }): Promise<{ count: number }> => {
      await tick();
      const ug = this.userGroups.find((u) => u.chave === args.where.chave);
      if (!ug) return { count: 0 };

      if (args.where.dados) {
        const [key] = args.where.dados.path;
        if (ug.dados[key] !== args.where.dados.equals) {
          return { count: 0 };
        }
      }

      ug.dados = { ...args.data.dados };
      return { count: 1 };
    },
  };

  readonly dEntidade = {
    findFirst: async (args: {
      where: { dUserGroupId?: bigint; chave?: bigint };
    }): Promise<unknown> => {
      await tick();
      return (
        this.entidades.find(
          (e) =>
            !e.excluido &&
            (args.where.dUserGroupId === undefined || e.dUserGroupId === args.where.dUserGroupId) &&
            (args.where.chave === undefined || e.chave === args.where.chave),
        ) ?? null
      );
    },
  };

  readonly dVincula = {
    findFirst: async (args: { where: { idEntidade?: bigint } }): Promise<unknown> => {
      await tick();
      return (
        this.vinculos.find(
          (v) =>
            !v.excluido &&
            (args.where.idEntidade === undefined || v.idEntidade === args.where.idEntidade),
        ) ?? null
      );
    },
    findMany: async (args: { where: { idEntidade?: bigint } }): Promise<unknown[]> => {
      await tick();
      return this.vinculos.filter(
        (v) =>
          !v.excluido &&
          (args.where.idEntidade === undefined || v.idEntidade === args.where.idEntidade),
      );
    },
  };

  readonly dEvento = {
    create: async (args: { data: Record<string, unknown> }): Promise<unknown> => {
      await tick();
      this.eventos.push(args.data);
      return args.data;
    },
  };

  /** Semeia um usuário com org (ADMIN) e devolve as chaves. */
  seedUser(): { userGroupId: bigint; entidadeId: bigint; orgId: bigint } {
    const userGroupId = BigInt(1);
    const entidadeId = BigInt(10);
    const orgId = BigInt(100);

    this.userGroups.push({
      chave: userGroupId,
      usuario: 'ceo@empresa.com',
      senha: 'hash',
      nome: 'CEO',
      ativo: true,
      excluido: false,
      dados: {},
    });
    this.entidades.push({
      chave: entidadeId,
      nome: 'CEO',
      idClasse: BigInt(-150),
      excluido: false,
      dUserGroupId: userGroupId,
    });
    this.vinculos.push({
      chave: BigInt(1000),
      idClasse: BigInt(-161),
      idEntidade: entidadeId,
      idLocEscritu: orgId,
      excluido: false,
      locEscritu: { chave: orgId, nome: 'Org do CEO' },
    });

    return { userGroupId, entidadeId, orgId };
  }

  /** Hash do refresh token atualmente gravado no slot (undefined = revogado). */
  currentHash(userGroupId: bigint): string | undefined {
    const ug = this.userGroups.find((u) => u.chave === userGroupId);
    return ug?.dados.refreshTokenHash as string | undefined;
  }

  /** Eventos de segurança emitidos (descricao começa com `auth.`). */
  eventosPorDescricao(descricao: string): Array<Record<string, unknown>> {
    return this.eventos.filter((e) => e.descricao === descricao);
  }
}
