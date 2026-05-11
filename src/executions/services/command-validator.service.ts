import { BadRequestException, Injectable, Logger } from '@nestjs/common';

export interface StructuredCommand {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Valida comandos estruturados antes do Engine.
 * Se rejeitar, nenhum DPedido deve ser criado.
 */
@Injectable()
export class CommandValidatorService {
  private readonly logger = new Logger(CommandValidatorService.name);

  private readonly ALLOWED_EXECUTABLES = new Set([
    'ls',
    'grep',
    'git',
    'npm',
    'npx',
    'claude',
    'node',
    'cat',
    'echo',
    'pwd',
    'find',
  ]);

  private readonly ALLOWED_GIT_FIRST_ARGS = new Set([
    'status',
    'diff',
    'log',
    'branch',
    'checkout',
    'add',
    'commit',
    'push',
  ]);

  private readonly ALLOWED_NPM_FIRST_ARGS = new Set(['test', 'run', 'install', 'ci']);
  private readonly DANGEROUS_CHARS = /[|&;`$()<>]/;
  private readonly SECRET_PATTERNS = [
    /token/i,
    /secret/i,
    /key/i,
    /password/i,
    /credential/i,
    /api[_-]?key/i,
    /access[_-]?key/i,
    /private[_-]?key/i,
    /aws[_-]?secret/i,
    /database[_-]?url/i,
  ];
  private readonly ALLOWED_ENV_KEYS = new Set([
    'NODE_ENV',
    'CI',
    'FORCE_COLOR',
    'NO_COLOR',
    'TERM',
    'LANG',
    'LC_ALL',
  ]);

  validate(command: StructuredCommand): void {
    if (!command || typeof command !== 'object') {
      throw new BadRequestException('command estruturado e obrigatorio');
    }

    if (!this.ALLOWED_EXECUTABLES.has(command.executable)) {
      this.logger.warn(`Executable rejeitado (fora da allowlist): ${command.executable}`);
      throw new BadRequestException(
        `Executable nao permitido: ${command.executable}. Permitidos: ${Array.from(this.ALLOWED_EXECUTABLES).join(', ')}`,
      );
    }

    if (!Array.isArray(command.args)) {
      throw new BadRequestException('command.args deve ser array de strings');
    }

    this.validateSubcommand(command.executable, command.args);

    for (const arg of command.args) {
      if (typeof arg !== 'string') {
        throw new BadRequestException('Todos os args devem ser strings');
      }

      if (this.DANGEROUS_CHARS.test(arg)) {
        this.logger.warn('Arg rejeitado por metacaractere perigoso');
        throw new BadRequestException('Argumento contem metacaractere perigoso');
      }
    }

    if (command.cwd) {
      if (command.cwd.includes('..')) {
        this.logger.warn(`cwd rejeitado por path traversal`);
        throw new BadRequestException('cwd contem path traversal (..)');
      }

      if (
        /^[a-zA-Z]:[\\/]/.test(command.cwd) ||
        command.cwd.startsWith('/') ||
        /^\\/.test(command.cwd)
      ) {
        this.logger.warn(`cwd rejeitado por path absoluto`);
        throw new BadRequestException('cwd deve ser relativo ao workspace');
      }
    }

    if (command.env) {
      for (const [key, value] of Object.entries(command.env)) {
        if (!this.ALLOWED_ENV_KEYS.has(key)) {
          this.logger.warn(`Env key rejeitada (fora da allowlist): ${key}`);
          throw new BadRequestException(
            `Env key nao permitida: ${key}. Permitidas: ${Array.from(this.ALLOWED_ENV_KEYS).join(', ')}`,
          );
        }

        for (const pattern of this.SECRET_PATTERNS) {
          if (pattern.test(value)) {
            this.logger.warn(`Env value rejeitado por secret aparente: ${key}`);
            throw new BadRequestException(`Env value para ${key} contem padrao de secret aparente`);
          }
        }
      }
    }

    if (command.timeoutMs !== undefined && (command.timeoutMs < 30000 || command.timeoutMs > 3600000)) {
      this.logger.warn(`timeoutMs rejeitado (fora dos limites): ${command.timeoutMs}`);
      throw new BadRequestException('timeoutMs deve estar entre 30000ms e 3600000ms');
    }

    this.logger.debug(`Comando estruturado validado: ${command.executable}`);
  }

  validateText(text: string): void {
    if (this.DANGEROUS_CHARS.test(text)) {
      this.logger.warn('Comando texto rejeitado por metacaractere perigoso');
      throw new BadRequestException('Comando contem metacaractere perigoso');
    }

    if (/>>|<<|>|</.test(text)) {
      this.logger.warn('Comando texto rejeitado por redirecionamento');
      throw new BadRequestException('Comando contem redirecionamento');
    }

    if (text.length > 50000) {
      this.logger.warn(`Comando texto rejeitado por tamanho: ${text.length}`);
      throw new BadRequestException(`Comando muito longo: ${text.length} caracteres`);
    }

    this.logger.debug('Comando texto validado');
  }

  private validateSubcommand(executable: string, args: string[]): void {
    const firstArg = args[0];

    if (executable === 'git') {
      if (!firstArg || !this.ALLOWED_GIT_FIRST_ARGS.has(firstArg)) {
        throw new BadRequestException('Subcomando git nao permitido');
      }

      if (firstArg === 'branch' && args[1] !== '--show-current') {
        throw new BadRequestException('git branch permite apenas --show-current');
      }

      if (firstArg === 'checkout' && (args[1] !== '-b' || !args[2]?.startsWith('scrumban/exec-'))) {
        throw new BadRequestException('git checkout permitido apenas para branch scrumban/exec-*');
      }

      if (firstArg === 'push' && (args[1] !== 'origin' || !args[2]?.startsWith('scrumban/exec-'))) {
        throw new BadRequestException('git push permitido apenas para origin scrumban/exec-*');
      }
    }

    if (executable === 'npm') {
      if (!firstArg || !this.ALLOWED_NPM_FIRST_ARGS.has(firstArg)) {
        throw new BadRequestException('Subcomando npm nao permitido');
      }

      if (firstArg === 'run' && !['test', 'lint', 'build'].includes(args[1])) {
        throw new BadRequestException('npm run permite apenas test, lint ou build');
      }
    }

    if (executable === 'npx' && (firstArg !== 'prisma' || args[1] !== 'generate')) {
      throw new BadRequestException('npx permite apenas prisma generate neste bloco');
    }

    if (executable === 'claude' && args.some((arg) => ['-i', '--interactive'].includes(arg))) {
      throw new BadRequestException('claude interativo nao e permitido');
    }
  }
}
