import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { DocumentsModule } from './documents/documents.module';
import { SnapshotsModule } from './snapshots/snapshots.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { ExportModule } from './export/export.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    DocumentsModule,
    SnapshotsModule,
    CollaborationModule,
    ExportModule,
  ],
})
export class AppModule {}
