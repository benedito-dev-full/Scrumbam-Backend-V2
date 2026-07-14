import { toGeminiSchema } from '../gemini-schema.util';

/**
 * Regressão do 400 do Gemini no Nexus (incidente 14/07/2026).
 *
 * Depois da unificação Nexus⇄MCP (ADR-V2-079), o Nexus passou a receber os
 * schemas das tools MCP — JSON Schema completo. O `GeminiProvider` fazia
 * `as unknown as FunctionDeclarationSchema` (cast, não conversão) e o Gemini
 * respondia 400 com, literalmente:
 *
 *   Unknown name "additionalProperties" ... Cannot find field.
 *   Unknown name "uniqueItems"          ... Cannot find field.
 *   Unknown name "type"                 ... Proto field is not repeating,
 *                                            cannot start list.
 *
 * Os casos abaixo usam os schemas REAIS que quebraram (update_task, create_task,
 * get_project, execute_task), não fixtures inventadas.
 */
describe('toGeminiSchema — JSON Schema → subconjunto do Gemini', () => {
  /** Varre o schema convertido procurando qualquer palavra que o Gemini rejeita. */
  function palavrasProibidas(schema: unknown, caminho = '$'): string[] {
    if (!schema || typeof schema !== 'object') return [];
    const achados: string[] = [];
    const obj = schema as Record<string, unknown>;

    for (const [k, v] of Object.entries(obj)) {
      if (['additionalProperties', 'uniqueItems', 'minLength', 'pattern', '$schema'].includes(k)) {
        achados.push(`${caminho}.${k}`);
      }
      if (k === 'type' && Array.isArray(v)) {
        achados.push(`${caminho}.type (array — "cannot start list")`);
      }
      if (v && typeof v === 'object') {
        achados.push(...palavrasProibidas(v, `${caminho}.${k}`));
      }
    }
    return achados;
  }

  it('type: ["string","null"] vira type: "string" + nullable (update_task)', () => {
    const r = toGeminiSchema({
      type: 'object',
      properties: {
        assigneeId: { type: ['string', 'null'], description: 'ID do assignee' },
        dueDate: { type: ['string', 'null'] },
      },
    });

    expect(r.properties?.assigneeId).toEqual({
      type: 'string',
      nullable: true,
      description: 'ID do assignee',
    });
    expect(r.properties?.dueDate).toEqual({ type: 'string', nullable: true });
  });

  it('remove additionalProperties (create_task.fields / execute_task)', () => {
    const r = toGeminiSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        fields: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
        },
      },
    });

    expect(r).not.toHaveProperty('additionalProperties');
    expect(r.properties?.fields).not.toHaveProperty('additionalProperties');
    expect(r.properties?.fields?.type).toBe('object');
  });

  it('remove uniqueItems (get_project)', () => {
    const r = toGeminiSchema({
      type: 'object',
      properties: {
        include: { type: 'array', uniqueItems: true, items: { type: 'string' } },
      },
    });

    expect(r.properties?.include).not.toHaveProperty('uniqueItems');
    expect(r.properties?.include?.items).toEqual({ type: 'string' });
  });

  it('preserva o que o Gemini ENTENDE (enum, required, description, items)', () => {
    const r = toGeminiSchema({
      type: 'object',
      description: 'Atualiza status',
      required: ['taskId', 'statusCode'],
      properties: {
        taskId: { type: 'string', description: 'ID da task' },
        statusCode: { type: 'string', enum: ['INBOX', 'READY', 'DONE'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });

    expect(r.type).toBe('object');
    expect(r.description).toBe('Atualiza status');
    expect(r.required).toEqual(['taskId', 'statusCode']);
    expect(r.properties?.statusCode?.enum).toEqual(['INBOX', 'READY', 'DONE']);
    expect(r.properties?.tags?.items?.type).toBe('string');
  });

  it('O TESTE-GUARDA: schema realista do MCP sai SEM nenhuma palavra proibida', () => {
    // Reproduz a forma de update_task, que aparecia no erro como
    // function_declarations[17] — o pior ofensor (4 type-arrays + additionalProperties).
    const updateTask = {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
        name: { type: 'string', maxLength: 512 },
        description: { type: 'string', maxLength: 10000 },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        assigneeId: { type: ['string', 'null'] },
        dueDate: { type: ['string', 'null'] },
        idPai: { type: ['string', 'null'] },
        idBloco: { type: ['string', 'null'] },
        fields: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
        },
        include: { type: 'array', uniqueItems: true, items: { type: 'string' } },
      },
    };

    const antes = palavrasProibidas(updateTask);
    expect(antes.length).toBeGreaterThan(0); // confirma que o schema CRU quebraria

    const depois = palavrasProibidas(toGeminiSchema(updateTask));
    expect(depois).toEqual([]); // e que o convertido está limpo
  });

  it('não explode com entrada inválida (null, string, array)', () => {
    expect(toGeminiSchema(null)).toEqual({});
    expect(toGeminiSchema('nada')).toEqual({});
    expect(toGeminiSchema([1, 2])).toEqual({});
  });
});
