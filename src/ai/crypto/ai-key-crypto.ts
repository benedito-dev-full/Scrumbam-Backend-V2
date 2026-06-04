import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { InternalServerErrorException, Logger } from '@nestjs/common';

/**
 * Criptografia at-rest das chaves de IA (R-2, ADR-V2-064).
 *
 * Esquema AES-256-GCM (cifra autenticada — detecta adulteracao via authTag).
 * Cada chave de provedor gravada em `DTabela -481/-482/-483` passa por
 * {@link encrypt} antes de tocar o banco; a leitura no resolver usa
 * {@link tryDecrypt}, que decifra o formato novo e devolve o legado como-esta
 * (permitindo auto-migracao transparente).
 *
 * **Formato de armazenamento (auto-descritivo):**
 * ```
 * enc:v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 * ```
 * - `enc:v1:` — prefixo de versao + marcador que DISTINGUE de plaintext legado.
 * - `iv` — 12 bytes aleatorios por operacao (recomendado para GCM).
 * - `authTag` — 16 bytes, verificada no decrypt (lanca se adulterado).
 * - `ciphertext` — texto cifrado.
 *
 * **Chave-mestra:** vem de `process.env.AI_KEYS_ENCRYPTION_KEY`. Formato
 * canonico = hex de 64 chars (32 bytes / 256 bits). Se nao for esse formato,
 * deriva 32 bytes via `sha256` da string crua (com `warn`). Ausente quando
 * a criptografia e necessaria → erro CLARO (nunca cifra com chave fixa
 * insegura).
 *
 * **Seguranca:** NUNCA loga a chave de IA nem a chave-mestra.
 *
 * @see AiKeysService — ponto de ESCRITA (cifra antes de gravar).
 * @see AiKeyResolverService — ponto de LEITURA + auto-migracao.
 * @see ADR-V2-064 — multi-provider, cascata, encrypt-at-rest.
 */

/** Prefixo versionado do formato cifrado. Tambem marca "nao-legado". */
const ENC_PREFIX = 'enc:v1:';

/** Algoritmo de cifra autenticada. */
const ALGORITHM = 'aes-256-gcm';

/** Tamanho do IV (nonce) em bytes — 12 e o recomendado para GCM. */
const IV_LEN = 12;

/** Tamanho da authTag do GCM em bytes. */
const AUTH_TAG_LEN = 16;

/** Tamanho da chave AES-256 em bytes. */
const KEY_LEN = 32;

/** Nome da env var da chave-mestra. */
const MASTER_KEY_ENV = 'AI_KEYS_ENCRYPTION_KEY';

const logger = new Logger('AiKeyCrypto');

/**
 * Resolve e valida a chave-mestra de 32 bytes a partir da env.
 *
 * Aceita hex de 64 chars (formato canonico, 32 bytes). Qualquer outra string
 * nao-vazia e derivada para 32 bytes via `sha256` (emite `warn` — formato
 * fora do canonico). Ausente/vazia → erro claro.
 *
 * @returns Buffer de 32 bytes (256 bits) pronto para AES-256.
 * @throws {InternalServerErrorException} Quando a env esta ausente/vazia.
 */
function getMasterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV];
  if (!raw || raw.trim().length === 0) {
    // Mensagem amigavel; NUNCA detalha valor sensivel.
    logger.error(
      `ai_key_crypto_master_key_missing env=${MASTER_KEY_ENV} — ` +
        'criptografia de chave de IA exige a chave-mestra configurada',
    );
    throw new InternalServerErrorException(
      'Criptografia de IA nao configurada. Contate o administrador.',
    );
  }

  const value = raw.trim();

  // Formato canonico: hex de 64 chars (32 bytes).
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  // Fallback robusto: deriva 32 bytes via sha256 da string crua.
  logger.warn(
    `ai_key_crypto_master_key_non_canonical env=${MASTER_KEY_ENV} — ` +
      'esperado hex de 64 chars (32 bytes); derivando via sha256 ' +
      `(gere com "openssl rand -hex 32")`,
  );
  return createHash('sha256').update(value).digest().subarray(0, KEY_LEN);
}

/**
 * Indica se um valor armazenado esta no formato cifrado (`enc:v1:`).
 *
 * Usado pela auto-migracao: `false` => plaintext legado (re-gravar cifrado).
 *
 * @param stored - Valor lido de `dados.plaintext`.
 * @returns `true` se cifrado pelo esquema v1; `false` se legado/plaintext.
 */
export function isEncrypted(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(ENC_PREFIX);
}

/**
 * Cifra um plaintext em AES-256-GCM, devolvendo a string auto-descritiva.
 *
 * IV aleatorio (12 bytes) por chamada — duas cifragens da mesma entrada
 * produzem saidas diferentes. A authTag e embutida para deteccao de
 * adulteracao no {@link decrypt}.
 *
 * @param plaintext - Texto a cifrar (a chave de IA crua).
 * @returns String no formato `enc:v1:<iv>:<authTag>:<ciphertext>` (base64).
 * @throws {InternalServerErrorException} Chave-mestra ausente (via getMasterKey).
 *
 * @example
 * ```typescript
 * const stored = encrypt('sk-ant-abc123');
 * // 'enc:v1:9f...:7a...:c2...'
 * ```
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    'enc',
    'v1',
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decifra uma string no formato `enc:v1:...`, verificando a authTag.
 *
 * @param stored - Valor cifrado produzido por {@link encrypt}.
 * @returns O plaintext original.
 * @throws {Error} Quando o formato e invalido OU a authTag nao confere
 *   (conteudo adulterado / chave-mestra trocada).
 * @throws {InternalServerErrorException} Chave-mestra ausente.
 *
 * @example
 * ```typescript
 * const plain = decrypt('enc:v1:9f...:7a...:c2...'); // 'sk-ant-abc123'
 * ```
 */
export function decrypt(stored: string): string {
  if (!isEncrypted(stored)) {
    throw new Error('ai_key_crypto_decrypt_invalid_format');
  }
  // enc : v1 : iv : authTag : ciphertext  (ciphertext pode conter ':' do base64? nao)
  const parts = stored.split(':');
  if (parts.length !== 5) {
    throw new Error('ai_key_crypto_decrypt_malformed');
  }
  const [, , ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');

  if (iv.length !== IV_LEN || authTag.length !== AUTH_TAG_LEN) {
    throw new Error('ai_key_crypto_decrypt_bad_params');
  }

  const key = getMasterKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // final() LANCA se a authTag nao conferir (adulteracao detectada).
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Leitura tolerante: decifra se cifrado, devolve como-esta se plaintext legado.
 *
 * Centraliza o ponto de leitura do resolver durante a janela de auto-migracao
 * (registros antigos em plaintext convivem com novos cifrados).
 *
 * @param stored - Valor lido de `dados.plaintext` (cifrado OU legado).
 * @returns O plaintext real, pronto para uso.
 * @throws {Error} Se cifrado porem adulterado (propaga do {@link decrypt}).
 *
 * @example
 * ```typescript
 * tryDecrypt('enc:v1:...');   // decifra
 * tryDecrypt('sk-ant-legacy'); // passa-through (legado)
 * ```
 */
export function tryDecrypt(stored: string): string {
  return isEncrypted(stored) ? decrypt(stored) : stored;
}
