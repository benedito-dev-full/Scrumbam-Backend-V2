import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Tipos canônicos de task suportados pelo PromptBuilder (ADR-V2-049).
 *
 * Mapeiam 1:1 para os arquivos em `src/executions/services/prompt-templates/<type>.md`.
 * `other` é o fallback final quando a detecção em cascata não identifica
 * nenhum dos tipos específicos.
 */
export type PromptTaskType = 'code' | 'docs' | 'research' | 'validation' | 'other';

const VALID_TASK_TYPES: ReadonlyArray<PromptTaskType> = [
  'code',
  'docs',
  'research',
  'validation',
  'other',
];

/**
 * Padrões regex aplicados sobre o `nome` da DTask quando o campo
 * `dados.taskType` / `dados.tipo` é ausente ou inválido. Ordem importa:
 * o primeiro match vence. Reflete heurística do frontend pré-V2 (porta
 * defensiva — backend é ponto de convergência para MCP/CLI futuros que
 * podem não passar pelo regex).
 */
const TASK_TYPE_HEURISTICS: ReadonlyArray<{ type: PromptTaskType; pattern: RegExp }> = [
  // Stems sem `\b` no fim para casar conjugações (investigar, documentar, etc.)
  { type: 'docs', pattern: /\b(doc|docs|documenta|readme|guia|tutorial|manual)/i },
  { type: 'research', pattern: /\b(pesquis|investig|analis|estud|research|spike|explor)/i },
  {
    type: 'validation',
    pattern: /\b(valid|test|qa|verific|prov|reproduz|smoke|regress)/i,
  },
  {
    type: 'code',
    pattern:
      /\b(implement|criar|cria|adicion|refator|conserta|fix|bug|feature|feat|endpoint|api|service|controller|component|hook|store|schema|migration|ajust|corrig|otimiz|melhor)/i,
  },
];

/**
 * Resultado canônico do PromptBuilder, consumido pelo `ExecutionsService`
 * para popular `OperacaoExecucaoClaude.params.prompt` e `params.taskType`.
 */
export interface BuiltPrompt {
  /** Prompt natural renderizado a partir do template + DTask. */
  prompt: string;
  /** Tipo detectado/resolvido (`code | docs | research | validation | other`). */
  taskType: PromptTaskType;
  /** Nome (título) da DTask — espelhado no resultado para conveniência de log. */
  taskName: string;
}

/**
 * DTO interno do shape retornado por `prisma.dTask.findFirst` com select restrito.
 */
interface TaskRow {
  chave: bigint;
  nome: string;
  descricao: string | null;
  dados: unknown;
  idClasse: bigint;
  project: { chave: bigint } | null;
}

/**
 * Service responsável por montar o prompt natural enviado ao Claude Code
 * a partir de uma `DTask` persistida (ADR-V2-049).
 *
 * Fluxo:
 *   1. Carrega templates Markdown do disco UMA vez no constructor (cache em memória).
 *   2. `buildFromTaskId(taskId, projectId, userId)` busca a DTask via Prisma
 *      (1 query, ZERO N+1) validando escopo (task pertence ao projeto).
 *   3. Detecta `taskType` em cascata:
 *      a. `task.dados.taskType` (canônico V2 — gravado por POST /tasks)
 *      b. `task.dados.tipo` (alias defensive — legado/Telegram)
 *      c. regex sobre `task.nome` (porta heurística do frontend)
 *      d. `'other'` (fallback final)
 *   4. Renderiza o template substituindo placeholders `{{taskId}}`,
 *      `{{taskName}}`, `{{description}}` + bloco condicional `{{#if description}}...{{/if}}`.
 *
 * Padrões de Engine NÃO se aplicam aqui (DTask é tabela estrutural — ver Pilar 1):
 * usar `PrismaService` direto via Service, em queries leves.
 *
 * @see docs/decisions/ADR-V2-049-prompt-builder-canonico.md
 * @see src/executions/services/prompt-templates/*.md
 */
