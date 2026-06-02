/**
 * Backfill idempotente do handle canônico de projeto em DTabela.dEntidadeId
 * (ADR-V2-058 / ADR-V2-059 Fase 5 — DEntidade-espelho PROJECT_REF -158).
 *
 * ## Contexto
 * `DTabela.dEntidadeId` é FK para `DEntidade.chave`, mas o V2 (pré-correção dos
 * passos 1-2/4) gravava `DProject.chave` (`P`) nesse campo para as tabelas
 * project-scoped (statuses V3, sprint, priorities, task type, webhooks). Como
 * `DProject` e `DEntidade` têm sequências de `chave` independentes, a FK ora
 * **quebrava** (500), ora **passava por coincidência** apontando para uma
 * DEntidade aleatória (bug silencioso de escopo/segurança).
 *
 * Os passos 1-2 (statuses/sprint/priorities, commit 0c68dbb) e 4 (webhooks,
 * commit 5e20394) corrigiram o caminho de ESCRITA/LEITURA no código (novos
 * registros já gravam `E` = espelho -158). Este script (passo 5) cria os
 * espelhos dos projetos LEGADOS e **reescreve as linhas DTabela antigas** de
 * `P → E`.
 *
 * ## O que o script faz (duas fases por execução)
 *
 * ### Fase A — Criar espelhos (-158) faltantes
 * Idêntica ao backfill de DVincula (`backfill-project-ref-entidades.ts`):
 * para cada `DProject` SEM `dados.entidadeRefId` (ou com ponteiro órfão), cria a
 * DEntidade-espelho (`idClasse=-158`) e grava `entidadeRefId` de volta no
 * projeto. **Transação por projeto.** Replica `ProjectRefService.ensureEntidadeRef`
 * em PrismaClient puro (script roda fora do contexto NestJS).
 *
 * > Este script é AUTO-SUFICIENTE: replica a Fase A para poder rodar sozinho.
 * > Rodá-lo depois (ou antes) do backfill de DVincula é seguro — ambos garantem
 * > o mesmo espelho de forma idempotente (rodar 2x não duplica). A ORDEM
 * > recomendada no runbook é DVincula primeiro, mas não é obrigatória.
 *
 * ### Fase B — Reparar DTabela órfãs (P → E)
 * Para cada `DTabela` das classes project-scoped cujo `dEntidadeId` aponta para
 * um valor que existe em `DProject` (`P`):
 *   - resolve `E` = espelho do projeto (criado na Fase A);
 *   - troca `P → E` em `dEntidadeId`.
 *
 * **Detecção de colisão histórica (CRÍTICO — NÃO repara automaticamente):**
 * se o valor (`P`) existir TANTO em `DProject` QUANTO em uma `DEntidade`
 * NÃO-espelho (idClasse != -158), o registro é AMBÍGUO — pode estar apontando
 * para a DEntidade errada por causa da colisão histórica de IDs. Esses casos
 * NÃO são reparados; vão para um **relatório de suspeitos** (decisão do CEO).
 * Como filtramos SOMENTE classes project-scoped, o valor DEVERIA ser sempre `P`;
 * um caso `entidade`/`ambiguo` aqui é anômalo e merece inspeção (relatório).
 *
 * ## Idempotência (rodar 2x não duplica nem re-repara)
 *   - Fase A: pula projeto que já tem `entidadeRefId` apontando para espelho viva.
 *   - Fase B: só repara linha cujo `dEntidadeId` ainda é `P` (existe em DProject)
 *     e NÃO é ambíguo. Linha já apontando para `E` (DEntidade -158) é ignorada.
 *
 * ## Dry-run por padrão
 * SEM `--apply`, o script só RELATA o que faria (e lista os suspeitos) — ZERO
 * escrita. O CEO roda dry-run primeiro em produção, revisa os suspeitos, e só
 * então roda com `--apply`.
 *
 * ## Uso
 * ```bash
 * # DRY-RUN (padrão — não escreve nada):
 * npx ts-node prisma/scripts/backfill-project-ref-dtabelas.ts
 *
 * # APLICAR (escreve espelhos + reescreve DTabelas não-ambíguas):
 * npx ts-node prisma/scripts/backfill-project-ref-dtabelas.ts --apply
 * ```
 *
 * @see ADR-V2-058 — DEntidade-espelho (-158 PROJECT_REF)
 * @see ADR-V2-059 — handle de projeto (E) em DTabela.dEntidadeId
 * @see prisma/scripts/backfill-project-ref-entidades.ts — análogo p/ DVincula
 * @see src/projects/project-ref.service.ts — helper canônico (mesma regra)
 * @see docs/runbook-backfill-project-ref-dtabelas.md — runbook de cutover
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/** idClasse da DEntidade-espelho de projeto (PROJECT_REF). Igual ao helper. */
const ID_CLASSE_PROJECT_REF = BigInt(-158);

