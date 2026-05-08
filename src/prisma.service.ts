import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService canônico Devari-Core (Padrão #1 de devari-backend-patterns.md).
 *
 * Esta é a ÚNICA forma autorizada de acessar o banco no V2.
 * NUNCA use DatabaseService (deprecated) nem PrismaClient direto.
 *
 * @see docs/plano/00-PLANO-MESTRE.md §6 (workflow multi-agent)
 * @see .claude/rules/devari-backend-patterns.md §1
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.DATABASE_LOGGING === 'true'
          ? ['query', 'info', 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma conectado ao Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma desconectado');
  }
}
