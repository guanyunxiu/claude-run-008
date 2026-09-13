import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DocumentsService } from './documents.service';
import { RedisService } from '../redis/redis.service';

class CreateDocumentDto {
  @IsNotEmpty()
  title: string;
}

class RenameDocumentDto {
  @IsNotEmpty()
  title: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class DocumentsController {
  constructor(
    private documents: DocumentsService,
    private redis: RedisService,
  ) {}

  @Get('workspaces/:workspaceId/documents')
  list(
    @CurrentUser() user: any,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.documents.listByWorkspace(workspaceId, user.id);
  }

  @Post('workspaces/:workspaceId/documents')
  create(
    @CurrentUser() user: any,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documents.create(workspaceId, user.id, dto.title);
  }

  @Get('documents/:id')
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.documents.get(id, user.id);
  }

  @Patch('documents/:id')
  rename(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RenameDocumentDto,
  ) {
    return this.documents.rename(id, user.id, dto.title);
  }

  @Delete('documents/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.documents.remove(id, user.id);
  }

  /** 在线用户（Redis presence） */
  @Get('documents/:id/presence')
  async presence(@CurrentUser() user: any, @Param('id') id: string) {
    await this.documents.assertAccess(id, user.id);
    return this.redis.getPresence(id);
  }
}
