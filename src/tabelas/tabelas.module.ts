import { forwardRef, Module } from '@nestjs/common';
import { TabelaController } from './tabelas.controller';
import { TabelaService } from './tabelas.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Módulo canônico para DTabela (Pilar 2 — Endpoints Genéricos).
 *
 * Serve todos os lookups e configs polimórficos (Sprints, Statuses,
 * Prioridades, Task Types, Webhooks, API Keys, MCP Keys, etc.) via
 * `GET /tabelas?idClasse=N`.
 *
 * @see TabelaController — endpoints REST genéricos
 * @see TabelaService — lógica de negócio
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [TabelaController],
  providers: [TabelaService],
  exports: [TabelaService],
})
export class TabelasModule {}
