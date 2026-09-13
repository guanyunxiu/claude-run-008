import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsEmail, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WorkspacesService } from './workspaces.service';

class CreateWorkspaceDto {
  @IsNotEmpty()
  name: string;
}

class AddMemberDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsIn(['owner', 'editor', 'viewer'])
  role?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: any) {
    return this.workspaces.listForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.id, dto.name);
  }

  @Get(':id/members')
  listMembers(@CurrentUser() user: any, @Param('id') id: string) {
    return this.workspaces.listMembers(id, user.id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.workspaces.addMember(id, user.id, dto.email, dto.role);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.workspaces.removeMember(id, user.id, userId);
  }
}
