import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsNotEmpty, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BranchesService } from './branches.service';
import { RedisService } from '../redis/redis.service';

class CreateBranchDto {
  @IsNotEmpty()
  name: string;

  @IsOptional()
  fromBranchId?: string;

  @IsOptional()
  fromSnapshotId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fromSeq?: number;
}

class RenameBranchDto {
  @IsNotEmpty()
  name: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class BranchesController {
  constructor(
    private branches: BranchesService,
    private redis: RedisService,
  ) {}

  @Get('documents/:documentId/branches')
  list(@CurrentUser() user: any, @Param('documentId') documentId: string) {
    return this.branches.list(documentId, user.id);
  }

  @Post('documents/:documentId/branches')
  create(
    @CurrentUser() user: any,
    @Param('documentId') documentId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branches.create(documentId, user.id, dto);
  }

  @Patch('branches/:id')
  rename(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RenameBranchDto,
  ) {
    return this.branches.rename(id, user.id, dto.name);
  }

  @Delete('branches/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.branches.remove(id, user.id);
  }

  /** 分支操作日志（回放 / 增量同步用） */
  @Get('branches/:id/operations')
  operations(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('fromSeq') fromSeq?: string,
    @Query('limit') limit?: string,
  ) {
    return this.branches.operations(
      id,
      user.id,
      Number(fromSeq || 0),
      Math.min(Number(limit || 500), 2000),
    );
  }

  /** 任意版本重建：?seq=N 或 ?before=ISO时间 */
  @Get('branches/:id/reconstruct')
  async reconstruct(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('seq') seq?: string,
    @Query('before') before?: string,
  ) {
    const branch = await this.branches.getBranch(id);
    await this.branches.assertAccessOf(branch.documentId, user.id);
    const rec = await this.branches.reconstructState(
      id,
      seq != null ? Number(seq) : undefined,
      before ? new Date(before) : undefined,
    );
    return {
      vector: rec.vector,
      state: Buffer.from(rec.state).toString('base64'),
    };
  }

  /** 历史版本 diff：?fromSeq=N&toSeq=M（缺省 toSeq 为当前） */
  @Get('branches/:id/diff')
  diff(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('fromSeq') fromSeq: string,
    @Query('toSeq') toSeq?: string,
  ) {
    return this.branches.diff(
      id,
      user.id,
      Number(fromSeq || 0),
      toSeq != null ? Number(toSeq) : undefined,
    );
  }

  /** 共同祖先 */
  @Get('branches/:id/ancestor/:otherId')
  ancestor(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('otherId') otherId: string,
  ) {
    return this.branches.commonAncestor(id, otherId);
  }

  /** 分支在线用户 */
  @Get('branches/:id/presence')
  async presence(@CurrentUser() user: any, @Param('id') id: string) {
    const branch = await this.branches.getBranch(id);
    await this.branches.assertAccessOf(branch.documentId, user.id);
    return this.redis.getPresence(id);
  }
}
