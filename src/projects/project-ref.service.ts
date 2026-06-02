import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { LRUCache } from '../common/helpers/lru-cache';

/**
 * idClasse da DEntidade-espelho de projeto (PROJECT_REF).
 *
 * Seed: `prisma/seeds/classes.seed.ts` (`esp(-158, 'PROJECT_REF', ...)`),
 * idPai=-37 ENTIDADES. Ratificado em ADR-V2-058.
 */
export const ID_CLASSE_PROJECT_REF = BigInt(-158);

/** Cliente Prisma que pode ser a raiz (`PrismaService`) ou um `tx`. */
type PrismaLike = PrismaService | Prisma.TransactionClient;

/**
 * Helper central do handle canônico de projeto em DVincula (ADR-V2-058).
 *
 * ## Problema que resolve
 * `DVincula.idLocEscritu`/`idEntidade` são FKs para `DEntidade.chave`, mas o
 * V2 gravava `DProject.chave` nesses campos (RBAC -171/-172/-173, team -182,
 * folder -183, space-privado -188). Como `DProject` e `DEntidade` têm
 * sequências de `chave` independentes, a FK ora **quebrava** (500 em
 * `POST /projects`), ora **passava por coincidência** apontando para uma
 * DEntidade aleatória (bug silencioso de RBAC/segurança).
 *
 * ## Solução (Opção C — ADR-V2-058)
 * Cada `DProject` ganha **uma DEntidade-espelho** (`idClasse=-158
 * PROJECT_REF`), 1:1, que é o **handle canônico do projeto** dentro do grafo
 * DVincula. Todos os vínculos project-scoped passam a apontar para a chave da
 * espelho (`E`), nunca para `DProject.chave` (`P`). A FK passa a ser sempre
 * satisfeita por uma DEntidade real — colisão estruturalmente impossível.
 *
 * ```
 * DProject (chave=P)
 *    └── dados.entidadeRefId = E      (ponteiro forward  P→E)
 * DEntidade (chave=E, idClasse=-158)
 *    ├── idEstab          = project.idEstab
 *    ├── nome             = project.nome
 *    └── dados.projectId  = P         (ponteiro reverso E→P)
 * ```
 *
 * ## Pilar 1 (Engine) — NÃO se aplica
 * `DEntidade` é tabela **estrutural** → o espelho é criado via **Prisma direto**
 * dentro do `$transaction` do chamador (nunca via `OperacaoPedido`/Engine).
 *
 * ## Performance
 * - `resolveEntidadeRef` / `resolveProjectId` usam **cache LRU 5min** (espelha
 *   `RoleResolverService`) — N+1 ZERO em hot paths de RBAC.
 * - Resolução forward (P→E) cacheada por `projectId`; reversa (E→P) por `refId`.
 *
 * ## Registro
 * Provider em `CommonModule` (`@Global`) — injetável em qualquer módulo
 * (auth, teams, folders, executions, webhooks) sem import explícito nem
 * `forwardRef`. Depende apenas de `PrismaService` (também global), portanto
 * **zero risco de dependência circular** (decisão documentada no ADR-V2-058 e
 * no relato da Fase 2). O arquivo vive em `src/projects/` por coesão de domínio.
 *
 * @see ADR-V2-058 — DEntidade-espelho (-158 PROJECT_REF)
 * @see RoleResolverService — padrão de cache LRU espelhado aqui
 */
@Injectable()
export class ProjectRefService {
  private readonly logger = new Logger(ProjectRefService.name);

  /** Cache forward P→E: key = `${projectId}`, value = entidadeRefId (E). */
  private readonly forwardCache = new LRUCache<string, bigint>(1000, 300_000);

