import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private workspaces: WorkspacesService,
  ) {}

  listByWorkspace(workspaceId: string, userId: string) {
    return this.workspaces
      .assertMember(workspaceId, userId)
      .then(() =>
        this.prisma.document.findMany({
          where: { workspaceId },
          orderBy: { updatedAt: 'desc' },
          include: {
            createdBy: { select: { id: true, name: true } },
            _count: { select: { snapshots: true } },
          },
        }),
      );
  }

  async create(workspaceId: string, userId: string, title: string) {
    await this.workspaces.assertRole(workspaceId, userId, ['owner', 'editor']);
    return this.prisma.document.create({
      data: { workspaceId, createdById: userId, title: title || '未命名文档' },
    });
  }

  /** 校验文档存在且用户有权访问（属于其所在工作区成员） */
  async assertAccess(documentId: string, userId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    await this.workspaces.assertMember(doc.workspaceId, userId);
    return doc;
  }

  /** 校验用户对该文档有编辑权限（owner / editor） */
  async assertCanEdit(documentId: string, userId: string) {
    const doc = await this.assertAccess(documentId, userId);
    await this.workspaces.assertRole(doc.workspaceId, userId, [
      'owner',
      'editor',
    ]);
    return doc;
  }

  async get(documentId: string, userId: string) {
    const doc = await this.assertAccess(documentId, userId);
    const member = await this.workspaces.assertMember(doc.workspaceId, userId);
    const { yjsState, ...rest } = doc;
    // 返回当前用户在该文档上的角色，前端据此切换只读模式
    return { ...rest, hasState: !!yjsState, role: member.role };
  }

  async rename(documentId: string, userId: string, title: string) {
    await this.assertCanEdit(documentId, userId);
    return this.prisma.document.update({
      where: { id: documentId },
      data: { title },
    });
  }

  async remove(documentId: string, userId: string) {
    await this.assertCanEdit(documentId, userId);
    return this.prisma.document.delete({ where: { id: documentId } });
  }

  /** 供协同层调用：按 ID 查文档（不做权限校验） */
  findById(documentId: string) {
    return this.prisma.document.findUnique({ where: { id: documentId } });
  }

  /** 持久化 Yjs 二进制状态 */
  async saveYjsState(documentId: string, state: Uint8Array) {
    return this.prisma.document.update({
      where: { id: documentId },
      data: { yjsState: new Uint8Array(state) },
    });
  }
}
