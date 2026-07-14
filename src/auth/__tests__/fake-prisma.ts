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

/** Linha de `DTabela` — na F3, uma por SESSÃO (idClasse = -485). */
export interface FakeTabela {
  chave: bigint;
  idClasse: bigint;
  /** sha256 do refresh token corrente. */
  codigo: string | null;
  /** familyId. */
  nome: string;
  descricao: string | null;
  dEntidadeId: bigint | null;
  excluido: boolean;
  metaDados: Record<string, unknown>;
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

  // ─── F3 (ADR-V2-077) — sessões em DTabela (idClasse = -485) ───────────────

  /** Linhas de `DTabela` (só sessões são usadas nestes testes). */
  readonly tabelas: FakeTabela[] = [];

  private proximaChaveTabela = BigInt(1000);

  readonly dTabela = {
    create: async (args: { data: Record<string, unknown> }): Promise<FakeTabela> => {
      await tick();
      const linha: FakeTabela = {
        chave: this.proximaChaveTabela++,
        idClasse: args.data.idClasse as bigint,
        codigo: (args.data.codigo as string) ?? null,
        nome: (args.data.nome as string) ?? '',
        descricao: (args.data.descricao as string) ?? null,
        dEntidadeId: (args.data.dEntidadeId as bigint) ?? null,
        excluido: false,
        metaDados: { ...((args.data.metaDados as Record<string, unknown>) ?? {}) },
      };
      this.tabelas.push(linha);
      return { ...linha };
    },

    findFirst: async (args: {
      where: { chave?: bigint; idClasse?: bigint; excluido?: boolean };
    }): Promise<FakeTabela | null> => {
      await tick();
      const achada = this.tabelas.find(
        (t) =>
          (args.where.chave === undefined || t.chave === args.where.chave) &&
          (args.where.idClasse === undefined || t.idClasse === args.where.idClasse) &&
          (args.where.excluido === undefined || t.excluido === args.where.excluido),
      );
      return achada ? { ...achada, metaDados: { ...achada.metaDados } } : null;
    },

    findMany: async (args: {
      where: { idClasse?: bigint; dEntidadeId?: bigint; excluido?: boolean };
    }): Promise<FakeTabela[]> => {
      await tick();
      return this.tabelas
        .filter(
          (t) =>
            (args.where.idClasse === undefined || t.idClasse === args.where.idClasse) &&
            (args.where.dEntidadeId === undefined || t.dEntidadeId === args.where.dEntidadeId) &&
            (args.where.excluido === undefined || t.excluido === args.where.excluido),
        )
        .map((t) => ({ ...t, metaDados: { ...t.metaDados } }));
    },

    /** Compare-and-swap da rotação (`where: { chave, codigo, excluido }`). */
    updateMany: async (args: {
      where: {
        chave?: bigint;
        nome?: string;
        idClasse?: bigint;
        codigo?: string;
        excluido?: boolean;
      };
      data: { codigo?: string; excluido?: boolean; metaDados?: Record<string, unknown> };
    }): Promise<{ count: number }> => {
      await tick();
      const alvos = this.tabelas.filter(
        (t) =>
          (args.where.chave === undefined || t.chave === args.where.chave) &&
          (args.where.nome === undefined || t.nome === args.where.nome) &&
          (args.where.idClasse === undefined || t.idClasse === args.where.idClasse) &&
          (args.where.codigo === undefined || t.codigo === args.where.codigo) &&
          (args.where.excluido === undefined || t.excluido === args.where.excluido),
      );

      for (const alvo of alvos) {
        if (args.data.codigo !== undefined) alvo.codigo = args.data.codigo;
        if (args.data.excluido !== undefined) alvo.excluido = args.data.excluido;
        if (args.data.metaDados !== undefined) alvo.metaDados = { ...args.data.metaDados };
      }

      return { count: alvos.length };
    },

    update: async (args: {
      where: { chave: bigint };
      data: { codigo?: string; excluido?: boolean; metaDados?: Record<string, unknown> };
    }): Promise<FakeTabela> => {
      await tick();
      const alvo = this.tabelas.find((t) => t.chave === args.where.chave);
      if (!alvo) throw new Error('FakePrisma: DTabela não encontrada');
      if (args.data.codigo !== undefined) alvo.codigo = args.data.codigo;
      if (args.data.excluido !== undefined) alvo.excluido = args.data.excluido;
      if (args.data.metaDados !== undefined) alvo.metaDados = { ...args.data.metaDados };
      return { ...alvo };
    },
  };

  /**
   * `$queryRaw` — os dois lookups indexados que substituíram o full scan (3.7).
   *
   * O `Prisma.sql` recebido carrega `strings` (fragmentos) e `values`
   * (parâmetros). Distinguimos as queries pelo texto e reproduzimos o predicado
   * em memória — inclusive o `ORDER BY excluido ASC` (sessão ATIVA vence a
   * revogada), que é o que decide entre `replay` e `reuse_escalation`.
   */
  $queryRaw = async (query: {
    strings?: readonly string[];
    values?: readonly unknown[];
  }): Promise<unknown[]> => {
    await tick();
    const texto = (query.strings ?? []).join(' ');
    const values = query.values ?? [];

    if (texto.includes('"DTabela"')) {
      // SELECT … FROM DTabela WHERE idClasse = $1 AND (codigo = $2 OR prevHash = $3)
      const hash = String(values[1]);
      const candidatas = this.tabelas
        .filter(
          (t) =>
            t.idClasse === BigInt(-485) && (t.codigo === hash || t.metaDados.prevHash === hash),
        )
        .sort((a, b) => Number(a.excluido) - Number(b.excluido));

      const achada = candidatas[0];
      return achada ? [{ ...achada, metaDados: { ...achada.metaDados } }] : [];
    }

    // SELECT … FROM DUserGroup WHERE dados->>'refreshTokenHash' = $1 OR prevHash = $1
    const hash = String(values[0]);
    const dono = this.userGroups.find(
      (u) =>
        !u.excluido && u.ativo && (u.dados.refreshTokenHash === hash || u.dados.prevHash === hash),
    );
    return dono ? [{ chave: dono.chave, dados: { ...dono.dados } }] : [];
  };

  /** Purga de sessões expiradas — não exercitada pelos specs (retorna 0). */
  $executeRaw = async (): Promise<number> => {
    await tick();
    return 0;
  };

  /** `$transaction([...])` — array de promises (revoke-all em lote). */
  $transaction = async (ops: Array<Promise<unknown>>): Promise<unknown[]> => {
    return Promise.all(ops);
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
