import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Resultado da resolução do contexto de execução.
 */
export interface ExecutionContext {
  /** ID do agente configurado no projeto (DEntidade idClasse=-310) */
  agentId: bigint;
  /** Dados do campo `dados` do DProject */
  projectDados: {
    automation?: {
      idAgent?: string;
      remotePath?: string;
      remoteRepoUrl?: string;
      remoteBranch?: string;
    };
    [key: string]: unknown;
  };
}

/**
 * Resolve o contexto de execução a partir de um projectId.
 *
 * Valida que o projeto existe e tem um agente configurado em
 * `DProject.dados.automation.idAgent`.
 *
 * @param prisma PrismaService
 * @param projectId ID do projeto (bigint)
 * @returns ExecutionContext com agentId e dados do projeto
 * @throws NotFoundException se projeto não encontrado
 * @throws BadRequestException se projeto não tem agente configurado
 */
export async function resolveExecutionContext(
  prisma: PrismaService,
  projectId: bigint,
): Promise<ExecutionContext> {
  const project = await prisma.dProject.findFirst({
    where: { chave: projectId, excluido: false },
    select: { dados: true },
  });

  if (!project) {
    throw new NotFoundException(`Projeto ${projectId} não encontrado`);
  }

  const dados = project.dados as ExecutionContext['projectDados'] | null;

  if (!dados?.automation?.idAgent) {
    throw new BadRequestException(
      `Projeto ${projectId} não tem agente configurado. ` +
        `Configure automation.idAgent em DProject.dados.`,
    );
  }

  return {
    agentId: BigInt(dados.automation.idAgent),
    projectDados: dados,
  };
}
