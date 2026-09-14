import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';
import { SnapshotStorageService } from '../snapshots/snapshot-storage.service';

const SNAPSHOT_OP_THRESHOLD = 100; // 每 100 次操作自动快照
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 或每 5 分钟自动快照
const TICK_MS = 30 * 1000;
const OP_FLUSH_BATCH = 100;
const MAX_UPDATE_BYTES = 256 * 1024; // 单条更新消息大小上限
const RATE_LIMIT_OPS = 200; // 每用户 10s 内最多 200 次更新（背压）
const RATE_LIMIT_WINDOW_MS = 10 * 1000;

interface DocStats {
  opsSinceSnapshot: number;
  lastSnapshotAt: number;
  dirty: boolean;
  lastChangeAt: number;
  lastOpSeq: number;
}

interface QueuedOp {
  branchId: string;
  documentId: string;
  userId: string | null;
  userName: string | null;
  type: string;
  update: Uint8Array | null;
  vector: Record<string, number> | null;
  meta: any;
}

export interface RoomInfo {
  documentId: string;
  branchId: string | null; // null 表示旧版房间名，需解析主分支
}

/**
 * 协同服务：内嵌 Hocuspocus Server（y-websocket 协议兼容）
 * 房间命名：document:{docId}:branch:{branchId}（分支级增量同步）
 * - onAuthenticate：JWT + 角色（viewer/越权 commenter → readOnly）
 * - onLoadDocument / onStoreDocument：Branch.yjsState 存取
 * - onChange：操作日志（含版本向量）+ 自动快照计数
 * - Redis：在线状态、合并锁、失效通知订阅
 */
