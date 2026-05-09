import { forwardRef, Module } from '@nestjs/common';
import { ClasseController } from './classes.controller';
import { ClasseService } from './classes.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Módulo READ-ONLY para DClasse (Pilar 2 — Endpoints Genéricos).
 *
 * DClasses são o sistema de tipos polimórfico (seed de F1).
 * Este módulo expõe apenas leitura — sem escrita via API.
 *
 * @see ClasseController — apenas GETs + 403 em criação
 * @see ClasseService — listarFlat, getTree (1 query + Map), buscarPorId
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [ClasseController],
  providers: [ClasseService],
  exports: [ClasseService],
})
export class ClassesModule {}
