import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SnapshotsService } from './snapshots.service';

@UseGuards(JwtAuthGuard)
@Controller('documents/:documentId/snapshots')
export class SnapshotsController {
  constructor(private snapshots: SnapshotsService) {}

  @Get()
  list(@CurrentUser() user: any, @Param('documentId') documentId: string) {
    return this.snapshots.list(documentId, user.id);
  }

  @Get(':snapshotId/preview')
  preview(
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
    @Param('snapshotId') snapshotId: string,
  ) {
    return this.snapshots.preview(documentId, snapshotId, user.id);
  }

  @Post(':snapshotId/restore')
  restore(
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
    @Param('snapshotId') snapshotId: string,
  ) {
    return this.snapshots.restore(documentId, snapshotId, user.id);
  }
}
