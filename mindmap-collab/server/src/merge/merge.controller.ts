import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MergeService, type MergeStrategy } from './merge.service';
import type { Resolution } from './merge.util';

class CreateMergeDto {
  @IsNotEmpty()
  sourceBranchId: string;

  @IsNotEmpty()
  targetBranchId: string;

  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsIn(['auto', 'ours', 'theirs', 'manual'])
  strategy?: MergeStrategy;
}

class SubmitMergeDto {
  @IsOptional()
  @IsIn(['auto', 'ours', 'theirs', 'manual'])
  strategy?: MergeStrategy;

  @IsOptional()
  resolutions?: Record<string, Resolution>;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class MergeController {
  constructor(private merges: MergeService) {}

  @Post('documents/:documentId/merges')
  create(
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
    @Body() dto: CreateMergeDto,
  ) {
    return this.merges.create(documentId, user.id, dto);
  }

  @Get('documents/:documentId/merges')
  list(
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
    @Query('status') status?: string,
  ) {
    return this.merges.list(documentId, user.id, status);
  }

  @Get('merges/:id')
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.merges.get(id, user.id);
  }

  @Post('merges/:id/submit')
  submit(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SubmitMergeDto,
  ) {
    return this.merges.submit(id, user.id, dto);
  }

  @Post('merges/:id/close')
  close(@CurrentUser() user: any, @Param('id') id: string) {
    return this.merges.close(id, user.id);
  }
}
