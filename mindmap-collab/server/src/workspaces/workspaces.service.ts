import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  /** 成员列表 */
  async listMembers(workspaceId: string, requesterId: string) {
    await this.assertMember(workspaceId, requesterId);
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { id: 'asc' },
    });
  }

  /** 通过邮箱邀请成员（任何现有成员均可邀请） */
  async addMember(
    workspaceId: string,
    requesterId: string,
    email: string,
    role = 'editor',
  ) {
    await this.assertMember(workspaceId, requesterId);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('该邮箱对应的用户不存在');
    const existing = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
    });
    if (existing) throw new ConflictException('该用户已是工作区成员');
    return this.prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  /** 移除成员（仅 owner，且不能移除 owner 自己） */
  async removeMember(workspaceId: string, requesterId: string, targetUserId: string) {
    const requester = await this.assertMember(workspaceId, requesterId);
    if (requester.role !== 'owner') {
      throw new ForbiddenException('只有工作区所有者可以移除成员');
    }
    const target = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
    if (!target) throw new NotFoundException('该用户不是工作区成员');
    if (target.role === 'owner') {
      throw new ForbiddenException('不能移除工作区所有者');
    }
    return this.prisma.workspaceMember.delete({ where: { id: target.id } });
  }
}
