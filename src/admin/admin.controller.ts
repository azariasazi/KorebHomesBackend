import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ReportStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import {
  RejectListingDto,
  RejectVerificationDto,
  ReviewQueueQueryDto,
  SuspendUserDto,
  UpdateSettingDto,
} from './dto/admin.dto';

/**
 * Every route here requires a valid access token AND the ADMIN role.
 * Guarding at the class level means no admin endpoint can be exposed by
 * accident — a new handler is protected the moment it's added.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  // ---- Dashboard ----
  @Get('dashboard')
  dashboard() {
    return this.adminService.getDashboardStats();
  }

  // ---- Listing review queue ----
  @Get('listings/review-queue')
  reviewQueue(@Query() query: ReviewQueueQueryDto) {
    return this.adminService.getReviewQueue(query);
  }

  @Post('listings/:id/approve')
  approveListing(@Param('id') id: string) {
    return this.adminService.approveListing(id);
  }

  @Post('listings/:id/reject')
  rejectListing(@Param('id') id: string, @Body() dto: RejectListingDto) {
    return this.adminService.rejectListing(id, dto.code, dto.note);
  }

  // ---- User management ----
  @Get('users')
  listUsers(@Query('role') role?: UserRole) {
    return this.adminService.listUsers(role);
  }

  @Post('users/:id/suspend')
  suspendUser(@Param('id') id: string, @Body() dto: SuspendUserDto) {
    return this.adminService.suspendUser(id, dto.reason);
  }

  @Post('users/:id/unsuspend')
  unsuspendUser(@Param('id') id: string) {
    return this.adminService.unsuspendUser(id);
  }

  // ---- Agent verification ----
  @Get('verification/queue')
  verificationQueue() {
    return this.adminService.getVerificationQueue();
  }

  @Post('verification/:userId/approve')
  approveVerification(@Param('userId') userId: string, @CurrentUser('id') adminId: string) {
    return this.adminService.approveVerification(userId, adminId);
  }

  @Post('verification/:userId/reject')
  rejectVerification(@Param('userId') userId: string, @Body() dto: RejectVerificationDto) {
    return this.adminService.rejectVerification(userId, dto.reason);
  }

  // ---- Reports ----
  @Get('reports')
  reports(@Query('status') status?: ReportStatus) {
    return this.adminService.getReports(status);
  }

  @Post('reports/:id/resolve')
  resolveReport(
    @Param('id') id: string,
    @Body('status') status: ReportStatus,
    @Body('note') note?: string,
  ) {
    return this.adminService.resolveReport(id, status, note);
  }

  // ---- Pricing & settings ----
  @Get('settings')
  settings() {
    return this.adminService.getSettings();
  }

  @Patch('settings/:key')
  updateSetting(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.adminService.updateSetting(key, dto.value);
  }
}
