import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { ExecutionRuntimeLogService } from '../runtime/execution-runtime-log.service';

export interface GithubPrInput {
  executionId: string;
  projectId: string;
  agentId: string;
  correlationId: string;
  projectDados: Record<string, unknown>;
  branch: string;
  baseBranch?: string;
  commandText: string;
  filesChanged: number;
  diffNonEmpty: boolean;
}

interface PullCreateParams {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

interface PullCreateResult {
  data: {
    html_url: string;
    number: number;
  };
}

type PullsClient = {
  pulls: {
    create(params: PullCreateParams): Promise<PullCreateResult>;
  };
};

type OctokitFactory = () => Promise<PullsClient>;

@Injectable()
export class GithubPrService {
  private readonly logger = new Logger(GithubPrService.name);
  private testOctokitFactory?: OctokitFactory;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logService: ExecutionRuntimeLogService,
  ) {}

  setOctokitFactoryForTests(factory: OctokitFactory): void {
    this.testOctokitFactory = factory;
  }

  async openPrIfNeeded(input: GithubPrInput): Promise<string | null> {
    if (!input.diffNonEmpty || input.filesChanged <= 0) {
      await this.logService.recordSystem({
        executionId: input.executionId,
        projectId: input.projectId,
        agentId: input.agentId,
        correlationId: input.correlationId,
        line: 'github pr skipped: empty diff',
      });
      return null;
    }

    if (!input.branch.startsWith('scrumban/exec-')) {
      await this.auditPrFailure(input, 'PR_HEAD_BRANCH_REJECTED');
      return null;
    }

    const repo = this.resolveProjectRepo(input.projectDados);
    if (!repo) {
      await this.auditPrFailure(input, 'PROJECT_GITHUB_REPO_MISSING');
      return null;
    }

    const base = input.baseBranch ?? repo.baseBranch;
    if (!base || base.startsWith('scrumban/exec-')) {
      await this.auditPrFailure(input, 'PROJECT_GITHUB_BASE_INVALID');
      return null;
    }

    try {
      const octokit = await this.createOctokit();
      const pr = await octokit.pulls.create({
        owner: repo.owner,
        repo: repo.name,
        head: input.branch,
        base,
        title: `[scrumban] Execution #${input.executionId}`,
        body:
          `Automated execution via Scrumban V2.\n\n` +
          `Command:\n\`\`\`\n${input.commandText.slice(0, 1000)}\n\`\`\`\n\n` +
          `Files changed: ${input.filesChanged}\n` +
          `Correlation: ${input.correlationId}`,
      });

      const pullRequest = {
        url: pr.data.html_url,
        number: pr.data.number,
        openedAt: new Date().toISOString(),
      };
      await this.persistPullRequest(input.executionId, pullRequest);
      return pullRequest.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `github_pr_failed executionId=${input.executionId} error=${message}`,
      );
      await this.auditPrFailure(input, `GITHUB_PR_FAILED: ${message}`);
      return null;
    }
  }

  private resolveProjectRepo(
    projectDados: Record<string, unknown>,
  ): { owner: string; name: string; baseBranch: string } | null {
    const automation = this.asRecord(projectDados.automation);
    const repoUrl =
      this.asString(automation?.remoteRepoUrl) ?? this.asString(projectDados.gitRepo);
    if (!repoUrl) return null;

    const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(repoUrl);
    if (!match) return null;

    return {
      owner: match[1],
      name: match[2],
      baseBranch: this.asString(automation?.remoteBranch) ?? 'main',
    };
  }

  private async createOctokit(): Promise<PullsClient> {
    if (this.testOctokitFactory) {
      return this.testOctokitFactory();
    }

    const appId = this.configService.get<string>('GITHUB_APP_ID');
    const privateKeyRaw = this.configService.get<string>('GITHUB_APP_PRIVATE_KEY');
    const installationId = this.configService.get<string>('GITHUB_INSTALLATION_ID');
    if (!appId || !privateKeyRaw || !installationId) {
      throw new ServiceUnavailableException('GitHub App env ausente.');
    }

    const moduleRestName = '@octokit/rest';
    const moduleAuthName = '@octokit/auth-app';
    const restModule = await import(moduleRestName);
    const authModule = await import(moduleAuthName);
    const Octokit = (restModule as unknown as {
      Octokit: new (params: Record<string, unknown>) => PullsClient;
    }).Octokit;
    const createAppAuth = (authModule as unknown as {
      createAppAuth: unknown;
    }).createAppAuth;

    if (!Octokit || !createAppAuth) {
      throw new ServiceUnavailableException('Octokit nao disponivel.');
    }

    const privateKey = privateKeyRaw.includes('BEGIN')
      ? privateKeyRaw
      : Buffer.from(privateKeyRaw, 'base64').toString('utf8');

    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
        installationId,
      },
    });
  }

  private async persistPullRequest(
    executionId: string,
    pullRequest: { url: string; number: number; openedAt: string },
  ): Promise<void> {
    const pedido = await this.prisma.dPedido.findFirst({
      where: { chave: BigInt(executionId), excluido: false },
      select: { dados: true },
    });
    const dados = (pedido?.dados ?? {}) as Record<string, unknown>;
    await this.prisma.dPedido.update({
      where: { chave: BigInt(executionId) },
      data: {
        dados: {
          ...dados,
          pullRequest,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async auditPrFailure(input: GithubPrInput, reason: string): Promise<void> {
    await this.logService.recordSystem({
      executionId: input.executionId,
      projectId: input.projectId,
      agentId: input.agentId,
      correlationId: input.correlationId,
      line: reason,
      code: 'GITHUB_PR_FAILED',
    });
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

