import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExecuteCommandDto } from '../execute-command.dto';

/**
 * Unit tests do contrato cross-field do ExecuteCommandDto (ADR-V2-049).
 *
 * Garante:
 *  - Modo PROMPT (só taskId): válido.
 *  - Modo COMMAND (só command): válido (regressão F13).
 *  - Modo HÍBRIDO (ambos): válido (debug).
 *  - Nenhum dos dois: 400 (cross-field validation).
 */
describe('ExecuteCommandDto cross-field validation', () => {
  it('aceita modo PROMPT (apenas taskId)', async () => {
    const dto = plainToInstance(ExecuteCommandDto, { taskId: '42' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('aceita modo COMMAND (apenas command estruturado)', async () => {
    const dto = plainToInstance(ExecuteCommandDto, {
      command: {
        executable: 'npm',
        args: ['test'],
        timeoutMs: 60000,
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('aceita modo HÍBRIDO (taskId + command)', async () => {
    const dto = plainToInstance(ExecuteCommandDto, {
      taskId: '42',
      command: {
        executable: 'claude',
        args: ['-p', 'override manual'],
        timeoutMs: 600000,
      },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejeita quando nenhum dos dois (taskId nem command) presente', async () => {
    const dto = plainToInstance(ExecuteCommandDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);

    // A mensagem de erro deve mencionar pelo menos um dos modos
    const flat = JSON.stringify(errors);
    expect(flat).toMatch(/taskId|command/);
  });

  it('rejeita quando taskId é string vazia (ausência de command)', async () => {
    const dto = plainToInstance(ExecuteCommandDto, { taskId: '' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('aceita modo PROMPT com agentId e rollbackOnFailure opcionais', async () => {
    const dto = plainToInstance(ExecuteCommandDto, {
      taskId: '42',
      agentId: '456',
      rollbackOnFailure: true,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejeita command com structure inválida (sem executable)', async () => {
    const dto = plainToInstance(ExecuteCommandDto, {
      command: {
        args: ['test'],
        // executable ausente
      },
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  /**
   * Reviewer fix R2 (review-2026-05-26-prompt-builder.md):
   *
   * Sem `@Matches(/^\d+$/)` no taskId, payload `{ taskId: "abc" }` chega
   * intacto até `BigInt("abc")` no service e lança `SyntaxError` não-tratado
   * → HTTP 500. Com a validação, vira 400 BadRequest limpo no ValidationPipe.
   */
  it('aceita taskId numérico simples (fix R2)', async () => {
    const dto = plainToInstance(ExecuteCommandDto, { taskId: '39' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('aceita taskId numérico grande (BigInt boundary)', async () => {
    const dto = plainToInstance(ExecuteCommandDto, { taskId: '9007199254740993' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejeita taskId não-numérico (string aleatória) — fix R2', async () => {
    const dto = plainToInstance(ExecuteCommandDto, { taskId: 'abc' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const flat = JSON.stringify(errors);
    expect(flat).toMatch(/taskId.*numérico|matches/i);
  });

  it('rejeita taskId com hífen / negativo — fix R2', async () => {
    const dto = plainToInstance(ExecuteCommandDto, { taskId: '-39' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejeita taskId com caracteres especiais — fix R2', async () => {
    const dto = plainToInstance(ExecuteCommandDto, { taskId: "39'; DROP TABLE--" });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
