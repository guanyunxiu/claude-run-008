import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsFilter } from './metrics.filter';
import { CollaborationModule } from '../collaboration/collaboration.module';

@Global()
@Module({
  imports: [CollaborationModule],
  providers: [
    MetricsService,
    { provide: APP_FILTER, useClass: MetricsFilter },
  ],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
