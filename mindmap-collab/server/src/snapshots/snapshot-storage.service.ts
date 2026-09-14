import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';

const FULL_SNAPSHOT_EVERY = 10; // 每 10 个快照一个全量，其余为增量（快照链）
const CHUNK_THRESHOLD = 256 * 1024; // 超过 256KB 分片存储
const CHUNK_SIZE = 64 * 1024; // 每片 64KB
const COMPRESS_THRESHOLD = 1024; // 超过 1KB 才压缩

/**
 * 快照存储服务：
 * - 压缩：gzip（>1KB）
 * - 校验和：完整状态的 sha256，读取时可端到端校验
 * - 快照链：每 10 个快照一个全量，其余为相对前一个的增量
 * - 分片：压缩后仍 >256KB 的快照拆成 64KB 分片
 */
@Injectable()
export class SnapshotStorageService {
  private readonly logger = new Logger(SnapshotStorageService.name);

  constructor(private prisma: PrismaService) {}

  static checksum(state: Uint8Array): string {
    return createHash('sha256').update(state).digest('hex');
  }

  /** 写入快照（自动选择全量/增量、压缩、分片） */
  async write(params: {
    documentId: string;
    branchId: string;
    opSeq: number | null;
    label: string;
    state: Uint8Array; // 完整状态
    vector: Record<string, number>;
  }): Promise<string> {
    const { documentId, branchId, opSeq, label, state, vector } = params;
    const checksum = SnapshotStorageService.checksum(state);

    // 快照链：统计分支已有快照数，决定是否全量
    const count = await this.prisma.snapshot.count({ where: { branchId } });
    const isFull = count % FULL_SNAPSHOT_EVERY === 0;
    const base = isFull
      ? null
      : await this.prisma.snapshot.findFirst({
          where: { branchId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

    // 增量载荷：相对 base 快照向量的 diff
    let payload: Uint8Array = state;
    let kind = 'full';
    let baseSnapshotId: string | null = null;
    if (base) {
      const baseVector = await this.readVector(base.id);
      if (baseVector) {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(state));
        payload = Y.encodeStateAsUpdate(doc, this.vectorToBytes(baseVector));
        doc.destroy();
        kind = 'incremental';
        baseSnapshotId = base.id;
      }
    }

    // 压缩
    let compression: string | null = null;
    if (payload.length > COMPRESS_THRESHOLD) {
      payload = gzipSync(payload);
      compression = 'gzip';
    }

    // 分片（大文档）
    const chunked = payload.length > CHUNK_THRESHOLD;
    const snapshot = await this.prisma.snapshot.create({
      data: {
        documentId,
        branchId,
        opSeq,
        kind,
        baseSnapshotId,
        state: chunked ? new Uint8Array(0) : new Uint8Array(payload),
        compression,
        checksum,
        chunked,
        label,
      },
    });
    if (chunked) {
      await this.prisma.snapshotChunk.createMany({
        data: Array.from(
          { length: Math.ceil(payload.length / CHUNK_SIZE) },
          (_, i) => ({
            snapshotId: snapshot.id,
            index: i,
            data: new Uint8Array(payload.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)),
          }),
        ),
      });
    }
    this.logger.log(
      `snapshot ${snapshot.id} written: ${kind}, ${payload.length}B, chunked=${chunked}`,
    );
    return snapshot.id;
  }

  /** 读取快照的完整状态（沿快照链递归重建 + 解压 + 分片重组） */
  async read(snapshotId: string, depth = 0): Promise<Uint8Array> {
    if (depth > FULL_SNAPSHOT_EVERY + 2) {
      throw new Error('snapshot chain too deep (cycle?)');
    }
    const snap = await this.prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
    if (!snap) throw new Error(`snapshot ${snap?.id ?? snapshotId} not found`);

    // 分片重组
    let payload: Uint8Array = snap.chunked
      ? concatBytes(snap.chunks.map((c) => new Uint8Array(c.data)))
      : new Uint8Array(snap.state);
    // 解压
    if (snap.compression === 'gzip') payload = gunzipSync(payload);

    if (snap.kind === 'incremental') {
      if (!snap.baseSnapshotId) throw new Error('incremental snapshot missing base');
      const baseState = await this.read(snap.baseSnapshotId, depth + 1);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(baseState));
      Y.applyUpdate(doc, new Uint8Array(payload));
      const full = Y.encodeStateAsUpdate(doc);
      doc.destroy();
      return full;
    }
    return payload;
  }

  /** 校验快照完整性：重建后重新计算校验和比对（恢复演练） */
  async verify(snapshotId: string): Promise<{
    ok: boolean;
    checksum: string | null;
    computed: string;
    nodeCount: number;
  }> {
    const state = await this.read(snapshotId);
    const computed = SnapshotStorageService.checksum(state);
    const snap = await this.prisma.snapshot.findUnique({
      where: { id: snapshotId },
      select: { checksum: true },
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(state));
    const nodeCount = doc.getMap('nodes').size;
    doc.destroy();
    return {
      ok: !snap?.checksum || snap.checksum === computed,
      checksum: snap?.checksum ?? null,
      computed,
      nodeCount,
    };
  }

  /** 快照对应状态的版本向量（增量快照的 base 定位用） */
  private async readVector(
    snapshotId: string,
  ): Promise<Record<string, number> | null> {
    const state = await this.read(snapshotId);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(state));
    const vector: Record<string, number> = {};
    Y.decodeStateVector(Y.encodeStateVector(doc)).forEach((clock, client) => {
      vector[String(client)] = clock;
    });
    doc.destroy();
    return vector;
  }

  private vectorToBytes(vector: Record<string, number>): Uint8Array {
    const map = new Map<number, number>();
    for (const [client, clock] of Object.entries(vector)) {
      map.set(Number(client), clock);
    }
    return Y.encodeStateVector(map as any);
  }
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
