import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';

// ── Mock do SDK OpenAI (nao chama API real). ─────────────────────────────────
const completionsCreateMock = jest.fn();
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: completionsCreateMock } },
    })),
  };
});

import { OpenAiProvider } from './openai.provider';
import { AiKeyResolverService } from '../ai-key-resolver.service';
import { AiToolDefinition } from './ai-provider.interface';

/** Helper: resposta OpenAI com texto final. */
const textResponse = (content: string, finishReason = 'stop') => ({
  choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 12, completion_tokens: 6 },
});

/** Helper: resposta OpenAI pedindo uma tool. */
const toolCallResponse = (id: string, name: string, args: Record<string, unknown>) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 9, completion_tokens: 3 },
});

/** Erro estilo SDK (status numerico). */
const sdkError = (status: number) => Object.assign(new Error(`openai ${status}`), { status });

describe('OpenAiProvider', () => {
  let provider: OpenAiProvider;
  let keyResolver: { resolveKey: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    keyResolver = { resolveKey: jest.fn().mockResolvedValue('sk-openai-test-key') };
    provider = new OpenAiProvider(keyResolver as unknown as AiKeyResolverService);
  });

  it('expoe name=openai', () => {
    expect(provider.name).toBe('openai');
  });

  it('resolve a chave com provider=openai propagando org/user', async () => {
    completionsCreateMock.mockResolvedValueOnce(textResponse('oi'));

    await provider.chat({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'ola' }],
      tools: [],
      orgId: BigInt(152),
      userEntidadeId: BigInt(7),
    });

    expect(keyResolver.resolveKey).toHaveBeenCalledWith({
      provider: 'openai',
      orgId: BigInt(152),
      userEntidadeId: BigInt(7),
    });
  });

  it('injeta system como primeira mensagem e mapeia o historico', async () => {
    completionsCreateMock.mockResolvedValueOnce(textResponse('resposta final'));

    const result = await provider.chat({
      systemPrompt: 'voce e o Nexus',
      messages: [
        { role: 'system', content: 'IGNORAR' },
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: 'ola' },
      ],
      tools: [],
    });

    expect(result.finalMessage).toBe('resposta final');
    expect(result.model).toBe('gpt-4o');
    expect(result.finishReason).toBe('STOP');
    expect(result.tokensUsed).toEqual({ input: 12, output: 6 });

    const callArg = completionsCreateMock.mock.calls[0][0];
    expect(callArg.messages).toEqual([
      { role: 'system', content: 'voce e o Nexus' },
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'ola' },
    ]);
  });

  it('converte tools para o formato OpenAI (type:function)', async () => {
    completionsCreateMock.mockResolvedValueOnce(textResponse('ok'));
    const tool: AiToolDefinition = {
      name: 'create_task',
      description: 'cria uma task',
      parameters: { type: 'object', properties: { title: { type: 'string' } } },
      execute: jest.fn(),
    };

    await provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'cria' }],
      tools: [tool],
    });

    const callArg = completionsCreateMock.mock.calls[0][0];
    expect(callArg.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'create_task',
          description: 'cria uma task',
          parameters: { type: 'object', properties: { title: { type: 'string' } } },
        },
      },
    ]);
  });

  it('executa o loop de tool calling: tool_call -> executa -> texto final', async () => {
    const execute = jest.fn().mockResolvedValue({ ok: true, id: '42' });
    const tool: AiToolDefinition = {
      name: 'create_task',
      description: 'cria',
      parameters: { type: 'object' },
      execute,
    };

    completionsCreateMock
      .mockResolvedValueOnce(toolCallResponse('call_1', 'create_task', { title: 'X' }))
      .mockResolvedValueOnce(textResponse('task criada!'));

    const result = await provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'cria X' }],
      tools: [tool],
    });

    // A tool foi executada com os args parseados do JSON.
    expect(execute).toHaveBeenCalledWith({ title: 'X' });
    expect(result.finalMessage).toBe('task criada!');
    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0].name).toBe('create_task');

    expect(completionsCreateMock).toHaveBeenCalledTimes(2);
    // A segunda chamada teve a msg do assistant (tool_calls) + a msg role:'tool'.
    const secondCall = completionsCreateMock.mock.calls[1][0];
    const msgs = secondCall.messages;
    const toolMsg = msgs[msgs.length - 1];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('call_1');
    const assistantMsg = msgs[msgs.length - 2];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.tool_calls[0].id).toBe('call_1');
  });

  it('respeita maxToolIterations (loop nao infinito)', async () => {
    const execute = jest.fn().mockResolvedValue({ done: false });
    const tool: AiToolDefinition = {
      name: 'loop_tool',
      description: 'sempre pede de novo',
      parameters: { type: 'object' },
      execute,
    };
    completionsCreateMock.mockResolvedValue(toolCallResponse('call', 'loop_tool', {}));

    const result = await provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'loop' }],
      tools: [tool],
      maxToolIterations: 3,
    });

    expect(completionsCreateMock).toHaveBeenCalledTimes(3);
    expect(result.finishReason).toBe('TOOL_LOOP_EXCEEDED');
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('traduz 401 para BadGatewayException sem vazar a chave', async () => {
    completionsCreateMock.mockRejectedValueOnce(sdkError(401));

    const promise = provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [],
    });

    await expect(promise).rejects.toBeInstanceOf(BadGatewayException);
    await expect(promise).rejects.not.toThrow(/sk-openai-test-key/);
  });

  it('traduz 429 para ServiceUnavailableException (apos retry)', async () => {
    completionsCreateMock.mockRejectedValue(sdkError(429));

    await expect(
      provider.chat({
        systemPrompt: 's',
        messages: [{ role: 'user', content: 'oi' }],
        tools: [],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // 429 dispara 1 retry → 2 chamadas no total.
    expect(completionsCreateMock).toHaveBeenCalledTimes(2);
  });

  it('traduz 5xx para BadGatewayException sem vazar a chave', async () => {
    completionsCreateMock.mockRejectedValue(sdkError(500));

    const promise = provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [],
    });

    await expect(promise).rejects.toBeInstanceOf(BadGatewayException);
    await expect(promise).rejects.not.toThrow(/sk-openai-test-key/);
  });
});
