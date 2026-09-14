import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { BranchesService } from '../branches/branches.service';
import { readNodes } from '../collaboration/tree.util';
import {
  applyResolutions,
  detectConflicts,
  type ConflictInfo,
  type Resolution,
} from './merge.util';

export type MergeStrategy = 'auto' | 'ours' | 'theirs' | 'manual';

@Injectable()
export class MergeService {
  private readonly logger = new Logger(MergeService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private metrics: MetricsService,
    private audit: AuditService,
    private documents: DocumentsService,
    private workspaces: WorkspacesService,
    private collaboration: CollaborationService,
    private branches: BranchesService,
  ) {}

  /** 三方对比：base（共同祖先）/ ours（目标）/ theirs（源）→ 冲突列表 */
  private async computeConflicts(
    sourceBranchId: string,
    targetBranchId: string,
  ): Promise<ConflictInfo[]> {
    const [oursState, theirsState, ancestor] = await Promise.all([
      this.collaboration.getBranchState(targetBranchId),
      this.collaboration.getBranchState(sourceBranchId),
      this.branches.commonAncestor(sourceBranchId, targetBranchId),
    ]);
    const toNodes = (state: Uint8Array | null) => {
      const doc = new Y.Doc();
      if (state) Y.applyUpdate(doc, new Uint8Array(state));
      const nodes = readNodes(doc);
      doc.destroy();
      return nodes;
    };
    return detectConflicts(
      toNodes(ancestor.state),
      toNodes(oursState),
      toNodes(theirsState),
    );
  }

  /** 创建合并请求（commenter 及以上可创建），预检测冲突 */
  async create(
    documentId: string,
    userId: string,
    dto: {
      sourceBranchId: string;
      targetBranchId: string;
      title: string;
      strategy?: MergeStrategy;
    },
  ) {
    const doc = await this.documents.assertAccess(documentId, userId);
    await this.workspaces.assertRole(doc.workspaceId, userId, [
      'owner',
      'editor',
      'commenter',
    ]);
    if (dto.sourceBranchId === dto.targetBranchId) {
      throw new BadRequestException('源分支与目标分支不能相同');
    }
    const conflicts = await this.computeConflicts(
      dto.sourceBranchId,
      dto.targetBranchId,
    );
    const mr = await this.prisma.mergeRequest.create({
      data: {
        documentId,
        sourceBranchId: dto.sourceBranchId,
        targetBranchId: dto.targetBranchId,
        title: dto.title || '合并请求',
        mergeKey: randomUUID(), // 幂等键
        conflicts: conflicts as any,
      },
    });
    this.metrics.recordConflicts(conflicts.length);
    this.audit.log({
      documentId,
      userId,
      action: 'merge.create',
      detail: {
        mergeRequestId: mr.id,
        sourceBranchId: dto.sourceBranchId,
        targetBranchId: dto.targetBranchId,
        conflictCount: conflicts.length,
      },
    });
    return { ...mr, conflictCount: conflicts.length };
  }

  async list(documentId: string, userId: string, status?: string) {
    await this.documents.assertAccess(documentId, userId);
    const mrs = await this.prisma.mergeRequest.findMany({
      where: { documentId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const branchNames = new Map<string, string>();
    const branches = await this.prisma.branch.findMany({
      where: { documentId },
      select: { id: true, name: true },
    });
    branches.forEach((b) => branchNames.set(b.id, b.name));
    return mrs.map((mr) => ({
      ...mr,
      sourceBranchName: branchNames.get(mr.sourceBranchId),
      targetBranchName: branchNames.get(mr.targetBranchId),
      conflictCount: Array.isArray(mr.conflicts) ? mr.conflicts.length : 0,
    }));
  }

  async get(mergeRequestId: string, userId: string) {
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { id: mergeRequestId },
    });
    if (!mr) throw new NotFoundException('合并请求不存在');
    await this.documents.assertAccess(mr.documentId, userId);
    return mr;
  }

  /**
   * 提交合并：
   * - 合并锁（Redis NX，多实例互斥）
   * - 幂等：mergeKey 一次性标记 + 状态机 CAS（open → merged）
   * - 策略：auto（纯 CRDT）/ ours / theirs / manual（逐冲突解决）
   * - 结果写入操作日志与版本向量
   */
  async submit(
    mergeRequestId: string,
    userId: string,
    dto: { strategy?: MergeStrategy; resolutions?: Record<string, Resolution> },
  ) {
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { id: mergeRequestId },
    });
    if (!mr) throw new NotFoundException('合并请求不存在');
    if (mr.status !== 'open') {
      return { ok: true, alreadyMerged: mr.status === 'merged', mergeRequest: mr };
    }
    const doc = await this.documents.assertAccess(mr.documentId, userId);
    const target = await this.prisma.branch.findUnique({
      where: { id: mr.targetBranchId },
    });
    if (!target) throw new NotFoundException('目标分支不存在');
    // 合并权限：owner/editor；保护分支仅 owner 可合并
    const requiredRoles = target.protected ? ['owner'] : ['owner', 'editor'];
    await this.workspaces.assertRole(doc.workspaceId, userId, requiredRoles);