@Injectable()
export class CollaborationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollaborationService.name);
  private server: Hocuspocus;
  private stats = new Map<string, DocStats>(); // key: branchId
  private opQueue: QueuedOp[] = [];
  private timer: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwt: JwtService,
    private metrics: MetricsService,
    private snapshotStorage: SnapshotStorageService,
  ) {}

  /* ---------- 房间命名 ---------- */

  static roomName(documentId: string, branchId: string) {
    return `document:${documentId}:branch:${branchId}`;
  }

  parseRoom(documentName: string): RoomInfo {
    const m = documentName.match(/^document:([^:]+)(?::branch:([^:]+))?$/);
    if (m) return { documentId: m[1], branchId: m[2] ?? null };
    return { documentId: documentName, branchId: null };
  }

  onModuleInit() {
    const port = Number(process.env.WS_PORT || 1234);

    this.server = new Hocuspocus({
      port,
      debounce: 3000,
      maxDebounce: 10000,

      onAuthenticate: async ({ token, documentName, connection }) => {
        try {
          const payload = this.jwt.verify(token || '');
          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
          });
          if (!user) throw new Error('user not found');
          const room = this.parseRoom(documentName);
          const doc = await this.prisma.document.findUnique({
            where: { id: room.documentId },
          });
          if (!doc) throw new Error('document not found');
          const member = await this.prisma.workspaceMember.findUnique({
            where: {
              userId_workspaceId: { userId: user.id, workspaceId: doc.workspaceId },
            },
          });
          if (!member) throw new Error('not a workspace member');
          const branchId = await this.resolveBranchId(room);
          const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
          });
          if (!branch || branch.documentId !== doc.id) {
            throw new Error('branch not found');
          }
          // 分支权限：viewer 全只读；commenter 仅可写自己创建的分支
          const canWrite =
            member.role === 'owner' ||
            member.role === 'editor' ||
            (member.role === 'commenter' && branch.createdById === user.id);
          if (!canWrite) connection.readOnly = true;
          return {
            user: { id: user.id, name: user.name, email: user.email },
            documentId: doc.id,
            branchId,
            role: member.role,
          };
        } catch (e) {
          this.metrics.recordWsAuthFailure();
          this.logger.warn(`WS auth failed: ${(e as Error).message}`);
          throw new Error('Unauthorized');
        }
      },

      onLoadDocument: async ({ document, documentName, context }) => {
        const branchId = context?.branchId ?? (await this.resolveBranchId(this.parseRoom(documentName)));
        const row = await this.prisma.branch.findUnique({
          where: { id: branchId },
          select: { yjsState: true },
        });
        if (row?.yjsState) {
          Y.applyUpdate(document, new Uint8Array(row.yjsState));
        }
        this.ensureStats(branchId);
        return document;
      },

      onStoreDocument: async ({ document, documentName, context }) => {
        const branchId = context?.branchId ?? (await this.resolveBranchId(this.parseRoom(documentName)));
        await this.prisma.branch.update({
          where: { id: branchId },
          data: { yjsState: new Uint8Array(Y.encodeStateAsUpdate(document)) },
        });
        const stats = this.ensureStats(branchId);
        if (stats.lastChangeAt) {
          this.metrics.recordPersistLatency(Date.now() - stats.lastChangeAt);
        }
      },

      onChange: async ({ document, documentName, context, update }) => {
        // 消息大小限制
        if (update.length > MAX_UPDATE_BYTES) {
          this.metrics.recordRateLimit();
          throw new Error('update exceeds max message size');
        }
        // 限流/背压：滑动窗口内超频的连接直接拒绝
        if (!this.checkRateLimit(context?.user?.id ?? 'anonymous')) {
          this.metrics.recordRateLimit();
          throw new Error('rate limit exceeded');
        }
        const branchId = context?.branchId ?? (await this.resolveBranchId(this.parseRoom(documentName)));
        const stats = this.ensureStats(branchId);
        stats.opsSinceSnapshot += 1;
        stats.dirty = true;
        stats.lastChangeAt = Date.now();
        this.metrics.recordUpdate();
        // 操作日志入队（批量落库）
        this.opQueue.push({
          branchId,
          documentId: context?.documentId ?? this.parseRoom(documentName).documentId,
          userId: context?.user?.id ?? null,
          userName: context?.user?.name ?? null,
          type: 'update',
          update: new Uint8Array(update),
          vector: this.decodeVector(document),
          meta: null,
        });
        if (this.opQueue.length >= OP_FLUSH_BATCH) await this.flushOperations();
        if (stats.opsSinceSnapshot >= SNAPSHOT_OP_THRESHOLD) {
          await this.createSnapshot(branchId, `auto(${SNAPSHOT_OP_THRESHOLD} ops)`);
        }
      },

      connected: async ({ context }) => {
        if (context?.user && context?.branchId) {
          await this.redis.addPresence(context.branchId, {
            id: context.user.id,
            name: context.user.name,
          });
        }
      },

      onDisconnect: async ({ context }) => {
        if (context?.user && context?.branchId) {
          await this.redis.removePresence(context.branchId, context.user.id);
        }
      },
    });

    void this.server.listen();
    this.logger.log(`[WS] Hocuspocus listening on ws://localhost:${port}`);

    // 失效通知订阅：其他实例的合并/恢复完成后，向本实例房间广播提示
    this.redis.subscribe('doc-events', (event) => {
      if (event?.room) {
        const doc = this.server?.documents?.get(event.room);
        doc?.broadcastStateless(
          JSON.stringify({ type: 'invalidated', ...event }),
        );
      }
    });

    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flushOperations();
    await this.server?.destroy();
  }

  /** 旧版房间名（无分支）→ 解析/创建主分支 */
  private async resolveBranchId(room: RoomInfo): Promise<string> {
    if (room.branchId) return room.branchId;
    let main = await this.prisma.branch.findFirst({
      where: { documentId: room.documentId, isMain: true },
    });
    if (!main) {
      // 迁移旧数据：Document.yjsState → 主分支
      const doc = await this.prisma.document.findUnique({
        where: { id: room.documentId },
        select: { yjsState: true, createdById: true },
      });
      main = await this.prisma.branch.create({
        data: {
          documentId: room.documentId,
          name: 'main',
          isMain: true,
          createdById: doc?.createdById ?? '',
          yjsState: doc?.yjsState ?? null,
        },
      });
    }
    return main.id;
  }

  private ensureStats(branchId: string): DocStats {
    let s = this.stats.get(branchId);
    if (!s) {
      s = {
        opsSinceSnapshot: 0,
        lastSnapshotAt: Date.now(),
        dirty: false,
        lastChangeAt: 0,
        lastOpSeq: 0,
      };
      this.stats.set(branchId, s);
    }
    return s;
  }

  /** 滑动窗口限流（每用户） */
  private rateWindows = new Map<string, number[]>();
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    let window = this.rateWindows.get(userId);
    if (!window) {
      window = [];
      this.rateWindows.set(userId, window);
    }
    while (window.length && window[0] < now - RATE_LIMIT_WINDOW_MS) {
      window.shift();
    }
    if (window.length >= RATE_LIMIT_OPS) return false;
    window.push(now);
    return true;
  }

  private async tick() {
    await this.flushOperations();
    for (const [branchId, stats] of this.stats) {
      if (stats.dirty && Date.now() - stats.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
        await this.createSnapshot(branchId, 'auto(5min)');
      }
    }
  }

  /** 操作日志批量落库 */
  async flushOperations() {
    if (this.opQueue.length === 0) return;
    const batch = this.opQueue.splice(0, this.opQueue.length);
    try {
      await this.prisma.operation.createMany({
        data: batch.map((op) => ({
          branchId: op.branchId,
          documentId: op.documentId,
          userId: op.userId,
          userName: op.userName,
          type: op.type,
          update: op.update ? new Uint8Array(op.update) : null,
          vector: op.vector ?? undefined,
          meta: op.meta ?? undefined,
        })),
      });
      const last = await this.prisma.operation.findFirst({
        where: { branchId: batch[batch.length - 1].branchId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      if (last) this.ensureStats(batch[batch.length - 1].branchId).lastOpSeq = last.seq;
    } catch (e) {
      this.logger.error('flush operations failed', e as Error);
    }
  }

  /** 供合并/恢复调用：追加一条非 update 类型的操作日志 */
  async appendOperation(op: QueuedOp) {
    this.opQueue.push(op);
    await this.flushOperations();
  }

  /** 生成快照（内存优先，退化到数据库）；走快照链 + 压缩 + 校验和 */
  async createSnapshot(branchId: string, label: string) {
    try {
      const state = await this.getBranchState(branchId);
      if (!state) return;
      const branch = await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { documentId: true },
      });
      if (!branch) return;
      const stats = this.ensureStats(branchId);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(state));
      const vector = this.decodeVector(doc);
      doc.destroy();
      await this.snapshotStorage.write({
        documentId: branch.documentId,
        branchId,
        opSeq: stats.lastOpSeq,
        label,
        state: new Uint8Array(state),
        vector,
      });
      stats.opsSinceSnapshot = 0;
      stats.lastSnapshotAt = Date.now();
      stats.dirty = false;
      this.metrics.recordSnapshot(state.length);
      this.logger.log(`snapshot created for branch ${branchId} (${label})`);
    } catch (e) {
      this.logger.error(`snapshot failed for branch ${branchId}`, e as Error);
    }
  }

  /** 分支当前 Yjs 状态（内存优先，退化到数据库） */
  async getBranchState(branchId: string): Promise<Uint8Array | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { documentId: true, yjsState: true },
    });
    if (!branch) return null;
    const live = this.server?.documents?.get(
      CollaborationService.roomName(branch.documentId, branchId),
    );
    if (live) return Y.encodeStateAsUpdate(live);
    return branch.yjsState ? new Uint8Array(branch.yjsState) : null;
  }

  /**
   * 在分支文档上执行事务（合并/恢复用）：
   * 在线则直接改内存文档（自动广播），离线则改库中状态。
   */
  async transactBranch(
    branchId: string,
    fn: (doc: Y.Doc) => void,
  ): Promise<Uint8Array | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { documentId: true, yjsState: true },
    });
    if (!branch) return null;
    const room = CollaborationService.roomName(branch.documentId, branchId);
    const live = this.server?.documents?.get(room);
    if (live) {
      fn(live);
      return Y.encodeStateAsUpdate(live);
    }
    const doc = new Y.Doc();
    if (branch.yjsState) Y.applyUpdate(doc, new Uint8Array(branch.yjsState));
    fn(doc);
    const state = new Uint8Array(Y.encodeStateAsUpdate(doc));
    await this.prisma.branch.update({
      where: { id: branchId },
      data: { yjsState: state },
    });
    doc.destroy();
    return state;
  }

  /** 分支内容变更后广播失效通知（多实例一致性） */
  async publishInvalidation(documentId: string, branchId: string, reason: string) {
    await this.redis.publishEvent('doc-events', {
      type: 'invalidated',
      reason,
      documentId,
      branchId,
      room: CollaborationService.roomName(documentId, branchId),
      at: Date.now(),
    });
  }

  /**
   * 恢复快照到分支：
   * 1. 先备份当前状态（before-restore），再覆盖
   * 2. 合并式恢复：存在的 key 原地更新字段，仅增删差异 key，
   *    保留 Yjs item 身份，离线客户端已删除的内容不会因合并复活
   */
  async restoreSnapshot(branchId: string, snapshotState: Uint8Array) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { documentId: true },
    });
    if (!branch) throw new Error('branch not found');

    // 先备份当前稿
    await this.createSnapshot(branchId, 'before-restore');

    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, snapshotState);
    const snapshotNodes = tmp.getMap<Y.Map<unknown>>('nodes');

    const applySnapshot = (doc: Y.Doc) => {
      const nodes = doc.getMap<Y.Map<unknown>>('nodes');
      doc.transact(() => {
        [...nodes.keys()].forEach((k) => {
          if (!snapshotNodes.has(k)) nodes.delete(k);
        });
        snapshotNodes.forEach((snapNode, key) => {
          const existing = nodes.get(key);
          if (existing) {
            snapNode.forEach((v, field) => {
              if (existing.get(field) !== v) existing.set(field, v);
            });
          } else {
            const copy = new Y.Map<unknown>();
            snapNode.forEach((v, k) => copy.set(k, v));
            nodes.set(key, copy);
          }
        });
      });
    };

    await this.transactBranch(branchId, (doc) => applySnapshot(doc));
    tmp.destroy();

    // 操作日志 + 失效通知
    await this.appendOperation({
      branchId,
      documentId: branch.documentId,
      userId: null,
      userName: null,
      type: 'restore',
      update: null,
      vector: null,
      meta: { label: 'snapshot-restore' },
    });
    await this.publishInvalidation(branch.documentId, branchId, 'restore');
  }

  getConnectionsCount() {
    return this.server?.getConnectionsCount() ?? 0;
  }

  getDocumentsCount() {
    return this.server?.getDocumentsCount() ?? 0;
  }

  decodeVector(doc: Y.Doc): Record<string, number> {
    const out: Record<string, number> = {};
    Y.decodeStateVector(Y.encodeStateVector(doc)).forEach((clock, client) => {
      out[String(client)] = clock;
    });
    return out;
  }
}
