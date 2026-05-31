import { BadRequestException } from '@nestjs/common';
import { TableFieldsDto } from './column-def.dto';

/**
 * Tipos de coluna que exigem um conjunto de opções não-vazio (Fase 3).
 *
 * `status` e `dropdown` só fazem sentido com ao menos uma opção disponível
 * para seleção — a tabela de validação do §5 do plano define ambos como
 * `valor ∈ config.options[].id`, o que pressupõe opções existentes.
 */
const TYPES_REQUIRING_OPTIONS: ReadonlySet<string> = new Set([
  'status',
  'dropdown',
]);

/**
 * Valida unicidade e coerência do schema de colunas customizáveis
 * (`DProject.tableFields`) antes de persistir (Fase 3 do plano
 * `plan-tasks-colunas-customizaveis-8-tipos-task1.md`).
 *
 * Função PURA — não acessa banco nem tem efeitos colaterais — totalmente
 * testável de forma isolada. A validação estrutural de cada coluna (tipos,
 * formato de `key`, faixas numéricas) já é feita pelos DTOs da Fase 2 via
 * `class-validator`; esta função cobre apenas as regras que só fazem sentido
 * analisando o conjunto de colunas como um todo (deixadas explicitamente para
 * a Fase 3 nos JSDoc dos DTOs).
 *
 * Regras aplicadas (todas lançam {@link BadRequestException} em violação):
 * 1. `key` única entre todas as colunas.
 * 2. `order` único entre todas as colunas.
 * 3. `options[].id` único DENTRO de cada coluna `status`/`dropdown`
 *    (ids iguais em colunas diferentes são permitidos).
 * 4. Colunas `status`/`dropdown` exigem ao menos uma opção.
 *
 * NÃO valida o `version` do envelope: nesta fase o `version` é apenas
 * persistido. Concorrência otimista (lost-update) é tratada em fase futura
 * (decisão #4 do handoff). Também NÃO valida valores de célula
 * (`DTask.dados.fields`) — isso é a Fase 4.
 *
 * @param dto Envelope versionado do schema de colunas a validar.
 * @throws {BadRequestException} Em qualquer violação de unicidade/coerência.
 *
 * @example
 * ```typescript
 * validateTableFields({
 *   version: 1,
 *   columns: [
 *     { key: 'f_nome', type: 'text', label: 'Nome', order: 0 },
 *     {
 *       key: 'f_status', type: 'status', label: 'Status', order: 1,
 *       config: { options: [{ id: 'todo', label: 'A fazer' }] },
 *     },
 *   ],
 * }); // não lança
 * ```
 */
export function validateTableFields(dto: TableFieldsDto): void {
  const columns = dto.columns ?? [];

  const seenKeys = new Set<string>();
  const seenOrders = new Set<number>();

  for (const col of columns) {
    // Regra 1: key única entre as colunas.
    if (seenKeys.has(col.key)) {
      throw new BadRequestException(
        `Coluna duplicada: key "${col.key}" aparece mais de uma vez`,
      );
    }
    seenKeys.add(col.key);

    // Regra 2: order único entre as colunas.
    if (seenOrders.has(col.order)) {
      throw new BadRequestException(
        `Ordem duplicada: order ${col.order} aparece em múltiplas colunas`,
      );
    }
    seenOrders.add(col.order);

    const isOptionType = TYPES_REQUIRING_OPTIONS.has(col.type);
    const options = col.config?.options ?? [];

    // Regra 4: status/dropdown exigem ao menos uma opção.
    if (isOptionType && options.length === 0) {
      throw new BadRequestException(
        `Coluna "${col.key}" do tipo ${col.type} exige ao menos uma opção`,
      );
    }

    // Regra 3: options[].id único dentro da coluna.
    if (options.length > 0) {
      const seenOptionIds = new Set<string>();
      for (const opt of options) {
        if (seenOptionIds.has(opt.id)) {
          throw new BadRequestException(
            `Opção duplicada na coluna "${col.key}": id "${opt.id}"`,
          );
        }
        seenOptionIds.add(opt.id);
      }
    }
  }
}