    // 合并锁：同一目标分支多实例互斥
    const lockKey = `lock:merge:${mr.targetBranchId}`;
    const token = await this.redis.acquireLock(lockKey, 30000);
    if (!token) {
      throw new ConflictException('该分支正在合并中，请稍后重试');
    }
    try {
      // 幂等：同一 mergeKey 只允许应用一次
      const first = await this.redis.markOnce(`merge:applied:${mr.mergeKey}`);
      if (!first) {
        return { ok: true, alreadyMerged: true, mergeRequest: mr };
      }

      // 重新计算冲突（创建后分支可能已变化）
      const conflicts = await this.computeConflicts(
        mr.sourceBranchId,
        mr.targetBranchId,
      );
      const strategy: MergeStrategy =
        dto.strategy ?? (conflicts.length > 0 ? 'manual' : 'auto');

      // 构造解决表
      let resolutions: Record<string, Resolution> = {};
      if (strategy === 'ours' || strategy === 'theirs') {
        for (const c of conflicts) {
          resolutions[c.key] = { strategy };
        }
      } else if (strategy === 'manual') {
        resolutions = dto.resolutions ?? {};
        const unresolved = conflicts.filter((c) => !resolutions[c.key]);
        if (unresolved.length > 0) {
          throw new ConflictException({
            message: `还有 ${unresolved.length} 个冲突未解决`,
            conflicts,
          });
        }
      }

      // 应用合并：CRDT 自动合并 + 冲突解决
      const [oursState, theirsState] = await Promise.all([
        this.collaboration.getBranchState(mr.targetBranchId),
        this.collaboration.getBranchState(mr.sourceBranchId),
      ]);
      const oursDoc = new Y.Doc();
      if (oursState) Y.applyUpdate(oursDoc, new Uint8Array(oursState));
      const theirsDoc = new Y.Doc();
      if (theirsState) Y.applyUpdate(theirsDoc, new Uint8Array(theirsState));
      const diffUpdate = Y.encodeStateAsUpdate(
        theirsDoc,
        Y.encodeStateVector(oursDoc),
      );
      oursDoc.destroy();
      theirsDoc.destroy();

      const newState = await this.collaboration.transactBranch(
        mr.targetBranchId,
        (doc) => {
          Y.applyUpdate(doc, diffUpdate);
          if (Object.keys(resolutions).length > 0) {
            applyResolutions(doc, conflicts, resolutions);
          }
        },
      );

      // 状态机 CAS：open → merged（防并发重复提交）
      const cas = await this.prisma.mergeRequest.updateMany({
        where: { id: mr.id, status: 'open' },
        data: {
          status: 'merged',
          mergedAt: new Date(),
          mergedById: userId,
          resolutions: resolutions as any,
          conflicts: conflicts as any,
        },
      });
      if (cas.count === 0) {
        return { ok: true, alreadyMerged: true, mergeRequest: mr };
      }

      // 操作日志（含合并后版本向量）
      const finalDoc = new Y.Doc();
      if (newState) Y.applyUpdate(finalDoc, new Uint8Array(newState));
      await this.collaboration.appendOperation({
        branchId: mr.targetBranchId,
        documentId: mr.documentId,
        userId,
        userName: null,
        type: 'merge',
        update: null,
        vector: this.collaboration.decodeVector(finalDoc),
        meta: {
          mergeRequestId: mr.id,
          sourceBranchId: mr.sourceBranchId,
          targetBranchId: mr.targetBranchId,
          strategy,
          conflictCount: conflicts.length,
        },
      });
      finalDoc.destroy();

      this.metrics.recordConflicts(conflicts.length);
      this.audit.log({
        documentId: mr.documentId,
        branchId: mr.targetBranchId,
        userId,
        action: 'merge.submit',
        detail: {
          mergeRequestId: mr.id,
          strategy,
          conflictCount: conflicts.length,
        },
      });
      await this.collaboration.publishInvalidation(
        mr.documentId,
        mr.targetBranchId,
        'merge',
      );
      return { ok: true, conflictCount: conflicts.length };
    } finally {
      await this.redis.releaseLock(lockKey, token);
    }
  }

  async close(mergeRequestId: string, userId: string) {
    const mr = await this.prisma.mergeRequest.findUnique({
      where: { id: mergeRequestId },
    });
    if (!mr) throw new NotFoundException('合并请求不存在');
    const doc = await this.documents.assertAccess(mr.documentId, userId);
    const member = await this.workspaces.assertMember(doc.workspaceId, userId);
    if (!['owner', 'editor'].includes(member.role) && mr.createdById !== userId) {
      throw new ForbiddenException('权限不足');
    }
    await this.prisma.mergeRequest.update({
      where: { id: mr.id },
      data: { status: 'closed' },
    });
    this.audit.log({
      documentId: mr.documentId,
      userId,
      action: 'merge.close',
      detail: { mergeRequestId: mr.id },
    });
    return { ok: true };
  }
}
