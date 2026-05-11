import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { EntidadesModule } from '../entidades/entidades.module';
import { WebhookOwnerGuard } from './guards/webhook-owner.guard';
import { WebhookDispatchProcessor } from './processors/webhook-dispatch.processor';
import { WebhooksDispatcherService } from './services/webhooks-dispatcher.service';
import { WebhooksRedriveService } from './services/webhooks-redrive.service';
import { WebhooksRetryService } from './services/webhooks-retry.service';
import { WebhooksSigningService } from './services/webhooks-signing.service';
import { WebhooksSsrfService } from './services/webhooks-ssrf.service';
import { WebhooksHookService } from './services/webhooks-hook.service';
import { WebhooksService } from './services/webhooks.service';
import { WEBHOOK_DISPATCH_QUEUE } from './types/webhook-dispatch-job';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: Number(configService.get<string>('REDIS_PORT', '6379')),
          ...(configService.get<string>('REDIS_PASSWORD')
            ? { password: configService.get<string>('REDIS_PASSWORD') }
            : {}),
        },
      }),
    }),
    BullModule.registerQueue({
      name: WEBHOOK_DISPATCH_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
        attempts: 1,
      },
    }),
    forwardRef(() => AuthModule),
    forwardRef(() => EntidadesModule),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhooksDispatcherService,
    WebhooksRedriveService,
    WebhooksRetryService,
    WebhooksSigningService,
    WebhooksSsrfService,
    WebhooksHookService,
    WebhookDispatchProcessor,
    WebhookOwnerGuard,
  ],
  exports: [
    WebhooksService,
    WebhooksDispatcherService,
    WebhooksRedriveService,
    WebhooksRetryService,
    WebhooksSigningService,
    WebhooksSsrfService,
    WebhooksHookService,
  ],
})
export class WebhooksModule {}
