/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regressão: os 5 templates do PromptBuilder renderizados com uma task NEUTRA
 * devem ser classificados como LOW pelo Risk Gate v2 (ADR-V2-081, R3).
 *
 * Protege contra alguém editar um `prompt-templates/*.md` com palavras que
 * disparem padrões (ex.: "production", ".env", "migration", "credenciais")
 * e, com isso, tornar TODA execução em modo PROMPT MEDIUM/HIGH (gestor vira
 * carimbador → aprovação perde valor).
 *
 * Usa o PromptBuilderService REAL (render real dos .md do disco) com Prisma
 * mockado — não toca banco.
 *
 * @see src/executions/services/prompt-templates/*.md
 * @see src/engine/dvfs/risk-gate-validator.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import {
  PromptBuilderService,
  PromptTaskType,
} from '../../../executions/services/prompt-builder.service';

const scriptPath = path.join(__dirname, '..', 'risk-gate-validator.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

// eslint-disable-next-line no-eval
const riskGateValidator: (op: any) => Promise<void> = eval(
  `(function() { ${scriptContent}; return riskGateValidator; })()`,
);

const TASK_TYPES: PromptTaskType[] = ['code', 'docs', 'other', 'research', 'validation'];

function buildPromptBuilder(taskType: PromptTaskType, nome: string, descricao: string) {
  const mockPrisma: any = {
    dTask: {
      findFirst: jest.fn().mockResolvedValue({
        chave: BigInt(42),
        nome,
        descricao,
        dados: { taskType },
        idClasse: BigInt(-200),
        project: { chave: BigInt(100) },
      }),
    },
  };
  return new PromptBuilderService(mockPrisma);
}

async function classify(prompt: string): Promise<any> {
  const op: any = {
    dados: { command: { text: 'claude -p task-built-prompt-placeholder' }, prompt },
  };
  await riskGateValidator(op);
  return op.dados.risk;
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('Risk Gate v2 — templates de prompt com task neutra são LOW', () => {
  test.each(TASK_TYPES)('template "%s" (sem descrição) → LOW', async (taskType) => {
    const builder = buildPromptBuilder(taskType, 'Ajustar botão', '');
    const { prompt } = await builder.buildFromTaskId('42', '100', '7');

    expect(prompt.length).toBeGreaterThan(50);
    const risk = await classify(prompt);
    expect({ taskType, level: risk.level, explanation: risk.explanation }).toEqual({
      taskType,
      level: 'LOW',
      explanation: 'Nenhum padrão de risco detectado.',
    });
  });

  test.each(TASK_TYPES)('template "%s" (com descrição neutra) → LOW', async (taskType) => {
    const builder = buildPromptBuilder(
      taskType,
      'Ajustar botão',
      'O botão de salvar está desalinhado na tela de tarefas. Alinhar à direita.',
    );
    const { prompt } = await builder.buildFromTaskId('42', '100', '7');

    const risk = await classify(prompt);
    expect(risk.level).toBe('LOW');
  });

  test.each(TASK_TYPES)(
    'template "%s" com descrição destrutiva → HIGH (o conteúdo da task é avaliado)',
    async (taskType) => {
      const builder = buildPromptBuilder(taskType, 'Limpeza', 'apague a tabela de clientes');
      const { prompt } = await builder.buildFromTaskId('42', '100', '7');

      const risk = await classify(prompt);
      expect(risk.level).toBe('HIGH');
      expect(risk.matchedPatterns[0].source).toBe('prompt');
    },
  );
});
