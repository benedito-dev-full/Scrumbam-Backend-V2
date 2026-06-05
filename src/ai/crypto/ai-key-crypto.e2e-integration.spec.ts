import { encrypt, decrypt, isEncrypted, tryDecrypt } from './ai-key-crypto';

/**
 * Smoke test de INTEGRACAO da criptografia at-rest (R-2 / ADR-V2-064).
 *
 * Exercita o caminho REAL de ponta a ponta SEM banco de dados nem chave de
 * IA real — substitui o E2E HTTP (inviavel no ambiente local: sem Postgres,
 * sem AI_KEYS_ENCRYPTION_KEY, sem chaves de provider). Prova que a CAMADA de
 * criptografia se comporta corretamente no fluxo completo:
 *
 *   ESCRITA  → encrypt(plaintext) produz `enc:v1:...` (nunca o cru)
 *   LEITURA  → tryDecrypt recupera o plaintext identico (round-trip)
 *   LEGADO   → valor plaintext antigo passa-through e é detectado p/ migrar
 *   MIGRACAO → o registro legado, ao ser re-gravado, vira `enc:v1:...`
 *   SEGURANCA→ adulteracao (authTag) é detectada e lança
 *
 * Determinístico: usa uma master key fixa de teste (hex 64 = 32 bytes).
 * NÃO cobre HTTP/guards/IA real — isso fica para o E2E em staging (com banco
 * e chaves reais), conforme plano de producao.
 */
describe('AI key crypto — smoke E2E de integração (R-2)', () => {
  // Master key de TESTE (openssl rand -hex 32). Nunca usar em producao.
  const TEST_MASTER_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const ORIGINAL_ENV = process.env.AI_KEYS_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.AI_KEYS_ENCRYPTION_KEY = TEST_MASTER_KEY;
  });

  afterAll(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.AI_KEYS_ENCRYPTION_KEY;
    else process.env.AI_KEYS_ENCRYPTION_KEY = ORIGINAL_ENV;
  });

  /**
   * Helpers que ESPELHAM a lógica real dos serviços (sem instanciar Prisma):
   *  - buildDadosOnWrite  ≈ AiKeysService.upsertKey (campo `plaintext` cifrado,
   *    prefix/hash do CRU)
   *  - readKey            ≈ AiKeyResolverService.tryReadFromDTabela (decifra)
   */
  const PREFIX_LEN = 8;
  function buildDadosOnWrite(rawKey: string) {
    return {
      plaintext: encrypt(rawKey), // cifrado — nunca o cru
      prefix: rawKey.slice(0, PREFIX_LEN), // do CRU
      length: rawKey.length, // do CRU
    };
  }
  function readKey(stored: string): string {
    return tryDecrypt(stored);
  }

  it('ESCRITA: persiste cifrado (enc:v1), nunca o plaintext cru', () => {
    const raw = 'sk-ant-api03-CHAVE-FAKE-DE-TESTE-1234567890';
    const dados = buildDadosOnWrite(raw);

    expect(dados.plaintext.startsWith('enc:v1:')).toBe(true);
    expect(dados.plaintext).not.toContain(raw); // o cru não aparece embutido
    expect(isEncrypted(dados.plaintext)).toBe(true);
    // prefix/length derivam do CRU (para máscara/duplicata), não do cifrado
    expect(dados.prefix).toBe('sk-ant-a');
    expect(dados.length).toBe(raw.length);
  });

  it('LEITURA: round-trip — o resolver recupera o plaintext idêntico', () => {
    const raw = 'AIzaSyFAKE-gemini-key-0987654321';
    const dados = buildDadosOnWrite(raw);

    const recovered = readKey(dados.plaintext);
    expect(recovered).toBe(raw);
  });

  it('LEGADO: valor plaintext antigo passa-through e é sinalizado p/ migração', () => {
    // Registro pré-criptografia: `plaintext` ainda é a chave crua.
    const legacyStored = 'sk-proj-LEGADO-openai-fake-1122334455';

    // Resolver consegue ler (passa-through) — compatibilidade retroativa.
    expect(readKey(legacyStored)).toBe(legacyStored);
    // E o resolver DETECTA que precisa migrar (não está cifrado).
    expect(isEncrypted(legacyStored)).toBe(false);
  });

  it('MIGRAÇÃO: registro legado, ao ser re-gravado, vira enc:v1 e ainda decifra', () => {
    const legacyStored = 'sk-proj-LEGADO-openai-fake-1122334455';

    // Passo de auto-migração (espelha migrateToEncrypted do resolver):
    const migrated = encrypt(readKey(legacyStored));

    expect(isEncrypted(migrated)).toBe(true);
    expect(migrated.startsWith('enc:v1:')).toBe(true);
    // Após migrado, a leitura continua devolvendo o original.
    expect(readKey(migrated)).toBe(legacyStored);
    // Idempotência: já cifrado NÃO é re-migrado.
    expect(isEncrypted(migrated)).toBe(true);
  });

  it('SEGURANÇA: adulteração da authTag é detectada e lança no decrypt', () => {
    const raw = 'sk-ant-fake-tamper-test';
    const stored = encrypt(raw);

    // Corrompe um byte do authTag (3º segmento do formato enc:v1:iv:tag:data).
    const parts = stored.split(':');
    const tag = Buffer.from(parts[3], 'base64');
    tag[0] = tag[0] ^ 0xff; // flip de bits
    parts[3] = tag.toString('base64');
    const tampered = parts.join(':');

    expect(() => decrypt(tampered)).toThrow();
  });

  it('SEGURANÇA: cada cifragem usa IV novo — mesmo plaintext gera saídas distintas', () => {
    const raw = 'AIzaSyFAKE-iv-uniqueness';
    const a = encrypt(raw);
    const b = encrypt(raw);

    expect(a).not.toBe(b); // IV aleatório por operação
    expect(decrypt(a)).toBe(raw);
    expect(decrypt(b)).toBe(raw); // ambos decifram para o mesmo original
  });
});
