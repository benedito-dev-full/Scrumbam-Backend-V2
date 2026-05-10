import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { GroqWhisperService } from '../groq-whisper.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('GroqWhisperService', () => {
  let service: GroqWhisperService;
  let configServiceMock: jest.Mocked<Pick<ConfigService, 'get'>>;

  const FAKE_API_KEY = 'gsk_test_fake_key_for_testing_only';
  const SAMPLE_AUDIO = Buffer.from('fake-audio-data-bytes');

  beforeEach(async () => {
    configServiceMock = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroqWhisperService,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<GroqWhisperService>(GroqWhisperService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('transcribe', () => {
    it('deve chamar a API Groq com o buffer e retornar o texto transcrito', async () => {
      configServiceMock.get.mockReturnValue(FAKE_API_KEY);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'Criar tarefa implementar login' }),
      });

      const result = await service.transcribe(SAMPLE_AUDIO, 'audio/ogg');

      expect(result).toBe('Criar tarefa implementar login');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${FAKE_API_KEY}`,
          }),
        }),
      );
    });

    it('deve lançar ServiceUnavailableException quando GROQ_API_KEY não está configurada', async () => {
      configServiceMock.get.mockReturnValue(undefined);

      await expect(service.transcribe(SAMPLE_AUDIO)).rejects.toThrow(
        ServiceUnavailableException,
      );

      // Não deve chamar a API
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('deve lançar Error quando a API Groq retorna status não-OK', async () => {
      configServiceMock.get.mockReturnValue(FAKE_API_KEY);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      await expect(service.transcribe(SAMPLE_AUDIO, 'audio/ogg')).rejects.toThrow(
        /Groq API error: 503/,
      );
    });

    it('deve usar mime type padrão audio/ogg quando não especificado', async () => {
      configServiceMock.get.mockReturnValue(FAKE_API_KEY);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'Transcrição sem mime type' }),
      });

      const result = await service.transcribe(SAMPLE_AUDIO);

      expect(result).toBe('Transcrição sem mime type');

      // Verificar que o body contém o filename correto para audio/ogg
      const callBody = mockFetch.mock.calls[0][1].body as Buffer;
      expect(callBody.toString()).toContain('audio.ogg');
    });

    it('deve retornar string vazia quando API retorna texto vazio', async () => {
      configServiceMock.get.mockReturnValue(FAKE_API_KEY);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ text: '' }),
      });

      const result = await service.transcribe(SAMPLE_AUDIO, 'audio/ogg');

      expect(result).toBe('');
    });

    it('não deve vazar a API key em mensagens de erro', async () => {
      configServiceMock.get.mockReturnValue(FAKE_API_KEY);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      try {
        await service.transcribe(SAMPLE_AUDIO);
      } catch (error) {
        const message = (error as Error).message;
        // A mensagem de erro não deve conter a API key
        expect(message).not.toContain(FAKE_API_KEY);
      }
    });
  });
});
