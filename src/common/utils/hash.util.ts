import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Gera hash SHA-256 de uma string.
 *
 * Útil para hashing determinístico (IDs externos, tokens de idempotência, chaves de API).
 * NÃO usar para senhas — usar `hashBcrypt` para senhas.
 *
 * @param input - String a ser hasheada
 * @returns Hash SHA-256 em hexadecimal (64 caracteres)
 *
 * @example
 * ```typescript
 * const hash = hashSha256('meu-token-secreto');
 * // 'a1b2c3d4...' (64 chars hex)
 *
 * // Uso típico: hash de API key para comparação segura
 * const hashedKey = hashSha256(apiKeyFromRequest);
 * const storedKey = await prisma.dTabela.findFirst({ where: { codigo: hashedKey } });
 * ```
 */
export function hashSha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Gera hash bcrypt de uma string (assíncrono).
 *
 * Usar SEMPRE para senhas e tokens sensíveis.
 * O custo (rounds) controla o tempo de hashing — 10 é adequado para prod,
 * usar 4-6 em testes para velocidade.
 *
 * @param input - String a ser hasheada (senha, token)
 * @param rounds - Número de rounds bcrypt (default: 10; testes: 4)
 * @returns Promise com hash bcrypt (60 chars)
 *
 * @throws {Error} Se o input for vazio ou rounds inválido
 *
 * @example
 * ```typescript
 * // Registrar usuário
 * const hashed = await hashBcrypt(dto.password, 10);
 * await prisma.dUserGroup.create({ data: { senha: hashed, ... } });
 * ```
 */
export async function hashBcrypt(input: string, rounds: number = 10): Promise<string> {
  return bcrypt.hash(input, rounds);
}

/**
 * Compara uma string com um hash bcrypt.
 *
 * Seguro contra timing attacks (bcrypt interno usa comparação de tempo constante).
 *
 * @param plain - String em texto plano (senha do usuário no login)
 * @param hash - Hash bcrypt armazenado no banco
 * @returns Promise com `true` se corresponderem, `false` caso contrário
 *
 * @example
 * ```typescript
 * // Login
 * const user = await prisma.dUserGroup.findFirst({ where: { usuario: dto.email } });
 * const valid = await compareBcrypt(dto.password, user.senha);
 * if (!valid) throw new UnauthorizedException('Credenciais inválidas');
 * ```
 */
export async function compareBcrypt(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
