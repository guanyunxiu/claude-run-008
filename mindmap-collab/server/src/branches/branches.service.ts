import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { AuditService } from '../audit/audit.service';
import { readNodes } from '../collaboration/tree.util';
import {
  decodeVector,
  diffNodes,
  vectorClockSum,
  type Vector,
} from '../merge/merge.util';

@Injectable()
export class BranchesService {
  constructor(
    private prisma: PrismaService,
    private documents: DocumentsService,
    private workspaces: WorkspacesService,
    private collaboration: CollaborationService,
    private audit: AuditService,
  ) {}

  async list(documentId: string, userId: string) {
    await this.documents.assertAccess(documentId, userId);
    return this.prisma.branch.findMany({
      where: { documentId },
      select: {
        id: true,
        name: true,
        isMain: true,
        createdById: true,
        baseBranchId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * 创建分支：
   * - fromSnapshotId：从历史快照创建
   * - fromBranchId + fromSeq：从某分支的历史操作点创建
   * - 默认：从主分支当前头创建
   */
  async create(
    documentId: string,
    userId: string,
    dto: { name: string; fromBranchId?: string; fromSnapshotId?: string; fromSeq?: number },
  ) {
    const doc = await this.documents.assertAccess(documentId, userId);
    // commenter 也可创建分支（用于提交合并请求），viewer 不行
    await this.workspaces.assertRole(doc.workspaceId, userId, [
      'owner',
      'editor',
      'commenter',
    ]);
    if (!dto.name?.trim()) throw new BadRequestException('分支名不能为空');

    let state: Uint8Array | null = null;
    let baseBranchId: string | null = null;
    let baseVector: Vector | null = null;

    if (dto.fromSnapshotId) {
      const snapshot = await this.prisma.snapshot.findUnique({
        where: { id: dto.fromSnapshotId },
      });
      if (!snapshot || snapshot.documentId !== documentId) {
        throw new NotFoundException('快照不存在');
      }
      state = new Uint8Array(snapshot.state);
      baseBranchId = snapshot.branchId ?? null;
    } else if (dto.fromBranchId && dto.fromSeq != null) {
      const rec = await this.reconstructState(dto.fromBranchId, dto.fromSeq);
      state = rec.state;
      baseBranchId = dto.fromBranchId;
      baseVector = rec.vector;
    } else {
      baseBranchId = dto.fromBranchId ?? (await this.mainBranchId(documentId));
      state = await this.collaboration.getBranchState(baseBranchId);
    }

    // 版本向量：从状态解码（共同祖先计算用）
    if (state && !baseVector) {
      const tmp = new Y.Doc();
      Y.applyUpdate(tmp, new Uint8Array(state));
      baseVector = decodeVector(tmp);
      tmp.destroy();
    }

    const branch = await this.prisma.branch.create({
      data: {
        documentId,
        name: dto.name.trim(),
        createdById: userId,
        yjsState: state ? new Uint8Array(state) : null,
        baseBranchId,
        baseVector: baseVector ?? undefined,
        forkState: state ? new Uint8Array(state) : null,
      },
    });
    this.audit.log({
      documentId,
      branchId: branch.id,
      userId,
      action: 'branch.create',
      detail: { name: branch.name, baseBranchId },
    });
    return branch;
  }

  async rename(branchId: string, userId: string, name: string) {
    const branch = await this.getBranch(branchId);
    const doc = await this.documents.assertAccess(branch.documentId, userId);
    const member = await this.workspaces.assertMember(doc.workspaceId, userId);
    // owner/editor 或分支创建者（commenter）可重命名
    if (
      !['owner', 'editor'].includes(member.role) &&
      branch.createdById !== userId
    ) {
      throw new ForbiddenException('权限不足');
    }
    const updated = await this.prisma.branch.update({
      where: { id: branchId },
      data: { name: name.trim() },
    });
    this.audit.log({
      documentId: branch.documentId,
      branchId,
      userId,
      action: 'branch.rename',
      detail: { from: branch.name, to: name },
    });
    return updated;
  }

  async remove(branchId: string, userId: string) {
    const branch = await this.getBranch(branchId);
    if (branch.isMain) throw new BadRequestException('主分支不能删除');
    const doc = await this.documents.assertAccess(branch.documentId, userId);
    // 分支删除权限：owner/editor
    await this.workspaces.assertRole(doc.workspaceId, userId, [
      'owner',
      'editor',
    ]);
    await this.prisma.branch.delete({ where: { id: branchId } });
    this.audit.log({
      documentId: branch.documentId,
      branchId,
      userId,
      action: 'branch.delete',
      detail: { name: branch.name },
    });
    return { ok: true };
  }

  async getBranch(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) throw new NotFoundException('分支不存在');
    return branch;
  }

  /** 供控制器复用的访问校验 */
  assertAccessOf(documentId: string, userId: string) {
    return this.documents.assertAccess(documentId, userId);
  }

  async mainBranchId(documentId: string): Promise<string> {
    const main = await this.prisma.branch.findFirst({
      where: { documentId, isMain: true },
    });
    if (!main) throw new NotFoundException('主分支不存在');
    return main.id;
  }

  /* ---------- 操作日志 ---------- */

  async operations(branchId: string, userId: string, fromSeq = 0, limit = 500) {
    const branch = await this.getBranch(branchId);
    await this.documents.assertAccess(branch.documentId, userId);
    const ops = await this.prisma.operation.findMany({
      where: { branchId, seq: { gt: fromSeq } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return ops.map((op) => ({
      seq: op.seq,
      type: op.type,
      userId: op.userId,
      userName: op.userName,
      createdAt: op.createdAt,
      meta: op.meta,
      update: op.update ? Buffer.from(op.update).toString('base64') : null,
    }));
  }

  /* ---------- 任意版本重建 ---------- */

  /**
   * 重建分支在某个操作序号 / 时间点的状态：
   * 最近快照 + 其后操作日志增量回放
   */
  async reconstructState(
    branchId: string,
    targetSeq?: number,
    before?: Date,
  ): Promise<{ state: Uint8Array; vector: Vector }> {
    const snapshot = await this.prisma.snapshot.findFirst({
      where: {
        branchId,
        ...(targetSeq != null ? { opSeq: { lte: targetSeq } } : {}),
        ...(before ? { createdAt: { lte: before } } : {}),
      },
      orderBy: [{ opSeq: 'desc' }, { createdAt: 'desc' }],
    });
    const doc = new Y.Doc();
    if (snapshot?.state) {
      Y.applyUpdate(doc, new Uint8Array(snapshot.state));
    }
    const ops = await this.prisma.operation.findMany({
      where: {
        branchId,
        seq: {
          gt: snapshot?.opSeq ?? -1,
          ...(targetSeq != null ? { lte: targetSeq } : {}),
        },
        ...(before ? { createdAt: { lte: before } } : {}),
      },
      orderBy: { seq: 'asc' },
    });
    for (const op of ops) {
      if (op.update) Y.applyUpdate(doc, new Uint8Array(op.update));
    }
    const vector = decodeVector(doc);
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return { state, vector };
  }

  /* ---------- 历史版本 diff ---------- */

  async diff(branchId: string, userId: string, fromSeq: number, toSeq?: number) {
    const branch = await this.getBranch(branchId);
    await this.documents.assertAccess(branch.documentId, userId);
    const from = await this.reconstructState(branchId, fromSeq);
    const to =
      toSeq != null
        ? await this.reconstructState(branchId, toSeq)
        : { state: await this.collaboration.getBranchState(branchId) };
    const docA = new Y.Doc();
    Y.applyUpdate(docA, new Uint8Array(from.state));
    const docB = new Y.Doc();
    if (to.state) Y.applyUpdate(docB, new Uint8Array(to.state));
    const entries = diffNodes(readNodes(docA), readNodes(docB));
    docA.destroy();
    docB.destroy();
    return entries;
  }

  /* ---------- 共同祖先 ---------- */

  /** 沿分叉链计算两个分支的共同祖先（分支 + 向量 + 状态） */
  async commonAncestor(aId: string, bId: string) {
    const chainOf = async (id: string) => {
      const chain: Array<{
        branchId: string;
        name: string;
        baseBranchId: string | null;
        baseVector: Vector | null;
        forkState: Uint8Array | null;
      }> = [];
      let cur = await this.prisma.branch.findUnique({ where: { id } });
      let guard = 0;
      while (cur && guard++ < 100) {
        chain.push({
          branchId: cur.id,
          name: cur.name,
          baseBranchId: cur.baseBranchId,
          baseVector: (cur.baseVector as Vector) ?? null,
          forkState: cur.forkState ? new Uint8Array(cur.forkState) : null,
        });
        if (!cur.baseBranchId) break;
        cur = await this.prisma.branch.findUnique({
          where: { id: cur.baseBranchId },
        });
      }
      return chain;
    };

    const [chainA, chainB] = await Promise.all([chainOf(aId), chainOf(bId)]);
    const inA = new Set(chainA.map((c) => c.branchId));
    const inB = new Set(chainB.map((c) => c.branchId));

    // 候选：B 链上 baseBranchId 落在 A 链中的最深节点（forkState 即祖先状态）
    const candidates: Array<{
      branchId: string;
      vector: Vector | null;
      state: Uint8Array | null;
    }> = [];
    for (const node of chainB) {
      if (node.baseBranchId && inA.has(node.baseBranchId)) {
        candidates.push({
          branchId: node.baseBranchId,
          vector: node.baseVector,
          state: node.forkState,
        });
        break; // 链从近到远，第一个即最深
      }
    }
    for (const node of chainA) {
      if (node.baseBranchId && inB.has(node.baseBranchId)) {
        candidates.push({
          branchId: node.baseBranchId,
          vector: node.baseVector,
          state: node.forkState,
        });
        break;
      }
    }
    // 取时钟和最大（最近）的候选
    candidates.sort(
      (x, y) => vectorClockSum(y.vector) - vectorClockSum(x.vector),
    );
    const best = candidates[0] ?? null;
    return {
      branchId: best?.branchId ?? null,
      vector: best?.vector ?? {},
      state: best?.state ?? null,
    };
  }
}