@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger(PromptBuilderService.name);

  /** Cache de templates Markdown carregado no constructor (Map<type, raw>). */
  private readonly templates: ReadonlyMap<PromptTaskType, string>;

  constructor(private readonly prisma: PrismaService) {
    this.templates = this.loadTemplates();
  }

  /**
   * Carrega todos os 5 templates do disco UMA vez. Falha barulhento se
   * algum arquivo estiver ausente — sistema não inicia (preferível a
   * runtime errors durante POST /execute).
   */
  private loadTemplates(): ReadonlyMap<PromptTaskType, string> {
    const baseDir = join(__dirname, 'prompt-templates');
    const out = new Map<PromptTaskType, string>();
    for (const type of VALID_TASK_TYPES) {
      const file = join(baseDir, `${type}.md`);
      try {
        const raw = readFileSync(file, 'utf8');
        out.set(type, raw);
      } catch (e) {
        const err = e as Error;
        this.logger.error(
          `Falha ao carregar template ${file}: ${err.message}. Sistema mal-configurado.`,
        );
        throw new Error(
          `PromptBuilderService: template ${type}.md ausente em ${baseDir} (${err.message})`,
        );
      }
    }
    return out;
  }

  /**
   * Monta o prompt natural a partir de uma DTask persistida.
   *
   * Valida:
   *  - Existência da task NO ESCOPO do projeto (404 NotFoundException)
   *    — filtro `idProject` aplicado no WHERE garante zero disclosure:
   *    tanto task inexistente quanto task de outro projeto retornam 404
   *    idêntico (anti-enumeration — Reviewer fix R1).
   *
   * Não faz checagem de permissão de usuário — o `ExecutionsService` já
   * valida membership (`dVincula` -170..-173) antes de chamar este método.
   *
   * Performance: 1 query Prisma (`dTask.findFirst` com `select` restrito).
   * Templates resolvidos em memória (sem IO de disco em runtime).
   *
   * @param taskId - chave da DTask como string do BigInt (ex: `"39"`)
   * @param projectId - chave do DProject como string do BigInt (escopo)
   * @param userId - chave do DUserGroup / DEntidade — usado apenas em log
   * @returns Promise com prompt renderizado + taskType detectado + taskName
   *
   * @throws {NotFoundException} Quando taskId não existe NO PROJETO (cobre
   *   tanto task inexistente quanto task de outro projeto — anti-enumeration)
   *
   * @example
   * ```typescript
   * const { prompt, taskType, taskName } =
   *   await promptBuilder.buildFromTaskId('39', '12', '7');
   * // prompt: "Você é um agente de automação do Scrumban..."
   * // taskType: 'code'
   * // taskName: 'criar arquivo AGENT_TEST.md'
   * ```
   */
  async buildFromTaskId(taskId: string, projectId: string, userId: string): Promise<BuiltPrompt> {
    const taskBigInt = BigInt(taskId);
    const projectBigInt = BigInt(projectId);

    this.logger.debug(`buildFromTaskId taskId=${taskId} projectId=${projectId} userId=${userId}`);

    // Anti-enumeration (Reviewer fix R1): filtrar `idProject` no WHERE
    // do banco — task inexistente E task de outro projeto retornam o
    // MESMO 404, sem disclosure de existência cruzada de projetos.
    const task = (await this.prisma.dTask.findFirst({
      where: {
        chave: taskBigInt,
        idProject: projectBigInt,
        excluido: false,
      },
      select: {
        chave: true,
        nome: true,
        descricao: true,
        dados: true,
        idClasse: true,
        project: { select: { chave: true } },
      },
    })) as TaskRow | null;

    if (!task) {
      throw new NotFoundException(`Task ${taskId} nao encontrada.`);
    }

    const taskType = this.detectTaskType(task);
    const taskName = task.nome;
    const description = (task.descricao ?? '').trim();

    const template = this.templates.get(taskType)!;
    const prompt = this.render(template, {
      taskId,
      taskName,
      description,
    });

    this.logger.log(
      `prompt_built taskId=${taskId} taskType=${taskType} promptLen=${prompt.length}`,
    );

    return { prompt, taskType, taskName };
  }

  /**
   * Detecta o `taskType` em cascata:
   *   1. `task.dados.taskType` (canônico V2 — gravado por POST /tasks)
   *   2. `task.dados.tipo` (alias defensive — legado/Telegram/MCP)
   *   3. regex sobre `task.nome` (porta heurística do frontend)
   *   4. `'other'` (fallback final, sempre ganha)
   *
   * Valores são normalizados para lowercase antes do match. Strings inválidas
   * caem para o passo seguinte (não lançam erro).
   */
  private detectTaskType(task: TaskRow): PromptTaskType {
    const dados = (task.dados ?? {}) as Record<string, unknown>;

    const fromTaskType = this.normalizeTaskType(dados.taskType);
    if (fromTaskType) return fromTaskType;

    const fromTipo = this.normalizeTaskType(dados.tipo);
    if (fromTipo) return fromTipo;

    const fromHeuristic = this.detectFromName(task.nome);
    if (fromHeuristic) return fromHeuristic;

    return 'other';
  }

  /**
   * Normaliza string para PromptTaskType válido. Aceita aliases comuns
   * (BUG/FEATURE/IMPROVEMENT do legado → `'code'`; EXPLAIN → `'docs'`;
   * REVIEW → `'validation'`).
   *
   * @param raw - valor bruto vindo de `dados.taskType` ou `dados.tipo`
   * @returns PromptTaskType normalizado ou `null` se não-mapeável
   */
  private normalizeTaskType(raw: unknown): PromptTaskType | null {
    if (typeof raw !== 'string') return null;
    const lower = raw.trim().toLowerCase();
    if (!lower) return null;

    if ((VALID_TASK_TYPES as ReadonlyArray<string>).includes(lower)) {
      return lower as PromptTaskType;
    }

    // Aliases do legado (frontend pre-V2 / Telegram / MCP)
    const aliasMap: Record<string, PromptTaskType> = {
      bug: 'code',
      feature: 'code',
      feat: 'code',
      improvement: 'code',
      improv: 'code',
      refactor: 'code',
      explain: 'docs',
      doc: 'docs',
      documentation: 'docs',
      review: 'validation',
      qa: 'validation',
      test: 'validation',
      tests: 'validation',
      spike: 'research',
      investigation: 'research',
    };
    return aliasMap[lower] ?? null;
  }

  /**
   * Aplica heurística regex sobre o `nome` da task (porta do frontend).
   * Retorna o PRIMEIRO match — ordem de TASK_TYPE_HEURISTICS importa.
   */
  private detectFromName(name: string): PromptTaskType | null {
    if (!name) return null;
    for (const { type, pattern } of TASK_TYPE_HEURISTICS) {
      if (pattern.test(name)) return type;
    }
    return null;
  }

  /**
   * Renderiza template substituindo placeholders.
   *
   * Sintaxe suportada (mínima e propositadamente simples):
   *  - `{{var}}` → substitui pela variável correspondente (escape literal de regex)
   *  - `{{#if description}}...{{/if}}` → bloco condicional; só inclui se
   *    `description` for não-vazia. Suporta apenas a chave `description`
   *    (única usada nos 5 templates atuais).
   *
   * NÃO usa engine de template externo (Handlebars/EJS) — propositadamente
   * minimalista. Não há iteração / chaining / parciais aqui.
   *
   * @param template - conteúdo bruto do `.md`
   * @param vars - mapa de placeholders → valor
   * @returns texto renderizado
   */
  private render(
    template: string,
    vars: { taskId: string; taskName: string; description: string },
  ): string {
    // 1. Resolver bloco condicional {{#if description}}...{{/if}}
    //    Multi-line, non-greedy.
    const ifBlockRe = /\{\{#if description\}\}([\s\S]*?)\{\{\/if\}\}/g;
    let result = template.replace(ifBlockRe, (_match, inner: string) => {
      return vars.description ? inner : '';
    });

    // 2. Substituir placeholders simples
    result = result
      .replace(/\{\{taskId\}\}/g, vars.taskId)
      .replace(/\{\{taskName\}\}/g, vars.taskName)
      .replace(/\{\{description\}\}/g, vars.description);

    // 3. Limpar excessos de newlines (3+ seguidos viram 2)
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
  }
}
