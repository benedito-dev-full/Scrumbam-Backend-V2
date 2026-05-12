import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTaskDto } from './update-task.dto';

/**
 * Specs do UpdateTaskDto focados na semântica de `priority` (V2 F4 — Task 01 / fix M1).
 *
 * Bug original: `@IsOptional()` só pula validação para `undefined`. Para `null`,
 * o `@IsEnum` era executado e falhava — bloqueando o caller no ValidationPipe
 * antes de chegar no service que aceita `null` (limpar idPriority).
 *
 * Fix: `@ValidateIf((o) => o.priority !== null)` faz `null` pular o `@IsEnum`,
 * permitindo que o service receba `null` e limpe `idPriority`.
 *
 * Estes testes simulam exatamente o que o `ValidationPipe` do NestJS faz:
 * `plainToInstance` (transform) + `validate` (class-validator).
 */
describe('UpdateTaskDto — priority validation (M1 fix)', () => {
  describe('priority field', () => {
    it('aceita priority=undefined (campo ausente)', async () => {
      const dto = plainToInstance(UpdateTaskDto, { nome: 'Sem priority' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.priority).toBeUndefined();
    });

    it('aceita priority=null (semântica de limpar idPriority)', async () => {
      const dto = plainToInstance(UpdateTaskDto, { priority: null });
      const errors = await validate(dto);
      // Núcleo do fix M1: null NÃO pode disparar @IsEnum
      expect(errors).toHaveLength(0);
      expect(dto.priority).toBeNull();
    });

    it.each(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])(
      'aceita priority="%s" (valor enum válido)',
      async (value) => {
        const dto = plainToInstance(UpdateTaskDto, { priority: value });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
        expect(dto.priority).toBe(value);
      },
    );

    it('rejeita priority com string inválida (ex: "INVALIDO")', async () => {
      const dto = plainToInstance(UpdateTaskDto, { priority: 'INVALIDO' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('priority');
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });

    it('rejeita priority com string vazia', async () => {
      const dto = plainToInstance(UpdateTaskDto, { priority: '' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('priority');
    });
  });
});
