import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  documentId?: string;
  branchId?: string;
  userId?: string;
  userName?: string;
  action: string;
  detail?: Record<string, unknown>;
}

/** 审计日志：关键操作落库，支持按文档查询 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  log(entry: AuditEntry) {
    // 异步写，不阻塞主流程；失败仅打印
    this.prisma.auditLog
      .create({
        data: {
          documentId: entry.documentId ?? null,
          branchId: entry.branchId ?? null,
          userId: entry.userId ?? null,
          userName: entry.userName ?? null,
          action: entry.action,
          detail: (entry.detail ?? null) as any,
        },
      })
      .catch((e) => console.error('[audit] write failed:', e.message));
  }

  listByDocument(documentId: string, take = 200) {
    return this.prisma.auditLog.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
