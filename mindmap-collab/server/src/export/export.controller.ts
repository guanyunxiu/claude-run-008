import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ExportService } from './export.service';

@UseGuards(JwtAuthGuard)
@Controller('documents')
export class ExportController {
  constructor(private exporter: ExportService) {}

  @Get(':id/export')
  async export(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('format') format: string,
    @Query('branchId') branchId: string,
    @Res() res: Response,
  ) {
    if (format === 'opml') {
      const xml = await this.exporter.toOpml(id, user.id, branchId || undefined);
      res.set({
        'Content-Type': 'text/x-opml; charset=utf-8',
        'Content-Disposition': `attachment; filename="mindmap-${id}.opml"`,
      });
      return res.send(xml);
    }
    const md = await this.exporter.toMarkdown(id, user.id, branchId || undefined);
    res.set({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="mindmap-${id}.md"`,
    });
    return res.send(md);
  }
}
