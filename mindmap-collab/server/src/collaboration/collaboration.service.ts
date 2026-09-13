import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const DOC_PREFIX = 'document:';
const SNAPSHOT_OP_THRESHOLD = 100; // 每 100 次操作自动快照
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 或每 5 分钟自动快照
const TICK_MS = 30 * 1000; // 定时检查间隔

interface DocStats {
  opsSinceSnapshot: number;
  lastSnapshotAt: number;
  dirty: boolean;
}

/**
 * 协同服务：内嵌 Hocuspocus Server（y-websocket 协议兼容）
 * - onAuthenticate：JWT 鉴权
 * - onLoadDocument / onStoreDocument：PostgreSQL 存取 Yjs 二进制状态
 * - onChange：操作计数，触发自动快照（100 次操作 / 5 分钟）
 * - connected / onDisconnect：Redis 在线状态 + Pub/Sub 广播
 */
@Injectable()
export class CollaborationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollaborationService.name);
  private server: Hocuspocus;
  private stats = new Map<string, DocStats>();
  private timer: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwt: JwtService,
  ) {}

  onModuleInit() {
    const port = Number(process.env.WS_PORT || 1234);

    this.server = new Hocuspocus({
      port,
      // 防抖落库：停止编辑 3s 后存储，最长 10s 强制存一次
      debounce: 3000,
      maxDebounce: 10000,

      onAuthenticate: async ({ token, documentName }) => {
        try {
          const payload = this.jwt.verify(token || '');
          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
          });
          if (!user) throw new Error('user not found');
          const documentId = this.documentIdFromName(documentName);
          const doc = await this.prisma.document.findUnique({
            where: { id: documentId },
          });
          if (!doc) throw new Error('document not found');
          const member = await this.prisma.workspaceMember.findUnique({
            where: {
              userId_workspaceId: { userId: user.id, workspaceId: doc.workspaceId },
            },
          });
          if (!member) throw new Error('not a workspace member');
          // 返回值会作为 context 传递给后续钩子
          return {
            user: { id: user.id, name: user.name, email: user.email },
            documentId,
          };
        } catch (e) {
          this.logger.warn(`WS auth failed: ${(e as Error).message}`);
          throw new Error('Unauthorized');
        }
      },

      onLoadDocument: async ({ document, documentName }) => {
        const documentId = this.documentIdFromName(documentName);
        const row = await this.prisma.document.findUnique({
          where: { id: documentId },
          select: { yjsState: true },
        });
        if (row?.yjsState) {
          Y.applyUpdate(document, new Uint8Array(row.yjsState));
        }
        this.ensureStats(documentId);
        return document;
      },

      onStoreDocument: async ({ document, documentName }) => {
        const documentId = this.documentIdFromName(documentName);
        await this.prisma.document.update({
          where: { id: documentId },
          data: { yjsState: new Uint8Array(Y.encodeStateAsUpdate(document)) },
        });
      },

      onChange: async ({ documentName }) => {
        const documentId = this.documentIdFromName(documentName);
        const stats = this.ensureStats(documentId);
        stats.opsSinceSnapshot += 1;
        stats.dirty = true;
        if (stats.opsSinceSnapshot >= SNAPSHOT_OP_THRESHOLD) {
          await this.createSnapshot(documentId, `auto(${SNAPSHOT_OP_THRESHOLD} ops)`);
        }
      },

      connected: async ({ documentName, context }) => {
        const documentId = this.documentIdFromName(documentName);
        if (context?.user) {
          await this.redis.addPresence(documentId, {
            id: context.user.id,
            name: context.user.name,
          });
        }
      },

      onDisconnect: async ({ documentName, context }) => {
        const documentId = this.documentIdFromName(documentName);
        if (context?.user) {
          await this.redis.removePresence(documentId, context.user.id);
        }
      },
    });

    void this.server.listen();
    this.logger.log(`[WS] Hocuspocus listening on ws://localhost:${port}`);

    // 定时器：检查“距上次快照超过 5 分钟且有变更”的文档
    this.timer = setInterval(() => this.tickSnapshots(), TICK_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.server?.destroy();
  }

  private documentIdFromName(documentName: string) {
    return documentName.startsWith(DOC_PREFIX)
      ? documentName.slice(DOC_PREFIX.length)
      : documentName;
  }

  private ensureStats(documentId: string): DocStats {
    let s = this.stats.get(documentId);
    if (!s) {
      s = { opsSinceSnapshot: 0, lastSnapshotAt: Date.now(), dirty: false };
      this.stats.set(documentId, s);
    }
    return s;
  }

  private async tickSnapshots() {
    for (const [documentId, stats] of this.stats) {
      if (
        stats.dirty &&
        Date.now() - stats.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS
      ) {
        await this.createSnapshot(documentId, 'auto(5min)');
      }
    }
  }

  /** 生成快照：优先取内存中的实时文档，否则读库中状态 */
  async createSnapshot(documentId: string, label: string) {
    try {
      const state = await this.getCurrentState(documentId);
      if (!state) return;
      await this.prisma.snapshot.create({
        data: { documentId, state: new Uint8Array(state), label },
      });
      const stats = this.ensureStats(documentId);
      stats.opsSinceSnapshot = 0;
      stats.lastSnapshotAt = Date.now();
      stats.dirty = false;
      this.logger.log(`snapshot created for ${documentId} (${label})`);
    } catch (e) {
      this.logger.error(`snapshot failed for ${documentId}`, e as Error);
    }
  }

  /** 获取文档当前 Yjs 状态（内存优先，退化到数据库） */
  async getCurrentState(documentId: string): Promise<Uint8Array | null> {
    const name = `${DOC_PREFIX}${documentId}`;
    const live = this.server?.documents?.get(name);
    if (live) {
      return Y.encodeStateAsUpdate(live);
    }
    const row = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { yjsState: true },
    });
    return row?.yjsState ? new Uint8Array(row.yjsState) : null;
  }

  /**
   * 恢复文档到指定快照：
   * 在一个事务里替换 nodes 映射，变更会作为普通 Yjs 更新
   * 广播给所有在线客户端（天然合并，无需强制刷新）。
   */
  async restoreSnapshot(documentId: string, snapshotState: Uint8Array) {
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, snapshotState);
    const snapshotNodes = tmp.getMap<Y.Map<unknown>>('nodes');

    const replace = (doc: Y.Doc) => {
      const nodes = doc.getMap<Y.Map<unknown>>('nodes');
      doc.transact(() => {
        // 删除现有全部节点
        [...nodes.keys()].forEach((k) => nodes.delete(k));
        // 深拷贝快照节点
        snapshotNodes.forEach((ynode, key) => {
          const copy = new Y.Map<unknown>();
          ynode.forEach((v, k) => copy.set(k, v));
          nodes.set(key, copy);
        });
      });
    };

    const name = `${DOC_PREFIX}${documentId}`;
    const live = this.server?.documents?.get(name);
    if (live) {
      replace(live);
    } else {
      // 文档不在内存：离线构造新状态直接落库，下次连接时加载
      const row = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { yjsState: true },
      });
      const doc = new Y.Doc();
      if (row?.yjsState) Y.applyUpdate(doc, new Uint8Array(row.yjsState));
      replace(doc);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { yjsState: new Uint8Array(Y.encodeStateAsUpdate(doc)) },
      });
    }
    tmp.destroy();
    // 恢复后再补一个快照，方便回退
    await this.createSnapshot(documentId, 'restore');
  }
}
