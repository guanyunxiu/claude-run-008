import { Injectable, NotFoundException } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { buildTree, readNodes, TreeNode } from '../collaboration/tree.util';

@Injectable()
export class SnapshotsService {
  constructor(
    private prisma: PrismaService,
    private documents: DocumentsService,
    private collaboration: CollaborationService,
  ) {}

  async list(documentId: string, userId: string) {
    await this.documents.assertAccess(documentId, userId);
    const snapshots = await this.prisma.snapshot.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return snapshots.map((s) => ({
      id: s.id,
      label: s.label,
      createdAt: s.createdAt,
      size: s.state.length,
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

  async restore(documentId: string, snapshotId: string, userId: string) {
    await this.documents.assertAccess(documentId, userId);
    const snapshot = await this.prisma.snapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot || snapshot.documentId !== documentId) {
      throw new NotFoundException('快照不存在');
    }
    await this.collaboration.restoreSnapshot(
      documentId,
      new Uint8Array(snapshot.state),
    );
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
