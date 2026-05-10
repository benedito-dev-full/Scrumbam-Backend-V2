import { Test, TestingModule } from '@nestjs/testing';
import { StartHandler } from '../start.handler';
import { CommandRegistryService } from '../../../core/command-registry.service';

describe('StartHandler', () => {
  let handler: StartHandler;
  let commandRegistry: jest.Mocked<CommandRegistryService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StartHandler,
        {
          provide: CommandRegistryService,
          useValue: { register: jest.fn() },
        },
      ],
    }).compile();

    handler = module.get(StartHandler);
    commandRegistry = module.get(CommandRegistryService);
  });

  it('deve instanciar corretamente', () => {
    expect(handler).toBeDefined();
  });

  it('deve ter commandName = "start"', () => {
    expect(handler.commandName).toBe('start');
  });

  it('deve se registrar no CommandRegistryService em onModuleInit', () => {
    handler.onModuleInit();
    expect(commandRegistry.register).toHaveBeenCalledWith(handler);
  });

  it('deve retornar mensagem de boas-vindas com instruções', async () => {
    const reply = await handler.handle(BigInt(123), BigInt(0), []);
    expect(reply).toContain('/pair');
    expect(reply).toContain('/tasks');
    expect(reply).toContain('/create');
    expect(reply).toContain('/status');
  });

  it('deve ignorar userId e args (sempre responde)', async () => {
    const reply = await handler.handle(BigInt(999), BigInt(0), ['argumento-ignorado']);
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(10);
  });

  it('deve funcionar mesmo com userId=0n (usuário não pareado)', async () => {
    const reply = await handler.handle(BigInt(111), BigInt(0), []);
    expect(reply).toContain('Scrumban Bot');
  });
});
