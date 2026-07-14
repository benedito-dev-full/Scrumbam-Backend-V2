import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { CorrelationIdService } from '../services/correlation-id.service';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let correlationIdService: CorrelationIdService;
  let mockResponse: {
    status: jest.Mock;
    json: jest.Mock;
  };
  let mockRequest: { url: string };
  let mockHost: {
    switchToHttp: jest.Mock;
  };

  beforeEach(() => {
    correlationIdService = new CorrelationIdService();
    jest.spyOn(correlationIdService, 'get').mockReturnValue('test-correlation-id');

    filter = new HttpExceptionFilter(correlationIdService);

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockRequest = { url: '/api/v1/test' };
    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  it('deve formatar resposta 404 com correlationId e timestamp', () => {
    const exception = new HttpException('Entidade não encontrada', HttpStatus.NOT_FOUND);

    filter.catch(exception, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Entidade não encontrada',
        correlationId: 'test-correlation-id',
        path: '/api/v1/test',
      }),
    );

    const jsonCall = mockResponse.json.mock.calls[0][0];
    expect(jsonCall.timestamp).toBeDefined();
    expect(new Date(jsonCall.timestamp).toISOString()).toBe(jsonCall.timestamp);
  });

  // ─── F1 (item 1.4) — Problem Details: `code` preservado, @Catch() universal ──

  it('deve PRESERVAR o campo `code` da exceção (RFC 9457)', () => {
    const exception = new UnauthorizedException({
      code: 'TOKEN_INVALID',
      message: 'Refresh token inválido. Faça login novamente.',
    });

    filter.catch(exception, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        code: 'TOKEN_INVALID',
        message: 'Refresh token inválido. Faça login novamente.',
        correlationId: 'test-correlation-id',
      }),
    );
  });

  it('deve preservar `code` em 503 AUTH_BACKEND_UNAVAILABLE (infra ≠ credencial)', () => {
    const exception = new ServiceUnavailableException({
      code: 'AUTH_BACKEND_UNAVAILABLE',
      message: 'Serviço de autenticação temporariamente indisponível.',
    });

    filter.catch(exception, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(503);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503, code: 'AUTH_BACKEND_UNAVAILABLE' }),
    );
  });

  it('deve capturar exceção NÃO-HTTP e devolver 500 padronizado (sem vazar stack)', () => {
    filter.catch(new Error('boom interno com detalhe sensível'), mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(500);

    const payload = mockResponse.json.mock.calls[0][0];
    expect(payload).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor',
      correlationId: 'test-correlation-id',
    });
    // A mensagem original NUNCA vaza para o cliente.
    expect(JSON.stringify(payload)).not.toContain('detalhe sensível');
  });

  it('deve formatar resposta 400 com mensagem de array (class-validator)', () => {
    const exception = new HttpException(
      {
        statusCode: 400,
        message: ['nome must be a string', 'idClasse must not be empty'],
        error: 'Bad Request',
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: ['nome must be a string', 'idClasse must not be empty'],
        error: 'Bad Request',
        correlationId: 'test-correlation-id',
      }),
    );
  });
});
