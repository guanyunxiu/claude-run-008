import { Global, Module } from '@nestjs/common';
import { SnapshotStorageService } from './snapshot-storage.service';

/** 快照存储（压缩/校验和/快照链/分片）全局共享 */
@Global()
@Module({
  providers: [SnapshotStorageService],
  exports: [SnapshotStorageService],
})
export class SnapshotStorageModule {}
