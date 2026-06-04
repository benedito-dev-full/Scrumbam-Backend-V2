import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';

// ── Mock do SDK Anthropic (nao chama API real). ──────────────────────────────
const messagesCreateMock = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: messagesCreateMock },
    })),
  };
});

import { ClaudeProvider } from './claude.provider';
import { AiKeyResolverService } from '../ai-key-resolver.service';
import { AiToolDefinition } from './ai-provider.interface';

/** Helper: resposta Anthropic com bloco de texto final. */
const textResponse = (text: string, stopReason = 'end_turn') => ({
  content: [{ type: 'text', text }],
  stop_reason: stopReason,
  usage: { input_tokens: 10, output_tokens: 5 },
});

/** Helper: resposta Anthropic pedindo uma tool. */
const toolUseResponse = (id: string, name: string, input: Record<string, unknown>) => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 8, output_tokens: 4 },
});

/** Erro estilo SDK (status numerico). */
const sdkError = (status: number) => Object.assign(new Error(`anthropic ${status}`), { status });

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;
  let keyResolver: { resolveKey: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    keyResolver = { resolveKey: jest.fn().mockResolvedValue('sk-ant-test-key') };
    provider = new ClaudeProvider(keyResolver as unknown as AiKeyResolverService);
  });

  it('expoe name=claude', () => {
    expect(provider.name).toBe('claude');
  });

  it('resolve a chave com provider=claude propagando org/user', async () => {
    messagesCreateMock.mockResolvedValueOnce(textResponse('oi'));

    await provider.chat({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'ola' }],
      tools: [],
      orgId: BigInt(152),
      userEntidadeId: BigInt(7),
    });

    expect(keyResolver.resolveKey).toHaveBeenCalledWith({
      provider: 'claude',
      orgId: BigInt(152),
      userEntidadeId: BigInt(7),
    });
  });

  it('envia system no top-level e mensagens sem role system', async () => {
    messagesCreateMock.mockResolvedValueOnce(textResponse('resposta final'));

    const result = await provider.chat({
      systemPrompt: 'voce e o Nexus',
      messages: [
        { role: 'system', content: 'IGNORAR' },
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: 'ola' },
        { role: 'user', content: 'tudo bem?' },
      ],
      tools: [],
    });

    expect(result.finalMessage).toBe('resposta final');
    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.finishReason).toBe('STOP');
    expect(result.tokensUsed).toEqual({ input: 10, output: 5 });

    const callArg = messagesCreateMock.mock.calls[0][0];
    expect(callArg.system).toBe('voce e o Nexus');
    // 'system' do historico nao vai como mensagem.
    expect(callArg.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'oi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ola' }] },
      { role: 'user', content: [{ type: 'text', text: 'tudo bem?' }] },
    ]);
  });

  it('converte tools para o formato Anthropic (input_schema)', async () => {
    messagesCreateMock.mockResolvedValueOnce(textResponse('ok'));
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

    const callArg = messagesCreateMock.mock.calls[0][0];
    expect(callArg.tools).toEqual([
      {
        name: 'create_task',
        description: 'cria uma task',
        input_schema: { type: 'object', properties: { title: { type: 'string' } } },
      },
    ]);
  });

  it('executa o loop de tool calling: tool_use -> executa -> texto final', async () => {
    const execute = jest.fn().mockResolvedValue({ ok: true, id: '42' });
    const tool: AiToolDefinition = {
      name: 'create_task',
      description: 'cria',
      parameters: { type: 'object' },
      execute,
    };

    messagesCreateMock
      .mockResolvedValueOnce(toolUseResponse('tu_1', 'create_task', { title: 'X' }))
      .mockResolvedValueOnce(textResponse('task criada!'));

    const result = await provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'cria X' }],
      tools: [tool],
    });

    // A tool foi executada com os args certos.
    expect(execute).toHaveBeenCalledWith({ title: 'X' });
    expect(result.finalMessage).toBe('task criada!');
    expect(result.toolCallsExecuted).toHaveLength(1);
    expect(result.toolCallsExecuted[0].name).toBe('create_task');

    // 2 chamadas ao SDK: pedido de tool + resposta final.
    expect(messagesCreateMock).toHaveBeenCalledTimes(2);
    // A segunda chamada teve o tool_result como role:'user'.
    const secondCall = messagesCreateMock.mock.calls[1][0];
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content[0].type).toBe('tool_result');
    expect(lastMsg.content[0].tool_use_id).toBe('tu_1');
  });

  it('respeita maxToolIterations (loop nao infinito)', async () => {
    const execute = jest.fn().mockResolvedValue({ done: false });
    const tool: AiToolDefinition = {
      name: 'loop_tool',
      description: 'sempre pede de novo',
      parameters: { type: 'object' },
      execute,
    };
    // Sempre retorna tool_use → forca o limite.
    messagesCreateMock.mockResolvedValue(toolUseResponse('tu', 'loop_tool', {}));

    const result = await provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'loop' }],
      tools: [tool],
      maxToolIterations: 3,
    });

    expect(messagesCreateMock).toHaveBeenCalledTimes(3);
    expect(result.finishReason).toBe('TOOL_LOOP_EXCEEDED');
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('traduz 401 para BadGatewayException sem vazar a chave', async () => {
    messagesCreateMock.mockRejectedValueOnce(sdkError(401));

    const promise = provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [],
    });

    await expect(promise).rejects.toBeInstanceOf(BadGatewayException);
    await expect(promise).rejects.not.toThrow(/sk-ant-test-key/);
  });

  it('traduz 429 para ServiceUnavailableException (apos retry)', async () => {
    messagesCreateMock.mockRejectedValue(sdkError(429));

    await expect(
      provider.chat({
        systemPrompt: 's',
        messages: [{ role: 'user', content: 'oi' }],
        tools: [],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // 429 dispara 1 retry → 2 chamadas no total.
    expect(messagesCreateMock).toHaveBeenCalledTimes(2);
  });

  it('traduz 529 (overloaded) para ServiceUnavailableException', async () => {
    messagesCreateMock.mockRejectedValue(sdkError(529));

    await expect(
      provider.chat({
        systemPrompt: 's',
        messages: [{ role: 'user', content: 'oi' }],
        tools: [],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('nao vaza a chave na mensagem de erro generico (5xx)', async () => {
    messagesCreateMock.mockRejectedValue(sdkError(500));

    const promise = provider.chat({
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'oi' }],
      tools: [],
    });

    await expect(promise).rejects.toBeInstanceOf(BadGatewayException);
    await expect(promise).rejects.not.toThrow(/sk-ant-test-key/);
  });
});
