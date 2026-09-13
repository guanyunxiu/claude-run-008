import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WorkspacesService {
  constructor(private prisma: PrismaService) {}

  listForUser(userId: string) {
    return this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(userId: string, name: string) {
    return this.prisma.workspace.create({
      data: {
        name,
        members: { create: { userId, role: 'owner' } },
      },
      include: { members: true },
    });
  }

  /** 校验用户是否为工作区成员，返回成员角色 */
  async assertMember(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) throw new ForbiddenException('无权访问该工作区');
    return member;
  }

  async assertExists(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!ws) throw new NotFoundException('工作区不存在');
    return ws;
  }
}
