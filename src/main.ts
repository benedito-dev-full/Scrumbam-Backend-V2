import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, type Request as ExpressRequest } from 'express';
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
  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

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
