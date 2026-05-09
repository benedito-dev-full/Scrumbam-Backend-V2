import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Services do projeto
import { PrismaService } from '../../prisma.service';

// Health
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

/**
 * Módulo de Health Check do Scrumban-Backend-V2.
 *
 * Expõe `GET /health` como endpoint público para verificação
 * da saúde das dependências críticas (DB, Redis, Email).
 */
@Module({
  imports: [ConfigModule],
  providers: [PrismaService, HealthService],
  controllers: [HealthController],
  exports: [HealthService],
})
export class HealthModule {}
