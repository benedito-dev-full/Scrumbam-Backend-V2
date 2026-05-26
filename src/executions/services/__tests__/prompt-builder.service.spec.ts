import { NotFoundException } from '@nestjs/common';
import { PromptBuilderService } from '../prompt-builder.service';
import { PrismaService } from '../../../prisma.service';

/**
 * Unit tests do PromptBuilderService (ADR-V2-049).
 *
 * Mocka `PrismaService.dTask.findFirst` — não toca banco real.
 * Templates são lidos do disco no constructor (FS real) — garante que
 * arquivos `code.md`, `docs.md`, `research.md`, `validation.md`, `other.md`
 * existem em `services/prompt-templates/`.
 */
describe('PromptBuilderService', () => {
  let service: PromptBuilderService;
  let prisma: { dTask: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = {
      dTask: {
        findFirst: jest.fn(),
      },
    };
    service = new PromptBuilderService(prisma as unknown as PrismaService);
  });

  /** Helper: monta TaskRow esperado pelo service. */
  function mockTask(
    overrides: Partial<{
      chave: bigint;
      nome: string;
      descricao: string | null;
      dados: unknown;
      idClasse: bigint;
      projectChave: bigint;
    }> = {},
  ) {
    return {
      chave: overrides.chave ?? BigInt(39),
      nome: overrides.nome ?? 'criar arquivo AGENT_TEST.md',
      descricao: overrides.descricao ?? null,
      dados: overrides.dados ?? {},
      idClasse: overrides.idClasse ?? BigInt(-154),
      project: { chave: overrides.projectChave ?? BigInt(12) },
    };
  }

  // --------------------------------------------------------------------------
  // Caminho feliz por taskType
  // --------------------------------------------------------------------------

  it('renderiza template CODE quando dados.taskType="code" (com descrição)', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'criar endpoint /v1/foo',
        descricao: 'expor GET retornando { ok: true }',
        dados: { taskType: 'code' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');

    expect(result.taskType).toBe('code');
    expect(result.taskName).toBe('criar endpoint /v1/foo');
    expect(result.prompt).toContain('agente de automação do Scrumban');
    expect(result.prompt).toContain('Task #39 — criar endpoint /v1/foo');
    expect(result.prompt).toContain('expor GET retornando { ok: true }');
    expect(result.prompt).toContain('**Descrição:**');
    // Placeholders devem ter sido todos substituídos.
    expect(result.prompt).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('renderiza template CODE sem bloco de descrição quando descricao é null', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'implementar feature X',
        descricao: null,
        dados: { taskType: 'code' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');

    expect(result.taskType).toBe('code');
    expect(result.prompt).toContain('Task #39 — implementar feature X');
    expect(result.prompt).not.toContain('**Descrição:**');
    expect(result.prompt).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('renderiza template CODE sem bloco de descrição quando descricao é string vazia/whitespace', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'algo',
        descricao: '   \n   ',
        dados: { taskType: 'code' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.prompt).not.toContain('**Descrição:**');
  });

  it('renderiza template DOCS quando dados.taskType="docs"', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'atualizar README com instruções de deploy',
        descricao: 'incluir seção sobre Dokploy',
        dados: { taskType: 'docs' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');

    expect(result.taskType).toBe('docs');
    expect(result.prompt).toContain('agente de documentação');
    expect(result.prompt).toContain('atualizar README');
  });

  it('renderiza template RESEARCH quando dados.taskType="research"', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'investigar latência do queue',
        dados: { taskType: 'research' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('research');
    expect(result.prompt).toContain('agente de pesquisa');
  });

  it('renderiza template VALIDATION quando dados.taskType="validation"', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'validar fluxo de login',
        dados: { taskType: 'validation' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('validation');
    expect(result.prompt).toContain('agente de validação/QA');
  });

  it('renderiza template OTHER quando dados.taskType="other" explicito', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'tarefa generica',
        dados: { taskType: 'other' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('other');
    expect(result.prompt).toContain('agente de automação do Scrumban');
    expect(result.prompt).toContain('com bom senso');
  });

  // --------------------------------------------------------------------------
  // Cascata de detecção
  // --------------------------------------------------------------------------

  it('cai em dados.tipo quando dados.taskType ausente', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'algo qualquer',
        dados: { tipo: 'docs' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('docs');
  });

  it('cai em regex(nome) quando dados.taskType e dados.tipo ausentes', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'implementar endpoint de exemplo',
        dados: {},
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('code');
  });

  it('cai em "other" como fallback final quando nada bate', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'xyz',
        dados: {},
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('other');
  });

  it('aceita alias BUG (legado) e mapeia para "code"', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'algo',
        dados: { taskType: 'BUG' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('code');
  });

  it('aceita alias EXPLAIN (legado) e mapeia para "docs"', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'algo',
        dados: { taskType: 'EXPLAIN' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('docs');
  });

  it('ignora taskType invalido e cai para regex', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        nome: 'investigar problema X',
        dados: { taskType: 'naoexisteEsseTipo' },
      }),
    );

    const result = await service.buildFromTaskId('39', '12', '7');
    expect(result.taskType).toBe('research');
  });

  // --------------------------------------------------------------------------
  // Validações de escopo / existência
  // --------------------------------------------------------------------------

  it('lanca NotFoundException quando task nao existe', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(null);

    await expect(service.buildFromTaskId('999', '12', '7')).rejects.toThrow(NotFoundException);
  });

  /**
   * Reviewer fix R1 (review-2026-05-26-prompt-builder.md):
   *
   * Anti-enumeration: task pertencente a OUTRO projeto retorna o MESMO
   * 404 que task inexistente. O filtro `idProject` no WHERE da query
   * garante zero disclosure — não é possível enumerar IDs entre projetos.
   *
   * Antes: WHERE só tinha `chave`+`excluido`, e o app-level check
   * lançava ForbiddenException (403) — usuário podia distinguir
   * "task existe em outro projeto" vs "task não existe em lugar nenhum".
   */
  it('lanca NotFoundException quando task pertence a outro projeto (anti-enumeration — fix R1)', async () => {
    // Quando o WHERE inclui idProject, o Prisma retorna null para qualquer
    // task que não esteja NO projeto pedido — mesmo que exista em outro.
    prisma.dTask.findFirst.mockResolvedValueOnce(null);

    await expect(service.buildFromTaskId('39', '12', '7')).rejects.toThrow(NotFoundException);

    // O WHERE da query DEVE incluir idProject — defense-in-depth.
    expect(prisma.dTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chave: BigInt(39),
          idProject: BigInt(12),
          excluido: false,
        }),
      }),
    );
  });

  // --------------------------------------------------------------------------
  // Query Prisma
  // --------------------------------------------------------------------------

  it('faz UMA query ao Prisma com BigInt corretos e select restrito', async () => {
    prisma.dTask.findFirst.mockResolvedValueOnce(mockTask({ dados: { taskType: 'code' } }));

    await service.buildFromTaskId('39', '12', '7');

    expect(prisma.dTask.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.dTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chave: BigInt(39),
          // Reviewer fix R1: idProject no WHERE garante anti-enumeration.
          idProject: BigInt(12),
          excluido: false,
        }),
        select: expect.objectContaining({
          chave: true,
          nome: true,
          descricao: true,
          dados: true,
          idClasse: true,
          project: { select: { chave: true } },
        }),
      }),
    );
  });

  it('aceita BigInt grandes (boundary)', async () => {
    const bigId = '9007199254740993'; // > Number.MAX_SAFE_INTEGER
    prisma.dTask.findFirst.mockResolvedValueOnce(
      mockTask({
        chave: BigInt(bigId),
        dados: { taskType: 'code' },
      }),
    );

    const result = await service.buildFromTaskId(bigId, '12', '7');
    expect(result.taskType).toBe('code');
    expect(result.prompt).toContain(`Task #${bigId}`);
  });
});
