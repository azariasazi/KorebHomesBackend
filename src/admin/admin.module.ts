import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';

@Module({
  controllers: [AdminController, SuperAdminController],
  providers: [AdminService, SuperAdminService],
})
export class AdminModule {}
