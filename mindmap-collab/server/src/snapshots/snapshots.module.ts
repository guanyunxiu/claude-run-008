import { Module } from '@nestjs/common';
import { SnapshotsService } from './snapshots.service';
import { SnapshotsController } from './snapshots.controller';
import { DocumentsModule } from '../documents/documents.module';
import { CollaborationModule } from '../collaboration/collaboration.module';

@Module({
  imports: [DocumentsModule, CollaborationModule],
  providers: [SnapshotsService],
  controllers: [SnapshotsController],
})
export class SnapshotsModule {}
