import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  json,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
  type NextFunction,
} from 'express';
import { AppModule } from './app.module';
import { SanitizingLogger } from './mcp/logging/sanitizing-logger.service';
import { assertProductionReady } from './common/security/production-readiness';

/** Request com bytes brutos preservados para validacao HMAC inbound (ADR-V2-040). */
interface RawBodyRequest extends ExpressRequest {
  rawBody?: Buffer;
}

async function bootstrap(): Promise<void> {
  assertProductionReady(process.env);

  // ADR-V2-040: preservar rawBody para validacao HMAC inbound (agent -> backend).
  // O AgentAuthGuard recalcula sha256(body) sobre os bytes exatos enviados pelo
  // agent; sem rawBody a comparacao falharia em re-serializacoes do Nest. Usamos
  // bodyParser: false + express.json com verify callback (padrao Express para
  // webhooks HMAC, ja em uso em outras rotas que dependem de integridade do body).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new SanitizingLogger(undefined, {
      logLevels: ['error', 'warn', 'log', 'debug', 'verbose'],
    }),
    bodyParser: false,
  });
  app.use(
    json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
      },
    }),
  );

  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  // O discovery OAuth (RFC 9728) DEVE viver na raiz do dominio
  // (/.well-known/oauth-protected-resource), fora do prefixo global, pois e la
  // que o Claude Web procura. Excluido do setGlobalPrefix por isso. (Reforma 2 F1)
  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      '.well-known/oauth-protected-resource',
      // Variante RFC 9728 §3.1 (recurso com path) — onde o Claude Web busca.
      '.well-known/oauth-protected-resource/api/v1/mcp',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS dos paths PÚBLICOS do MCP OAuth (discovery `.well-known` + `/mcp`):
  // clientes MCP browser-based (Claude Web, MCP Inspector) descobrem/autorizam
  // o OAuth via fetch CROSS-ORIGIN. Precisam que a resposta reflita a origem E
  // exponha `WWW-Authenticate` (é dele que o cliente lê o OAuth challenge) e
  // `Mcp-Session-Id`. Sem isso o browser bloqueia (TypeError: Failed to fetch)
  // e o handshake nunca completa. Segurança do MCP é por Bearer/X-MCP-Key +
  // guards (não por CORS), então refletir a origem nesses paths é seguro.
  // Este middleware roda ANTES do enableCors global e curto-circuita os paths
  // MCP; o CORS do frontend (com allow-list) segue para o resto da API.
  // (Reforma 2 F5.1)
  app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const isMcpPublicPath =
      req.path.startsWith('/api/v1/mcp') ||
      req.path.startsWith('/.well-known/');
    const origin = req.headers.origin;
    if (isMcpPublicPath && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'authorization,content-type,mcp-session-id,mcp-protocol-version',
      );
      res.setHeader(
        'Access-Control-Expose-Headers',
        'WWW-Authenticate,Mcp-Session-Id',
      );
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
    }
    next();
  });

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3001'],
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Scrumban Backend V2')
    .setDescription('API canônica Devari-Core — 17 tabelas, 3 Pilares, ZERO tabela nova.')
    .setVersion('2.0.0-alpha')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addApiKey({ type: 'apiKey', name: 'X-MCP-Key', in: 'header' }, 'mcp-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  const port = process.env.PORT || '3000';
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Scrumban Backend V2 running on http://localhost:${port}/${apiPrefix}`);
  logger.log(`Swagger docs at http://localhost:${port}/${apiPrefix}/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed', err);
  process.exit(1);
});
