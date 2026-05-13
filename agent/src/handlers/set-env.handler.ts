/**
 * Handler `SET_ENV` em `POST /v1/execute`.
 *
 * **Fluxo:**
 *
 *  1. Valida payload (`vars` é objeto não-vazio; `restartAfter` booleano).
 *  2. Delega para {@link writeEnvVars} (allowlist, atomicidade, 0600).
 *  3. ACK síncrono `200 { accepted: true, varsWritten, restartScheduled }`.
 *  4. **Após** o ACK (não bloqueia o response): se `restartAfter=true`,
 *     agenda `sudo systemctl restart scrumban-agent` via `setImmediate`.
 *     O restart mata este processo — o backend já recebeu o ACK e
 *     persiste `envStatus.lastEnvUpdatedAt`.
 *
 * **R1 do plan §7:** o restart síncrono mataria o processo antes do
 * ACK chegar ao backend. Por isso o ACK vem PRIMEIRO; só depois o
 * `setImmediate(restart)` agenda o restart na próxima volta do event
 * loop, garantindo que a conexão TCP do response fechou.
 *
 * **Não-loga valores das credenciais.** O logger pino já tem redaction
 * configurado no bootstrap; este handler só loga `keys` (nomes), nunca
 * `vars` (valores).
 *
 * @see plan-2026-05-13-vps-project-config-via-frontend §4 contrato,
 *      §5 Fase 2.3, §7 R1, §10 itens 3 e 5.
 */
import { execFile, type ExecFileException } from 'child_process';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import {
  EnvWriterError,
  type AllowedEnvKey,
  type WriteEnvVarsResult,
  writeEnvVars,
} from '../env/env-file-writer';

/** Dependências injetáveis para testes (mocka writer + restart). */
export interface SetEnvDeps {
  logger: Logger;
  /**
   * Path do env file. Default: `/etc/scrumban-agent/environment`.
   * Override via testes para `/tmp/...`.
   */
  envFilePath?: string;
  /**
   * Override do writer (testes). Default: {@link writeEnvVars}.
   */
  writeImpl?: typeof writeEnvVars;
  /**
   * Comando executado para reiniciar o serviço quando `restartAfter=true`.
   * Default: `sudo /bin/systemctl restart scrumban-agent`. Em testes injeta
   * um stub que captura a chamada sem reiniciar de verdade.
   */
  restartImpl?: (callback: (err: ExecFileException | null) => void) => void;
  /**
   * Override do `setImmediate`. Em testes pode-se passar uma função
   * síncrona para simplificar a verificação. Default: `setImmediate` global.
   */
  scheduleImpl?: (fn: () => void) => void;
}

interface ValidatedPayload {
  vars: Record<string, string>;
  restartAfter: boolean;
  correlationId: string | null;
}

/**
 * Constrói o handler Express.
 *
 * @example
 *   const handler = createSetEnvHandler({ logger });
 *   dispatcher.register('SET_ENV', handler);
 */
export function createSetEnvHandler(deps: SetEnvDeps) {
  const writeImpl = deps.writeImpl ?? writeEnvVars;
  const scheduleImpl = deps.scheduleImpl ?? setImmediate;
  const restartImpl =
    deps.restartImpl ??
    ((cb) => {
      execFile('sudo', ['/bin/systemctl', 'restart', 'scrumban-agent'], (err) => cb(err));
    });

  return (req: Request, res: Response): void => {
    const validation = validatePayload(req.body);
    if (!validation.ok) {
      deps.logger.warn(
        { stage: 'set-env', errorCode: validation.errorCode },
        'set-env payload invalido',
      );
      res.status(validation.status).json({
        accepted: false,
        errorCode: validation.errorCode,
        message: validation.message,
      });
      return;
    }

    const { vars, restartAfter, correlationId } = validation.payload;

    let result: WriteEnvVarsResult;
    try {
      result = writeImpl(vars, { path: deps.envFilePath });
    } catch (err) {
      if (err instanceof EnvWriterError) {
        const status = err.code === 'IO_ERROR' ? 500 : 422;
        deps.logger.error(
          { stage: 'set-env', errorCode: err.code, correlationId },
          `set-env writer falhou: ${err.message}`,
        );
        res.status(status).json({
          accepted: false,
          errorCode: err.code,
          message: err.message,
        });
        return;
      }
      // Erro inesperado: 500 sem expor stack.
      deps.logger.error(
        { stage: 'set-env', correlationId, err: (err as Error).message },
        'set-env erro inesperado no writer',
      );
      res.status(500).json({
        accepted: false,
        errorCode: 'INTERNAL_ERROR',
        message: 'erro interno ao gravar env file',
      });
      return;
    }

    // ACK síncrono ANTES de agendar o restart.
    // R1 do plan: se agendássemos o restart antes do `res.json`, o
    // processo morreria e o backend nunca veria o 200.
    deps.logger.info(
      {
        stage: 'set-env',
        varsWritten: result.varsWritten,
        createdNew: result.createdNew,
        restartScheduled: restartAfter,
        correlationId,
      },
      'set-env aplicado',
    );

    res.status(200).json({
      accepted: true,
      varsWritten: result.varsWritten,
      createdNew: result.createdNew,
      restartScheduled: restartAfter,
    });

    if (restartAfter) {
      scheduleImpl(() => {
        restartImpl((err) => {
          if (err) {
            deps.logger.error(
              { stage: 'set-env.restart', err: err.message, code: err.code },
              'systemctl restart falhou (verifique sudoers entry)',
            );
          } else {
            deps.logger.info({ stage: 'set-env.restart' }, 'restart agendado executado');
          }
        });
      });
    }
  };
}

/** Resultado da validação tipado (discriminator union). */
type ValidationResult =
  | { ok: true; payload: ValidatedPayload }
  | {
      ok: false;
      status: number;
      errorCode: 'INVALID_PAYLOAD' | 'EMPTY_PAYLOAD' | 'INVALID_VARS';
      message: string;
    };

/**
 * Valida o body do request. O writer ainda re-valida allowlist por chave
 * (DISALLOWED_KEY) — aqui rejeitamos apenas a forma genérica do payload.
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
  const vars = b.vars;
  if (typeof vars !== 'object' || vars === null || Array.isArray(vars)) {
    return {
      ok: false,
      status: 422,
      errorCode: 'INVALID_VARS',
      message: 'campo "vars" deve ser objeto { CHAVE: valor }',
    };
  }
  const keys = Object.keys(vars as Record<string, unknown>);
  if (keys.length === 0) {
    return {
      ok: false,
      status: 422,
      errorCode: 'EMPTY_PAYLOAD',
      message: 'objeto "vars" vazio (nenhuma chave para escrever)',
    };
  }
  // Cada valor deve ser string (writer re-valida, mas falha-rapido aqui).
  const varsTyped: Record<string, string> = {};
  for (const k of keys) {
    const v = (vars as Record<string, unknown>)[k];
    if (typeof v !== 'string') {
      return {
        ok: false,
        status: 422,
        errorCode: 'INVALID_VARS',
        message: `valor de "${k}" deve ser string`,
      };
    }
    varsTyped[k] = v;
  }
  const restartAfter = b.restartAfter === true;
  const correlationId =
    typeof b.metadata === 'object' &&
    b.metadata !== null &&
    typeof (b.metadata as Record<string, unknown>).correlationId === 'string'
      ? ((b.metadata as Record<string, unknown>).correlationId as string)
      : null;

  return {
    ok: true,
    payload: { vars: varsTyped, restartAfter, correlationId },
  };
}

// Re-export do tipo para uso pelos consumers.
export type { AllowedEnvKey };
