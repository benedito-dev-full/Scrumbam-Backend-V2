/**
 * Handler `GENERATE_DEPLOY_KEY` em `POST /v1/execute`.
 *
 * **Fluxo:**
 *
 *  1. Valida payload (`projectSlug` é string, bate na regex `^[a-z0-9-]{1,64}$`;
 *     `comment` opcional).
 *  2. Delega para {@link generateDeployKey} (idempotente — reusa chave
 *     existente; senão `ssh-keygen ed25519`).
 *  3. Retorna 200 com `{ accepted, publicKey, fingerprint, alreadyExisted }`.
 *
 * **Privada NUNCA volta no response.** O handler nunca lê nem expõe
 * `<baseDir>/<slug>` (privada). Só lê `.pub` e computa o fingerprint.
 *
 * @see plan-2026-05-13-vps-project-config-via-frontend §4 contrato,
 *      §5 Fase 2.4, §7 R3 (path injection), §10 itens 6 e 10.
 */
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import {
  DeployKeyError,
  generateDeployKey,
  PROJECT_SLUG_REGEX,
  type GenerateDeployKeyResult,
} from '../ssh/deploy-key-generator';

/** Dependências injetáveis para testes. */
export interface GenerateDeployKeyDeps {
  logger: Logger;
  /** Override do baseDir (testes apontam para `/tmp/...`). */
  baseDir?: string;
  /** Override da factory de chave (testes). Default: {@link generateDeployKey}. */
  generateImpl?: typeof generateDeployKey;
}

interface ValidatedPayload {
  projectSlug: string;
  comment: string | undefined;
  correlationId: string | null;
}

/**
 * Constrói o handler Express.
 *
 * @example
 *   const handler = createGenerateDeployKeyHandler({ logger });
 *   dispatcher.register('GENERATE_DEPLOY_KEY', handler);
 */
export function createGenerateDeployKeyHandler(deps: GenerateDeployKeyDeps) {
  const generateImpl = deps.generateImpl ?? generateDeployKey;

  return (req: Request, res: Response): void => {
    const validation = validatePayload(req.body);
    if (!validation.ok) {
      deps.logger.warn(
        { stage: 'generate-deploy-key', errorCode: validation.errorCode },
        'payload invalido',
      );
      res.status(validation.status).json({
        accepted: false,
        errorCode: validation.errorCode,
        message: validation.message,
      });
      return;
    }

    const { projectSlug, comment, correlationId } = validation.payload;

    let result: GenerateDeployKeyResult;
    try {
      result = generateImpl(projectSlug, {
        baseDir: deps.baseDir,
        comment,
      });
    } catch (err) {
      if (err instanceof DeployKeyError) {
        const status = errorCodeToStatus(err.code);
        deps.logger.error(
          { stage: 'generate-deploy-key', errorCode: err.code, projectSlug, correlationId },
          `generate-deploy-key falhou: ${err.message}`,
        );
        res.status(status).json({
          accepted: false,
          errorCode: err.code,
          message: err.message,
        });
        return;
      }
      deps.logger.error(
        { stage: 'generate-deploy-key', projectSlug, correlationId, err: (err as Error).message },
        'erro inesperado',
      );
      res.status(500).json({
        accepted: false,
        errorCode: 'INTERNAL_ERROR',
        message: 'erro interno ao gerar deploy key',
      });
      return;
    }

    deps.logger.info(
      {
        stage: 'generate-deploy-key',
        projectSlug,
        alreadyExisted: result.alreadyExisted,
        fingerprint: result.fingerprint,
        correlationId,
      },
      'deploy key pronta',
    );

    res.status(200).json({
      accepted: true,
      publicKey: result.publicKey,
      fingerprint: result.fingerprint,
      alreadyExisted: result.alreadyExisted,
    });
  };
}

type ValidationResult =
  | { ok: true; payload: ValidatedPayload }
  | {
      ok: false;
      status: number;
      errorCode: 'INVALID_PAYLOAD' | 'INVALID_SLUG' | 'INVALID_COMMENT';
      message: string;
    };

/**
 * Valida o body. A regex do slug é replicada do {@link PROJECT_SLUG_REGEX}
 * (defesa em profundidade: backend valida no DTO, agent re-valida aqui).
 */
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
  const slug = b.projectSlug;
  if (typeof slug !== 'string' || !PROJECT_SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      status: 422,
      errorCode: 'INVALID_SLUG',
      message: `projectSlug invalido (deve bater ${PROJECT_SLUG_REGEX})`,
    };
  }
  const comment = b.comment;
  let commentTyped: string | undefined;
  if (comment !== undefined) {
    if (typeof comment !== 'string') {
      return {
        ok: false,
        status: 422,
        errorCode: 'INVALID_COMMENT',
        message: 'comment, se fornecido, deve ser string',
      };
    }
    // Comment não pode conter newline (vai pro `-C` do ssh-keygen, lido como uma linha).
    if (comment.includes('\n') || comment.includes('\r')) {
      return {
        ok: false,
        status: 422,
        errorCode: 'INVALID_COMMENT',
        message: 'comment nao pode conter newline',
      };
    }
    if (comment.length > 256) {
      return {
        ok: false,
        status: 422,
        errorCode: 'INVALID_COMMENT',
        message: 'comment excede 256 chars',
      };
    }
    commentTyped = comment;
  }
  const correlationId =
    typeof b.metadata === 'object' &&
    b.metadata !== null &&
    typeof (b.metadata as Record<string, unknown>).correlationId === 'string'
      ? ((b.metadata as Record<string, unknown>).correlationId as string)
      : null;

  return {
    ok: true,
    payload: { projectSlug: slug, comment: commentTyped, correlationId },
  };
}

function errorCodeToStatus(code: string): number {
  switch (code) {
    case 'INVALID_SLUG':
    case 'PATH_ESCAPE':
      return 422;
    case 'SSH_KEYGEN_MISSING':
      return 500;
    case 'SSH_KEYGEN_FAILED':
    case 'IO_ERROR':
      return 500;
    default:
      return 500;
  }
}
