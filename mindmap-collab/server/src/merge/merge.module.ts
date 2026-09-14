import { Module } from '@nestjs/common';
import { MergeService } from './merge.service';
import { MergeController } from './merge.controller';
import { DocumentsModule } from '../documents/documents.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [
    DocumentsModule,
    WorkspacesModule,
    CollaborationModule,
    BranchesModule,
  ],
  providers: [MergeService],
  controllers: [MergeController],
})
export class MergeModule {}
