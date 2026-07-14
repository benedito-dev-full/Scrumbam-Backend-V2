/**
 * Tradutor de JSON Schema → o subconjunto que o Gemini aceita.
 *
 * ## O problema
 *
 * As tools do Nexus vêm da camada única de Capabilities (ADR-V2-079), que é
 * compartilhada com o servidor MCP. Os schemas MCP são **JSON Schema completo**:
 * usam `type: ['string', 'null']` para campos anuláveis, `additionalProperties`
 * para mapas abertos e `uniqueItems` em arrays.
 *
 * Claude e OpenAI aceitam JSON Schema. **O Gemini não.** Ele valida as
 * `functionDeclarations` contra um Protobuf derivado do OpenAPI 3.0, e qualquer
 * palavra-chave fora desse subconjunto vira **400 Bad Request**:
 *
 * ```
 * Unknown name "additionalProperties" ... : Cannot find field.
 * Unknown name "uniqueItems" ...          : Cannot find field.
 * Unknown name "type" ...                 : Proto field is not repeating,
 *                                           cannot start list.   ← type: [a, b]
 * ```
 *
 * O `GeminiProvider` fazia `tool.parameters as unknown as FunctionDeclarationSchema`
 * — um cast que silencia o compilador sem converter nada. O bug só aparecia em
 * runtime, e só no Gemini.
 *
 * ## A tradução
 *
 * | JSON Schema                        | Gemini                              |
 * |------------------------------------|-------------------------------------|
 * | `type: ['string', 'null']`         | `type: 'string'` + `nullable: true` |
 * | `additionalProperties: {...}`      | removido (mapa aberto não existe)   |
 * | `uniqueItems`, `$schema`, `const`… | removidos                           |
 * | `properties` / `items`             | traduzidos recursivamente           |
 *
 * Campos que o Gemini entende (`type`, `description`, `enum`, `properties`,
 * `required`, `items`, `format`, `nullable`) passam intactos.
 *
 * @see https://ai.google.dev/api/caching#Schema — o subconjunto suportado
 */

/** Palavras-chave de JSON Schema que o Gemini rejeita com 400. */
const UNSUPPORTED_KEYWORDS = new Set([
  'additionalProperties',
  'uniqueItems',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'default',
  'const',
  'examples',
  'exclusiveMinimum',
  'exclusiveMaximum',
  '$schema',
  '$id',
  '$ref',
  'definitions',
  '$defs',
]);

/** Tipos primitivos aceitos pelo Gemini (o `null` vira a flag `nullable`). */
type GeminiType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

interface GeminiSchema {
  type?: GeminiType;
  nullable?: boolean;
  description?: string;
  enum?: string[];
  format?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
}

/**
 * Normaliza o campo `type`, que em JSON Schema pode ser um array.
 *
 * `['string', 'null']` é a forma canônica de "string anulável" — o Gemini não
 * aceita a lista e exige a flag `nullable`. Quando o array traz vários tipos
 * concretos (`['string', 'number', 'boolean']`), não há como representar a união:
 * escolhemos o primeiro tipo não-nulo, que é a leitura mais conservadora e
 * mantém a tool utilizável em vez de derrubar a chamada inteira.
 */
function normalizeType(raw: unknown): { type?: GeminiType; nullable?: boolean } {
  if (typeof raw === 'string') {
    return raw === 'null' ? { nullable: true } : { type: raw as GeminiType };
  }

  if (Array.isArray(raw)) {
    const nullable = raw.includes('null');
    const concreto = raw.find((t) => t !== 'null');
    return {
      ...(typeof concreto === 'string' ? { type: concreto as GeminiType } : {}),
      ...(nullable ? { nullable: true } : {}),
    };
  }

  return {};
}

/**
 * Converte um JSON Schema em um schema que o Gemini aceita.
 *
 * Recursivo: desce em `properties` e `items`. Palavras-chave não suportadas são
 * **descartadas** (não substituídas) — a tool perde a validação fina, mas passa
 * a funcionar. Perder `minLength` é aceitável; perder a tool inteira não.
 *
 * @param schema - JSON Schema de entrada (`inputSchema` de uma Capability/tool MCP).
 * @returns Schema equivalente no subconjunto do Gemini.
 *
 * @example
 * ```typescript
 * toGeminiSchema({
 *   type: 'object',
 *   properties: {
 *     assigneeId: { type: ['string', 'null'], description: 'Responsável' },
 *     fields: { type: 'object', additionalProperties: { type: 'string' } },
 *   },
 * });
 * // → {
 * //     type: 'object',
 * //     properties: {
 * //       assigneeId: { type: 'string', nullable: true, description: 'Responsável' },
 * //       fields: { type: 'object' },          // additionalProperties removido
 * //     },
 * //   }
 * ```
 */
export function toGeminiSchema(schema: unknown): GeminiSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return {};
  }

  const src = schema as Record<string, unknown>;
  const out: GeminiSchema = {};

  // `type` pode ser string OU array (['string','null']) — normaliza para os
  // campos `type` + `nullable` que o Gemini entende.
  Object.assign(out, normalizeType(src.type));

  if (typeof src.description === 'string') out.description = src.description;
  if (typeof src.format === 'string') out.format = src.format;
  if (typeof src.nullable === 'boolean') out.nullable = src.nullable;

  if (Array.isArray(src.enum)) {
    out.enum = src.enum.filter((v): v is string => typeof v === 'string');
  }

  if (Array.isArray(src.required)) {
    out.required = src.required.filter((v): v is string => typeof v === 'string');
  }

  if (src.properties && typeof src.properties === 'object') {
    const props: Record<string, GeminiSchema> = {};
    for (const [nome, sub] of Object.entries(src.properties as Record<string, unknown>)) {
      props[nome] = toGeminiSchema(sub);
    }
    out.properties = props;
  }

  if (src.items) {
    out.items = toGeminiSchema(src.items);
  }

  // Tudo que não foi copiado acima é descartado — incluindo o conjunto
  // UNSUPPORTED_KEYWORDS, que é o que fazia o Gemini responder 400. A constante
  // existe para documentar (e testar) o que sabidamente quebra.
  void UNSUPPORTED_KEYWORDS;

  return out;
}
