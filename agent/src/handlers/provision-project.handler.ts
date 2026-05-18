/**
 * Handler `PROVISION_PROJECT` em `POST /v1/execute`.
 */
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import {
  ProvisionProjectError,
  provisionProject,
  REPO_URL_REGEX,
  type ProvisionProjectResult,
} from '../git/clone';
import { PROJECT_SLUG_REGEX } from '../ssh/deploy-key-generator';
import { upsertProjectEntry } from '../claude-code/claude-md-writer';

export interface ProvisionProjectDeps {
  logger: Logger;
  allowedBaseDirs?: readonly string[];
  provisionImpl?: typeof provisionProject;
  claudeMdPath?: string;
  claudeMdWriterImpl?: typeof upsertProjectEntry;
}

interface ValidatedPayload {
  projectSlug: string;
  repoUrl: string;
  useSshKey: boolean;
  baseDir: string | undefined;
  depth: number | undefined;
  timeoutSec: number | undefined;
  correlationId: string | null;
}

export function createProvisionProjectHandler(deps: ProvisionProjectDeps) {
  const provisionImpl = deps.provisionImpl ?? provisionProject;

  return (req: Request, res: Response): void => {
    const validation = validatePayload(req.body);
    if (!validation.ok) {
      deps.logger.warn(
        { stage: 'provision-project', errorCode: validation.errorCode },
        'payload invalido',
      );
      res.status(validation.status).json({
        accepted: false,
        errorCode: validation.errorCode,
        message: validation.message,
      });
      return;
    }

    const payload = validation.payload;
    let result: ProvisionProjectResult;
    try {
      result = provisionImpl(payload.projectSlug, payload.repoUrl, {
        baseDir: payload.baseDir,
        allowedBaseDirs: deps.allowedBaseDirs,
        useSshKey: payload.useSshKey,
        depth: payload.depth,
        timeoutSec: payload.timeoutSec,
      });
    } catch (err) {
      if (err instanceof ProvisionProjectError) {
        const status = errorCodeToStatus(err.code);
        deps.logger.error(
          {
            stage: 'provision-project',
            errorCode: err.code,
            projectSlug: payload.projectSlug,
            correlationId: payload.correlationId,
          },
          `provision-project falhou: ${err.message}`,
        );
        res.status(status).json({
          accepted: false,
          errorCode: err.code,
          message: err.message,
        });
        return;
      }

      deps.logger.error(
        {
          stage: 'provision-project',
          projectSlug: payload.projectSlug,
          correlationId: payload.correlationId,
          err: (err as Error).message,
        },
        'erro inesperado',
      );
      res.status(500).json({
        accepted: false,
        errorCode: 'INTERNAL_ERROR',
        message: 'erro interno ao provisionar projeto',
      });
      return;
    }

    deps.logger.info(
      {
        stage: 'provision-project',
        projectSlug: payload.projectSlug,
        alreadyExisted: result.alreadyExisted,
        headCommitSha: result.headCommitSha,
        correlationId: payload.correlationId,
      },
      'projeto provisionado',
    );

    res.status(200).json({
      accepted: true,
      alreadyExisted: result.alreadyExisted,
      projectPath: result.projectPath,
      currentBranch: result.currentBranch,
      headCommitSha: result.headCommitSha,
      usedSshKey: result.usedSshKey,
    });

    if (deps.claudeMdPath) {
      const writerImpl = deps.claudeMdWriterImpl ?? upsertProjectEntry;
      void writerImpl(payload.projectSlug, result.projectPath, deps.claudeMdPath).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          deps.logger.error(
            {
              stage: 'provision-project',
              projectSlug: payload.projectSlug,
              err: msg,
            },
            'falha ao atualizar CLAUDE.md apos provision (nao afeta o resultado)',
          );
        },
      );
    }
  };
}

