import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ListingsModule } from './listings/listings.module';
import { PhotosModule } from './photos/photos.module';
import { FavoritesModule } from './favorites/favorites.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    // Global configuration — loads .env once, available everywhere via ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),

    // Powers the scheduled auto-unpublish / inactivity-nudge job
    ScheduleModule.forRoot(),

    // Basic rate limiting (e.g. protects OTP send/verify endpoints from abuse)
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),

    PrismaModule,
    AuthModule,
    UsersModule,
    ListingsModule,
    PhotosModule,
    FavoritesModule,
    PaymentsModule,
    ReportsModule,

    // Admin Panel backend: review queue, user management, agent verification,
    // dashboard stats, and pricing controls. RBAC-locked to ADMIN role inside
    // the controller via RolesGuard.
    AdminModule,

    // Background jobs: listing inactivity nudges + auto-unpublish
    JobsModule,
  ],
})
export class AppModule {}
