import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { DocumentsModule } from '../documents/documents.module';
import { CollaborationModule } from '../collaboration/collaboration.module';

@Module({
  imports: [DocumentsModule, CollaborationModule],
  providers: [ExportService],
  controllers: [ExportController],
})
export class ExportModule {}
