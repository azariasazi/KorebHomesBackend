import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SuperAdminService } from './super-admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';

/**
 * SUPER_ADMIN-only. Managing other admins is deliberately separated from the
 * regular admin panel so a normal admin can never reach these routes — the
 * class-level guard requires the SUPER_ADMIN role on every handler.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('super-admin')
export class SuperAdminController {
  constructor(private superAdminService: SuperAdminService) {}

  @Get('admins')
  listAdmins() {
    return this.superAdminService.listAdmins();
  }

  @Post('admins')
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.superAdminService.createAdmin(dto);
  }

  @Delete('admins/:id')
  removeAdmin(@Param('id') id: string, @CurrentUser('id') superAdminId: string) {
    return this.superAdminService.removeAdmin(id, superAdminId);
  }
}
