import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntidadesModule } from '../entidades/entidades.module';
import { AuthModule } from '../auth/auth.module';
import { TasksModule } from '../tasks/tasks.module';
import { PairingService } from './core/pairing.service';
import { AccountLinkService } from './core/account-link.service';
import { MessageRouterService } from './core/message-router.service';
import { CommandRegistryService } from './core/command-registry.service';
import { PairingController } from './pairing.controller';

/**
 * ChannelsModule — Camada base de canais do Scrumban-Backend-V2 (F10 Bloco A).
 *
 * Implementa o core de canais sem acoplamento a um canal específico.
 * O Telegram é implementado no Bloco B como sub-módulo.
 *
 * ADR-V2-010: módulo é opcional e desativável via `CHANNELS_ENABLED`.
 * Se `CHANNELS_ENABLED !== 'true'`, o módulo sobe mas fica inerte
 * (não registra rotas ativas, loga aviso).
 *
 * Exporta:
 * - PairingService — geração e consumo de tokens de pareamento
 * - AccountLinkService — resolução de userId por chatId
 * - MessageRouterService — roteamento de mensagens inbound
 * - CommandRegistryService — registro de handlers de comando
 *
 * Importa:
 * - EntidadesModule — EntidadeService (getEntidadeIdFromUserGroup)
 * - AuthModule — JwtAuthGuard para endpoints REST
 * - TasksModule — TasksService (usado por handlers de comando no Bloco C)
 */
@Module({
  imports: [
    EntidadesModule,
    AuthModule,
    TasksModule,
  ],
  controllers: [PairingController],
  providers: [
    PairingService,
    AccountLinkService,
    MessageRouterService,
    CommandRegistryService,
  ],
  exports: [
    PairingService,
    AccountLinkService,
    MessageRouterService,
    CommandRegistryService,
  ],
})
export class ChannelsModule implements OnModuleInit {
  private readonly logger = new Logger(ChannelsModule.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Verifica `CHANNELS_ENABLED` na inicialização.
   *
   * Se não habilitado, loga aviso mas não lança erro — módulo fica inerte.
   * O módulo sempre sobe para que testes possam importá-lo sem variáveis de env.
   */
  onModuleInit(): void {
    const enabled = this.configService.get<string>('CHANNELS_ENABLED');

    if (enabled !== 'true') {
      this.logger.warn(
        'ChannelsModule inicializado mas CHANNELS_ENABLED !== "true" — ' +
          'módulo operacional porém canais externos desativados (ADR-V2-010)',
      );
    } else {
      this.logger.log('ChannelsModule inicializado com CHANNELS_ENABLED=true');
    }
  }
}