  /** Cache reverso E→P: key = `${entidadeRefId}`, value = projectId (P). */
  private readonly reverseCache = new LRUCache<string, bigint>(1000, 300_000);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garante (idempotente) a DEntidade-espelho `-158` do projeto e retorna a
   * chave dela (`E`).
   *
   * Comportamento idempotente:
   *  1. Se `project.dados.entidadeRefId` já aponta para uma DEntidade -158
   *     **viva**, retorna essa chave sem criar nada.
   *  2. Caso contrário, cria a DEntidade-espelho (`nome=project.nome`,
   *     `idEstab=project.idEstab`, `dados.projectId=project.chave`) e grava
   *     `entidadeRefId` de volta em `DProject.dados` — tudo no mesmo `tx`.
   *
   * **DEVE ser chamado dentro de um `$transaction`** (recebe o `tx`): a criação
   * do espelho e a atualização do ponteiro forward precisam ser atômicas com a
   * operação que cria/usa o projeto (ex.: `ProjectsService.create`).
   *
   * @param tx - Cliente de transação Prisma (ou `PrismaService` raiz).
   * @param project - Projeto-alvo (precisa de `chave`, `nome`, `idEstab`, `dados`).
   * @returns Chave BigInt (`E`) da DEntidade-espelho.
   *
   * @example
   * ```typescript
   * await this.prisma.$transaction(async (tx) => {
   *   const proj = await tx.dProject.create({ ... });
   *   const refId = await this.projectRef.ensureEntidadeRef(tx, proj);
   *   await this.projectMembers.createManagerLink(tx, refId, userId); // E, não P
   * });
   * ```
   */
  async ensureEntidadeRef(
    tx: PrismaLike,
    project: {
      chave: bigint;
      nome: string;
      idEstab?: bigint | null;
      dados?: unknown;
    },
  ): Promise<bigint> {
    const dados = (project.dados as Record<string, unknown> | null) ?? {};
    const existingRefRaw = dados.entidadeRefId;

    // Caminho idempotente: ponteiro forward já existe e a espelho está viva.
    if (typeof existingRefRaw === 'string' && /^-?\d+$/.test(existingRefRaw)) {
      const existingRef = BigInt(existingRefRaw);
      const alive = await tx.dEntidade.findFirst({
        where: { chave: existingRef, idClasse: ID_CLASSE_PROJECT_REF, excluido: false },
        select: { chave: true },
      });
      if (alive) {
        this.cacheBoth(project.chave, existingRef);
        return existingRef;
      }
      // Ponteiro órfão (espelho ausente/excluída) → recria abaixo.
      this.logger.warn(
        `entidade_ref_orfa projectId=${project.chave.toString()} refId=${existingRefRaw} — recriando espelho`,
      );
    }

    // Cria a DEntidade-espelho (Prisma direto — cadastro estrutural, Pilar 1).
    const ref = await tx.dEntidade.create({
      data: {
        idClasse: ID_CLASSE_PROJECT_REF,
        nome: project.nome,
        ...(project.idEstab !== null && project.idEstab !== undefined
          ? { idEstab: project.idEstab }
          : {}),
        dados: { projectId: project.chave.toString() } as Prisma.InputJsonValue,
      },
      select: { chave: true },
    });

    // Grava o ponteiro forward em DProject.dados (merge — preserva slug etc.).
    await tx.dProject.update({
      where: { chave: project.chave },
      data: {
        dados: { ...dados, entidadeRefId: ref.chave.toString() } as Prisma.InputJsonValue,
      },
    });

    this.cacheBoth(project.chave, ref.chave);
    this.logger.debug(
      `entidade_ref_criada projectId=${project.chave.toString()} refId=${ref.chave.toString()}`,
    );
    return ref.chave;
  }

