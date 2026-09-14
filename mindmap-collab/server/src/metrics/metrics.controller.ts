import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MetricsService } from './metrics.service';
import { CollaborationService } from '../collaboration/collaboration.service';

@UseGuards(JwtAuthGuard)
@Controller('metrics')
export class MetricsController {
  constructor(
    private metrics: MetricsService,
    private collaboration: CollaborationService,
  ) {}

  @Get()
  get() {
    return this.metrics.snapshot(
      this.collaboration.getConnectionsCount(),
      this.collaboration.getDocumentsCount(),
    );
  }
}
