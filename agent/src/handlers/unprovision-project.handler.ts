/**
 * Handler `UNPROVISION_PROJECT` em `POST /v1/execute`.
 *
 * Remove a entrada do projeto no `CLAUDE.md` global do agente.
 * Operação idempotente: se o slug não existir no arquivo, responde 200
 * igualmente (removeProjectEntry trata silenciosamente).
 */
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { removeProjectEntry } from '../claude-code/claude-md-writer';
import { PROJECT_SLUG_REGEX } from '../ssh/deploy-key-generator';

export interface UnprovisionProjectDeps {
  logger: Logger;
  claudeMdPath: string;
  removeImpl?: typeof removeProjectEntry;
}

export function createUnprovisionProjectHandler(deps: UnprovisionProjectDeps) {
  const removeImpl = deps.removeImpl ?? removeProjectEntry;

  return (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const projectSlug = body.projectSlug;

    if (typeof projectSlug !== 'string' || !PROJECT_SLUG_REGEX.test(projectSlug)) {
      deps.logger.warn(
        { stage: 'unprovision-project', errorCode: 'INVALID_SLUG' },
        'projectSlug invalido',
      );
      res.status(422).json({
        accepted: false,
        errorCode: 'INVALID_SLUG',
        message: `projectSlug invalido (deve bater ${PROJECT_SLUG_REGEX})`,
      });
      return;
    }

    removeImpl(projectSlug, deps.claudeMdPath)
      .then(() => {
        deps.logger.info(
          { stage: 'unprovision-project', projectSlug },
          'entrada removida do CLAUDE.md',
        );
        res.status(200).json({ accepted: true });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.error(
          { stage: 'unprovision-project', projectSlug, err: msg },
          'falha ao remover entrada do CLAUDE.md',
        );
        res.status(500).json({
          accepted: false,
          errorCode: 'CLAUDE_MD_WRITE_ERROR',
          message: msg,
        });
      });
  };
}