/** idClasse AUDIT_GENERIC (-489) — DEvento de rastreabilidade do backfill. */
const ID_CLASSE_AUDIT_GENERIC = BigInt(-489);

/**
 * idClasses de DTabela cujo `dEntidadeId` é escopo de PROJETO — as únicas que o
 * seed/services gravam com `P` e que este backfill repara (P → E).
 *
 *   - Statuses V3:  -440 (agrupador, se houver linha) + -441..-449
 *   - Sprint:       -400
 *   - Priorities:   -420 (agrupador, se houver linha) + -421..-424
 *   - Task type:    -430
 *   - Webhooks:     -470
 *
 * ⚠ NUNCA adicione aqui classes cujo `dEntidadeId` é uma DEntidade REAL e
 * legítima — elas seriam corrompidas pelo reparo. Fora de escopo (deixar como
 * está, o filtro por idClasse já as exclui):
 *   - API Keys     -471  → dEntidadeId = userId (DEntidade real)
 *   - MCP Keys     -472  → dEntidadeId = userId (DEntidade real)
 *   - ISSUE_COUNTER -475 → dEntidadeId = teamId (DEntidade -180 real)
 *   - Catálogos globais  → dEntidadeId = NULL (não entram no findMany de qualquer forma)
 */
const PROJECT_SCOPED_TABELA_CLASSES: bigint[] = [
  // Statuses V3
  BigInt(-440),
  BigInt(-441),
  BigInt(-442),
  BigInt(-443),
  BigInt(-444),
  BigInt(-445),
  BigInt(-446),
  BigInt(-447),
  BigInt(-448),
  BigInt(-449),
  // Sprint
  BigInt(-400),
  // Priorities
  BigInt(-420),
  BigInt(-421),
  BigInt(-422),
  BigInt(-423),
  BigInt(-424),
  // Task type
  BigInt(-430),
  // Webhooks
  BigInt(-470),
];

