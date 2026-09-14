import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuditService } from './audit.service';
import { DocumentsService } from '../documents/documents.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@UseGuards(JwtAuthGuard)
@Controller('documents/:documentId/audit')
export class AuditController {
  constructor(
    private audit: AuditService,
    private documents: DocumentsService,
    private workspaces: WorkspacesService,
  ) {}

  @Get()
  async list(@CurrentUser() user: any, @Param('documentId') documentId: string) {
    const doc = await this.documents.assertAccess(documentId, user.id);
    // 审计日志仅 owner / editor 可见
    await this.workspaces.assertRole(doc.workspaceId, user.id, [
      'owner',
      'editor',
    ]);
    return this.audit.listByDocument(documentId);
  }
}