  /**
   * Variante de {@link ensureEntidadeRef} para **write sites que só têm o
   * `projectId`** e não estão dentro de um `$transaction` (ex.:
   * `addMember`, `moveProject`).
   *
   * Carrega o projeto e garante o espelho numa transação curta — retornando
   * sempre uma chave de **DEntidade real** (`E`). Diferente de
   * {@link resolveEntidadeRef} (read-only, passthrough `P` para legados), este
   * método **cria o espelho sob demanda** para projetos legados, porque
   * gravar um novo vínculo com `idLocEscritu/idEntidade = P` (que não é
   * DEntidade) reintroduziria a violação de FK (o 500). É o resolver correto
   * para **escrita** de vínculos project-scoped.
   *
   * @param projectId - Chave BigInt do `DProject` (`P`).
   * @returns Chave BigInt (`E`) da DEntidade-espelho (garantidamente real).
   *
   * @throws {Error} Se o projeto não existir.
   */
  async ensureEntidadeRefById(projectId: bigint): Promise<bigint> {
    const cached = this.forwardCache.get(projectId.toString());
    if (cached !== undefined) {
      return cached;
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId },
      select: { chave: true, nome: true, idEstab: true, dados: true },
    });
    if (!project) {
      throw new Error(`ensureEntidadeRefById: DProject ${projectId.toString()} não encontrado`);
    }

    return this.prisma.$transaction((tx) => this.ensureEntidadeRef(tx, project));
  }

  /**
   * Resolve o handle de um projeto em DVincula a partir do `projectId` (`P`).
   *
   * Usado em **todos os read/write sites** project-scoped que antes usavam
   * `idLocEscritu = projectId` — agora `idLocEscritu = resolveEntidadeRef(projectId)`.
   *
   * **Semântica legacy-safe (não-regressão — decisão da Fase 2):**
   *  - Se o projeto **já tem espelho** (`dados.entidadeRefId`), retorna `E`
   *    (handle canônico — projetos criados na Fase 2+ usam `E` ponta a ponta).
   *  - Se o projeto **não tem espelho** (legado, pré-backfill da Fase 3),
   *    retorna o próprio `projectId` (`P`) — **passthrough**. Os vínculos
   *    antigos foram gravados com `P`; resolver para `P` mantém o RBAC/listagens
   *    legados funcionando **sem tocar nos dados antigos**. A Fase 3 (backfill)
   *    criará os espelhos e reescreverá as linhas DVincula de `P→E`; só então
   *    este método passa a devolver `E` para os antigos.
   *
   * **Importante:** este método NÃO cria espelho sob demanda. Criar o espelho
   * sem reescrever as linhas DVincula legadas (que ainda apontam para `P`)
   * tornaria os projetos antigos inacessíveis — exatamente a regressão a evitar.
   * A criação do espelho acontece só no caminho de escrita
   * ({@link ensureEntidadeRef}, dentro de `ProjectsService.create`) e no backfill.
   *
   * Resolução com cache LRU 5min.
   *
   * @param projectId - Chave BigInt do `DProject` (`P`).
   * @returns Chave BigInt do handle: `E` se há espelho, senão `P` (legado).
   *
   * @throws {Error} Se o projeto não existir (chave inválida).
   */
  async resolveEntidadeRef(projectId: bigint): Promise<bigint> {
    const cacheKey = projectId.toString();
    const cached = this.forwardCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId },
      select: { dados: true },
    });
    if (!project) {
      throw new Error(`resolveEntidadeRef: DProject ${projectId.toString()} não encontrado`);
    }

    const refRaw = (project.dados as Record<string, unknown> | null)?.entidadeRefId;
    if (typeof refRaw === 'string' && /^-?\d+$/.test(refRaw)) {
      const refId = BigInt(refRaw);
      this.cacheBoth(projectId, refId);
      return refId;
    }

    // Legado sem espelho → passthrough (P). NÃO cacheamos (o backfill da Fase 3
    // pode criar o espelho depois; um cache de 5min de P atrasaria a virada).
    return projectId;
  }

  /**
   * Resolve o `projectId` (`P`) a partir do handle canônico (`E`).
   *
   * Reverso de {@link resolveEntidadeRef}. Usado onde uma query retorna o
   * handle do projeto (ex.: `DVincula.idEntidade` de um team-link -182, ou
   * `idLocEscritu` de um role -171) e o chamador precisa do `DProject.chave`
   * original — lê `DEntidade.dados.projectId` da espelho.
   *
   * **Semântica legacy-safe:** se `entidadeRefId` é uma espelho -158 válida,
   * retorna `DEntidade.dados.projectId` (`P`). Caso contrário, assume que o
   * valor já É o `projectId` legado (vínculo antigo gravado com `P`) e o
   * retorna como está — coerente com {@link resolveEntidadeRef}, que faz
   * passthrough de `P` para projetos sem espelho.
   *
   * @param handle - Chave BigInt do handle (espelho `E` -158, ou `P` legado).
   * @returns Chave BigInt do `projectId` (`P`).
   */
  async resolveProjectId(handle: bigint): Promise<bigint> {
    const cacheKey = handle.toString();
    const cached = this.reverseCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const ref = await this.prisma.dEntidade.findFirst({
      where: { chave: handle, idClasse: ID_CLASSE_PROJECT_REF, excluido: false },
      select: { dados: true },
    });
    const projectIdRaw = (ref?.dados as Record<string, unknown> | null)?.projectId;
    if (typeof projectIdRaw !== 'string' || !/^-?\d+$/.test(projectIdRaw)) {
      // Não é espelho → handle legado que já é o próprio projectId (P).
      return handle;
    }

    const projectId = BigInt(projectIdRaw);
    this.cacheBoth(projectId, handle);
    return projectId;
  }

  /**
   * Versão de batch de {@link resolveProjectId} (E/P → P), N+1 ZERO.
   *
   * Resolve uma lista de handles (espelhos -158 e/ou `P` legados) para os
   * `projectId`s correspondentes, deduplicando e retornando strings. Faz no
   * máximo 1 query para os handles não-cacheados; handles que não são espelho
   * são tratados como `P` legado (passthrough).
   *
   * @param handles - Handles BigInt (podem repetir; `null` é ignorado).
   * @returns Array de `projectId` como string, sem duplicatas.
   */
  async refsToProjectIds(handles: ReadonlyArray<bigint | null>): Promise<string[]> {
    const result = new Set<string>();
    const toQuery: bigint[] = [];

    for (const h of handles) {
      if (h === null) continue;
      const cached = this.reverseCache.get(h.toString());
      if (cached !== undefined) {
        result.add(cached.toString());
      } else {
        toQuery.push(h);
      }
    }

    if (toQuery.length > 0) {
      const refs = await this.prisma.dEntidade.findMany({
        where: { chave: { in: [...toQuery] }, idClasse: ID_CLASSE_PROJECT_REF, excluido: false },
        select: { chave: true, dados: true },
      });
      const refById = new Map(refs.map((r) => [r.chave.toString(), r]));

      for (const h of toQuery) {
        const ref = refById.get(h.toString());
        const projectIdRaw = (ref?.dados as Record<string, unknown> | null)?.projectId;
        if (typeof projectIdRaw === 'string' && /^-?\d+$/.test(projectIdRaw)) {
          const projectId = BigInt(projectIdRaw);
          this.cacheBoth(projectId, h);
          result.add(projectId.toString());
        } else {
          // Handle legado (P) — passthrough.
          result.add(h.toString());
        }
      }
    }

    return Array.from(result);
  }

  /**
   * Resolve handles para um lote de `projectId`s (`P`) — N+1 ZERO.
   *
   * Legacy-safe (idêntico a {@link resolveEntidadeRef} em lote): devolve `E`
   * para projetos com espelho, ou o próprio `P` (passthrough) para legados sem
   * espelho. Faz no máximo 1 query para os `projectId`s não-cacheados.
   *
   * @param projectIds - Chaves BigInt dos projetos.
   * @returns Map `projectId.toString() → handle (E ou P)`.
   */
  async resolveEntidadeRefs(
    projectIds: ReadonlyArray<bigint>,
  ): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    const missing: bigint[] = [];

    for (const pid of projectIds) {
      const cached = this.forwardCache.get(pid.toString());
      if (cached !== undefined) {
        out.set(pid.toString(), cached);
      } else {
        missing.push(pid);
      }
    }

    if (missing.length === 0) {
      return out;
    }

    // 1 query: projetos faltantes + seus ponteiros forward já existentes.
    const projects = await this.prisma.dProject.findMany({
      where: { chave: { in: [...missing] } },
      select: { chave: true, dados: true },
    });
    const byId = new Map(projects.map((p) => [p.chave.toString(), p]));

    for (const pid of missing) {
      const proj = byId.get(pid.toString());
      if (!proj) {
        continue; // projeto inexistente — chamador ignora ausência no map.
      }
      const refRaw = (proj.dados as Record<string, unknown> | null)?.entidadeRefId;
      if (typeof refRaw === 'string' && /^-?\d+$/.test(refRaw)) {
        const refId = BigInt(refRaw);
        this.cacheBoth(pid, refId);
        out.set(pid.toString(), refId);
      } else {
        // Legado sem espelho → passthrough P (não cacheia; ver resolveEntidadeRef).
        out.set(pid.toString(), pid);
      }
    }

    return out;
  }

  /** Popula ambos os caches (forward e reverso) de forma consistente. */
  private cacheBoth(projectId: bigint, entidadeRefId: bigint): void {
    this.forwardCache.set(projectId.toString(), entidadeRefId);
    this.reverseCache.set(entidadeRefId.toString(), projectId);
  }
}
