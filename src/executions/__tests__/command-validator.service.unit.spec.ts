import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CommandValidatorService } from '../services/command-validator.service';

describe('CommandValidatorService', () => {
  let service: CommandValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommandValidatorService],
    }).compile();

    service = module.get<CommandValidatorService>(CommandValidatorService);
  });

  describe('validate - executable allowlist', () => {
    it('deve permitir executables na allowlist', () => {
      const allowedCommands = [
        { executable: 'ls', args: [] },
        { executable: 'grep', args: ['test', 'README.md'] },
        { executable: 'git', args: ['status'] },
        { executable: 'npm', args: ['test'] },
        { executable: 'npx', args: ['prisma', 'generate'] },
        { executable: 'claude', args: ['--print', 'corrija o bug de tipagem'] },
        { executable: 'node', args: ['--version'] },
      ];

      for (const command of allowedCommands) {
        expect(() =>
          service.validate(command),
        ).not.toThrow();
      }
    });

    it('deve rejeitar executable fora da allowlist', () => {
      expect(() =>
        service.validate({ executable: 'rm', args: ['-rf', '/'] }),
      ).toThrow(BadRequestException);

      expect(() =>
        service.validate({ executable: 'curl', args: ['https://evil.com'] }),
      ).toThrow(BadRequestException);

      expect(() =>
        service.validate({ executable: 'sh', args: ['-c', 'echo test'] }),
      ).toThrow(BadRequestException);
    });
  });

  describe('validate - args denylist', () => {
    it('deve rejeitar args com metacaracteres perigosos', () => {
      const dangerousArgs = [
        ['test', '|', 'grep'],
        ['test', '&&', 'echo'],
        ['test', ';', 'ls'],
        ['test', '`whoami`'],
        ['test', '$(whoami)'],
        ['test', '<', 'input.txt'],
        ['test', '>', 'output.txt'],
      ];

      for (const args of dangerousArgs) {
        expect(() =>
          service.validate({ executable: 'ls', args }),
        ).toThrow(BadRequestException);
      }
    });

    it('deve permitir args seguros', () => {
      const safeArgs = [
        ['--help'],
        ['-la'],
        ['src/'],
        ['test.ts'],
        ['--config=jest.config.js'],
      ];

      for (const args of safeArgs) {
        expect(() =>
          service.validate({ executable: 'ls', args }),
        ).not.toThrow();
      }
    });
  });

  describe('validate - cwd path traversal', () => {
    it('deve rejeitar cwd com path traversal', () => {
      expect(() =>
        service.validate({ executable: 'ls', args: [], cwd: '../etc' }),
      ).toThrow(BadRequestException);

      expect(() =>
        service.validate({ executable: 'ls', args: [], cwd: 'src/../../root' }),
      ).toThrow(BadRequestException);
    });

    it('deve rejeitar cwd com paths de sistema', () => {
      const systemPaths = ['/etc', '/var', '/root', '/bin', '/sbin', '/usr/bin'];

      for (const cwd of systemPaths) {
        expect(() =>
          service.validate({ executable: 'ls', args: [], cwd }),
        ).toThrow(BadRequestException);
      }
    });

    it('deve permitir cwd relativo seguro', () => {
      const safePaths = ['src/', 'src/auth', '.', 'tests/unit'];

      for (const cwd of safePaths) {
        expect(() =>
          service.validate({ executable: 'ls', args: [], cwd }),
        ).not.toThrow();
      }
    });
  });

  describe('validate - env allowlist', () => {
    it('deve permitir env keys na allowlist', () => {
      const allowedEnv = {
        NODE_ENV: 'test',
        CI: 'true',
        FORCE_COLOR: '1',
      };

      expect(() =>
        service.validate({ executable: 'npm', args: ['test'], env: allowedEnv }),
      ).not.toThrow();
    });

    it('deve rejeitar env keys fora da allowlist', () => {
      const forbiddenEnv = {
        DATABASE_URL: 'postgres://localhost',
      };

      expect(() =>
        service.validate({ executable: 'npm', args: ['test'], env: forbiddenEnv }),
      ).toThrow(BadRequestException);
    });

    it('deve rejeitar env values com secrets aparentes', () => {
      const secretEnvs: Array<Record<string, string>> = [
        { NODE_ENV: 'my-secret-token-123' },
        { CI: 'api_key_12345' },
        { TERM: 'password123' },
        { LANG: 'aws_secret_key' },
      ];

      for (const env of secretEnvs) {
        expect(() =>
          service.validate({ executable: 'npm', args: ['test'], env }),
        ).toThrow(BadRequestException);
      }
    });
  });

  describe('validate - timeoutMs', () => {
    it('deve rejeitar timeoutMs fora dos limites', () => {
      expect(() =>
        service.validate({ executable: 'npm', args: ['test'], timeoutMs: 10000 }),
      ).toThrow(BadRequestException);

      expect(() =>
        service.validate({ executable: 'npm', args: ['test'], timeoutMs: 4000000 }),
      ).toThrow(BadRequestException);
    });

    it('deve permitir timeoutMs dentro dos limites', () => {
      expect(() =>
        service.validate({ executable: 'npm', args: ['test'], timeoutMs: 30000 }),
      ).not.toThrow();

      expect(() =>
        service.validate({ executable: 'npm', args: ['test'], timeoutMs: 600000 }),
      ).not.toThrow();

      expect(() =>
        service.validate({ executable: 'npm', args: ['test'], timeoutMs: 3600000 }),
      ).not.toThrow();
    });
  });

  describe('validateText - texto livre', () => {
    it('deve rejeitar texto com metacaracteres perigosos', () => {
      const dangerousTexts = [
        'ls | grep test',
        'npm test && echo done',
        'git status; rm -rf /',
        'echo `whoami`',
        'cat $(pwd)',
      ];

      for (const text of dangerousTexts) {
        expect(() => service.validateText(text)).toThrow(BadRequestException);
      }
    });

    it('deve rejeitar texto com redirecionamentos', () => {
      const redirects = [
        'ls > output.txt',
        'cat < input.txt',
        'echo test >> log.txt',
        'grep test << EOF',
      ];

      for (const text of redirects) {
        expect(() => service.validateText(text)).toThrow(BadRequestException);
      }
    });

    it('deve rejeitar texto muito longo', () => {
      const longText = 'a'.repeat(50001);
      expect(() => service.validateText(longText)).toThrow(BadRequestException);
    });

    it('deve permitir texto seguro', () => {
      const safeTexts = [
        'adicione testes unitários para o AuthService',
        'corrija o bug de tipagem no ProjectsController',
        'implemente o endpoint GET /api/v1/health',
      ];

      for (const text of safeTexts) {
        expect(() => service.validateText(text)).not.toThrow();
      }
    });
  });
});
