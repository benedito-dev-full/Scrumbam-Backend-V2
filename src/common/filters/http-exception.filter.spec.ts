import { HttpException, HttpStatus } from '@nestjs/common';
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