function isApply(): boolean {
  return process.argv.includes('--apply');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function log(...args: any[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

/** Linha de suspeito de colisão histórica (não reparado — decisão do CEO). */
interface Suspect {
  tabelaChave: string;
  idClasse: string;
  /** Sempre `dEntidadeId` (DTabela tem um único campo de handle de projeto). */
  campo: 'dEntidadeId';
  valorAmbiguo: string;
  /** Projeto que o valor PODERIA representar (existe em DProject). */
  comoProjeto: { chave: string; nome: string } | null;
  /** DEntidade não-espelho que o valor TAMBÉM representa (colisão). */
  comoEntidade: { chave: string; idClasse: string; nome: string } | null;
}

interface Report {
  // Fase A
  projectsVisited: number;
  espelhosCriados: number;
  espelhosJaExistentes: number;
  // Fase B
  tabelasVisitadas: number;
  tabelasReparadas: number;
  tabelasJaCanonicas: number;
  tabelasReparadasPorClasse: Record<string, number>;
  suspeitos: Suspect[];
  erros: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase A — criar espelhos faltantes (mesma regra de ProjectRefService)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Garante (idempotente) a DEntidade-espelho -158 de um projeto e retorna `E`.
 * Replica `ProjectRefService.ensureEntidadeRef` em PrismaClient puro.
 *
 * @returns `{ refId, created }` — chave da espelho e se foi criada agora.
 */
async function ensureEspelho(
  project: { chave: bigint; nome: string; idEstab: bigint | null; dados: Prisma.JsonValue },
  apply: boolean,
): Promise<{ refId: bigint | null; created: boolean }> {
  const dados = (project.dados as Record<string, unknown> | null) ?? {};
  const existingRefRaw = dados.entidadeRefId;

  // Idempotente: ponteiro forward já existe e a espelho está viva.
  if (typeof existingRefRaw === 'string' && /^-?\d+$/.test(existingRefRaw)) {
    const existingRef = BigInt(existingRefRaw);
    const alive = await prisma.dEntidade.findFirst({
      where: { chave: existingRef, idClasse: ID_CLASSE_PROJECT_REF, excluido: false },
      select: { chave: true },
    });
    if (alive) {
      return { refId: existingRef, created: false };
    }
    // ponteiro órfão → recria abaixo
  }

  if (!apply) {
    // Dry-run: não cria, mas sinaliza que criaria.
    return { refId: null, created: true };
  }

  // Cria espelho + grava ponteiro forward — transação por projeto.
  const refId = await prisma.$transaction(async (tx) => {
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

    await tx.dProject.update({
      where: { chave: project.chave },
      data: {
        dados: { ...dados, entidadeRefId: ref.chave.toString() } as Prisma.InputJsonValue,
      },
    });

    // DEvento AUDIT (-489) — rastreabilidade (não bloqueante).
    await tx.dEvento.create({
      data: {
        idClasse: ID_CLASSE_AUDIT_GENERIC,
        idEntidade: ref.chave,
        descricao: 'project.ref.backfilled',
        metaDados: {
          projectId: project.chave.toString(),
          entidadeRefId: ref.chave.toString(),
          source: 'backfill-project-ref-dtabelas',
        } as Prisma.InputJsonValue,
      },
    });

    return ref.chave;
  });

  return { refId, created: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de classificação de um valor (P / E / ambíguo / desconhecido)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifica um valor encontrado em `DTabela.dEntidadeId`:
 *  - `canonico`  : já é uma DEntidade-espelho (-158) → nada a fazer.
 *  - `projeto`   : existe em DProject E NÃO existe como DEntidade não-espelho →
 *                  reparável (P → E).
 *  - `ambiguo`   : existe em DProject E TAMBÉM como DEntidade não-espelho →
 *                  SUSPEITO (não repara; relatório).
 *  - `entidade`  : existe só como DEntidade não-espelho. Em classes
 *                  project-scoped isto é ANÔMALO → relatório (não repara).
 *  - `desconhecido`: não existe em lugar nenhum → órfão real (relata como erro).
 */
async function classifyValue(valor: bigint): Promise<{
  kind: 'canonico' | 'projeto' | 'ambiguo' | 'entidade' | 'desconhecido';
  projeto: { chave: bigint; nome: string } | null;
  entidadeNaoEspelho: { chave: bigint; idClasse: bigint; nome: string } | null;
}> {
  const [entidade, projeto] = await Promise.all([
    prisma.dEntidade.findFirst({
      where: { chave: valor, excluido: false },
      select: { chave: true, idClasse: true, nome: true },
    }),
    prisma.dProject.findFirst({
      where: { chave: valor, excluido: false },
      select: { chave: true, nome: true },
    }),
  ]);

  // Já é espelho canônico → nada a fazer.
  if (entidade && entidade.idClasse === ID_CLASSE_PROJECT_REF) {
    return { kind: 'canonico', projeto: null, entidadeNaoEspelho: null };
  }

  const entidadeNaoEspelho =
    entidade && entidade.idClasse !== ID_CLASSE_PROJECT_REF
      ? { chave: entidade.chave, idClasse: entidade.idClasse, nome: entidade.nome }
      : null;

  if (projeto && entidadeNaoEspelho) {
    // Colisão histórica: o valor existe nos DOIS lados.
    return {
      kind: 'ambiguo',
      projeto: { chave: projeto.chave, nome: projeto.nome },
      entidadeNaoEspelho,
    };
  }

  if (projeto) {
    return {
      kind: 'projeto',
      projeto: { chave: projeto.chave, nome: projeto.nome },
      entidadeNaoEspelho: null,
    };
  }

  if (entidadeNaoEspelho) {
    return { kind: 'entidade', projeto: null, entidadeNaoEspelho };
  }

  return { kind: 'desconhecido', projeto: null, entidadeNaoEspelho: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase B — reparar DTabelas órfãs (P → E)
// ─────────────────────────────────────────────────────────────────────────────

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

/**
 * Repara as DTabelas project-scoped cujo `dEntidadeId` aponta para `P`.
 * Atualiza o `report` in-place.
 */
async function repairTabelas(
  apply: boolean,
  espelhoPorProjeto: Map<string, bigint>,
  report: Report,
): Promise<void> {
  const tabelas = await prisma.dTabela.findMany({
    // Filtro por idClasse já EXCLUI -471/-472/-475 (DEntidade real) e catálogos
    // globais (dEntidadeId NULL). NUNCA amplie PROJECT_SCOPED_TABELA_CLASSES.
    where: { idClasse: { in: PROJECT_SCOPED_TABELA_CLASSES }, excluido: false },
    select: { chave: true, idClasse: true, dEntidadeId: true },
    orderBy: { chave: 'asc' },
  });

  for (const t of tabelas) {
    report.tabelasVisitadas++;
    const valor = t.dEntidadeId;
    if (valor === null || valor === undefined) continue; // catálogo global por linha — ignora

    let classificacao;
    try {
      classificacao = await classifyValue(valor);
    } catch (err) {
      report.erros++;
      log(`  ! erro classificando DTabela ${t.chave}: ${(err as Error).message}`);
      continue;
    }

    if (classificacao.kind === 'canonico') {
      // Já aponta para o espelho (-158) → nada a fazer.
      report.tabelasJaCanonicas++;
      continue;
    }

    if (classificacao.kind === 'entidade') {
      // ANÔMALO em classe project-scoped: aponta para DEntidade não-espelho.
      // Não repara — relata como suspeito para inspeção do CEO.
      report.suspeitos.push({
        tabelaChave: t.chave.toString(),
        idClasse: t.idClasse.toString(),
        campo: 'dEntidadeId',
        valorAmbiguo: valor.toString(),
        comoProjeto: null,
        comoEntidade: classificacao.entidadeNaoEspelho
          ? {
              chave: classificacao.entidadeNaoEspelho.chave.toString(),
              idClasse: classificacao.entidadeNaoEspelho.idClasse.toString(),
              nome: classificacao.entidadeNaoEspelho.nome,
            }
          : null,
      });
      log(
        `  ? DTabela ${t.chave} (idClasse=${t.idClasse}) dEntidadeId=${valor} aponta para ` +
          `DEntidade não-espelho em classe project-scoped — anômalo, relatado (não reparado).`,
      );
      continue;
    }

    if (classificacao.kind === 'desconhecido') {
      // Valor não existe em DProject nem DEntidade — órfão real (FK quebrada).
      report.erros++;
      log(
        `  ! DTabela ${t.chave} (idClasse=${t.idClasse}) dEntidadeId=${valor} não existe ` +
          `em DProject nem DEntidade — órfão real, requer inspeção manual.`,
      );
      continue;
    }

    if (classificacao.kind === 'ambiguo') {
      // SUSPEITO — colisão histórica. NÃO repara.
      report.suspeitos.push({
        tabelaChave: t.chave.toString(),
        idClasse: t.idClasse.toString(),
        campo: 'dEntidadeId',
        valorAmbiguo: valor.toString(),
        comoProjeto: classificacao.projeto
          ? { chave: classificacao.projeto.chave.toString(), nome: classificacao.projeto.nome }
          : null,
        comoEntidade: classificacao.entidadeNaoEspelho
          ? {
              chave: classificacao.entidadeNaoEspelho.chave.toString(),
              idClasse: classificacao.entidadeNaoEspelho.idClasse.toString(),
              nome: classificacao.entidadeNaoEspelho.nome,
            }
          : null,
      });
      continue;
    }

    // kind === 'projeto' → reparável (P → E).
    const projectId = classificacao.projeto!.chave;
    const refId = espelhoPorProjeto.get(projectId.toString());
    if (refId === undefined) {
      // Espelho deveria existir (Fase A). Em dry-run, espelho ainda não foi
      // criado — contamos como "seria reparado".
      if (!apply) {
        report.tabelasReparadas++;
        bump(report.tabelasReparadasPorClasse, t.idClasse.toString());
        log(
          `  ~ [dry] DTabela ${t.chave} (idClasse=${t.idClasse}) dEntidadeId: ` +
            `P=${valor} → E=(espelho do projeto ${projectId})`,
        );
        continue;
      }
      report.erros++;
      log(
        `  ! DTabela ${t.chave}: espelho do projeto ${projectId} ausente após Fase A — pulado.`,
      );
      continue;
    }

    if (!apply) {
      report.tabelasReparadas++;
      bump(report.tabelasReparadasPorClasse, t.idClasse.toString());
      log(
        `  ~ [dry] DTabela ${t.chave} (idClasse=${t.idClasse}) dEntidadeId: P=${valor} → E=${refId}`,
      );
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.dTabela.update({
          where: { chave: t.chave },
          data: { dEntidadeId: refId },
        });

        // DEvento AUDIT (-489) — rastreabilidade do reparo.
        await tx.dEvento.create({
          data: {
            idClasse: ID_CLASSE_AUDIT_GENERIC,
            idEntidade: refId,
            descricao: 'dtabela.scope.backfilled',
            metaDados: {
              tabelaChave: t.chave.toString(),
              projectId: projectId.toString(),
              entidadeRefId: refId.toString(),
              idClasse: t.idClasse.toString(),
              source: 'backfill-project-ref-dtabelas',
            } as Prisma.InputJsonValue,
          },
        });
      });
      report.tabelasReparadas++;
      bump(report.tabelasReparadasPorClasse, t.idClasse.toString());
      log(
        `  ✓ DTabela ${t.chave} (idClasse=${t.idClasse}) dEntidadeId: P=${valor} → E=${refId}`,
      );
    } catch (err) {
      report.erros++;
      log(`  ! erro reparando DTabela ${t.chave}: ${(err as Error).message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apply = isApply();
  const report: Report = {
    projectsVisited: 0,
    espelhosCriados: 0,
    espelhosJaExistentes: 0,
    tabelasVisitadas: 0,
    tabelasReparadas: 0,
    tabelasJaCanonicas: 0,
    tabelasReparadasPorClasse: {},
    suspeitos: [],
    erros: 0,
  };

  log('');
  log('═══════════════════════════════════════════════════════════════════');
  log(`  backfill-project-ref-dtabelas — ${apply ? 'APPLY (escreve)' : 'DRY-RUN (não escreve)'}`);
  log('  ADR-V2-058/059 passo 5 — handle canônico de projeto em DTabela (-158)');
  log('═══════════════════════════════════════════════════════════════════');
  if (!apply) {
    log('  Modo padrão: NADA é escrito. Use --apply para efetivar.');
  }
  log('');

  // ── Fase A: criar espelhos faltantes ──────────────────────────────────────
  log('── Fase A: garantir espelhos PROJECT_REF (-158) ──');
  const projects = await prisma.dProject.findMany({
    where: { excluido: false },
    select: { chave: true, nome: true, idEstab: true, dados: true },
    orderBy: { chave: 'asc' },
  });

  /** Mapa projectId → espelho (E). Usado na Fase B. */
  const espelhoPorProjeto = new Map<string, bigint>();

  for (const project of projects) {
    report.projectsVisited++;
    try {
      const { refId, created } = await ensureEspelho(project, apply);
      if (refId !== null) {
        espelhoPorProjeto.set(project.chave.toString(), refId);
      }
      if (created && refId !== null) {
        report.espelhosCriados++;
        log(`  ✓ projeto ${project.chave} (${project.nome}): espelho ${refId} criado`);
      } else if (created && refId === null) {
        // dry-run: criaria
        report.espelhosCriados++;
        log(`  ~ [dry] projeto ${project.chave} (${project.nome}): criaria espelho`);
      } else {
        report.espelhosJaExistentes++;
      }
    } catch (err) {
      report.erros++;
      log(`  ! projeto ${project.chave}: erro — ${(err as Error).message}`);
    }
  }
  log(
    `  Fase A: ${report.espelhosCriados} espelho(s) ${apply ? 'criado(s)' : 'a criar'}, ` +
      `${report.espelhosJaExistentes} já existente(s).`,
  );
  log('');

  // ── Fase B: reparar DTabelas órfãs (P → E) ────────────────────────────────
  log('── Fase B: reparar DTabela órfãs (P → E) ──');
  log(`  classes project-scoped reparadas: ${PROJECT_SCOPED_TABELA_CLASSES.map((c) => c.toString()).join(', ')}`);
  log('  (API/MCP keys -471/-472, ISSUE_COUNTER -475 e catálogos globais NÃO entram)');
  await repairTabelas(apply, espelhoPorProjeto, report);
  log(
    `  Fase B: ${report.tabelasReparadas} DTabela(s) ${apply ? 'reparada(s)' : 'a reparar'}, ` +
      `${report.tabelasJaCanonicas} já canônica(s), ${report.suspeitos.length} suspeito(s).`,
  );
  log('');

  // ── Relatório de suspeitos (colisão histórica — decisão do CEO) ────────────
  if (report.suspeitos.length > 0) {
    log('═══════════════════════════════════════════════════════════════════');
    log(`  ⚠  RELATÓRIO DE SUSPEITOS (anomalia/colisão histórica — NÃO reparados)`);
    log('  Estes registros DTabela project-scoped têm um dEntidadeId que aponta');
    log('  para uma DEntidade não-espelho (e/ou também existe em DProject). Em');
    log('  classes project-scoped isto é anômalo: pode ser corrupção pré-existente.');
    log('  Requerem decisão do CEO.');
    log('═══════════════════════════════════════════════════════════════════');
    for (const s of report.suspeitos) {
      log('');
      log(`  DTabela chave=${s.tabelaChave} idClasse=${s.idClasse} campo=${s.campo}`);
      log(`    valor ambíguo: ${s.valorAmbiguo}`);
      log(
        `    como DProject:  ${s.comoProjeto ? `chave=${s.comoProjeto.chave} nome="${s.comoProjeto.nome}"` : '(n/a)'}`,
      );
      log(
        `    como DEntidade: ${s.comoEntidade ? `chave=${s.comoEntidade.chave} idClasse=${s.comoEntidade.idClasse} nome="${s.comoEntidade.nome}"` : '(n/a)'}`,
      );
    }
    log('');
    // JSON estruturado (copiável para anexar ao ticket de decisão do CEO).
    log('  JSON dos suspeitos (para o ticket de decisão):');
    log(JSON.stringify(report.suspeitos, null, 2));
    log('');
  } else {
    log('  ✓ Nenhum suspeito de colisão histórica detectado.');
    log('');
  }

  // ── Resumo final ──────────────────────────────────────────────────────────
  log('═══════════════════════════════════════════════════════════════════');
  log(`  RESUMO ${apply ? '(APPLY)' : '(DRY-RUN — nada foi escrito)'}`);
  log('═══════════════════════════════════════════════════════════════════');
  log(`  projetos visitados:        ${report.projectsVisited}`);
  log(`  espelhos ${apply ? 'criados' : 'a criar'}:          ${report.espelhosCriados}`);
  log(`  espelhos já existentes:    ${report.espelhosJaExistentes}`);
  log(`  DTabelas visitadas:        ${report.tabelasVisitadas}`);
  log(`  DTabelas ${apply ? 'reparadas' : 'a reparar'}:        ${report.tabelasReparadas}`);
  for (const [classe, count] of Object.entries(report.tabelasReparadasPorClasse)) {
    log(`     idClasse ${classe}: ${count}`);
  }
  log(`  DTabelas já canônicas:     ${report.tabelasJaCanonicas}`);
  log(`  SUSPEITOS (não reparados): ${report.suspeitos.length}`);
  log(`  erros/órfãos reais:        ${report.erros}`);
  log('═══════════════════════════════════════════════════════════════════');
  if (!apply && (report.espelhosCriados > 0 || report.tabelasReparadas > 0)) {
    log('  Para efetivar, rode novamente com --apply (após backup — ver runbook).');
  }
  log('');
}

main()
  .catch((err) => {
    console.error('[backfill-project-ref-dtabelas] falha:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
