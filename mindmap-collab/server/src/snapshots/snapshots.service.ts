import { Injectable, NotFoundException } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { AuditService } from '../audit/audit.service';
import { buildTree, readNodes, TreeNode } from '../collaboration/tree.util';

@Injectable()
export class SnapshotsService {
  constructor(
    private prisma: PrismaService,
    private documents: DocumentsService,
    private collaboration: CollaborationService,
    private audit: AuditService,
  ) {}

  /** 快照列表：可按分支过滤 */
  async list(documentId: string, userId: string, branchId?: string) {
    await this.documents.assertAccess(documentId, userId);
    const snapshots = await this.prisma.snapshot.findMany({
      where: { documentId, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { branch: { select: { id: true, name: true } } },
    });
    return snapshots.map((s) => ({
      id: s.id,
      label: s.label,
      createdAt: s.createdAt,
      size: s.state.length,
      opSeq: s.opSeq,
      branchId: s.branchId,
      branchName: s.branch?.name ?? null,
    }));
  }

  /** 预览：把快照内容渲染为纯文本大纲（Markdown 列表） */
  async preview(documentId: string, snapshotId: string, userId: string) {
    await this.documents.assertAccess(documentId, userId);
    const snapshot = await this.prisma.snapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot || snapshot.documentId !== documentId) {
      throw new NotFoundException('快照不存在');
    }
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(snapshot.state));
    const tree = buildTree(readNodes(doc));
    const text = tree ? renderPlainText(tree) : '(空文档)';
    doc.destroy();
    return { text };
  }

  /** 恢复快照到其所属分支（无分支信息时恢复到主分支） */
  async restore(documentId: string, snapshotId: string, userId: string) {
    // 恢复会覆盖当前内容，需要编辑权限
    await this.documents.assertCanEdit(documentId, userId);
    const snapshot = await this.prisma.snapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot || snapshot.documentId !== documentId) {
      throw new NotFoundException('快照不存在');
    }
    const branchId =
      snapshot.branchId ??
      (
        await this.prisma.branch.findFirst({
          where: { documentId, isMain: true },
          select: { id: true },
        })
      )?.id;
    if (!branchId) throw new NotFoundException('目标分支不存在');
    await this.collaboration.restoreSnapshot(
      branchId,
      new Uint8Array(snapshot.state),
    );
    this.audit.log({
      documentId,
      branchId,
      userId,
      action: 'snapshot.restore',
      detail: { snapshotId },
    });
    return { ok: true };
  }
}

function renderPlainText(node: TreeNode, depth = 0): string {
  const lines: string[] = [];
  if (depth > 0) lines.push(`${'  '.repeat(depth - 1)}- ${node.text || '(空)'}`);
  for (const child of node.children) {
    lines.push(renderPlainText(child, depth + 1));
  }
  return lines.filter(Boolean).join('\n');
}