type ValidationResult =
  | { ok: true; payload: ValidatedPayload }
  | {
      ok: false;
      status: number;
      errorCode:
        | 'INVALID_PAYLOAD'
        | 'INVALID_SLUG'
        | 'REPO_URL_MISSING'
        | 'REPO_URL_INVALID'
        | 'INVALID_USE_SSH_KEY'
        | 'BASE_DIR_INVALID'
        | 'INVALID_DEPTH'
        | 'INVALID_TIMEOUT';
      message: string;
    };

function validatePayload(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null) {
    return {
      ok: false,
      status: 400,
      errorCode: 'INVALID_PAYLOAD',
      message: 'body deve ser objeto JSON',
    };
  }

  const b = body as Record<string, unknown>;
  if (typeof b.projectSlug !== 'string' || !PROJECT_SLUG_REGEX.test(b.projectSlug)) {
    return {
      ok: false,
      status: 422,
      errorCode: 'INVALID_SLUG',
      message: `projectSlug invalido (deve bater ${PROJECT_SLUG_REGEX})`,
    };
  }
  if (typeof b.repoUrl !== 'string' || b.repoUrl.length === 0) {
    return {
      ok: false,
      status: 422,
      errorCode: 'REPO_URL_MISSING',
      message: 'repoUrl obrigatorio',
    };
  }
  if (b.repoUrl.length > 512 || !REPO_URL_REGEX.test(b.repoUrl)) {
    return {
      ok: false,
      status: 422,
      errorCode: 'REPO_URL_INVALID',
      message: 'repoUrl fora da whitelist',
    };
  }

  const useSshKeyRaw = b.useSshKey;
  if (useSshKeyRaw === null || (useSshKeyRaw !== undefined && typeof useSshKeyRaw !== 'boolean')) {
    return {
      ok: false,
      status: 422,
      errorCode: 'INVALID_USE_SSH_KEY',
      message: 'useSshKey deve ser boolean',
    };
  }
  const useSshKey = useSshKeyRaw ?? true;

  let baseDir: string | undefined;
  if (b.baseDir !== undefined) {
    if (typeof b.baseDir !== 'string' || b.baseDir.length === 0) {
      return {
        ok: false,
        status: 422,
        errorCode: 'BASE_DIR_INVALID',
        message: 'baseDir deve ser string nao-vazia',
      };
    }
    baseDir = b.baseDir;
  }

  const depth = readOptionalPositiveInt(
    b.depth,
    'INVALID_DEPTH',
    'depth deve ser inteiro positivo',
  );
  if (!depth.ok) return depth;
  const timeoutSec = readOptionalPositiveInt(
    b.timeoutSec,
    'INVALID_TIMEOUT',
    'timeoutSec deve ser inteiro positivo',
  );
  if (!timeoutSec.ok) return timeoutSec;

  const correlationId =
    typeof b.metadata === 'object' &&
    b.metadata !== null &&
    typeof (b.metadata as Record<string, unknown>).correlationId === 'string'
      ? ((b.metadata as Record<string, unknown>).correlationId as string)
      : null;

  return {
    ok: true,
    payload: {
      projectSlug: b.projectSlug,
      repoUrl: b.repoUrl,
      useSshKey,
      baseDir,
      depth: depth.value,
      timeoutSec: timeoutSec.value,
      correlationId,
    },
  };
}

function readOptionalPositiveInt(
  value: unknown,
  errorCode: 'INVALID_DEPTH' | 'INVALID_TIMEOUT',
  message: string,
): { ok: true; value: number | undefined } | Extract<ValidationResult, { ok: false }> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { ok: false, status: 422, errorCode, message };
  }
  return { ok: true, value };
}

function errorCodeToStatus(code: string): number {
  switch (code) {
    case 'INVALID_SLUG':
    case 'REPO_URL_INVALID':
    case 'REPO_URL_MISSING':
    case 'BASE_DIR_INVALID':
    case 'PATH_ESCAPE':
      return 422;
    case 'PROJECT_DIR_EXISTS_NOT_GIT':
      return 409;
    case 'GIT_MISSING':
    case 'CLONE_FAILED':
    case 'PULL_FAILED':
    case 'IO_ERROR':
      return 500;
    default:
      return 500;
  }
}
