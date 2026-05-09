import { Module } from '@nestjs/common';
import { TabelasModule } from '../tabelas/tabelas.module';

/**
 * SprintsModule — wrapper thin sobre TabelasModule (ADR-V2-009).
 *
 * Sprints são DTabela idClasse=-400 — o endpoint genérico /tabelas
 * já suporta todos os filtros necessários.
 *
 * ZERO controller TypeScript neste módulo.
 * CRUD via /tabelas?idClasse=-400&dEntidadeId={projectId}.
 *
 * @see README.md para documentação dos endpoints
 * @see TabelasModule para o controller genérico
 * @see ADR-V2-009 — Sprints como wrapper thin (Pilar 2)
 */
@Module({
  imports: [TabelasModule],
  exports: [TabelasModule],
})
export class SprintsModule {}
